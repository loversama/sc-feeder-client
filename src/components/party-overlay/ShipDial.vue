<script setup lang="ts">
/**
 * Mini ship dial for the in-game overlay: the FleetYards top view of the ship (nose up) inside a
 * perfect circle, with the shield faces as ring segments around it. A face at 0 is a gap.
 * Deliberately cheap: one <img>, a few SVG arcs, no filters, no animation.
 */
import { computed, ref, watch } from 'vue';
import { shieldArcs, topViewUrl } from '../../../shared/overlay/overlay-format';

const props = defineProps<{ className: string; faces: number[]; shields: number | null; hull: number | null; size: number }>();

const url = computed(() => topViewUrl(props.className));
const failed = ref(false);
watch(url, () => (failed.value = false));
const arcs = computed(() => shieldArcs(props.faces, props.shields, 50, 45));
const hullBad = computed(() => props.hull !== null && props.hull < 25);
</script>

<template>
  <div class="dial" :style="{ width: `${size}px`, height: `${size}px` }">
    <svg viewBox="0 0 100 100" class="dial-svg" aria-hidden="true">
      <circle cx="50" cy="50" r="45" class="track" />
      <circle cx="50" cy="50" r="38" class="face" :class="{ bad: hullBad }" />
      <template v-for="(a, i) in arcs" :key="i">
        <circle v-if="a.full" cx="50" cy="50" r="45" fill="none" :stroke="a.color" stroke-width="6" />
        <path v-else :d="a.d!" fill="none" :stroke="a.color" stroke-width="6" stroke-linecap="butt" />
      </template>
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
}
.track {
  fill: none;
  stroke: rgba(255, 255, 255, 0.08);
  stroke-width: 6;
}
.face {
  fill: rgba(132, 132, 252, 0.06);
  stroke: rgba(255, 255, 255, 0.1);
  stroke-width: 1;
}
.face.bad {
  fill: rgba(239, 68, 68, 0.14);
}
.ship {
  position: absolute;
  inset: 19%;
  border-radius: 50%;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
}
/* FleetYards top views have the nose pointing LEFT: turn them nose-up. */
.ship img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  transform: rotate(90deg);
  opacity: 0.92;
}
.generic {
  width: 70%;
  height: 70%;
  fill: none;
  stroke: rgb(132, 132, 252);
  stroke-width: 1.5;
}
</style>
