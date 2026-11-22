/**
 * Classification of Star Citizen triggerable actions (ListTriggerableActions) for the Controls page.
 *
 * The game's own list is the source of truth: anything it returns is shown, with unknown names
 * falling back to a group derived from the game category. This file only adds UI grouping,
 * friendly labels and the "dangerous" flag (hold-to-confirm, never on a hotkey).
 * Pure module (no Electron) so it is shared by the main process, renderer and tests.
 */

export type ControlGroup = 'flight' | 'power' | 'doors' | 'combat' | 'utility' | 'emotes' | 'emergency';

export const CONTROL_GROUPS: Array<{ id: ControlGroup; label: string; collapsed?: boolean }> = [
  { id: 'flight', label: 'Flight' },
  { id: 'power', label: 'Power' },
  { id: 'doors', label: 'Doors & Landing' },
  { id: 'combat', label: 'Combat & Seat' },
  { id: 'utility', label: 'Utility' },
  { id: 'emergency', label: 'Emergency' },
  { id: 'emotes', label: 'Emotes', collapsed: true },
];

export type ControlAction = {
  name: string;
  category: string;
  holdable: boolean;
  group: ControlGroup;
  label: string;
  dangerous: boolean;
  /** Why the action needs hold-to-confirm (shown in the UI). */
  dangerReason?: string;
};

/** Explicit dangerous actions with the reason shown to the player. */
const DANGEROUS: Record<string, string> = {
  v_self_destruct: 'Destroys your ship',
  v_eject: 'Ejects you from the seat',
  v_emergency_exit: 'Leaves the seat immediately (even in flight)',
  v_power_set_off: 'Powers the whole ship off',
  v_power_toggle: 'Can power the whole ship off',
};
/** Fail-safe: anything that looks like these is dangerous even if a patch renames it. */
const DANGEROUS_RE = /self_?destruct|eject|emergency_exit|^v_power_(set_off|toggle)$|power_(all_)?off/i;

export function dangerInfo(name: string): { dangerous: boolean; reason?: string } {
  if (DANGEROUS[name]) return { dangerous: true, reason: DANGEROUS[name] };
  if (DANGEROUS_RE.test(name)) return { dangerous: true, reason: 'Potentially destructive action' };
  return { dangerous: false };
}

const DOORS_RE = /door|port(s)?$|portlock|landing_system|docking|atc_request/;

export function groupFor(name: string, category: string): ControlGroup {
  if (dangerInfo(name).dangerous && !/^v_power_/.test(name)) return 'emergency';
  const c = (category || '').toLowerCase();
  if (c.includes('emote') || name.startsWith('emote_')) return 'emotes';
  if (c.includes('power') || name.startsWith('v_power_')) return 'power';
  if (DOORS_RE.test(name) || c.includes('docking')) return 'doors';
  if (c.includes('radar') || c.includes('target') || c.includes('weapon') || c.includes('turret') || c.includes('missile')) return 'combat';
  if (c === 'seat_general') return /light_amplification/.test(name) ? 'utility' : 'combat';
  if (c.includes('light') || c === 'player' || c.includes('mobiglas')) return 'utility';
  if (c.includes('movement') || c.includes('quantum') || c.includes('flight') || c === 'spaceship_general') return 'flight';
  return 'utility';
}

const LABELS: Record<string, string> = {
  v_lights: 'Lights',
  v_lights_on: 'Lights on',
  v_lights_off: 'Lights off',
  mobiglas: 'mobiGlas',
  v_starmap: 'Star map',
  v_flightready: 'Flight ready',
  v_master_mode_cycle: 'Cycle master mode',
  v_master_mode_set_nav: 'NAV mode',
  v_master_mode_set_scm: 'SCM mode',
  v_toggle_qdrive_engagement: 'Quantum drive',
  v_toggle_landing_system: 'Landing gear',
  v_deploy_landing_system: 'Gear down',
  v_retract_landing_system: 'Gear up',
  v_atc_request: 'Request landing (ATC)',
  v_toggle_docking_request: 'Request docking',
  v_ifcs_toggle_gforce_safety: 'G-safe',
  v_ifcs_gsafe_on: 'G-safe on',
  v_ifcs_gsafe_off: 'G-safe off',
  v_ifcs_toggle_esp: 'ESP',
  v_ifcs_reset_gmeter_max: 'Reset G-meter',
  v_ifcs_vector_decoupling_toggle: 'Decoupled',
  v_ifcs_vector_decoupling_on: 'Decoupled on',
  v_ifcs_vector_decoupling_off: 'Decoupled off',
  v_vtol_toggle: 'VTOL',
  v_invoke_ping: 'Radar ping',
  v_target_hail: 'Hail target',
  v_self_destruct: 'Self-destruct',
  v_eject: 'Eject',
  v_emergency_exit: 'Emergency exit',
  v_power_toggle: 'Ship power',
  v_power_set_on: 'Power on',
  v_power_set_off: 'Power off',
  v_power_toggle_shields: 'Shields power',
  v_power_toggle_thrusters: 'Thrusters power',
  v_power_toggle_weapons: 'Weapons power',
  v_light_amplification_toggle: 'Night vision',
  v_light_amplification_on: 'Night vision on',
  v_light_amplification_off: 'Night vision off',
  toggle_flashlight: 'Flashlight',
};

const WORDS: Record<string, string> = { ifcs: 'IFCS', hud: 'HUD', qdrive: 'QD', scm: 'SCM', nav: 'NAV', atc: 'ATC', vtol: 'VTOL', esp: 'ESP' };

export function labelFor(name: string): string {
  if (LABELS[name]) return LABELS[name];
  const parts = name.replace(/^v_/, '').replace(/^emote_/, '').replace(/^ifcs_/, '').split('_').filter(Boolean);
  const s = parts.map((p) => WORDS[p] ?? p).join(' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function classifyAction(a: { name: string; category?: string; holdable?: boolean }): ControlAction {
  const d = dangerInfo(a.name);
  return {
    name: a.name,
    category: a.category ?? '',
    holdable: !!a.holdable,
    group: groupFor(a.name, a.category ?? ''),
    label: labelFor(a.name),
    dangerous: d.dangerous,
    dangerReason: d.reason,
  };
}

/** Action names the game accepts are short snake_case identifiers. */
export const ACTION_NAME_RE = /^[A-Za-z0-9_]{1,64}$/;
