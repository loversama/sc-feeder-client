/**
 * Electron glue for game telemetry, the Game.log diff tracker and the in-game debug overlay.
 *
 *   log-watcher ──chunks──▶ noteLogBegin / noteLogChunk ──▶ TelemetryService (log hints) + LogDiffTracker
 *   127.0.0.1:2942 ──gRPC──▶ TelemetryService ──▶ server-connection.sendTelemetry ('submit_telemetry')
 *                                         └────▶ debug-bus ──▶ overlay window (bottom-right, click-through)
 */
import { app } from 'electron';
import fsp from 'node:fs/promises';
import path from 'node:path';
import * as logger from '../logger';
import { getCurrentLogPath, getTelemetrySettings, setTelemetrySettings, type TelemetrySettings } from '../config-manager';
import { PARSER_PATTERNS, getCurrentUsername } from '../log-parser';
import { sendTelemetry, isConnected as isServerConnected } from '../server-connection';
import { TelemetryService } from './telemetry-service';
import { flatten, type TelemetryEvent } from './telemetry-state';
import { SCHEMA_GAME_BUILD } from './schema-desc';
import { getDebugEvents, getUploadCounters, pushDebugEvent, markDebugEventShared } from './debug-bus';
import { LogDiffTracker, type LogDiffReport } from '../log-diff/log-diff-tracker';

const MODULE_NAME = 'Telemetry';

let service: TelemetryService | null = null;
let tracker: LogDiffTracker | null = null;
let initialized = false;
/** telemetry event id → debug-bus event id */
const debugIds = new Map<string, string>();

export function getTelemetryService(): TelemetryService | null {
  return service;
}

export function getLogDiffTracker(): LogDiffTracker | null {
  return tracker;
}

export function initTelemetry(): void {
  if (initialized) return;
  initialized = true;
  const settings = getTelemetrySettings();

  tracker = new LogDiffTracker({
    storeDir: path.join(app.getPath('userData'), 'log-diff'),
    patterns: PARSER_PATTERNS,
    getRedactNames: () => {
      const u = getCurrentUsername();
      return u ? [u] : [];
    },
    log: (lvl, msg) => logger[lvl === 'debug' ? 'debug' : lvl](MODULE_NAME, msg),
  });
  tracker.load().catch((err) => logger.warn(MODULE_NAME, `Log diff baseline load failed: ${err}`));

  service = new TelemetryService({
    isSharingEnabled: () => getTelemetrySettings().telemetryShare,
    includeBalance: () => getTelemetrySettings().telemetryShareBalance,
    upload: (payload) => sendTelemetry(payload),
    log: (lvl, msg) => logger[lvl === 'debug' ? 'debug' : lvl](MODULE_NAME, msg),
  });
  service.on('status', (status: string, prev: string) => {
    logger.info(MODULE_NAME, `Telemetry status ${prev} → ${status}`);
    pushDebugEvent({ source: 'system', type: 'telemetry_status', summary: `Telemetry ${status.replace(/_/g, ' ')}`, severity: status === 'streaming' ? 'info' : 'warn' });
  });
  service.on('event', (e: TelemetryEvent & { shared?: boolean }) => {
    const d = pushDebugEvent({ source: 'telemetry', type: e.type, summary: e.summary, severity: e.severity, shared: e.shared });
    debugIds.set(e.id, d.id);
    if (debugIds.size > 300) debugIds.delete(debugIds.keys().next().value as string);
  });
  service.on('event-shared', (id: string, shared: boolean) => {
    const dbg = debugIds.get(id);
    if (dbg) markDebugEventShared(dbg, shared);
  });

  if (settings.telemetryEnabled) service.start();
  logger.info(MODULE_NAME, `Telemetry initialised (enabled=${settings.telemetryEnabled}, share=${settings.telemetryShare}, schema ${SCHEMA_GAME_BUILD})`);
}

export async function shutdownTelemetry(): Promise<void> {
  service?.stop();
  await tracker?.finalize().catch(() => {});
}

export function applyTelemetrySettings(patch: Partial<TelemetrySettings>): TelemetrySettings {
  const s = setTelemetrySettings(patch);
  if (service) {
    if (s.telemetryEnabled && !service.running) service.start();
    if (!s.telemetryEnabled && service.running) service.stop();
  }
  return s;
}

// --- hooks from log-watcher -------------------------------------------------

/** A Game.log is being (re)read from the beginning. */
export function noteLogBegin(logPath: string): void {
  if (!tracker || !getTelemetrySettings().logDiffEnabled) return;
  tracker.beginLog(logPath).catch((err) => logger.warn(MODULE_NAME, `Log diff begin failed: ${err}`));
}

/** New Game.log content (initial scan and live). */
export function noteLogChunk(chunk: string): void {
  try {
    service?.noteLogChunk(chunk);
    if (tracker && getTelemetrySettings().logDiffEnabled) tracker.addChunk(chunk);
  } catch (err) {
    logger.warn(MODULE_NAME, `noteLogChunk failed: ${err}`);
  }
}

// --- user.cfg -----------------------------------------------------------------

const CFG_LINE = 'server.game.telemetry.enabled=1';

/** user.cfg sits next to Game.log at the root of the game channel (LIVE / PTU / EPTU). */
export function getUserCfgPath(logPath = getCurrentLogPath()): string {
  return path.join(path.dirname(logPath), 'user.cfg');
}

export async function getUserCfgStatus(): Promise<{ path: string; exists: boolean; enabled: boolean }> {
  const p = getUserCfgPath();
  try {
    const text = await fsp.readFile(p, 'utf8');
    const m = text.match(/^\s*server\.game\.telemetry\.enabled\s*=\s*(\S+)/im);
    return { path: p, exists: true, enabled: !!m && /^(1|true)$/i.test(m[1]) };
  } catch {
    return { path: p, exists: false, enabled: false };
  }
}

/**
 * Enable the game's telemetry server in user.cfg. Append-only when the key is missing; when the
 * key exists with another value only that line is changed. A .bak copy is kept. Takes effect on
 * the next game start.
 */
export async function enableTelemetryInUserCfg(): Promise<{ path: string; changed: boolean; backup?: string }> {
  const p = getUserCfgPath();
  let text = '';
  try {
    text = await fsp.readFile(p, 'utf8');
  } catch {
    /* new file */
  }
  const re = /^(\s*)server\.game\.telemetry\.enabled\s*=\s*(\S*)\s*$/im;
  const m = text.match(re);
  if (m && /^(1|true)$/i.test(m[2])) return { path: p, changed: false };
  let backup: string | undefined;
  if (text) {
    backup = `${p}.bak`;
    await fsp.writeFile(backup, text);
  }
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const next = m ? text.replace(re, `${m[1]}${CFG_LINE}`) : `${text}${text && !text.endsWith('\n') ? eol : ''}${CFG_LINE}${eol}`;
  await fsp.writeFile(p, next);
  logger.info(MODULE_NAME, `Enabled game telemetry in ${p}`);
  pushDebugEvent({ source: 'system', type: 'user_cfg', summary: `Telemetry enabled in user.cfg (restart the game)` });
  return { path: p, changed: true, backup };
}

// --- state for overlay + settings page ----------------------------------------

export type OverlayState = {
  at: number;
  telemetry: {
    enabled: boolean;
    status: string;
    address: string;
    fps: number;
    frames: number;
    bytesReceived: number;
    lastError: string | null;
    connectAttempts: number;
    logHints: TelemetryService['logHints'];
    schemaBuild: string;
    sections: Array<{ name: string; ageMs: number; stale: boolean; frames: number; rows: Array<[string, string]> }>;
  };
  sharing: {
    enabled: boolean;
    serverConnected: boolean;
    counters: ReturnType<typeof getUploadCounters>;
    lastSnapshotAt: string | null;
    lastSnapshotBytes: number;
  };
  events: ReturnType<typeof getDebugEvents>;
  logDiff: null | {
    current: LogDiffReport['current'];
    baseline: LogDiffReport['baseline'];
    counts: LogDiffReport['counts'];
    added: Array<{ signature: string; count: number }>;
    lostPatterns: Array<{ name: string; baseline: number }>;
    newPatterns: string[];
  };
};

export function getOverlayState(opts: { maxRowsPerSection?: number } = {}): OverlayState {
  const settings = getTelemetrySettings();
  const now = Date.now();
  const s = service;
  const sections = s
    ? s.state.sections(now).map((sec) => ({
        name: sec.name,
        ageMs: sec.ageMs,
        stale: sec.stale,
        frames: s.state.sectionFrames[sec.name] ?? 0,
        rows: flatten(sec.value, '', [], opts.maxRowsPerSection ?? 80),
      }))
    : [];
  let logDiff: OverlayState['logDiff'] = null;
  if (tracker && settings.logDiffEnabled) {
    const r = tracker.report();
    logDiff = {
      current: r.current,
      baseline: r.baseline,
      counts: r.counts,
      added: r.added.slice(0, 6).map((e) => ({ signature: e.signature, count: e.count })),
      lostPatterns: r.patterns.filter((p) => p.status === 'lost').map((p) => ({ name: p.name, baseline: p.baseline })),
      newPatterns: r.patterns.filter((p) => p.status === 'new').map((p) => p.name),
    };
  }
  return {
    at: now,
    telemetry: {
      enabled: settings.telemetryEnabled,
      status: s?.status ?? 'disabled',
      address: s?.address ?? '',
      fps: Math.round((s?.state.fps() ?? 0) * 10) / 10,
      frames: s?.state.frames ?? 0,
      bytesReceived: s?.bytesReceived ?? 0,
      lastError: s?.lastError ?? null,
      connectAttempts: s?.connectAttempts ?? 0,
      logHints: s?.logHints ?? { cfgEnabled: null, serviceRegistered: false, serverAddress: null, componentInitialized: false, lastHintAt: null },
      schemaBuild: SCHEMA_GAME_BUILD,
      sections,
    },
    sharing: {
      enabled: settings.telemetryShare,
      serverConnected: isServerConnected(),
      counters: getUploadCounters(),
      lastSnapshotAt: s?.lastSharedSnapshot?.at ?? null,
      lastSnapshotBytes: s?.lastSharedSnapshot?.bytes ?? 0,
    },
    events: getDebugEvents(40),
    logDiff,
  };
}
