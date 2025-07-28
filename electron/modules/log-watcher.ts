import chokidar from 'chokidar';
import fs from 'node:fs/promises';
import { getCurrentLogPath } from './config-manager';
import { parseLogContent } from './log-parser.ts'; // Ensure .ts extension
import { getMainWindow } from './window-manager';
import { endCurrentSession, startNewSession } from './session-manager.ts'; // Add .ts extension
import * as logger from './logger';
import { ensureConnectedAndSendLogChunk, isConnected as isServerConnected } from './server-connection'; // Import new function

const MODULE_NAME = 'LogWatcher'; // Define module name for logger

// --- Module State ---

let watcher: chokidar.FSWatcher | null = null;
let lastReadSize = 0;
let isInitialReadComplete = false; // Track if the initial full read is done

// --- Helper Function ---

// Function to read new content from the log file
// Renamed to avoid conflict if imported elsewhere, made internal to this module
async function _readNewLogContent(isInitialScan: boolean = false) {
    const win = getMainWindow();
    // Don't proceed if the main window isn't available (e.g., during startup/shutdown)
    if (!win || win.isDestroyed()) {
        logger.debug(MODULE_NAME, "Main window not available, skipping log read.");
        return;
    }

    const logPath = getCurrentLogPath();

    try {
        const fileExists = await fs.access(logPath).then(() => true).catch(() => false);
        if (!fileExists) {
            if (lastReadSize !== 0) { // Only log/reset if we were previously reading
                 logger.warn(MODULE_NAME, `File not found at ${logPath}. Resetting read position.`);
                 win?.webContents.send('log-status', `Log file not found. Waiting...`);
                 lastReadSize = 0;
                 isInitialReadComplete = false; // Reset initial read flag
            }
            return; // Exit if file doesn't exist
        }

        const stats = await fs.stat(logPath);
        const currentSize = stats.size;
        // Determine if this specific read operation is part of the initial file scan
        const isReadingInitialContent = lastReadSize === 0 && currentSize > 0;

        if (currentSize > lastReadSize) {
            logger.debug(MODULE_NAME, `Log file changed. Reading from ${lastReadSize} to ${currentSize}`);
            const stream = (await fs.open(logPath)).createReadStream({
                start: lastReadSize,
                end: currentSize - 1,
                encoding: 'utf-8',
            });

            let newContent = '';
            for await (const chunk of stream) {
                newContent += chunk;
            }

            if (newContent) {
                win?.webContents.send('log-update', newContent); // Send raw content

                // Determine silent mode:
                // - Silent if it's the initial scan AND we haven't completed the first full read yet.
                // - Not silent for subsequent changes after the initial read is done.
                const silentMode = isInitialScan && !isInitialReadComplete;
                logger.debug(MODULE_NAME, `Parsing content. Initial Scan: ${isInitialScan}, Initial Read Complete: ${isInitialReadComplete}, Silent Mode: ${silentMode}`);
                await parseLogContent(newContent, silentMode); // Call local parser

                // Send the raw chunk to the server if connected
                // Attempt to send log chunk, ensuring connection is attempted if needed
                ensureConnectedAndSendLogChunk(newContent);

                if (isReadingInitialContent) {
                    win?.webContents.send('log-status', `Monitoring started. Loaded initial content (${currentSize} bytes).`);
                    isInitialReadComplete = true; // Mark initial read as complete *after* parsing
                    logger.info(MODULE_NAME, "Initial read complete.");
                } else {
                     // Optional: Send status for incremental updates?
                     // win?.webContents.send('log-status', `Log updated (+${newContent.length} bytes).`);
                }
            } else if (isReadingInitialContent) {
                // File has size but reading the delta yielded nothing (unlikely but possible)
                win?.webContents.send('log-status', `Monitoring started. File has content (${currentSize} bytes), but initial read was empty.`);
                isInitialReadComplete = true; // Still mark as complete
                 logger.info(MODULE_NAME, "Initial read complete (empty content).");
            }
            lastReadSize = currentSize; // Update read position *after* successful read/parse

        } else if (currentSize < lastReadSize) {
            // File size decreased (truncated or replaced)
            logger.warn(MODULE_NAME, 'Log file size decreased, resetting read position.');
            lastReadSize = 0;
            isInitialReadComplete = false; // Reset initial read flag
            win?.webContents.send('log-reset'); // Notify renderer to clear display
            win?.webContents.send('log-status', 'Log file truncated or replaced. Reading from start.');
            await _readNewLogContent(true); // Re-read from start, treat as initial scan

        } else if (isReadingInitialContent && currentSize === 0) {
            // Initial read, file exists but is empty
            win?.webContents.send('log-status', `Monitoring started. File exists but is empty.`);
            isInitialReadComplete = true; // Mark initial read as complete
             logger.info(MODULE_NAME, "Initial read complete (file empty).");
        }
        // If currentSize === lastReadSize and not initial read, do nothing.

    } catch (error: any) {
        logger.error(MODULE_NAME, 'Error reading log file stats or content:', error);
        // Avoid spamming errors if file is temporarily inaccessible
        if (error.code !== 'ENOENT') { // ENOENT is handled above
             win?.webContents.send('log-status', `Error reading file: ${error.message}`);
        }
        // Consider resetting lastReadSize on certain errors?
        // lastReadSize = 0;
        // isInitialReadComplete = false;
    }
}


// --- Public Functions ---

export async function startWatchingLogFile() {
    const logPath = getCurrentLogPath();
    const win = getMainWindow();

    logger.info(MODULE_NAME, `Attempting to watch: ${logPath}`);
    win?.webContents.send('log-status', `Attempting to watch: ${logPath}`);

    // End current session before starting new watch/read
    await endCurrentSession();

    if (watcher) {
        logger.info(MODULE_NAME, 'Closing previous watcher...');
        await watcher.close();
        watcher = null;
    }

    lastReadSize = 0; // Reset read position
    isInitialReadComplete = false; // Reset initial read flag

    // Start a new session *before* initial read
    startNewSession();

    let fileExistsInitially = false;
    try {
        await fs.access(logPath);
        fileExistsInitially = true;
        logger.info(MODULE_NAME, `File found. Initializing watcher for: ${logPath}`);
        win?.webContents.send('log-status', `File found. Initializing watcher...`);
    } catch (error) {
        logger.warn(MODULE_NAME, `Initial check failed: File not found at ${logPath}. Watcher will wait for file creation.`);
        win?.webContents.send('log-status', `Log file not found. Waiting for file...`);
    }

    watcher = chokidar.watch(logPath, {
        persistent: true,
        ignoreInitial: true, // We handle the initial read manually
        awaitWriteFinish: {
            stabilityThreshold: 500, // Wait 500ms after last write
            pollInterval: 100
        },
        // Polling is often necessary on Windows for network drives or certain scenarios
        usePolling: process.platform === 'win32',
        interval: 300, // Base polling interval
        binaryInterval: 500 // Interval for binary files (if needed, though log is text)
    });

    watcher.on('add', async (path) => {
        logger.info(MODULE_NAME, `Log file added: ${path}`);
        win?.webContents.send('log-status', `Log file created/found: ${path}. Reading content...`);
        lastReadSize = 0; // Ensure we read from start
        isInitialReadComplete = false;
        await _readNewLogContent(true); // Treat add event as part of initial scan
    });

    watcher.on('change', async (path) => {
        // console.log(`[LogWatcher] Log file changed: ${path}`); // Can be noisy
        await _readNewLogContent(false); // Subsequent changes are not initial scan
    });

    watcher.on('error', (error) => {
        logger.error(MODULE_NAME, `Watcher error: ${error}`);
        win?.webContents.send('log-status', `Watcher error: ${error.message}`);
        // Consider stopping/restarting the watcher on certain errors
    });

    // Perform initial read if the file existed when watcher started
    if (fileExistsInitially) {
        logger.info(MODULE_NAME, "Performing initial read for existing file...");
        await _readNewLogContent(true); // Treat as initial scan
    } else {
        // If file didn't exist, initial read is technically complete (as there's nothing to read)
        isInitialReadComplete = true;
         logger.info(MODULE_NAME, "Initial read complete (file did not exist at start).");
    }
}

export async function stopWatchingLogFile() {
    if (watcher) {
        logger.info(MODULE_NAME, 'Stopping file watcher...');
        await watcher.close();
        watcher = null;
        logger.info(MODULE_NAME, 'File watcher stopped.');
    }
    // Also end the session when explicitly stopping the watcher
    await endCurrentSession();
    lastReadSize = 0; // Reset size
    isInitialReadComplete = false;
}

// Function to trigger a rescan (used by debug/IPC)
export async function rescanLogFile() {
     logger.info(MODULE_NAME, 'Rescanning log file from beginning...');
     const win = getMainWindow();

     // 1. Stop existing watcher temporarily
     if (watcher) {
         await watcher.close();
         watcher = null;
     }

     // 2. Reset state
     lastReadSize = 0;
     isInitialReadComplete = false;

     // 3. End current session and start a new one
     await endCurrentSession();
     startNewSession(); // Start new session for the rescan

     // 4. Notify renderer
     win?.webContents.send('log-reset'); // Clear display
     win?.webContents.send('log-status', 'Rescanning log file from beginning...');

     // 5. Perform the full read (treat as initial scan, non-silent)
     const logPath = getCurrentLogPath();
     try {
         const fileExists = await fs.access(logPath).then(() => true).catch(() => false);
         if (fileExists) {
             const stats = await fs.stat(logPath);
             const stream = (await fs.open(logPath)).createReadStream({ encoding: 'utf-8' });
             let content = '';
             for await (const chunk of stream) {
                 content += chunk;
             }
             if (content) {
                 // Parse with silentMode = false to process all events from the full file
                 await parseLogContent(content, false);
                 lastReadSize = stats.size; // Update size after full read
             } else {
                  lastReadSize = 0; // File exists but is empty
             }
             win?.webContents.send('log-status', `Rescan complete. Processed ${stats.size} bytes.`);
         } else {
             lastReadSize = 0;
             win?.webContents.send('log-status', 'Rescan complete. Log file not found.');
         }
         isInitialReadComplete = true; // Mark initial read complete after rescan
     } catch (error: any) {
         logger.error(MODULE_NAME, 'Error during log rescan:', error);
         win?.webContents.send('log-status', `Rescan failed: ${error.message}`);
         lastReadSize = 0; // Reset on error
         isInitialReadComplete = false;
     }

     // 6. Restart the watcher to catch subsequent changes
     await startWatchingLogFile(); // This will re-initialize the watcher
}