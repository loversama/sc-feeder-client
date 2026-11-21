/** IPC for telemetry / overlay / Game.log diff (used by the Settings page). */
import { ipcMain, dialog, shell } from 'electron';
import * as logger from '../logger';
import { getCurrentLogPath } from '../config-manager';
import type { TelemetrySettings } from '../config-manager';
import {
  applyTelemetrySettings,
  enableTelemetryInUserCfg,
  getLogDiffTracker,
  getOverlayState,
  getUserCfgStatus,
} from './telemetry-manager';
import { getTelemetrySettings } from '../config-manager';
import { refreshOverlay, registerOverlayHotkey, toggleOverlay, isGameRunning } from './overlay-window';
import { renderMarkdown } from '../log-diff/log-diff-tracker';
import fsp from 'node:fs/promises';
import path from 'node:path';

const MODULE_NAME = 'TelemetryIPC';

export function registerTelemetryIpc(): void {
  ipcMain.handle('telemetry:get-settings', () => getTelemetrySettings());
  ipcMain.handle('telemetry:set-settings', (_e, patch: Partial<TelemetrySettings>) => {
    const before = getTelemetrySettings();
    const s = applyTelemetrySettings(patch ?? {});
    if (s.overlayHotkey !== before.overlayHotkey) registerOverlayHotkey();
    refreshOverlay();
    return s;
  });
  ipcMain.handle('telemetry:get-state', () => ({ ...getOverlayState({ maxRowsPerSection: 200 }), gameRunning: isGameRunning() }));
  ipcMain.handle('telemetry:toggle-overlay', () => toggleOverlay());
  ipcMain.handle('telemetry:user-cfg-status', () => getUserCfgStatus());
  ipcMain.handle('telemetry:enable-user-cfg', async () => {
    try {
      return { ok: true, ...(await enableTelemetryInUserCfg()) };
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
