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
  const m = text.match(new RegExp(`^[ \\t]*${escapeRe(key)}[ \\t]*=[ \\t]*(\\S+)`, 'im'));
  return !!m && /^(1|true)$/i.test(m[1]);
}

/**
 * Set `key=1`. Appends when missing (keeping the file's line endings); when the key exists with
 * another value only that line changes; no-op when already enabled.
 */
export function enableCfgFlag(text: string, key: string): { text: string; changed: boolean } {
  // [ \t] instead of \s so a match never spans lines; (?=\r?$) keeps CRLF line endings intact.
  const re = new RegExp(`^([ \\t]*)${escapeRe(key)}[ \\t]*=[ \\t]*(\\S*?)[ \\t]*(?=\\r?$)`, 'im');
  const m = text.match(re);
  if (m && /^(1|true)$/i.test(m[2])) return { text, changed: false };
  const line = `${key}=1`;
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  if (m) return { text: text.replace(re, `${m[1]}${line}`), changed: true };
  return { text: `${text}${text && !text.endsWith('\n') ? eol : ''}${line}${eol}`, changed: true };
}
