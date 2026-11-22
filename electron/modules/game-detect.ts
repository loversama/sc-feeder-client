/**
 * "Is Star Citizen running?" - ONE shared detector for the body-cam, the debug overlay and the party overlay.
 *
 * History: three places each ran `tasklist /FI "IMAGENAME eq StarCitizen.exe"` with a 4 s timeout and turned every
 * error into "not running". With the game loaded, that tasklist call takes ~6 s, so it was killed every poll and the
 * game was never "detected" (no body-cam, no overlay). This module:
 *
 *  - uses the cheap, instant signals first: the game's telemetry connection (streaming / connected) and Game.log
 *    written in the last 2 minutes;
 *  - falls back to a process check that is allowed to be slow (20 s timeout), never overlaps itself, runs at most
 *    every 15 s, and uses the faster of `tasklist /FO CSV /NH` (no /FI) and PowerShell `Get-Process` (both are timed
 *    on the first check; the faster successful one is used afterwards, the other is the fallback);
 *  - keeps a positive result for 60 s so one slow or failed check cannot flip the game to "not running";
 *  - never swallows an error: the last error and the measured durations are exposed (settings status, Diagnose).
 *
 * The game's executable is StarCitizen.exe in every channel (LIVE / PTU / EPTU / TECH-PREVIEW differ by folder, not
 * name); matched case-insensitively. Launcher processes are recognised only to give a better hint.
 */
import { execFile } from 'node:child_process';
import path from 'node:path';

export const GAME_EXE_LOWER = 'starcitizen.exe';
export const LAUNCHER_EXES_LOWER = ['starcitizen_launcher.exe', 'rsi launcher.exe', 'rsilauncher.exe'];
/** Game.log written within this long counts as "the game is writing logs". */
export const LOG_ACTIVE_MS = 120_000;
/** The process check may be slow on a loaded machine (tasklist with the game running took ~6 s). */
export const PROCESS_CHECK_TIMEOUT_MS = 20_000;
/** Minimum gap between process checks. */
export const PROCESS_CHECK_EVERY_MS = 15_000;
/** A positive result survives a failed or negative check this long. */
export const POSITIVE_CACHE_MS = 60_000;
/** Watcher tick (the cheap signals are evaluated each tick). */
export const WATCH_TICK_MS = 5_000;

export type DetectStep = { step: string; ok: boolean; found: boolean; detail: string; durationMs?: number };
export type DetectVia = 'telemetry' | 'game-log' | 'tasklist' | 'powershell' | 'cached';
export type GameDetection = {
  running: boolean;
  /** which signal said yes (null = not running / unknown) */
  via: DetectVia | null;
  /** set only when NO process check could run and no signal said "running": "tasklist: ...; powershell: ..." */
  error: string | null;
  /** launcher seen but not the game */
  launcherOnly: boolean;
  steps: DetectStep[];
  checkedAt: number;
  /** measured duration of the last process check per method (ms) */
  durations: { tasklist?: number; powershell?: number };
};

export type ExecFn = (file: string, args: string[], opts: { windowsHide: boolean; timeout: number; maxBuffer: number }, cb: (err: (Error & { code?: unknown; killed?: boolean }) | null, stdout: string, stderr: string) => void) => unknown;

export type DetectDeps = {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  exec?: ExecFn;
  now?: () => number;
  timeoutMs?: number;
  /** TelemetryService status ('streaming' / 'connected' mean the game's telemetry endpoint answers). */
  telemetryStatus?: () => string | null | undefined;
  /** mtime (ms) of the current Game.log, or null when it cannot be read. */
  gameLogMtimeMs?: () => Promise<number | null>;
};

export function systemExe(env: NodeJS.ProcessEnv, ...rel: string[]): string {
  const root = env.SystemRoot || env.SYSTEMROOT || env.windir || 'C:\\Windows';
  return path.win32.join(root, ...rel);
}
export const tasklistPath = (env: NodeJS.ProcessEnv = process.env) => systemExe(env, 'System32', 'tasklist.exe');
export const powershellPath = (env: NodeJS.ProcessEnv = process.env) => systemExe(env, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');

/** One CSV line -> fields (handles quotes and "" escapes). */
export function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else q = false;
      } else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') {
      out.push(cur);
      cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out;
}

/** `tasklist /FO CSV /NH` output -> [{ image, pid }]. Non-CSV lines (INFO: ..., errors) are ignored. */
export function parseTasklistCsv(stdout: string): Array<{ image: string; pid: string }> {
  const rows: Array<{ image: string; pid: string }> = [];
  for (const raw of String(stdout).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line.startsWith('"')) continue;
    const f = parseCsvLine(line);
    if (f.length >= 2 && f[0]) rows.push({ image: f[0], pid: f[1] });
  }
  return rows;
}

const PS_SCRIPT = "$ErrorActionPreference = 'Stop'; $p = @(Get-Process -Name StarCitizen -ErrorAction SilentlyContinue); if ($p.Count -gt 0) { 'yes ' + $p[0].Id } else { 'no' }";

type ExecResult = { err: (Error & { code?: unknown; killed?: boolean }) | null; stdout: string; stderr: string; ms: number };

function run(exec: ExecFn, now: () => number, file: string, args: string[], timeout: number): Promise<ExecResult> {
  const t0 = now();
  return new Promise((resolve) => {
    const done = (err: ExecResult['err'], stdout: unknown, stderr: unknown) => resolve({ err, stdout: String(stdout ?? ''), stderr: String(stderr ?? ''), ms: Math.max(0, now() - t0) });
    try {
      exec(file, args, { windowsHide: true, timeout, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => done(err, stdout, stderr));
    } catch (e) {
      done(e as Error, '', '');
    }
  });
}

function why(err: NonNullable<ExecResult['err']>, stderr: string, timeout: number): string {
  if (err.killed) return `timed out after ${Math.round(timeout / 1000)} s`;
  const code = err.code !== undefined ? ` (${String(err.code)})` : '';
  const extra = stderr.trim() ? `: ${stderr.trim().slice(0, 120)}` : '';
  return `${err.message.split('\n')[0].slice(0, 160)}${code}${extra}`;
}

type ProcResult = { step: DetectStep; found: boolean; launcher: boolean };

async function checkTasklist(deps: DetectDeps): Promise<ProcResult> {
  const env = deps.env ?? process.env;
  const timeout = deps.timeoutMs ?? PROCESS_CHECK_TIMEOUT_MS;
  const r = await run(deps.exec ?? (execFile as unknown as ExecFn), deps.now ?? Date.now, tasklistPath(env), ['/FO', 'CSV', '/NH'], timeout);
  if (r.err) return { step: { step: 'tasklist', ok: false, found: false, detail: `could not run ${tasklistPath(env)}: ${why(r.err, r.stderr, timeout)}`, durationMs: r.ms }, found: false, launcher: false };
  const rows = parseTasklistCsv(r.stdout);
  const game = rows.find((x) => x.image.toLowerCase() === GAME_EXE_LOWER);
  const launcher = rows.find((x) => LAUNCHER_EXES_LOWER.includes(x.image.toLowerCase()));
  let detail = game ? `${game.image} is running (pid ${game.pid}, ${rows.length} processes listed)` : rows.length ? `StarCitizen.exe is not in the process list (${rows.length} processes listed)` : 'tasklist returned no process rows';
  if (!game && launcher) detail += `; ${launcher.image} is running (launcher only)`;
  return { step: { step: 'tasklist', ok: true, found: !!game, detail, durationMs: r.ms }, found: !!game, launcher: !game && !!launcher };
}

async function checkPowershell(deps: DetectDeps): Promise<ProcResult> {
  const env = deps.env ?? process.env;
  const timeout = deps.timeoutMs ?? PROCESS_CHECK_TIMEOUT_MS;
  const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(PS_SCRIPT, 'utf16le').toString('base64')];
  const r = await run(deps.exec ?? (execFile as unknown as ExecFn), deps.now ?? Date.now, powershellPath(env), args, timeout);
  if (r.err) return { step: { step: 'powershell', ok: false, found: false, detail: `could not run ${powershellPath(env)}: ${why(r.err, r.stderr, timeout)}`, durationMs: r.ms }, found: false, launcher: false };
  const out = r.stdout.trim();
  const m = /^yes (\d+)/.exec(out);
  const ok = out === 'no' || !!m;
  return { step: { step: 'powershell', ok, found: !!m, detail: m ? `Get-Process StarCitizen: pid ${m[1]}` : out === 'no' ? 'Get-Process StarCitizen: no such process' : `unexpected output: ${out.slice(0, 80)}`, durationMs: r.ms }, found: !!m, launcher: false };
}

/** The two cheap signals. Returns the steps and whether one said "running". */
async function checkSignals(deps: DetectDeps): Promise<{ steps: DetectStep[]; via: 'telemetry' | 'game-log' | null }> {
  const steps: DetectStep[] = [];
  let via: 'telemetry' | 'game-log' | null = null;
  if (deps.telemetryStatus) {
    const ts = deps.telemetryStatus();
    const up = ts === 'streaming' || ts === 'connected';
    steps.push({ step: 'telemetry', ok: true, found: up, detail: `telemetry connection: ${ts ?? 'unavailable'}` });
    if (up) via = 'telemetry';
  }
  if (deps.gameLogMtimeMs) {
    let mtime: number | null = null;
    try {
      mtime = await deps.gameLogMtimeMs();
    } catch {
      mtime = null;
    }
    const now = (deps.now ?? Date.now)();
    if (mtime === null) steps.push({ step: 'game-log', ok: false, found: false, detail: 'Game.log could not be read (not found?)' });
    else {
      const age = now - mtime;
      const active = age >= 0 && age < LOG_ACTIVE_MS;
      steps.push({ step: 'game-log', ok: true, found: active, detail: active ? `Game.log written ${Math.round(age / 1000)} s ago` : `Game.log last written ${Math.round(age / 60000)} min ago` });
      if (active && !via) via = 'game-log';
    }
  }
  return { steps, via };
}

export function emptyDetection(now: number): GameDetection {
  return { running: false, via: null, error: null, launcherOnly: false, steps: [], checkedAt: now, durations: {} };
}

/**
 * Diagnose: EVERYTHING once, sequentially (signals, tasklist, PowerShell), each step timed. `running` = any positive.
 */
export async function detectGame(deps: DetectDeps = {}): Promise<GameDetection> {
  const platform = deps.platform ?? process.platform;
  const now = deps.now ?? Date.now;
  const out = emptyDetection(now());
  if (platform !== 'win32') {
    out.steps.push({ step: 'platform', ok: true, found: false, detail: 'game detection is only available on Windows' });
    return out;
  }
  const sig = await checkSignals(deps);
  out.steps.push(...sig.steps);
  const tl = await checkTasklist(deps);
  const ps = await checkPowershell(deps);
  out.steps.push(tl.step, ps.step);
  out.durations = { tasklist: tl.step.durationMs, powershell: ps.step.durationMs };
  out.launcherOnly = tl.launcher;
  if (sig.via) {
    out.running = true;
    out.via = sig.via;
  }
  if (tl.found) {
    out.running = true;
    out.via ??= 'tasklist';
  }
  if (ps.found) {
    out.running = true;
    out.via ??= 'powershell';
  }
  if (!out.running && !tl.step.ok && !ps.step.ok) out.error = `${tl.step.step}: ${tl.step.detail}; ${ps.step.step}: ${ps.step.detail}`;
  return out;
}

/** User-facing line for a failed detection ("Could not check for the game: ..."), or undefined. */
export function detectionMessage(d: GameDetection | null | undefined): string | undefined {
  if (!d) return undefined;
  if (d.error) return `Could not check for the game: ${d.error}`;
  if (!d.running && d.launcherOnly) return 'Only the launcher is running; start the game itself (StarCitizen.exe)';
  return undefined;
}

export type WatcherDeps = DetectDeps & {
  log?: (level: 'info' | 'warn' | 'debug', msg: string) => void;
  /** called after every tick (the overlays refresh here) */
  onTick?: (d: GameDetection) => void;
  /** called when running flips */
  onChange?: (running: boolean, d: GameDetection) => void;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (t: unknown) => void;
};

/**
 * Keeps the current detection up to date. Cheap signals every tick; the (slow) process check at most every
 * PROCESS_CHECK_EVERY_MS, never overlapping; a positive result is kept POSITIVE_CACHE_MS.
 */
export class GameWatcher {
  #d: WatcherDeps;
  #timer: unknown = null;
  #inFlight = false;
  #lastProcessCheckAt = -Infinity;
  #lastPositiveAt = -Infinity;
  #lastProcessPositiveVia: 'tasklist' | 'powershell' | null = null;
  #preferred: 'tasklist' | 'powershell' | null = null;
  #checks = 0;
  #lastError: string | null = null;
  detection: GameDetection;

  constructor(deps: WatcherDeps = {}) {
    this.#d = deps;
    this.detection = emptyDetection((deps.now ?? Date.now)());
  }

  get running(): boolean {
    return this.detection.running;
  }

  start(): void {
    if (this.#timer) return;
    const set = this.#d.setTimer ?? ((fn: () => void, ms: number) => setInterval(fn, ms));
    void this.tick();
    this.#timer = set(() => void this.tick(), WATCH_TICK_MS);
    (this.#timer as { unref?: () => void })?.unref?.();
  }

  stop(): void {
    if (this.#timer) (this.#d.clearTimer ?? ((t: unknown) => clearInterval(t as NodeJS.Timeout)))(this.#timer);
    this.#timer = null;
    this.detection = emptyDetection((this.#d.now ?? Date.now)());
  }

  get started(): boolean {
    return this.#timer !== null;
  }

  /** One evaluation (exported for tests). Never throws, never overlaps. */
  async tick(): Promise<GameDetection> {
    if (this.#inFlight) return this.detection;
    this.#inFlight = true;
    const now = this.#d.now ?? Date.now;
    const prevRunning = this.detection.running;
    try {
      const t = now();
      const platform = this.#d.platform ?? process.platform;
      let next: GameDetection = { ...emptyDetection(t), durations: this.detection.durations };
      if (platform !== 'win32') {
        next.steps.push({ step: 'platform', ok: true, found: false, detail: 'game detection is only available on Windows' });
      } else {
        const sig = await checkSignals(this.#d);
        next.steps.push(...sig.steps);
        if (sig.via) {
          next.running = true;
          next.via = sig.via;
          this.#lastPositiveAt = t;
        } else if (t - this.#lastProcessCheckAt >= PROCESS_CHECK_EVERY_MS) {
          this.#lastProcessCheckAt = t;
          const proc = await this.#processCheck();
          next.steps.push(...proc.steps);
          next.durations = { ...next.durations, ...proc.durations };
          next.launcherOnly = proc.launcherOnly;
          if (proc.found) {
            next.running = true;
            next.via = proc.found;
            this.#lastPositiveAt = t;
            this.#lastProcessPositiveVia = proc.found;
          } else if (proc.error) next.error = proc.error;
        } else {
          // between process checks: carry the last process verdict forward
          next.steps.push(...this.detection.steps.filter((s) => s.step === 'tasklist' || s.step === 'powershell'));
          next.launcherOnly = this.detection.launcherOnly;
          next.error = this.detection.error;
          if (this.#lastProcessPositiveVia && this.detection.via === this.#lastProcessPositiveVia) {
            next.running = true;
            next.via = this.detection.via;
          }
        }
        // a positive survives a slow/failed/negative check for POSITIVE_CACHE_MS
        if (!next.running && t - this.#lastPositiveAt < POSITIVE_CACHE_MS) {
          next.running = true;
          next.via = 'cached';
          next.error = null;
        }
      }
      this.detection = next;
      this.#report(prevRunning);
    } catch (err) {
      this.detection = { ...emptyDetection(now()), error: `detection crashed: ${(err as Error).message}` };
      this.#d.log?.('warn', this.detection.error!);
    } finally {
      this.#inFlight = false;
    }
    try {
      this.#d.onTick?.(this.detection);
    } catch (err) {
      this.#d.log?.('debug', `game watcher onTick failed: ${err}`);
    }
    return this.detection;
  }

  #report(prevRunning: boolean): void {
    const d = this.detection;
    if (d.error && d.error !== this.#lastError) this.#d.log?.('warn', `Game detection failed: ${d.error}`);
    else if (!d.error && this.#lastError) this.#d.log?.('info', 'Game detection works again');
    this.#lastError = d.error;
    if (d.running !== prevRunning) {
      this.#d.log?.('info', d.running ? `Star Citizen detected (via ${d.via}${d.durations.tasklist || d.durations.powershell ? `; last process check: tasklist ${d.durations.tasklist ?? '-'} ms, PowerShell ${d.durations.powershell ?? '-'} ms` : ''})` : 'Star Citizen no longer detected');
      this.#d.onChange?.(d.running, d);
    }
  }

  /** The process check: first time both methods are timed (in parallel), afterwards the faster one, falling back to the other. */
  async #processCheck(): Promise<{ found: 'tasklist' | 'powershell' | null; error: string | null; steps: DetectStep[]; durations: { tasklist?: number; powershell?: number }; launcherOnly: boolean }> {
    const d = this.#d;
    this.#checks++;
    const remeasure = this.#preferred === null || this.#checks % 20 === 0;
    const steps: DetectStep[] = [];
    const durations: { tasklist?: number; powershell?: number } = {};
    let launcherOnly = false;
    const record = (r: ProcResult) => {
      steps.push(r.step);
      durations[r.step.step as 'tasklist' | 'powershell'] = r.step.durationMs;
      if (r.launcher) launcherOnly = true;
    };
    let results: ProcResult[];
    if (remeasure) {
      results = await Promise.all([checkTasklist(d), checkPowershell(d)]);
      results.forEach(record);
      const okOnes = results.filter((r) => r.step.ok);
      if (okOnes.length) this.#preferred = okOnes.sort((a, b) => (a.step.durationMs ?? 0) - (b.step.durationMs ?? 0))[0].step.step as 'tasklist' | 'powershell';
    } else {
      const first = this.#preferred === 'powershell' ? checkPowershell : checkTasklist;
      const second = this.#preferred === 'powershell' ? checkTasklist : checkPowershell;
      const r1 = await first(d);
      record(r1);
      results = [r1];
      if (!r1.step.ok) {
        const r2 = await second(d);
        record(r2);
        results.push(r2);
        if (r2.step.ok) this.#preferred = r2.step.step as 'tasklist' | 'powershell';
      }
    }
    const found = results.find((r) => r.found);
    const allFailed = results.every((r) => !r.step.ok);
    return {
      found: found ? (found.step.step as 'tasklist' | 'powershell') : null,
      error: !found && allFailed ? results.map((r) => `${r.step.step}: ${r.step.detail}`).join('; ') : null,
      steps,
      durations,
      launcherOnly,
    };
  }
}
