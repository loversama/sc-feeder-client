<script setup lang="ts">
/** Settings -> Body-cam: optional, opt-in screenshots of the Star Citizen window shared with chosen orgs. */
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { ElMessage } from 'element-plus';

type Settings = { enabled: boolean; intervalSec: number; orgs: string[]; titlePattern: string };
type Status = { state: string; detail?: string; lastSentAt: number | null; framesSent: number; lastBytes: number | null };
type Info = {
  settings: Settings;
  status: Status;
  gameRunning: boolean;
  online: boolean;
  server: { ok?: boolean; enabled?: boolean; availableOrgs?: string[] } | null;
};

const api = (window as any).logMonitorApi;
const info = ref<Info | null>(null);
const busy = ref(false);
let timer: ReturnType<typeof setInterval> | undefined;

const STATE_TEXT: Record<string, string> = {
  off: 'Not sharing',
  sharing: 'Sharing',
  'game-not-running': 'Waiting for Star Citizen to start',
  'window-not-found': 'Game window not found (is it minimised?)',
  'blank-frame': 'Game window is blank (exclusive fullscreen?). Try borderless windowed',
  offline: 'Not connected to VOIDLOG.GG',
  rejected: 'The server did not accept the frame',
  error: 'Capture error',
};

const settings = computed(() => info.value?.settings ?? null);
const serverOff = computed(() => info.value?.server?.enabled === false);
const available = computed(() => info.value?.server?.availableOrgs ?? []);
const statusText = computed(() => {
  const s = info.value?.status;
  if (!s) return '';
  return (STATE_TEXT[s.state] ?? s.state) + (s.detail ? ` (${s.detail})` : '');
});
const lastSent = computed(() => {
  const t = info.value?.status.lastSentAt;
  return t ? `${Math.max(0, Math.round((Date.now() - t) / 1000))} s ago` : 'never';
});

async function load() {
  info.value = await api.invoke('bodycam:get');
}

async function save(patch: Partial<Settings>) {
  busy.value = true;
  try {
    const r = await api.invoke('bodycam:set-settings', patch);
    if (info.value) info.value = { ...info.value, settings: r.settings, status: r.status };
    await load();
  } catch (err) {
    ElMessage.error(`Could not save: ${(err as Error).message}`);
  } finally {
    busy.value = false;
  }
}

function toggle(on: boolean) {
  if (on && !(settings.value?.orgs.length)) {
    // pick every org the user can share with by default only when there is exactly one
    const a = available.value;
    void save({ enabled: true, orgs: a.length === 1 ? [a[0]] : [] });
    if (a.length !== 1) ElMessage.info('Choose which org(s) may see your screenshots to start sharing.');
    return;
  }
  void save({ enabled: on });
}

onMounted(async () => {
  await load();
  timer = setInterval(load, 3000);
});
onUnmounted(() => clearInterval(timer));
</script>

<template>
  <div v-if="settings" class="mt-6 bg-theme-bg-panel/80 rounded-lg p-6 border border-theme-border space-y-4">
    <div class="flex items-center justify-between">
      <h4 class="text-lg font-semibold text-theme-text-white">Share game screenshots with my org</h4>
      <el-switch :model-value="settings.enabled" :disabled="busy || serverOff" @change="toggle" />
    </div>

    <p class="text-gray-400 text-sm">
      Optional and off by default. While Star Citizen is running, VOIDLOG takes a small picture of the
      <b>Star Citizen window only</b> (never your screen or any other window) every few seconds and shows it to the members of the org(s) you
      choose, on their live page next to your character vitals. Only the newest picture is kept, for about two minutes; nothing is stored or
      recorded. Nothing is injected into or read from the game. Turn it off at any time and the picture is removed immediately.
    </p>
    <p v-if="serverOff" class="text-orange-400 text-sm">Body-cam is not enabled on the VOIDLOG.GG server yet.</p>

    <div v-if="settings.enabled || available.length" class="space-y-3">
      <div>
        <div class="text-theme-text-white text-sm mb-1">Share with</div>
        <el-select
          :model-value="settings.orgs"
          multiple
          placeholder="Choose org(s)"
          style="width: 100%"
          :disabled="busy || serverOff || !available.length"
          @change="(v: string[]) => save({ orgs: v })"
        >
          <el-option v-for="o in available" :key="o" :label="o" :value="o" />
        </el-select>
        <p v-if="info?.online && !available.length" class="text-gray-500 text-xs mt-1">You are not a verified member of any org on VOIDLOG.GG.</p>
        <p v-if="!info?.online" class="text-gray-500 text-xs mt-1">Sign in and connect to VOIDLOG.GG to choose orgs.</p>
      </div>

      <div class="flex items-center gap-4">
        <span class="text-theme-text-white text-sm w-28 shrink-0">Every {{ settings.intervalSec }} s</span>
        <el-slider :model-value="settings.intervalSec" :min="5" :max="60" :step="5" :disabled="busy" style="flex: 1" @change="(v: number) => save({ intervalSec: v })" />
      </div>
    </div>

    <div v-if="settings.enabled && settings.orgs.length" class="flex items-center gap-3 text-sm border border-theme-border rounded p-3">
      <span class="inline-block w-2.5 h-2.5 rounded-full" :class="info?.status.state === 'sharing' ? 'bg-green-400 animate-pulse' : 'bg-gray-500'" />
      <div class="flex-1">
        <div class="text-theme-text-white">
          {{ info?.status.state === 'sharing' ? `Sharing with ${settings.orgs.join(', ')}` : statusText }}
        </div>
        <div class="text-gray-500 text-xs">
          Last frame: {{ lastSent }}<template v-if="info?.status.lastBytes"> · {{ Math.round(info.status.lastBytes / 1024) }} KB</template>
          · {{ info?.status.framesSent ?? 0 }} sent this session
        </div>
      </div>
    </div>

    <details class="text-xs text-gray-500">
      <summary class="cursor-pointer">Advanced</summary>
      <div class="mt-2 space-y-2">
        <div>Game window title pattern (regular expression, case-insensitive)</div>
        <el-input :model-value="settings.titlePattern" size="small" :disabled="busy" @change="(v: string) => save({ titlePattern: v })" />
      </div>
    </details>
  </div>
</template>
