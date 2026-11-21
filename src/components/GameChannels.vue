<script setup lang="ts">
/** Star Citizen game folder + detected channels (LIVE, PTU, ...). The active channel is highlighted. */
import { onMounted, onUnmounted, ref } from 'vue';
import { ElMessage } from 'element-plus';

type Channel = { name: string; dir: string; logPath: string; hasLog: boolean; mtimeMs: number; size: number; active: boolean };
type State = { mode: 'root' | 'single'; root: string; logPath: string; active: string | null; channels: Channel[] };

const emit = defineEmits<{ (e: 'single-file'): void }>();
const api = (window as any).logMonitorApi;
const state = ref<State | null>(null);
const busy = ref(false);
let timer: ReturnType<typeof setInterval> | undefined;

async function load() {
  try {
    state.value = await api.invoke('channels:get');
  } catch {
    /* main process not ready yet */
  }
}

async function pickRoot() {
  busy.value = true;
  try {
    const r = await api.invoke('channels:select-root');
    if (!r) return;
    if (r.ok) ElMessage.success(`Watching ${r.channels.join(', ')}`);
    else ElMessage.error(r.error ?? 'Could not use that folder');
    await load();
  } finally {
    busy.value = false;
  }
}

const ago = (ms: number) => {
  if (!ms) return 'no Game.log yet';
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 90) return `written ${s}s ago`;
  if (s < 5400) return `written ${Math.round(s / 60)} min ago`;
  if (s < 172800) return `written ${Math.round(s / 3600)} h ago`;
  return `written ${Math.round(s / 86400)} days ago`;
};

onMounted(async () => {
  await load();
  timer = setInterval(load, 3000);
});
onUnmounted(() => clearInterval(timer));
</script>

<template>
  <div v-if="state" class="space-y-3">
    <div class="flex items-center gap-4">
      <code class="flex-1 bg-theme-bg-dark px-4 py-3 rounded border border-theme-border font-mono text-sm text-theme-text-light overflow-hidden">
        {{ state.mode === 'root' ? state.root : state.logPath }}
      </code>
      <el-button type="primary" class="px-6" :disabled="busy" @click="pickRoot">Change</el-button>
    </div>
    <p class="text-gray-500 text-xs">
      {{ state.mode === 'root'
        ? 'The Star Citizen folder (contains LIVE, PTU, ...). Every channel is watched; the one the game last wrote to is read and shared.'
        : 'Single Game.log mode (custom layout). Pick the Star Citizen folder to watch every channel.' }}
      <a v-if="state.mode === 'root'" class="text-[rgb(99,99,247)] cursor-pointer" @click="emit('single-file')">Use a single Game.log folder instead</a>
    </p>
    <div class="flex flex-wrap gap-2">
      <div
        v-for="c in state.channels"
        :key="c.name"
        class="px-3 py-2 rounded border text-sm"
        :class="c.active ? 'border-green-500/70 bg-green-500/10 text-theme-text-white' : 'border-theme-border text-gray-400'"
      >
        <div class="font-semibold">{{ c.name }}<span v-if="c.active" class="ml-2 text-green-400 text-xs">active</span></div>
        <div class="text-xs text-gray-500">{{ ago(c.mtimeMs) }}</div>
      </div>
      <div v-if="!state.channels.length" class="text-orange-400 text-sm">No channel found in this folder.</div>
    </div>
  </div>
</template>
