/** Pure helpers for the main-process bootstrap (electron/main.ts). No Electron imports. */

/** A module/package that could not be resolved, e.g. app files still being written by an update. */
export function isMissingModuleError(err: unknown): boolean {
  const e = err as { code?: unknown; message?: unknown } | null;
  const code = typeof e?.code === 'string' ? e.code : '';
  if (code === 'ERR_MODULE_NOT_FOUND' || code === 'MODULE_NOT_FOUND') return true;
  return /Cannot find (package|module)/i.test(String(e?.message ?? err));
}
