/**
 * Browser preview of the in-game party overlay with fixture data over a game-like backdrop, at the
 * size it has in game (right side of a 1920x1080 screen). `?compact=1` for the compact variant.
 * Build: npx vite build --config scripts/overlay-preview/vite.config.ts
 */
import { createApp, h } from 'vue';
import PartyOverlay from '../../src/components/party-overlay/PartyOverlay.vue';
import { previewLayout, previewRoster } from './fixtures';

const q = new URLSearchParams(location.search);
const compact = q.get('compact') === '1';
const scale = Number(q.get('scale') || 1);

createApp({
  render: () =>
    h('div', { class: 'stage' }, [
      h('div', { class: 'overlay-frame', style: { width: `${300 * scale}px` } }, [
        h('div', { style: { width: '300px', transform: `scale(${scale})`, transformOrigin: 'top left' } }, [
          h(PartyOverlay, {
            state: {
              status: 'live',
              source: { scope: 'org', id: 'VOID', label: '[VOID] Voidrunners' },
              roster: previewRoster,
              layout: previewLayout,
              compact,
            },
          }),
        ]),
      ]),
    ]),
}).mount('#app');
