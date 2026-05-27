import fs from 'node:fs/promises';
import path from 'node:path';
import { getCurrentLogPath, store } from './config-manager';
import { parseLogContent, resetParserState } from './log-parser';
import { setSuppressRendererUpdates } from './event-processor';
import { ensureConnectedAndSendLogChunk } from './server-connection';
import { getMainWindow } from './window-manager';
import * as logger from './logger';

const MODULE_NAME = 'LogBackupScanner';

// --- Types ---

interface ScannedFileRecord {
  size: number;
  mtime: number;
  scannedAt: string;
}

export interface BackupScanProgress {
  status: 'idle' | 'discovering' | 'scanning' | 'complete' | 'error';
  currentFile: string;
  currentFileIndex: number;
  totalFiles: number;
  bytesProcessed: number;
  totalBytes: number;
  eventsFound: number;
  newFiles: number;
  skippedFiles: number;
  errorMessage?: string;
}

// --- Module State ---

let isScanning = false;
let currentProgress: BackupScanProgress = createIdleProgress();

const CHUNK_SIZE = 512 * 1024; // 512KB chunks
const CHUNK_SEND_DELAY_MS = 75; // Delay between server sends to avoid flooding

// --- Helper Functions ---

function createIdleProgress(): BackupScanProgress {
  return {
    status: 'idle',
    currentFile: '',
    currentFileIndex: 0,
    totalFiles: 0,
    bytesProcessed: 0,
    totalBytes: 0,
    eventsFound: 0,
    newFiles: 0,
    skippedFiles: 0,
  };
}

function sendProgressToRenderer(progress: BackupScanProgress) {
  currentProgress = progress;
  const win = getMainWindow();
  if (win && !win.isDestroyed()) {
    win.webContents.send('backup-scan-progress', progress);
  }
}

function getScannedBackups(): Record<string, ScannedFileRecord> {
  return (store.get('scannedLogBackups' as any) as Record<string, ScannedFileRecord>) || {};
}

function setScannedBackups(records: Record<string, ScannedFileRecord>) {
  store.set('scannedLogBackups' as any, records);
}

function deriveLogBackupsPath(): string {
  const logPath = getCurrentLogPath();
  const logDir = path.dirname(logPath);
  return path.join(logDir, 'logbackups');
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// --- Public Functions ---

export function getBackupScanStatus(): BackupScanProgress {
  return { ...currentProgress };
}

export async function checkLogBackupsAvailable(): Promise<{
  available: boolean;
  fileCount: number;
  newFileCount: number;
  backupsPath: string;
}> {
  const backupsPath = deriveLogBackupsPath();

  try {
    await fs.access(backupsPath);
  } catch {
    return { available: false, fileCount: 0, newFileCount: 0, backupsPath };
  }

  try {
    const entries = await fs.readdir(backupsPath);
    const logFiles = entries.filter(f => f.toLowerCase().endsWith('.log'));
    const scanned = getScannedBackups();

    let newCount = 0;
    for (const file of logFiles) {
      const fullPath = path.join(backupsPath, file);
      try {
        const stat = await fs.stat(fullPath);
        const record = scanned[fullPath];
        if (!record || record.size !== stat.size || record.mtime !== stat.mtimeMs) {
          newCount++;
        }
      } catch {
        // Skip files we can't stat
      }
    }

    return {
      available: true,
      fileCount: logFiles.length,
      newFileCount: newCount,
      backupsPath,
    };
  } catch (error) {
    logger.error(MODULE_NAME, 'Error checking LogBackups:', error);
    return { available: false, fileCount: 0, newFileCount: 0, backupsPath };
  }
}

export async function scanLogBackups(): Promise<boolean> {
  if (isScanning) {
    logger.warn(MODULE_NAME, 'Scan already in progress, skipping.');
    return false;
  }

  isScanning = true;
  const backupsPath = deriveLogBackupsPath();

  logger.info(MODULE_NAME, `Starting LogBackups scan at: ${backupsPath}`);
  sendProgressToRenderer({
    ...createIdleProgress(),
    status: 'discovering',
  });

  try {
    // 1. Check directory exists
    try {
      await fs.access(backupsPath);
    } catch {
      logger.info(MODULE_NAME, 'LogBackups directory not found, nothing to scan.');
      sendProgressToRenderer({
        ...createIdleProgress(),
        status: 'complete',
      });
      isScanning = false;
      return true;
    }

    // 2. Enumerate .log files sorted by mtime (oldest first)
    const entries = await fs.readdir(backupsPath);
    const logFileNames = entries.filter(f => f.toLowerCase().endsWith('.log'));

    if (logFileNames.length === 0) {
      logger.info(MODULE_NAME, 'No .log files found in LogBackups.');
      sendProgressToRenderer({
        ...createIdleProgress(),
        status: 'complete',
      });
      isScanning = false;
      return true;
    }

    // Stat all files and sort by mtime ascending
    const fileInfos: Array<{ name: string; fullPath: string; size: number; mtime: number }> = [];
    for (const name of logFileNames) {
      const fullPath = path.join(backupsPath, name);
      try {
        const stat = await fs.stat(fullPath);
        fileInfos.push({ name, fullPath, size: stat.size, mtime: stat.mtimeMs });
      } catch (err) {
        logger.warn(MODULE_NAME, `Could not stat ${fullPath}, skipping:`, err);
      }
    }

    fileInfos.sort((a, b) => a.mtime - b.mtime);

    // 3. Filter out already-scanned files
    const scanned = getScannedBackups();
    const filesToProcess: typeof fileInfos = [];
    let skippedCount = 0;

    for (const fi of fileInfos) {
      const record = scanned[fi.fullPath];
      if (record && record.size === fi.size && record.mtime === fi.mtime) {
        skippedCount++;
      } else {
        filesToProcess.push(fi);
      }
    }

    if (filesToProcess.length === 0) {
      logger.info(MODULE_NAME, `All ${fileInfos.length} backup files already scanned.`);
      sendProgressToRenderer({
        ...createIdleProgress(),
        status: 'complete',
        totalFiles: fileInfos.length,
        skippedFiles: skippedCount,
      });
      isScanning = false;
      return true;
    }

    const totalBytes = filesToProcess.reduce((sum, f) => sum + f.size, 0);
    logger.info(MODULE_NAME, `Found ${filesToProcess.length} new/modified files to scan (${skippedCount} skipped, ${(totalBytes / 1024 / 1024).toFixed(1)} MB total).`);

    // 4. Suppress live feed updates during bulk import
    setSuppressRendererUpdates(true);

    let globalBytesProcessed = 0;

    for (let i = 0; i < filesToProcess.length; i++) {
      const fi = filesToProcess[i];

      sendProgressToRenderer({
        status: 'scanning',
        currentFile: fi.name,
        currentFileIndex: i + 1,
        totalFiles: filesToProcess.length,
        bytesProcessed: globalBytesProcessed,
        totalBytes,
        eventsFound: 0,
        newFiles: filesToProcess.length,
        skippedFiles: skippedCount,
      });

      logger.info(MODULE_NAME, `Scanning file ${i + 1}/${filesToProcess.length}: ${fi.name} (${(fi.size / 1024).toFixed(0)} KB)`);

      // Reset parser state before each file for clean isolation
      resetParserState();

      try {
        await processBackupFile(fi.fullPath, fi.size, (bytesRead) => {
          sendProgressToRenderer({
            status: 'scanning',
            currentFile: fi.name,
            currentFileIndex: i + 1,
            totalFiles: filesToProcess.length,
            bytesProcessed: globalBytesProcessed + bytesRead,
            totalBytes,
            eventsFound: 0,
            newFiles: filesToProcess.length,
            skippedFiles: skippedCount,
          });
        });

        // Mark file as scanned
        scanned[fi.fullPath] = {
          size: fi.size,
          mtime: fi.mtime,
          scannedAt: new Date().toISOString(),
        };
        setScannedBackups(scanned);

        globalBytesProcessed += fi.size;
      } catch (error) {
        logger.error(MODULE_NAME, `Error processing backup file ${fi.name}:`, error);
        // Continue with next file
        globalBytesProcessed += fi.size;
      }
    }

    // Resume live feed updates and reset parser state
    setSuppressRendererUpdates(false);
    resetParserState();

    logger.info(MODULE_NAME, `LogBackups scan complete. Processed ${filesToProcess.length} files, ${(globalBytesProcessed / 1024 / 1024).toFixed(1)} MB.`);
    sendProgressToRenderer({
      status: 'complete',
      currentFile: '',
      currentFileIndex: filesToProcess.length,
      totalFiles: filesToProcess.length,
      bytesProcessed: globalBytesProcessed,
      totalBytes,
      eventsFound: 0,
      newFiles: filesToProcess.length,
      skippedFiles: skippedCount,
    });

    isScanning = false;
    return true;
  } catch (error: any) {
    setSuppressRendererUpdates(false);
    logger.error(MODULE_NAME, 'LogBackups scan failed:', error);
    sendProgressToRenderer({
      ...currentProgress,
      status: 'error',
      errorMessage: error.message || 'Unknown error',
    });
    isScanning = false;
    return false;
  }
}

async function processBackupFile(
  filePath: string,
  fileSize: number,
  onProgress: (bytesRead: number) => void,
): Promise<void> {
  const fh = await fs.open(filePath, 'r');
  let offset = 0;

  try {
    while (offset < fileSize) {
      const readSize = Math.min(CHUNK_SIZE, fileSize - offset);
      const buffer = Buffer.alloc(readSize);
      const { bytesRead } = await fh.read(buffer, 0, readSize, offset);

      if (bytesRead === 0) break;

      const content = buffer.toString('utf-8', 0, bytesRead);

      // Parse locally with silentMode=true (no desktop notifications for old events)
      await parseLogContent(content, true);

      // Send to server for backend processing
      ensureConnectedAndSendLogChunk(content);

      offset += bytesRead;
      onProgress(offset);

      // Rate-limit to avoid flooding the server
      await sleep(CHUNK_SEND_DELAY_MS);
    }
  } finally {
    await fh.close();
  }
}

export function isScanInProgress(): boolean {
  return isScanning;
}

export function clearScannedBackupsRecord(): void {
  setScannedBackups({});
  logger.info(MODULE_NAME, 'Cleared all scanned backup records. Next scan will re-process all files.');
}
