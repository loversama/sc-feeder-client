/**
 * SC 5.0 Game.log moments that the 4.x parser never handled: quantum trips with readable names,
 * monitored space, the "Incapacitated" HUD notification, ship retrieval / hangar queue, readable
 * inventory location, medical bed and the loadout burst after a (re)spawn.
 *
 * Pure (no Electron imports): log-parser feeds it every line and turns the outputs into local feed
 * events (processKillEvent) and server feed items (log-feed.ts → TelemetryService). Line shapes are
 * taken from real 5.0.202 PTU logs (test/parser/fixtures/*-50.txt).
 */
import type { LogFeedItem } from './telemetry/log-feed';
import { vehicleRef } from './telemetry/telemetry-state';

export type Sc50LocalEvent = {
  eventType: 'location_change' | 'quantum_travel' | 'incapacitated' | 'hangar' | 'medical' | 'loadout';
  id: string;
  timestamp: string;
  description: string;
  destination?: string;
  location?: string;
  eventData: Record<string, unknown>;
};

export type Sc50Output = { local?: Sc50LocalEvent; feed?: LogFeedItem; location?: string };

const TS_RE = /^<(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)>/;
const RE = {
  planet: /Planet '(?<name>[^']+)' \(entity (?<id>\d+)\)/,
  navVehicle: /\| (?<vehicle>[A-Za-z0-9_]+?_(?<id>\d{9,}))\[\k<id>\]\|/,
  monitoredSpace: /Added notification "(?<action>Entered|Exited) Monitored Space:\s*"\s*\[(?<notifId>\d+)\]/,
  incapacitated: /Added notification "Incapacitated:[^"]*"\s*\[(?<notifId>\d+)\]/,
  qtFuelRequest: /<Player Requested Fuel to Quantum Target[^>]*>.*?requested fuel calculation to destination (?<dest>\S+)/,
  qtSelected: /<Player Selected Quantum Target - Local>.*?selected point (?<dest>\S+) as their destination/,
  qtStartLocation: /<Calculate Route>.*?Projected Start Location is (?<start>.+?) for route to destination (?<dest>\S+)/,
  qtRouteSuccess: /<Calculate Route>.*?Successfully calculated route to (?<dest>\S+) fuel estimate (?<fuel>[\d.]+)/,
  qtObstructed: /Added notification "Quantum Travel: Your destination is obstructed[^"]*"\s*\[(?<notifId>\d+)\]/,
  qtArrived: /<Quantum Drive Arrived - Arrived at Final Destination>/,
  qtAligned: /User: (?<user>[^,]+), Client: [^,]*,.*?Aligned Target: (?<target>[^,\s]+)/,
  qtSplineTo: /spline QT to (?<dest>\S+) on the surface of (?<body>[^\s,]+)/,
  fleet: /<VehicleListQuery> Fetching vehicle list for player \d+ completed\. Retrieved (?<n>\d+) entitlements out of (?<total>\d+)/,
  spawnInfo: /SetVehicleSpawningInformations - VehicleEntityId: \[(?<id>\d+)\], LandingArea: (?<area>.*)$/,
  hangarCompleted: /Added notification "Hangar Request Completed:\s*"\s*\[(?<notifId>\d+)\]/,
  hangarQueued: /Added notification "Joined hangar queue\./,
  locationInventory: /<RequestLocationInventory> Player\[(?<player>[^\]]+)\] requested inventory for Location\[(?<loc>[^\]]+)\]/,
  medicalBed: /Added notification "Medical Bed:[^"\r\n]*"?\s*\[(?<notifId>\d+)\]/,
  attachment: /<AttachmentReceived> Player\[(?<player>[^\]]+)\] Attachment\[[^,]+, (?<cls>[^,]+), \d+\] Status\[\w+\] Port\[(?<port>[^\]]+)\]/,
};

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];
const SYSTEMS = new Set(['stanton', 'pyro', 'nyx', 'castra', 'terra']);

/** Game location / target ids → names people know. Returns undefined for bare entity ids. */
export function prettyPlace(raw: string | undefined | null): string | undefined {
  if (!raw) return undefined;
  const s = raw.trim();
  if (!s || /^\d+$/.test(s)) return undefined;
  const paren = s.match(/\(([^)]+)\)\s*$/);
  if (paren) return paren[1].trim();
  const planet = s.match(/^([A-Za-z]+)(\d{1,2})$/);
  if (planet && ROMAN[Number(planet[2])]) return `${cap(planet[1])} ${ROMAN[Number(planet[2])]}`;
  const parts = s.replace(/^OOC_/i, '').split('_').filter(Boolean);
  if (parts.length === 2 && SYSTEMS.has(parts[0].toLowerCase())) return `${cap(parts[1])} (${cap(parts[0])})`;
  if (parts.length > 2 && SYSTEMS.has(parts[0].toLowerCase())) {
    const named = parts.filter((p) => !/^\d+$/.test(p));
    return named.slice(1).map(cap).join(' ') || cap(parts[0]);
  }
  return parts.map(cap).join(' ');
}

const cap = (w: string) => (w ? w[0].toUpperCase() + w.slice(1) : w);
const tsMs = (ts: string) => Date.parse(ts);

type Trip = {
  vehicle: string;
  vehicleId: string;
  destId: string;
  destName?: string;
  from?: string;
  fuel?: number;
  selectedAt: string;
  planned: boolean;
};

export class Sc50LogTracker {
  #entityNames = new Map<string, string>();
  #trip: Trip | null = null;
  #spawn: { vehicleId: string; area: string; at: string; continued: boolean } | null = null;
  #fleetSize: number | undefined;
  #location: string | undefined;
  #loadout: { first: string; last: string; count: number; ports: Set<string> } | null = null;
  #seen = new Set<string>();

  reset(): void {
    this.#entityNames.clear();
    this.#trip = null;
    this.#spawn = null;
    this.#fleetSize = undefined;
    this.#location = undefined;
    this.#loadout = null;
    this.#seen.clear();
    this.#pending = [];
  }

  get location(): string | undefined {
    return this.#location;
  }

  /**
   * One log line. `consumed` = the line belongs to this tracker (the parser stops there); `out` may
   * hold outputs either way (e.g. a loadout burst closed by an unrelated later line).
   * `username` is the local player's handle (lines about other players are ignored).
   */
  handle(line: string, username: string | null): { out: Sc50Output[]; consumed: boolean } {
    const r = this.#handle(line, username);
    return r === null ? { out: this.#pending.splice(0), consumed: false } : { out: [...this.#pending.splice(0), ...r], consumed: true };
  }

  #pending: Sc50Output[] = [];

  #handle(line: string, username: string | null): Sc50Output[] | null {
    const ts = line.match(TS_RE)?.[1];
    const out: Sc50Output[] = [];
    if (!ts) return null;

    // The hangar name of SetVehicleSpawningInformations wraps onto the next line ("<handle>'s\n<ts> XL Hangar [Team…]").
    if (this.#spawn && !this.#spawn.continued) {
      this.#spawn.continued = true;
      const rest = line.slice(ts.length + 2).replace(/\s*\[Team_[^\]]*\].*$/, '').trim();
      if (rest && !rest.startsWith('[') && !rest.startsWith('<')) {
        this.#spawn.area = `${this.#spawn.area} ${rest}`.trim();
        return out;
      }
    }

    // Loadout burst ends at the first line more than 2 s after its last attachment.
    if (this.#loadout && tsMs(ts) - tsMs(this.#loadout.last) > 2000) this.#pending.push(...this.flushLoadout());

    let m: RegExpMatchArray | null;
    if ((m = line.match(RE.planet))) {
      this.#entityNames.set(m.groups!.id, m.groups!.name);
      return null;
    }

    if ((m = line.match(RE.monitoredSpace))) {
      const { action, notifId } = m.groups!;
      if (!this.#once(`ms_${notifId}_${action}`)) return out;
      const enter = action === 'Entered';
      out.push({
        local: {
          eventType: 'location_change',
          id: `zone_monitored_space_${enter ? 'enter' : 'leave'}_${ts}`,
          timestamp: ts,
          description: enter ? 'Entered monitored space' : 'Left monitored space',
          destination: 'Monitored Space',
          eventData: { zoneType: 'monitored_space', action: enter ? 'enter' : 'leave' },
        },
      });
      return out;
    }

    if ((m = line.match(RE.incapacitated))) {
      if (!this.#once(`incap_${ts}`)) return out;
      out.push({
        local: { eventType: 'incapacitated', id: `incap_${ts}`, timestamp: ts, description: 'You were incapacitated', eventData: { source: 'hud_notification' } },
        feed: {
          type: 'player_downed',
          at: tsMs(ts),
          severity: 'alert',
          summary: 'Downed',
          category: 'combat',
          feed: true,
          context: { ...(this.#location ? { location: this.#location } : {}) },
          fallbackFor: 'player_downed',
        },
      });
      return out;
    }

    // --- quantum trip ---
    if ((m = line.match(RE.qtFuelRequest))) {
      const veh = line.match(RE.navVehicle)?.groups;
      if (veh && (!this.#trip || this.#trip.destId !== m.groups!.dest || this.#trip.planned)) {
        this.#trip = { vehicle: veh.vehicle, vehicleId: veh.id, destId: m.groups!.dest, selectedAt: ts, planned: false };
      }
      return out;
    }
    if ((m = line.match(RE.qtSelected))) {
      const veh = line.match(RE.navVehicle)?.groups;
      const dest = m.groups!.dest;
      if (!veh) return out;
      if (!this.#trip || this.#trip.destId !== dest || this.#trip.vehicleId !== veh.id || this.#trip.planned) {
        this.#trip = { vehicle: veh.vehicle, vehicleId: veh.id, destId: dest, selectedAt: ts, planned: false };
      }
      const to = this.#destName(this.#trip);
      out.push({
        local: {
          eventType: 'quantum_travel',
          id: `qt_selected_${ts}_${dest}`,
          timestamp: ts,
          description: to ? `Quantum target selected: ${to}` : 'Quantum target selected',
          destination: to,
          eventData: { phase: 'selected', vehicle: veh.vehicle, destinationRaw: dest },
        },
      });
      return out;
    }
    if ((m = line.match(RE.qtStartLocation))) {
      if (this.#trip && this.#trip.destId === m.groups!.dest) this.#trip.from = prettyPlace(m.groups!.start);
      return out;
    }
    if ((m = line.match(RE.qtRouteSuccess))) {
      const t = this.#trip;
      if (!t || t.destId !== m.groups!.dest || t.planned) return out;
      t.planned = true;
      t.fuel = Math.round(parseFloat(m.groups!.fuel));
      const to = this.#destName(t);
      const summary = `Quantum route${t.from ? ` from ${t.from}` : ''}${to ? ` to ${to}` : ''}`;
      out.push({
        local: { eventType: 'quantum_travel', id: `qt_route_${ts}_${t.destId}`, timestamp: ts, description: summary, destination: to, eventData: { phase: 'route_planned', from: t.from, to, fuel: t.fuel, vehicle: t.vehicle } },
        feed: { type: 'qt_route_planned', at: tsMs(ts), severity: 'info', summary, category: 'travel', context: this.#tripContext(t), vehicle: this.#vehicle(t) },
      });
      return out;
    }
    if ((m = line.match(RE.qtObstructed))) {
      if (!this.#once(`qtobs_${ts}`)) return out;
      const t = this.#trip;
      const to = t ? this.#destName(t) : undefined;
      const summary = `Quantum travel blocked${to ? ` to ${to}` : ''}: destination obstructed`;
      out.push({
        local: { eventType: 'quantum_travel', id: `qt_obstructed_${ts}`, timestamp: ts, description: summary, destination: to, eventData: { phase: 'obstructed', to } },
        feed: { type: 'qt_obstructed', at: tsMs(ts), severity: 'warn', summary, category: 'travel', context: t ? this.#tripContext(t) : {}, vehicle: t ? this.#vehicle(t) : undefined },
      });
      return out;
    }
    if ((m = line.match(RE.qtAligned))) {
      // QT errors name the user whose drive misbehaved; only our own tell us our target.
      if (username && m.groups!.user.trim() === username && this.#trip) this.#trip.destName = m.groups!.target;
      const spline = line.match(RE.qtSplineTo);
      if (spline && username && m.groups!.user.trim() === username && this.#trip) this.#trip.destName = spline.groups!.dest;
      return out;
    }
    if (RE.qtArrived.test(line)) {
      const veh = line.match(RE.navVehicle)?.groups;
      const t = this.#trip;
      // Arrivals of every ship nearby are logged: only our own trip's vehicle counts.
      if (!veh || !t || veh.id !== t.vehicleId) return out;
      this.#trip = null;
      const to = this.#destName(t);
      const durationSec = Math.max(0, Math.round((tsMs(ts) - tsMs(t.selectedAt)) / 1000));
      const summary = `Quantum travel complete${t.from ? ` from ${t.from}` : ''}${to ? ` to ${to}` : ''}`;
      out.push({
        local: { eventType: 'quantum_travel', id: `qt_arrived_${ts}_${t.vehicleId}`, timestamp: ts, description: summary, destination: to, eventData: { phase: 'arrived', from: t.from, to, durationSec, vehicle: t.vehicle, vehicleId: t.vehicleId } },
        feed: { type: 'qt_arrived', at: tsMs(ts), severity: 'info', summary, category: 'travel', feed: true, context: { ...this.#tripContext(t), durationSec }, vehicle: this.#vehicle(t) },
      });
      return out;
    }

    // --- ships / hangar ---
    if ((m = line.match(RE.fleet))) {
      this.#fleetSize = Number(m.groups!.total);
      return out;
    }
    if ((m = line.match(RE.spawnInfo))) {
      this.#spawn = { vehicleId: m.groups!.id, area: m.groups!.area.replace(/\s*\[Team_[^\]]*\].*$/, '').trim(), at: ts, continued: false };
      return out;
    }
    if ((m = line.match(RE.hangarCompleted))) {
      if (!this.#once(`hangar_${ts}`)) return out;
      const sp = this.#spawn && tsMs(ts) - tsMs(this.#spawn.at) <= 15 * 60_000 ? this.#spawn : null;
      this.#spawn = null;
      const hangar = sp ? hangarName(sp.area, username) : undefined;
      if (!sp) {
        out.push({ local: { eventType: 'hangar', id: `hangar_done_${ts}`, timestamp: ts, description: 'Hangar request completed', eventData: { action: 'request_completed' } } });
        return out;
      }
      const summary = `Ship delivered${hangar ? ` to ${hangar}` : ''}`;
      const context: Record<string, string | number> = { vehicleEntityId: sp.vehicleId, ...(hangar ? { hangar } : {}), ...(this.#fleetSize ? { fleetSize: this.#fleetSize } : {}), ...(this.#location ? { location: this.#location } : {}) };
      out.push({
        local: { eventType: 'hangar', id: `hangar_retrieved_${ts}_${sp.vehicleId}`, timestamp: ts, description: summary, location: hangar, eventData: { action: 'retrieved', vehicleId: sp.vehicleId, hangar, fleetSize: this.#fleetSize } },
        feed: {
          type: 'ship_retrieved',
          at: tsMs(ts),
          severity: 'info',
          summary,
          category: 'ship',
          feed: true,
          context,
        },
      });
      return out;
    }
    if (RE.hangarQueued.test(line)) {
      if (!this.#once(`hangarq_${ts}`)) return out;
      out.push({
        local: { eventType: 'hangar', id: `hangar_queued_${ts}`, timestamp: ts, description: 'Joined the hangar queue', eventData: { action: 'queued' } },
        feed: { type: 'hangar_queued', at: tsMs(ts), severity: 'info', summary: 'Joined the hangar queue', category: 'ship' },
      });
      return out;
    }

    // --- readable location ---
    if ((m = line.match(RE.locationInventory))) {
      if (!username || m.groups!.player !== username) return out;
      const loc = prettyPlace(m.groups!.loc);
      if (!loc || loc === this.#location) return out;
      this.#location = loc;
      out.push({
        location: loc,
        local: { eventType: 'location_change', id: `inv_location_${ts}`, timestamp: ts, description: `At ${loc}`, location: loc, destination: loc, eventData: { zoneType: 'inventory_location', action: 'enter', raw: m.groups!.loc } },
        feed: { type: 'location_changed', at: tsMs(ts), severity: 'info', summary: `At ${loc}`, category: 'status', context: { location: loc } },
      });
      return out;
    }

    // --- vitals / loadout ---
    if ((m = line.match(RE.medicalBed))) {
      if (!this.#once(`medbed_${m.groups!.notifId}_${ts}`)) return out;
      out.push({
        local: { eventType: 'medical', id: `medbed_${ts}`, timestamp: ts, description: 'Healed at a medical bed', location: this.#location, eventData: { action: 'medical_bed' } },
        feed: { type: 'healed_at_medical_bed', at: tsMs(ts), severity: 'info', summary: 'Healed at a medical bed', category: 'vitals', feed: true, context: this.#location ? { location: this.#location } : {} },
      });
      return out;
    }
    if ((m = line.match(RE.attachment))) {
      if (!username || m.groups!.player !== username) return out;
      if (!this.#loadout) this.#loadout = { first: ts, last: ts, count: 0, ports: new Set() };
      this.#loadout.last = ts;
      this.#loadout.count++;
      this.#loadout.ports.add(m.groups!.port);
      return out;
    }
    return null;
  }

  /** Close a pending loadout burst (call at the end of a log or on a long pause). */
  flushLoadout(): Sc50Output[] {
    const l = this.#loadout;
    this.#loadout = null;
    if (!l) return [];
    const armor = [...l.ports].filter((p) => /^Armor_/i.test(p)).length;
    const weapons = [...l.ports].filter((p) => /^wep_/i.test(p)).length;
    return [
      {
        local: {
          eventType: 'loadout',
          id: `loadout_${l.first}`,
          timestamp: l.first,
          description: `Loadout equipped (${l.count} items)`,
          eventData: { items: l.count, armorPieces: armor, weapons },
        },
      },
    ];
  }

  #once(key: string): boolean {
    if (this.#seen.has(key)) return false;
    this.#seen.add(key);
    if (this.#seen.size > 500) this.#seen.delete(this.#seen.values().next().value as string);
    return true;
  }

  #destName(t: Trip): string | undefined {
    return prettyPlace(t.destName) ?? prettyPlace(this.#entityNames.get(t.destId)) ?? prettyPlace(t.destId);
  }

  #tripContext(t: Trip): Record<string, string | number> {
    const to = this.#destName(t);
    return { ...(t.from ? { from: t.from } : {}), ...(to ? { to } : {}), ...(t.fuel !== undefined ? { fuel: t.fuel } : {}) };
  }

  #vehicle(t: Trip) {
    return vehicleRef(t.vehicle, '');
  }
}

/** "<handle>'s XL Hangar" → "XL Hangar" (own); other areas are kept as they are. */
function hangarName(area: string, username: string | null): string | undefined {
  let a = area.trim();
  if (username && a.startsWith(`${username}'s`)) a = a.slice(username.length + 2).trim();
  return a || undefined;
}
