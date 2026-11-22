/**
 * Electron wiring for the optional body-cam feature (core logic + privacy rules: bodycam.ts).
 *
 * Settings live in the existing electron-store under bodycam* keys (defaults applied here, so the
 * schema in config-manager.ts is untouched). OFF by default.
 */
import { app, desktopCapturer, ipcMain, nativeImage, session, BrowserWindow, Notification, type IpcMainInvokeEvent } from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';
import * as logger from './logger';
import { store } from './config-manager';
import { getServerLink } from './server-connection';
import { getSettingsWindow, createSettingsWindow } from './window-manager';
import { setBodycamTrayState } from './tray-manager';
import { makeProcessChecker, checkGameWindow, hwndFromSourceId } from './bodycam-window';
import { LiveSharer, type LiveParams, type LiveStatus } from './bodycam-live';
import { getAuthStatus, getPersistedClientId } from './auth-manager';
import { detectGame, detectionMessage, type GameDetection, type DetectStep } from './game-detect';
import { getTelemetryService } from './telemetry/telemetry-manager';
import { getCurrentLogPath } from './config-manager';
import {
  BodycamSharer,
  BODYCAM_DEFAULT_INTERVAL_S,
  BODYCAM_DEFAULT_TITLE_PATTERN,
  clampInterval,
  VERIFY_FAILED_MESSAGE,
  isBlankBitmap,
  makeTitleMatcher,
  matchingWindows,
  type BodycamStatus,
  type CamSource,
} from './bodycam';

const MODULE_NAME = 'Bodycam';
const PROCESS_POLL_MS = 5000;

/** What the renderer may read/write. The window-title matcher is deliberately NOT here. */
export type BodycamSettings = { enabled: boolean; intervalSec: number; orgs: string[]; allowLive: boolean };
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
    allowLive: s.get('bodycamAllowLive') === true,
    intervalSec: clampInterval(s.get('bodycamIntervalSec') ?? BODYCAM_DEFAULT_INTERVAL_S),
    orgs: Array.isArray(orgs) ? orgs.filter((t: unknown): t is string => typeof t === 'string').map((t) => t.toUpperCase()) : [],
    titlePattern: titlePattern(),
  };
}

function publicSettings(): BodycamSettings {
  const { enabled, intervalSec, orgs, allowLive } = getBodycamSettings();
  return { enabled, intervalSec, orgs, allowLive };
}

function saveBodycamSettings(patch: Partial<BodycamSettings>): BodycamSettings {
  const s = store as any;
  if (typeof patch.enabled === 'boolean') s.set('bodycamEnabled', patch.enabled);
  if (typeof patch.allowLive === 'boolean') s.set('bodycamAllowLive', patch.allowLive);
  if (patch.intervalSec !== undefined) s.set('bodycamIntervalSec', clampInterval(patch.intervalSec));
  if (Array.isArray(patch.orgs)) s.set('bodycamOrgs', [...new Set(patch.orgs.filter((t) => typeof t === 'string').map((t) => t.trim().toUpperCase()).filter(Boolean))].slice(0, 20));
  return publicSettings();
}

let sharer: BodycamSharer | null = null;
let live: LiveSharer | null = null;
let liveStatus: LiveStatus = { state: 'idle', viewers: 0, framesSent: 0 };
/** 'yes' / 'no' / 'unknown' (the check could not run). Cached 3 s; pass { fresh: true } to bypass. */
const isGameWindow = makeProcessChecker((hwnd) => checkGameWindow(hwnd));

// ---- live capture adapter -------------------------------------------------------------------
// Primary: ONE window captured through getUserMedia(chromeMediaSourceId) in a hidden, sandboxed
// window (efficient, touches only that window). Fallback: ~1 fps thumbnails of that exact source id.
let capWin: BrowserWindow | null = null;
let capMode: 'media' | 'thumb' | null = null;
let capSourceId: string | null = null;
let lastThumbAt = 0;

/** THE verified game window or null: exact title, exactly one match, owned by StarCitizen.exe. */
async function findGameWindow(): Promise<{ sourceId: string } | null> {
  const sources = (await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 16, height: 9 }, fetchWindowIcons: false })) as unknown as CamSource[];
  const matches = matchingWindows(sources, makeTitleMatcher(getBodycamSettings().titlePattern));
  if (matches.length !== 1 || matches[0].thumbnail.isEmpty()) return null;
  const hwnd = hwndFromSourceId(matches[0].id);
  if (!hwnd || (await isGameWindow(hwnd)) !== 'yes') return null;
  return { sourceId: matches[0].id };
}

/** A hung or crashed capture renderer must not wedge the live loop: every executeJavaScript call is bounded. */
export const CAPTURE_JS_TIMEOUT_MS = 3000;
function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let t: NodeJS.Timeout;
  return Promise.race([p, new Promise<never>((_, rej) => (t = setTimeout(() => rej(new Error(`${what} timed out after ${ms} ms`)), ms)))]).finally(() => clearTimeout(t));
}

/** The opened window still exists and is not minimised (a minimised / closed window has no thumbnail or is not listed). */
async function windowAlive(sourceId: string): Promise<boolean> {
  const sources = (await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 16, height: 9 }, fetchWindowIcons: false })) as unknown as CamSource[];
  const s = sources.find((x) => x.id === sourceId);
  return !!s && !s.thumbnail.isEmpty();
}

function closeCapture(): void {
  capMode = null;
  capSourceId = null;
  if (capWin && !capWin.isDestroyed()) capWin.destroy(); // destroying the window ends the media stream
  capWin = null;
}

async function openCapture(sourceId: string, size: { width: number; height: number }, fps: number): Promise<void> {
  if (!/^window:\d+:\d+$/.test(sourceId)) throw new Error('bad source id');
  // Verify the window is the game IMMEDIATELY before capturing it (no cache).
  const hwnd = hwndFromSourceId(sourceId);
  if (!hwnd || (await isGameWindow(hwnd, { fresh: true })) !== 'yes') throw new Error('window is not the verified game window');
  closeCapture();
  capSourceId = sourceId;
  try {
    // Packaged app: the page lives in <app>/dist (inside app.asar), listed in REQUIRED_APP_FILES. A file: page is a secure context.
    const page = path.join(app.getAppPath(), 'dist', 'bodycam-live.html');
    const ses = session.fromPartition('bodycam-live');
    ses.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === 'media'));
    capWin = new BrowserWindow({ show: false, width: size.width, height: size.height, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, session: ses } });
    await capWin.loadFile(page);
    await withTimeout(capWin.webContents.executeJavaScript(`(async () => {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: ${JSON.stringify(sourceId)}, maxFrameRate: ${Math.round(fps)} } } });
      const v = document.createElement('video'); v.muted = true; v.srcObject = stream; await v.play();
      const c = document.createElement('canvas'); c.width = ${size.width}; c.height = ${size.height};
      window.__bc = { stream, v, c, ctx: c.getContext('2d'), ended: false };
      // The window closed / capture was revoked: never keep sending the last (frozen) frame.
      stream.getVideoTracks().forEach((t) => t.addEventListener('ended', () => { window.__bc.ended = true; }));
    })()`), CAPTURE_JS_TIMEOUT_MS, 'capture start');
    capMode = 'media';
  } catch (err) {
    logger.warn(MODULE_NAME, `Live getUserMedia capture unavailable (${(err as Error).message}); falling back to ~1 fps thumbnails`);
    if (capWin && !capWin.isDestroyed()) capWin.destroy();
    capWin = null;
    capMode = 'thumb';
  }
}

async function grabFrame(quality: number, size: { width: number; height: number }): Promise<{ jpeg: Buffer; blank: boolean } | null> {
  if (capMode === 'media' && capWin && !capWin.isDestroyed()) {
    const url: string | null = await withTimeout(capWin.webContents.executeJavaScript(
      `(() => { const b = window.__bc; if (!b) return null; if (b.ended) return 'ended'; const vw = b.v.videoWidth, vh = b.v.videoHeight; if (!vw || !vh) return null;
        // letterbox: keep the game's aspect ratio, black bars instead of stretching
        const k = Math.min(b.c.width / vw, b.c.height / vh), dw = Math.round(vw * k), dh = Math.round(vh * k);
        b.ctx.fillStyle = '#000'; b.ctx.fillRect(0, 0, b.c.width, b.c.height);
        b.ctx.drawImage(b.v, Math.round((b.c.width - dw) / 2), Math.round((b.c.height - dh) / 2), dw, dh);
        return b.c.toDataURL('image/jpeg', ${(quality / 100).toFixed(2)}); })()`,
    ), CAPTURE_JS_TIMEOUT_MS, 'capture frame');
    if (url === 'ended') throw new Error('capture ended (the game window closed)');
    if (!url || !url.startsWith('data:image/jpeg;base64,')) return null;
    const jpeg = Buffer.from(url.slice('data:image/jpeg;base64,'.length), 'base64');
    const img = nativeImage.createFromBuffer(jpeg);
    return { jpeg, blank: img.isEmpty() || isBlankBitmap(img.toBitmap()) };
  }
  if (capMode === 'thumb' && capSourceId) {
    if (Date.now() - lastThumbAt < 1000) return null; // enumerating windows is costly: cap the fallback at ~1 fps
    lastThumbAt = Date.now();
    const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: size, fetchWindowIcons: false });
    const src = sources.find((x) => x.id === capSourceId); // exact id of the verified window only
    if (!src || src.thumbnail.isEmpty()) return null;
    return { jpeg: src.thumbnail.toJPEG(quality), blank: isBlankBitmap(src.thumbnail.toBitmap()) };
  }
  return null;
}
let gameRunning = false;
let pollTimer: NodeJS.Timeout | null = null;
let lastStatus: BodycamStatus = { state: 'off', lastSentAt: null, framesSent: 0, lastBytes: null };

let detection: GameDetection | null = null;
let detecting = false;

function detectDeps(full = false) {
  return {
    full,
    telemetryStatus: () => (getTelemetryService() as any)?.status ?? null,
    gameLogMtimeMs: async () => {
      try {
        return (await fs.stat(getCurrentLogPath())).mtimeMs;
      } catch {
        return null;
      }
    },
  };
}

/** Never swallows: the last detection (incl. its error) is kept for the settings page and logged when it changes. */
async function pollGame(): Promise<void> {
  if (detecting) return;
  detecting = true;
  try {
    const prev = detection;
    detection = await detectGame(detectDeps());
    gameRunning = detection.running;
    if (detection.error && detection.error !== prev?.error) logger.warn(MODULE_NAME, `Game detection failed: ${detection.error}`);
    else if (!detection.error && prev?.error) logger.info(MODULE_NAME, `Game detection works again (${detection.via ?? 'game not running'})`);
    else if (detection.running !== !!prev?.running) logger.info(MODULE_NAME, detection.running ? `Star Citizen detected (via ${detection.via})` : 'Star Citizen no longer detected');
  } catch (err) {
    detection = { running: false, via: null, error: `detection crashed: ${(err as Error).message}`, launcherOnly: false, steps: [], checkedAt: Date.now() };
    gameRunning = false;
    logger.warn(MODULE_NAME, detection.error!);
  } finally {
    detecting = false;
  }
}

/** Diagnose button: every detection step once (incl. the PowerShell fallback) plus the window checks, each with its result. */
async function diagnose(): Promise<{ steps: DetectStep[]; summary: string }> {
  const d = await detectGame(detectDeps(true));
  const steps: DetectStep[] = [...d.steps];
  if (process.platform === 'win32') {
    try {
      const sources = (await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 16, height: 9 }, fetchWindowIcons: false })) as unknown as CamSource[];
      steps.push({ step: 'windows', ok: true, found: sources.length > 0, detail: `${sources.length} capturable windows listed (titles are not shown)` });
      const matches = matchingWindows(sources, makeTitleMatcher(getBodycamSettings().titlePattern));
      steps.push({ step: 'window title', ok: true, found: matches.length === 1, detail: matches.length === 0 ? 'no window is titled exactly "Star Citizen"' : matches.length === 1 ? 'exactly one window titled "Star Citizen"' : `${matches.length} windows are titled like the game (capturing nothing)` });
      if (matches.length === 1) {
        steps.push({ step: 'window thumbnail', ok: true, found: !matches[0].thumbnail.isEmpty(), detail: matches[0].thumbnail.isEmpty() ? 'the window has no thumbnail (minimised?)' : 'window has a thumbnail' });
        const hwnd = hwndFromSourceId(matches[0].id);
        if (!hwnd) steps.push({ step: 'window handle', ok: false, found: false, detail: 'could not read the window handle from the capture source id' });
        else {
          const v = await isGameWindow(hwnd, { fresh: true });
          steps.push({ step: 'window owner', ok: v !== 'unknown', found: v === 'yes', detail: v === 'yes' ? 'the window belongs to StarCitizen.exe' : v === 'no' ? 'the window is NOT owned by StarCitizen.exe (capturing nothing)' : 'the ownership check could not run (PowerShell failed or timed out)' });
        }
      }
    } catch (err) {
      steps.push({ step: 'windows', ok: false, found: false, detail: `could not list windows: ${(err as Error).message}` });
    }
  }
  const failing = steps.find((s) => !s.ok || !s.found);
  return { steps, summary: d.running ? (failing ? `Game detected; problem: ${failing.step} - ${failing.detail}` : 'Everything checks out') : detectionMessage(d) ?? 'Star Citizen was not detected as running' };
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
  if (s.enabled && s.orgs.length) {
    const ack = await emitAck<{ ok?: boolean; live?: LiveParams | null }>('bodycam_config', { orgs: s.orgs, allowLive: s.allowLive });
    // A viewer may already be watching (e.g. after a reconnect): the server includes the live params.
    if (ack?.ok && ack.live) live?.start(ack.live);
  } else {
    live?.stop('sharing off');
    await emitAck('bodycam_stop');
  }
}

function applyRunState(): void {
  const s = getBodycamSettings();
  sharer?.resume();
  if (s.enabled && s.orgs.length) {
    sharer?.start();
    // Always-visible indicator while screenshots are being shared (tray tooltip + menu entry).
    refreshBanner();
  } else {
    sharer?.stop();
    setBodycamTrayState(null);
  }
  if (!(s.enabled && s.allowLive && s.orgs.length)) live?.stop('live view off');
}

/** Tray text: screenshots, or LIVE with the viewer count while a live stream is running. */
function refreshBanner(): void {
  const s = getBodycamSettings();
  if (!(s.enabled && s.orgs.length)) return;
  const text = liveStatus.state === 'live' || (live?.active && liveStatus.viewers > 0)
    ? `LIVE - being watched by ${liveStatus.viewers}`
    : `Sharing game screenshots with ${s.orgs.join(', ')}`;
  const isLive = liveStatus.state === 'live' || (!!live?.active && liveStatus.viewers > 0);
  setBodycamTrayState({ text, onStop: () => void stopSharing(), live: isLive });
}

/** Switch sharing off (tray "Stop", notification action, settings). The server deletes the frame immediately. */
export async function stopSharing(): Promise<void> {
  saveBodycamSettings({ enabled: false, allowLive: false });
  live?.stop('stopped');
  applyRunState();
  await syncServer();
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send('bodycam:settings-changed');
}

/** One-time notice when sharing resumes on its own at app launch. */
function announceAutoResume(): void {
  const s = getBodycamSettings();
  if (!(s.enabled && s.orgs.length)) return;
  const body = `VOIDLOG is sharing small screenshots of your Star Citizen window with ${s.orgs.join(', ')} while the game runs${s.allowLive ? ', and org members may open a live view' : ''}. Click to open settings.`;
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

/** Toast when somebody starts watching the live view (viewers 0 -> N). */
function announceViewer(): void {
  const tags = getBodycamSettings().orgs.join(', ');
  try {
    if (Notification.isSupported()) new Notification({ title: 'Live view is being watched', body: `Someone is watching your game view (${tags}).`, silent: false }).show();
  } catch (err) {
    logger.warn(MODULE_NAME, `Could not show the live-view notice: ${(err as Error).message}`);
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
    gameDetail: () => detectionMessage(detection),
    // The title alone is not enough: the window must belong to StarCitizen.exe (fails closed).
    isGameWindow: async (hwnd) => {
      const v = await isGameWindow(hwnd);
      return v === 'yes' ? true : v === 'no' ? false : 'unknown';
    },
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
  live = new LiveSharer({
    getSettings: () => {
      const g = getBodycamSettings();
      return { enabled: g.enabled, allowLive: g.allowLive, orgs: g.orgs };
    },
    isGameRunning: () => gameRunning,
    isOnline,
    findWindow: findGameWindow,
    windowAlive,
    openCapture,
    grab: grabFrame,
    closeCapture,
    send: (jpeg) => getServerLink().send('submit_bodycam_live', { frame: jpeg }),
    onStatus: (st) => {
      const before = liveStatus.viewers;
      liveStatus = st;
      if (before === 0 && st.viewers > 0) announceViewer();
      refreshBanner();
      for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send('bodycam:live-status', st);
    },
    log: (lvl, msg) => logger[lvl === 'debug' ? 'debug' : lvl](MODULE_NAME, msg),
  });
  // Server tells us when someone starts/stops watching (and re-sends start every 20 s as a keepalive).
  getServerLink().onServer('bodycam_live_start', (p: any) => {
    const n = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
    live?.start({ fps: n(p?.fps, 5), width: Math.min(640, Math.max(64, n(p?.width, 480))), height: Math.min(360, Math.max(36, n(p?.height, 270))), maxFrameBytes: n(p?.maxFrameBytes, 10_000), maxKbps: n(p?.maxKbps, 400), viewers: n(p?.viewers, 1) });
  });
  getServerLink().onServer('bodycam_live_stop', () => live?.stop('stopped', { soft: true })); // keeps the hidden capture warm for 10 s
  getServerLink().onServer('bodycam_live_rejected', (p: any) => live?.noteServerRejection(String(p?.reason ?? 'unknown').slice(0, 200)));
  getServerLink().on('unauthenticated', () => live?.stop('disconnected'));
  void pollGame();
  pollTimer = setInterval(() => void pollGame(), PROCESS_POLL_MS);
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
  live?.stop('shutdown');
  setBodycamTrayState(null);
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
  // Deliberately keep the opt-in; the frame expires on the server within 120 s.
}

export function registerBodycamIpc(): void {
  ipcMain.handle('bodycam:get', async (e) => {
    assertSettingsSender(e);
    const server = isOnline() ? await emitAck('bodycam_get') : undefined;
    return { settings: publicSettings(), status: lastStatus, live: liveStatus, verifyProblem: lastStatus.detail === VERIFY_FAILED_MESSAGE, gameRunning, gameDetection: detection ? { running: detection.running, via: detection.via, error: detection.error, launcherOnly: detection.launcherOnly, checkedAt: detection.checkedAt } : null, online: isOnline(), server: server ?? null };
  });
  ipcMain.handle('bodycam:diagnose', async (e) => {
    assertSettingsSender(e);
    return diagnose();
  });
  ipcMain.handle('bodycam:set-settings', async (e, patch: Partial<BodycamSettings>) => {
    assertSettingsSender(e);
    const next = saveBodycamSettings(patch ?? {});
    applyRunState();
    await syncServer();
    return { settings: next, status: lastStatus };
  });
}
