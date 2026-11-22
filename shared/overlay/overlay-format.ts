/**
 * Display helpers for the in-game party overlay (pure; unit-tested in test/overlay).
 * Colours follow the website's ShipScope / void-ui tokens: brand violet when healthy, amber/orange
 * as it drains, red only for damage and alerts.
 */
import topviews from './fleetyards-topviews.json';

const SHIPS = (topviews as { ships: Record<string, string> }).ships;

/** FleetYards top-view URL for a game class name (exact, then trailing tokens dropped), or null. */
export function topViewUrl(className: string | null | undefined): string | null {
  const key = String(className ?? '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
  if (!key) return null;
  const parts = key.split('_');
  for (let n = parts.length; n >= 2; n--) {
    const hit = SHIPS[parts.slice(0, n).join('_')];
    if (hit) return hit;
  }
  return null;
}

/** RSI_Galaxy → { maker: 'RSI', model: 'Galaxy' }; DRAK_Cutlass_Black → { maker: 'DRAK', model: 'Cutlass Black' } */
export function shipLabel(className: string | null | undefined): { maker: string; model: string } {
  const parts = String(className ?? '').split('_').filter(Boolean);
  if (parts.length < 2) return { maker: '', model: parts[0] ?? 'Ship' };
  return { maker: parts[0].toUpperCase(), model: parts.slice(1).join(' ') };
}

const RAMP: [number, [number, number, number]][] = [
  [0, [239, 68, 68]],
  [15, [239, 68, 68]],
  [32, [249, 115, 22]],
  [60, [251, 191, 36]],
  [65, [132, 132, 252]],
  [100, [132, 132, 252]],
];

/** Shield face colour for a 0..100 level (same ramp as the website's ShipScope). */
export function shieldColor(level: number): string {
  const l = Math.max(0, Math.min(100, level));
  for (let i = 1; i < RAMP.length; i++) {
    const [hi, c1] = RAMP[i];
    if (l <= hi) {
      const [lo, c0] = RAMP[i - 1];
      const k = hi === lo ? 0 : (l - lo) / (hi - lo);
      return `rgb(${c0.map((v, j) => Math.round(v + (c1[j] - v) * k)).join(',')})`;
    }
  }
  return 'rgb(132,132,252)';
}

/** Health bar colour: same ramp as the shields (violet healthy, amber, orange, red critical). */
export const healthColor = shieldColor;

export type Tone = 'ok' | 'warn' | 'bad' | 'dim';

/** Health bar tone: red below 25 %, amber below 50 %. */
export function healthTone(health: number | null): Tone {
  if (health === null) return 'dim';
  return health < 25 ? 'bad' : health < 50 ? 'warn' : 'ok';
}

/** O2 is shown only when low: < 35 % warn, < 15 % alert. */
export function o2Tone(o2: number | null): Tone | null {
  if (o2 === null || o2 >= 35) return null;
  return o2 < 15 ? 'bad' : 'warn';
}

/**
 * Shield ring segments for a dial with centre (c, c) and radius r. One arc per face, clockwise from the
 * nose; a face at 0 is left out (a gap, like the in-game shield display); one face = a full circle.
 */
export function shieldArcs(faces: number[], shields: number | null, c: number, r: number, gapDeg = 8): Array<{ d: string | null; full: boolean; color: string }> {
  const list = faces.length ? faces : shields === null ? [] : [shields];
  const n = list.length;
  if (!n) return [];
  if (n === 1) return list[0] > 0 ? [{ d: null, full: true, color: shieldColor(list[0]) }] : [];
  const span = 360 / n;
  const pt = (deg: number) => {
    const a = (deg * Math.PI) / 180;
    return `${(c + r * Math.sin(a)).toFixed(2)} ${(c - r * Math.cos(a)).toFixed(2)}`;
  };
  const out: Array<{ d: string | null; full: boolean; color: string }> = [];
  list.forEach((level, i) => {
    if (level <= 0) return;
    const from = i * span - span / 2 + gapDeg / 2;
    const to = i * span + span / 2 - gapDeg / 2;
    out.push({ d: `M ${pt(from)} A ${r} ${r} 0 ${to - from > 180 ? 1 : 0} 1 ${pt(to)}`, full: false, color: shieldColor(level) });
  });
  return out;
}
