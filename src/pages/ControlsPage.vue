<script setup lang="ts">
/**
 * Game Controls: trigger Star Citizen actions on the player's own game through the local
 * telemetry API (TriggerGameAction). Local only; nothing here is sent to VOIDLOG.GG.
 * Dangerous actions use hold-to-confirm (enforced again in the main process).
 */
import { ref, computed, onMounted, onUnmounted, reactive } from 'vue';
import { CONTROL_GROUPS, HOTKEY_PROBLEMS, type ControlAction, type ControlResult, type ControlState, type VoidlogControlApi, type UserCfgPreview } from '../types/game-control';

const api = (window as any).voidlogControl as VoidlogControlApi | undefined;

const state = ref<ControlState | null>(null);
const search = ref('');
const busy = ref(false);
const collapsed = reactive<Record<string, boolean>>(Object.fromEntries(CONTROL_GROUPS.map((g) => [g.id, !!g.collapsed])));
const lastResult = reactive<Record<string, ControlResult>>({});
type Toast = { id: number; result: ControlResult };
const toasts = ref<Toast[]>([]);
let toastSeq = 0;

// --- hold state (dangerous confirm + holdable actions) ---
const holding = ref<{ name: string; startedAt: number; holdMs: number; token?: string; dangerous: boolean } | null>(null);
const holdProgress = ref(0);
let holdRaf = 0;

// --- hotkey editor ---
const editing = ref<{ action: ControlAction; accel: string; problem: string | null } | null>(null);

const actions = computed(() => state.value?.actions ?? []);
const favourites = computed(() => new Set(state.value?.favourites ?? []));
const hotkeyBy = computed(() => Object.fromEntries((state.value?.hotkeys ?? []).map((h) => [h.action, h])));
const gameStreaming = computed(() => state.value?.gameStatus === 'streaming' || state.value?.gameStatus === 'connected');
const canTrigger = computed(() => !!state.value?.enabled && gameStreaming.value);

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase();
  if (!q) return actions.value;
  return actions.value.filter((a) => a.label.toLowerCase().includes(q) || a.name.toLowerCase().includes(q));
});
const groups = computed(() =>
  CONTROL_GROUPS.map((g) => ({ ...g, actions: filtered.value.filter((a) => a.group === g.id) })).filter((g) => g.actions.length),
);
const favouriteActions = computed(() => (state.value?.favourites ?? []).map((n) => actions.value.find((a) => a.name === n)).filter(Boolean) as ControlAction[]);

const statusLabel = computed(() => {
  const s = state.value?.gameStatus ?? 'unknown';
  if (s === 'streaming') return 'Game connected';
  if (s === 'connected') return 'Game connected (idle)';
  if (s === 'disabled') return 'Telemetry off';
  return 'Game not running';
});

function applyState(s: ControlState) {
  state.value = s;
}

function pushToast(result: ControlResult) {
  const id = ++toastSeq;
  toasts.value = [{ id, result }, ...toasts.value].slice(0, 4);
  setTimeout(() => (toasts.value = toasts.value.filter((t) => t.id !== id)), result.ok ? 2500 : 6000);
}

function onResult(r: ControlResult) {
  lastResult[r.action] = r;
  pushToast(r);
}

async function press(a: ControlAction, holdMs = 0) {
  if (!api) return;
  const r = await api.trigger(a.name, holdMs ? { holdMs } : undefined);
  onResult(r);
}

// Pointer handling: dangerous = hold-to-confirm; holdable = hold sends hold_ms; others = click.
/** Action whose button is physically held right now (set synchronously, before any await). */
let pressed: string | null = null;

async function onDown(a: ControlAction, ev: PointerEvent | KeyboardEvent) {
  if (!api || holding.value || pressed) return;
  if ('button' in ev && ev.button !== 0) return;
  if ('repeat' in ev && ev.repeat) return; // held Space must not re-press
  pressed = a.name;
  if (a.dangerous) {
    const arm = await api.arm(a.name);
    if (arm.ok && pressed !== a.name) {
      // Released (or window lost focus) while arm() was in flight: never start the hold.
      api.disarm(arm.token);
      return;
    }
    if (!arm.ok) {
      pressed = null;
      onResult({ ok: false, code: arm.code, action: a.name, label: a.label, message: arm.message, sent: false, at: Date.now() });
      return;
    }
    holding.value = { name: a.name, startedAt: performance.now(), holdMs: arm.holdMs, token: arm.token, dangerous: true };
    tick();
  } else if (a.holdable) {
    holding.value = { name: a.name, startedAt: performance.now(), holdMs: 5000, dangerous: false };
    tick();
  } else {
    pressed = null;
    press(a);
  }
}

function tick() {
  cancelAnimationFrame(holdRaf);
  const h = holding.value;
  if (!h) return;
  holdProgress.value = Math.min(1, (performance.now() - h.startedAt) / h.holdMs);
  if (h.dangerous && holdProgress.value >= 1) {
    const token = h.token!;
    const a = actions.value.find((x) => x.name === h.name);
    holding.value = null;
    holdProgress.value = 0;
    pressed = null;
    if (a && api) api.trigger(a.name, { confirmToken: token }).then(onResult);
    return;
  }
  holdRaf = requestAnimationFrame(tick);
}

function onUp(a: ControlAction) {
  if (pressed === a.name) pressed = null;
  const h = holding.value;
  if (!h || h.name !== a.name) return;
  cancelAnimationFrame(holdRaf);
  holding.value = null;
  holdProgress.value = 0;
  if (h.dangerous) {
    if (h.token) api?.disarm(h.token);
    onResult({ ok: false, code: 'CANCELLED', action: a.name, label: a.label, message: 'Released early: cancelled.', sent: false, at: Date.now() });
  } else {
    const held = Math.round(performance.now() - h.startedAt);
    press(a, held >= 250 ? held : 0);
  }
}

async function toggleFavourite(a: ControlAction) {
  if (!api || !state.value) return;
  const cur = state.value.favourites ?? [];
  const next = cur.includes(a.name) ? cur.filter((n) => n !== a.name) : [...cur, a.name];
  applyState(await api.setFavourites(next));
}

async function setEnabled(v: boolean) {
  if (!api) return;
  applyState(await api.setEnabled(v));
}

async function refresh() {
  if (!api) return;
  busy.value = true;
  try {
    applyState(await api.refresh());
  } finally {
    busy.value = false;
  }
}

// user.cfg: show exactly what will be written; only the dialog's confirm button writes.
const cfgPreview = ref<UserCfgPreview | null>(null);
async function openCfgDialog() {
  if (!api) return;
  try {
    cfgPreview.value = await api.userCfgPreview();
  } catch (err) {
    pushToast({ ok: false, code: 'ERROR', action: 'user.cfg', label: 'user.cfg', message: `Could not read user.cfg: ${(err as Error)?.message ?? err}`, sent: false, at: Date.now() });
  }
}

async function enableCfg() {
  if (!api) return;
  cfgPreview.value = null;
  const r = await api.enableTriggerInUserCfg();
  pushToast({ ok: r.ok, code: r.ok ? 'OK' : 'ERROR', action: 'user.cfg', label: 'user.cfg', message: r.ok ? 'Game control enabled in user.cfg. Restart Star Citizen to apply.' : `Could not update user.cfg: ${r.error}`, sent: false, at: Date.now() });
  applyState(await api.getState());
}

// --- hotkey editor ---
function openHotkey(a: ControlAction) {
  editing.value = { action: a, accel: hotkeyBy.value[a.name]?.accelerator ?? '', problem: null };
}

function keyName(e: KeyboardEvent): string | null {
  const k = e.key;
  if (['Control', 'Shift', 'Alt', 'Meta', 'AltGraph'].includes(k)) return null;
  if (/^F\d{1,2}$/.test(k)) return k;
  if (e.code.startsWith('Numpad') && /^\d$/.test(k)) return `num${k}`;
  const named: Record<string, string> = { ' ': 'Space', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', '+': 'Plus', '-': 'Minus' };
  if (named[k]) return named[k];
  if (/^Key[A-Z]$/.test(e.code)) return e.code.slice(3);
  if (/^Digit\d$/.test(e.code)) return e.code.slice(5);
  return k.length === 1 ? k.toUpperCase() : k;
}

async function onHotkeyKeydown(e: KeyboardEvent) {
  if (!editing.value) return;
  e.preventDefault();
  if (e.key === 'Escape') return (editing.value = null);
  const key = keyName(e);
  if (!key) return;
  const mods = [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Super'].filter(Boolean);
  const accel = [...mods, key].join('+');
  editing.value.accel = accel;
  editing.value.problem = api ? await api.checkHotkey(editing.value.action.name, accel) : null;
}

async function saveHotkey(clear = false) {
  if (!api || !editing.value) return;
  const r = await api.setHotkey(editing.value.action.name, clear ? null : editing.value.accel || null);
  if (r.problem && !clear) {
    editing.value.problem = r.problem;
    return;
  }
  applyState(r.state);
  editing.value = null;
}

function prettyAccel(a: string) {
  return a.replace('CommandOrControl', 'Ctrl').replace('Super', 'Win');
}

/** Losing focus (alt-tab into the game) cancels any hold: no blind confirmations. */
function cancelHold() {
  const h = holding.value;
  pressed = null;
  if (!h) return;
  const a = actions.value.find((x) => x.name === h.name);
  if (a) onUp(a);
}

const loadError = ref<string | null>(null);
let off: (() => void) | null = null;
onMounted(async () => {
  window.addEventListener('blur', cancelHold);
  if (!api) return;
  try {
    applyState(await api.getState());
  } catch (err) {
    loadError.value = (err as Error)?.message ?? String(err);
    return;
  }
  off = api.onEvent((e) => {
    if (e.type === 'state') applyState(e.state);
    else if (e.type === 'result' && e.result.source === 'hotkey') onResult(e.result); // UI presses are shown from the return value
  });
});
onUnmounted(() => {
  window.removeEventListener('blur', cancelHold);
  off?.();
  cancelAnimationFrame(holdRaf);
});

const codeTone = (r?: ControlResult) => (!r ? '' : r.ok ? 'ok' : ['LOCAL_RATE_LIMITED', 'RATE_LIMITED', 'MAP_INACTIVE', 'CANCELLED', 'CONFIRM_REQUIRED'].includes(r.code) ? 'warn' : 'err');
const ago = (t: number) => {
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  return s < 60 ? `${s}s ago` : `${Math.round(s / 60)}m ago`;
};
</script>

<template>
  <div class="controls-page">
    <div v-if="!api" class="empty">Game control is not available in this window.</div>
    <div v-else-if="loadError" class="empty">Game control could not start: {{ loadError }}</div>
    <template v-else-if="state">
      <!-- Header -->
      <header class="cp-header">
        <div class="cp-title">
          <h1>Game Controls</h1>
          <p>Trigger actions in your own Star Citizen session. Local only: nothing is sent to VOIDLOG.GG.</p>
        </div>
        <div class="cp-head-right">
          <span class="pill" :class="gameStreaming ? 'pill-ok' : 'pill-off'"><i class="dot" />{{ statusLabel }}</span>
          <span class="pill pill-muted">{{ actions.length }} actions</span>
          <button class="btn-ghost" :disabled="busy" @click="refresh">{{ busy ? 'Refreshing...' : 'Refresh' }}</button>
          <label class="switch">
            <input type="checkbox" :checked="state.enabled" @change="setEnabled(($event.target as HTMLInputElement).checked)" />
            <span class="track"><span class="thumb" /></span>
            <span class="switch-label">{{ state.enabled ? 'Control on' : 'Control off' }}</span>
          </label>
        </div>
      </header>

      <div v-if="!state.enabled" class="banner">
        <span><strong>Game control is off.</strong> Turn it on to use the buttons and hotkeys below. Hotkeys are only active while the game is running.</span>
      </div>
      <div v-if="state.triggerCfgEnabled === false" class="banner banner-warn">
        <span><strong>user.cfg:</strong> Star Citizen only accepts actions with <code>server.game.telemetry.trigger.actions.enabled=1</code>.</span>
        <button class="btn-small" @click="openCfgDialog">Add to user.cfg...</button>
      </div>

      <div class="cp-tools">
        <input v-model="search" class="search" placeholder="Search actions (e.g. gear, quantum, shields)" />
        <span class="hint">Red buttons: hold to confirm · Hold radar ping to charge</span>
      </div>

      <!-- Favourites grid -->
      <section v-if="favouriteActions.length" class="fav-section">
        <h2>Pinned</h2>
        <div class="deck">
          <button
            v-for="a in favouriteActions"
            :key="'fav-' + a.name"
            class="deck-key"
            :class="{ danger: a.dangerous, disabled: !canTrigger, [codeTone(lastResult[a.name])]: true }"
            :disabled="!canTrigger"
            @pointerdown="onDown(a, $event)"
            @pointerup="onUp(a)"
            @pointerleave="onUp(a)"
          >
            <span v-if="holding?.name === a.name" class="hold-fill" :style="{ width: holdProgress * 100 + '%' }" />
            <span class="deck-label">{{ a.label }}</span>
            <span v-if="hotkeyBy[a.name]" class="deck-hotkey">{{ prettyAccel(hotkeyBy[a.name].accelerator) }}</span>
            <span v-if="a.dangerous" class="deck-badge">HOLD</span>
          </button>
        </div>
      </section>

      <!-- Groups -->
      <section v-for="g in groups" :key="g.id" class="group" :class="{ inactive: !canTrigger }">
        <button class="group-head" @click="collapsed[g.id] = !collapsed[g.id]">
          <span class="chev" :class="{ open: !collapsed[g.id] }">▸</span>
          <h2>{{ g.label }}</h2>
          <span class="count">{{ g.actions.length }}</span>
        </button>
        <div v-show="!collapsed[g.id] || search" class="grid">
          <div v-for="a in g.actions" :key="a.name" class="action" :class="{ danger: a.dangerous, [codeTone(lastResult[a.name])]: true }">
            <button
              class="action-main"
              :disabled="!canTrigger"
              :title="a.dangerous ? `${a.dangerReason}. Hold to confirm.` : a.name"
              @pointerdown="onDown(a, $event)"
              @pointerup="onUp(a)"
              @pointerleave="onUp(a)"
              @keydown.space.prevent="onDown(a, $event)"
              @keyup.space.prevent="onUp(a)"
            >
              <span v-if="holding?.name === a.name" class="hold-fill" :style="{ width: holdProgress * 100 + '%' }" />
              <span class="action-label">{{ a.label }}</span>
              <span class="action-sub">
                <template v-if="a.dangerous">Hold to confirm · {{ a.dangerReason }}</template>
                <template v-else-if="a.holdable">Hold to charge</template>
                <template v-else-if="lastResult[a.name]">{{ lastResult[a.name].ok ? 'Done' : lastResult[a.name].code.replace(/_/g, ' ').toLowerCase() }} · {{ ago(lastResult[a.name].at) }}</template>
                <template v-else>{{ a.name }}</template>
              </span>
            </button>
            <div class="action-side">
              <button class="icon" :class="{ on: favourites.has(a.name) }" :title="favourites.has(a.name) ? 'Unpin' : 'Pin to top'" @click="toggleFavourite(a)">★</button>
              <button
                v-if="!a.dangerous"
                class="icon hk"
                :class="{ set: hotkeyBy[a.name], bad: hotkeyBy[a.name]?.problem }"
                :title="hotkeyBy[a.name]?.problem ? HOTKEY_PROBLEMS[hotkeyBy[a.name].problem!] : 'Set a global hotkey'"
                @click="openHotkey(a)"
              >
                <template v-if="hotkeyBy[a.name]">{{ prettyAccel(hotkeyBy[a.name].accelerator) }}</template>
                <svg v-else viewBox="0 0 24 16" width="16" height="11" aria-label="Set hotkey"><rect x="1" y="1" width="22" height="14" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M5 5h2M9 5h2M13 5h2M17 5h2M5 8.5h2M9 8.5h2M13 8.5h2M17 8.5h2M7 12h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
              </button>
            </div>
          </div>
        </div>
      </section>

      <!-- Recent activity -->
      <section v-if="state.history.length" class="recent">
        <h2>Recent</h2>
        <ul>
          <li v-for="(r, i) in state.history.slice(0, 8)" :key="i" :class="codeTone(r)">
            <span class="r-name">{{ r.label || r.action }}</span>
            <span class="r-code">{{ r.code.replace(/_/g, ' ') }}</span>
            <span class="r-time">{{ ago(r.at) }}</span>
          </li>
        </ul>
      </section>
    </template>

    <!-- Hotkey editor -->
    <div v-if="editing" class="modal-back" @click.self="editing = null">
      <div class="modal" tabindex="0" autofocus @keydown="onHotkeyKeydown">
        <h3>Hotkey for {{ editing.action.label }}</h3>
        <p class="muted">Press a key combination. It works system-wide while Star Citizen is running.</p>
        <div class="capture" :class="{ bad: editing.problem }">{{ editing.accel ? prettyAccel(editing.accel) : 'Press keys...' }}</div>
        <p v-if="editing.problem" class="problem">{{ HOTKEY_PROBLEMS[editing.problem] ?? editing.problem }}</p>
        <div class="modal-actions">
          <button class="btn-ghost" @click="saveHotkey(true)">Clear</button>
          <button class="btn-ghost" @click="editing = null">Cancel</button>
          <button class="btn-primary" :disabled="!editing.accel || !!editing.problem" @click="saveHotkey()">Save</button>
        </div>
      </div>
    </div>

    <!-- user.cfg confirm -->
    <div v-if="cfgPreview" class="modal-back" @click.self="cfgPreview = null">
      <div class="modal modal-wide">
        <h3>Enable game control in user.cfg</h3>
        <p class="muted">This line will be added (or an existing value changed to 1). A dated <code>.bak</code> copy of each existing file is saved first. Restart Star Citizen afterwards.</p>
        <pre class="cfg-line">{{ cfgPreview.line }}</pre>
        <ul class="cfg-files">
          <li v-for="f in cfgPreview.files" :key="f.path">
            <span class="cfg-ch">{{ f.channel }}</span>
            <span class="cfg-path">{{ f.path }}</span>
            <span class="cfg-st">{{ f.alreadyEnabled ? 'already set' : f.exists ? 'add line (backup first)' : 'create file' }}</span>
          </li>
        </ul>
        <div class="modal-actions">
          <button class="btn-ghost" @click="cfgPreview = null">Cancel</button>
          <button class="btn-primary" :disabled="cfgPreview.files.every((f) => f.alreadyEnabled)" @click="enableCfg">Write to user.cfg</button>
        </div>
      </div>
    </div>

    <!-- Toasts -->
    <div class="toasts">
      <div v-for="t in toasts" :key="t.id" class="toast" :class="codeTone(t.result)">
        <strong>{{ t.result.label || t.result.action }}</strong>
        <span>{{ t.result.ok ? 'Done' : t.result.message }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.controls-page { position: relative; height: 100%; overflow-y: auto; padding: 18px 20px 80px; color: #e5e7eb; background: #171717; font-family: Inter, 'Segoe UI', system-ui, sans-serif; }
.empty { padding: 40px; color: #a3a3a3; }
.cp-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; flex-wrap: wrap; }
.cp-title h1 { font-size: 20px; font-weight: 700; letter-spacing: .02em; margin: 0; color: #fff; }
.cp-title p { margin: 4px 0 0; font-size: 12px; color: #a3a3a3; }
.cp-head-right { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.pill { display: inline-flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .06em; padding: 4px 9px; border-radius: 999px; border: 1px solid #404040; }
.pill .dot { width: 7px; height: 7px; border-radius: 50%; background: currentColor; }
.pill-ok { color: #4ade80; border-color: rgba(74,222,128,.35); }
.pill-off { color: #a3a3a3; }
.pill-muted { color: #a3a3a3; }
.btn-ghost, .btn-small, .btn-primary { font-size: 12px; font-weight: 600; border-radius: 6px; padding: 6px 12px; border: 1px solid #404040; background: #262626; color: #e5e7eb; cursor: pointer; }
.btn-ghost:hover, .btn-small:hover { border-color: #6363f7; }
.btn-primary { background: #6363f7; border-color: #6363f7; color: #fff; }
.btn-primary:disabled { opacity: .45; cursor: not-allowed; }
.switch { display: inline-flex; align-items: center; gap: 8px; cursor: pointer; user-select: none; }
.switch input { display: none; }
.track { width: 36px; height: 20px; border-radius: 999px; background: #404040; position: relative; transition: background .15s; }
.thumb { position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; border-radius: 50%; background: #fff; transition: transform .15s; }
.switch input:checked + .track { background: #6363f7; }
.switch input:checked + .track .thumb { transform: translateX(16px); }
.switch-label { font-size: 12px; font-weight: 600; }
.banner { margin-top: 14px; padding: 10px 12px; border-radius: 8px; border: 1px solid #404040; background: #1f1f1f; font-size: 12px; color: #d4d4d4; display: flex; justify-content: space-between; align-items: center; gap: 12px; }
.banner-warn { border-color: rgba(251,191,36,.35); background: rgba(251,191,36,.06); }
.banner code { font-size: 11px; background: #262626; padding: 1px 4px; border-radius: 3px; }
.cp-tools { display: flex; align-items: center; gap: 12px; margin: 16px 0 6px; flex-wrap: wrap; }
.search { flex: 1; min-width: 220px; background: #262626; border: 1px solid #404040; border-radius: 6px; padding: 8px 10px; color: #e5e7eb; font-size: 13px; outline: none; }
.search:focus { border-color: #6363f7; }
.hint { font-size: 11px; color: #737373; }
h2 { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: .08em; color: #a3a3a3; margin: 0; }
.fav-section { margin-top: 14px; }
.fav-section h2 { margin-bottom: 8px; }
.deck { display: grid; grid-template-columns: repeat(auto-fill, minmax(104px, 1fr)); gap: 8px; }
.deck-key { position: relative; overflow: hidden; aspect-ratio: 1 / 1; border-radius: 10px; border: 1px solid #404040; background: linear-gradient(180deg, #2a2a2e, #1e1e22); color: #fff; font-weight: 700; font-size: 13px; cursor: pointer; display: flex; flex-direction: column; justify-content: center; align-items: center; gap: 6px; padding: 8px; text-align: center; box-shadow: inset 0 1px 0 rgba(255,255,255,.04); }
.deck-key:hover:not(:disabled) { border-color: #6363f7; }
.deck-key.ok { border-color: rgba(74,222,128,.5); }
.deck-key.err { border-color: rgba(248,113,113,.6); }
.deck-key.warn { border-color: rgba(251,191,36,.5); }
.deck-key.danger { background: linear-gradient(180deg, #3a1d1d, #251414); border-color: rgba(248,113,113,.55); }
.deck-key:disabled { opacity: .5; cursor: not-allowed; }
.deck-hotkey { font-size: 10px; font-weight: 600; color: #a5a5ff; background: rgba(99,99,247,.15); border-radius: 4px; padding: 1px 5px; }
.deck-badge { position: absolute; top: 6px; right: 6px; font-size: 9px; letter-spacing: .08em; color: #fca5a5; }
.group { margin-top: 16px; }
.group.inactive .action-main { opacity: .45; }
.fav-section .deck-key:disabled { opacity: .45; }
.group-head { display: flex; align-items: center; gap: 8px; background: none; border: 0; color: inherit; cursor: pointer; padding: 4px 0; }
.chev { color: #737373; transition: transform .15s; display: inline-block; font-size: 11px; }
.chev.open { transform: rotate(90deg); }
.count { font-size: 11px; color: #737373; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap: 8px; margin-top: 8px; }
.action { display: flex; border: 1px solid #333; border-radius: 8px; background: #212121; overflow: hidden; transition: border-color .15s; }
.action:hover { border-color: #4d4d6b; }
.action.ok { border-color: rgba(74,222,128,.45); }
.action.err { border-color: rgba(248,113,113,.55); }
.action.warn { border-color: rgba(251,191,36,.45); }
.action.danger { border-color: rgba(248,113,113,.45); background: #2a1b1b; }
.action-main { position: relative; overflow: hidden; flex: 1; min-width: 0; text-align: left; background: none; border: 0; color: inherit; padding: 9px 10px; cursor: pointer; display: flex; flex-direction: column; gap: 2px; }
.action-main:disabled { cursor: not-allowed; opacity: .55; }
.action-main:active:not(:disabled) { background: rgba(99,99,247,.12); }
.action-label { position: relative; font-size: 13px; font-weight: 600; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.action.danger .action-label { color: #fca5a5; }
.action-sub { position: relative; line-height: 1.45; padding-bottom: 1px; font-size: 10.5px; color: #8a8a8a; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-family: ui-monospace, 'Cascadia Mono', monospace; }
.action.danger .action-sub { white-space: normal; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; font-family: inherit; }
.modal-wide { width: 560px; }
.modal code { font-size: 11px; background: #1a1a1a; padding: 1px 4px; border-radius: 3px; }
.cfg-line { margin: 0 0 10px; padding: 10px 12px; background: #161616; border: 1px solid #404040; border-radius: 6px; font-size: 12.5px; color: #c7c7ff; white-space: pre-wrap; word-break: break-all; }
.cfg-files { list-style: none; padding: 0; margin: 0; font-size: 11.5px; border: 1px solid #333; border-radius: 6px; }
.cfg-files li { display: grid; grid-template-columns: 44px 1fr auto; gap: 8px; padding: 6px 10px; border-top: 1px solid #2a2a2a; align-items: baseline; }
.cfg-files li:first-child { border-top: 0; }
.cfg-ch { font-weight: 700; color: #fff; }
.cfg-path { font-family: ui-monospace, monospace; color: #a3a3a3; word-break: break-all; }
.cfg-st { color: #fbbf24; white-space: nowrap; }
.hold-fill { position: absolute; inset: 0 auto 0 0; background: rgba(248,113,113,.28); pointer-events: none; }
.action-side { display: flex; flex-direction: column; border-left: 1px solid #2e2e2e; }
.icon { flex: 1; min-width: 34px; background: none; border: 0; color: #5f5f5f; cursor: pointer; font-size: 12px; padding: 0 8px; }
.icon:hover { color: #e5e7eb; background: #2a2a2a; }
.icon.on { color: #facc15; }
.icon.hk { font-size: 10px; font-weight: 600; border-top: 1px solid #2e2e2e; white-space: nowrap; }
.icon.hk.set { color: #a5a5ff; }
.icon.hk.bad { color: #f87171; }
.recent { margin-top: 22px; }
.recent ul { list-style: none; padding: 0; margin: 8px 0 0; border: 1px solid #2e2e2e; border-radius: 8px; overflow: hidden; }
.recent li { display: grid; grid-template-columns: 1fr auto 70px; gap: 12px; padding: 6px 10px; font-size: 12px; border-top: 1px solid #262626; }
.recent li:first-child { border-top: 0; }
.recent .r-code { font-size: 10.5px; text-transform: uppercase; letter-spacing: .05em; }
.recent li.ok .r-code { color: #4ade80; }
.recent li.warn .r-code { color: #fbbf24; }
.recent li.err .r-code { color: #f87171; }
.recent .r-time { color: #737373; text-align: right; }
.modal-back { position: fixed; inset: 0; background: rgba(0,0,0,.55); display: flex; align-items: center; justify-content: center; z-index: 50; }
.modal { width: 380px; max-width: calc(100vw - 32px); background: #232323; border: 1px solid #404040; border-radius: 10px; padding: 18px; outline: none; }
.modal h3 { margin: 0 0 4px; font-size: 15px; color: #fff; }
.muted { font-size: 12px; color: #a3a3a3; margin: 0 0 12px; }
.capture { font-family: ui-monospace, monospace; font-size: 16px; text-align: center; padding: 14px; border: 1px dashed #6363f7; border-radius: 8px; color: #c7c7ff; }
.capture.bad { border-color: #f87171; color: #fca5a5; }
.problem { color: #f87171; font-size: 12px; margin: 8px 0 0; }
.modal-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px; }
.toasts { position: fixed; right: 16px; bottom: 16px; display: flex; flex-direction: column; gap: 8px; z-index: 60; max-width: 340px; }
.toast { background: #262626; border: 1px solid #404040; border-left: 3px solid #6363f7; border-radius: 6px; padding: 8px 12px; font-size: 12px; display: flex; flex-direction: column; gap: 2px; box-shadow: 0 6px 20px rgba(0,0,0,.4); }
.toast strong { color: #fff; font-size: 12.5px; }
.toast.ok { border-left-color: #4ade80; }
.toast.warn { border-left-color: #fbbf24; }
.toast.err { border-left-color: #f87171; }
</style>
