<script setup lang="ts">
/**
 * Mini ship dial for the in-game overlay, matching the website's compact ShipScope: the FleetYards top
 * view of the ship (nose up) inside a perfect circle, the shield faces as separate ring segments with
 * visible gaps (a face at 0 is left out), and N/E/S/W letters outside the ring (no heading in the
 * roster, so the bezel rests with N up). Deliberately cheap: one <img>, a few SVG arcs and letters,
 * no filters, no animation.
 */
import { computed, ref, watch } from 'vue';
import { shieldArcs, topViewUrl } from '../../../shared/overlay/overlay-format';

const props = defineProps<{ className: string; faces: number[]; shields: number | null; hull: number | null; size: number }>();

const url = computed(() => topViewUrl(props.className));
const failed = ref(false);
watch(url, () => (failed.value = false));
const arcs = computed(() => shieldArcs(props.faces, props.shields, 50, 40, 14));
const hullBad = computed(() => props.hull !== null && props.hull < 25);
const LETTERS = [
  { l: 'N', x: 50, y: 2.5 },
  { l: 'E', x: 97.5, y: 50 },
  { l: 'S', x: 50, y: 97.5 },
  { l: 'W', x: 2.5, y: 50 },
];
</script>

<template>
  <div class="dial" :style="{ width: `${size}px`, height: `${size}px` }">
    <svg viewBox="0 0 100 100" class="dial-svg" aria-hidden="true">
      <circle cx="50" cy="50" r="40" class="track" />
      <circle cx="50" cy="50" r="34" class="face" :class="{ bad: hullBad }" />
      <template v-for="(a, i) in arcs" :key="i">
        <circle v-if="a.full" cx="50" cy="50" r="40" fill="none" :stroke="a.color" stroke-width="5" />
        <path v-else :d="a.d!" fill="none" :stroke="a.color" stroke-width="5" stroke-linecap="butt" />
      </template>
      <text v-for="c in LETTERS" :key="c.l" :x="c.x" :y="c.y" class="letter" text-anchor="middle" dominant-baseline="central">{{ c.l }}</text>
    </svg>
    <div class="ship">
      <img v-if="url && !failed" :src="url" alt="" draggable="false" @error="failed = true" />
      <svg v-else viewBox="0 0 40 40" class="generic" aria-hidden="true">
        <path d="M20 4 L27 30 L20 26 L13 30 Z" />
      </svg>
    </div>
  </div>
</template>

<style scoped>
.dial {
  position: relative;
  flex: none;
}
.dial-svg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  overflow: visible;
}
.track {
  fill: none;
  stroke: none;
  stroke-width: 5;
}
.face {
  fill: rgba(132, 132, 252, 0.1);
  stroke: rgba(255, 255, 255, 0.12);
  stroke-width: 0.8;
}
.face.bad {
  fill: rgba(239, 68, 68, 0.16);
}
.letter {
  font-size: 8px;
  font-weight: 700;
  fill: #a1a1ae;
}
.ship {
  position: absolute;
  inset: 22%;
  border-radius: 50%;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
}
/* FleetYards top views have the nose pointing LEFT: turn them nose-up. Full opacity over the lighter face. */
.ship img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  transform: rotate(90deg);
}
.generic {
  width: 70%;
  height: 70%;
  fill: none;
  stroke: rgb(132, 132, 252);
  stroke-width: 1.5;
}
</style>
