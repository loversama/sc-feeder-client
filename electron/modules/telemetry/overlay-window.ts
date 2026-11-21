/**
 * In-game debug overlay.
 *
 * A separate transparent, frameless, non-focusable, click-through, always-on-top window anchored to
 * the bottom-right of the display. Nothing is injected into StarCitizen.exe (no hooking, no memory
 * access), so it is anti-cheat safe — but it is only visible when the game runs in Borderless or
 * Windowed mode, not exclusive Fullscreen.
 *
 * Shown while overlay is enabled AND StarCitizen.exe is running (or "always show" is on).
 * Toggle with the overlay hotkey (default Ctrl+Alt+O).
 */
import { BrowserWindow, globalShortcut, screen } from 'electron';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as logger from '../logger';
import { getPreloadPath } from '../window-manager';
import { getTelemetrySettings } from '../config-manager';
import { applyTelemetrySettings, getOverlayState } from './telemetry-manager';
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

const thisDir = path.dirname(fileURLToPath(import.meta.url));

export function isGameRunning(): boolean {
  return gameRunning;
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
  const shouldShow = s.overlayEnabled && (gameRunning || s.overlayAlwaysShow);
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

export function toggleOverlay(): boolean {
  const enabled = !getTelemetrySettings().overlayEnabled;
  applyTelemetrySettings({ overlayEnabled: enabled });
  pushDebugEvent({ source: 'system', type: 'overlay', summary: `Overlay ${enabled ? 'enabled' : 'disabled'}` });
  refreshOverlay();
  return enabled;
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

export function initOverlay(): void {
  registerOverlayHotkey();
  const poll = async () => {
    const running = await checkGameProcess();
    if (running !== gameRunning) {
      gameRunning = running;
      logger.info(MODULE_NAME, `${GAME_EXE} ${running ? 'detected' : 'exited'}`);
      pushDebugEvent({ source: 'system', type: running ? 'game_started' : 'game_exited', summary: `${GAME_EXE} ${running ? 'running' : 'exited'}` });
    }
    refreshOverlay();
  };
  poll();
  pollTimer = setInterval(poll, PROCESS_POLL_MS);
  screen.on('display-metrics-changed', () => overlay && !overlay.isDestroyed() && overlay.setBounds(overlayBounds()));
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
