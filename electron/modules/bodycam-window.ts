/**
 * Which process owns a window? Used to make sure the window we are about to capture really belongs
 * to StarCitizen.exe (a browser tab or Explorer window can have the same title).
 *
 * No native dependencies: a FIXED PowerShell script calls user32!GetWindowThreadProcessId. The only
 * input is the numeric HWND, validated as digits and embedded as a quoted literal in an
 * -EncodedCommand script (never concatenated from any other string).
 */
import { execFile } from 'node:child_process';

export const GAME_PROCESS_NAME = 'starcitizen.exe';

/** HWND from an Electron window source id: "window:<hwnd>:<n>". Null for anything else (screens...). */
export function hwndFromSourceId(id: string): string | null {
  const m = /^window:(\d{1,20}):\d+$/.exec(id);
  return m ? m[1] : null;
}

/** Fixed script body; the (digits-only) HWND is prepended as `$h = '<digits>'` by buildScript(). */
export const PS_SCRIPT = [
  "$ErrorActionPreference='Stop'",
  'Add-Type -Namespace VL -Name Win -MemberDefinition \'[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(System.IntPtr h, out uint p);\'',
  '$procId = [uint32]0',
  '[void][VL.Win]::GetWindowThreadProcessId([System.IntPtr][int64]$h, [ref]$procId)',
  'if ($procId -eq 0) { exit 3 }',
  '(Get-Process -Id $procId).ProcessName + ".exe"',
].join('; ');

export function buildScript(hwnd: string): string {
  if (!/^\d{1,20}$/.test(hwnd)) throw new Error('bad hwnd');
  return `$h = '${hwnd}'; ${PS_SCRIPT}`;
}

export type ExecFn = (file: string, args: string[], opts: { windowsHide: boolean; timeout: number }, cb: (err: Error | null, stdout: string) => void) => unknown;

/** Resolve the owning process image name (lower-case, e.g. "starcitizen.exe"), or null when unknown. */
export function resolveWindowProcessName(hwnd: string, exec: ExecFn = execFile as unknown as ExecFn): Promise<string | null> {
  if (!/^\d{1,20}$/.test(hwnd)) return Promise.resolve(null);
  return new Promise((resolve) => {
    exec(
      'powershell.exe',
      // -EncodedCommand (UTF-16LE base64) avoids every quoting problem; the script is fixed apart from the digits-only HWND.
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(buildScript(hwnd), 'utf16le').toString('base64')],
      { windowsHide: true, timeout: 8000 },
      (err, stdout) => {
        if (err) return resolve(null);
        const name = String(stdout).trim().toLowerCase();
        resolve(/^[a-z0-9 ._-]{1,64}$/.test(name) ? name : null);
      },
    );
  });
}

/** Per-HWND cache so the (slow) PowerShell call is not made for every frame. Positive AND negative results expire. */
export function makeProcessChecker(resolve: (hwnd: string) => Promise<string | null>, opts: { ttlMs?: number; now?: () => number } = {}) {
  const ttl = opts.ttlMs ?? 30_000;
  const now = opts.now ?? Date.now;
  const cache = new Map<string, { at: number; ok: boolean }>();
  return async (hwnd: string): Promise<boolean> => {
    const hit = cache.get(hwnd);
    if (hit && now() - hit.at < ttl) return hit.ok;
    const name = await resolve(hwnd);
    const ok = name === GAME_PROCESS_NAME;
    cache.set(hwnd, { at: now(), ok });
    if (cache.size > 50) cache.delete(cache.keys().next().value as string);
    return ok;
  };
}
