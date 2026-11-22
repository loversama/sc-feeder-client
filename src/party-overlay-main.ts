/**
 * Party overlay window entry. State arrives from the main process (≤4 Hz); the panel is scaled with a
 * transform on one wrapper (no re-layout per frame) and its height is reported back so the window
 * stays as small as its content.
 */
import { createApp, h, nextTick, ref } from 'vue';
import PartyOverlay from './components/party-overlay/PartyOverlay.vue';
import type { PartyOverlayState } from './components/party-overlay/types';

type Pushed = PartyOverlayState & { scale?: number };

const api = (window as any).partyOverlayApi as { onState(cb: (s: Pushed) => void): () => void; reportHeight(h: number): void } | undefined;
const state = ref<Pushed | null>(null);
let lastHeight = -1;

createApp({
  setup() {
    const root = ref<HTMLElement | null>(null);
    const report = () => {
      const el = root.value;
      if (!el || !api) return;
      const hgt = el.offsetHeight;
      if (hgt !== lastHeight) {
        lastHeight = hgt;
        api.reportHeight(hgt);
      }
    };
    api?.onState((s) => {
      state.value = s;
      void nextTick(report);
    });
    return () =>
      state.value && state.value.status !== 'off'
        ? h('div', { style: { width: '300px', transform: `scale(${state.value.scale ?? 1})`, transformOrigin: 'top left' } }, [
            h('div', { ref: root }, [h(PartyOverlay, { state: state.value })]),
          ])
        : null;
  },
}).mount('#party-overlay');
