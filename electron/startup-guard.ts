/** Pure helpers for the main-process bootstrap (electron/main.ts). No Electron imports. */

/** A module/package that could not be resolved, e.g. app files still being written by an update. */
export function isMissingModuleError(err: unknown): boolean {
  const e = err as { code?: unknown; message?: unknown } | null;
  const code = typeof e?.code === 'string' ? e.code : '';
  if (code === 'ERR_MODULE_NOT_FOUND' || code === 'MODULE_NOT_FOUND') return true;
  return /Cannot find (package|module)/i.test(String(e?.message ?? err));
}

/** Modules a sandboxed preload may require (Electron's sandbox allowlist). */
const SANDBOX_PRELOAD_MODULES = new Set(['electron', 'events', 'timers', 'url', 'node:events', 'node:timers', 'node:url']);

/**
 * A sandboxed preload must be one self-contained file: no import()/import statements and no
 * require() of anything but the sandbox modules (a split chunk such as './index.mjs' cannot load).
 */
export function preloadBundleProblems(code: string): string[] {
  const problems: string[] = [];
  for (const m of code.matchAll(/(?<![\w$.])require\(\s*["']([^"']+)["']\s*\)/g)) {
    if (!SANDBOX_PRELOAD_MODULES.has(m[1])) problems.push(`require('${m[1]}')`);
  }
  for (const m of code.matchAll(/(?<![\w$.])import\(\s*["']([^"']+)["']\s*\)/g)) problems.push(`import('${m[1]}')`);
  if (/^\s*import\s.+\sfrom\s+["']/m.test(code)) problems.push('ESM import statement');
  return [...new Set(problems)];
}
