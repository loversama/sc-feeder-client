<script setup lang="ts">
/**
 * One member row of the in-game overlay (same rules and look as the website preview's OverlayMemberRow):
 *  - health bar coloured on a ramp: brand violet when healthy, amber, orange, red when critical
 *  - downed: no empty bar; a hatched amber strip and "needs revive" instead (health is unknown)
 *  - dead: greyed name, red label, no bar fill
 *  - "you" marker for the viewer
 */
import { computed } from 'vue';
import type { OverlayMember } from '../../../shared/overlay/overlay-resolve';
import { healthColor } from '../../../shared/overlay/overlay-format';

const props = withDefaults(defineProps<{ member: OverlayMember; compact?: boolean; nested?: boolean; self?: boolean }>(), { compact: false, nested: false, self: false });

const ROLE: Record<string, string> = { PILOT: 'Pilot', COPILOT: 'Co-pilot', TURRET: 'Turret', GUNNER: 'Gunner', ENGINEER: 'Engineer' };
const STATUS: Record<string, { label: string; tone: string }> = {
  foot: { label: 'On foot', tone: 'dim' },
  ship: { label: 'Seated', tone: 'dim' },
  downed: { label: 'Downed', tone: 'warn' },
  dead: { label: 'Dead', tone: 'bad' },
  offline: { label: 'Offline', tone: 'faint' },
};
const m = computed(() => props.member);
const status = computed(() => (m.value.status === 'ship' && m.value.crewRole && ROLE[m.value.crewRole] ? { label: ROLE[m.value.crewRole], tone: 'dim' } : STATUS[m.value.status] ?? STATUS.foot));
const o2 = computed(() => (m.value.o2 === null || m.value.o2 >= 35 ? null : m.value.o2 < 15 ? 'bad' : 'warn'));
const fill = computed(() => {
  if (m.value.status === 'dead' || m.value.status === 'offline' || m.value.health === null) return null;
  return { width: `${m.value.health}%`, background: healthColor(m.value.health) };
});
</script>

<template>
  <div class="mrow" :class="{ compact, nested, self, inactive: m.status === 'offline' || m.status === 'dead' }">
    <div class="line">
      <span v-if="self" class="you">You</span>
      <span class="name">{{ m.name }}</span>
      <span v-if="o2" class="lbl" :class="o2">O2 {{ Math.round(m.o2!) }}%</span>
      <span class="lbl" :class="status.tone">{{ status.label }}</span>
    </div>
    <div v-if="m.status === 'downed'" class="downed"><span>Needs revive</span></div>
    <div v-else class="bar"><i v-if="fill" :style="fill" /></div>
  </div>
</template>

<style scoped>
.mrow {
  padding: 6px 10px 7px;
  background: rgba(11, 11, 14, 0.9);
  border: 1px solid rgba(255, 255, 255, 0.1);
}
.mrow.compact {
  padding: 3px 8px 4px;
}
.mrow.nested {
  background: rgba(19, 19, 23, 0.9);
  border-left: 2px solid rgba(132, 132, 252, 0.45);
  border-right: none;
}
.mrow.self {
  border-left: 2px solid rgb(132, 132, 252);
}
.mrow.inactive .name {
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
.you {
  flex: none;
  padding: 0 4px;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: #0b0b0e;
  background: rgb(132, 132, 252);
  align-self: center;
}
.lbl {
  flex: none;
  white-space: nowrap;
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: #a1a1ae;
}
.lbl.faint {
  color: #6c6c7a;
}
.lbl.warn {
  color: #fbbf24;
}
.lbl.bad {
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
  inset: 0 auto 0 0;
}
.downed {
  margin-top: 3px;
  height: 8px;
  display: flex;
  align-items: center;
  /* Static hatch (no animation): health is unknown while downed. */
  background: repeating-linear-gradient(-45deg, rgba(251, 191, 36, 0.35) 0 3px, transparent 3px 6px);
}
.downed span {
  margin-left: auto;
  padding-left: 6px;
  background: rgba(11, 11, 14, 0.88);
  font-size: 9px;
  line-height: 8px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: #fbbf24;
}
</style>
