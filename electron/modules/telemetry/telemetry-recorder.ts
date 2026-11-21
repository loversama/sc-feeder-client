/**
 * Local telemetry recorder: JSON Lines in `<userData>/telemetry-recordings/`, one file per game
 * session per channel, e.g. `2026-11-21T19-05-02_LIVE_4.10.200.log`. For reviewing how accurate the
 * telemetry is and what changes between patches. Never uploaded.
 *
 * Every line is `{ t: ISO time, kind, ... }`:
 *   session_start  channel, gameVersion, gameBuild, schemaBuild, clientVersion
 *   status         telemetry status changes
 *   changes        field-level diff against the previously recorded state (flatten() paths):
 *                  { "vehicle.state.speed": [old, new] }, null = absent. Sampled on a timer
 *                  (default 4/s), so a burst of frames is coalesced into one line.
 *   event          derived telemetry events
 *   game_event     the game's own `events` section
 *   session_end    counters: frames, fpsAvg, fieldsSeen, neverNonDefault (accuracy signal)
 *
 * force_feedback is not recorded (noise). Writes are buffered + async (never block the main
 * thread); a file stops growing at `maxFileBytes`; only the newest `keepFiles` files are kept.
 * Electron-free: everything is injected, so it is unit-testable.
 */
import fsp from 'node:fs/promises';
import path from 'node:path';
import type protobuf from 'protobufjs';
import { flatten, type Obj, type TelemetryEvent } from './telemetry-state';

/** Top-level sections that are never recorded as state. */
const SKIP_SECTIONS = new Set(['force_feedback', 'events']);
const FILE_RE = /^\d{4}-\d{2}-\d{2}T[\d-]+_.+\.log$/;
const MAX_ROWS = 50_000;

export type RecorderSource = {
  on(event: string, listener: (...args: any[]) => void): unknown;
  state: { sections(now?: number): Array<{ name: string; value: Obj; stale: boolean }> };
};

export type RecorderContext = { channel: string; gameVersion?: string; gameBuild?: string };

export type RecorderOptions = {
  dir: string;
  getContext: () => RecorderContext;
  isEnabled?: () => boolean;
  schemaBuild?: string;
  clientVersion?: string;
  /** All leaf field paths of the schema (see computeFieldUniverse) for "never seen non-default". */
  universe?: string[];
  /** Every GameEvent type name in the schema (counted as 0 in session_end when never fired). */
  gameEventTypes?: string[];
  maxFileBytes?: number;
  keepFiles?: number;
  flushMs?: number;
  changeMs?: number;
  now?: () => number;
  log?: (level: 'info' | 'warn' | 'debug', msg: string) => void;
};

/** The file is named (and session_start written) once the game version is known, or after this long. */
const NAME_WAIT_MS = 10_000;

type Session = {
  /** null until named: lines are buffered in memory meanwhile */
  file: string | null;
  channel: string;
  startIso: string;
  closed: boolean;
  bytes: number;
  capped: boolean;
  dropped: number;
  startedAt: number;
  frames: number;
  firstFrameAt: number;
  lastFrameAt: number;
  lastFlat: Map<string, string> | null;
  seen: Set<string>;
  nonDefault: Set<string>;
  gameEventCounts: Record<string, number>;
};

/** `a.b[3].c` → `a.b[].c` */
export const normalizePath = (p: string): string => p.replace(/\[\d+\]/g, '[]');

const DEFAULT_VALUES = new Set(['0', '0.00', '-0.00', 'false', '', '[]', '{}']);
export function isDefaultValue(v: string): boolean {
  return DEFAULT_VALUES.has(v) || /_UNSPECIFIED$/.test(v);
}

/** Leaf field paths (normalised, enums/scalars) of the telemetry response message, minus skipped sections. */
export function computeFieldUniverse(root: protobuf.Root, typeName = 'sc.game.telemetry.v1.TelemetryStreamResponse'): string[] {
  const out = new Set<string>();
  const walk = (type: protobuf.Type, prefix: string, stack: string[]): void => {
    for (const f of type.fieldsArray) {
      f.resolve();
      const name = f.name + (f.repeated && !f.map ? '[]' : '');
      const p = prefix ? `${prefix}.${name}` : name;
      if (!prefix && SKIP_SECTIONS.has(f.name)) continue;
      const t = f.resolvedType as protobuf.Type | protobuf.Enum | null;
      if (t && 'fieldsArray' in t && !f.map) {
        if (stack.includes(t.fullName)) continue; // recursive message: stop
        walk(t as protobuf.Type, p, [...stack, t.fullName]);
      } else {
        out.add(p);
      }
    }
  };
  walk(root.lookupType(typeName), '', []);
  return [...out].sort();
}

/** Raw GameEvent type names of the schema (e.g. GAME_EVENT_TYPE_ACTOR_DOWNED). */
export function computeGameEventTypes(root: protobuf.Root): string[] {
  try {
    return Object.keys(root.lookupEnum('sc.game.telemetry.v1.GameEvent.GameEventType').values);
  } catch {
    return [];
  }
}

export class TelemetryRecorder {
  readonly dir: string;
  #o: Required<Omit<RecorderOptions, 'universe' | 'schemaBuild' | 'clientVersion' | 'isEnabled' | 'log'>> &
    Pick<RecorderOptions, 'universe' | 'gameEventTypes' | 'schemaBuild' | 'clientVersion' | 'isEnabled' | 'log'>;
  #src: RecorderSource | null = null;
  #session: Session | null = null;
  #queue: Array<{ s: Session; line?: string; make?: () => string }> = [];
  #io: Promise<void> = Promise.resolve();
  #flushTimer: NodeJS.Timeout | null = null;
  #changeTimer: NodeJS.Timeout | null = null;
  #dirty = false;
  #status = 'disabled';
  #lastFileName = '';
  /** Files written by this recorder since start (tests / diagnostics). */
  filesWritten: string[] = [];

  constructor(opts: RecorderOptions) {
    this.dir = opts.dir;
    this.#o = { maxFileBytes: 50 * 1024 * 1024, keepFiles: 30, flushMs: 500, changeMs: 250, now: Date.now, ...opts } as any;
  }

  get sessionFile(): string | null {
    return this.#session?.file ?? null;
  }

  get active(): boolean {
    return !!this.#session;
  }

  attach(src: RecorderSource): void {
    this.#src = src;
    src.on('status', (s: string, prev: string) => this.#onStatus(s, prev));
    src.on('frame', (frame?: Obj) => this.#onFrame(frame));
    src.on('event', (e: TelemetryEvent) => this.#onEvent(e));
  }

  #enabled(): boolean {
    return this.#o.isEnabled ? this.#o.isEnabled() : true;
  }

  #iso(): string {
    return new Date(this.#o.now()).toISOString();
  }

  // --- source events -----------------------------------------------------------

  #onStatus(status: string, prev: string): void {
    this.#status = status;
    if (!this.#enabled()) return;
    if (status === 'streaming') this.#ensureSession();
    if (!this.#session) return;
    this.#write({ kind: 'status', status, prev });
    if (status === 'waiting_for_game' || status === 'disabled') this.endSession(`status:${status}`);
  }

  #onFrame(frame?: Obj): void {
    if (!this.#enabled()) {
      if (this.#session) this.endSession('recording_off');
      return;
    }
    const s = this.#ensureSession();
    if (!s) return;
    const now = this.#o.now();
    s.frames++;
    if (!s.firstFrameAt) s.firstFrameAt = now;
    s.lastFrameAt = now;
    if (frame) {
      for (const [name, value] of Object.entries(frame)) {
        if (!value || typeof value !== 'object') continue;
        if (name === 'events') {
          const list = (value as Obj).events;
          if (Array.isArray(list)) {
            for (const ge of list) {
              const type = String((ge as Obj)?.type ?? 'GAME_EVENT_TYPE_UNSPECIFIED'); // raw enum name
              s.gameEventCounts[type] = (s.gameEventCounts[type] ?? 0) + 1;
              this.#write({ kind: 'game_event', type, event: ge });
            }
          }
          continue;
        }
        if (SKIP_SECTIONS.has(name)) continue;
        for (const [p, v] of flatten(value, name, [], MAX_ROWS)) {
          const n = normalizePath(p);
          s.seen.add(n);
          if (!isDefaultValue(v)) s.nonDefault.add(n);
        }
      }
    }
    this.#dirty = true;
    if (!this.#changeTimer) {
      this.#changeTimer = setTimeout(() => {
        this.#changeTimer = null;
        this.sample();
      }, this.#o.changeMs);
      this.#changeTimer.unref?.();
    }
  }

  #onEvent(e: TelemetryEvent): void {
    if (!this.#enabled() || !this.#session) return;
    const { id, type, severity, summary, data } = e;
    this.#write({ kind: 'event', id, type, severity, summary, ...(data ? { data } : {}) });
  }

  // --- sessions ------------------------------------------------------------------

  #ensureSession(): Session | null {
    if (this.#session) return this.#session;
    if (this.#status !== 'streaming') return null;
    const ctx = this.#o.getContext();
    const now = this.#o.now();
    const s: Session = {
      file: null,
      channel: ctx.channel,
      startIso: new Date(now).toISOString(),
      closed: false,
      bytes: 0,
      capped: false,
      dropped: 0,
      startedAt: now,
      frames: 0,
      firstFrameAt: 0,
      lastFrameAt: 0,
      lastFlat: null,
      seen: new Set(),
      nonDefault: new Set(),
      gameEventCounts: Object.fromEntries((this.#o.gameEventTypes ?? []).map((t) => [t, 0])),
    };
    this.#session = s;
    // session_start is built when the file is named, so it carries the version learned meanwhile.
    this.#queue.push({
      s,
      make: () => {
        const c = this.#o.getContext();
        const same = c.channel === s.channel;
        return (
          JSON.stringify({
            t: s.startIso,
            kind: 'session_start',
            channel: s.channel,
            gameVersion: (same && c.gameVersion) || null,
            gameBuild: (same && c.gameBuild) || null,
            schemaBuild: this.#o.schemaBuild ?? null,
            clientVersion: this.#o.clientVersion ?? null,
          }) + '\n'
        );
      },
    });
    this.#scheduleFlush();
    return s;
  }

  /**
   * Name the session's file: `<start>_<channel>_<version>.log`. Waits (buffering) until the Game.log
   * header gave the version, up to NAME_WAIT_MS, so one session is one file.
   */
  #tryName(s: Session): boolean {
    if (s.file) return true;
    const c = this.#o.getContext();
    const version = c.channel === s.channel ? c.gameVersion || c.gameBuild : undefined;
    if (!version && !s.closed && this.#o.now() - s.startedAt < NAME_WAIT_MS) return false;
    const safe = (x: string) => x.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 40) || 'unknown';
    const stamp = s.startIso.replace(/\.\d+Z$/, '').replace(/:/g, '-');
    let name = `${stamp}_${safe(s.channel || 'unknown')}_${safe(version || 'unknown')}`;
    if (name === this.#lastFileName) name += `-${this.filesWritten.length}`;
    this.#lastFileName = name;
    const file = path.join(this.dir, `${name}.log`);
    s.file = file;
    this.filesWritten.push(file);
    this.#io = this.#io
      .then(async () => {
        await fsp.mkdir(this.dir, { recursive: true });
        await this.#prune(file);
      })
      .catch((err) => this.#o.log?.('warn', `Telemetry recorder: cannot prepare ${this.dir}: ${err}`));
    this.#o.log?.('info', `Telemetry recording to ${file}`);
    return true;
  }

  #scheduleFlush(): void {
    if (this.#flushTimer) return;
    this.#flushTimer = setTimeout(() => void this.flush(), this.#o.flushMs);
    this.#flushTimer.unref?.();
  }

  /**
   * A new Game.log started. Ends the session, except when it is still unnamed (the app just started
   * and is reading the log the running game already writes): that is the same game session.
   */
  onNewLog(channel: string): void {
    const s = this.#session;
    if (s && !s.file && s.channel === channel) return;
    this.endSession('new_log');
  }

  /** A Game.log line that telemetry should line up with (death, vehicle destroyed...). Only while a session is open. */
  noteLogMarker(marker: string, line: string): void {
    if (!this.#session || !this.#enabled()) return;
    this.#write({ kind: 'log_marker', marker, line: line.replace(/\r?\n$/, '').slice(0, 200) });
  }

  /** Diff the current state against the last recorded one (normally on the change timer). */
  sample(): void {
    const s = this.#session;
    if (!s || !this.#src || !this.#dirty) return;
    this.#dirty = false;
    const now = this.#o.now();
    const flat = new Map<string, string>();
    for (const sec of this.#src.state.sections(now)) {
      if (sec.stale || SKIP_SECTIONS.has(sec.name)) continue;
      for (const [p, v] of flatten(sec.value, sec.name, [], MAX_ROWS)) flat.set(p, v);
    }
    const changes: Record<string, [string | null, string | null]> = {};
    let n = 0;
    const prev = s.lastFlat;
    for (const [p, v] of flat) {
      const old = prev?.get(p);
      if (old !== v) {
        changes[p] = [old ?? null, v];
        n++;
      }
    }
    if (prev) {
      for (const [p, old] of prev) {
        if (!flat.has(p)) {
          changes[p] = [old, null];
          n++;
        }
      }
    }
    s.lastFlat = flat;
    if (n) this.#write({ kind: 'changes', n, ...(prev ? {} : { full: true }), changes });
  }

  /** Close the current session file (session_end with counters). Idempotent. */
  endSession(reason: string): void {
    const s = this.#session;
    if (!s) return;
    if (this.#changeTimer) clearTimeout(this.#changeTimer);
    this.#changeTimer = null;
    // The state may already be reset (stream ended): only sample while it still holds data.
    if (this.#src?.state.sections(this.#o.now()).some((x) => !x.stale)) this.sample();
    const uni = this.#o.universe;
    const never = uni ? uni.filter((p) => !s.nonDefault.has(p)) : null;
    const seconds = s.lastFrameAt > s.firstFrameAt ? (s.lastFrameAt - s.firstFrameAt) / 1000 : 0;
    this.#write(
      {
        kind: 'session_end',
        reason,
        durationMs: this.#o.now() - s.startedAt,
        frames: s.frames,
        fpsAvg: seconds ? Math.round(((s.frames - 1) / seconds) * 10) / 10 : 0,
        fieldsSeen: s.seen.size,
        fieldsNonDefault: s.nonDefault.size,
        fieldsKnown: uni?.length ?? null,
        neverNonDefaultCount: never?.length ?? null,
        neverNonDefault: never ? never.slice(0, 2000) : null,
        gameEventCounts: s.gameEventCounts,
        bytes: s.bytes,
        truncated: s.capped,
        droppedLines: s.dropped,
      },
      true,
    );
    s.closed = true;
    this.#session = null;
    this.#dirty = false;
    void this.flush();
  }

  /** Write everything buffered. Resolves when the disk writes are done. */
  flush(): Promise<void> {
    if (this.#flushTimer) clearTimeout(this.#flushTimer);
    this.#flushTimer = null;
    const all = this.#queue.splice(0);
    // lines of a session that has no file name yet stay buffered
    const items = all.filter((it) => this.#tryName(it.s));
    this.#queue.push(...all.filter((it) => !it.s.file));
    if (this.#queue.length) this.#scheduleFlush();
    if (items.length) {
      this.#io = this.#io.then(async () => {
        // consecutive lines of one file go in one append
        let i = 0;
        while (i < items.length) {
          let j = i;
          let text = '';
          while (j < items.length && items[j].s === items[i].s) {
            text += items[j].line ?? items[j].make!();
            j++;
          }
          try {
            await fsp.appendFile(items[i].s.file!, text);
          } catch (err) {
            this.#o.log?.('warn', `Telemetry recorder write failed: ${err}`);
          }
          i = j;
        }
      });
    }
    return this.#io;
  }

  /** App quit / telemetry stopped: end the session and wait for the writes. */
  async close(reason = 'shutdown'): Promise<void> {
    this.endSession(reason);
    await this.flush();
  }

  // --- internals -------------------------------------------------------------------

  #write(obj: Obj, always = false): void {
    const s = this.#session;
    if (!s) return;
    const line = JSON.stringify({ t: this.#iso(), ...obj }) + '\n';
    if (!always && s.bytes + line.length > this.#o.maxFileBytes) {
      if (!s.capped) {
        s.capped = true;
        const marker = JSON.stringify({ t: this.#iso(), kind: 'truncated', maxFileBytes: this.#o.maxFileBytes }) + '\n';
        s.bytes += marker.length;
        this.#queue.push({ s, line: marker });
      }
      s.dropped++;
      return;
    }
    s.bytes += line.length;
    this.#queue.push({ s, line });
    this.#scheduleFlush();
  }

  /** Keep the newest `keepFiles` recordings (the file being created counts as one). */
  async #prune(current: string): Promise<void> {
    const files = (await fsp.readdir(this.dir)).filter((f) => FILE_RE.test(f) && path.join(this.dir, f) !== current).sort();
    const excess = files.length - Math.max(0, this.#o.keepFiles - 1);
    for (const f of files.slice(0, Math.max(0, excess))) {
      await fsp.unlink(path.join(this.dir, f)).catch(() => {});
    }
  }
}
