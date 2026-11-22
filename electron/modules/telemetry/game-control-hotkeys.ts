/**
 * Global hotkeys for game control (Electron globalShortcut injected, so this is testable).
 *
 * Rules:
 *   - an accelerator must contain Ctrl/Alt/Super (Shift alone isn't enough), except F13–F24
 *     (button-box keys games rarely use). A registered key is swallowed from the game.
 *   - dangerous actions can't be bound: globalShortcut has no key-up, so hold-to-confirm is impossible
 *   - conflicts: duplicate binding, the overlay hotkey, or a key another app already holds
 *   - keys are registered only while active (game control on + game streaming) and only our own
 *     keys are unregistered (never unregisterAll)
 */

import { ACTION_NAME_RE } from './game-control-catalog';

export type ShortcutApi = {
  register(accelerator: string, callback: () => void): boolean;
  unregister(accelerator: string): void;
};

export type HotkeyProblem = 'invalid' | 'no-modifier' | 'duplicate' | 'overlay' | 'in-use' | 'dangerous' | 'unknown-action';

export type HotkeyStatus = { action: string; accelerator: string; registered: boolean; problem?: HotkeyProblem };

const MOD_ALIASES: Record<string, string> = {
  ctrl: 'CommandOrControl',
  control: 'CommandOrControl',
  cmdorctrl: 'CommandOrControl',
  commandorcontrol: 'CommandOrControl',
  alt: 'Alt',
  option: 'Alt',
  altgr: 'AltGr',
  shift: 'Shift',
  super: 'Super',
  meta: 'Super',
  cmd: 'Super',
  command: 'Super',
};
const MOD_ORDER = ['CommandOrControl', 'Alt', 'AltGr', 'Shift', 'Super'];
const NAMED_KEYS = [
  'Space', 'Tab', 'Backspace', 'Delete', 'Insert', 'Enter', 'Up', 'Down', 'Left', 'Right', 'Home', 'End', 'PageUp', 'PageDown',
  'Escape', 'Plus', 'Minus', 'PrintScreen', 'numdec', 'numadd', 'numsub', 'nummult', 'numdiv',
  ...Array.from({ length: 10 }, (_, i) => `num${i}`),
  ...Array.from({ length: 24 }, (_, i) => `F${i + 1}`),
];
const NAMED_LOOKUP = new Map(NAMED_KEYS.map((k) => [k.toLowerCase(), k]));
const PUNCT = new Set([')', '!', '@', '#', '$', '%', '^', '&', '*', '(', ':', ';', '<', '>', '=', ',', '_', '.', '?', '/', '~', '`', '{', '}', '[', ']', '|', '\\', "'", '"']);

/** Canonical form ("ctrl+shift+g" → "CommandOrControl+Shift+G"), or null if invalid. */
export function normalizeAccelerator(input: string): string | null {
  if (typeof input !== 'string') return null;
  const parts = input.split('+').map((p) => p.trim());
  // "Ctrl++" style: a trailing empty part means the key is "Plus"
  if (parts.length > 1 && parts[parts.length - 1] === '' && parts[parts.length - 2] === '') parts.splice(-2, 2, 'Plus');
  if (parts.some((p) => !p)) return null;
  const mods = new Set<string>();
  let key: string | null = null;
  for (const p of parts) {
    const m = MOD_ALIASES[p.toLowerCase()];
    if (m) {
      mods.add(m);
      continue;
    }
    if (key) return null; // two non-modifier keys
    if (/^[a-z0-9]$/i.test(p)) key = p.toUpperCase();
    else if (NAMED_LOOKUP.has(p.toLowerCase())) key = NAMED_LOOKUP.get(p.toLowerCase())!;
    else if (p.length === 1 && PUNCT.has(p)) key = p;
    else return null;
  }
  if (!key) return null;
  return [...MOD_ORDER.filter((m) => mods.has(m)), key].join('+');
}

export function hasRequiredModifier(accel: string): boolean {
  const parts = accel.split('+');
  const key = parts[parts.length - 1];
  if (/^F(1[3-9]|2[0-4])$/.test(key)) return true;
  return parts.slice(0, -1).some((m) => m === 'CommandOrControl' || m === 'Alt' || m === 'AltGr' || m === 'Super');
}

export type HotkeyBinderOptions = {
  api: ShortcutApi;
  /** Accelerators owned by other features (e.g. the overlay hotkey). */
  reserved: () => string[];
  isDangerous: (action: string) => boolean;
  /** When the action list is loaded: is this action known? (unknown → not registered) */
  isKnown?: (action: string) => boolean;
  onFire: (action: string) => void;
};

export class HotkeyBinder {
  #o: HotkeyBinderOptions;
  /** action → canonical accelerator (as saved) */
  #bindings: Record<string, string> = {};
  #registered = new Map<string, string>(); // accelerator → action
  #problems = new Map<string, HotkeyProblem>(); // action → problem
  #active = false;

  constructor(o: HotkeyBinderOptions) {
    this.#o = o;
  }

  get active(): boolean {
    return this.#active;
  }

  /** Static validation of a full binding map (no registration). */
  validate(bindings: Record<string, string>): Map<string, HotkeyProblem> {
    const problems = new Map<string, HotkeyProblem>();
    const reserved = new Set(this.#o.reserved().map((r) => normalizeAccelerator(r)).filter(Boolean) as string[]);
    const seen = new Map<string, string>();
    for (const [action, raw] of Object.entries(bindings)) {
      const accel = normalizeAccelerator(raw);
      if (!accel) problems.set(action, 'invalid');
      else if (this.#o.isDangerous(action)) problems.set(action, 'dangerous');
      else if (!hasRequiredModifier(accel)) problems.set(action, 'no-modifier');
      else if (reserved.has(accel)) problems.set(action, 'overlay');
      else if (seen.has(accel)) {
        problems.set(action, 'duplicate');
        problems.set(seen.get(accel)!, 'duplicate');
      } else seen.set(accel, action);
    }
    return problems;
  }

  /** Check one candidate binding against the current set (for the UI before saving). */
  check(action: string, accelerator: string): HotkeyProblem | null {
    const next = { ...this.#bindings, [action]: accelerator };
    return this.validate(next).get(action) ?? null;
  }

  setBindings(bindings: Record<string, string>): HotkeyStatus[] {
    const clean: Record<string, string> = {};
    for (const [a, raw] of Object.entries(bindings ?? {})) {
      if (typeof a !== 'string' || !ACTION_NAME_RE.test(a) || typeof raw !== 'string' || !raw.trim() || raw.length > 64) continue;
      clean[a] = normalizeAccelerator(raw) ?? raw;
    }
    this.#bindings = clean;
    if (this.#active) this.#apply();
    else this.#problems = this.validate(clean);
    return this.status();
  }

  get bindings(): Record<string, string> {
    return { ...this.#bindings };
  }

  activate(): HotkeyStatus[] {
    this.#active = true;
    this.#apply();
    return this.status();
  }

  deactivate(): void {
    this.#active = false;
    this.#unregisterOwn();
  }

  status(): HotkeyStatus[] {
    return Object.entries(this.#bindings).map(([action, accelerator]) => {
      const problem = this.#problems.get(action);
      return { action, accelerator, registered: this.#registered.get(accelerator) === action, ...(problem ? { problem } : {}) };
    });
  }

  #unregisterOwn(): void {
    for (const accel of this.#registered.keys()) {
      try {
        this.#o.api.unregister(accel);
      } catch {
        /* ignore */
      }
    }
    this.#registered.clear();
  }

  #apply(): void {
    this.#unregisterOwn();
    this.#problems = this.validate(this.#bindings);
    for (const [action, accel] of Object.entries(this.#bindings)) {
      if (this.#problems.has(action)) continue;
      if (this.#o.isKnown && !this.#o.isKnown(action)) {
        this.#problems.set(action, 'unknown-action');
        continue;
      }
      let ok = false;
      try {
        ok = this.#o.api.register(accel, () => this.#o.onFire(action));
      } catch {
        ok = false;
      }
      if (ok) this.#registered.set(accel, action);
      else this.#problems.set(action, 'in-use');
    }
  }
}
