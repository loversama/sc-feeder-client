<script setup lang="ts">
/**
 * In-game debug overlay (bottom-right, click-through). Shows, live:
 *  - game telemetry connection + every field the game is streaming
 *  - what is being shared with VOIDLOG.GG
 *  - events passing through the client (telemetry-derived, Game.log parser, server, system)
 *  - Game.log diff vs the previous log (new line kinds, parser patterns that stopped matching)
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';

type Row = [string, string];
type Section = { name: string; ageMs: number; stale: boolean; frames: number; rows: Row[] };
type DebugEvent = { id: string; at: string; source: string; type: string; summary: string; severity?: string; shared?: boolean };
type State = {
  at: number;
  gameRunning: boolean;
  hotkey: string | null;
  telemetry: {
    enabled: boolean; status: string; address: string; fps: number; frames: number; bytesReceived: number;
    lastError: string | null; connectAttempts: number; schemaBuild: string; sections: Section[];
    logHints: { cfgEnabled: boolean | null; serviceRegistered: boolean; serverAddress: string | null; componentInitialized: boolean };
  };
  sharing: {
    enabled: boolean; serverConnected: boolean; lastSnapshotAt: string | null; lastSnapshotBytes: number;
    counters: { logChunks: number; logBytes: number; telemetrySnapshots: number; telemetryEvents: number; telemetryBytes: number; dropped: number };
  };
  events: DebugEvent[];
  logDiff: null | {
    current: { build: { fileVersion?: string; build?: string }; lines: number; signatures: number };
    baseline: null | { build: { fileVersion?: string; build?: string }; lines: number; signatures: number; source: string };
    counts: { added: number; notSeen: number; common: number };
    added: Array<{ signature: string; count: number }>;
    lostPatterns: Array<{ name: string; baseline: number }>;
    newPatterns: string[];
  };
};

const state = ref<State | null>(null);
/** key → time it last changed, for the change highlight */
const changedAt = new Map<string, number>();
const prevValues = new Map<string, string>();
let off: (() => void) | undefined;

const SECTION_ORDER = ['actor', 'vehicle', 'weapons', 'turret', 'events', 'force_feedback'];
const MAX_ROWS: Record<string, number> = { actor: 22, vehicle: 30, weapons: 14, turret: 3, events: 4, force_feedback: 6 };

onMounted(() => {
  off = (window as any).overlayApi?.onState((s: State) => {
    const now = Date.now();
    for (const sec of s.telemetry.sections) {
      for (const [k, v] of sec.rows) {
        const key = `${sec.name}.${k}`;
        const before = prevValues.get(key);
        if (before !== undefined && before !== v) changedAt.set(key, now);
        prevValues.set(key, v);
      }
    }
    state.value = s;
  });
});
onBeforeUnmount(() => off?.());

const sections = computed(() =>
  [...(state.value?.telemetry.sections ?? [])].sort(
    (a, b) => (SECTION_ORDER.indexOf(a.name) + 99) % 99 - (SECTION_ORDER.indexOf(b.name) + 99) % 99,
  ),
);

function isChanged(section: string, key: string): boolean {
  const t = changedAt.get(`${section}.${key}`);
  return !!t && Date.now() - t < 1200;
}

function shortKey(k: string): string {
  return k.replace(/^state\./, '').replace(/^vitals\./, 'v.').replace(/^flight\./, 'f.').replace(/\.current$/, '');
}

function shortVal(v: string): string {
  return v
    .replace(/^(ACTOR_LOCOMOTION_STATE|ACTOR_CREW_ROLE|VEHICLE_COMPONENT_DEPLOYMENT_STATE|VEHICLE_MASTER_MODE|VEHICLE_TYPE|ANNUNCIATOR_STATE|DOOR_OPEN_STATE|DOOR_LOCK_STATE|COUNTERMEASURE_TYPE|GAME_EVENT_TYPE)_/, '')
    .slice(0, 34);
}

function time(iso: string): string {
  return iso.slice(11, 19);
}

function bytes(n: number): string {
  if (n > 1048576) return `${(n / 1048576).toFixed(1)} MB`;
  if (n > 1024) return `${(n / 1024).toFixed(1)} kB`;
  return `${n} B`;
}

function ago(iso: string | null): string {
  if (!iso || !state.value) return '—';
  const s = Math.max(0, Math.round((state.value.at - Date.parse(iso)) / 1000));
  return s < 60 ? `${s}s` : `${Math.round(s / 60)}m`;
}

const SOURCE_LABEL: Record<string, string> = { telemetry: 'TLM', log: 'LOG', server: 'SRV', system: 'SYS' };
const statusClass = computed(() => `st-${state.value?.telemetry.status ?? 'disabled'}`);
</script>

<template>
  <div class="wrap">
    <div v-if="state" class="panel">
      <!-- header -->
      <div class="hdr">
        <span class="brand">VOIDLOG.GG</span>
        <span class="muted">telemetry debug</span>
        <span class="pill" :class="statusClass">{{ state.telemetry.status.replace(/_/g, ' ') }}</span>
        <span v-if="state.telemetry.status === 'streaming'" class="muted">{{ state.telemetry.fps }} fps</span>
      </div>
      <div class="line muted">
        {{ state.telemetry.address }} · {{ state.telemetry.frames }} frames · {{ bytes(state.telemetry.bytesReceived) }} ·
        game {{ state.gameRunning ? 'running' : 'not detected' }}<span v-if="state.hotkey"> · {{ state.hotkey }} hides</span>
      </div>

      <!-- why no telemetry -->
      <div v-if="state.telemetry.status !== 'streaming'" class="hint">
        <div v-if="!state.telemetry.enabled">Telemetry disabled in VOIDLOG settings.</div>
        <template v-else>
          <div>user.cfg telemetry: <b>{{ state.telemetry.logHints.cfgEnabled === null ? 'not seen in Game.log' : state.telemetry.logHints.cfgEnabled ? 'enabled' : 'disabled' }}</b>
            · service {{ state.telemetry.logHints.serviceRegistered ? 'registered' : '—' }}
            · server {{ state.telemetry.logHints.serverAddress ?? '—' }}
            · player {{ state.telemetry.logHints.componentInitialized ? 'spawned' : '—' }}</div>
          <div v-if="state.telemetry.logHints.cfgEnabled !== true" class="muted">Needs SC 5.0+ and <code>server.game.telemetry.enabled=1</code> in user.cfg (Settings → Telemetry).</div>
          <div v-if="state.telemetry.lastError" class="muted err">{{ state.telemetry.lastError.slice(0, 120) }}</div>
        </template>
      </div>

      <!-- sharing -->
      <div class="line">
        <span class="lbl">SHARED</span>
        <template v-if="state.sharing.enabled">
          <span :class="state.sharing.serverConnected ? 'ok' : 'warn'">{{ state.sharing.serverConnected ? 'server ✓' : 'server ✗' }}</span>
          · snap {{ state.sharing.counters.telemetrySnapshots }} ({{ bytes(state.sharing.lastSnapshotBytes) }}, {{ ago(state.sharing.lastSnapshotAt) }})
          · ev {{ state.sharing.counters.telemetryEvents }}
          · log {{ state.sharing.counters.logChunks }}/{{ bytes(state.sharing.counters.logBytes) }}
          <span v-if="state.sharing.counters.dropped" class="warn"> · dropped {{ state.sharing.counters.dropped }}</span>
        </template>
        <span v-else class="muted">telemetry sharing off (log chunks {{ state.sharing.counters.logChunks }})</span>
      </div>

      <!-- events -->
      <div class="sec-title">EVENTS</div>
      <div class="events">
        <div v-for="e in state.events.slice(0, 14)" :key="e.id" class="ev" :class="`sev-${e.severity ?? 'info'}`">
          <span class="t">{{ time(e.at) }}</span>
          <span class="src" :class="`src-${e.source}`">{{ SOURCE_LABEL[e.source] ?? e.source }}</span>
          <span class="sum">{{ e.summary }}</span>
          <span class="sh" :title="e.shared ? 'sent to VOIDLOG.GG' : 'local only'">{{ e.shared === true ? '↑' : e.shared === false ? '·' : '' }}</span>
        </div>
        <div v-if="!state.events.length" class="muted">no events yet</div>
      </div>

      <!-- telemetry sections -->
      <template v-for="sec in sections" :key="sec.name">
        <div class="sec-title" :class="{ stale: sec.stale }">
          {{ sec.name.toUpperCase() }} <span class="muted">{{ sec.frames }}f · {{ sec.stale ? 'stale' : `${sec.ageMs}ms` }}</span>
        </div>
        <div class="grid" :class="{ stale: sec.stale }">
          <template v-for="[k, v] in sec.rows.slice(0, MAX_ROWS[sec.name] ?? 12)" :key="k">
            <span class="k">{{ shortKey(k) }}</span>
            <span class="v" :class="{ chg: isChanged(sec.name, k) }">{{ shortVal(v) }}</span>
          </template>
        </div>
        <div v-if="sec.rows.length > (MAX_ROWS[sec.name] ?? 12)" class="muted more">+{{ sec.rows.length - (MAX_ROWS[sec.name] ?? 12) }} more fields</div>
      </template>

      <!-- Game.log diff -->
      <template v-if="state.logDiff">
        <div class="sec-title">GAME.LOG DIFF</div>
        <div class="line">
          {{ state.logDiff.current.build.fileVersion ?? '?' }} ({{ state.logDiff.current.lines }} lines, {{ state.logDiff.current.signatures }} kinds)
          <span class="muted">vs</span>
          <template v-if="state.logDiff.baseline">{{ state.logDiff.baseline.build.fileVersion ?? '?' }} <span class="muted">({{ state.logDiff.baseline.source }})</span></template>
          <span v-else class="muted">no previous log yet</span>
        </div>
        <div v-if="state.logDiff.baseline" class="line">
          <span class="ok">+{{ state.logDiff.counts.added }} new</span> ·
          <span class="warn">{{ state.logDiff.counts.notSeen }} not seen</span> ·
          {{ state.logDiff.counts.common }} same
        </div>
        <div v-if="state.logDiff.lostPatterns.length" class="line err">
          parser patterns lost: {{ state.logDiff.lostPatterns.map((p) => p.name).join(', ') }}
        </div>
        <div v-if="state.logDiff.newPatterns.length" class="line ok">patterns now matching: {{ state.logDiff.newPatterns.join(', ') }}</div>
        <div v-for="a in state.logDiff.added.slice(0, 4)" :key="a.signature" class="sig">+{{ a.count }} {{ a.signature }}</div>
      </template>
      <div class="foot muted">schema {{ state.telemetry.schemaBuild }}</div>
    </div>
  </div>
</template>

<style scoped>
.wrap {
  position: fixed;
  inset: 0;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  align-items: flex-end;
  pointer-events: none;
  font-family: 'Cascadia Mono', Consolas, 'Courier New', monospace;
  font-size: 10.5px;
  line-height: 1.32;
  color: #d8e3ee;
}
.panel {
  width: 100%;
  max-height: 100%;
  overflow: hidden;
  box-sizing: border-box;
  padding: 8px 10px;
  background: rgba(6, 10, 16, 0.72);
  border: 1px solid rgba(120, 200, 255, 0.22);
  border-radius: 6px;
  text-shadow: 0 1px 1px #000;
}
.hdr { display: flex; gap: 6px; align-items: baseline; }
.brand { color: #7cc8ff; font-weight: 700; letter-spacing: 0.06em; }
.pill { padding: 0 5px; border-radius: 3px; font-weight: 700; text-transform: uppercase; font-size: 9.5px; }
.st-streaming { background: #1f7a3d; }
.st-connected { background: #8a6d12; }
.st-waiting_for_game { background: #5a3b12; }
.st-disabled { background: #444; }
.line { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.muted { color: #8796a6; }
.ok { color: #6fe39a; }
.warn { color: #f2c14e; }
.err { color: #ff7a7a; }
.lbl { color: #7cc8ff; margin-right: 4px; }
.hint { margin: 3px 0; padding: 3px 5px; background: rgba(242, 193, 78, 0.1); border-left: 2px solid #f2c14e; white-space: normal; }
code { color: #f2c14e; }
.sec-title { margin-top: 5px; color: #7cc8ff; font-weight: 700; border-bottom: 1px solid rgba(124, 200, 255, 0.18); }
.sec-title.stale, .grid.stale { opacity: 0.45; }
.events { max-height: 196px; overflow: hidden; }
.ev { display: grid; grid-template-columns: 50px 26px 1fr 10px; gap: 4px; white-space: nowrap; }
.ev .sum { overflow: hidden; text-overflow: ellipsis; }
.ev .t { color: #8796a6; }
.src { font-size: 9px; font-weight: 700; text-align: center; border-radius: 2px; }
.src-telemetry { background: #164a73; }
.src-log { background: #4b2f6b; }
.src-server { background: #1d5a44; }
.src-system { background: #3a3a3a; }
.sev-warn .sum { color: #f2c14e; }
.sev-alert .sum { color: #ff7a7a; }
.sh { color: #6fe39a; }
.grid { display: grid; grid-template-columns: 1fr auto 1fr auto; column-gap: 6px; }
.grid .k { color: #8796a6; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.grid .v { text-align: right; white-space: nowrap; transition: color 0.6s; }
.grid .v.chg { color: #ffe27a; }
.more { font-size: 9.5px; }
.sig { color: #9fb3c6; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 9.5px; }
.foot { margin-top: 4px; font-size: 9px; text-align: right; }
</style>
