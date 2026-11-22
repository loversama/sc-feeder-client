/**
 * Dev-only fake window.voidlogControl backed by our SAMPLE action list (test/telemetry/fixtures).
 * Used for UI previews/screenshots only; the real app always shows the game's own list.
 */
import { SAMPLE_ACTIONS as FIXTURE } from '../../test/telemetry/fixtures/sample-actions';
import { classifyAction } from '../../electron/modules/telemetry/game-control-catalog';
import type { ControlResult, ControlState, VoidlogControlApi, ControlEvent } from '../types/game-control';

export function installFixtureControlBridge(params: URLSearchParams): void {
  const now = Date.now();
  const actions = (FIXTURE as any[]).map((a) => classifyAction({ name: a.action_name, category: a.category, holdable: a.holdable }));
  const result = (action: string, code: string, agoMs: number): ControlResult => {
    const a = actions.find((x) => x.name === action);
    return { ok: code === 'OK', code, action, label: a?.label, message: code, sent: true, at: now - agoMs };
  };
  const state: ControlState = {
    enabled: params.get('enabled') !== '0',
    gameStatus: params.get('game') ?? 'streaming',
    loaded: true,
    actions,
    lastRefreshAt: now - 30_000,
    lastRefreshError: null,
    confirmHoldMs: 1200,
    favourites:
      params.get('favs') === '0'
        ? []
        : ['v_toggle_landing_system', 'v_toggle_qdrive_engagement', 'v_master_mode_set_scm', 'v_master_mode_set_nav', 'v_power_toggle_shields', 'v_invoke_ping', 'v_open_all_doors', 'v_self_destruct'],
    hotkeys: [
      { action: 'v_toggle_landing_system', accelerator: 'CommandOrControl+Alt+G', registered: true },
      { action: 'v_toggle_qdrive_engagement', accelerator: 'CommandOrControl+Alt+Q', registered: true },
      { action: 'v_master_mode_set_scm', accelerator: 'F14', registered: true },
      { action: 'v_lights', accelerator: 'CommandOrControl+Alt+O', registered: false, problem: 'overlay' },
    ],
    hotkeysActive: true,
    history: [
      result('v_toggle_landing_system', 'OK', 4_000),
      result('v_toggle_qdrive_engagement', 'MAP_INACTIVE', 21_000),
      result('v_power_toggle_shields', 'OK', 48_000),
      result('v_open_all_doors', 'FILTERED', 75_000),
    ],
    triggerCfgEnabled: params.get('cfg') === '0' ? false : true,
  };
  const listeners = new Set<(e: ControlEvent) => void>();
  const emit = () => listeners.forEach((l) => l({ type: 'state', state: { ...state } }));
  const api: VoidlogControlApi = {
    getState: async () => ({ ...state }),
    setEnabled: async (v) => ((state.enabled = v), { ...state }),
    refresh: async () => ({ ...state }),
    trigger: async (name) => {
      const r = result(name, 'OK', 0);
      state.history = [r, ...state.history].slice(0, 100);
      emit();
      return r;
    },
    arm: async () => {
      // ?armDelay=150 simulates IPC latency (used to check a quick click never confirms)
      const delay = Number(params.get('armDelay') ?? 0);
      if (delay > 0) await new Promise((r) => setTimeout(r, delay));
      return { ok: true, token: 'preview', holdMs: state.confirmHoldMs, expiresAt: Date.now() + 10_000 };
    },
    disarm: async () => {},
    setFavourites: async (names) => ((state.favourites = names), { ...state }),
    setHotkey: async (action, accel) => {
      state.hotkeys = state.hotkeys.filter((h) => h.action !== action);
      if (accel) state.hotkeys.push({ action, accelerator: accel, registered: true });
      return { state: { ...state }, problem: null };
    },
    checkHotkey: async () => null,
    // Mirrors a player whose configured Game.log is E:\StarCitizen\LIVE\Game.log (LIVE + PTU folders exist).
    userCfgPreview: async () => ({
      line: 'server.game.telemetry.trigger.actions.enabled=1',
      root: 'E:\\StarCitizen',
      source: params.get('cfgsrc') === 'default' ? 'default' : 'game-folder',
      files: [
        { channel: 'LIVE', path: 'E:\\StarCitizen\\LIVE\\user.cfg', exists: true, alreadyEnabled: false },
        { channel: 'PTU', path: 'E:\\StarCitizen\\PTU\\user.cfg', exists: false, alreadyEnabled: false },
      ],
    }),
    selectGameRoot: async () => ({ ok: false, canceled: true, preview: await api.userCfgPreview() }),
    enableTriggerInUserCfg: async () => ({ ok: true, changed: true }),
    onEvent: (cb) => (listeners.add(cb), () => listeners.delete(cb)),
  };
  (window as any).voidlogControl = api;
}
