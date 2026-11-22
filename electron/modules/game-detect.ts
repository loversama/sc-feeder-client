/**
 * "Is Star Citizen running?" for the body-cam (and anything else that needs it).
 *
 * The old check ran `tasklist` through PATH and turned every error into "not running", silently. This
 * one resolves the system tools by absolute path, parses the CSV properly, falls back to PowerShell
 * (Get-Process) and to other signals (telemetry connection, Game.log activity), and NEVER swallows an
 * error: every step reports what it did, and when no process check could run at all the reason is
 * returned so the UI can show it.
 *
 * The game's executable is StarCitizen.exe in every channel (LIVE / PTU / EPTU / TECH-PREVIEW use
 * different folders, not different names); it is matched case-insensitively. The launcher processes
 * are recognised only to give a better hint ("only the launcher is running").
 */
import { execFile } from 'node:child_process';
import path from 'node:path';

export const GAME_EXE_LOWER = 'starcitizen.exe';
export const LAUNCHER_EXES_LOWER = ['starcitizen_launcher.exe', 'rsi launcher.exe', 'rsilauncher.exe'];
/** Game.log written within this long counts as "the game is writing logs". */
export const LOG_ACTIVE_MS = 60_000;

export type DetectStep = { step: string; ok: boolean; found: boolean; detail: string };
export type GameDetection = {
  running: boolean;
  /** which signal said yes (null = not running / unknown) */
  via: 'tasklist' | 'powershell' | 'telemetry' | 'game-log' | null;
  /** set only when NO process check could run: "tasklist: ...; powershell: ..." */
  error: string | null;
  /** launcher seen but not the game */
  launcherOnly: boolean;
  steps: DetectStep[];
  checkedAt: number;
};

export type ExecFn = (file: string, args: string[], opts: { windowsHide: boolean; timeout: number; maxBuffer: number }, cb: (err: (Error & { code?: unknown }) | null, stdout: string, stderr: string) => void) => unknown;

export type DetectDeps = {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  exec?: ExecFn;
  now?: () => number;
  /** TelemetryService status ('streaming' / 'connected' mean the game's telemetry endpoint answers). */
  telemetryStatus?: () => string | null | undefined;
  /** mtime (ms) of the current Game.log, or null when it cannot be read. */
  gameLogMtimeMs?: () => Promise<number | null>;
  /** Run the PowerShell fallback even when tasklist worked (Diagnose). */
  full?: boolean;
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

function run(exec: ExecFn, file: string, args: string[], timeout: number): Promise<{ err: (Error & { code?: unknown }) | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    try {
      exec(file, args, { windowsHide: true, timeout, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => resolve({ err, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') }));
    } catch (e) {
      resolve({ err: e as Error, stdout: '', stderr: '' });
    }
  });
}

function why(err: Error & { code?: unknown }, stderr: string): string {
  const code = err.code !== undefined ? ` (${String(err.code)})` : '';
  const extra = stderr.trim() ? `: ${stderr.trim().slice(0, 120)}` : '';
  return `${err.message.split('\n')[0].slice(0, 160)}${code}${extra}`;
}

/** Run the detection. Cheap path: tasklist only; fallbacks run when it cannot decide (or `full`). */
export async function detectGame(deps: DetectDeps = {}): Promise<GameDetection> {
  const platform = deps.platform ?? process.platform;
  const env = deps.env ?? process.env;
  const exec = deps.exec ?? (execFile as unknown as ExecFn);
  const now = deps.now ?? Date.now;
  const steps: DetectStep[] = [];
  const result: GameDetection = { running: false, via: null, error: null, launcherOnly: false, steps, checkedAt: now() };

  if (platform !== 'win32') {
    steps.push({ step: 'platform', ok: true, found: false, detail: 'game detection is only available on Windows' });
    return result;
  }

  // 1. tasklist (absolute path, full list parsed in code so name case and the launcher are visible)
  let tasklistOk = false;
  const tl = await run(exec, tasklistPath(env), ['/FO', 'CSV', '/NH'], 8000);
  if (tl.err) {
    steps.push({ step: 'tasklist', ok: false, found: false, detail: `could not run ${tasklistPath(env)}: ${why(tl.err, tl.stderr)}` });
  } else {
    tasklistOk = true;
    const rows = parseTasklistCsv(tl.stdout);
    const game = rows.find((r) => r.image.toLowerCase() === GAME_EXE_LOWER);
    const launcher = rows.find((r) => LAUNCHER_EXES_LOWER.includes(r.image.toLowerCase()));
    steps.push({
      step: 'tasklist',
      ok: true,
      found: !!game,
      detail: game ? `${game.image} is running (pid ${game.pid}, ${rows.length} processes listed)` : rows.length ? `StarCitizen.exe is not in the process list (${rows.length} processes listed)` : 'tasklist returned no process rows',
    });
    if (game) {
      result.running = true;
      result.via = 'tasklist';
    } else if (launcher) {
      result.launcherOnly = true;
      steps[steps.length - 1].detail += `; ${launcher.image} is running (launcher only)`;
    }
  }

  // 2. PowerShell Get-Process (when tasklist could not run, or in Diagnose)
  let psOk = false;
  if (!result.running && (!tasklistOk || deps.full)) {
    const ps = await run(exec, powershellPath(env), ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(PS_SCRIPT, 'utf16le').toString('base64')], 10_000);
    if (ps.err) {
      steps.push({ step: 'powershell', ok: false, found: false, detail: `could not run ${powershellPath(env)}: ${why(ps.err, ps.stderr)}` });
    } else {
      const out = ps.stdout.trim();
      const m = /^yes (\d+)/.exec(out);
      psOk = out === 'no' || !!m;
      steps.push({ step: 'powershell', ok: psOk, found: !!m, detail: m ? `Get-Process StarCitizen: pid ${m[1]}` : out === 'no' ? 'Get-Process StarCitizen: no such process' : `unexpected output: ${out.slice(0, 80)}` });
      if (m) {
        result.running = true;
        result.via = 'powershell';
      }
    }
  }

  // 3. other signals: the game's telemetry endpoint answering, Game.log being written
  if (!result.running) {
    const ts = deps.telemetryStatus?.();
    if (deps.telemetryStatus) {
      const up = ts === 'streaming' || ts === 'connected';
      steps.push({ step: 'telemetry', ok: true, found: up, detail: `telemetry connection: ${ts ?? 'unavailable'}` });
      if (up) {
        result.running = true;
        result.via = 'telemetry';
      }
    }
  }
  if (!result.running && deps.gameLogMtimeMs) {
    let mtime: number | null = null;
    try {
      mtime = await deps.gameLogMtimeMs();
    } catch {
      mtime = null;
    }
    if (mtime === null) {
      steps.push({ step: 'game-log', ok: false, found: false, detail: 'Game.log could not be read (not found?)' });
    } else {
      const age = now() - mtime;
      const active = age >= 0 && age < LOG_ACTIVE_MS;
      steps.push({ step: 'game-log', ok: true, found: active, detail: active ? `Game.log written ${Math.round(age / 1000)} s ago` : `Game.log last written ${Math.round(age / 60000)} min ago` });
      if (active) {
        result.running = true;
        result.via = 'game-log';
      }
    }
  }

  // Error = no process check could decide AND nothing else said "running".
  const processStepsRan = tasklistOk || psOk;
  if (!result.running && !processStepsRan) {
    result.error = steps
      .filter((s) => (s.step === 'tasklist' || s.step === 'powershell') && !s.ok)
      .map((s) => `${s.step}: ${s.detail}`)
      .join('; ');
  }
  return result;
}

/** User-facing line for a failed detection ("Could not check for the game: ..."), or undefined. */
export function detectionMessage(d: GameDetection | null | undefined): string | undefined {
  if (!d) return undefined;
  if (d.error) return `Could not check for the game: ${d.error}`;
  if (!d.running && d.launcherOnly) return 'Only the launcher is running; start the game itself (StarCitizen.exe)';
  return undefined;
}
