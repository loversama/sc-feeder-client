/**
 * Telemetry + Game.log diff tests. Run with:  npm run test:telemetry
 * (bundled with esbuild, run with node's built-in test runner; no Electron needed)
 *
 * Starts a fake Star Citizen telemetry gRPC server built from the same embedded schema and
 * checks that TelemetryService connects, merges partial frames, derives events and uploads.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as grpc from '@grpc/grpc-js';
import { loadTelemetryRoot, TELEMETRY_PACKAGE, TELEMETRY_SERVICE } from '../../electron/modules/telemetry/telemetry-client';
import { TelemetryService, type TelemetryUploadPayload } from '../../electron/modules/telemetry/telemetry-service';
import { TelemetryState, flatten } from '../../electron/modules/telemetry/telemetry-state';
import { buildSignatureSet, diffSignatureSets, lineSignature, extractBuildInfo } from '../../electron/modules/log-diff/log-signature';

const root = loadTelemetryRoot();
const T = (n: string) => root.lookupType(`${TELEMETRY_PACKAGE}.${n}`);

const actorFrame = (o2 = 100, extra: any = {}) => ({
  actor: {
    vitals: { health: { current: 100, max: 100 }, oxygen: { current: o2, max: 100 }, heart_rate: 72 },
    state: { locomotion: 'ACTOR_LOCOMOTION_STATE_ON_FOOT', uec_balance: 125000, ...extra },
    environment: { breathable_atmosphere: true, external_temperature: 21 },
  },
});
const vehicleFrame = (gear = 'VEHICLE_COMPONENT_DEPLOYMENT_STATE_DEPLOYED', shields = 1) => ({
  vehicle: {
    state: {
      name: 'Gladius',
      class_name: 'AEGS_Gladius',
      manufacturer: 'Aegis',
      type: 'VEHICLE_TYPE_SPACESHIP',
      health: 1,
      flight: { state: { is_landed: true, gear } },
      shields: { level: shields },
      master_mode: { mode: 'VEHICLE_MASTER_MODE_NAVIGATION' },
    },
  },
});

function startFakeGame(frames: any[], intervalMs = 20): Promise<{ port: number; server: grpc.Server }> {
  const req = T('TelemetryStreamRequest');
  const res = T('TelemetryStreamResponse');
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
        let i = 0;
        const t = setInterval(() => {
          if (i >= frames.length) {
            clearInterval(t);
            return; // keep the stream open, like the game does
          }
          call.write(frames[i++]);
        }, intervalMs);
        call.on('cancelled', () => clearInterval(t));
      },
    },
  );
  return new Promise((resolve, reject) =>
    server.bindAsync('127.0.0.1:0', grpc.ServerCredentials.createInsecure(), (err, port) => (err ? reject(err) : resolve({ port, server }))),
  );
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

test('TelemetryState: partial frames keep other sections; absent fields are defaults', () => {
  const s = new TelemetryState({ staleMs: 3000 });
  s.applyFrame(actorFrame(), 1000);
  s.applyFrame(vehicleFrame(), 1050); // no actor in this frame
  assert.ok(s.section('actor', 1100), 'actor kept from previous frame');
  assert.ok(s.section('vehicle', 1100));
  assert.equal(s.section('actor', 4500), undefined, 'actor stale after 3 s');
});

test('TelemetryState: derives vehicle, gear, oxygen, shield, balance events', () => {
  const s = new TelemetryState();
  s.applyFrame(actorFrame(), 0);
  const e1 = s.applyFrame({ ...actorFrame(), ...vehicleFrame() }, 100);
  assert.deepEqual(e1.map((e) => e.type), ['vehicle_entered']);
  const e2 = s.applyFrame({ ...actorFrame(20, { uec_balance: 126000 }), ...vehicleFrame('VEHICLE_COMPONENT_DEPLOYMENT_STATE_RETRACTED', 0) }, 200);
  const types = e2.map((e) => e.type).sort();
  assert.deepEqual(types, ['balance_changed', 'landing_gear', 'low_oxygen', 'shields_down']);
  assert.equal(e2.find((e) => e.type === 'balance_changed')!.data!.localOnly, true);
  // native game events
  const e3 = s.applyFrame({ events: { events: [{ type: 'GAME_EVENT_TYPE_ACTOR_ENTER_SEAT' }] } }, 300);
  assert.ok(e3.some((e) => e.type === 'game_actor_enter_seat'));
  // vehicle section goes stale → exited
  const e4 = s.applyFrame(actorFrame(), 3400);
  assert.ok(e4.some((e) => e.type === 'vehicle_exited'));
});

test('TelemetryState: shared snapshot drops force feedback and balance', () => {
  const s = new TelemetryState();
  s.applyFrame({ ...actorFrame(), force_feedback: { gunfire: 1 } }, 0);
  const snap = s.buildSharedSnapshot({}, 10);
  assert.equal(snap.force_feedback, undefined);
  assert.equal(snap.actor.state.uec_balance, undefined);
  assert.equal(s.buildSharedSnapshot({ includeBalance: true }, 10).actor.state.uec_balance, 125000);
  assert.ok(flatten(snap).some(([k]) => k === 'actor.vitals.heart_rate'));
});

test('TelemetryService against a fake game gRPC server', async () => {
  const frames = [
    actorFrame(),
    { ...actorFrame(), ...vehicleFrame() },
    { weapons: { preset_name: 'All', countermeasures: [{ type: 'COUNTERMEASURE_TYPE_DECOY', amount: 10 }] } },
    { weapons: { preset_name: 'All', countermeasures: [{ type: 'COUNTERMEASURE_TYPE_DECOY', amount: 8 }] } },
    { events: { events: [{ type: 'GAME_EVENT_TYPE_ACTOR_SPAWN' }] } },
  ];
  const { port, server } = await startFakeGame(frames);
  const uploads: TelemetryUploadPayload[] = [];
  const svc = new TelemetryService({
    address: `127.0.0.1:${port}`,
    isSharingEnabled: () => true,
    upload: (p) => (uploads.push(p), true),
    snapshotIntervalMs: 50,
    eventFlushMs: 20,
  });
  svc.start();
  await wait(600);
  assert.equal(svc.status, 'streaming');
  assert.equal(svc.state.frames, frames.length);
  const types = svc.recentEvents.map((e) => e.type);
  for (const t of ['vehicle_entered', 'countermeasure_used', 'game_actor_spawn']) assert.ok(types.includes(t), `missing ${t} in ${types}`);
  const snaps = uploads.filter((u) => u.kind === 'snapshot');
  assert.ok(snaps.length >= 1, 'snapshot uploaded');
  assert.ok(uploads.some((u) => u.kind === 'events' && u.events.some((e) => e.type === 'vehicle_entered')));
  assert.ok(svc.recentEvents.every((e) => e.shared === true));
  // game closes → back to waiting, with a telemetry-lost event
  server.forceShutdown();
  await wait(300);
  assert.equal(svc.status, 'waiting_for_game');
  assert.ok(svc.recentEvents.some((e) => e.type === 'actor_telemetry_lost'));
  svc.stop();
});

test('TelemetryService: game not running stays quiet and keeps retrying', async () => {
  const logs: string[] = [];
  const svc = new TelemetryService({ address: '127.0.0.1:1', retryMs: [50], log: (lvl, m) => lvl !== 'debug' && logs.push(m) });
  svc.start();
  await wait(300);
  assert.equal(svc.status, 'waiting_for_game');
  assert.ok(svc.connectAttempts >= 2);
  assert.deepEqual(logs, []);
  svc.noteLogChunk('<2026-11-20T10:00:00.000Z> [Notice] <GameTelemetry> Local services server is running on 127.0.0.1:2943\n');
  assert.equal(svc.address, '127.0.0.1:2943');
  assert.equal(svc.logHints.serverAddress, '127.0.0.1:2943');
  svc.stop();
});

test('log signatures: variable parts are normalised and names redacted', () => {
  const a = lineSignature("<2025-06-29T11:42:46.937Z> [Notice] <Actor Death> CActor::Kill: 'Bob_123' [2001] in zone 'X' killed by 'LoVeRSaMa' [99] using 'GATS_S3' [Class X] [Team_ActorTech][Actor]", { redact: ['LoVeRSaMa'] })!;
  const b = lineSignature("<2025-07-01T01:00:00.000Z> [Notice] <Actor Death> CActor::Kill: 'Alice' [7] in zone 'Y' killed by 'Someone' [12] using 'Other' [Class Z] [Team_Renamed][Actor]")!;
  assert.equal(a.signature, b.signature);
  assert.equal(a.tag, 'Actor Death');
  const set1 = buildSignatureSet('<2025-01-01T00:00:00.000Z> [Notice] <A> one 1\n<2025-01-01T00:00:00.000Z> [Notice] <B> two\n');
  const set2 = buildSignatureSet('<2025-01-01T00:00:00.000Z> [Notice] <A> one 2\n<2025-01-01T00:00:00.000Z> [Notice] <C> three\n');
  const d = diffSignatureSets(set1, set2);
  assert.deepEqual(d.added.map((x) => x.tag), ['C']);
  assert.deepEqual(d.notSeen.map((x) => x.tag), ['B']);
  assert.equal(d.common, 1);
  assert.deepEqual(extractBuildInfo('<t> FileVersion: 5.0.202.205\n<t> BackupNameAttachment=" Build(13238477) x"\n'), { fileVersion: '5.0.202.205', build: '13238477', branch: undefined });
});
