/**
 * In-game party / org overlay: shared, dependency-free resolver.
 *
 * Turns a live roster (who is online, their health/status, which ship they are seated in) and the
 * central layout document (order of members / ship groups, expanded flags) into the rows the overlay
 * draws. The SAME file is copied verbatim into the desktop client (electron/modules/overlay/) and the
 * website (utils/overlay/) so the website preview and the in-game overlay can never disagree.
 * Keep it pure: no imports, no Date.now(), no I/O.
 *
 * Rules (OVERLAY-SPEC.md):
 *  - Members seated in the same ship (same ship key) form a ship group; the ship dial is drawn with the
 *    crew nested under it. A ship with a single member is still a group (the dial is the point).
 *  - Ships are ordered by a layout `ship` entry matching their class (case-insensitive); an unlisted
 *    ship takes the position of its highest-placed listed crew member; otherwise it goes after the
 *    listed items. Every live ship is its own group (keyed by vehicle entity id); all ships of one
 *    class share that class entry's position, bigger crew first, then by key. There is no per-ship
 *    override: entity ids change on every spawn, so there is no stable id to save.
 *  - Members (not in a ship) are ordered by their layout `member` entry; unlisted members go after the
 *    listed items, by name. Offline members (parties only) always go last.
 *  - Crew inside a ship: pilot first, then layout order, then name.
 *  - Expanded: the matching ship entry's flag, else `layout.shipsExpandedByDefault`.
 */

export type OverlayStatus = 'foot' | 'ship' | 'downed' | 'dead' | 'offline';

export type OverlayShip = {
  /** Vehicle entity id when known (RSI_Galaxy_877604806898 → 877604806898), else `<className>:<userId>`. */
  key: string;
  /** Game class name, e.g. RSI_Galaxy (FleetYards top-view lookup key, lower-cased). */
  className: string;
  /** Raw vehicle name from the game. */
  name: string;
  /** 0..100, null = not reported */
  hull: number | null;
  /** Overall shield level 0..100, null = not reported */
  shields: number | null;
  /** Shield faces 0..100 each, clockwise from the nose (4 = front, right, rear, left; assumed). */
  faces: number[];
};

export type OverlayMember = {
  userId: string;
  name: string;
  status: OverlayStatus;
  /** 0..100, null = unknown (the game drops health while downed) */
  health: number | null;
  /** 0..100, null = unknown */
  o2: number | null;
  /** Ship they are seated in (OverlayShip.key), null on foot / offline */
  shipKey: string | null;
  /** e.g. PILOT, COPILOT, TURRET, NONE */
  crewRole?: string;
};

export type OverlayRoster = {
  scope: 'org' | 'party';
  /** Org tag (upper-case) or party id */
  id: string;
  generatedAt: string;
  members: OverlayMember[];
  ships: OverlayShip[];
};

export type LayoutEntry = { kind: 'member'; userId: string } | { kind: 'ship'; shipClass: string; expanded: boolean };

export type OverlayLayout = {
  scope: 'org' | 'party';
  id: string;
  /** Increments on every saved change; clients ignore layouts older than the one they have. */
  version: number;
  updatedAt: string | null;
  updatedBy: string | null;
  entries: LayoutEntry[];
  shipsExpandedByDefault: boolean;
  /** Org only: extra users (besides founders / admins) allowed to edit this layout. */
  editors?: string[];
};

export type OverlayRow =
  | { kind: 'ship'; key: string; ship: OverlayShip; expanded: boolean; crew: OverlayMember[] }
  | { kind: 'member'; key: string; member: OverlayMember };

export const emptyLayout = (scope: 'org' | 'party', id: string): OverlayLayout => ({
  scope,
  id,
  version: 0,
  updatedAt: null,
  updatedBy: null,
  entries: [],
  shipsExpandedByDefault: true,
});

const ROLE_ORDER: Record<string, number> = { PILOT: 0, COPILOT: 1 };
const byName = (a: OverlayMember, b: OverlayMember) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }) || a.userId.localeCompare(b.userId);

export function resolveOverlay(roster: OverlayRoster, layout: OverlayLayout | null | undefined): OverlayRow[] {
  const entries = layout?.entries ?? [];
  const memberRank = new Map<string, number>();
  const shipRank = new Map<string, { rank: number; expanded: boolean }>();
  entries.forEach((e, i) => {
    if (e.kind === 'member' && !memberRank.has(e.userId)) memberRank.set(e.userId, i);
    if (e.kind === 'ship') {
      const k = e.shipClass.toLowerCase();
      if (!shipRank.has(k)) shipRank.set(k, { rank: i, expanded: e.expanded });
    }
  });
  const expandedDefault = layout?.shipsExpandedByDefault ?? true;
  const rankOf = (m: OverlayMember) => memberRank.get(m.userId) ?? Infinity;

  const ships = new Map(roster.ships.map((s) => [s.key, s]));
  const crewByShip = new Map<string, OverlayMember[]>();
  const loose: OverlayMember[] = [];
  const offline: OverlayMember[] = [];
  for (const m of roster.members) {
    if (m.status === 'offline') offline.push(m);
    else if (m.shipKey && ships.has(m.shipKey)) {
      const list = crewByShip.get(m.shipKey) ?? [];
      list.push(m);
      crewByShip.set(m.shipKey, list);
    } else loose.push(m);
  }

  type Item = { row: OverlayRow; rank: number; listed: boolean; tie: string };
  const items: Item[] = [];
  for (const [key, crew] of crewByShip) {
    const ship = ships.get(key)!;
    crew.sort((a, b) => (ROLE_ORDER[a.crewRole ?? ''] ?? 9) - (ROLE_ORDER[b.crewRole ?? ''] ?? 9) || rankOf(a) - rankOf(b) || byName(a, b));
    const entry = shipRank.get(ship.className.toLowerCase());
    const crewRank = Math.min(...crew.map(rankOf));
    const rank = entry ? entry.rank : crewRank;
    items.push({
      row: { kind: 'ship', key: `ship:${key}`, ship, expanded: entry ? entry.expanded : expandedDefault, crew },
      rank,
      listed: Number.isFinite(rank),
      // Same position: by class, then bigger crew first, then key (stable).
      tie: `0${ship.className.toLowerCase()}\u0000${String(999 - Math.min(crew.length, 999)).padStart(3, '0')}\u0000${key}`,
    });
  }
  for (const m of loose) {
    const rank = rankOf(m);
    items.push({ row: { kind: 'member', key: `member:${m.userId}`, member: m }, rank, listed: Number.isFinite(rank), tie: `1${m.name.toLowerCase()}\u0000${m.userId}` });
  }
  items.sort((a, b) => {
    if (a.listed !== b.listed) return a.listed ? -1 : 1;
    if (a.listed && a.rank !== b.rank) return a.rank - b.rank;
    return a.tie < b.tie ? -1 : a.tie > b.tie ? 1 : 0;
  });
  return [...items.map((i) => i.row), ...offline.sort(byName).map((m): OverlayRow => ({ kind: 'member', key: `member:${m.userId}`, member: m }))];
}
