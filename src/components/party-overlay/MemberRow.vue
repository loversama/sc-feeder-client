<script setup lang="ts">
import { computed } from 'vue';
import type { OverlayMember } from '../../../shared/overlay/overlay-resolve';
import { healthTone, o2Tone } from '../../../shared/overlay/overlay-format';

const props = defineProps<{ member: OverlayMember; compact: boolean; nested?: boolean }>();

const STATUS: Record<string, { label: string; tone: string }> = {
  foot: { label: 'On foot', tone: 'dim' },
  ship: { label: 'Seated', tone: 'dim' },
  downed: { label: 'Downed', tone: 'warn' },
  dead: { label: 'Dead', tone: 'bad' },
  offline: { label: 'Offline', tone: 'faint' },
};
const ROLE: Record<string, string> = { PILOT: 'Pilot', COPILOT: 'Co-pilot', TURRET: 'Turret', GUNNER: 'Gunner', ENGINEER: 'Engineer' };

const status = computed(() => {
  const m = props.member;
  if (m.status === 'ship' && m.crewRole && ROLE[m.crewRole]) return { label: ROLE[m.crewRole], tone: 'dim' };
  return STATUS[m.status] ?? STATUS.foot;
});
const hp = computed(() => (props.member.health === null ? null : Math.round(props.member.health)));
const tone = computed(() => (props.member.status === 'dead' ? 'bad' : props.member.status === 'downed' ? 'warn' : healthTone(hp.value)));
const o2 = computed(() => o2Tone(props.member.o2));
const inactive = computed(() => props.member.status === 'offline' || props.member.status === 'dead');
</script>

<template>
  <div class="row" :class="{ compact, nested, inactive }">
    <div class="line">
      <span class="name">{{ member.name }}</span>
      <span v-if="o2" class="chip" :class="o2">O2 {{ Math.round(member.o2!) }}%</span>
      <span class="status" :class="status.tone">{{ status.label }}</span>
    </div>
    <div class="bar" :class="tone">
      <i :style="{ width: `${member.status === 'dead' ? 0 : hp ?? 0}%` }" />
    </div>
  </div>
</template>

<style scoped>
.row {
  padding: 6px 10px 7px;
  background: rgba(11, 11, 14, 0.82);
  border: 1px solid rgba(255, 255, 255, 0.1);
}
.row.nested {
  background: rgba(19, 19, 23, 0.82);
  border-left: 2px solid rgba(132, 132, 252, 0.45);
}
.row.compact {
  padding: 3px 8px 4px;
}
.row.inactive .name {
  color: #6c6c7a;
}
.line {
  display: flex;
  align-items: baseline;
  gap: 6px;
  min-width: 0;
}
.name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  font-weight: 600;
  color: #ececf1;
}
.compact .name {
  font-size: 12px;
}
.status,
.chip {
  flex: none;
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}
.status.dim {
  color: #a1a1ae;
}
.status.faint {
  color: #6c6c7a;
}
.status.warn,
.chip.warn {
  color: #fbbf24;
}
.status.bad,
.chip.bad {
  color: #f87171;
}
.bar {
  position: relative;
  margin-top: 5px;
  height: 4px;
  background: rgba(255, 255, 255, 0.08);
}
.compact .bar {
  margin-top: 3px;
  height: 3px;
}
.bar i {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  background: rgb(132, 132, 252);
}
.bar.warn i {
  background: #fbbf24;
}
.bar.bad i {
  background: #f87171;
}
.bar.dim i {
  background: #6c6c7a;
}
</style>
