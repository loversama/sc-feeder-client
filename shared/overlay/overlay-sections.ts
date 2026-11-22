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
  /**
   * Viewer-scoped cross-room ids from the server ({ room member id: vid }), multi-org only. The same member
   * has the same vid in every section of this viewer; used to list them once.
   */
  vids?: Record<string, string> | null;
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

const onlineCount = (members: { status: string }[]) => members.filter((m) => m.status !== 'offline').length;

/**
 * Sections as drawn: a member who is in several shown orgs appears once, in the first section. Member ids
 * differ per room, so the match uses the server's viewer-scoped `vids` (no vid = never merged).
 * `online` is the org's real online total; `shownOnline` counts the members left in that section.
 */
export function mergeSections(sections: OverlaySectionState[]): Array<OverlaySectionState & { online: number; shownOnline: number }> {
  const seen = new Set<string>();
  return sections.map((s) => {
    if (!s.roster) return { ...s, online: 0, shownOnline: 0 };
    const members = s.roster.members.filter((m) => {
      const vid = s.vids?.[m.userId];
      if (!vid) return true;
      if (seen.has(vid)) return false;
      seen.add(vid);
      return true;
    });
    return { ...s, roster: { ...s.roster, members }, online: onlineCount(s.roster.members), shownOnline: onlineCount(members) };
  });
}

/**
 * How the overlay fits the height it has (screen minus the top offset): `compact` rows, and the lowest
 * `collapsed` sections shown as their header row only ("+N more online"). The first (main org) section is
 * never collapsed.
 */
export type FitPlan = { compact: boolean; collapsed: number };

/** The candidate plans in order: full, compact, then compact with 1, 2, ... lowest sections collapsed. */
export function fitPlans(sectionCount: number, userCompact: boolean): FitPlan[] {
  const plans: FitPlan[] = userCompact ? [] : [{ compact: false, collapsed: 0 }];
  for (let c = 0; c < Math.max(1, sectionCount); c++) plans.push({ compact: true, collapsed: c });
  return plans;
}

/**
 * First plan whose measured height fits `maxHeight` (the most collapsed one when none fits). `measure`
 * renders a plan and returns its height (the renderer measures the DOM; tests pass a fake).
 */
export async function planFit(sectionCount: number, userCompact: boolean, maxHeight: number | null | undefined, measure: (p: FitPlan) => Promise<number>): Promise<FitPlan> {
  const plans = fitPlans(sectionCount, userCompact);
  if (!maxHeight || maxHeight <= 0) return plans[0];
  for (const p of plans) if ((await measure(p)) <= maxHeight) return p;
  return plans[plans.length - 1];
}

/** Is section `index` (of `count`) collapsed under `plan`? Never the first one. */
export const isCollapsed = (plan: FitPlan, index: number, count: number) => index > 0 && index >= count - plan.collapsed;

export type OverlayCard ={ title: string; detail?: string; tone: 'info' | 'warn' };

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
