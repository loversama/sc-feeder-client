/** IPC for telemetry / overlay / Game.log diff (used by the Settings page). */
import { app, ipcMain, dialog, shell } from 'electron';
import * as logger from '../logger';
import { getCurrentLogPath } from '../config-manager';
import type { TelemetrySettings } from '../config-manager';
import { getChannelsState, initChannels, selectGameRoot } from '../channel-manager';
import { applyGameRootChange } from '../log-watcher';
import { getGameRoot } from '../config-manager';
import {
  applyTelemetrySettings,
  getTelemetryRecorder,
  enableTelemetryInUserCfg,
  getLogDiffTracker,
  getOverlayState,
  getUserCfgStatus,
} from './telemetry-manager';
import { getTelemetrySettings } from '../config-manager';
import { syncOverlayFeature, toggleOverlay, isGameRunning } from './overlay-window';
import { getPartyOverlaySettings } from '../config-manager';
import { applyPartyOverlaySettings, getPartyOverlayFeed, togglePartyOverlay } from '../overlay/party-overlay-window';
import { renderMarkdown } from '../log-diff/log-diff-tracker';
import fsp from 'node:fs/promises';
import path from 'node:path';

const MODULE_NAME = 'TelemetryIPC';

export function registerTelemetryIpc(): void {
  ipcMain.handle('telemetry:get-settings', () => getTelemetrySettings());
  ipcMain.handle('telemetry:set-settings', (_e, patch: Partial<TelemetrySettings>) => {
    const s = applyTelemetrySettings(patch ?? {});
    syncOverlayFeature();
    return s;
  });
  ipcMain.handle('telemetry:get-state', () => ({
    ...getOverlayState({ maxRowsPerSection: 200 }),
    gameRunning: isGameRunning(),
    recording: { dir: path.join(app.getPath('userData'), 'telemetry-recordings'), active: !!getTelemetryRecorder()?.active, file: getTelemetryRecorder()?.sessionFile ?? null },
  }));
  ipcMain.handle('telemetry:open-recordings', async () => {
    const dir = path.join(app.getPath('userData'), 'telemetry-recordings');
    await fsp.mkdir(dir, { recursive: true });
    const err = await shell.openPath(dir);
    return err ? { ok: false, error: err, dir } : { ok: true, dir };
  });

  // --- Star Citizen channels (LIVE / PTU / ...) ---
  ipcMain.handle('channels:get', () => getChannelsState());
  ipcMain.handle('channels:select-root', async () => {
    const r = await dialog.showOpenDialog({ title: 'Select your Star Citizen folder (the one containing LIVE, PTU, ...)', defaultPath: getGameRoot() || undefined, properties: ['openDirectory'] });
    if (r.canceled || !r.filePaths[0]) return null;
    const res = await selectGameRoot(r.filePaths[0]);
    if (res.ok) await applyGameRootChange();
    return { ...res, state: getChannelsState() };
  });
  ipcMain.handle('channels:rescan', async () => {
    await initChannels();
    return getChannelsState();
  });
  ipcMain.handle('telemetry:toggle-overlay', () => toggleOverlay());

  // --- In-game party / org overlay ---
  ipcMain.handle('party-overlay:get-settings', () => getPartyOverlaySettings());
  ipcMain.handle('party-overlay:set-settings', (_e, patch) => applyPartyOverlaySettings(patch && typeof patch === 'object' ? patch : {}));
  ipcMain.handle('party-overlay:toggle', () => togglePartyOverlay());
  ipcMain.handle('party-overlay:status', () => {
    const s = getPartyOverlayFeed()?.current;
    return s ? { status: s.status, message: s.message ?? null, source: s.source, party: s.party, online: s.roster?.members.filter((m) => m.status !== 'offline').length ?? 0 } : null;
  });
  ipcMain.handle('party-overlay:party', async (_e, req: { action?: unknown; code?: unknown; name?: unknown }) => {
    const feed = getPartyOverlayFeed();
    if (!feed) return { ok: false, error: 'Overlay not ready' };
    const action = typeof req?.action === 'string' && ['get', 'create', 'join', 'leave'].includes(req.action) ? req.action : null;
    if (!action) return { ok: false, error: 'bad action' };
    return feed.party(action, { code: typeof req.code === 'string' ? req.code.slice(0, 16) : undefined, name: typeof req.name === 'string' ? req.name.slice(0, 40) : undefined });
  });
  ipcMain.handle('telemetry:user-cfg-status', () => getUserCfgStatus());
  ipcMain.handle('telemetry:enable-user-cfg', async (_e, channel?: string) => {
    try {
      return { ok: true, ...(await enableTelemetryInUserCfg(typeof channel === 'string' && channel ? channel : 'all')) };
    } catch (err) {
      logger.error(MODULE_NAME, `enable user.cfg failed: ${err}`);
      return { ok: false, error: (err as Error).message };
    }
  });

  ipcMain.handle('logdiff:get-report', () => getLogDiffTracker()?.report() ?? null);
  ipcMain.handle('logdiff:export', async () => {
    const t = getLogDiffTracker();
    if (!t) return null;
    const p = await t.exportReport();
    shell.showItemInFolder(p);
    return p;
  });
  /** Pick a baseline Game.log and compare it with the current one (or a second picked file). */
  ipcMain.handle('logdiff:compare-files', async (_e, opts?: { pickCurrent?: boolean }) => {
    const t = getLogDiffTracker();
    if (!t) return null;
    const dir = path.dirname(getCurrentLogPath());
    const pick = async (title: string) => {
      const r = await dialog.showOpenDialog({ title, defaultPath: path.join(dir, 'logbackups'), properties: ['openFile'], filters: [{ name: 'Logs', extensions: ['log', 'txt'] }] });
      return r.canceled ? null : r.filePaths[0];
    };
    const base = await pick('Baseline (older) Game.log');
    if (!base) return null;
    const cur = opts?.pickCurrent ? await pick('Current (newer) Game.log') : getCurrentLogPath();
    if (!cur) return null;
    const report = await t.compareFiles(base, cur);
    const out = path.join(path.dirname(await t.exportReport()), `compare-${Date.now()}.md`);
    await fsp.writeFile(out, renderMarkdown(report));
    shell.showItemInFolder(out);
    return { path: out, counts: report.counts, lost: report.patterns.filter((p) => p.status === 'lost').map((p) => p.name) };
  });
}
