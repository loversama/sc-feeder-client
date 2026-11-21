/**
 * Electron wiring for the optional body-cam feature (core logic + privacy rules: bodycam.ts).
 *
 * Settings live in the existing electron-store under bodycam* keys (defaults applied here, so the
 * schema in config-manager.ts is untouched). OFF by default.
 */
import { desktopCapturer, ipcMain, BrowserWindow } from 'electron';
import { execFile } from 'node:child_process';
import * as logger from './logger';
import { store } from './config-manager';
import { getServerLink } from './server-connection';
import { getAuthStatus, getPersistedClientId } from './auth-manager';
import {
  BodycamSharer,
  BODYCAM_DEFAULT_INTERVAL_S,
  BODYCAM_DEFAULT_TITLE_PATTERN,
  clampInterval,
  type BodycamStatus,
  type CamSource,
} from './bodycam';

const MODULE_NAME = 'Bodycam';
const GAME_EXE = 'StarCitizen.exe';
const PROCESS_POLL_MS = 5000;

export type BodycamSettings = { enabled: boolean; intervalSec: number; orgs: string[]; titlePattern: string };

export function getBodycamSettings(): BodycamSettings {
  const s = store as any;
  const orgs = s.get('bodycamOrgs');
  return {
    enabled: s.get('bodycamEnabled') === true,
    intervalSec: clampInterval(s.get('bodycamIntervalSec') ?? BODYCAM_DEFAULT_INTERVAL_S),
    orgs: Array.isArray(orgs) ? orgs.filter((t: unknown): t is string => typeof t === 'string').map((t) => t.toUpperCase()) : [],
    titlePattern: typeof s.get('bodycamTitlePattern') === 'string' && s.get('bodycamTitlePattern') ? s.get('bodycamTitlePattern') : BODYCAM_DEFAULT_TITLE_PATTERN,
  };
}

function saveBodycamSettings(patch: Partial<BodycamSettings>): BodycamSettings {
  const s = store as any;
  if (typeof patch.enabled === 'boolean') s.set('bodycamEnabled', patch.enabled);
  if (patch.intervalSec !== undefined) s.set('bodycamIntervalSec', clampInterval(patch.intervalSec));
  if (Array.isArray(patch.orgs)) s.set('bodycamOrgs', [...new Set(patch.orgs.filter((t) => typeof t === 'string').map((t) => t.trim().toUpperCase()).filter(Boolean))].slice(0, 20));
  if (typeof patch.titlePattern === 'string') s.set('bodycamTitlePattern', patch.titlePattern.slice(0, 200));
  return getBodycamSettings();
}

let sharer: BodycamSharer | null = null;
let gameRunning = false;
let pollTimer: NodeJS.Timeout | null = null;
let lastStatus: BodycamStatus = { state: 'off', lastSentAt: null, framesSent: 0, lastBytes: null };

function pollGame(): void {
  if (process.platform !== 'win32') {
    gameRunning = false;
    return;
  }
  execFile('tasklist', ['/FI', `IMAGENAME eq ${GAME_EXE}`, '/FO', 'CSV', '/NH'], { windowsHide: true, timeout: 4000 }, (err, stdout) => {
    gameRunning = !err && stdout.toLowerCase().includes(GAME_EXE.toLowerCase());
  });
}

function isOnline(): boolean {
  return getAuthStatus().isAuthenticated && getServerLink().authenticated;
}

function emitAck<T = any>(event: string, payload?: unknown): Promise<T | undefined> {
  return new Promise((resolve) => {
    const sent = getServerLink().sendWithAck(event, payload ?? {}, (ack) => resolve(ack));
    if (!sent) resolve(undefined);
  });
}

/** Tell the server which orgs may see the frames (or stop). The server stores it; this re-syncs after reconnects. */
async function syncServer(): Promise<void> {
  if (!isOnline()) return;
  const s = getBodycamSettings();
  if (s.enabled && s.orgs.length) await emitAck('bodycam_config', { orgs: s.orgs });
  else await emitAck('bodycam_stop');
}

function applyRunState(): void {
  const s = getBodycamSettings();
  if (s.enabled && s.orgs.length) sharer?.start();
  else sharer?.stop();
}

function pushStatus(): void {
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send('bodycam:status', lastStatus);
}

export function initBodycam(): void {
  if (sharer) return;
  sharer = new BodycamSharer({
    getSettings: getBodycamSettings,
    isGameRunning: () => gameRunning,
    isOnline,
    // The ONLY capture call in the app: window sources only (never 'screen'), small thumbnails.
    getWindowSources: async (opts) => (await desktopCapturer.getSources(opts)) as unknown as CamSource[],
    upload: (frame, capturedAt) => emitAck('submit_bodycam', { clientId: getPersistedClientId(), frame, capturedAt }),
    onStatus: (st) => {
      lastStatus = st;
      pushStatus();
    },
    log: (lvl, msg) => logger[lvl === 'debug' ? 'debug' : lvl](MODULE_NAME, msg),
  });
  pollGame();
  pollTimer = setInterval(pollGame, PROCESS_POLL_MS);
  pollTimer.unref?.();
  getServerLink().on('authenticated', () => void syncServer());
  applyRunState();
  void syncServer();
}

export async function shutdownBodycam(): Promise<void> {
  sharer?.stop();
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
  // Deliberately keep the opt-in; the frame expires on the server within 120 s.
}

export function registerBodycamIpc(): void {
  ipcMain.handle('bodycam:get', async () => {
    const server = isOnline() ? await emitAck('bodycam_get') : undefined;
    return { settings: getBodycamSettings(), status: lastStatus, gameRunning, online: isOnline(), server: server ?? null };
  });
  ipcMain.handle('bodycam:set-settings', async (_e, patch: Partial<BodycamSettings>) => {
    const next = saveBodycamSettings(patch ?? {});
    applyRunState();
    await syncServer();
    return { settings: next, status: lastStatus };
  });
}
