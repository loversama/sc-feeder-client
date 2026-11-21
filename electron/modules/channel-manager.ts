/**
 * Electron glue for Star Citizen channels: settings (gameRoot + legacy logFilePath), the channel
 * tracker (which channel is active) and the "active Game.log" every other module follows through
 * config-manager's getCurrentLogPath().
 */
import * as logger from './logger';
import { getGameRoot, getStoredLogPath, isGameRootMigrated, setActiveLogPath, setGameRoot, setLogPath } from './config-manager';
import {
  ChannelTracker,
  baseName,
  discoverChannels,
  migrateGameRoot,
  normalizeRootSelection,
  pathFor,
  singleFileChannel,
  type ChannelInfo,
} from './game-channels';

const MODULE_NAME = 'Channels';

let tracker: ChannelTracker | null = null;
const activeListeners: Array<(c: ChannelInfo, prev: string | null) => void> = [];

let ready = false;
export function channelsReady(): boolean {
  return ready;
}

export function getChannelTracker(): ChannelTracker | null {
  return tracker;
}

/** Called when the active channel changes after start-up (log-watcher switches to its Game.log). */
export function onActiveChannelChange(fn: (c: ChannelInfo, prev: string | null) => void): void {
  activeListeners.push(fn);
}

/** Channel folder name of the legacy single logFilePath (LIVE for the default install). */
export function legacyChannelName(): string {
  const p = pathFor(getStoredLogPath());
  return p.basename(p.dirname(getStoredLogPath())) || 'LIVE';
}

/** Name used to tag uploads for the active Game.log. */
export function getActiveChannelName(): string {
  return tracker?.active ?? legacyChannelName();
}

async function discover(): Promise<ChannelInfo[]> {
  const root = getGameRoot();
  if (root) {
    const list = await discoverChannels(root);
    if (list.length) return list;
    logger.warn(MODULE_NAME, `No Star Citizen channels found in ${root}; using ${getStoredLogPath()}`);
  }
  return singleFileChannel(getStoredLogPath());
}

/** One-time migration of the old single-path setting to a game root. */
export async function migrateChannelSettings(): Promise<void> {
  if (isGameRootMigrated()) return;
  const root = await migrateGameRoot(getStoredLogPath());
  setGameRoot(root ?? '');
  logger.info(MODULE_NAME, root ? `Game root derived from the log path: ${root}` : 'Non-standard log path: staying in single-file mode');
}

/**
 * Start tracking channels and pick the initial active one (no notification: the caller reads the
 * log itself). Safe to call again after the root changed.
 */
export async function initChannels(opts: { reset?: boolean } = {}): Promise<ChannelInfo | null> {
  await migrateChannelSettings();
  if (!tracker) {
    tracker = new ChannelTracker({ discover, log: (l, m) => logger[l === 'debug' ? 'debug' : l](MODULE_NAME, m) });
    tracker.onActive((c, prev) => {
      setActiveLogPath(c.logPath);
      for (const fn of activeListeners) {
        try {
          fn(c, prev);
        } catch (err) {
          logger.warn(MODULE_NAME, `active-channel listener failed: ${err}`);
        }
      }
    });
    tracker.start();
  }
  if (opts.reset) tracker.reset();
  const active = await tracker.poll({ force: true, emit: false });
  setActiveLogPath(active?.logPath ?? null);
  ready = true;
  return active;
}

export function stopChannels(): void {
  tracker?.stop();
}

export type ChannelsState = {
  mode: 'root' | 'single';
  root: string;
  logPath: string;
  active: string | null;
  channels: Array<Pick<ChannelInfo, 'name' | 'dir' | 'logPath' | 'hasLog' | 'mtimeMs' | 'size'> & { active: boolean }>;
};

export function getChannelsState(): ChannelsState {
  const root = getGameRoot();
  const active = tracker?.active ?? null;
  return {
    mode: root ? 'root' : 'single',
    root,
    logPath: tracker?.activeChannel?.logPath ?? getStoredLogPath(),
    active,
    channels: (tracker?.channels ?? []).map((c) => ({ name: c.name, dir: c.dir, logPath: c.logPath, hasLog: c.hasLog, mtimeMs: c.mtimeMs, size: c.size, active: c.name === active })),
  };
}

/** Use a folder picked in the UI as game root (or a channel folder inside it). */
export async function selectGameRoot(picked: string): Promise<{ ok: boolean; root?: string; channels?: string[]; error?: string }> {
  const { root, channels, singleFile } = await normalizeRootSelection(picked);
  if (singleFile) {
    setGameRoot('');
    setLogPath(singleFile);
    return { ok: true, root: '', channels: channels.map((c) => c.name) };
  }
  if (!channels.length) return { ok: false, error: `No Star Citizen channel (a folder with Game.log, Bin64 or StarCitizen_Launcher) found in ${baseName(picked) || picked}` };
  setGameRoot(root);
  logger.info(MODULE_NAME, `Game root set to ${root} (${channels.map((c) => c.name).join(', ')})`);
  return { ok: true, root, channels: channels.map((c) => c.name) };
}

/** Back to single-file mode (non-standard layouts): only the stored logFilePath is used. */
export function useSingleFileMode(): void {
  setGameRoot('');
}
