/**
 * Pure user.cfg text helpers (no fs / Electron) so the edits to the player's real game config are
 * unit-tested. Used by telemetry-manager for the telemetry and game-control switches.
 */
export const TELEMETRY_CFG_KEY = 'server.game.telemetry.enabled';
/** Lets local tools trigger allowlisted actions (game control). Name from third-party notes, unverified in a live game. */
export const TRIGGER_CFG_KEY = 'server.game.telemetry.trigger.actions.enabled';

const escapeRe = (k: string) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Is `key` set to 1/true in this user.cfg text? */
export function cfgFlag(text: string, key: string): boolean {
  const m = text.match(new RegExp(`^[ \\t]*${escapeRe(key)}[ \\t]*=[ \\t]*([^\\s;#]+)`, 'im'));
  return !!m && /^(1|true)$/i.test(m[1]);
}

/**
 * Set `key=1`. Appends when missing (keeping the file's line endings); when the key exists with
 * another value only that line changes; no-op when already enabled.
 */
export function enableCfgFlag(text: string, key: string): { text: string; changed: boolean } {
  // [ \t] instead of \s so a match never spans lines; (?=\r?$) keeps CRLF line endings intact.
  // A trailing comment (`; ...`, `# ...`, `-- ...`, `// ...`) is kept: `key=0 ; note` → `key=1 ; note`.
  const re = new RegExp(`^([ \\t]*)${escapeRe(key)}[ \\t]*=[ \\t]*([^\\s;#]*)((?:[ \\t]*(?:;|#|--|//).*?)?)[ \\t]*(?=\\r?$)`, 'im');
  const m = text.match(re);
  if (m && /^(1|true)$/i.test(m[2])) return { text, changed: false };
  const line = `${key}=1`;
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  if (m) return { text: text.replace(re, `${m[1]}${line}${m[3]}`), changed: true };
  return { text: `${text}${text && !text.endsWith('\n') ? eol : ''}${line}${eol}`, changed: true };
}

/**
 * Read a user.cfg before editing it. Only "file does not exist" (ENOENT) counts as a new, empty file;
 * any other error (permissions, locked, I/O) is thrown so we never overwrite a file we couldn't back up.
 */
export async function readCfgForEdit(p: string, readFile: (p: string) => Promise<string>): Promise<{ text: string; exists: boolean }> {
  try {
    return { text: await readFile(p), exists: true };
  } catch (err) {
    const e = err as { code?: string; message?: string };
    if (e?.code === 'ENOENT') return { text: '', exists: false };
    throw new Error(`Could not read ${p} (${e?.code ?? e?.message ?? String(err)}); nothing was changed.`);
  }
}

export type CfgTarget = { channel: string; path: string };

/**
 * One-time grant tying a user.cfg write to the preview dialog the player saw: the write must present
 * this token, within 2 minutes, and it can be used once. The files written are the ones in the grant.
 */
export type CfgPreviewGrant = { token: string; targets: CfgTarget[]; expiresAt: number };
export const CFG_PREVIEW_TTL_MS = 2 * 60_000;

export function redeemCfgGrant(grant: CfgPreviewGrant | null, token: unknown, now: number): { ok: true; targets: CfgTarget[] } | { ok: false; error: string } {
  if (!grant || typeof token !== 'string' || !token || token !== grant.token) return { ok: false, error: 'Open the user.cfg preview first.' };
  if (now > grant.expiresAt) return { ok: false, error: 'The preview expired. Open it again to review the files.' };
  if (!grant.targets.length) return { ok: false, error: 'No user.cfg files to change.' };
  return { ok: true, targets: grant.targets };
}
export type CfgTargets = {
  targets: CfgTarget[];
  /** Folder the channels were found in (shown to the player). */
  root: string;
  /** game-folder = configured Star Citizen folder; log-path = siblings of the configured Game.log; default = nothing configured */
  source: 'game-folder' | 'log-path' | 'default';
};

const dirOf = (p: string) => p.replace(/[\\/]+[^\\/]*$/, '');
const sepOf = (p: string) => (p.includes('\\') ? '\\' : '/');

/**
 * Which user.cfg files to edit, from the player's configured install (the built-in default path is
 * used only when nothing is configured):
 *   1. channels of the configured game folder (LIVE / PTU / EPTU / TECH-PREVIEW ... that exist)
 *   2. else sibling channel folders of the configured Game.log (E:\StarCitizen\LIVE\Game.log → E:\StarCitizen\*)
 *   3. else the configured Game.log's own folder
 */
export async function resolveCfgTargets(o: {
  trackerChannels: Array<{ name: string; userCfgPath: string }>;
  gameRoot: string;
  logPath: string;
  defaultLogPath: string;
  discover: (root: string) => Promise<Array<{ name: string; userCfgPath: string }>>;
}): Promise<CfgTargets> {
  const isDefault = !o.gameRoot && (!o.logPath || o.logPath === o.defaultLogPath);
  if (o.gameRoot && o.trackerChannels.length) {
    return { targets: o.trackerChannels.map((c) => ({ channel: c.name, path: c.userCfgPath })), root: o.gameRoot, source: 'game-folder' };
  }
  const logPath = o.logPath || o.defaultLogPath;
  const channelDir = dirOf(logPath);
  const root = dirOf(channelDir);
  const siblings = root ? await o.discover(root) : [];
  const source = isDefault ? 'default' : 'log-path';
  if (siblings.length) return { targets: siblings.map((c) => ({ channel: c.name, path: c.userCfgPath })), root, source };
  const name = channelDir.split(/[\\/]/).pop() || 'LIVE';
  return { targets: [{ channel: name, path: `${channelDir}${sepOf(channelDir)}user.cfg` }], root: channelDir, source };
}
