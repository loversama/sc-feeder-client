/**
 * Star Citizen channels (LIVE / PTU / EPTU / TECH-PREVIEW / HOTFIX ...).
 *
 *   <StarCitizen root>\LIVE\Game.log        (+ logbackups\, user.cfg, Bin64\)
 *   <StarCitizen root>\PTU\Game.log
 *
 * Pure module (no Electron / config imports) so it can be unit-tested with plain Node.
 *   - root derivation + migration from the legacy single `logFilePath` setting
 *   - channel discovery
 *   - ChannelTracker: decides which channel is "active" (the game normally runs one at a time)
 */
import fsp from 'node:fs/promises';
import nodePath from 'node:path';

export type ChannelInfo = {
  /** Folder name, e.g. LIVE, PTU */
  name: string;
  dir: string;
  logPath: string;
  userCfgPath: string;
  hasLog: boolean;
  /** Game.log mtime (0 when there is none) */
  mtimeMs: number;
  size: number;
};

/** Windows paths (C:\..., \\server\...) must split on backslashes even when running on Linux (tests, WSL). */
export function pathFor(p: string): typeof nodePath.posix {
  return /^[a-zA-Z]:[\\/]/.test(p) || p.startsWith('\\\\') || (p.includes('\\') && !p.includes('/')) ? nodePath.win32 : nodePath.posix;
}

export function joinPath(base: string, ...parts: string[]): string {
  return pathFor(base).join(base, ...parts);
}

export function baseName(p: string): string {
  return pathFor(p).basename(p);
}

/** Game folder markers: a channel folder has a Game.log, or the launcher/Bin64 of an installed build. */
const CHANNEL_MARKERS = ['Game.log', 'StarCitizen_Launcher', 'Bin64'];

export async function inspectChannelDir(dir: string, name = baseName(dir)): Promise<ChannelInfo | null> {
  let entries: string[];
  try {
    entries = await fsp.readdir(dir);
  } catch {
    return null;
  }
  const lower = new Map(entries.map((e) => [e.toLowerCase(), e]));
  if (!CHANNEL_MARKERS.some((m) => lower.has(m.toLowerCase()))) return null;
  const logPath = joinPath(dir, lower.get('game.log') ?? 'Game.log');
  let mtimeMs = 0;
  let size = 0;
  let hasLog = false;
  try {
    const st = await fsp.stat(logPath);
    if (st.isFile()) {
      hasLog = true;
      mtimeMs = st.mtimeMs;
      size = st.size;
    }
  } catch {
    /* no Game.log yet */
  }
  return { name, dir, logPath, userCfgPath: joinPath(dir, 'user.cfg'), hasLog, mtimeMs, size };
}

/** Sub-folders of the game root that look like channels. LIVE first, then alphabetical. */
export async function discoverChannels(root: string): Promise<ChannelInfo[]> {
  if (!root) return [];
  let dirents: import('node:fs').Dirent[];
  try {
    dirents = await fsp.readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const found = (
    await Promise.all(dirents.filter((d) => d.isDirectory()).map((d) => inspectChannelDir(joinPath(root, d.name), d.name)))
  ).filter((c): c is ChannelInfo => !!c);
  return found.sort((a, b) => (a.name === 'LIVE' ? -1 : b.name === 'LIVE' ? 1 : a.name.localeCompare(b.name)));
}

/** Single-file fallback (non-standard layouts): the configured Game.log is the only "channel". */
export async function singleFileChannel(logPath: string): Promise<ChannelInfo[]> {
  if (!logPath) return [];
  const p = pathFor(logPath);
  const dir = p.dirname(logPath);
  const info = await inspectChannelDir(dir, p.basename(dir) || 'LIVE');
  if (info) return [{ ...info, logPath, userCfgPath: p.join(dir, 'user.cfg') }];
  return [{ name: p.basename(dir) || 'LIVE', dir, logPath, userCfgPath: p.join(dir, 'user.cfg'), hasLog: false, mtimeMs: 0, size: 0 }];
}

/**
 * Game root for an existing `logFilePath` (<root>\<CHANNEL>\Game.log → <root>), or null when the
 * layout is not the standard one (then the app stays in single-file mode).
 * Standard = the channel folder is a direct child of a folder that is named like Star Citizen, or
 * the channel folder holds Bin64 / StarCitizen_Launcher.
 */
export async function migrateGameRoot(logFilePath: string): Promise<string | null> {
  if (!logFilePath) return null;
  const p = pathFor(logFilePath);
  if (p.basename(logFilePath).toLowerCase() !== 'game.log') return null;
  const channelDir = p.dirname(logFilePath);
  const root = p.dirname(channelDir);
  if (!root || root === channelDir) return null;
  const rootLooksRight = /star\s*citizen/i.test(p.basename(root));
  const channelLooksRight = !!(await inspectChannelDir(channelDir)) && (await hasAny(channelDir, ['Bin64', 'StarCitizen_Launcher']));
  if (!rootLooksRight && !channelLooksRight) return null;
  if (!(await discoverChannels(root)).length && !rootLooksRight) return null;
  return root;
}

async function hasAny(dir: string, names: string[]): Promise<boolean> {
  try {
    const have = new Set((await fsp.readdir(dir)).map((e) => e.toLowerCase()));
    return names.some((n) => have.has(n.toLowerCase()));
  } catch {
    return false;
  }
}

/** A folder picked in the UI: the root itself, or (if it holds a Game.log) a channel folder whose parent is the root. */
export async function normalizeRootSelection(picked: string): Promise<{ root: string; channels: ChannelInfo[]; singleFile?: string }> {
  const own = await inspectChannelDir(picked);
  if (own?.hasLog) {
    const p = pathFor(picked);
    const parent = p.dirname(picked);
    const standard = /star\s*citizen/i.test(p.basename(parent)) || (await hasAny(picked, ['Bin64', 'StarCitizen_Launcher']));
    if (standard) {
      const siblings = await discoverChannels(parent);
      if (siblings.some((c) => c.name === own.name)) return { root: parent, channels: siblings };
    }
    // A folder with a Game.log but no Star Citizen layout around it: watch just that file.
    return { root: '', channels: [own], singleFile: own.logPath };
  }
  return { root: picked, channels: await discoverChannels(picked) };
}

// --- active channel ------------------------------------------------------------------

export type ChannelTrackerOptions = {
  /** Returns the current list of channels with fresh Game.log mtimes. */
  discover: () => Promise<ChannelInfo[]>;
  /** Re-list the folders every this often (a freshly installed PTU appears); stat-poll the logs in between. */
  rescanMs?: number;
  pollMs?: number;
  /** After a switch, ignore further switches for this long (two games writing at once must not flap). */
  dwellMs?: number;
  /** A challenger must have been written this much later than the active channel's log. */
  marginMs?: number;
  now?: () => number;
  log?: (level: 'info' | 'warn' | 'debug', msg: string) => void;
};

export class ChannelTracker {
  channels: ChannelInfo[] = [];
  active: string | null = null;
  #opts: Required<Omit<ChannelTrackerOptions, 'log'>> & Pick<ChannelTrackerOptions, 'log'>;
  #timer: NodeJS.Timeout | null = null;
  #lastRescan = 0;
  #lastSwitch = 0;
  #busy: Promise<void> | null = null;
  #listeners = { active: [] as Array<(c: ChannelInfo, prev: string | null) => void>, channels: [] as Array<(c: ChannelInfo[]) => void> };

  constructor(opts: ChannelTrackerOptions) {
    this.#opts = { rescanMs: 30_000, pollMs: 2_000, dwellMs: 30_000, marginMs: 1_000, now: Date.now, ...opts };
  }

  onActive(fn: (c: ChannelInfo, prev: string | null) => void): void {
    this.#listeners.active.push(fn);
  }

  onChannels(fn: (c: ChannelInfo[]) => void): void {
    this.#listeners.channels.push(fn);
  }

  get activeChannel(): ChannelInfo | null {
    return this.channels.find((c) => c.name === this.active) ?? null;
  }

  start(): void {
    if (this.#timer) return;
    this.#timer = setInterval(() => void this.poll().catch(() => {}), this.#opts.pollMs);
    this.#timer.unref?.();
  }

  /** Forget everything (the game root changed): the next poll picks the active channel afresh. */
  reset(): void {
    this.channels = [];
    this.active = null;
    this.#lastSwitch = 0;
  }

  stop(): void {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
  }

  /**
   * Re-discover (when due or `force`) and decide the active channel. Initial pick (nothing active
   * yet): the most recently written Game.log. Afterwards: switch only to a channel whose log was
   * written clearly later than the active one's. `emit:false` returns the pick without notifying
   * (used by the watcher start-up, which then reads the log itself).
   */
  poll(opts: { force?: boolean; emit?: boolean } = {}): Promise<ChannelInfo | null> {
    const run = async (): Promise<ChannelInfo | null> => {
      const now = this.#opts.now();
      const before = this.channels.map((c) => c.name).join('|');
      this.channels = await this.#opts.discover();
      const rescanned = opts.force || now - this.#lastRescan >= this.#opts.rescanMs;
      if (rescanned) this.#lastRescan = now;
      if (this.channels.map((c) => c.name).join('|') !== before || rescanned) {
        if (opts.emit !== false) for (const fn of this.#listeners.channels) fn(this.channels);
      }
      const prev = this.active;
      const next = this.#choose(now);
      if (next !== prev) {
        this.active = next;
        if (prev !== null) this.#lastSwitch = now; // a real switch (not the initial pick)
        const info = this.activeChannel;
        this.#opts.log?.('info', `Active Star Citizen channel: ${prev ?? '(none)'} → ${next ?? '(none)'}`);
        if (info && opts.emit !== false) for (const fn of this.#listeners.active) fn(info, prev);
      }
      return this.activeChannel;
    };
    // Serialise: a slow stat must not overlap the next poll.
    const p = (this.#busy ?? Promise.resolve()).then(run, run);
    this.#busy = p.then(() => {}, () => {});
    return p;
  }

  #choose(now: number): string | null {
    const withLog = this.channels.filter((c) => c.hasLog);
    const cur = this.channels.find((c) => c.name === this.active);
    if (!this.channels.length) return null;
    if (!cur) {
      // nothing active yet (or the active channel vanished)
      const newest = [...withLog].sort((a, b) => b.mtimeMs - a.mtimeMs)[0];
      return (newest ?? this.channels[0]).name;
    }
    if (now - this.#lastSwitch < this.#opts.dwellMs) return cur.name;
    const challenger = [...withLog].filter((c) => c.name !== cur.name).sort((a, b) => b.mtimeMs - a.mtimeMs)[0];
    if (challenger && challenger.mtimeMs > cur.mtimeMs + this.#opts.marginMs) return challenger.name;
    return cur.name;
  }
}
