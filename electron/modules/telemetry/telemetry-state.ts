/**
 * Star Citizen telemetry state + derived events.
 *
 * Pure module (no Electron / gRPC imports) so it can be unit-tested with plain Node.
 *
 * How the game's TelemetryStream behaves (sc.game.telemetry.v1, 5.0 PTU):
 *  - ~17 frames/s, each frame holds only SOME top-level sections (actor, vehicle, weapons,
 *    events, force_feedback, turret).
 *  - A section that is absent from a frame means "no update", NOT "gone": we keep the last value
 *    and only treat it as gone once it is older than `staleMs`.
 *  - Inside a present section, an absent field means its proto3 default (0 / false / ''),
 *    because zero values are never sent on the wire.
 *  - `events` carries GameEvent{type} entries. In 5.0 PTU death/respawn are in the schema but are
 *    not emitted, so we also derive our own events from state changes.
 */

export type Obj = Record<string, any>;

export type TelemetrySectionName = 'actor' | 'vehicle' | 'weapons' | 'events' | 'force_feedback' | 'turret' | string;

export type SectionEntry = { value: Obj; at: number };

export type TelemetryEventSeverity = 'info' | 'warn' | 'alert';

export type TelemetryEvent = {
  id: string;
  /** e.g. `actor_spawn`, `vehicle_entered`, `landing_gear`, `low_oxygen`. */
  type: string;
  /** ISO timestamp */
  at: string;
  source: 'telemetry';
  severity: TelemetryEventSeverity;
  /** One-line human summary for overlay / feed. */
  summary: string;
  data?: Obj;
};

/** Sections that are never sent to the server (high-rate, no value off-machine). */
const LOCAL_ONLY_SECTIONS = new Set(['force_feedback', 'events']);

export const obj = (x: unknown): Obj => (x && typeof x === 'object' ? (x as Obj) : {});
export const num = (x: unknown): number => {
  if (typeof x === 'number' && Number.isFinite(x)) return x;
  if (typeof x === 'string' && x.trim() !== '' && Number.isFinite(Number(x))) return Number(x);
  return 0;
};
const str = (x: unknown): string => (typeof x === 'string' ? x : '');
const bool = (x: unknown): boolean => x === true;

function pct(gauge: unknown): number | null {
  const g = obj(gauge);
  const max = num(g.max);
  if (max <= 0) return null;
  return Math.max(0, Math.min(100, (num(g.current) / max) * 100));
}

/** Strip `PREFIX_` from enum strings: ACTOR_LOCOMOTION_STATE_ON_FOOT → ON_FOOT. */
export function enumShort(value: unknown, prefix: string): string {
  const s = str(value);
  if (!s) return 'UNSPECIFIED';
  return s.startsWith(prefix) ? s.slice(prefix.length) : s;
}

/** The facts we diff between frames to derive events. */
type Facts = {
  hasActor: boolean;
  locomotion: string;
  crewRole: string;
  seat: string;
  health: number | null;
  oxygen: number | null;
  breathable: boolean;
  balance: string;
  hasVehicle: boolean;
  vehicleName: string;
  vehicleClass: string;
  vehicleHealth: number;
  masterMode: string;
  gear: string;
  landed: boolean;
  lights: boolean;
  doorOpen: string;
  doorLock: string;
  shields: number;
  power: Record<string, boolean>;
  majorAnnunciators: string[];
  presetName: string;
  countermeasures: Record<string, number>;
};

export class TelemetryState {
  readonly staleMs: number;
  #sections = new Map<string, SectionEntry>();
  #facts: Facts | null = null;
  #seq = 0;
  frames = 0;
  firstFrameAt = 0;
  lastFrameAt = 0;
  /** Count of frames per section name. */
  sectionFrames: Record<string, number> = {};

  constructor(opts: { staleMs?: number } = {}) {
    this.staleMs = opts.staleMs ?? 3000;
  }

  reset(): void {
    this.#sections.clear();
    this.#facts = null;
    this.frames = 0;
    this.firstFrameAt = 0;
    this.lastFrameAt = 0;
    this.sectionFrames = {};
  }

  /** Latest value of a section if fresh, else undefined. */
  section(name: TelemetrySectionName, now = Date.now()): Obj | undefined {
    const s = this.#sections.get(name);
    if (!s || now - s.at >= this.staleMs) return undefined;
    return s.value;
  }

  /** All sections with their age, including stale ones (for the debug overlay). */
  sections(now = Date.now()): Array<{ name: string; value: Obj; ageMs: number; stale: boolean }> {
    return [...this.#sections.entries()].map(([name, s]) => ({
      name,
      value: s.value,
      ageMs: now - s.at,
      stale: now - s.at >= this.staleMs,
    }));
  }

  /** Frames per second over the whole stream lifetime (0 before 2 frames). */
  fps(): number {
    if (this.frames < 2 || this.lastFrameAt <= this.firstFrameAt) return 0;
    return ((this.frames - 1) * 1000) / (this.lastFrameAt - this.firstFrameAt);
  }

  /**
   * Apply a decoded frame (snake_case, enums as strings, int64 as strings, no defaults).
   * Returns the events derived from this frame (game events + state transitions).
   */
  applyFrame(frame: Obj, now = Date.now()): TelemetryEvent[] {
    this.frames++;
    if (!this.firstFrameAt) this.firstFrameAt = now;
    this.lastFrameAt = now;
    const events: TelemetryEvent[] = [];
    for (const [name, value] of Object.entries(frame ?? {})) {
      if (!value || typeof value !== 'object') continue;
      this.#sections.set(name, { value: value as Obj, at: now });
      this.sectionFrames[name] = (this.sectionFrames[name] ?? 0) + 1;
    }
    // Native game events
    const gameEvents: unknown[] = Array.isArray(obj(frame?.events).events) ? obj(frame.events).events : [];
    for (const ge of gameEvents) {
      const type = enumShort(obj(ge).type, 'GAME_EVENT_TYPE_');
      events.push(this.#event(`game_${type.toLowerCase()}`, now, GAME_EVENT_SEVERITY[type] ?? 'info', `Game event: ${type.replace(/_/g, ' ').toLowerCase()}`, { gameEventType: type }));
    }
    events.push(...this.#diff(now));
    return events;
  }

  /** Re-evaluate staleness without a frame (e.g. game closed): returns events like vehicle_exited. */
  tick(now = Date.now()): TelemetryEvent[] {
    return this.#diff(now);
  }

  /**
   * The snapshot we share with VOIDLOG.GG: fresh sections only, no force-feedback / raw events,
   * and the aUEC balance removed unless `includeBalance`.
   */
  buildSharedSnapshot(opts: { includeBalance?: boolean } = {}, now = Date.now()): Obj {
    const out: Obj = {};
    for (const [name, s] of this.#sections) {
      if (LOCAL_ONLY_SECTIONS.has(name)) continue;
      if (now - s.at >= this.staleMs) continue;
      out[name] = s.value;
    }
    if (out.actor && !opts.includeBalance) {
      const actor = { ...out.actor, state: { ...obj(out.actor.state) } };
      delete actor.state.uec_balance;
      out.actor = actor;
    }
    return out;
  }

  // --- internals -------------------------------------------------------

  #event(type: string, now: number, severity: TelemetryEventSeverity, summary: string, data?: Obj): TelemetryEvent {
    this.#seq++;
    return { id: `tm-${now}-${this.#seq}`, type, at: new Date(now).toISOString(), source: 'telemetry', severity, summary, data };
  }

  #readFacts(now: number): Facts {
    const actor = this.section('actor', now);
    const vehicleFrame = this.section('vehicle', now);
    const weapons = this.section('weapons', now);
    const vitals = obj(actor?.vitals);
    const astate = obj(actor?.state);
    const env = obj(actor?.environment);
    const vstate = obj(vehicleFrame?.state);
    const hasVehicle = !!vehicleFrame && !!(str(vstate.name) || str(vstate.class_name));
    const flight = obj(vstate.flight);
    const power = obj(vstate.power);
    const ann = obj(vstate.annunciators);
    const countermeasures: Record<string, number> = {};
    for (const c of Array.isArray(weapons?.countermeasures) ? weapons!.countermeasures : []) {
      countermeasures[enumShort(obj(c).type, 'COUNTERMEASURE_TYPE_')] = num(obj(c).amount);
    }
    return {
      hasActor: !!actor,
      locomotion: actor ? enumShort(astate.locomotion, 'ACTOR_LOCOMOTION_STATE_') : 'NONE',
      crewRole: actor ? enumShort(astate.crew_role, 'ACTOR_CREW_ROLE_') : 'NONE',
      seat: str(astate.seat_name),
      health: actor ? pct(vitals.health) : null,
      oxygen: actor ? pct(vitals.oxygen) : null,
      breathable: bool(env.breathable_atmosphere),
      balance: astate.uec_balance != null ? String(astate.uec_balance) : '0',
      hasVehicle,
      vehicleName: str(vstate.name),
      vehicleClass: str(vstate.class_name),
      vehicleHealth: num(vstate.health),
      masterMode: hasVehicle ? enumShort(obj(vstate.master_mode).mode, 'VEHICLE_MASTER_MODE_') : 'NONE',
      gear: hasVehicle ? enumShort(obj(flight.state).gear, 'VEHICLE_COMPONENT_DEPLOYMENT_STATE_') : 'NONE',
      landed: bool(obj(flight.state).is_landed),
      lights: bool(vstate.lights_enabled),
      doorOpen: hasVehicle ? enumShort(obj(vstate.doors).open_state, 'DOOR_OPEN_STATE_') : 'NONE',
      doorLock: hasVehicle ? enumShort(obj(vstate.doors).lock_state, 'DOOR_LOCK_STATE_') : 'NONE',
      shields: num(obj(vstate.shields).level),
      power: Object.fromEntries(POWER_KEYS.map((k) => [k, bool(power[k])])),
      majorAnnunciators: Object.entries(ann)
        .filter(([, v]) => /MAJOR/.test(String(v)))
        .map(([k]) => k)
        .sort(),
      presetName: weapons ? str(weapons.preset_name) : '',
      countermeasures,
    };
  }

  #diff(now: number): TelemetryEvent[] {
    const cur = this.#readFacts(now);
    const prev = this.#facts;
    this.#facts = cur;
    if (!prev) return [];
    const ev: TelemetryEvent[] = [];
    const push = (type: string, severity: TelemetryEventSeverity, summary: string, data?: Obj) => ev.push(this.#event(type, now, severity, summary, data));

    // Actor presence
    if (!prev.hasActor && cur.hasActor) push('actor_telemetry_started', 'info', 'Character telemetry started (spawned)');
    if (prev.hasActor && !cur.hasActor) push('actor_telemetry_lost', 'warn', 'Character telemetry lost (despawned / game closed)');

    if (cur.hasActor && prev.hasActor) {
      if (cur.locomotion !== prev.locomotion) push('locomotion_changed', 'info', `Locomotion ${prev.locomotion} → ${cur.locomotion}`, { from: prev.locomotion, to: cur.locomotion });
      if (cur.crewRole !== prev.crewRole) push('crew_role_changed', 'info', `Crew role ${prev.crewRole} → ${cur.crewRole}`, { from: prev.crewRole, to: cur.crewRole, seat: cur.seat });
      if (cur.seat !== prev.seat && cur.seat) push('seat_changed', 'info', `Seat: ${cur.seat}`, { seat: cur.seat });
      crossing(prev.health, cur.health, 25, () => push('low_health', 'alert', `Health low (${Math.round(cur.health!)}%)`, { health: cur.health }));
      crossing(prev.oxygen, cur.oxygen, 25, () => push('low_oxygen', 'alert', `Oxygen low (${Math.round(cur.oxygen!)}%)`, { oxygen: cur.oxygen }));
      if (prev.health !== null && cur.health !== null && prev.health > 0 && cur.health <= 0) push('health_zero', 'alert', 'Health reached 0');
      if (cur.breathable !== prev.breathable) push('atmosphere_changed', 'info', cur.breathable ? 'Breathable atmosphere' : 'Non-breathable atmosphere', { breathable: cur.breathable });
      if (cur.balance !== prev.balance) {
        const delta = num(cur.balance) - num(prev.balance);
        push('balance_changed', 'info', `aUEC ${delta >= 0 ? '+' : ''}${delta.toLocaleString('en-US')}`, { delta, localOnly: true });
      }
    }

    // Vehicle
    if (!prev.hasVehicle && cur.hasVehicle) push('vehicle_entered', 'info', `Entered ${cur.vehicleName || cur.vehicleClass}`, { name: cur.vehicleName, className: cur.vehicleClass });
    if (prev.hasVehicle && !cur.hasVehicle) push('vehicle_exited', 'info', `Left ${prev.vehicleName || prev.vehicleClass}`, { name: prev.vehicleName, className: prev.vehicleClass });
    if (prev.hasVehicle && cur.hasVehicle && prev.vehicleClass !== cur.vehicleClass) push('vehicle_entered', 'info', `Switched to ${cur.vehicleName || cur.vehicleClass}`, { name: cur.vehicleName, className: cur.vehicleClass });

    if (prev.hasVehicle && cur.hasVehicle && prev.vehicleClass === cur.vehicleClass) {
      if (cur.masterMode !== prev.masterMode) push('master_mode_changed', 'info', `Master mode ${cur.masterMode}`, { from: prev.masterMode, to: cur.masterMode });
      if (cur.gear !== prev.gear && (cur.gear === 'DEPLOYED' || cur.gear === 'RETRACTED')) push('landing_gear', 'info', `Landing gear ${cur.gear.toLowerCase()}`, { state: cur.gear });
      if (cur.landed !== prev.landed) push(cur.landed ? 'landed' : 'took_off', 'info', cur.landed ? 'Landed' : 'Took off');
      if (cur.lights !== prev.lights) push('lights_toggled', 'info', `Lights ${cur.lights ? 'on' : 'off'}`, { on: cur.lights });
      if (cur.doorOpen !== prev.doorOpen && cur.doorOpen !== 'UNSPECIFIED') push('doors_changed', 'info', `Doors ${cur.doorOpen.toLowerCase()}`, { state: cur.doorOpen });
      if (cur.doorLock !== prev.doorLock && cur.doorLock !== 'UNSPECIFIED') push('doors_lock_changed', 'info', `Doors ${cur.doorLock.toLowerCase()}`, { state: cur.doorLock });
      if (prev.shields > 0 && cur.shields <= 0) push('shields_down', 'alert', 'Shields down');
      if (prev.shields <= 0 && cur.shields > 0) push('shields_up', 'info', 'Shields up');
      if (prev.vehicleHealth > 0 && cur.vehicleHealth < prev.vehicleHealth) {
        // `health` scale isn't documented (0-1 or 0-100); report relative drops ≥ 5 %.
        const dropPct = ((prev.vehicleHealth - cur.vehicleHealth) / prev.vehicleHealth) * 100;
        if (dropPct >= 5) push('vehicle_damaged', 'warn', `Hull -${dropPct.toFixed(0)}%`, { from: prev.vehicleHealth, to: cur.vehicleHealth });
      }
      const powerChanged = POWER_KEYS.filter((k) => prev.power[k] !== cur.power[k]);
      if (powerChanged.length) push('power_changed', 'info', `Power: ${powerChanged.map((k) => `${k.replace(/_/g, ' ')} ${cur.power[k] ? 'on' : 'off'}`).join(', ')}`, { changed: Object.fromEntries(powerChanged.map((k) => [k, cur.power[k]])) });
      const newMajors = cur.majorAnnunciators.filter((a) => !prev.majorAnnunciators.includes(a));
      if (newMajors.length) push('annunciator_warning', 'warn', `Warning light: ${newMajors.join(', ').toUpperCase()}`, { annunciators: newMajors });
    }

    // Weapons
    if (cur.presetName && prev.presetName && cur.presetName !== prev.presetName) push('weapon_preset_changed', 'info', `Weapon preset ${cur.presetName}`, { preset: cur.presetName });
    for (const [type, amount] of Object.entries(cur.countermeasures)) {
      const before = prev.countermeasures[type];
      if (before !== undefined && amount < before) push('countermeasure_used', 'info', `${type.toLowerCase()} countermeasure ×${before - amount} (${amount} left)`, { type, used: before - amount, left: amount });
    }
    return ev;
  }
}

const POWER_KEYS = ['powerplants', 'engines', 'weapons', 'coolers', 'life_support', 'gravity_generators', 'sensors', 'shield_generators', 'shield_emitters'];

const GAME_EVENT_SEVERITY: Record<string, TelemetryEventSeverity> = {
  ACTOR_DEAD: 'alert',
  ACTOR_DOWNED: 'alert',
};

/** Calls `fire` when a percentage drops from ≥ threshold to < threshold. */
function crossing(prev: number | null, cur: number | null, threshold: number, fire: () => void): void {
  if (prev === null || cur === null) return;
  if (prev >= threshold && cur < threshold) fire();
}

/** Flatten a nested object to `a.b.c: value` rows (for the debug overlay). */
export function flatten(value: unknown, prefix = '', out: Array<[string, string]> = [], maxRows = 400): Array<[string, string]> {
  if (out.length >= maxRows) return out;
  if (Array.isArray(value)) {
    if (value.length === 0) out.push([prefix, '[]']);
    value.forEach((v, i) => flatten(v, `${prefix}[${i}]`, out, maxRows));
  } else if (value && typeof value === 'object') {
    const entries = Object.entries(value);
    if (entries.length === 0) out.push([prefix, '{}']);
    for (const [k, v] of entries) flatten(v, prefix ? `${prefix}.${k}` : k, out, maxRows);
  } else {
    out.push([prefix, typeof value === 'number' ? (Number.isInteger(value) ? String(value) : value.toFixed(2)) : String(value)]);
  }
  return out;
}
