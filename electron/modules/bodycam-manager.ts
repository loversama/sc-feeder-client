/**
 * Electron wiring for the optional body-cam feature (core logic + privacy rules: bodycam.ts).
 *
 * Settings live in the existing electron-store under bodycam* keys (defaults applied here, so the
 * schema in config-manager.ts is untouched). OFF by default.
 */
import { desktopCapturer, ipcMain, BrowserWindow, Notification, type IpcMainInvokeEvent } from 'electron';
import { execFile } from 'node:child_process';
import * as logger from './logger';
import { store } from './config-manager';
import { getServerLink } from './server-connection';
import { getSettingsWindow, createSettingsWindow } from './window-manager';
import { setBodycamTrayState } from './tray-manager';
import { makeProcessChecker, resolveWindowProcessName } from './bodycam-window';
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

/** What the renderer may read/write. The window-title matcher is deliberately NOT here. */
export type BodycamSettings = { enabled: boolean; intervalSec: number; orgs: string[] };
type InternalSettings = BodycamSettings & { titlePattern: string };

/** Main-process-only debugging override for the window-title matcher (never a user setting). */
function titlePattern(): string {
  const env = process.env.VOIDLOG_BODYCAM_TITLE;
  return typeof env === 'string' && env.trim() ? env.slice(0, 200) : BODYCAM_DEFAULT_TITLE_PATTERN;
}

export function getBodycamSettings(): InternalSettings {
  const s = store as any;
  const orgs = s.get('bodycamOrgs');
  return {
    enabled: s.get('bodycamEnabled') === true,
    intervalSec: clampInterval(s.get('bodycamIntervalSec') ?? BODYCAM_DEFAULT_INTERVAL_S),
    orgs: Array.isArray(orgs) ? orgs.filter((t: unknown): t is string => typeof t === 'string').map((t) => t.toUpperCase()) : [],
    titlePattern: titlePattern(),
  };
}

function publicSettings(): BodycamSettings {
  const { enabled, intervalSec, orgs } = getBodycamSettings();
  return { enabled, intervalSec, orgs };
}

function saveBodycamSettings(patch: Partial<BodycamSettings>): BodycamSettings {
  const s = store as any;
  if (typeof patch.enabled === 'boolean') s.set('bodycamEnabled', patch.enabled);
  if (patch.intervalSec !== undefined) s.set('bodycamIntervalSec', clampInterval(patch.intervalSec));
  if (Array.isArray(patch.orgs)) s.set('bodycamOrgs', [...new Set(patch.orgs.filter((t) => typeof t === 'string').map((t) => t.trim().toUpperCase()).filter(Boolean))].slice(0, 20));
  return publicSettings();
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
  sharer?.resume();
  if (s.enabled && s.orgs.length) {
    sharer?.start();
    // Always-visible indicator while screenshots are being shared (tray tooltip + menu entry).
    setBodycamTrayState({ text: `Sharing game screenshots with ${s.orgs.join(', ')}`, onStop: () => void stopSharing() });
  } else {
    sharer?.stop();
    setBodycamTrayState(null);
  }
}

/** Switch sharing off (tray "Stop", notification action, settings). The server deletes the frame immediately. */
export async function stopSharing(): Promise<void> {
  saveBodycamSettings({ enabled: false });
  applyRunState();
  await syncServer();
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send('bodycam:settings-changed');
}

/** One-time notice when sharing resumes on its own at app launch. */
function announceAutoResume(): void {
  const s = getBodycamSettings();
  if (!(s.enabled && s.orgs.length)) return;
  const body = `VOIDLOG is sharing small screenshots of your Star Citizen window with ${s.orgs.join(', ')} while the game runs. Click to open settings.`;
  try {
    if (Notification.isSupported()) {
      // Shown even when general notifications are off: this is a privacy notice.
      const n = new Notification({ title: 'Game screenshot sharing is ON', body, actions: [{ type: 'button', text: 'Stop sharing' }], silent: false });
      n.on('click', () => {
        createSettingsWindow();
      });
      n.on('action', () => void stopSharing()); // action buttons: macOS only; Windows users use the tray menu entry
      n.show();
    }
  } catch (err) {
    logger.warn(MODULE_NAME, `Could not show the sharing notice: ${(err as Error).message}`);
  }
}

/** Only the settings window may read/change body-cam settings. */
function assertSettingsSender(e: IpcMainInvokeEvent): void {
  const win = getSettingsWindow();
  if (!win || win.isDestroyed() || e.sender !== win.webContents) throw new Error('bodycam settings can only be changed from the settings window');
}

function pushStatus(): void {
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send('bodycam:status', lastStatus);
}

export function initBodycam(): void {
  if (sharer) return;
  sharer = new BodycamSharer({
    getSettings: getBodycamSettings,
    isGameRunning: () => gameRunning,
    // The title alone is not enough: the window must belong to StarCitizen.exe (fails closed).
    isGameWindow: makeProcessChecker((hwnd) => resolveWindowProcessName(hwnd)),
    resync: () => syncServer(),
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
  getServerLink().on('authenticated', () => {
    sharer?.resume(); // a reconnect clears a "server is not sharing" pause
    void syncServer();
  });
  applyRunState();
  announceAutoResume();
  void syncServer();
}

export async function shutdownBodycam(): Promise<void> {
  sharer?.stop();
  setBodycamTrayState(null);
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
  // Deliberately keep the opt-in; the frame expires on the server within 120 s.
}

export function registerBodycamIpc(): void {
  ipcMain.handle('bodycam:get', async (e) => {
    assertSettingsSender(e);
    const server = isOnline() ? await emitAck('bodycam_get') : undefined;
    return { settings: publicSettings(), status: lastStatus, gameRunning, online: isOnline(), server: server ?? null };
  });
  ipcMain.handle('bodycam:set-settings', async (e, patch: Partial<BodycamSettings>) => {
    assertSettingsSender(e);
    const next = saveBodycamSettings(patch ?? {});
    applyRunState();
    await syncServer();
    return { settings: next, status: lastStatus };
  });
}
