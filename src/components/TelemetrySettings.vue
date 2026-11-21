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
};

const api = (window as any).logMonitorApi;
const settings = ref<Settings | null>(null);
const cfg = ref<{ path: string; exists: boolean; enabled: boolean } | null>(null);
const live = ref<any>(null);
const busy = ref(false);
let timer: ReturnType<typeof setInterval> | undefined;

async function load() {
  settings.value = await api.invoke('telemetry:get-settings');
  cfg.value = await api.invoke('telemetry:user-cfg-status');
}

async function refreshLive() {
  live.value = await api.invoke('telemetry:get-state');
}

async function save(patch: Partial<Settings>) {
  settings.value = await api.invoke('telemetry:set-settings', patch);
}

async function enableCfg() {
  busy.value = true;
  try {
    const r = await api.invoke('telemetry:enable-user-cfg');
    if (r?.ok) ElMessage.success(r.changed ? `Added to ${r.path}. Restart Star Citizen.` : 'Already enabled in user.cfg');
    else ElMessage.error(`Could not update user.cfg: ${r?.error ?? 'unknown error'}`);
    cfg.value = await api.invoke('telemetry:user-cfg-status');
  } finally {
    busy.value = false;
  }
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
        <div class="flex items-center gap-3 text-sm">
          <span class="text-gray-300 font-mono truncate">{{ cfg?.path }}</span>
          <span :class="cfg?.enabled ? 'text-green-400' : 'text-orange-400'">{{ cfg?.enabled ? 'enabled' : cfg?.exists ? 'not enabled' : 'no user.cfg' }}</span>
          <el-button size="small" type="primary" :disabled="cfg?.enabled || busy" @click="enableCfg">Enable in user.cfg</el-button>
        </div>
        <p class="text-gray-500 text-xs">Adds <code>server.game.telemetry.enabled=1</code> next to your Game.log (a .bak copy is kept). Change the log path in General to target PTU/LIVE.</p>
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
