/**
 * Browser preview of the in-game party overlay with fixture data over a game-like backdrop, at the
 * size it has in game (right side of a 1920x1080 screen).
 *   ?compact=1   compact variant      ?scale=1.25  size setting
 *   ?mode=party  party with offline members      ?status=no-access|connecting  status header
 *   ?bg=light    bright backdrop (readability check)   ?self=<userId>  'you' marker (default u-kit)
 * Build: npx vite build --config scripts/overlay-preview/vite.config.ts
 */
import { createApp, h } from 'vue';
import PartyOverlay from '../../src/components/party-overlay/PartyOverlay.vue';
import type { PartyOverlayState } from '../../src/components/party-overlay/types';
import { previewLayout, previewParty, previewRoster } from './fixtures';

const q = new URLSearchParams(location.search);
const compact = q.get('compact') === '1';
const scale = Number(q.get('scale') || 1);
const party = q.get('mode') === 'party';
const status = q.get('status') || 'live';
const selfId = q.get('self') ?? 'u-kit';
if (q.get('bg') === 'light') document.documentElement.classList.add('light');

// ?mode=multi: two org sections (VOID, then TRDR; Fen is in both and is listed once, under VOID).
// ?game=<ms>: ms since Star Citizen was detected (status cards).  ?message=<text>: card detail.
const trdr: PartyOverlayState['roster'] = {
  scope: 'org',
  id: 'TRDR',
  generatedAt: previewRoster.generatedAt,
  ships: [{ key: '777000222333', className: 'CRUS_Starlifter_C2', name: 'CRUS_Starlifter_C2_777000222333', hull: 81, shields: 70, faces: [70, 66, 0, 72] }],
  members: [
    { userId: 't-mo', name: 'MoTrader', status: 'ship', health: 100, o2: 100, shipKey: '777000222333', crewRole: 'PILOT' },
    { userId: 't-fen', name: 'Fen', status: 'ship', health: 100, o2: 100, shipKey: null },
    { userId: 't-pia', name: 'PiaCargo', status: 'ship', health: 93, o2: 100, shipKey: '777000222333', crewRole: 'COPILOT' },
    { userId: 't-rex', name: 'RexHauler', status: 'foot', health: 70, o2: 100, shipKey: null },
    { userId: 't-sol', name: 'SolBarter', status: 'offline', health: null, o2: null, shipKey: null },
  ],
};
const multi = q.get('mode') === 'multi';
const gameSinceMs = q.has('game') ? Number(q.get('game')) : null;
const message = q.get('message') ?? undefined;
const voidSection = { source: { scope: 'org' as const, id: 'VOID', label: '[VOID] Voidrunners' }, roster: status === 'live' ? previewRoster : null, layout: previewLayout, selfId };
const trdrSection = { source: { scope: 'org' as const, id: 'TRDR', label: '[TRDR] Night Traders' }, roster: status === 'live' ? trdr : null, layout: null, selfId: null };

const state: PartyOverlayState = party
  ? { status, message, gameSinceMs, source: { scope: 'party', id: 'p1', label: "Bo_Kestrel's party" }, roster: previewParty, layout: null, compact, selfId: 'u-bo' }
  : { status, message, gameSinceMs, ...voidSection, sections: multi ? [voidSection, trdrSection] : [voidSection], compact };

createApp({
  render: () =>
    h('div', { class: 'stage' }, [
      h('div', { class: 'overlay-frame', style: { width: `${300 * scale}px` } }, [
        h('div', { style: { width: '300px', transform: `scale(${scale})`, transformOrigin: 'top left' } }, [h(PartyOverlay, { state })]),
      ]),
    ]),
}).mount('#app');
