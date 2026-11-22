/**
 * Telemetry + Game.log diff tests. Run with:  npm run test:telemetry
 * (bundled with esbuild, run with node's built-in test runner; no Electron needed)
 *
 * Starts a fake Star Citizen telemetry gRPC server built from the same embedded schema and
 * checks that TelemetryService connects, merges partial frames, derives events and uploads.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isMissingModuleError } from '../../electron/startup-guard.ts';
import * as grpc from '@grpc/grpc-js';
import { loadTelemetryRoot, TELEMETRY_PACKAGE, TELEMETRY_SERVICE } from '../../electron/modules/telemetry/telemetry-client';
import { TelemetryService, type TelemetryUploadPayload } from '../../electron/modules/telemetry/telemetry-service';
import { TelemetryState, flatten } from '../../electron/modules/telemetry/telemetry-state';
import { buildSignatureSet, diffSignatureSets, lineSignature, extractBuildInfo } from '../../electron/modules/log-diff/log-signature';
// Connection reliability + contextual feed events (same runner, one esbuild bundle)
import './server-link.test';
import './telemetry-events.test';

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
  const a = lineSignature("<2025-06-29T11:42:46.937Z> [Notice] <Actor Death> CActor::Kill: 'Bob_123' [2001] in zone 'X' killed by 'Player_One' [99] using 'GATS_S3' [Class X] [Team_ActorTech][Actor]", { redact: ['Player_One'] })!;
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

test('LogDiffTracker: baseline rotation and never comparing a log with itself', async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const { LogDiffTracker } = await import('../../electron/modules/log-diff/log-diff-tracker');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'logdiff-test-'));
  const ts = '<2026-11-20T10:00:00.000Z>';
  const logA = `${ts} BackupNameAttachment=" Build(100) x"\n${ts} Log started on Sun Nov 20 10:00:01 2026\n${ts} [Notice] <Actor Death> CActor::Kill: 'x' [1]\n${ts} [Notice] <Old Thing> gone soon\n`;
  const logB = `${ts} BackupNameAttachment=" Build(200) x"\n${ts} Log started on Sun Nov 21 11:00:01 2026\n${ts} [Notice] <Actor Death> CActor::Kill: 'y' [2]\n${ts} [Notice] <New Thing> hello\n`;
  const patterns = { kill: /CActor::Kill/, old: /<Old Thing>/ };
  const t1 = new LogDiffTracker({ storeDir: dir, patterns, minLinesToSave: 1 });
  await t1.beginLog('/x/Game.log');
  t1.addChunk(logA);
  await t1.beginLog('/x/Game.log'); // game restarted → A saved as baseline
  t1.addChunk(logB);
  await t1.idle();
  let r = t1.report();
  assert.equal(r.baseline?.build.build, '100');
  assert.deepEqual(r.added.map((e) => e.tag).sort(), ['New Thing']);
  assert.ok(r.notSeen.some((e) => e.tag === 'Old Thing'));
  assert.deepEqual(r.patterns.find((p) => p.name === 'old'), { name: 'old', current: 0, baseline: 1, status: 'lost' });
  await t1.finalize(); // app quit mid-session: B saved, A becomes previous
  // app restarts and re-reads the same Game.log (B): must compare with A, not B
  const t2 = new LogDiffTracker({ storeDir: dir, patterns, minLinesToSave: 1 });
  await t2.beginLog('/x/Game.log');
  t2.addChunk(logB);
  await t2.idle();
  r = t2.report();
  assert.equal(r.current.build.build, '200');
  assert.equal(r.baseline?.build.build, '100');
});

test('LogDiffTracker: chunks fed right after an un-awaited beginLog belong to the new log', async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const { LogDiffTracker } = await import('../../electron/modules/log-diff/log-diff-tracker');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'logdiff-race-'));
  const ts = '<2026-11-20T10:00:00.000Z>';
  const logA = `${ts} BackupNameAttachment=" Build(100) x"\n${ts} Log started on Sun Nov 20 10:00:01 2026\n${ts} [Notice] <Old Thing> a\n`;
  const logB = `${ts} BackupNameAttachment=" Build(200) x"\n${ts} Log started on Sun Nov 21 11:00:01 2026\n${ts} [Notice] <New Thing> b\n`;
  const t = new LogDiffTracker({ storeDir: dir, patterns: {}, minLinesToSave: 1 });
  void t.beginLog('/x/Game.log'); // exactly how log-watcher calls it
  t.addChunk(logA);
  void t.beginLog('/x/Game.log');
  t.addChunk(logB);
  await t.finalize();
  const r = t.report();
  assert.equal(r.current.build.build, '200');
  assert.equal(r.baseline?.build.build, '100', 'A is the baseline, B is never compared with itself');
  assert.deepEqual(r.added.map((e) => e.tag), ['New Thing']);
  const saved = JSON.parse(fs.readFileSync(path.join(dir, 'baseline.json'), 'utf8'));
  assert.equal(saved.build.build, '200');
});

// ---------------------------------------------------------------------------------------------
// Star Citizen channels
// ---------------------------------------------------------------------------------------------

async function mkRoot(layout: Record<string, string[]>, rootName = 'StarCitizen') {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-chan-'));
  const root = path.join(base, rootName);
  for (const [ch, files] of Object.entries(layout)) {
    fs.mkdirSync(path.join(root, ch), { recursive: true });
    for (const f of files) {
      const p = path.join(root, ch, f);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, f.endsWith('.log') ? 'x\n' : '');
    }
  }
  return { root, fs, path };
}

test('channels: discovery finds folders with Game.log / Bin64 / StarCitizen_Launcher, LIVE first', async () => {
  const { discoverChannels } = await import('../../electron/modules/game-channels');
  const { root } = await mkRoot({ PTU: ['Game.log'], LIVE: ['Game.log', 'user.cfg'], 'TECH-PREVIEW': ['Bin64/x.exe'], EPTU: ['StarCitizen_Launcher/a'], Junk: ['readme.txt'] });
  const list = await discoverChannels(root);
  assert.deepEqual(list.map((c) => c.name), ['LIVE', 'EPTU', 'PTU', 'TECH-PREVIEW']);
  assert.equal(list[0].hasLog, true);
  assert.equal(list[1].hasLog, false);
  assert.ok(list[0].userCfgPath.endsWith('user.cfg'));
  assert.deepEqual(await discoverChannels('/nonexistent/xyz'), []);
});

test('channels: migration derives the root from the old logFilePath (windows + posix), else single-file mode', async () => {
  const { migrateGameRoot, pathFor } = await import('../../electron/modules/game-channels');
  const { root, path } = await mkRoot({ LIVE: ['Game.log'], PTU: ['Game.log'] });
  assert.equal(await migrateGameRoot(path.join(root, 'LIVE', 'Game.log')), root);
  // non-standard layout: parent is not named like Star Citizen and the folder has no Bin64
  const odd = await mkRoot({ MyLogs: ['Game.log'] }, 'Games');
  assert.equal(await migrateGameRoot(odd.path.join(odd.root, 'MyLogs', 'Game.log')), null);
  // not a Game.log at all
  assert.equal(await migrateGameRoot(path.join(root, 'LIVE', 'other.txt')), null);
  // a Windows path is split on backslashes even on Linux
  const w = 'C:\\Program Files\\Roberts Space Industries\\StarCitizen\\LIVE\\Game.log';
  assert.equal(pathFor(w).dirname(pathFor(w).dirname(w)), 'C:\\Program Files\\Roberts Space Industries\\StarCitizen');
  assert.equal(await migrateGameRoot(w), 'C:\\Program Files\\Roberts Space Industries\\StarCitizen'); // root name matches even though it does not exist here
});

test('channels: picking a channel folder in the UI selects its parent as the root', async () => {
  const { normalizeRootSelection } = await import('../../electron/modules/game-channels');
  const { root, path } = await mkRoot({ LIVE: ['Game.log'], PTU: ['Game.log'] });
  const a = await normalizeRootSelection(path.join(root, 'PTU'));
  assert.equal(a.root, root);
  assert.equal(a.channels.length, 2);
  const b = await normalizeRootSelection(root);
  assert.equal(b.root, root);
  const odd = await mkRoot({ MyLogs: ['Game.log'] }, 'Games');
  const c = await normalizeRootSelection(odd.path.join(odd.root, 'MyLogs'));
  assert.equal(c.root, '');
  assert.ok(c.singleFile?.endsWith('Game.log'));
});

test('channels: ChannelTracker picks the newest log, switches only on a clearly newer write, respects the dwell time', async () => {
  const { ChannelTracker, discoverChannels } = await import('../../electron/modules/game-channels');
  const { root, fs, path } = await mkRoot({ LIVE: ['Game.log'], PTU: ['Game.log'] });
  const touch = (ch: string, ms: number) => fs.utimesSync(path.join(root, ch, 'Game.log'), ms / 1000, ms / 1000);
  let clock = 1_000_000_000_000;
  touch('LIVE', clock - 100_000);
  touch('PTU', clock - 500_000);
  const switches: string[] = [];
  const t = new ChannelTracker({ discover: () => discoverChannels(root), now: () => clock, dwellMs: 30_000, marginMs: 1000 });
  t.onActive((c, prev) => switches.push(`${prev}>${c.name}`));
  assert.equal((await t.poll({ force: true, emit: false }))?.name, 'LIVE'); // initial pick: silent
  assert.deepEqual(switches, []);
  // PTU written clearly later, but inside the dwell window after start: no switch... (initial pick does not start a dwell)
  clock += 5_000;
  touch('PTU', clock);
  await t.poll();
  assert.deepEqual(switches, ['LIVE>PTU']);
  assert.equal(t.active, 'PTU');
  // LIVE written again right away: dwell blocks flapping
  clock += 5_000;
  touch('LIVE', clock);
  await t.poll();
  assert.equal(t.active, 'PTU');
  // after the dwell time it may switch back
  clock += 60_000;
  touch('LIVE', clock);
  await t.poll();
  assert.deepEqual(switches, ['LIVE>PTU', 'PTU>LIVE']);
  // a write inside the margin is not a switch
  clock += 60_000;
  touch('LIVE', clock);
  touch('PTU', clock + 500);
  await t.poll();
  assert.equal(t.active, 'LIVE');
});

test('channels: a freshly installed channel shows up on the next scan; the active one is kept', async () => {
  const { ChannelTracker, discoverChannels } = await import('../../electron/modules/game-channels');
  const { root, fs, path } = await mkRoot({ LIVE: ['Game.log'] });
  const t = new ChannelTracker({ discover: () => discoverChannels(root) });
  const seen: string[][] = [];
  t.onChannels((c) => seen.push(c.map((x) => x.name)));
  await t.poll({ force: true });
  fs.mkdirSync(path.join(root, 'PTU', 'Bin64'), { recursive: true });
  await t.poll({ force: true });
  assert.deepEqual(t.channels.map((c) => c.name), ['LIVE', 'PTU']);
  assert.equal(t.active, 'LIVE'); // PTU has no Game.log yet
  assert.deepEqual(seen.at(-1), ['LIVE', 'PTU']);
});

// ---------------------------------------------------------------------------------------------
// Telemetry recorder
// ---------------------------------------------------------------------------------------------

async function recorderRig(opts: Record<string, any> = {}) {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const { EventEmitter } = await import('node:events');
  const { TelemetryRecorder } = await import('../../electron/modules/telemetry/telemetry-recorder');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-rec-'));
  let clock = Date.parse('2026-11-21T19:05:02.000Z');
  const state = new TelemetryState();
  const src: any = new EventEmitter();
  src.state = state;
  const ctx = { channel: 'LIVE', gameVersion: '4.10.200', gameBuild: '123' };
  const rec = new TelemetryRecorder({ dir, now: () => clock, getContext: () => ({ ...ctx }), schemaBuild: 'S1', clientVersion: 'C1', changeMs: 5, flushMs: 5, universe: ['actor.vitals.health.current', 'actor.vitals.heart_rate', 'vehicle.state.name'], ...opts });
  rec.attach(src);
  const frame = (f: any) => {
    const events = state.applyFrame(f, clock);
    for (const e of events) src.emit('event', e);
    src.emit('frame', f);
  };
  const status = (s: string) => {
    const prev = src.status ?? 'disabled';
    src.status = s;
    src.emit('status', s, prev);
  };
  const lines = async () => {
    await rec.flush();
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.log')).sort();
    return files.map((f) => ({ f, rows: fs.readFileSync(path.join(dir, f), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) }));
  };
  return { rec, src, state, dir, fs, path, ctx, frame, status, lines, tick: (ms: number) => (clock += ms), setClock: (v: number) => (clock = v) };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test('recorder: one file per session named <time>_<channel>_<version>.log, session_start .. session_end', async () => {
  const r = await recorderRig();
  r.status('streaming');
  r.frame({ actor: { vitals: { health: { current: 90, max: 100 }, heart_rate: 70 } } });
  r.status('waiting_for_game');
  const files = await r.lines();
  assert.equal(files.length, 1);
  assert.equal(files[0].f, '2026-11-21T19-05-02_LIVE_4.10.200.log');
  const kinds = files[0].rows.map((x: any) => x.kind);
  assert.equal(kinds[0], 'session_start');
  assert.equal(kinds.at(-1), 'session_end');
  assert.deepEqual(files[0].rows[0], { t: '2026-11-21T19:05:02.000Z', kind: 'session_start', channel: 'LIVE', gameVersion: '4.10.200', gameBuild: '123', schemaBuild: 'S1', clientVersion: 'C1' });
  const end = files[0].rows.at(-1);
  assert.equal(end.frames, 1);
  assert.equal(end.reason, 'status:waiting_for_game');
  // universe has 3 fields, health.current + heart_rate seen non-default, vehicle.state.name never
  assert.deepEqual(end.neverNonDefault, ['vehicle.state.name']);
  assert.equal(end.fieldsKnown, 3);
});

test('recorder: changes are field-level diffs, coalesced (many frames inside one tick = one line), removals recorded, force_feedback never', async () => {
  const r = await recorderRig({ changeMs: 20 });
  r.status('streaming');
  for (let hr = 70; hr < 80; hr++) r.frame({ actor: { vitals: { heart_rate: hr } }, force_feedback: { x: hr } });
  await sleep(60);
  r.frame({ actor: { vitals: { heart_rate: 80, health: { current: 50, max: 100 } } } });
  await sleep(60);
  const f = (await r.lines())[0].rows;
  const changes = f.filter((x: any) => x.kind === 'changes');
  assert.equal(changes.length, 2, 'ten frames collapsed into one line, then one more');
  assert.equal(changes[0].full, true);
  assert.deepEqual(changes[0].changes, { 'actor.vitals.heart_rate': [null, '79'] });
  assert.deepEqual(changes[1].changes, { 'actor.vitals.heart_rate': ['79', '80'], 'actor.vitals.health.current': [null, '50'], 'actor.vitals.health.max': [null, '100'] });
  assert.ok(!JSON.stringify(f).includes('force_feedback'));
  // section goes stale: its paths are recorded as removed
  r.tick(10_000);
  r.state.tick(Date.now() + 10_000);
  r.src.emit('frame', undefined);
  r.rec.sample();
  const rows = (await r.lines())[0].rows.filter((x: any) => x.kind === 'changes');
  assert.deepEqual(rows.at(-1).changes['actor.vitals.heart_rate'], ['80', null]);
  await r.rec.close();
});

test('recorder: changes are throttled to at most ~4 writes/s by default', async () => {
  const r = await recorderRig({ changeMs: 250 });
  r.status('streaming');
  const t0 = Date.now();
  let n = 0;
  while (Date.now() - t0 < 700) {
    r.frame({ actor: { vitals: { heart_rate: ++n } } });
    await sleep(10);
  }
  await sleep(300);
  const changes = (await r.lines())[0].rows.filter((x: any) => x.kind === 'changes');
  assert.ok(n > 40);
  assert.ok(changes.length >= 2 && changes.length <= 4, `got ${changes.length} change lines for ${n} frames`);
  await r.rec.close();
});

test('recorder: derived events and the game\'s own events are recorded', async () => {
  const r = await recorderRig();
  r.status('streaming');
  r.frame({ actor: { state: { locomotion: 'ACTOR_LOCOMOTION_STATE_ON_FOOT' } }, events: { events: [{ type: 'GAME_EVENT_TYPE_SPAWN' }] } });
  r.frame(vehicleFrame());
  const rows = (await r.lines())[0].rows;
  assert.ok(rows.some((x: any) => x.kind === 'game_event' && x.event.type === 'GAME_EVENT_TYPE_SPAWN'));
  assert.ok(rows.some((x: any) => x.kind === 'event' && x.type === 'vehicle_entered'));
  assert.ok(rows.some((x: any) => x.kind === 'status' && x.status === 'streaming'));
  await r.rec.close();
});

test('recorder: file is capped, then session_end still gets written; only the newest N files are kept', async () => {
  const r = await recorderRig({ maxFileBytes: 2000, keepFiles: 3, changeMs: 1 });
  r.status('streaming');
  for (let i = 0; i < 100; i++) {
    r.frame({ actor: { vitals: { heart_rate: i + 1 }, state: { uec_balance: String(i * 1000 + 1) } } });
    await sleep(2);
  }
  r.status('waiting_for_game');
  const rows = (await r.lines())[0].rows;
  const size = r.fs.statSync(r.path.join(r.dir, (await r.lines())[0].f)).size;
  assert.ok(size < 2000 + 1500, `file is bounded (${size} B)`);
  assert.ok(rows.some((x: any) => x.kind === 'truncated'));
  const end = rows.at(-1);
  assert.equal(end.kind, 'session_end');
  assert.equal(end.truncated, true);
  assert.ok(end.droppedLines > 0);
  // rotation: 5 sessions with keepFiles=3
  for (let i = 1; i <= 5; i++) {
    r.tick(60_000);
    r.status('streaming');
    r.frame({ actor: { vitals: { heart_rate: 70 + i } } });
    r.status('waiting_for_game');
    await r.rec.flush();
    await sleep(20);
  }
  const files = r.fs.readdirSync(r.dir).filter((f) => f.endsWith('.log')).sort();
  assert.equal(files.length, 3);
  assert.ok(files.at(-1)!.startsWith('2026-11-21T19-10-02'), files.join(','));
  await r.rec.flush();
});

test('recorder: a channel switch ends the session and the next one is named after the new channel; toggling off stops recording', async () => {
  let enabled = true;
  const r = await recorderRig({ isEnabled: () => enabled });
  r.status('streaming');
  r.frame({ actor: { vitals: { heart_rate: 70 } } });
  r.rec.endSession('channel_change'); // what noteLogBegin does when another Game.log starts
  r.ctx.channel = 'PTU';
  r.ctx.gameVersion = '5.0.1';
  r.tick(1000);
  r.frame({ actor: { vitals: { heart_rate: 71 } } }); // stream still running: a new file starts lazily
  r.tick(1000);
  enabled = false;
  r.frame({ actor: { vitals: { heart_rate: 72 } } });
  r.frame({ actor: { vitals: { heart_rate: 73 } } });
  const files = await r.lines();
  assert.deepEqual(files.map((f) => f.f), ['2026-11-21T19-05-02_LIVE_4.10.200.log', '2026-11-21T19-05-03_PTU_5.0.1.log']);
  assert.equal(files[0].rows.at(-1).reason, 'channel_change');
  assert.equal(files[1].rows.at(-1).reason, 'recording_off');
  assert.equal(r.rec.active, false);
});

test('recorder: field universe comes from the embedded schema (no force_feedback/events, repeated messages as [])', async () => {
  const { computeFieldUniverse } = await import('../../electron/modules/telemetry/telemetry-recorder');
  const u = computeFieldUniverse(root);
  assert.ok(u.length > 100, `${u.length} fields`);
  assert.ok(u.includes('actor.vitals.heart_rate'));
  assert.ok(u.every((p) => !p.startsWith('force_feedback') && !p.startsWith('events')));
  assert.ok(u.some((p) => p.includes('[]')));
});

test('recorder: raw game events with enum names, gameEventCounts incl. zeros, log_marker lines', async () => {
  const { computeGameEventTypes } = await import('../../electron/modules/telemetry/telemetry-recorder');
  const types = computeGameEventTypes(root);
  assert.ok(types.includes('GAME_EVENT_TYPE_ACTOR_DOWNED'));
  const r = await recorderRig({ gameEventTypes: types });
  r.rec.noteLogMarker('actor_dead', 'ignored: no session');
  r.status('streaming');
  r.frame({ events: { events: [{ type: 'GAME_EVENT_TYPE_ACTOR_DOWNED' }, { type: 'GAME_EVENT_TYPE_ACTOR_DOWNED' }] } });
  r.rec.noteLogMarker('actor_dead', '<2026> <[ActorState] Dead> ' + 'x'.repeat(300) + '\r\n');
  r.status('waiting_for_game');
  const rows = (await r.lines())[0].rows;
  const ge = rows.filter((x: any) => x.kind === 'game_event');
  assert.equal(ge.length, 2);
  assert.equal(ge[0].type, 'GAME_EVENT_TYPE_ACTOR_DOWNED');
  const m = rows.filter((x: any) => x.kind === 'log_marker');
  assert.equal(m.length, 1);
  assert.equal(m[0].line.length, 200);
  const end = rows.at(-1);
  assert.equal(end.gameEventCounts.GAME_EVENT_TYPE_ACTOR_DOWNED, 2);
  assert.equal(end.gameEventCounts.GAME_EVENT_TYPE_ACTOR_DEAD, 0);
  assert.equal(Object.keys(end.gameEventCounts).length, types.length);
});

test('recorder: version learned after the session started -> one file named with it; same-channel new log does not rotate an unnamed session', async () => {
  const r = await recorderRig({ flushMs: 5 });
  r.ctx.gameVersion = undefined as any;
  r.ctx.gameBuild = undefined as any;
  r.status('streaming');
  r.frame({ actor: { vitals: { heart_rate: 70 } } });
  await sleep(30);
  assert.equal(r.fs.readdirSync(r.dir).filter((f) => f.endsWith('.log')).length, 0, 'nothing written while the version is unknown');
  r.rec.onNewLog('LIVE'); // app start: the Game.log of the running game is read now
  assert.equal(r.rec.active, true);
  r.ctx.gameVersion = '4.10.200.58746';
  r.tick(1000);
  r.frame({ actor: { vitals: { heart_rate: 71 } } });
  await sleep(30);
  r.status('waiting_for_game');
  const files = await r.lines();
  assert.deepEqual(files.map((f) => f.f), ['2026-11-21T19-05-02_LIVE_4.10.200.58746.log']);
  assert.equal(files[0].rows[0].gameVersion, '4.10.200.58746');
  assert.equal(files[0].rows.filter((x: any) => x.kind === 'session_start').length, 1);
  assert.equal(files[0].rows.at(-1).frames, 2);
});

test('recorder: unknown version is only waited for ~10 s, then the file is named unknown', async () => {
  const r = await recorderRig({ flushMs: 5 });
  r.ctx.gameVersion = undefined as any;
  r.ctx.gameBuild = undefined as any;
  r.status('streaming');
  r.frame({ actor: { vitals: { heart_rate: 70 } } });
  r.tick(11_000);
  r.frame({ actor: { vitals: { heart_rate: 71 } } });
  await sleep(30);
  const names = r.fs.readdirSync(r.dir).filter((f) => f.endsWith('.log'));
  assert.deepEqual(names, ['2026-11-21T19-05-02_LIVE_unknown.log']);
  await r.rec.close();
});

test('TelemetryService: a silent stream is reopened on a fresh connection (old gRPC channel closed)', async () => {
  let opened = 0;
  let closed = 0;
  let cancelled = 0;
  const svc = new TelemetryService({
    address: 'fake',
    silenceMs: 150,
    retryMs: [20],
    log: () => {},
    clientFactory: () => ({
      openStream: () => {
        opened++;
        return { cancel: () => { cancelled++; } };
      },
      close: () => { closed++; },
    }),
  });
  svc.start();
  await new Promise((r) => setTimeout(r, 1300));
  await svc.stop();
  assert.ok(opened >= 2, `expected reopen, opened=${opened}`);
  // every silent reopen must close the previous channel, so the game never sees piled-up clients
  assert.ok(closed >= opened - 1, `opened=${opened} closed=${closed} cancelled=${cancelled}`);
});

test('startup guard: missing-module errors (mid-update launch) are recognised, other errors are not', () => {
  const real = Object.assign(new Error("Cannot find package 'undici' imported from C:\\x\\resources\\app\\dist-electron\\main.js"), { code: 'ERR_MODULE_NOT_FOUND' });
  assert.equal(isMissingModuleError(real), true);
  assert.equal(isMissingModuleError(Object.assign(new Error("Cannot find module 'bindings'"), { code: 'MODULE_NOT_FOUND' })), true);
  assert.equal(isMissingModuleError(new Error("Cannot find module './app-main-abc.js'")), true);
  assert.equal(isMissingModuleError(new TypeError('x is not a function')), false);
  assert.equal(isMissingModuleError(null), false);
});
