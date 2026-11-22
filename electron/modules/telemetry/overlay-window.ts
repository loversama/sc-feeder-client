/**
 * In-game debug overlay.
 *
 * A separate transparent, frameless, non-focusable, click-through, always-on-top window anchored to
 * the bottom-right of the display. Nothing is injected into StarCitizen.exe (no hooking, no memory
 * access), so it is anti-cheat safe — but it is only visible when the game runs in Borderless or
 * Windowed mode, not exclusive Fullscreen.
 *
 * Off by default. When the setting is on: StarCitizen.exe is polled every 5 s and the panel shows
 * while the game runs (or always, with "always show"); the hotkey (default Ctrl+Alt+O) hides/shows
 * it. When the setting is off there is no hotkey grab and no process polling.
 */
import { BrowserWindow, globalShortcut, screen } from 'electron';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as logger from '../logger';
import { getPreloadPath } from '../window-manager';
import { getTelemetrySettings, getPartyOverlaySettings } from '../config-manager';
import { getOverlayState } from './telemetry-manager';
import { pushDebugEvent } from './debug-bus';

const MODULE_NAME = 'Overlay';
const WIDTH = 460;
const HEIGHT = 820;
const MARGIN = 12;
const PUSH_MS = 250;
const PROCESS_POLL_MS = 5000;
const GAME_EXE = 'StarCitizen.exe';

let overlay: BrowserWindow | null = null;
let pushTimer: NodeJS.Timeout | null = null;
let pollTimer: NodeJS.Timeout | null = null;
let gameRunning = false;
let registeredHotkey: string | null = null;
/** Runtime hide via hotkey (not persisted). */
let hiddenByHotkey = false;
let displayListener = false;

const thisDir = path.dirname(fileURLToPath(import.meta.url));

export function isGameRunning(): boolean {
  return gameRunning;
}

/** Other overlays (party overlay) follow the same StarCitizen.exe poll. */
const gameStateListeners: Array<(running: boolean) => void> = [];
export function onGamePoll(fn: (running: boolean) => void): void {
  gameStateListeners.push(fn);
}

/** Poll the game process while either overlay is enabled. */
function pollWanted(): boolean {
  return getTelemetrySettings().overlayEnabled || getPartyOverlaySettings().partyOverlayEnabled;
}

/** Windows: is StarCitizen.exe running? (tasklist, no extra deps) */
function checkGameProcess(): Promise<boolean> {
  if (process.platform !== 'win32') return Promise.resolve(false);
  return new Promise((resolve) => {
    execFile('tasklist', ['/FI', `IMAGENAME eq ${GAME_EXE}`, '/FO', 'CSV', '/NH'], { windowsHide: true, timeout: 4000 }, (err, stdout) => {
      if (err) return resolve(false);
      resolve(stdout.toLowerCase().includes(GAME_EXE.toLowerCase()));
    });
  });
}

function overlayBounds() {
  const display = screen.getPrimaryDisplay();
  // Full display bounds (not workArea): the game covers the taskbar in borderless mode.
  const b = display.bounds;
  const height = Math.min(HEIGHT, b.height - MARGIN * 2);
  return { x: b.x + b.width - WIDTH - MARGIN, y: b.y + b.height - height - MARGIN, width: WIDTH, height };
}

function createOverlay(): BrowserWindow {
  const win = new BrowserWindow({
    ...overlayBounds(),
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    focusable: false,
    skipTaskbar: true,
    hasShadow: false,
    alwaysOnTop: true,
    title: 'VOIDLOG.GG Overlay',
    webPreferences: {
      preload: getPreloadPath('overlay-preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
    },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setIgnoreMouseEvents(true, { forward: false });
  win.setContentProtection(false);

  const devServerUrl = process.env['VITE_DEV_SERVER_URL'];
  const load = devServerUrl ? win.loadURL(`${devServerUrl}/overlay.html`) : win.loadFile(path.join(thisDir, '..', 'dist', 'overlay.html'));
  load.catch((err) => logger.error(MODULE_NAME, `Failed to load overlay.html: ${err}`));
  win.on('closed', () => {
    overlay = null;
    stopPush();
  });
  return win;
}

function startPush(): void {
  if (pushTimer) return;
  pushTimer = setInterval(() => {
    if (!overlay || overlay.isDestroyed() || !overlay.isVisible()) return;
    try {
      overlay.webContents.send('overlay-state', { ...getOverlayState(), gameRunning, hotkey: registeredHotkey });
    } catch (err) {
      logger.debug(MODULE_NAME, `overlay push failed: ${err}`);
    }
  }, PUSH_MS);
}

function stopPush(): void {
  if (pushTimer) clearInterval(pushTimer);
  pushTimer = null;
}

/** Show/hide according to settings + game state. */
export function refreshOverlay(): void {
  const s = getTelemetrySettings();
  const shouldShow = s.overlayEnabled && !hiddenByHotkey && (gameRunning || s.overlayAlwaysShow);
  if (shouldShow) {
    if (!overlay || overlay.isDestroyed()) overlay = createOverlay();
    overlay.setBounds(overlayBounds());
    if (!overlay.isVisible()) {
      overlay.showInactive();
      overlay.setAlwaysOnTop(true, 'screen-saver');
    }
    startPush();
  } else if (overlay && !overlay.isDestroyed() && overlay.isVisible()) {
    overlay.hide();
    stopPush();
  }
}

/** Hotkey / IPC: hide or show the overlay while the feature is enabled. Returns visible-intent. */
export function toggleOverlay(): boolean {
  if (!getTelemetrySettings().overlayEnabled) return false;
  hiddenByHotkey = !hiddenByHotkey;
  pushDebugEvent({ source: 'system', type: 'overlay', summary: `Overlay ${hiddenByHotkey ? 'hidden' : 'shown'}` });
  refreshOverlay();
  return !hiddenByHotkey;
}

export function registerOverlayHotkey(): void {
  const key = getTelemetrySettings().overlayHotkey;
  if (registeredHotkey) {
    globalShortcut.unregister(registeredHotkey);
    registeredHotkey = null;
  }
  if (!key) return;
  try {
    if (globalShortcut.register(key, () => toggleOverlay())) {
      registeredHotkey = key;
      logger.info(MODULE_NAME, `Overlay hotkey registered: ${key}`);
    } else {
      logger.warn(MODULE_NAME, `Overlay hotkey ${key} is in use by another app`);
    }
  } catch (err) {
    logger.warn(MODULE_NAME, `Invalid overlay hotkey ${key}: ${err}`);
  }
}

async function poll(): Promise<void> {
  const running = await checkGameProcess();
  if (running !== gameRunning) {
    gameRunning = running;
    logger.info(MODULE_NAME, `${GAME_EXE} ${running ? 'detected' : 'exited'}`);
    pushDebugEvent({ source: 'system', type: running ? 'game_started' : 'game_exited', summary: `${GAME_EXE} ${running ? 'running' : 'exited'}` });
  }
  refreshOverlay();
  for (const fn of gameStateListeners) {
    try {
      fn(gameRunning);
    } catch (err) {
      logger.debug(MODULE_NAME, `game poll listener failed: ${err}`);
    }
  }
}

/** Apply the overlay setting: start/stop process polling and the hotkey. Safe to call repeatedly. */
export function syncOverlayFeature(): void {
  const s = getTelemetrySettings();
  if (s.overlayEnabled) {
    if (registeredHotkey !== s.overlayHotkey) registerOverlayHotkey();
  } else {
    if (registeredHotkey) globalShortcut.unregister(registeredHotkey);
    registeredHotkey = null;
    hiddenByHotkey = false;
  }
  if (pollWanted()) {
    if (!pollTimer) {
      void poll();
      pollTimer = setInterval(poll, PROCESS_POLL_MS);
    }
  } else {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
    gameRunning = false;
  }
  refreshOverlay();
}

export function initOverlay(): void {
  syncOverlayFeature();
  if (!displayListener) {
    displayListener = true;
    screen.on('display-metrics-changed', () => overlay && !overlay.isDestroyed() && overlay.setBounds(overlayBounds()));
  }
}

export function destroyOverlay(): void {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
  stopPush();
  if (registeredHotkey) globalShortcut.unregister(registeredHotkey);
  registeredHotkey = null;
  if (overlay && !overlay.isDestroyed()) overlay.destroy();
  overlay = null;
}
