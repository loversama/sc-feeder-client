/** Org tag handling shared by Settings and the overlay feed. */

/** Same rule as the server (`overlay_subscribe` refuses anything else). */
export const ORG_TAG_RE = /^[A-Z0-9_-]{1,20}$/;

/** One of the user's verified orgs, from `overlay_orgs`. */
export type OrgChoice = { tag: string; name: string | null; primary: boolean };

/** Trim + upper-case. '' stays '' (no org picked). Returns null when the tag is not valid. */
export function normalizeOrgTag(raw: unknown): string | null {
  const tag = String(raw ?? '').trim().toUpperCase();
  if (!tag) return '';
  return ORG_TAG_RE.test(tag) ? tag : null;
}

/** Keep only well-formed entries from a server reply; primary first, then by tag. */
export function sanitizeOrgChoices(raw: unknown): OrgChoice[] {
  if (!Array.isArray(raw)) return [];
  const out: OrgChoice[] = [];
  const seen = new Set<string>();
  for (const o of raw.slice(0, 100)) {
    const tag = normalizeOrgTag((o as any)?.tag);
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    const name = typeof (o as any)?.name === 'string' ? (o as any).name.slice(0, 80) : null;
    out.push({ tag, name, primary: (o as any)?.primary === true });
  }
  return out.sort((a, b) => Number(b.primary) - Number(a.primary) || a.tag.localeCompare(b.tag));
}
