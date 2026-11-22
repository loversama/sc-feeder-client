/**
 * Browser preview of the in-game party overlay with fixture data over a game-like backdrop, at the
 * size it has in game (right side of a 1920x1080 screen).
 *   ?compact=1   compact variant      ?scale=1.25  size setting
 *   ?mode=party  party with offline members      ?status=no-access|connecting  status header
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

const state: PartyOverlayState = party
  ? { status, source: { scope: 'party', id: 'p1', label: "Bo_Kestrel's party" }, roster: previewParty, layout: null, compact }
  : { status, source: { scope: 'org', id: 'VOID', label: '[VOID] Voidrunners' }, roster: status === 'live' ? previewRoster : null, layout: previewLayout, compact };

createApp({
  render: () =>
    h('div', { class: 'stage' }, [
      h('div', { class: 'overlay-frame', style: { width: `${300 * scale}px` } }, [
        h('div', { style: { width: '300px', transform: `scale(${scale})`, transformOrigin: 'top left' } }, [h(PartyOverlay, { state })]),
      ]),
    ]),
}).mount('#app');
