/** Renderer-side types for the game control bridge (window.voidlogControl, see electron/preload.ts). */
import type { ControlAction } from '../../electron/modules/telemetry/game-control-catalog';
export type { ControlAction, ControlGroup } from '../../electron/modules/telemetry/game-control-catalog';
export { CONTROL_GROUPS } from '../../electron/modules/telemetry/game-control-catalog';

export type ControlResult = {
  ok: boolean;
  code: string;
  action: string;
  label?: string;
  message: string;
  gameMessage?: string;
  sent: boolean;
  retryAfterMs?: number;
  source?: 'ui' | 'hotkey';
  at: number;
};

export type HotkeyStatus = { action: string; accelerator: string; registered: boolean; problem?: string };

export type ControlState = {
  enabled: boolean;
  /** Telemetry connection status (streaming / connected / waiting_for_game / ...). */
  gameStatus: string;
  loaded: boolean;
  actions: ControlAction[];
  lastRefreshAt: number | null;
  lastRefreshError: string | null;
  confirmHoldMs: number;
  favourites: string[];
  hotkeys: HotkeyStatus[];
  hotkeysActive: boolean;
  history: ControlResult[];
  /** user.cfg trigger setting of the active channel (null = unknown). */
  triggerCfgEnabled: boolean | null;
};

export type ControlEvent =
  | { type: 'state'; state: ControlState }
  | { type: 'result'; result: ControlResult };

export type VoidlogControlApi = {
  getState(): Promise<ControlState>;
  setEnabled(enabled: boolean): Promise<ControlState>;
  refresh(): Promise<ControlState>;
  trigger(name: string, opts?: { holdMs?: number; confirmToken?: string }): Promise<ControlResult>;
  arm(name: string): Promise<{ ok: true; token: string; holdMs: number; expiresAt: number } | { ok: false; code: string; message: string }>;
  disarm(token: string): Promise<void>;
  setFavourites(names: string[]): Promise<ControlState>;
  setHotkey(action: string, accelerator: string | null): Promise<{ state: ControlState; problem: string | null }>;
  checkHotkey(action: string, accelerator: string): Promise<string | null>;
  enableTriggerInUserCfg(): Promise<{ ok: boolean; error?: string; changed?: boolean }>;
  onEvent(cb: (e: ControlEvent) => void): () => void;
};

export const HOTKEY_PROBLEMS: Record<string, string> = {
  invalid: 'Not a valid key combination',
  'no-modifier': 'Needs Ctrl, Alt or Win (plain keys would be taken from the game). F13-F24 are allowed alone.',
  duplicate: 'Already used by another action',
  overlay: 'Used by the overlay hotkey',
  'in-use': 'Taken by another app (or Windows)',
  dangerous: "Dangerous actions can't have hotkeys",
  'unknown-action': 'The game no longer lists this action',
};
