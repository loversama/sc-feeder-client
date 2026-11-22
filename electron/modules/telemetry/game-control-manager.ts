/**
 * Electron glue for local game control (see game-control.ts for the rules).
 *
 *   Controls page ──IPC (app windows only)──▶ GameControl ──gRPC──▶ 127.0.0.1:2942 TriggerGameAction
 *   globalShortcut (only while enabled + game streaming) ──▶ GameControl (non-dangerous actions only)
 *
 * Nothing here talks to VOIDLOG.GG: no remote triggering in this release.
 */
import { app, dialog, ipcMain, globalShortcut, type IpcMainInvokeEvent } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as logger from '../logger';
import { getGameControlSettings, setGameControlSettings, getTelemetrySettings, getGameRoot, getStoredLogPath, DEFAULT_LOG_FILE_PATH } from '../config-manager';
import { getChannelTracker, selectGameRoot } from '../channel-manager';
import { discoverChannels } from '../game-channels';
import { applyGameRootChange } from '../log-watcher';
import { resolveCfgTargets, redeemCfgGrant, CFG_PREVIEW_TTL_MS, type CfgPreviewGrant } from './user-cfg';
import { getMainWindow, getSettingsWindow } from '../window-manager';
import { GameControl, loopbackControlAddress, type ControlClient } from './game-control';
import { ACTION_NAME_RE } from './game-control-catalog';
import { randomBytes } from 'node:crypto';
import { HotkeyBinder } from './game-control-hotkeys';
import { dangerInfo } from './game-control-catalog';
import { isTrustedControlSender } from './game-control-security';
import { TelemetryClient } from './telemetry-client';
import { getTelemetryService, getUserCfgStatus, enableKeyInCfgFiles, readUserCfgStatus, TRIGGER_CFG_KEY } from './telemetry-manager';

const MODULE_NAME = 'GameControl';
const EVENT_CHANNEL = 'game-control:event';

let control: GameControl | null = null;
let hotkeys: HotkeyBinder | null = null;
let client: TelemetryClient | null = null;
let triggerCfgEnabled: boolean | null = null;
/** Last preview shown to the player: its files are the only ones "Write" may touch, with its one-time token. */
let previewGrant: CfgPreviewGrant | null = null;

async function userCfgPreview() {
  const r = await resolveCfgTargets({
    trackerChannels: getChannelTracker()?.channels ?? [],
    gameRoot: getGameRoot(),
    logPath: getStoredLogPath(),
    defaultLogPath: DEFAULT_LOG_FILE_PATH,
    discover: discoverChannels,
  });
  previewGrant = { token: randomBytes(16).toString('hex'), targets: r.targets, expiresAt: Date.now() + CFG_PREVIEW_TTL_MS };
  const token = previewGrant.token;
  const files = await Promise.all(
    r.targets.map(async (t) => {
      const st = await readUserCfgStatus(t.path);
      return { channel: t.channel, path: t.path, exists: st.exists, alreadyEnabled: st.triggerEnabled };
    }),
  );
  return { line: `${TRIGGER_CFG_KEY}=1`, root: r.root, source: r.source, files, token };
}


function getClient(): ControlClient {
  // Pinned to loopback: never trigger actions on another machine, whatever Game.log says.
  const address = loopbackControlAddress(getTelemetryService()?.address);
  if (!client || client.address !== address) {
    client?.close();
    client = new TelemetryClient(address);
  }
  return client;
}

function gameStatus(): string {
  return getTelemetryService()?.status ?? 'disabled';
}
const isLive = (s: string) => s === 'streaming' || s === 'connected';

function snapshot() {
  const s = getGameControlSettings();
  const c = control!;
  return {
    ...c.state(),
    gameStatus: gameStatus(),
    favourites: s.favourites,
    hotkeys: hotkeys?.status() ?? [],
    hotkeysActive: !!hotkeys?.active,
    triggerCfgEnabled,
  };
}

function broadcast(event: unknown): void {
  for (const w of [getMainWindow(), getSettingsWindow()]) {
    if (w && !w.isDestroyed()) w.webContents.send(EVENT_CHANNEL, event);
  }
}
const broadcastState = () => control && broadcast({ type: 'state', state: snapshot() });

/** Hotkeys are registered only while game control is on and the game is reachable. */
function syncHotkeys(): void {
  if (!hotkeys) return;
  const want = getGameControlSettings().enabled && isLive(gameStatus());
  if (want) hotkeys.activate();
  else if (hotkeys.active) hotkeys.deactivate();
}

async function refreshCfgStatus(): Promise<void> {
  try {
    triggerCfgEnabled = (await getUserCfgStatus()).triggerEnabled;
  } catch {
    triggerCfgEnabled = null;
  }
}

function isTrusted(e: IpcMainInvokeEvent): boolean {
  const trusted = [getMainWindow(), getSettingsWindow()].filter((w) => w && !w.isDestroyed()).map((w) => w!.webContents.id);
  const frame = e.senderFrame;
  return isTrustedControlSender(
    { webContentsId: e.sender.id, frameUrl: frame?.url, isMainFrame: !!frame && frame.parent === null },
    {
      trustedWebContentsIds: trusted,
      // Renderer pages live in <app>/dist (app.asar/dist when packaged), same as window-manager loads them.
      appFileRoot: pathToFileURL(path.join(app.getAppPath(), 'dist')).href + '/',
      devServerUrl: process.env['VITE_DEV_SERVER_URL'] || null,
    },
  );
}

function handle(channel: string, fn: (...args: any[]) => unknown): void {
  ipcMain.handle(channel, (e, ...args) => {
    if (!isTrusted(e)) {
      logger.warn(MODULE_NAME, `Rejected ${channel} from untrusted sender (${e.senderFrame?.url ?? 'unknown frame'})`);
      throw new Error('Game control is only available in the VOIDLOG.GG app window');
    }
    return fn(...args);
  });
}

export function initGameControl(): void {
  if (control) return;
  control = new GameControl({
    getClient,
    isEnabled: () => getGameControlSettings().enabled,
    log: (lvl, msg) => logger[lvl === 'debug' ? 'debug' : lvl](MODULE_NAME, msg),
  });
  hotkeys = new HotkeyBinder({
    api: globalShortcut,
    reserved: () => [getTelemetrySettings().overlayHotkey].filter(Boolean),
    isDangerous: (n) => control!.getAction(n)?.dangerous ?? dangerInfo(n).dangerous,
    isKnown: (n) => !control!.state().loaded || !!control!.getAction(n),
    onFire: (n) => void control!.trigger(n, { source: 'hotkey' }),
  });
  hotkeys.setBindings(getGameControlSettings().hotkeys);

  control.on('result', (result) => broadcast({ type: 'result', result }));
  control.on('actions', () => {
    syncHotkeys(); // re-validate bindings against the new list
    broadcastState();
  });

  const service = getTelemetryService();
  service?.on('status', (s: string, prev: string) => {
    if (isLive(s) && !isLive(prev)) {
      // New game session: reload the action list (it can change per patch / build).
      void refreshCfgStatus();
      void control!.refresh();
    } else if (!isLive(s) && isLive(prev)) {
      control!.invalidate();
    }
    syncHotkeys();
    broadcastState();
  });
  void refreshCfgStatus().then(broadcastState);
  if (isLive(gameStatus())) void control.refresh();
  syncHotkeys();

  handle('game-control:get-state', async () => {
    await refreshCfgStatus();
    return snapshot();
  });
  handle('game-control:set-enabled', (enabled: unknown) => {
    setGameControlSettings({ enabled: enabled === true });
    logger.info(MODULE_NAME, `Game control ${enabled === true ? 'enabled' : 'disabled'} by the player`);
    syncHotkeys();
    if (enabled === true && isLive(gameStatus()) && !control!.state().loaded) void control!.refresh();
    broadcastState();
    return snapshot();
  });
  handle('game-control:refresh', async () => {
    await control!.refresh();
    return snapshot();
  });
  handle('game-control:trigger', (name: unknown, opts: unknown) => {
    const o = (opts && typeof opts === 'object' ? opts : {}) as { holdMs?: unknown; confirmToken?: unknown };
    return control!.trigger(String(name), {
      holdMs: typeof o.holdMs === 'number' ? o.holdMs : undefined,
      confirmToken: typeof o.confirmToken === 'string' ? o.confirmToken : undefined,
      source: 'ui',
    });
  });
  handle('game-control:arm', (name: unknown) => control!.arm(String(name)));
  handle('game-control:disarm', (token: unknown) => control!.disarm(String(token)));
  handle('game-control:set-favourites', (names: unknown) => {
    setGameControlSettings({ favourites: Array.isArray(names) ? names : [] });
    return snapshot();
  });
  handle('game-control:check-hotkey', (action: unknown, accel: unknown) => hotkeys!.check(String(action), String(accel)));
  handle('game-control:set-hotkey', (action: unknown, accel: unknown) => {
    const name = String(action);
    if (!ACTION_NAME_RE.test(name)) return { state: snapshot(), problem: 'invalid' };
    if (accel != null && (typeof accel !== 'string' || accel.length > 64)) return { state: snapshot(), problem: 'invalid' };
    const next = { ...hotkeys!.bindings };
    let problem: string | null = null;
    if (typeof accel === 'string' && accel.trim()) {
      problem = hotkeys!.check(name, accel);
      if (problem) return { state: snapshot(), problem };
      next[name] = accel;
    } else delete next[name];
    hotkeys!.setBindings(next);
    setGameControlSettings({ hotkeys: hotkeys!.bindings });
    const st = hotkeys!.status().find((h) => h.action === name);
    problem = st?.problem ?? null; // e.g. 'in-use' only known after registering
    broadcastState();
    return { state: snapshot(), problem };
  });
  /** Exactly what "Write to user.cfg" would change, from the player's configured install. */
  handle('game-control:user-cfg-preview', () => userCfgPreview());
  /** Let the player pick their Star Citizen folder (same as Settings → channels), then re-preview. */
  handle('game-control:select-game-root', async () => {
    const r = await dialog.showOpenDialog({ title: 'Select your Star Citizen folder (the one containing LIVE, PTU, ...)', defaultPath: getGameRoot() || undefined, properties: ['openDirectory'] });
    if (r.canceled || !r.filePaths[0]) return { ok: false, canceled: true, preview: await userCfgPreview() };
    const res = await selectGameRoot(r.filePaths[0]);
    if (res.ok) await applyGameRootChange();
    return { ok: res.ok, error: res.error, preview: await userCfgPreview() };
  });
  // Only ever called from the confirm dialog's button (explicit player click); backs up each file first.
  handle('game-control:enable-user-cfg', async (token: unknown) => {
    try {
      const grant = redeemCfgGrant(previewGrant, token, Date.now());
      if (!grant.ok) return { ok: false, error: grant.error };
      previewGrant = null; // single use
      const r = await enableKeyInCfgFiles(grant.targets, TRIGGER_CFG_KEY);
      await refreshCfgStatus();
      broadcastState();
      return { ok: true, changed: r.changed };
    } catch (err) {
      logger.error(MODULE_NAME, `enable game control in user.cfg failed: ${err}`);
      return { ok: false, error: (err as Error).message };
    }
  });
}

export function shutdownGameControl(): void {
  hotkeys?.deactivate();
  client?.close();
  client = null;
}
