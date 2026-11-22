/**
 * Multi-org overlay helpers shared by the feed (main process) and the overlay window (renderer).
 * Pure functions, unit-tested in test/overlay.
 */
import type { OverlayLayout, OverlayRoster } from './overlay-resolve';
import type { OrgChoice } from './org-tag';

/** Most org rooms the server lets one socket follow (MAX_ORGS_PER_SOCKET on the server). */
export const MAX_OVERLAY_ORGS = 10;

/** How long after Star Citizen is detected the overlay keeps a "waiting" hint while we are not live yet. */
export const WAITING_CARD_MS = 30_000;

export type OverlaySource = { scope: 'org' | 'party'; id: string; label: string };

/** One subscribed room: an org (multi-org mode has several) or the party. Member ids are room-scoped. */
export type OverlaySectionState = {
  source: OverlaySource;
  roster: OverlayRoster | null;
  layout: OverlayLayout | null;
  selfId: string | null;
};

/**
 * The orgs to show: every verified org except the ones the user unticked, in the user's org order
 * (main org first), at most MAX_OVERLAY_ORGS. Orgs joined later are on until unticked.
 */
export function selectedOrgTags(orgs: OrgChoice[], unticked: string[], max = MAX_OVERLAY_ORGS): string[] {
  const off = new Set(unticked.map((t) => t.toUpperCase()));
  return orgs.map((o) => o.tag).filter((t) => !off.has(t)).slice(0, max);
}

/** The unticked list after (un)ticking one org; tags that are no longer the user's orgs are kept (harmless). */
export function toggleOrg(unticked: string[], tag: string, on: boolean): string[] {
  const rest = unticked.filter((t) => t !== tag);
  return on ? rest : [...rest, tag];
}

const nameKey = (n: string) => n.trim().toLowerCase();

/**
 * Sections as drawn: a member who is in several shown orgs appears once, in the first section (member
 * ids differ per room, so the match is on the RSI handle shown as the name). `online` counts the members
 * left in that section.
 */
export function mergeSections(sections: OverlaySectionState[]): Array<OverlaySectionState & { online: number }> {
  const seen = new Set<string>();
  return sections.map((s) => {
    if (!s.roster) return { ...s, online: 0 };
    const members = s.roster.members.filter((m) => {
      const k = nameKey(m.name);
      if (!k) return true;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    const roster = { ...s.roster, members };
    return { ...s, roster, online: members.filter((m) => m.status !== 'offline').length };
  });
}

export type OverlayCard = { title: string; detail?: string; tone: 'info' | 'warn' };

const CARD_TITLES: Record<string, string> = {
  connecting: 'Connecting to VOIDLOG.GG',
  'signed-out': 'Not signed in',
  'no-access': 'No access',
  'no-party': 'Not in a party',
  'no-source': 'Nothing to show',
  error: 'Overlay unavailable',
};

/**
 * Small status card the overlay shows instead of an empty panel:
 * - whenever there is no live roster (connecting, signed out, no orgs selected, not in a party, ...);
 * - for the first WAITING_CARD_MS after Star Citizen is detected while we are not on the roster as
 *   online yet ("Waiting for Star Citizen"). After that the panel shows the roster only.
 * `gameSinceMs` = ms since the game was detected (null when unknown / not running).
 */
export function overlayCard(
  state: { status: string; message?: string; sections?: OverlaySectionState[] },
  gameSinceMs: number | null,
): OverlayCard | null {
  if (state.status === 'off') return null;
  if (state.status !== 'live') return { title: CARD_TITLES[state.status] ?? 'Overlay', detail: state.message, tone: state.status === 'connecting' ? 'info' : 'warn' };
  const sections = state.sections ?? [];
  const selfOnline = sections.some((s) => !!s.selfId && !!s.roster?.members.some((m) => m.userId === s.selfId && m.status !== 'offline'));
  if (!selfOnline && gameSinceMs !== null && gameSinceMs < WAITING_CARD_MS) {
    return { title: 'Waiting for Star Citizen', detail: 'You show up once the game sends telemetry', tone: 'info' };
  }
  return null;
}
