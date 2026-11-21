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
 *  - `events` carries GameEvent{type} entries (ACTOR_SPAWN / DEAD / DOWNED / RESPAWN / ENTER_SEAT /
 *    LEAVE_SEAT). The game repeats some of them several times within ~0.5 s (LEAVE_SEAT up to 9x),
 *    so identical game events are collapsed.
 *
 * Real-data quirks handled here (PTU 5.0.202 recordings):
 *  - `actor.vitals.health.current` disappears (= proto default) while downed: an absent gauge value
 *    is treated as "unknown", never as 0 % (no bogus "Health low (0%)").
 *  - Switching to NAV master mode powers the shield generators off ~1 s later and the shields drain
 *    to 0 within ~6-10 s: `shields_down` carries `context.cause` (nav_mode / power_off / damage /
 *    unknown) and only damage / unknown are alerts worth a feed entry.
 *  - The vehicle section goes stale ~3 s after leaving the seat; `vehicle_exited` is dated at the
 *    game's ACTOR_LEAVE_SEAT when there was one.
 *  - The schema has no quantum drive state (only quantum_fuel, never sent). `annunciators.qdrv` goes
 *    OFF → NOMINAL when the drive is ready (NAV mode) and briefly MAJOR_ON on a drive warning; it does
 *    not show spooling or the jump itself (quantum trips come from Game.log, see log-feed.ts).
 *  - hunger / thirst drain by ~0.01 per second; heart_rate jitters every frame (see the upload
 *    throttle in telemetry-service.ts).
 */

export type Obj = Record<string, any>;

export type TelemetrySectionName = 'actor' | 'vehicle' | 'weapons' | 'events' | 'force_feedback' | 'turret' | string;

export type SectionEntry = { value: Obj; at: number };

export type TelemetryEventSeverity = 'info' | 'warn' | 'alert';

export type TelemetryEventCategory = 'combat' | 'ship' | 'travel' | 'vitals' | 'status';

export type TelemetryVehicleRef = { name: string; className: string; entityId?: string };

export type TelemetryEvent = {
  /** Stable and unique: `tm_<clientId>_<type>_<epochMs>` (a `_<n>` suffix only if that repeats). */
  id: string;
  /** e.g. `player_downed`, `vehicle_entered`, `landing_gear`, `low_oxygen`. */
  type: string;
  /** ISO timestamp */
  at: string;
  source: 'telemetry';
  severity: TelemetryEventSeverity;
  /** One-line human summary for overlay / feed. */
  summary: string;
  data?: Obj;
  /** Worth persisting to the VOIDLOG.GG event feed (curated, low-noise). Absent = live-only. */
  feed?: boolean;
  category?: TelemetryEventCategory;
  /** Why it happened, e.g. shields_down `{ cause: 'nav_mode' }`. */
  context?: { cause?: string; [k: string]: unknown };
  /** Ship the player was in. */
  vehicle?: TelemetryVehicleRef;
};

type EventExtra = Pick<TelemetryEvent, 'feed' | 'category' | 'context' | 'vehicle'>;

/** Event types that may go to the feed (the server enforces the same allowlist). */
export const FEED_EVENT_TYPES = new Set([
  'player_downed',
  'player_dead',
  'player_respawn',
  'vehicle_entered',
  'vehicle_exited',
  'took_off',
  'landed',
  'shields_down',
  'vehicle_damaged',
  'low_oxygen',
  // 0.3.3 (Game.log derived, see log-feed.ts)
  'qt_arrived',
  'ship_retrieved',
  'healed_at_medical_bed',
]);

const CATEGORY: Record<string, TelemetryEventCategory> = {
  player_downed: 'combat',
  player_dead: 'combat',
  vehicle_damaged: 'combat',
  countermeasure_used: 'combat',
  weapon_preset_changed: 'combat',
  vehicle_entered: 'ship',
  vehicle_exited: 'ship',
  landing_gear: 'ship',
  master_mode_changed: 'ship',
  lights_toggled: 'ship',
  doors_changed: 'ship',
  doors_lock_changed: 'ship',
  shields_up: 'ship',
  shields_down: 'ship',
  power_changed: 'ship',
  annunciator_warning: 'ship',
  took_off: 'travel',
  landed: 'travel',
  low_health: 'vitals',
  low_oxygen: 'vitals',
  atmosphere_changed: 'vitals',
  low_hunger: 'vitals',
  low_thirst: 'vitals',
  healed_at_medical_bed: 'vitals',
  low_fuel: 'ship',
  quantum_drive_ready: 'travel',
  quantum_drive_warning: 'travel',
  atmosphere_entered: 'travel',
  atmosphere_exited: 'travel',
  qt_route_planned: 'travel',
  qt_obstructed: 'travel',
  qt_arrived: 'travel',
  ship_retrieved: 'ship',
  hangar_queued: 'ship',
  location_changed: 'status',
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

/**
 * Gauge percentage, or null when unknown. An absent `current` is NOT read as 0: the game drops the
 * value entirely in some states (health while downed), which is indistinguishable from a real 0.
 */
function pct(gauge: unknown): number | null {
  const g = obj(gauge);
  const max = num(g.max);
  if (max <= 0 || g.current === undefined || g.current === null) return null;
  return Math.max(0, Math.min(100, (num(g.current) / max) * 100));
}

/** Strip `PREFIX_` from enum strings: ACTOR_LOCOMOTION_STATE_ON_FOOT → ON_FOOT. */
export function enumShort(value: unknown, prefix: string): string {
  const s = str(value);
  if (!s) return 'UNSPECIFIED';
  return s.startsWith(prefix) ? s.slice(prefix.length) : s;
}

/** RSI_Galaxy_877609015558 → { name, className: RSI_Galaxy, entityId: 877609015558 } */
export function vehicleRef(name: string, className: string): TelemetryVehicleRef | undefined {
  if (!name && !className) return undefined;
  const m = name.match(/_(\d{6,})$/);
  return { name: name || className, className: className || (m ? name.slice(0, -m[0].length) : name), ...(m ? { entityId: m[1] } : {}) };
}

const vehicleLabel = (name: string, className: string) => (className || name).replace(/_/g, ' ');

/** The facts we diff between frames to derive events. */
type Facts = {
  hasActor: boolean;
  locomotion: string;
  crewRole: string;
  seat: string;
  health: number | null;
  oxygen: number | null;
  hunger: number | null;
  thirst: number | null;
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
  /** 0..1, null when not reported */
  hydrogenFuel: number | null;
  atmosphereDensity: number;
  qdrv: string;
  power: Record<string, boolean>;
  majorAnnunciators: string[];
  presetName: string;
  countermeasures: Record<string, number>;
};

export type TelemetryStateOptions = {
  staleMs?: number;
  /** Client id used in event ids (`tm_<clientId>_<type>_<ms>`). */
  clientId?: () => string;
  /** Identical game events closer than this are one event (default 1000 ms). */
  gameEventDedupeMs?: number;
  /** took_off / landed are reported once the new state held this long (default 1500 ms). */
  landedSettleMs?: number;
};

export class TelemetryState {
  readonly staleMs: number;
  #sections = new Map<string, SectionEntry>();
  #facts: Facts | null = null;
  #clientId: () => string;
  #dedupeMs: number;
  #settleMs: number;
  #lastIdAt = new Map<string, number>();
  #idRepeat = 0;
  #lastGameEventAt = new Map<string, number>();
  #lastLeaveSeatAt = 0;
  #lastDamageAt = 0;
  #downedAt = 0;
  #lastHealth: number | null = null;
  #shieldPowerSeen = false;
  #landedReported: boolean | null = null;
  #landedPending: { value: boolean; since: number } | null = null;
  /** Low-level alerts fire once, then re-arm only after recovering above the re-arm level. */
  #lowArmed: Record<string, boolean> = {};
  frames = 0;
  firstFrameAt = 0;
  lastFrameAt = 0;
  /** Count of frames per section name. */
  sectionFrames: Record<string, number> = {};

  constructor(opts: TelemetryStateOptions = {}) {
    this.staleMs = opts.staleMs ?? 3000;
    this.#clientId = opts.clientId ?? (() => 'local');
    this.#dedupeMs = opts.gameEventDedupeMs ?? 1000;
    this.#settleMs = opts.landedSettleMs ?? 1500;
  }

  reset(): void {
    this.#sections.clear();
    this.#facts = null;
    this.#lastGameEventAt.clear();
    this.#lastLeaveSeatAt = this.#lastDamageAt = this.#downedAt = 0;
    this.#lastHealth = null;
    this.#shieldPowerSeen = false;
    this.#landedReported = null;
    this.#landedPending = null;
    this.#lowArmed = {};
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
    // Native game events (vehicle/health context comes from the facts of the previous frame)
    const gameEvents: unknown[] = Array.isArray(obj(frame?.events).events) ? obj(frame.events).events : [];
    for (const ge of gameEvents) {
      const type = enumShort(obj(ge).type, 'GAME_EVENT_TYPE_');
      const last = this.#lastGameEventAt.get(type);
      this.#lastGameEventAt.set(type, now); // sliding window: a burst collapses into its first event
      if (last !== undefined && now - last < this.#dedupeMs) continue;
      const e = this.#gameEvent(type, now);
      if (e) events.push(e);
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

  /**
   * Build an event that did not come from a telemetry frame (Game.log via log-feed.ts) with the same
   * id scheme and enrichment as derived events.
   */
  externalEvent(
    type: string,
    at: number,
    severity: TelemetryEventSeverity,
    summary: string,
    extra: EventExtra = {},
    data?: Obj,
  ): TelemetryEvent {
    return this.#event(type, at, severity, summary, data, extra);
  }

  // --- internals -------------------------------------------------------

  #id(type: string, at: number): string {
    const base = `tm_${this.#clientId() || 'local'}_${type}_${at}`;
    // Two events of one type in the same millisecond (or one re-dated into the past) stay unique.
    const key = `${type}@${at}`;
    if (this.#lastIdAt.has(key)) return `${base}_${++this.#idRepeat}`;
    this.#lastIdAt.set(key, at);
    if (this.#lastIdAt.size > 200) this.#lastIdAt.delete(this.#lastIdAt.keys().next().value as string);
    return base;
  }

  #event(
    type: string,
    at: number,
    severity: TelemetryEventSeverity,
    summary: string,
    data?: Obj,
    extra: EventExtra = {},
  ): TelemetryEvent {
    const e: TelemetryEvent = { id: this.#id(type, at), type, at: new Date(at).toISOString(), source: 'telemetry', severity, summary };
    if (data) e.data = data;
    const category = extra.category ?? CATEGORY[type] ?? 'status';
    e.category = category;
    const feed = extra.feed ?? FEED_EVENT_TYPES.has(type);
    if (feed) e.feed = true;
    if (extra.context) e.context = extra.context;
    if (extra.vehicle) e.vehicle = extra.vehicle;
    return e;
  }

  #currentVehicle(): TelemetryVehicleRef | undefined {
    const f = this.#facts;
    return f?.hasVehicle ? vehicleRef(f.vehicleName, f.vehicleClass) : undefined;
  }

  #gameEvent(type: string, now: number): TelemetryEvent | null {
    const vehicle = this.#currentVehicle();
    const where = vehicle ? ` in ${vehicleLabel(vehicle.name, vehicle.className)}` : '';
    const lastHealth = this.#lastHealth !== null ? Math.round(this.#lastHealth) : undefined;
    switch (type) {
      case 'ACTOR_DOWNED':
        this.#downedAt = now;
        return this.#event('player_downed', now, 'alert', `Downed${where}`, { gameEventType: type }, {
          vehicle,
          context: { ...(lastHealth !== undefined ? { lastHealth } : {}), inVehicle: !!vehicle },
        });
      case 'ACTOR_DEAD': {
        const downedAt = this.#downedAt && now - this.#downedAt < 10 * 60_000 ? new Date(this.#downedAt).toISOString() : undefined;
        this.#downedAt = 0;
        return this.#event('player_dead', now, 'alert', `Died${where}`, { gameEventType: type }, {
          vehicle,
          context: { ...(downedAt ? { downedAt } : {}), ...(lastHealth !== undefined && !downedAt ? { lastHealth } : {}), inVehicle: !!vehicle },
        });
      }
      case 'ACTOR_RESPAWN':
        this.#downedAt = 0;
        return this.#event('player_respawn', now, 'info', 'Respawned', { gameEventType: type }, { category: 'status' });
      case 'ACTOR_LEAVE_SEAT':
        this.#lastLeaveSeatAt = now;
        break;
    }
    return this.#event(`game_${type.toLowerCase()}`, now, 'info', `Game event: ${type.replace(/_/g, ' ').toLowerCase()}`, { gameEventType: type }, { vehicle });
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
      hunger: actor ? pct(vitals.hunger) : null,
      thirst: actor ? pct(vitals.thirst) : null,
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
      hydrogenFuel: hasVehicle && obj(flight.instruments).hydrogen_fuel !== undefined ? num(obj(flight.instruments).hydrogen_fuel) : null,
      atmosphereDensity: hasVehicle ? num(obj(flight.instruments).atmospheric_density) : 0,
      qdrv: hasVehicle ? enumShort(ann.qdrv, 'ANNUNCIATOR_STATE_') : 'NONE',
      power: Object.fromEntries(POWER_KEYS.map((k) => [k, bool(power[k])])),
      majorAnnunciators: Object.entries(ann)
        .filter(([, v]) => /MAJOR/.test(String(v)))
        .map(([k]) => k)
        .sort(),
      presetName: weapons ? str(weapons.preset_name) : '',
      countermeasures,
    };
  }

  /** Why did the shields just reach 0? Checked in this order (NAV drops shield power by itself). */
  #shieldsDownCause(cur: Facts, now: number): 'nav_mode' | 'power_off' | 'damage' | 'unknown' {
    if (cur.masterMode === 'NAVIGATION') return 'nav_mode';
    if (this.#shieldPowerSeen && (!cur.power.shield_generators || !cur.power.shield_emitters)) return 'power_off';
    if (this.#lastDamageAt && now - this.#lastDamageAt <= 15_000) return 'damage';
    return 'unknown';
  }

  #diff(now: number): TelemetryEvent[] {
    const cur = this.#readFacts(now);
    const prev = this.#facts;
    this.#facts = cur;
    if (cur.health !== null) this.#lastHealth = cur.health;
    if (!prev) {
      if (cur.hasVehicle) this.#enterVehicle(cur);
      return [];
    }
    const ev: TelemetryEvent[] = [];
    const veh = cur.hasVehicle ? vehicleRef(cur.vehicleName, cur.vehicleClass) : undefined;
    const push = (type: string, severity: TelemetryEventSeverity, summary: string, data?: Obj, extra: EventExtra = {}, at = now) =>
      ev.push(this.#event(type, at, severity, summary, data, { vehicle: veh, ...extra }));

    // Actor presence
    if (!prev.hasActor && cur.hasActor) push('actor_telemetry_started', 'info', 'Character telemetry started (spawned)');
    if (prev.hasActor && !cur.hasActor) push('actor_telemetry_lost', 'warn', 'Character telemetry lost (despawned / game closed)');

    if (cur.hasActor && prev.hasActor) {
      if (cur.locomotion !== prev.locomotion) push('locomotion_changed', 'info', `Locomotion ${prev.locomotion} → ${cur.locomotion}`, { from: prev.locomotion, to: cur.locomotion });
      if (cur.crewRole !== prev.crewRole) push('crew_role_changed', 'info', `Crew role ${prev.crewRole} → ${cur.crewRole}`, { from: prev.crewRole, to: cur.crewRole, seat: cur.seat });
      if (cur.seat !== prev.seat && cur.seat) push('seat_changed', 'info', `Seat: ${cur.seat}`, { seat: cur.seat });
      // Only real readings count (an absent value is unknown, not 0 %).
      crossing(prev.health, cur.health, 25, () => push('low_health', 'alert', `Health low (${Math.round(cur.health!)}%)`, { health: cur.health }));
      crossing(prev.oxygen, cur.oxygen, 25, () => push('low_oxygen', 'alert', `Oxygen low (${Math.round(cur.oxygen!)}%)`, { oxygen: cur.oxygen }));
      this.#low('low_hunger', prev.hunger, cur.hunger, 25, 35, (v) => push('low_hunger', 'info', `Hungry (${Math.round(v)}%)`, { hunger: Math.round(v) }));
      this.#low('low_thirst', prev.thirst, cur.thirst, 25, 35, (v) => push('low_thirst', 'info', `Thirsty (${Math.round(v)}%)`, { thirst: Math.round(v) }));
      if (cur.breathable !== prev.breathable) push('atmosphere_changed', 'info', cur.breathable ? 'Breathable atmosphere' : 'Non-breathable atmosphere', { breathable: cur.breathable });
      if (cur.balance !== prev.balance) {
        const delta = num(cur.balance) - num(prev.balance);
        push('balance_changed', 'info', `aUEC ${delta >= 0 ? '+' : ''}${delta.toLocaleString('en-US')}`, { delta, localOnly: true });
      }
    }

    // Vehicle
    if (!prev.hasVehicle && cur.hasVehicle) {
      this.#enterVehicle(cur);
      push('vehicle_entered', 'info', `Entered ${vehicleLabel(cur.vehicleName, cur.vehicleClass)}`, { name: cur.vehicleName, className: cur.vehicleClass });
    }
    if (prev.hasVehicle && !cur.hasVehicle) {
      // The vehicle section only goes stale ~3 s after leaving the seat: date it at the game's LEAVE_SEAT.
      const left = this.#lastLeaveSeatAt && now - this.#lastLeaveSeatAt <= this.staleMs + 3000 ? this.#lastLeaveSeatAt : now;
      push('vehicle_exited', 'info', `Left ${vehicleLabel(prev.vehicleName, prev.vehicleClass)}`, { name: prev.vehicleName, className: prev.vehicleClass }, { vehicle: vehicleRef(prev.vehicleName, prev.vehicleClass) }, left);
      this.#landedReported = null;
      this.#landedPending = null;
    }
    if (prev.hasVehicle && cur.hasVehicle && prev.vehicleClass !== cur.vehicleClass) {
      this.#enterVehicle(cur);
      push('vehicle_entered', 'info', `Switched to ${vehicleLabel(cur.vehicleName, cur.vehicleClass)}`, { name: cur.vehicleName, className: cur.vehicleClass });
    }

    if (prev.hasVehicle && cur.hasVehicle && prev.vehicleClass === cur.vehicleClass) {
      if (cur.power.shield_generators && cur.power.shield_emitters) this.#shieldPowerSeen = true;
      if (cur.masterMode !== prev.masterMode) push('master_mode_changed', 'info', `Master mode ${cur.masterMode}`, { from: prev.masterMode, to: cur.masterMode });
      if (cur.gear !== prev.gear && (cur.gear === 'DEPLOYED' || cur.gear === 'RETRACTED')) push('landing_gear', 'info', `Landing gear ${cur.gear.toLowerCase()}`, { state: cur.gear });
      this.#landing(cur, prev, now, push);
      if (cur.lights !== prev.lights) push('lights_toggled', 'info', `Lights ${cur.lights ? 'on' : 'off'}`, { on: cur.lights });
      if (cur.doorOpen !== prev.doorOpen && cur.doorOpen !== 'UNSPECIFIED') push('doors_changed', 'info', `Doors ${cur.doorOpen.toLowerCase()}`, { state: cur.doorOpen });
      if (cur.doorLock !== prev.doorLock && cur.doorLock !== 'UNSPECIFIED') push('doors_lock_changed', 'info', `Doors ${cur.doorLock.toLowerCase()}`, { state: cur.doorLock });
      if (prev.vehicleHealth > 0 && cur.vehicleHealth < prev.vehicleHealth) {
        // `health` scale isn't documented (0-1 or 0-100); report relative drops ≥ 5 %.
        const dropPct = ((prev.vehicleHealth - cur.vehicleHealth) / prev.vehicleHealth) * 100;
        this.#lastDamageAt = now;
        if (dropPct >= 5) push('vehicle_damaged', 'warn', `Hull -${dropPct.toFixed(0)}%`, { from: prev.vehicleHealth, to: cur.vehicleHealth }, { context: { hullDropPct: Math.round(dropPct) } });
      }
      const newMajors = cur.majorAnnunciators.filter((a) => !prev.majorAnnunciators.includes(a) && a !== 'qdrv');
      if (newMajors.includes('hit')) this.#lastDamageAt = now;
      if (prev.shields > 0 && cur.shields <= 0) {
        const cause = this.#shieldsDownCause(cur, now);
        const harmless = cause === 'nav_mode' || cause === 'power_off';
        const summary =
          cause === 'nav_mode' ? 'Shields down (NAV mode)' : cause === 'power_off' ? 'Shields down (powered off)' : cause === 'damage' ? 'Shields down under fire' : 'Shields down';
        push('shields_down', harmless ? 'info' : 'alert', summary, undefined, {
          feed: !harmless,
          category: cause === 'damage' ? 'combat' : 'ship',
          context: { cause, masterMode: cur.masterMode },
        });
      }
      if (prev.shields <= 0 && cur.shields > 0) push('shields_up', 'info', 'Shields up');
      this.#low('low_fuel', prev.hydrogenFuel === null ? null : prev.hydrogenFuel * 100, cur.hydrogenFuel === null ? null : cur.hydrogenFuel * 100, 15, 25, (v) =>
        push('low_fuel', 'info', `Hydrogen fuel low (${Math.round(v)}%)`, { fuel: Math.round(v) }));
      // Density is absent (= 0) in space; small dead band against rounding flicker at the edge.
      if (prev.atmosphereDensity < 0.005 && cur.atmosphereDensity >= 0.01) push('atmosphere_entered', 'info', 'Entered atmosphere', { density: cur.atmosphereDensity });
      if (prev.atmosphereDensity >= 0.01 && cur.atmosphereDensity < 0.005) push('atmosphere_exited', 'info', 'Left atmosphere');
      if (cur.qdrv !== prev.qdrv) {
        if (cur.qdrv === 'NOMINAL' && prev.qdrv === 'OFF') push('quantum_drive_ready', 'info', 'Quantum drive ready');
        if (cur.qdrv === 'MAJOR_ON') push('quantum_drive_warning', 'warn', 'Quantum drive warning');
      }
      const powerChanged = POWER_KEYS.filter((k) => prev.power[k] !== cur.power[k]);
      if (powerChanged.length) push('power_changed', 'info', `Power: ${powerChanged.map((k) => `${k.replace(/_/g, ' ')} ${cur.power[k] ? 'on' : 'off'}`).join(', ')}`, { changed: Object.fromEntries(powerChanged.map((k) => [k, cur.power[k]])) });
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

  /** Fire once when `cur` drops below `below`; re-arm when it recovers to `rearm` or more. Unknown readings are ignored. */
  #low(key: string, prev: number | null, cur: number | null, below: number, rearm: number, fire: (v: number) => void): void {
    if (cur === null) return;
    if (this.#lowArmed[key] === undefined) this.#lowArmed[key] = (prev ?? cur) >= below;
    if (cur >= rearm) this.#lowArmed[key] = true;
    if (cur < below && this.#lowArmed[key] && prev !== null) {
      this.#lowArmed[key] = false;
      fire(cur);
    }
  }

  #enterVehicle(cur: Facts): void {
    this.#landedReported = cur.landed;
    this.#landedPending = null;
    this.#shieldPowerSeen = !!(cur.power.shield_generators && cur.power.shield_emitters);
    delete this.#lowArmed.low_fuel;
    this.#lastDamageAt = 0;
  }

  /** took_off / landed once the new state held for `landedSettleMs` (no flicker while hovering on the pad). */
  #landing(cur: Facts, prev: Facts, now: number, push: (type: string, sev: TelemetryEventSeverity, summary: string, data?: Obj, extra?: EventExtra, at?: number) => void): void {
    if (cur.landed !== prev.landed) this.#landedPending = cur.landed !== this.#landedReported ? { value: cur.landed, since: now } : null;
    const p = this.#landedPending;
    if (!p || cur.landed !== p.value || now - p.since < this.#settleMs) return;
    this.#landedPending = null;
    this.#landedReported = p.value;
    push(p.value ? 'landed' : 'took_off', 'info', p.value ? 'Landed' : 'Took off', undefined, {}, p.since);
  }
}

const POWER_KEYS = ['powerplants', 'engines', 'weapons', 'coolers', 'life_support', 'gravity_generators', 'sensors', 'shield_generators', 'shield_emitters'];

/** Calls `fire` when a percentage drops from ≥ threshold to < threshold (both readings known). */
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
