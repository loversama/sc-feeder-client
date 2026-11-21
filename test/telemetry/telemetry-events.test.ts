/**
 * Contextual telemetry events (feed contract v2), built from sequences seen in real PTU 5.0
 * recordings (telemetry-recordings/*.log, Nov 21 2026).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as grpc from '@grpc/grpc-js';
import { TelemetryState, vehicleRef, type TelemetryEvent } from '../../electron/modules/telemetry/telemetry-state';
import { TelemetryService, type TelemetryUploadPayload } from '../../electron/modules/telemetry/telemetry-service';
import { loadTelemetryRoot, TELEMETRY_PACKAGE, TELEMETRY_SERVICE } from '../../electron/modules/telemetry/telemetry-client';

const actor = (hp: number | null = 100, o2: number | null = 100) => ({
  actor: {
    vitals: {
      health: hp === null ? { max: 100 } : { current: hp, max: 100 },
      oxygen: o2 === null ? { max: 100 } : { current: o2, max: 100 },
    },
    state: { locomotion: 'ACTOR_LOCOMOTION_STATE_SEATED', crew_role: 'ACTOR_CREW_ROLE_PILOT' },
  },
});
type Ship = { mode?: string; shields?: number; shieldPower?: boolean; landed?: boolean; health?: number; hit?: boolean };
const ship = (o: Ship = {}) => ({
  vehicle: {
    state: {
      name: 'RSI_Galaxy_877609015558',
      class_name: 'RSI_Galaxy',
      health: o.health ?? 1,
      master_mode: { mode: `VEHICLE_MASTER_MODE_${o.mode ?? 'SCM'}`, spooled: true },
      shields: { level: o.shields ?? 1, faces: [o.shields ?? 1, o.shields ?? 1, o.shields ?? 1, o.shields ?? 1] },
      power: { powerplants: true, engines: true, shield_generators: o.shieldPower ?? true, shield_emitters: o.shieldPower ?? true },
      flight: { state: { is_landed: o.landed ?? false } },
      ...(o.hit ? { annunciators: { hit: 'VEHICLE_ANNUNCIATOR_STATE_MAJOR' } } : {}),
    },
  },
});
const gameEvent = (t: string) => ({ events: { events: [{ type: `GAME_EVENT_TYPE_${t}` }] } });

function run(frames: Array<[number, any]>, opts: ConstructorParameters<typeof TelemetryState>[0] = {}): TelemetryEvent[] {
  const s = new TelemetryState({ clientId: () => 'c1', ...opts });
  return frames.flatMap(([t, f]) => (f === 'tick' ? s.tick(t) : s.applyFrame(f, t)));
}
const ofType = (ev: TelemetryEvent[], type: string) => ev.filter((e) => e.type === type);

test('vehicleRef: entity id is the trailing number of the vehicle name', () => {
  assert.deepEqual(vehicleRef('RSI_Galaxy_877609015558', 'RSI_Galaxy'), { name: 'RSI_Galaxy_877609015558', className: 'RSI_Galaxy', entityId: '877609015558' });
  assert.deepEqual(vehicleRef('Gladius', 'AEGS_Gladius'), { name: 'Gladius', className: 'AEGS_Gladius' });
});

test('shields_down after switching to NAV (power drops ~1 s later, shields drain ~9 s) = info, cause nav_mode, not feed', () => {
  const ev = run([
    [0, { ...actor(), ...ship() }],
    [100, { ...actor(), ...ship() }],
    [1000, { ...actor(), ...ship({ mode: 'NAVIGATION', shields: 0.98 }) }],
    [2000, { ...actor(), ...ship({ mode: 'NAVIGATION', shields: 0.8, shieldPower: false }) }],
    [10500, { ...actor(), ...ship({ mode: 'NAVIGATION', shields: 0, shieldPower: false }) }],
  ]);
  const [d] = ofType(ev, 'shields_down');
  assert.equal(d.severity, 'info');
  assert.equal(d.context?.cause, 'nav_mode');
  assert.equal(d.feed, undefined);
  assert.equal(d.vehicle?.entityId, '877609015558');
  assert.equal(d.summary, 'Shields down (NAV mode)');
});

test('shields_down: power_off in SCM is info; under fire is an alert for the feed; no cause = unknown alert', () => {
  const powerOff = ofType(run([[0, { ...actor(), ...ship() }], [100, { ...actor(), ...ship({ shields: 0, shieldPower: false }) }]]), 'shields_down')[0];
  assert.equal(powerOff.context?.cause, 'power_off');
  assert.equal(powerOff.severity, 'info');
  assert.equal(powerOff.feed, undefined);

  const damage = ofType(run([[0, { ...actor(), ...ship({ health: 1 }) }], [100, { ...actor(), ...ship({ health: 0.9, shields: 0.2 }) }], [900, { ...actor(), ...ship({ health: 0.9, shields: 0 }) }]]), 'shields_down')[0];
  assert.equal(damage.context?.cause, 'damage');
  assert.equal(damage.severity, 'alert');
  assert.equal(damage.feed, true);
  assert.equal(damage.category, 'combat');

  const hit = ofType(run([[0, { ...actor(), ...ship() }], [100, { ...actor(), ...ship({ hit: true, shields: 0 }) }]]), 'shields_down')[0];
  assert.equal(hit.context?.cause, 'damage');

  const unknown = ofType(run([[0, { ...actor(), ...ship() }], [100, { ...actor(), ...ship({ shields: 0 }) }]]), 'shields_down')[0];
  assert.equal(unknown.context?.cause, 'unknown');
  assert.equal(unknown.severity, 'alert');
  assert.equal(unknown.feed, true);
});

test('downed: health disappears from the frame → player_downed (feed), never "Health low (0%)" / health_zero; then dead + respawn', () => {
  const ev = run([
    [0, actor(100)],
    [100, actor(93.44)],
    [200, actor(81.53)],
    [5000, { ...actor(null), ...gameEvent('ACTOR_DOWNED') }],
    [6000, { ...actor(null), ...gameEvent('ACTOR_DEAD') }],
    [30000, { ...actor(100), ...gameEvent('ACTOR_RESPAWN') }],
  ]);
  assert.deepEqual(ofType(ev, 'low_health'), []);
  assert.deepEqual(ofType(ev, 'health_zero'), []);
  const [downed] = ofType(ev, 'player_downed');
  assert.equal(downed.severity, 'alert');
  assert.equal(downed.feed, true);
  assert.equal(downed.category, 'combat');
  assert.equal(downed.context?.lastHealth, 82);
  assert.equal(downed.id, 'tm_c1_player_downed_5000');
  const [dead] = ofType(ev, 'player_dead');
  assert.equal(dead.context?.downedAt, new Date(5000).toISOString());
  assert.equal(ofType(ev, 'player_respawn')[0].feed, true);
  assert.ok(!ev.some((e) => e.type.startsWith('game_actor_d')), 'no duplicate raw game_actor_downed/dead');
});

test('low_health still fires for real readings crossing 25 %', () => {
  const ev = run([[0, actor(60)], [100, actor(20)]]);
  assert.equal(ofType(ev, 'low_health').length, 1);
  assert.equal(ofType(ev, 'low_health')[0].category, 'vitals');
});

test('repeated game events (LEAVE_SEAT x9 in 430 ms, ENTER_SEAT x2) collapse into one', () => {
  const frames: Array<[number, any]> = [[0, actor()]];
  for (let i = 0; i < 9; i++) frames.push([1000 + i * 50, { ...actor(), ...gameEvent('ACTOR_LEAVE_SEAT') }]);
  frames.push([2000, { ...actor(), ...gameEvent('ACTOR_ENTER_SEAT') }], [2030, { ...actor(), ...gameEvent('ACTOR_ENTER_SEAT') }]);
  frames.push([5000, { ...actor(), ...gameEvent('ACTOR_LEAVE_SEAT') }]); // a later, real one
  const ev = run(frames);
  assert.equal(ofType(ev, 'game_actor_leave_seat').length, 2);
  assert.equal(ofType(ev, 'game_actor_enter_seat').length, 1);
});

test('took_off / landed are feed travel events once the state settled; a hop on the pad is ignored', () => {
  const ev = run([
    [0, { ...actor(), ...ship({ landed: true }) }],
    [100, { ...actor(), ...ship({ landed: false }) }],
    [400, { ...actor(), ...ship({ landed: true }) }], // bounced back within 1.5 s
    [2500, { ...actor(), ...ship({ landed: true }) }],
    [3000, { ...actor(), ...ship({ landed: false }) }],
    [3500, 'tick'],
    [4600, { ...actor(), ...ship({ landed: false }) }],
  ]);
  const travel = ev.filter((e) => e.type === 'took_off' || e.type === 'landed');
  assert.deepEqual(travel.map((e) => [e.type, e.at]), [['took_off', new Date(3000).toISOString()]]);
  assert.equal(travel[0].feed, true);
  assert.equal(travel[0].category, 'travel');
  assert.equal(travel[0].vehicle?.className, 'RSI_Galaxy');
});

test('vehicle_exited is dated at the game LEAVE_SEAT, carries the ship; entered/exited are feed', () => {
  const ev = run([
    [0, actor()],
    [100, { ...actor(), ...ship({ landed: true }) }],
    [1000, { ...actor(), ...ship({ landed: true }) }],
    [2000, { ...actor(), ...gameEvent('ACTOR_LEAVE_SEAT') }],
    [5100, actor()], // vehicle section went stale 3 s later
  ]);
  const [entered] = ofType(ev, 'vehicle_entered');
  assert.equal(entered.feed, true);
  assert.equal(entered.summary, 'Entered RSI Galaxy');
  const [exited] = ofType(ev, 'vehicle_exited');
  assert.equal(exited.at, new Date(2000).toISOString());
  assert.equal(exited.vehicle?.entityId, '877609015558');
  assert.equal(exited.feed, true);
});

test('event ids are tm_<clientId>_<type>_<ms> and unique', () => {
  const ev = run([[0, actor(100, 100)], [100, actor(100, 20)], [100, actor(100, 100)], [100, actor(100, 20)]]);
  const ids = ofType(ev, 'low_oxygen').map((e) => e.id);
  assert.equal(ids[0], 'tm_c1_low_oxygen_100');
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ev.every((e) => typeof e.category === 'string'));
});

// --- game restart: the gRPC stream comes back on its own ---------------------------------------

const root = loadTelemetryRoot();
function fakeGame(port = 0): Promise<{ port: number; server: grpc.Server }> {
  const req = root.lookupType(`${TELEMETRY_PACKAGE}.TelemetryStreamRequest`);
  const res = root.lookupType(`${TELEMETRY_PACKAGE}.TelemetryStreamResponse`);
  const server = new grpc.Server();
  server.addService(
    {
      TelemetryStream: {
        path: `/${TELEMETRY_SERVICE}/TelemetryStream`,
        requestStream: false,
        responseStream: true,
        requestSerialize: (o: any) => Buffer.from(req.encode(req.fromObject(o)).finish()),
        requestDeserialize: (b: Buffer) => req.toObject(req.decode(b)),
        responseSerialize: (o: any) => Buffer.from(res.encode(res.fromObject(o)).finish()),
        responseDeserialize: (b: Buffer) => res.toObject(res.decode(b)),
      },
    } as any,
    {
      TelemetryStream: (call: grpc.ServerWritableStream<any, any>) => {
        const t = setInterval(() => call.write(actor(100)), 20);
        call.on('cancelled', () => clearInterval(t));
        call.on('close', () => clearInterval(t));
      },
    },
  );
  return new Promise((resolve, reject) =>
    server.bindAsync(`127.0.0.1:${port}`, grpc.ServerCredentials.createInsecure(), (err, p) => (err ? reject(err) : resolve({ port: p, server }))),
  );
}

test('TelemetryService: game restart → stream resumes and snapshots keep flowing', async () => {
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const first = await fakeGame();
  const uploads: TelemetryUploadPayload[] = [];
  const svc = new TelemetryService({
    address: `127.0.0.1:${first.port}`,
    isSharingEnabled: () => true,
    upload: (p) => (uploads.push(p), true),
    snapshotIntervalMs: 30,
    heartbeatMs: 50,
    eventFlushMs: 20,
    retryMs: [50, 100],
  });
  svc.start();
  await wait(400);
  assert.equal(svc.status, 'streaming');
  first.server.forceShutdown(); // game closed
  await wait(300);
  assert.equal(svc.status, 'waiting_for_game');
  const before = uploads.filter((u) => u.kind === 'snapshot').length;
  const second = await fakeGame(first.port); // game started again on the same port
  for (let i = 0; i < 60 && svc.status !== 'streaming'; i++) await wait(50);
  assert.equal(svc.status, 'streaming', 'stream re-opened after the game restarted');
  await wait(300);
  assert.ok(uploads.filter((u) => u.kind === 'snapshot').length > before, 'snapshots resumed');
  svc.stop();
  second.server.forceShutdown();
});

// --- 0.3.3 additions ----------------------------------------------------------------------------

const vitals = (o: { hunger?: number; thirst?: number; hr?: number } = {}) => ({
  actor: {
    vitals: {
      health: { current: 100, max: 100 },
      hunger: { current: o.hunger ?? 100, max: 100 },
      thirst: { current: o.thirst ?? 100, max: 100 },
      heart_rate: o.hr ?? 60,
    },
    state: { locomotion: 'ACTOR_LOCOMOTION_STATE_ON_FOOT' },
  },
});

test('low hunger / thirst: info alerts once per crossing, re-armed only after recovering above 35 %', () => {
  const ev = run([
    [0, vitals({ hunger: 30 })],
    [100, vitals({ hunger: 24.9 })],
    [200, vitals({ hunger: 24.5 })],
    [300, vitals({ hunger: 26 })], // hovering at the edge: no new alert
    [400, vitals({ hunger: 24 })],
    [500, vitals({ hunger: 80 })], // ate
    [600, vitals({ hunger: 20, thirst: 10 })],
  ]);
  assert.deepEqual(ofType(ev, 'low_hunger').map((e) => e.data?.hunger), [25, 20]);
  assert.equal(ofType(ev, 'low_hunger')[0].severity, 'info');
  assert.equal(ofType(ev, 'low_hunger')[0].feed, undefined);
  assert.equal(ofType(ev, 'low_thirst').length, 1);
  assert.equal(ofType(ev, 'low_thirst')[0].category, 'vitals');
  // already low when telemetry starts: no alert
  assert.equal(ofType(run([[0, vitals({ hunger: 10 })], [100, vitals({ hunger: 9 })]]), 'low_hunger').length, 0);
});

const flightShip = (o: { fuel?: number; density?: number; qdrv?: string } = {}) => ({
  vehicle: {
    state: {
      name: 'ANVL_C8R_Pisces_877604809490',
      class_name: 'ANVL_C8R_Pisces',
      flight: { instruments: { ...(o.fuel !== undefined ? { hydrogen_fuel: o.fuel } : {}), ...(o.density ? { atmospheric_density: o.density } : {}) }, state: {} },
      ...(o.qdrv ? { annunciators: { qdrv: `ANNUNCIATOR_STATE_${o.qdrv}` } } : {}),
    },
  },
});

test('low hydrogen fuel, atmosphere entered/exited (density absent in space), quantum drive ready/warning from annunciators.qdrv', () => {
  const ev = run([
    [0, { ...actor(), ...flightShip({ fuel: 0.5, density: 1.2, qdrv: 'OFF' }) }],
    [100, { ...actor(), ...flightShip({ fuel: 0.14, density: 0.9, qdrv: 'OFF' }) }],
    [200, { ...actor(), ...flightShip({ fuel: 0.13, qdrv: 'NOMINAL' }) }], // left atmosphere, NAV mode
    [300, { ...actor(), ...flightShip({ fuel: 0.13, qdrv: 'MAJOR_ON' }) }],
    [400, { ...actor(), ...flightShip({ fuel: 0.13, qdrv: 'NOMINAL' }) }],
    [500, { ...actor(), ...flightShip({ fuel: 0.13, density: 0.004, qdrv: 'NOMINAL' }) }], // dead band
    [600, { ...actor(), ...flightShip({ fuel: 0.13, density: 0.3, qdrv: 'NOMINAL' }) }],
  ]);
  assert.deepEqual(ofType(ev, 'low_fuel').map((e) => e.data?.fuel), [14]);
  assert.deepEqual(ev.filter((e) => e.type.startsWith('atmosphere_')).map((e) => e.type), ['atmosphere_exited', 'atmosphere_entered']);
  assert.equal(ofType(ev, 'quantum_drive_ready').length, 1);
  assert.equal(ofType(ev, 'quantum_drive_warning').length, 1);
  assert.equal(ofType(ev, 'annunciator_warning').length, 0, 'qdrv has its own event, not the generic warning light');
  assert.ok(ev.every((e) => !e.feed), 'all live-only');
});

test('snapshot upload: heart-rate / hunger jitter does not trigger uploads; a real change or 5 s does', async () => {
  let t = 0;
  let onFrame: ((f: any, b: number) => void) | null = null;
  const uploads: any[] = [];
  const svc = new TelemetryService({
    address: 'fake',
    isSharingEnabled: () => true,
    upload: (p) => (uploads.push(p), true),
    snapshotIntervalMs: 10,
    heartbeatMs: 60_000,
    silenceMs: 60_000,
    now: () => t,
    clientFactory: () => ({ openStream: (f) => ((onFrame = f), { cancel: () => {} }), close: () => {} }),
  });
  svc.start();
  const step = async (ms: number, frame: any) => {
    t += ms;
    onFrame!(frame, 10);
    await new Promise((r) => setTimeout(r, 30));
  };
  await step(0, vitals({ hr: 60, hunger: 92.29 }));
  const base = uploads.length;
  assert.equal(base, 1);
  await step(1000, vitals({ hr: 61.5, hunger: 92.28 }));
  await step(1000, vitals({ hr: 59, hunger: 92.27 }));
  assert.equal(uploads.length, base, 'sub-step jitter only');
  await step(1000, vitals({ hr: 64, hunger: 92.26 }));
  assert.equal(uploads.length, base + 1, '>= 3 bpm change uploads');
  assert.equal(uploads.at(-1).snapshot.actor.vitals.heart_rate, 64);
  await step(1000, vitals({ hr: 65, hunger: 92.25 }));
  assert.equal(uploads.length, base + 1);
  await step(4500, vitals({ hr: 65.5, hunger: 92.2 }));
  assert.equal(uploads.length, base + 2, 'refreshed after 5 s');
  svc.stop();
});

test('Game.log feed items: same id shape, context.source game_log, shared while the game stream is off', () => {
  const uploads: any[] = [];
  const svc = new TelemetryService({ address: 'fake', clientId: () => 'c1', isSharingEnabled: () => true, upload: (p) => (uploads.push(p), true) });
  svc.injectLogEvent({ type: 'qt_arrived', at: 1_000_000, severity: 'info', summary: 'Quantum travel complete to Nyx I', category: 'travel', feed: true, context: { to: 'Nyx I', durationSec: 199 } });
  const e = uploads[0].events[0];
  assert.equal(uploads[0].kind, 'events');
  assert.equal(e.id, 'tm_c1_qt_arrived_1000000');
  assert.equal(e.feed, true);
  assert.deepEqual(e.context, { to: 'Nyx I', durationSec: 199, source: 'game_log' });
  svc.injectLogEvent({ type: 'qt_route_planned', at: 1_000_100, severity: 'info', summary: 'Quantum route', category: 'travel' });
  assert.equal(uploads[1].events[0].feed, undefined, 'live-only items carry no feed flag');
  const long = 'tm_1d8bb6ac-3c51-495a-8502-ae7a7299e676_healed_at_medical_bed_1795284541745_12';
  assert.ok(long.length <= 128, 'longest 0.3.3 id fits the server cap');
});

test('Game.log player_downed fallback waits for telemetry and is dropped when telemetry already reported it', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const uploads: any[] = [];
  const svc = new TelemetryService({ address: 'fake', clientId: () => 'c1', isSharingEnabled: () => true, upload: (p) => (uploads.push(p), true) });
  const at = Date.parse('2026-11-21T17:23:34.951Z');
  const downed = { type: 'player_downed', at, severity: 'alert' as const, summary: 'Downed', category: 'combat' as const, feed: true, fallbackFor: 'player_downed' };
  svc.injectLogEvent(downed);
  assert.equal(uploads.length, 0, 'held');
  t.mock.timers.tick(5000);
  assert.equal(uploads.length, 1, 'no telemetry: the log fallback is sent');
  assert.equal(uploads[0].events[0].context.source, 'game_log');
  // telemetry saw it 0.9 s earlier: the fallback is dropped
  svc.recentEvents.unshift({ id: 'x', type: 'player_downed', at: new Date(at - 860).toISOString(), source: 'telemetry', severity: 'alert', summary: 'Downed' });
  svc.injectLogEvent({ ...downed, at: at + 10 });
  t.mock.timers.tick(5000);
  assert.equal(uploads.length, 1);
});
