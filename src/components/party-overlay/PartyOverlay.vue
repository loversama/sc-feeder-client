<script setup lang="ts">
/**
 * In-game party / org overlay (right side of the screen, click-through).
 * MMO-style list: members with health bars and status; members seated in the same ship are grouped
 * under a mini ship dial (top view + shield ring). Order and expanded/collapsed come from the central
 * layout edited on the website; the only local override is "compact".
 * Org mode shows one section per selected org (the user's org order); a member in several of them is
 * listed once, in the first. Without a live roster a small status card says why.
 */
import { computed } from 'vue';
import { resolveOverlay } from '../../../shared/overlay/overlay-resolve';
import { shipLabel } from '../../../shared/overlay/overlay-format';
import { mergeSections, overlayCard, type OverlaySectionState } from '../../../shared/overlay/overlay-sections';
import MemberRow from './MemberRow.vue';
import type { PartyOverlayState } from './types';
import ShipDial from './ShipDial.vue';


const props = defineProps<{ state: PartyOverlayState }>();

const rawSections = computed<OverlaySectionState[]>(() => {
  const st = props.state;
  if (st.sections?.length) return st.sections;
  return st.source ? [{ source: st.source, roster: st.roster, layout: st.layout, selfId: st.selfId ?? null }] : [];
});
const sections = computed(() =>
  props.state.status === 'live'
    ? mergeSections(rawSections.value).map((s) => ({ ...s, key: `${s.source.scope}:${s.source.id}`, rows: s.roster ? resolveOverlay(s.roster, s.layout) : [] }))
    : [],
);
const card = computed(() => overlayCard({ status: props.state.status, message: props.state.message, sections: rawSections.value }, props.state.gameSinceMs ?? null));
/** Which orgs / party a status card is about (not shown once live: the section headers say it). */
const cardLabel = computed(() => (props.state.status === 'live' || props.state.status === 'no-source' ? null : rawSections.value.map((s) => s.source.label).join(' · ') || null));
const compact = computed(() => props.state.compact);
const dialSize = computed(() => (compact.value ? 40 : 64));
const pct = (n: number | null) => (n === null ? '—' : `${Math.round(n)}%`);
</script>

<template>
  <div class="po" :class="{ compact }">
    <div v-if="card" class="card" :class="card.tone" data-test="overlay-card">
      <div class="card-title">{{ card.title }}</div>
      <div v-if="card.detail" class="card-detail">{{ card.detail }}</div>
      <div v-if="cardLabel" class="card-src">{{ cardLabel }}</div>
    </div>

    <section v-for="sec in sections" :key="sec.key" class="sec" data-test="overlay-section">
    <header class="head">
      <span class="label">{{ sec.source.scope === 'party' ? 'Party' : 'Org' }}</span>
      <span class="title">{{ sec.source.label }}</span>
      <span class="count">{{ sec.online }} online</span>
    </header>

    <div class="list">
      <template v-for="row in sec.rows" :key="row.key">
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
            <MemberRow v-for="m in row.crew" :key="m.userId" :member="m" :compact="compact" :self="m.userId === sec.selfId" nested />
          </div>
        </section>
        <MemberRow v-else :member="row.member" :compact="compact" :self="row.member.userId === sec.selfId" />
      </template>
    </div>
    </section>
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
.sec + .sec {
  margin-top: 8px;
}
.card {
  padding: 8px 10px;
  margin-bottom: 6px;
  background: rgba(11, 11, 14, 0.92);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-left: 3px solid rgb(132, 132, 252);
}
.card.warn {
  border-left-color: #fbbf24;
}
.card-title {
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.06em;
}
.card-detail {
  margin-top: 2px;
  font-size: 11px;
  color: #a1a1ae;
}
.card-src {
  margin-top: 4px;
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: rgb(132, 132, 252);
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
