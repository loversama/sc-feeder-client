<script setup lang="ts">
/** Settings → Telemetry & Overlay: game telemetry, sharing, in-game overlay, Game.log diff. */
import { onMounted, onUnmounted, ref } from 'vue';
import { ElMessage } from 'element-plus';

type Settings = {
  telemetryEnabled: boolean;
  telemetryShare: boolean;
  telemetryShareBalance: boolean;
  overlayEnabled: boolean;
  overlayAlwaysShow: boolean;
  overlayHotkey: string;
  logDiffEnabled: boolean;
  telemetryRecord: boolean;
};

type PartySettings = {
  partyOverlayEnabled: boolean;
  partyOverlaySource: 'org' | 'party';
  partyOverlayOrgTag: string;
  partyOverlayHotkey: string;
  partyOverlayCompact: boolean;
  partyOverlayScale: number;
  partyOverlayOffsetY: number;
};
type PartyStatus = {
  status: string;
  message: string | null;
  source: { scope: string; id: string; label: string } | null;
  party: { id: string; name: string; code: string; ownerId: string; members: { userId: string; name: string }[] } | null;
  online: number;
} | null;

type CfgRow = { channel: string; active: boolean; path: string; exists: boolean; enabled: boolean };

const api = (window as any).logMonitorApi;
const settings = ref<Settings | null>(null);
const cfg = ref<{ path: string; exists: boolean; enabled: boolean; channels: CfgRow[] } | null>(null);
const live = ref<any>(null);
const busy = ref(false);
const party = ref<PartySettings | null>(null);
const partyStatus = ref<PartyStatus>(null);
const joinCode = ref('');
const partyBusy = ref(false);
let timer: ReturnType<typeof setInterval> | undefined;

async function load() {
  settings.value = await api.invoke('telemetry:get-settings');
  party.value = await api.invoke('party-overlay:get-settings');
  cfg.value = await api.invoke('telemetry:user-cfg-status');
}

async function refreshLive() {
  live.value = await api.invoke('telemetry:get-state');
  partyStatus.value = await api.invoke('party-overlay:status');
}

async function saveParty(patch: Partial<PartySettings>) {
  party.value = await api.invoke('party-overlay:set-settings', patch);
}

async function partyAction(action: 'create' | 'join' | 'leave') {
  partyBusy.value = true;
  try {
    const r = await api.invoke('party-overlay:party', { action, code: action === 'join' ? joinCode.value : undefined });
    if (!r?.ok) ElMessage.error(r?.error ?? 'Party action failed');
    else {
      if (action === 'join') joinCode.value = '';
      if (action !== 'leave' && party.value?.partyOverlaySource !== 'party') await saveParty({ partyOverlaySource: 'party' });
      ElMessage.success(action === 'leave' ? 'Left the party' : `Party: ${r.party?.name} (code ${r.party?.code})`);
    }
    partyStatus.value = await api.invoke('party-overlay:status');
  } finally {
    partyBusy.value = false;
  }
}

async function copyCode(code: string) {
  try {
    await navigator.clipboard.writeText(code);
    ElMessage.success('Invite code copied');
  } catch {
    ElMessage.info(`Invite code: ${code}`);
  }
}

async function save(patch: Partial<Settings>) {
  settings.value = await api.invoke('telemetry:set-settings', patch);
}

async function enableCfg(channel: string = 'all') {
  busy.value = true;
  try {
    const r = await api.invoke('telemetry:enable-user-cfg', channel);
    if (r?.ok) {
      const done = (r.results ?? []).filter((x: any) => x.changed).map((x: any) => x.channel);
      ElMessage.success(done.length ? `Enabled in ${done.join(', ')}. Restart Star Citizen.` : 'Already enabled in user.cfg');
    }
    else ElMessage.error(`Could not update user.cfg: ${r?.error ?? 'unknown error'}`);
    cfg.value = await api.invoke('telemetry:user-cfg-status');
  } finally {
    busy.value = false;
  }
}

async function openRecordings() {
  const r = await api.invoke('telemetry:open-recordings');
  if (r && !r.ok) ElMessage.error(`Could not open ${r.dir}: ${r.error}`);
}

async function exportDiff() {
  const p = await api.invoke('logdiff:export');
  if (p) ElMessage.success(`Report written: ${p}`);
}

async function compareFiles(pickCurrent: boolean) {
  const r = await api.invoke('logdiff:compare-files', { pickCurrent });
  if (r) ElMessage.success(`+${r.counts.added} new · ${r.counts.notSeen} not seen${r.lost.length ? ` · patterns lost: ${r.lost.join(', ')}` : ''}`);
}

onMounted(async () => {
  await load();
  await refreshLive();
  timer = setInterval(refreshLive, 1000);
});
onUnmounted(() => clearInterval(timer));
</script>

<template>
  <div>
    <div class="mb-8">
      <h3 class="text-2xl font-bold text-theme-text-white mb-2">Telemetry & Overlay</h3>
      <p class="text-gray-400">Live data from Star Citizen's local telemetry API (5.0+), the in-game debug overlay, and Game.log change tracking.</p>
    </div>

    <div v-if="settings" class="space-y-6">
      <!-- Status -->
      <div class="bg-theme-bg-panel/80 rounded-lg p-6 border border-theme-border">
        <h4 class="text-lg font-semibold text-theme-text-white mb-2">Status</h4>
        <div v-if="live" class="text-sm text-gray-300 space-y-1 font-mono">
          <div>Telemetry: <b>{{ live.telemetry.status.replace(/_/g, ' ') }}</b> · {{ live.telemetry.address }} · {{ live.telemetry.fps }} fps · {{ live.telemetry.frames }} frames</div>
          <div v-if="cfg?.channels?.length">Channels: <template v-for="(c, i) in cfg.channels" :key="c.channel"><span :class="c.active ? 'text-green-400' : ''">{{ c.channel }}{{ c.active ? ' (active)' : '' }}</span>{{ i < cfg.channels.length - 1 ? ', ' : '' }}</template></div>
          <div>Game: {{ live.gameRunning ? 'StarCitizen.exe running' : 'not detected' }} · user.cfg seen in Game.log: {{ live.telemetry.logHints.cfgEnabled === null ? '—' : live.telemetry.logHints.cfgEnabled }}</div>
          <div>Shared: {{ live.sharing.counters.telemetrySnapshots }} snapshots, {{ live.sharing.counters.telemetryEvents }} events · server {{ live.sharing.serverConnected ? 'connected' : 'offline' }}</div>
          <div class="text-gray-500">Schema: {{ live.telemetry.schemaBuild }}</div>
        </div>
      </div>

      <!-- Telemetry -->
      <div class="bg-theme-bg-panel/80 rounded-lg p-6 border border-theme-border space-y-4">
        <div class="flex items-center justify-between">
          <h4 class="text-lg font-semibold text-theme-text-white">Read game telemetry</h4>
          <el-switch :model-value="settings.telemetryEnabled" @change="(v: boolean) => save({ telemetryEnabled: v })" />
        </div>
        <p class="text-gray-400 text-sm">Connects to the game's local API on 127.0.0.1:2942 (no game modification, no memory reading). Star Citizen must have it switched on in user.cfg.</p>
        <div v-for="c in cfg?.channels ?? []" :key="c.channel" class="flex items-center gap-3 text-sm">
          <span class="w-28 shrink-0 font-semibold" :class="c.active ? 'text-green-400' : 'text-gray-300'">{{ c.channel }}</span>
          <span class="text-gray-400 font-mono truncate flex-1">{{ c.path }}</span>
          <span :class="c.enabled ? 'text-green-400' : 'text-orange-400'">{{ c.enabled ? 'enabled' : c.exists ? 'not enabled' : 'no user.cfg' }}</span>
          <el-button size="small" type="primary" :disabled="c.enabled || busy" @click="enableCfg(c.channel)">Enable</el-button>
        </div>
        <div v-if="(cfg?.channels?.length ?? 0) > 1" class="flex justify-end">
          <el-button size="small" :disabled="cfg?.channels.every((c) => c.enabled) || busy" @click="enableCfg('all')">Enable in all channels</el-button>
        </div>
        <p class="text-gray-500 text-xs">Adds <code>server.game.telemetry.enabled=1</code> to each channel's user.cfg, next to its Game.log (a timestamped .bak copy is kept). Channels are detected from your Star Citizen folder (General settings).</p>
      </div>

      <!-- Sharing -->
      <div class="bg-theme-bg-panel/80 rounded-lg p-6 border border-theme-border space-y-4">
        <div class="flex items-center justify-between">
          <h4 class="text-lg font-semibold text-theme-text-white">Share telemetry with VOIDLOG.GG</h4>
          <el-switch :model-value="settings.telemetryShare" @change="(v: boolean) => save({ telemetryShare: v })" />
        </div>
        <p class="text-gray-400 text-sm">Sends a snapshot about once a second (character vitals and state, ship, weapons) plus events such as entering a ship, landing gear, shields down or countermeasures. Force feedback is never sent.</p>
        <div class="flex items-center justify-between">
          <span class="text-theme-text-white">Include aUEC wallet balance</span>
          <el-switch :model-value="settings.telemetryShareBalance" @change="(v: boolean) => save({ telemetryShareBalance: v })" />
        </div>
      </div>

      <!-- Recording -->
      <div class="bg-theme-bg-panel/80 rounded-lg p-6 border border-theme-border space-y-4">
        <div class="flex items-center justify-between">
          <h4 class="text-lg font-semibold text-theme-text-white">Record telemetry to files</h4>
          <el-switch :model-value="settings.telemetryRecord" @change="(v: boolean) => save({ telemetryRecord: v })" />
        </div>
        <p class="text-gray-400 text-sm">Writes what the game's telemetry reports (every change, events, and which fields never carried data) to a <code>.log</code> file per game session, on this PC only, to review accuracy and what a patch changed. The newest 30 files are kept; each is capped at 50 MB. Force feedback is not recorded.</p>
        <div class="flex items-center gap-3 text-sm">
          <span class="text-gray-300 font-mono truncate flex-1">{{ live?.recording?.active ? live.recording.file : 'not recording' }}</span>
          <el-button size="small" @click="openRecordings">Open recordings folder</el-button>
        </div>
      </div>

      <!-- Overlay -->
      <div class="bg-theme-bg-panel/80 rounded-lg p-6 border border-theme-border space-y-4">
        <div class="flex items-center justify-between">
          <h4 class="text-lg font-semibold text-theme-text-white">In-game debug overlay</h4>
          <el-switch :model-value="settings.overlayEnabled" @change="(v: boolean) => save({ overlayEnabled: v })" />
        </div>
        <p class="text-gray-400 text-sm">Bottom-right panel over the game showing all telemetry, what is shared and every event. Click-through. Needs the game in Borderless or Windowed mode (it can't draw over exclusive Fullscreen).</p>
        <div class="flex items-center justify-between">
          <span class="text-theme-text-white">Show even when the game isn't running</span>
          <el-switch :model-value="settings.overlayAlwaysShow" @change="(v: boolean) => save({ overlayAlwaysShow: v })" />
        </div>
        <div class="flex items-center justify-between gap-4">
          <span class="text-theme-text-white">Hide/show hotkey (while enabled)</span>
          <el-input class="max-w-xs" :model-value="settings.overlayHotkey" @change="(v: string) => save({ overlayHotkey: v.trim() })" placeholder="CommandOrControl+Alt+O" />
        </div>
      </div>

      <!-- Party / org overlay -->
      <div v-if="party" class="bg-theme-bg-panel/80 rounded-lg p-6 border border-theme-border space-y-4">
        <div class="flex items-center justify-between">
          <h4 class="text-lg font-semibold text-theme-text-white">In-game party / org overlay</h4>
          <el-switch :model-value="party.partyOverlayEnabled" @change="(v: boolean) => saveParty({ partyOverlayEnabled: v })" />
        </div>
        <p class="text-gray-400 text-sm">MMO-style party list on the right side of the game: names, health and status, with members in the same ship grouped under a ship dial. The order and grouping follow the layout your org (or party owner) sets on voidlog.gg. Click-through; Borderless or Windowed mode only.</p>
        <div v-if="party.partyOverlayEnabled && partyStatus" class="text-sm" :class="partyStatus.status === 'live' ? 'text-green-400' : 'text-amber-400'">
          {{ partyStatus.status === 'live' ? `Live: ${partyStatus.source?.label ?? ''} · ${partyStatus.online} online` : (partyStatus.message || partyStatus.status) }}
        </div>
        <div class="flex items-center justify-between gap-4">
          <span class="text-theme-text-white">Show</span>
          <el-radio-group :model-value="party.partyOverlaySource" size="small" @change="(v: any) => saveParty({ partyOverlaySource: v })">
            <el-radio-button value="org">Org</el-radio-button>
            <el-radio-button value="party">Party</el-radio-button>
          </el-radio-group>
        </div>
        <div v-if="party.partyOverlaySource === 'org'" class="flex items-center justify-between gap-4">
          <span class="text-theme-text-white">Org tag</span>
          <el-input class="max-w-xs" :model-value="party.partyOverlayOrgTag" @change="(v: string) => saveParty({ partyOverlayOrgTag: v })" placeholder="e.g. VOID" />
        </div>
        <div v-else class="space-y-3">
          <div v-if="partyStatus?.party" class="flex items-center justify-between gap-4">
            <span class="text-theme-text-white">{{ partyStatus.party.name }} · {{ partyStatus.party.members.length }}/10</span>
            <div class="flex gap-2">
              <el-button size="small" @click="copyCode(partyStatus.party.code)">Invite code {{ partyStatus.party.code }}</el-button>
              <el-button size="small" :loading="partyBusy" @click="partyAction('leave')">Leave</el-button>
            </div>
          </div>
          <div class="flex items-center justify-between gap-4">
            <el-button size="small" :loading="partyBusy" @click="partyAction('create')">Create a party</el-button>
            <div class="flex gap-2">
              <el-input v-model="joinCode" class="w-36" size="small" placeholder="Invite code" maxlength="8" />
              <el-button size="small" :loading="partyBusy" :disabled="!joinCode.trim()" @click="partyAction('join')">Join</el-button>
            </div>
          </div>
        </div>
        <div class="flex items-center justify-between">
          <span class="text-theme-text-white">Compact (just for me)</span>
          <el-switch :model-value="party.partyOverlayCompact" @change="(v: boolean) => saveParty({ partyOverlayCompact: v })" />
        </div>
        <div class="flex items-center justify-between gap-4">
          <span class="text-theme-text-white">Size</span>
          <el-slider class="max-w-xs" :model-value="party.partyOverlayScale" :min="0.75" :max="1.5" :step="0.05" @change="(v: any) => saveParty({ partyOverlayScale: Number(v) })" />
        </div>
        <div class="flex items-center justify-between gap-4">
          <span class="text-theme-text-white">Distance from top (% of screen)</span>
          <el-slider class="max-w-xs" :model-value="party.partyOverlayOffsetY" :min="0" :max="60" :step="1" @change="(v: any) => saveParty({ partyOverlayOffsetY: Number(v) })" />
        </div>
        <div class="flex items-center justify-between gap-4">
          <span class="text-theme-text-white">Hide/show hotkey (while enabled)</span>
          <el-input class="max-w-xs" :model-value="party.partyOverlayHotkey" @change="(v: string) => saveParty({ partyOverlayHotkey: v.trim() })" placeholder="CommandOrControl+Alt+P" />
        </div>
      </div>

      <!-- Game.log diff -->
      <div class="bg-theme-bg-panel/80 rounded-lg p-6 border border-theme-border space-y-4">
        <div class="flex items-center justify-between">
          <h4 class="text-lg font-semibold text-theme-text-white">Game.log change tracking</h4>
          <el-switch :model-value="settings.logDiffEnabled" @change="(v: boolean) => save({ logDiffEnabled: v })" />
        </div>
        <p class="text-gray-400 text-sm">Compares the kinds of lines in the current Game.log with the previous one we parsed, and flags parser patterns that stopped matching (useful right after a patch).</p>
        <div v-if="live?.logDiff" class="text-sm text-gray-300 font-mono space-y-1">
          <div>Current: {{ live.logDiff.current.build.fileVersion ?? '?' }} ({{ live.logDiff.current.lines }} lines, {{ live.logDiff.current.signatures }} kinds)</div>
          <div>Previous: <template v-if="live.logDiff.baseline">{{ live.logDiff.baseline.build.fileVersion ?? '?' }} ({{ live.logDiff.baseline.source }})</template><template v-else>none yet</template></div>
          <div v-if="live.logDiff.baseline">+{{ live.logDiff.counts.added }} new · {{ live.logDiff.counts.notSeen }} not seen · {{ live.logDiff.counts.common }} same</div>
          <div v-if="live.logDiff.lostPatterns.length" class="text-red-400">Parser patterns lost: {{ live.logDiff.lostPatterns.map((p: any) => p.name).join(', ') }}</div>
        </div>
        <div class="flex gap-2">
          <el-button size="small" @click="exportDiff">Export full report</el-button>
          <el-button size="small" @click="compareFiles(false)">Compare a log with current…</el-button>
          <el-button size="small" @click="compareFiles(true)">Compare two logs…</el-button>
        </div>
      </div>
    </div>
  </div>
</template>
