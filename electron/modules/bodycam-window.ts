/**
 * Does this window belong to StarCitizen.exe? Used to make sure the window we are about to capture
 * is really the game (a browser tab or Explorer window can have the same title).
 *
 * No native dependencies and no compiled code: a FIXED PowerShell one-liner compares the window
 * handle with the MainWindowHandle of every StarCitizen process. The only input is the numeric HWND,
 * validated as digits and embedded as a quoted literal in an -EncodedCommand script. PowerShell is
 * started from its absolute path under %SystemRoot% (never resolved through PATH).
 */
import { execFile } from 'node:child_process';
import path from 'node:path';

export const GAME_PROCESS_NAME = 'StarCitizen';

/** 'yes' / 'no' = the check ran; 'unknown' = it could not run (PowerShell missing, timeout, odd output). */
export type WindowCheck = 'yes' | 'no' | 'unknown';

/** HWND from an Electron window source id: "window:<hwnd>:<n>". Null for anything else (screens...). */
export function hwndFromSourceId(id: string): string | null {
  const m = /^window:(\d{1,20}):\d+$/.exec(id);
  return m ? m[1] : null;
}

/** Fixed script body; the (digits-only) HWND is prepended as `$h = '<digits>'` by buildScript(). */
export const PS_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  `$m = @(Get-Process -Name ${GAME_PROCESS_NAME} -ErrorAction SilentlyContinue | ForEach-Object { $_.MainWindowHandle.ToInt64() })`,
  "if ($m -contains [int64]$h) { 'yes' } else { 'no' }",
].join('; ');

export function buildScript(hwnd: string): string {
  if (!/^\d{1,20}$/.test(hwnd)) throw new Error('bad hwnd');
  return `$h = '${hwnd}'; ${PS_SCRIPT}`;
}

export function powershellPath(env: NodeJS.ProcessEnv = process.env): string {
  const root = env.SystemRoot || env.SYSTEMROOT || 'C:\\Windows';
  return path.win32.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
}

export type ExecFn = (file: string, args: string[], opts: { windowsHide: boolean; timeout: number }, cb: (err: Error | null, stdout: string) => void) => unknown;

/** Run the check for one HWND. */
export function checkGameWindow(hwnd: string, exec: ExecFn = execFile as unknown as ExecFn, env: NodeJS.ProcessEnv = process.env): Promise<WindowCheck> {
  if (!/^\d{1,20}$/.test(hwnd)) return Promise.resolve('unknown');
  return new Promise((resolve) => {
    exec(
      powershellPath(env),
      // -EncodedCommand (UTF-16LE base64) avoids every quoting problem; the script is fixed apart from the digits-only HWND.
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(buildScript(hwnd), 'utf16le').toString('base64')],
      { windowsHide: true, timeout: 8000 },
      (err, stdout) => {
        if (err) return resolve('unknown');
        const out = String(stdout).trim();
        resolve(out === 'yes' ? 'yes' : out === 'no' ? 'no' : 'unknown');
      },
    );
  });
}

/**
 * Short per-HWND cache (default 3 s) so back-to-back calls do not each start PowerShell, but a window
 * that stops being the game is noticed within seconds. 'unknown' is never cached. `fresh` bypasses
 * the cache (used immediately before opening a capture). Windows handles can be recycled, so the
 * cache is deliberately tiny; the process id is not part of the key because it is not known without
 * running the check.
 */
export function makeProcessChecker(check: (hwnd: string) => Promise<WindowCheck>, opts: { ttlMs?: number; now?: () => number } = {}) {
  const ttl = opts.ttlMs ?? 3000;
  const now = opts.now ?? Date.now;
  const cache = new Map<string, { at: number; v: 'yes' | 'no' }>();
  return async (hwnd: string, o: { fresh?: boolean } = {}): Promise<WindowCheck> => {
    const hit = cache.get(hwnd);
    if (!o.fresh && hit && now() - hit.at < ttl) return hit.v;
    const v = await check(hwnd);
    if (v === 'unknown') cache.delete(hwnd);
    else cache.set(hwnd, { at: now(), v });
    if (cache.size > 50) cache.delete(cache.keys().next().value as string);
    return v;
  };
}
