/**
 * SAMPLE ListTriggerableActions response for tests and the UI preview ONLY.
 *
 * At runtime the client always uses the list the game returns (ListTriggerableActions, refreshed on
 * every session start); nothing here is shipped or used as a source of truth. Written by us from
 * the action-name conventions the game uses (`v_*` vehicle actions, `emote_*`), covering every UI
 * group, the dangerous set and one holdable action. Not a copy of any third-party capture.
 */
export type SampleAction = { action_name: string; category: string; holdable?: boolean };

const cat = (category: string, names: string[], holdable = false): SampleAction[] =>
  names.map((action_name) => ({ action_name, category, ...(holdable ? { holdable: true } : {}) }));

export const SAMPLE_ACTIONS: SampleAction[] = [
  ...cat('lights_controller', ['v_lights', 'v_lights_on', 'v_lights_off']),
  ...cat('player', ['mobiglas', 'toggle_flashlight', 'v_starmap', 'visor_wipe']),
  ...cat('player_emotes', ['emote_wave', 'emote_salute', 'emote_point', 'emote_cheer', 'emote_clap', 'emote_dance']),
  ...cat('seat_general', [
    'v_eject',
    'v_emergency_exit',
    'v_light_amplification_toggle',
    'v_set_flight_mode',
    'v_set_guns_mode',
    'v_set_mining_mode',
    'v_set_scan_mode',
    'v_enter_remote_turret_1',
  ]),
  ...cat('spaceship_docking', ['v_toggle_docking_request']),
  ...cat('spaceship_general', ['v_flightready', 'v_self_destruct', 'v_open_all_doors', 'v_close_all_doors', 'v_lock_all_doors', 'v_unlock_all_doors']),
  ...cat('spaceship_movement', [
    'v_atc_request',
    'v_toggle_landing_system',
    'v_deploy_landing_system',
    'v_retract_landing_system',
    'v_master_mode_set_nav',
    'v_master_mode_set_scm',
    'v_ifcs_toggle_esp',
    'v_ifcs_vector_decoupling_toggle',
    'v_vtol_toggle',
    'v_flight_advanced_hud_toggle',
  ]),
  ...cat('spaceship_power', [
    'v_power_toggle',
    'v_power_set_on',
    'v_power_set_off',
    'v_power_toggle_shields',
    'v_power_toggle_thrusters',
    'v_power_toggle_weapons',
    'v_power_set_shields_off',
  ]),
  ...cat('spaceship_quantum', ['v_toggle_qdrive_engagement']),
  ...cat('spaceship_radar', ['v_invoke_ping'], true),
  ...cat('spaceship_target_hailing', ['v_target_hail']),
];
