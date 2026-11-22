/**
 * In-game party / org overlay window (OVERLAY-SPEC.md).
 *
 * Separate from the debug overlay: a transparent, frameless, non-focusable, click-through,
 * always-on-top window on the RIGHT edge of the primary display. Nothing is injected into the game;
 * it shows in Borderless / Windowed mode only. Shown while StarCitizen.exe runs (shared process poll
 * in telemetry/overlay-window.ts) and the feature is on; the hotkey (default Ctrl+Alt+P) hides/shows
 * it. The window is only as tall as its content (the renderer reports its height).
 *
 * Data: PartyOverlayFeed (socket subscription), pushed at most 4 Hz; nothing is sent while hidden.
 */
import { app, BrowserWindow, globalShortcut, ipcMain, screen } from 'electron';
import path from 'node:path';
import * as logger from '../logger';
import { getPreloadPath } from '../window-manager';
import { getPartyOverlaySettings, getTelemetrySettings, setPartyOverlaySettings } from '../config-manager';
import { getAuthStatus } from '../auth-manager';
import { getServerLink } from '../server-connection';
import { isGameRunning, onGamePoll, syncOverlayFeature } from '../telemetry/overlay-window';
import { PartyOverlayFeed, type PartyOverlayState } from './party-overlay-feed';
import { partyOverlayBounds, pickDisplay, type PartyOverlaySettings } from './party-overlay-settings';
import { WAITING_CARD_MS } from '../../../shared/overlay/overlay-sections';

const MODULE_NAME = 'PartyOverlay';
const MIN_HEIGHT = 60;

let win: BrowserWindow | null = null;
let feed: PartyOverlayFeed | null = null;
let hiddenByHotkey = false;
let registeredHotkey: string | null = null;
let registeredSwitchHotkey: string | null = null;
let contentHeight = 0;
let lastState: PartyOverlayState | null = null;
let displayListener = false;
/** When the game was last seen starting (for the overlay's "Waiting for Star Citizen" card). */
let gameSeenAt: number | null = null;


function bounds() {
  const s = getPartyOverlaySettings();
  const display = pickDisplay(screen.getAllDisplays(), screen.getPrimaryDisplay(), s.partyOverlayDisplayId);
  const b = partyOverlayBounds(display.bounds, s);
  // Shrink to the content (transparent area costs compositing too), never beyond the screen.
  if (contentHeight > 0) b.height = Math.max(MIN_HEIGHT, Math.min(b.height, Math.ceil(contentHeight * s.partyOverlayScale) + 2));
  return b;
}

function createWindow(): BrowserWindow {
  const w = new BrowserWindow({
    ...bounds(),
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
    title: 'VOIDLOG.GG Party Overlay',
    webPreferences: {
      preload: getPreloadPath('party-overlay-preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
    },
  });
  w.setAlwaysOnTop(true, 'screen-saver');
  w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  w.setIgnoreMouseEvents(true, { forward: false });
  const devServerUrl = process.env['VITE_DEV_SERVER_URL'];
  const load = devServerUrl ? w.loadURL(`${devServerUrl}/party-overlay.html`) : w.loadFile(path.join(app.getAppPath(), 'dist', 'party-overlay.html'));
  load.catch((err) => logger.error(MODULE_NAME, `Failed to load party-overlay.html: ${err}`));
  w.webContents.on('did-finish-load', () => lastState && send(lastState));
  w.on('closed', () => {
    win = null;
  });
  return w;
}

function send(state: PartyOverlayState): void {
  if (!win || win.isDestroyed() || !win.isVisible()) return;
  const s = getPartyOverlaySettings();
  try {
    win.webContents.send('party-overlay-state', { ...state, compact: s.partyOverlayCompact, scale: s.partyOverlayScale, gameSinceMs: gameSeenAt === null ? null : Date.now() - gameSeenAt });
  } catch (err) {
    logger.debug(MODULE_NAME, `push failed: ${err}`);
  }
}

/** Show/hide according to settings + game state. */
export function refreshPartyOverlay(): void {
  const s = getPartyOverlaySettings();
  const alwaysShow = getTelemetrySettings().overlayAlwaysShow; // the debug overlay's "show without the game" testing switch
  const running = isGameRunning();
  if (running && gameSeenAt === null) {
    gameSeenAt = Date.now();
    // re-send after the waiting window so the card goes away even when nothing else changes
    setTimeout(() => lastState && send(lastState), WAITING_CARD_MS + 500).unref?.();
  } else if (!running) gameSeenAt = null;
  const shouldShow = s.partyOverlayEnabled && !hiddenByHotkey && (running || alwaysShow);
  if (shouldShow) {
    if (!win || win.isDestroyed()) win = createWindow();
    win.setBounds(bounds());
    if (!win.isVisible()) {
      win.showInactive();
      win.setAlwaysOnTop(true, 'screen-saver');
      if (lastState) send(lastState);
    }
  } else if (win && !win.isDestroyed() && win.isVisible()) {
    win.hide();
  }
}

export function togglePartyOverlay(): boolean {
  if (!getPartyOverlaySettings().partyOverlayEnabled) return false;
  hiddenByHotkey = !hiddenByHotkey;
  refreshPartyOverlay();
  return !hiddenByHotkey;
}

/** Switch hotkey: Party <-> Org, remembered in settings (the overlay itself is click-through). */
export function switchPartyOverlaySource(): PartyOverlaySettings {
  const s = getPartyOverlaySettings();
  return applyPartyOverlaySettings({ partyOverlaySource: s.partyOverlaySource === 'org' ? 'party' : 'org' });
}

function syncSwitchHotkey(s: PartyOverlaySettings): void {
  const want = s.partyOverlayEnabled ? s.partyOverlaySwitchHotkey : '';
  if (registeredSwitchHotkey === want) return;
  if (registeredSwitchHotkey) globalShortcut.unregister(registeredSwitchHotkey);
  registeredSwitchHotkey = null;
  if (!want) return;
  try {
    if (globalShortcut.register(want, () => switchPartyOverlaySource())) registeredSwitchHotkey = want;
    else logger.warn(MODULE_NAME, `Party/Org switch hotkey ${want} is in use by another app`);
  } catch (err) {
    logger.warn(MODULE_NAME, `Invalid party/org switch hotkey ${want}: ${err}`);
  }
}

function syncHotkey(s: PartyOverlaySettings): void {
  const want = s.partyOverlayEnabled ? s.partyOverlayHotkey : '';
  if (registeredHotkey === want) return;
  if (registeredHotkey) globalShortcut.unregister(registeredHotkey);
  registeredHotkey = null;
  if (!want) return;
  try {
    if (globalShortcut.register(want, () => togglePartyOverlay())) registeredHotkey = want;
    else logger.warn(MODULE_NAME, `Party overlay hotkey ${want} is in use by another app`);
  } catch (err) {
    logger.warn(MODULE_NAME, `Invalid party overlay hotkey ${want}: ${err}`);
  }
}

/** Apply settings: hotkey, subscription, process poll, visibility. Safe to call repeatedly. */
export function syncPartyOverlay(): void {
  const s = getPartyOverlaySettings();
  syncHotkey(s);
  syncSwitchHotkey(s);
  if (!s.partyOverlayEnabled) hiddenByHotkey = false;
  if (feed) {
    if (s.partyOverlayEnabled) feed.resubscribe();
    else if (feed.current.status !== 'off') feed.unsubscribe();
  }
  syncOverlayFeature(); // starts / stops the shared StarCitizen.exe poll
  refreshPartyOverlay();
}

export function getPartyOverlayFeed(): PartyOverlayFeed | null {
  return feed;
}

export function initPartyOverlay(): void {
  if (!feed) {
    const link = getServerLink();
    feed = new PartyOverlayFeed({
      link,
      getSettings: getPartyOverlaySettings,
      isSignedIn: () => getAuthStatus().isAuthenticated,
      push: (state) => {
        lastState = state;
        send(state);
      },
      log: (level, msg) => logger[level](MODULE_NAME, msg),
    });
    onGamePoll(() => refreshPartyOverlay());
    ipcMain.on('party-overlay:content-height', (e, h: unknown) => {
      if (!win || e.sender !== win.webContents || typeof h !== 'number' || !Number.isFinite(h)) return;
      const next = Math.round(h);
      if (Math.abs(next - contentHeight) < 2) return;
      contentHeight = next;
      if (!win.isDestroyed()) win.setBounds(bounds());
    });
  }
  if (!displayListener) {
    displayListener = true;
    const rebound = () => win && !win.isDestroyed() && win.setBounds(bounds());
    screen.on('display-metrics-changed', rebound);
    screen.on('display-added', rebound);
    screen.on('display-removed', rebound);
  }
  syncPartyOverlay();
}

export function applyPartyOverlaySettings(patch: Partial<PartyOverlaySettings>): PartyOverlaySettings {
  const s = setPartyOverlaySettings(patch);
  syncPartyOverlay();
  return s;
}

/** Displays for the settings picker. */
export function listPartyOverlayDisplays() {
  const primary = screen.getPrimaryDisplay();
  return screen.getAllDisplays().map((d, i) => ({ id: d.id, label: d.label || `Display ${i + 1}`, width: d.bounds.width, height: d.bounds.height, primary: d.id === primary.id }));
}

export function destroyPartyOverlay(): void {
  if (registeredHotkey) globalShortcut.unregister(registeredHotkey);
  registeredHotkey = null;
  if (registeredSwitchHotkey) globalShortcut.unregister(registeredSwitchHotkey);
  registeredSwitchHotkey = null;
  if (win && !win.isDestroyed()) win.destroy();
  win = null;
}
