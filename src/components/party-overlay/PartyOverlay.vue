<script setup lang="ts">
/**
 * In-game party / org overlay (right side of the screen, click-through).
 * MMO-style list: members with health bars and status; members seated in the same ship are grouped
 * under a mini ship dial (top view + shield ring). Order and expanded/collapsed come from the central
 * layout edited on the website; the only local override is "compact".
 */
import { computed } from 'vue';
import { resolveOverlay } from '../../../shared/overlay/overlay-resolve';
import { shipLabel } from '../../../shared/overlay/overlay-format';
import MemberRow from './MemberRow.vue';
import type { PartyOverlayState } from './types';
import ShipDial from './ShipDial.vue';


const props = defineProps<{ state: PartyOverlayState }>();

const rows = computed(() => (props.state.roster ? resolveOverlay(props.state.roster, props.state.layout) : []));
const online = computed(() => props.state.roster?.members.filter((m) => m.status !== 'offline').length ?? 0);
const compact = computed(() => props.state.compact);
const dialSize = computed(() => (compact.value ? 40 : 64));
const pct = (n: number | null) => (n === null ? '—' : `${Math.round(n)}%`);
const STATUS_TEXT: Record<string, string> = {
  connecting: 'Connecting',
  'signed-out': 'Sign in to VOIDLOG.GG',
  'no-access': 'No access',
  'no-source': 'Pick an org or party in Settings',
  error: 'Unavailable',
};
</script>

<template>
  <div class="po" :class="{ compact }">
    <header class="head">
      <span class="label">{{ state.source?.scope === 'party' ? 'Party' : 'Org' }}</span>
      <span class="title">{{ state.source?.label ?? '—' }}</span>
      <span class="count" v-if="state.status === 'live'">{{ online }} online</span>
      <span class="count warn" v-else>{{ state.message || STATUS_TEXT[state.status] || state.status }}</span>
    </header>

    <div class="list">
      <template v-for="row in rows" :key="row.key">
        <section v-if="row.kind === 'ship'" class="ship" :class="{ collapsed: !row.expanded }">
          <div class="ship-head">
            <ShipDial :class-name="row.ship.className" :faces="row.ship.faces" :shields="row.ship.shields" :hull="row.ship.hull" :size="dialSize" />
            <div class="ship-info">
              <div class="ship-name">
                <span class="model">{{ shipLabel(row.ship.className).model }}</span>
                <span class="maker">{{ shipLabel(row.ship.className).maker }}</span>
                <span class="crew-count">{{ row.crew.length }} crew</span>
              </div>
              <div class="ship-stats">
                <span><b>Hull</b> <em :class="{ bad: row.ship.hull !== null && row.ship.hull < 25 }">{{ pct(row.ship.hull) }}</em></span>
                <span><b>Shld</b> <em :class="{ bad: row.ship.shields !== null && row.ship.shields <= 0 }">{{ pct(row.ship.shields) }}</em></span>
              </div>
              <div v-if="!row.expanded" class="crew-inline">{{ row.crew.map((m) => m.name).join(' · ') }}</div>
            </div>
          </div>
          <div v-if="row.expanded" class="crew">
            <MemberRow v-for="m in row.crew" :key="m.userId" :member="m" :compact="compact" :self="m.userId === state.selfId" nested />
          </div>
        </section>
        <MemberRow v-else :member="row.member" :compact="compact" :self="row.member.userId === state.selfId" />
      </template>
    </div>
  </div>
</template>

<style scoped>
.po {
  width: 100%;
  font-family: 'Inter', 'Segoe UI', system-ui, sans-serif;
  font-variant-numeric: tabular-nums;
  color: #ececf1;
  user-select: none;
}
.head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 6px 10px;
  background: rgba(11, 11, 14, 0.92);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-top: 2px solid rgb(132, 132, 252);
}
.label,
.count,
.ship-stats b,
.maker,
.crew-count {
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
}
.label {
  color: rgb(132, 132, 252);
}
.title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.06em;
}
.count {
  color: #a1a1ae;
}
.count.warn {
  color: #fbbf24;
}
.list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 4px;
}
.compact .list {
  gap: 2px;
}
.ship {
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(11, 11, 14, 0.9);
}
.ship-head {
  display: flex;
  gap: 10px;
  align-items: center;
  padding: 6px 10px 6px 6px;
}
.compact .ship-head {
  padding: 3px 8px 3px 4px;
  gap: 8px;
}
.ship-info {
  flex: 1;
  min-width: 0;
}
.ship-name {
  display: flex;
  align-items: baseline;
  gap: 6px;
}
.model {
  font-size: 13px;
  font-weight: 700;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.maker {
  color: #6c6c7a;
}
.crew-count {
  margin-left: auto;
  color: #a1a1ae;
  white-space: nowrap;
}
.ship-stats {
  display: flex;
  gap: 10px;
  margin-top: 3px;
}
.ship-stats span {
  white-space: nowrap;
}
.ship-stats b {
  color: #6c6c7a;
  margin-right: 2px;
}
.ship-stats em {
  font-style: normal;
  font-size: 12px;
  font-weight: 600;
  color: #ececf1;
}
.ship-stats em.bad {
  color: #f87171;
}
.compact .ship-stats {
  margin-top: 1px;
}
.crew-inline {
  margin-top: 3px;
  font-size: 11px;
  color: #a1a1ae;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.crew {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 0 0 4px 12px;
}
.crew :deep(.row) {
  border-right: none;
}
</style>
