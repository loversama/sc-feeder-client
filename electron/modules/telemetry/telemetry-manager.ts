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
import fs from 'node:fs';
import * as logger from '../logger';
import { getCurrentLogPath, getTelemetrySettings, setTelemetrySettings, type TelemetrySettings } from '../config-manager';
import { getActiveChannelName, getChannelTracker, legacyChannelName } from '../channel-manager';
import { PARSER_PATTERNS, PARSER_PATTERN_META, getCurrentUsername } from '../log-parser';
import { sendTelemetry, isServerAuthenticated, connectionEvents } from '../server-connection';
import { getPersistedClientId } from '../auth-manager';
import { TelemetryService } from './telemetry-service';
import { flatten, type TelemetryEvent } from './telemetry-state';
import { SCHEMA_GAME_BUILD } from './schema-desc';
import { getDebugEvents, getUploadCounters, pushDebugEvent, markDebugEventShared } from './debug-bus';
import { LogDiffTracker, type LogDiffReport } from '../log-diff/log-diff-tracker';
import { extractBuildInfo, type LogBuildInfo } from '../log-diff/log-signature';
import { TelemetryRecorder, computeFieldUniverse, computeGameEventTypes } from './telemetry-recorder';
import { loadTelemetryRoot } from './telemetry-client';
import { TELEMETRY_CFG_KEY, TRIGGER_CFG_KEY, cfgFlag, enableCfgFlag } from './user-cfg';

const MODULE_NAME = 'Telemetry';

let service: TelemetryService | null = null;
/** One Game.log diff tracker per channel: a PTU log is never diffed against a LIVE baseline. */
const trackers = new Map<string, LogDiffTracker>();
let recorder: TelemetryRecorder | null = null;
/** Channel of the Game.log being read (tags uploads, recordings and the diff tracker). */
let activeChannel: string | null = null;
/** Game build from each channel's Game.log header (read regardless of the log-diff setting). */
const builds = new Map<string, LogBuildInfo>();
let headerBuf = '';
let initialized = false;

const safeName = (s: string) => s.replace(/[^A-Za-z0-9._-]+/g, '_') || 'unknown';
const channelNow = () => activeChannel ?? getActiveChannelName();

function trackerFor(channel: string): LogDiffTracker {
  let t = trackers.get(channel);
  if (t) return t;
  const base = path.join(app.getPath('userData'), 'log-diff');
  const storeDir = path.join(base, safeName(channel));
  // Baselines saved before channels existed live in log-diff/: they belong to the channel of the old logFilePath.
  try {
    if (channel === legacyChannelName() && !fs.existsSync(path.join(storeDir, 'baseline.json'))) {
      fs.mkdirSync(storeDir, { recursive: true });
      for (const f of ['baseline.json', 'baseline-previous.json']) {
        if (fs.existsSync(path.join(base, f))) fs.copyFileSync(path.join(base, f), path.join(storeDir, f));
      }
    }
  } catch (err) {
    logger.warn(MODULE_NAME, `Could not migrate the previous Game.log baseline: ${err}`);
  }
  t = new LogDiffTracker({
    storeDir,
    patterns: PARSER_PATTERNS,
    patternMeta: PARSER_PATTERN_META,
    getRedactNames: () => {
      const u = getCurrentUsername();
      return u ? [u] : [];
    },
    log: (lvl, msg) => logger[lvl === 'debug' ? 'debug' : lvl](MODULE_NAME, `[${channel}] ${msg}`),
  });
  t.load().catch((err) => logger.warn(MODULE_NAME, `Log diff baseline load failed: ${err}`));
  trackers.set(channel, t);
  return t;
}

export function getTelemetryRecorder(): TelemetryRecorder | null {
  return recorder;
}
/** telemetry event id → debug-bus event id */
const debugIds = new Map<string, string>();

export function getTelemetryService(): TelemetryService | null {
  return service;
}

/** Tracker of the active channel. */
export function getLogDiffTracker(): LogDiffTracker | null {
  return initialized ? trackerFor(channelNow()) : null;
}

export function initTelemetry(): void {
  if (initialized) return;
  initialized = true;
  const settings = getTelemetrySettings();

  service = new TelemetryService({
    isSharingEnabled: () => getTelemetrySettings().telemetryShare,
    includeBalance: () => getTelemetrySettings().telemetryShareBalance,
    upload: (payload) => sendTelemetry(payload, channelNow()),
    clientId: () => getPersistedClientId(),
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

  let universe: string[] | undefined;
  try {
    universe = computeFieldUniverse(loadTelemetryRoot());
  } catch (err) {
    logger.warn(MODULE_NAME, `Telemetry field universe unavailable: ${err}`);
  }
  recorder = new TelemetryRecorder({
    dir: path.join(app.getPath('userData'), 'telemetry-recordings'),
    isEnabled: () => getTelemetrySettings().telemetryRecord,
    getContext: () => {
      const b = builds.get(channelNow());
      return { channel: channelNow(), gameVersion: b?.fileVersion, gameBuild: b?.build };
    },
    schemaBuild: SCHEMA_GAME_BUILD,
    clientVersion: app.getVersion(),
    universe,
    gameEventTypes: (() => {
      try {
        return computeGameEventTypes(loadTelemetryRoot());
      } catch {
        return [];
      }
    })(),
    log: (lvl, msg) => logger[lvl === 'debug' ? 'debug' : lvl](MODULE_NAME, msg),
  });
  recorder.attach(service);

  // After a server restart / redeploy / network drop the socket is re-authenticated by
  // server-connection; push a fresh snapshot right away and re-send held feed events.
  connectionEvents.on('authenticated', () => service?.resync());

  if (settings.telemetryEnabled) service.start();
  logger.info(MODULE_NAME, `Telemetry initialised (enabled=${settings.telemetryEnabled}, share=${settings.telemetryShare}, schema ${SCHEMA_GAME_BUILD})`);
}

export async function shutdownTelemetry(): Promise<void> {
  // Close the recording first (the state is still intact for the last diff), then stop the stream.
  const rec = recorder?.close('shutdown').catch(() => {}) ?? Promise.resolve();
  service?.stop();
  // Saving the Game.log baselines waits for queued lines; never hold up app quit for long.
  const saves = [...trackers.values()].map((t) => t.finalize().catch(() => {}));
  await Promise.race([Promise.all([rec, ...saves]), new Promise((r) => setTimeout(r, 1500))]);
}

export function applyTelemetrySettings(patch: Partial<TelemetrySettings>): TelemetrySettings {
  const s = setTelemetrySettings(patch);
  if (service) {
    if (s.telemetryEnabled && !service.running) service.start();
    if (!s.telemetryEnabled && service.running) service.stop();
  }
  if (!s.telemetryRecord) recorder?.endSession('recording_off');
  return s;
}

// --- hooks from log-watcher -------------------------------------------------

/**
 * A Game.log (of `channel`) is being (re)read from the beginning. Switching channel finalises the
 * previous channel's diff session and ends the recording; hints from the old log are dropped.
 */
export function noteLogBegin(logPath: string, channel: string = channelNow()): void {
  if (!initialized) return;
  if (activeChannel && activeChannel !== channel) {
    trackers.get(activeChannel)?.finalize().catch(() => {});
  }
  recorder?.onNewLog(channel); // before the channel changes: the old session is named after the old channel
  activeChannel = channel;
  service?.resetLogHints();
  headerBuf = '';
  builds.delete(channel);
  if (!getTelemetrySettings().logDiffEnabled) return;
  trackerFor(channel)
    .beginLog(logPath)
    .catch((err) => logger.warn(MODULE_NAME, `Log diff begin failed: ${err}`));
}

const LOG_MARKERS: Array<[string, string]> = [
  ['actor_dead', '<[ActorState] Dead>'],
  ['vehicle_destroyed', '<Vehicle Destroyed>'],
  ['fatal_collision', '<FatalCollision>'],
  ['emergency_services', 'Local Emergency Services Are En Route'],
];

/** Record Game.log death/vehicle lines in the telemetry recording so both can be lined up later. */
function markLogLines(chunk: string): void {
  if (!/Dead>|Destroyed>|FatalCollision>|Emergency Services/.test(chunk)) return;
  for (const line of chunk.split('\n')) {
    for (const [marker, needle] of LOG_MARKERS) {
      if (line.includes(needle)) {
        recorder?.noteLogMarker(marker, line);
        break;
      }
    }
  }
}

/** New Game.log content (initial scan and live) of the active channel. */
export function noteLogChunk(chunk: string): void {
  try {
    service?.noteLogChunk(chunk);
    if (recorder?.active) markLogLines(chunk);
    const ch = channelNow();
    if (!builds.get(ch)?.fileVersion && headerBuf.length < 200_000) {
      headerBuf += chunk.slice(0, 200_000 - headerBuf.length);
      const b = extractBuildInfo(headerBuf);
      if (b.fileVersion || b.build) builds.set(ch, b);
    }
    if (getTelemetrySettings().logDiffEnabled) trackerFor(ch).addChunk(chunk);
  } catch (err) {
    logger.warn(MODULE_NAME, `noteLogChunk failed: ${err}`);
  }
}

// --- user.cfg -----------------------------------------------------------------

export { TRIGGER_CFG_KEY };

/** user.cfg sits next to Game.log at the root of the game channel (LIVE / PTU / EPTU). */
export function getUserCfgPath(logPath = getCurrentLogPath()): string {
  return path.join(path.dirname(logPath), 'user.cfg');
}

export type UserCfgStatus = { path: string; exists: boolean; enabled: boolean; triggerEnabled: boolean };
export type ChannelCfgStatus = UserCfgStatus & { channel: string; active: boolean };

/** user.cfg of the active channel plus every detected channel (`channels`). */
export async function getUserCfgStatus(): Promise<UserCfgStatus & { channels: ChannelCfgStatus[] }> {
  const t = getChannelTracker();
  const list = t?.channels ?? [];
  const channels = await Promise.all(
    list.map(async (c) => ({ channel: c.name, active: c.name === t?.active, ...(await readUserCfgStatus(c.userCfgPath)) })),
  );
  let own: ChannelCfgStatus | undefined = channels.find((c) => c.active);
  if (!own) own = { channel: channelNow(), active: true, ...(await readUserCfgStatus(getUserCfgPath())) };
  return { path: own.path, exists: own.exists, enabled: own.enabled, triggerEnabled: own.triggerEnabled, channels: channels.length ? channels : [own] };
}

async function readUserCfgStatus(p: string): Promise<UserCfgStatus> {
  try {
    const text = await fsp.readFile(p, 'utf8');
    return { path: p, exists: true, enabled: cfgFlag(text, TELEMETRY_CFG_KEY), triggerEnabled: cfgFlag(text, TRIGGER_CFG_KEY) };
  } catch {
    return { path: p, exists: false, enabled: false, triggerEnabled: false };
  }
}

/**
 * Enable the game's telemetry server in user.cfg. Append-only when the key is missing; when the
 * key exists with another value only that line is changed. A .bak copy is kept. Takes effect on
 * the next game start.
 */
export async function enableTelemetryInUserCfg(
  channel: string | 'all' = 'all',
  key: string = TELEMETRY_CFG_KEY,
): Promise<{ path: string; changed: boolean; backup?: string; results: Array<{ channel: string; path: string; changed: boolean; backup?: string }> }> {
  const t = getChannelTracker();
  const list = t?.channels ?? [];
  const targets = list.length
    ? list.filter((c) => channel === 'all' || c.name === channel).map((c) => ({ channel: c.name, path: c.userCfgPath }))
    : [{ channel: channelNow(), path: getUserCfgPath() }];
  if (!targets.length) throw new Error(`Unknown channel ${channel}`);
  const results = [];
  for (const tg of targets) results.push({ channel: tg.channel, ...(await enableInCfgFile(tg.path, tg.channel, key)) });
  const first = results.find((r) => r.channel === channelNow()) ?? results[0];
  return { path: first.path, changed: results.some((r) => r.changed), backup: first.backup, results };
}

/** Enable game control (TriggerGameAction) in user.cfg; same rules as enableTelemetryInUserCfg. */
export function enableGameControlInUserCfg(channel: string | 'all' = 'all') {
  return enableTelemetryInUserCfg(channel, TRIGGER_CFG_KEY);
}

async function enableInCfgFile(p: string, channel: string, key: string): Promise<{ path: string; changed: boolean; backup?: string }> {
  let text = '';
  try {
    text = await fsp.readFile(p, 'utf8');
  } catch {
    /* new file */
  }
  const { text: next, changed } = enableCfgFlag(text, key);
  if (!changed) return { path: p, changed: false };
  let backup: string | undefined;
  if (text) {
    backup = `${p}.${new Date().toISOString().replace(/[:.]/g, '-')}.bak`;
    await fsp.writeFile(backup, text);
  }
  await fsp.writeFile(p, next);
  logger.info(MODULE_NAME, `Enabled ${key} in ${p}`);
  const what = key === TELEMETRY_CFG_KEY ? 'Telemetry' : 'Game control';
  pushDebugEvent({ source: 'system', type: 'user_cfg', summary: `${what} enabled in ${channel} user.cfg (restart the game)` });
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
  const tracker = settings.logDiffEnabled ? getLogDiffTracker() : null;
  if (tracker) {
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
      serverConnected: isServerAuthenticated(),
      counters: getUploadCounters(),
      lastSnapshotAt: s?.lastSharedSnapshot?.at ?? null,
      lastSnapshotBytes: s?.lastSharedSnapshot?.bytes ?? 0,
    },
    events: getDebugEvents(40),
    logDiff,
  };
}
