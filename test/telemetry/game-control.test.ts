/**
 * Game control tests (run via npm run test:telemetry): real TelemetryClient against a fake game
 * gRPC server implementing ListTriggerableActions + TriggerGameAction from the embedded schema.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as grpc from '@grpc/grpc-js';
import { loadTelemetryRoot, TelemetryClient, TELEMETRY_PACKAGE, TELEMETRY_SERVICE } from '../../electron/modules/telemetry/telemetry-client';
import { GameControl, mapGameStatus, type ControlClient } from '../../electron/modules/telemetry/game-control';
import { classifyAction, dangerInfo } from '../../electron/modules/telemetry/game-control-catalog';
import { HotkeyBinder, normalizeAccelerator, type ShortcutApi } from '../../electron/modules/telemetry/game-control-hotkeys';
import { isTrustedControlSender } from '../../electron/modules/telemetry/game-control-security';
import { enableCfgFlag, cfgFlag, TELEMETRY_CFG_KEY as TEL, TRIGGER_CFG_KEY as TRG } from '../../electron/modules/telemetry/user-cfg';
import { SAMPLE_ACTIONS as FIXTURE } from './fixtures/sample-actions';

// --- user.cfg edits (player's real game config) -----------------------------------------------

test('user.cfg: enable telemetry / game control keys safely', () => {
  // missing key → appended, existing lines untouched
  let r = enableCfgFlag('r_DisplayInfo = 2\n', TRG);
  assert.equal(r.changed, true);
  assert.equal(r.text, `r_DisplayInfo = 2\n${TRG}=1\n`);
  // no trailing newline + CRLF file keeps CRLF
  r = enableCfgFlag('a=1\r\nb=2', TEL);
  assert.equal(r.text, `a=1\r\nb=2\r\n${TEL}=1\r\n`);
  // =0 replaced in place, CRLF and other lines kept
  r = enableCfgFlag(`a=1\r\n  ${TRG} = 0\r\nb=2\r\n`, TRG);
  assert.equal(r.text, `a=1\r\n  ${TRG}=1\r\nb=2\r\n`);
  // already on → no-op
  r = enableCfgFlag(`${TRG}=1\n`, TRG);
  assert.equal(r.changed, false);
  // the two keys never match each other's lines
  const both = `${TEL}=1\n`;
  assert.equal(cfgFlag(both, TEL), true);
  assert.equal(cfgFlag(both, TRG), false);
  assert.equal(enableCfgFlag(both, TRG).text, `${TEL}=1\n${TRG}=1\n`);
  assert.equal(enableCfgFlag(`${TRG}=1\n`, TEL).text, `${TRG}=1\n${TEL}=1\n`);
  // a value on the next line is not read as this key's value
  assert.equal(cfgFlag(`${TEL}=\n1\n`, TEL), false);
  // empty / new file
  assert.equal(enableCfgFlag('', TEL).text, `${TEL}=1\n`);
});

const root = loadTelemetryRoot();
const T = (n: string) => root.lookupType(`${TELEMETRY_PACKAGE}.${n}`);

type FakeGame = { port: number; server: grpc.Server; received: any[]; listCalls: number; nextStatus: string | ((req: any) => string); close(): Promise<void> };

function unaryDef(name: string) {
  const req = T(`${name}Request`);
  const res = T(`${name}Response`);
  return {
    path: `/${TELEMETRY_SERVICE}/${name}`,
    requestStream: false,
    responseStream: false,
    requestSerialize: (o: any) => Buffer.from(req.encode(req.fromObject(o)).finish()),
    // Decode exactly as the game would see it (snake_case field names, defaults included).
    requestDeserialize: (b: Buffer) => req.toObject(req.decode(b), { defaults: true }),
    responseSerialize: (o: any) => Buffer.from(res.encode(res.fromObject(o)).finish()),
    responseDeserialize: (b: Buffer) => res.toObject(res.decode(b)),
  };
}

function startFakeGame(actions: any[] = FIXTURE as any[]): Promise<FakeGame> {
  const server = new grpc.Server();
  const fake: FakeGame = {
    port: 0,
    server,
    received: [],
    listCalls: 0,
    nextStatus: 'TRIGGER_GAME_ACTION_STATUS_OK',
    close: () => new Promise((r) => server.tryShutdown(() => r())),
  };
  server.addService(
    { ListTriggerableActions: unaryDef('ListTriggerableActions'), TriggerGameAction: unaryDef('TriggerGameAction') } as any,
    {
      ListTriggerableActions: (_call: any, cb: grpc.sendUnaryData<any>) => {
        fake.listCalls++;
        cb(null, { actions });
      },
      TriggerGameAction: (call: any, cb: grpc.sendUnaryData<any>) => {
        fake.received.push(call.request);
        const status = typeof fake.nextStatus === 'function' ? fake.nextStatus(call.request) : fake.nextStatus;
        cb(null, { status, message: status.endsWith('OK') ? '' : 'nope' });
      },
    },
  );
  return new Promise((resolve, reject) =>
    server.bindAsync('127.0.0.1:0', grpc.ServerCredentials.createInsecure(), (err, port) => {
      if (err) return reject(err);
      fake.port = port;
      resolve(fake);
    }),
  );
}

/** Manual clock so hold/rate tests are deterministic. */
function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

function makeControl(client: ControlClient, c = clock(), enabled = { v: true }) {
  return new GameControl({ getClient: () => client, isEnabled: () => enabled.v, now: c.now });
}

// --- TelemetryClient wire format ------------------------------------------------------------

test('game control: client lists actions and sends action_name / hold_ms on the wire', async () => {
  const game = await startFakeGame();
  const client = new TelemetryClient(`127.0.0.1:${game.port}`);
  try {
    const list = await client.listActions();
    assert.equal(list.length, FIXTURE.length);
    assert.ok(list.find((a) => a.name === 'v_invoke_ping' && a.holdable));
    const r = await client.triggerAction('v_toggle_landing_system');
    assert.equal(r.status, 'TRIGGER_GAME_ACTION_STATUS_OK');
    await client.triggerAction('v_invoke_ping', 750);
    assert.equal(game.received[0].action_name, 'v_toggle_landing_system');
    assert.equal(game.received[0].hold_ms ?? 0, 0, 'no hold_ms for a press');
    assert.equal(game.received[1].action_name, 'v_invoke_ping');
    assert.equal(game.received[1].hold_ms, 750);
  } finally {
    client.close();
    await game.close();
  }
});

// --- status mapping -------------------------------------------------------------------------

test('game control: every TriggerGameActionStatus maps to a code and message', async () => {
  const statuses: Record<string, string> = {
    TRIGGER_GAME_ACTION_STATUS_OK: 'OK',
    TRIGGER_GAME_ACTION_STATUS_FAILED: 'FAILED',
    TRIGGER_GAME_ACTION_STATUS_FILTERED: 'FILTERED',
    TRIGGER_GAME_ACTION_STATUS_UNKNOWN_ACTION: 'UNKNOWN_ACTION',
    TRIGGER_GAME_ACTION_STATUS_RATE_LIMITED: 'RATE_LIMITED',
    TRIGGER_GAME_ACTION_STATUS_MAP_INACTIVE: 'MAP_INACTIVE',
    TRIGGER_GAME_ACTION_STATUS_HOLD_NOT_ALLOWED: 'HOLD_NOT_ALLOWED',
    TRIGGER_GAME_ACTION_STATUS_UNSPECIFIED: 'UNSPECIFIED',
  };
  // Every enum value in the schema is covered.
  const enumValues = Object.keys((root.lookupEnum(`${TELEMETRY_PACKAGE}.TriggerGameActionStatus`) as any).values);
  assert.deepEqual(enumValues.sort(), Object.keys(statuses).sort());
  assert.equal(mapGameStatus('SOMETHING_NEW'), 'UNSPECIFIED');
  assert.equal(mapGameStatus(7), 'FILTERED');

  const game = await startFakeGame();
  const client = new TelemetryClient(`127.0.0.1:${game.port}`);
  const c = clock();
  const gc = makeControl(client, c);
  try {
    for (const [wire, code] of Object.entries(statuses)) {
      game.nextStatus = wire;
      c.advance(5000);
      const r = await gc.trigger('v_lights');
      assert.equal(r.code, code, wire);
      assert.equal(r.ok, code === 'OK');
      assert.equal(r.sent, true);
      assert.ok(r.message.length > 3);
    }
    assert.equal(gc.history().length, 8);
  } finally {
    client.close();
    await game.close();
  }
});

// --- unknown actions / invalid input ---------------------------------------------------------

test('game control: unknown and invalid actions never reach the game', async () => {
  const game = await startFakeGame();
  const client = new TelemetryClient(`127.0.0.1:${game.port}`);
  const gc = makeControl(client);
  try {
    const r = await gc.trigger('v_make_coffee');
    assert.equal(r.code, 'UNKNOWN_ACTION');
    assert.equal(r.sent, false);
    assert.equal(game.listCalls, 1, 'list loaded lazily once');
    assert.equal((await gc.trigger('v_lights; rm -rf')).code, 'INVALID');
    assert.equal((await gc.trigger(42 as any)).code, 'INVALID');
    assert.equal(game.received.length, 0);
  } finally {
    client.close();
    await game.close();
  }
});

test('game control: hold_ms only for holdable actions', async () => {
  const sent: Array<[string, number]> = [];
  const fake: ControlClient = {
    listActions: async () => FIXTURE.map((a: any) => ({ name: a.action_name, category: a.category, holdable: !!a.holdable })),
    triggerAction: async (n, h) => (sent.push([n, h]), { status: 'TRIGGER_GAME_ACTION_STATUS_OK', message: '' }),
  };
  const c = clock();
  const gc = makeControl(fake, c);
  assert.equal((await gc.trigger('v_lights', { holdMs: 500 })).code, 'HOLD_NOT_ALLOWED');
  assert.equal(sent.length, 0);
  assert.equal((await gc.trigger('v_invoke_ping', { holdMs: 99_999 })).code, 'OK');
  assert.deepEqual(sent[0], ['v_invoke_ping', 5000], 'clamped to MAX_HOLD_MS');
  assert.equal((await gc.trigger('v_invoke_ping', { holdMs: -1 })).code, 'INVALID');
});

// --- disabled / transport errors ------------------------------------------------------------

test('game control: off by default does nothing; unreachable game is reported, never retried', async () => {
  let calls = 0;
  const err = Object.assign(new Error('14 UNAVAILABLE: No connection established'), { code: 14 });
  const fake: ControlClient = {
    listActions: async () => [{ name: 'v_lights', category: 'lights_controller', holdable: false }],
    triggerAction: async () => {
      calls++;
      throw err;
    },
  };
  const enabled = { v: false };
  const gc = makeControl(fake, clock(), enabled);
  assert.equal((await gc.trigger('v_lights')).code, 'DISABLED');
  assert.equal(gc.arm('v_self_destruct').ok, false);
  enabled.v = true;
  const r = await gc.trigger('v_lights');
  assert.equal(r.code, 'GAME_UNREACHABLE');
  assert.equal(calls, 1, 'no automatic retry');
  assert.equal(gc.state().loaded, false, 'cache dropped when the game goes away');

  const timeout: ControlClient = {
    listActions: fake.listActions,
    triggerAction: async () => {
      calls++;
      throw Object.assign(new Error('deadline'), { code: 4 });
    },
  };
  const gc2 = makeControl(timeout);
  calls = 0;
  const t = await gc2.trigger('v_lights');
  assert.equal(t.code, 'TIMEOUT');
  assert.match(t.message, /not retried/);
  assert.equal(calls, 1);

  const down: ControlClient = { listActions: async () => Promise.reject(err), triggerAction: fake.triggerAction };
  assert.equal((await makeControl(down).trigger('v_lights')).code, 'GAME_UNREACHABLE');
});

// --- rate limit -----------------------------------------------------------------------------

test('game control: client-side rate limit (gap, per-action cooldown, burst cap)', async () => {
  let sent = 0;
  const fake: ControlClient = {
    listActions: async () => FIXTURE.map((a: any) => ({ name: a.action_name, category: a.category, holdable: !!a.holdable })),
    triggerAction: async () => (sent++, { status: 'TRIGGER_GAME_ACTION_STATUS_OK', message: '' }),
  };
  const c = clock();
  const gc = makeControl(fake, c);
  assert.equal((await gc.trigger('v_lights')).code, 'OK');
  const fast = await gc.trigger('mobiglas');
  assert.equal(fast.code, 'LOCAL_RATE_LIMITED');
  assert.ok(fast.retryAfterMs! > 0 && fast.retryAfterMs! <= 200);
  c.advance(250);
  assert.equal((await gc.trigger('mobiglas')).code, 'OK');
  assert.equal((await gc.trigger('v_lights')).code, 'LOCAL_RATE_LIMITED', 'same action within cooldown');
  c.advance(700);
  assert.equal((await gc.trigger('v_lights')).code, 'OK');
  // burst: 10 per 10 s
  const names = FIXTURE.map((a: any) => a.action_name).filter((n: string) => !dangerInfo(n).dangerous && n !== 'v_lights' && n !== 'mobiglas' && n !== 'emote_wave');
  let limited = 0;
  for (let i = 0; i < 12; i++) {
    c.advance(250);
    if ((await gc.trigger(names[i])).code === 'LOCAL_RATE_LIMITED') limited++;
  }
  assert.ok(limited >= 3, `burst cap hit (${limited})`);
  assert.equal(sent, 10);
  c.advance(10_000);
  assert.equal((await gc.trigger('emote_wave')).code, 'OK');
});

// --- dangerous action confirmation ------------------------------------------------------------

test('game control: dangerous actions require an armed, held, single-use confirmation', async () => {
  const sent: string[] = [];
  const fake: ControlClient = {
    listActions: async () => FIXTURE.map((a: any) => ({ name: a.action_name, category: a.category, holdable: !!a.holdable })),
    triggerAction: async (n) => (sent.push(n), { status: 'TRIGGER_GAME_ACTION_STATUS_OK', message: '' }),
  };
  const c = clock();
  const gc = makeControl(fake, c);
  await gc.refresh();
  for (const n of ['v_self_destruct', 'v_eject', 'v_emergency_exit', 'v_power_set_off', 'v_power_toggle']) {
    assert.equal(gc.getAction(n)?.dangerous, true, n);
  }
  assert.equal((await gc.trigger('v_self_destruct')).code, 'CONFIRM_REQUIRED');
  assert.equal((await gc.trigger('v_self_destruct', { confirmToken: 'forged' })).code, 'CONFIRM_REQUIRED');

  const arm = gc.arm('v_self_destruct');
  assert.ok(arm.ok);
  if (!arm.ok) return;
  // released too early
  c.advance(300);
  const early = await gc.trigger('v_self_destruct', { confirmToken: arm.token });
  assert.equal(early.code, 'CONFIRM_REQUIRED');
  // token for another action can't be reused
  c.advance(1000);
  assert.equal((await gc.trigger('v_eject', { confirmToken: arm.token })).code, 'CONFIRM_REQUIRED');
  // held long enough
  assert.equal((await gc.trigger('v_self_destruct', { confirmToken: arm.token })).code, 'OK');
  // single use
  c.advance(5000);
  assert.equal((await gc.trigger('v_self_destruct', { confirmToken: arm.token })).code, 'CONFIRM_REQUIRED');
  // expired token
  const arm2 = gc.arm('v_eject');
  c.advance(11_000);
  assert.equal((await gc.trigger('v_eject', { confirmToken: arm2.ok ? arm2.token : '' })).code, 'CONFIRM_REQUIRED');
  // never from a hotkey, even with a token
  const arm3 = gc.arm('v_eject');
  c.advance(1500);
  assert.equal((await gc.trigger('v_eject', { confirmToken: arm3.ok ? arm3.token : '', source: 'hotkey' })).code, 'CONFIRM_REQUIRED');
  assert.deepEqual(sent, ['v_self_destruct']);
  // a rate-limited confirmed press does not burn the token
  const arm4 = gc.arm('v_eject');
  c.advance(1300);
  await gc.trigger('v_lights');
  assert.equal((await gc.trigger('v_eject', { confirmToken: arm4.ok ? arm4.token : '' })).code, 'LOCAL_RATE_LIMITED');
  c.advance(300);
  assert.equal((await gc.trigger('v_eject', { confirmToken: arm4.ok ? arm4.token : '' })).code, 'OK');
});

test('game control: catalog groups the sample list and flags look-alike dangerous names', () => {
  const all = FIXTURE.map((a: any) => classifyAction({ name: a.action_name, category: a.category, holdable: a.holdable }));
  const by = (g: string) => all.filter((a) => a.group === g).map((a) => a.name);
  assert.ok(by('flight').includes('v_master_mode_set_scm'));
  assert.ok(by('flight').includes('v_toggle_qdrive_engagement'));
  assert.ok(by('doors').includes('v_toggle_landing_system'));
  assert.ok(by('doors').includes('v_lock_all_doors'));
  assert.ok(by('power').includes('v_power_toggle_shields'));
  assert.ok(by('combat').includes('v_invoke_ping'));
  assert.ok(by('utility').includes('v_lights'));
  assert.equal(by('emotes').length, 6);
  assert.deepEqual(by('emergency').sort(), ['v_eject', 'v_emergency_exit', 'v_self_destruct']);
  assert.equal(all.filter((a) => a.dangerous).length, 5);
  assert.equal(dangerInfo('v_ship_self_destruct_v2').dangerous, true);
  assert.equal(dangerInfo('v_seat_eject_all').dangerous, true);
  assert.equal(dangerInfo('v_power_toggle_shields').dangerous, false);
  assert.equal(classifyAction({ name: 'v_new_thing', category: 'brand_new' }).group, 'utility');
});

// --- hotkeys --------------------------------------------------------------------------------

function fakeShortcuts(taken: string[] = []) {
  const reg = new Map<string, () => void>();
  const api: ShortcutApi = {
    register: (a, cb) => {
      if (taken.includes(a) || reg.has(a)) return false;
      reg.set(a, cb);
      return true;
    },
    unregister: (a) => void reg.delete(a),
  };
  return { api, reg };
}

test('game control: hotkey normalization and conflict detection', () => {
  assert.equal(normalizeAccelerator('ctrl+shift+g'), 'CommandOrControl+Shift+G');
  assert.equal(normalizeAccelerator('Shift+Control+g'), 'CommandOrControl+Shift+G');
  assert.equal(normalizeAccelerator('Alt+f13'), 'Alt+F13');
  assert.equal(normalizeAccelerator('Ctrl+G+H'), null);
  assert.equal(normalizeAccelerator('Ctrl+Banana'), null);

  const { api, reg } = fakeShortcuts(['CommandOrControl+Alt+K']);
  const fired: string[] = [];
  const hk = new HotkeyBinder({
    api,
    reserved: () => ['CommandOrControl+Alt+O'],
    isDangerous: (a) => dangerInfo(a).dangerous,
    onFire: (a) => fired.push(a),
  });
  hk.setBindings({
    v_toggle_landing_system: 'Ctrl+Alt+G',
    v_lights: 'ctrl+alt+g', // duplicate after normalisation
    mobiglas: 'G', // no modifier
    v_starmap: 'Ctrl+Alt+O', // overlay hotkey
    v_self_destruct: 'Ctrl+Alt+D', // dangerous
    visor_wipe: 'Ctrl+Alt+K', // held by another app
    v_master_mode_set_scm: 'F14', // F13–F24 allowed bare
    v_master_mode_set_nav: 'Ctrl+Shift+N',
  });
  assert.equal(reg.size, 0, 'nothing registered until active');
  const st = Object.fromEntries(hk.activate().map((s) => [s.action, s]));
  assert.equal(st.v_toggle_landing_system.problem, 'duplicate');
  assert.equal(st.v_lights.problem, 'duplicate');
  assert.equal(st.mobiglas.problem, 'no-modifier');
  assert.equal(st.v_starmap.problem, 'overlay');
  assert.equal(st.v_self_destruct.problem, 'dangerous');
  assert.equal(st.visor_wipe.problem, 'in-use');
  assert.equal(st.v_master_mode_set_scm.registered, true);
  assert.equal(st.v_master_mode_set_nav.registered, true);
  assert.deepEqual([...reg.keys()].sort(), ['CommandOrControl+Shift+N', 'F14']);
  reg.get('F14')!();
  assert.deepEqual(fired, ['v_master_mode_set_scm']);
  assert.equal(hk.check('v_lights', 'Ctrl+Shift+N'), 'duplicate');
  assert.equal(hk.check('v_lights', 'Ctrl+Shift+L'), null);
  hk.deactivate();
  assert.equal(reg.size, 0, 'only our own keys are released');
});

// --- IPC sender check -----------------------------------------------------------------------

test('game control: IPC only from the app\'s own top-level pages', () => {
  const policy = { trustedWebContentsIds: [1, 2], appFileRoot: 'file:///C:/Program%20Files/VOIDLOG/resources/app.asar/dist/', devServerUrl: null };
  const ok = (frameUrl: string, id = 1, isMainFrame = true) => isTrustedControlSender({ webContentsId: id, frameUrl, isMainFrame }, policy);
  assert.equal(ok('file:///C:/Program%20Files/VOIDLOG/resources/app.asar/dist/index.html#/'), true);
  assert.equal(ok('file:///c:/program files/voidlog/resources/app.asar/dist/settings.html'), true);
  assert.equal(ok('https://voidlog.gg/profile'), false, 'remote site in a hosted view');
  assert.equal(ok('file:///C:/Program%20Files/VOIDLOG/resources/app.asar/dist/index.html', 3), false, 'untrusted webContents (webview / overlay)');
  assert.equal(ok('file:///C:/Program%20Files/VOIDLOG/resources/app.asar/dist/index.html', 1, false), false, 'subframe');
  assert.equal(ok('file:///C:/Users/x/Downloads/evil.html'), false);
  assert.equal(ok('file:///C:/Program%20Files/VOIDLOG/resources/app.asar/dist/../../evil.html'), false);
  assert.equal(ok('data:text/html,hi'), false);
  assert.equal(ok(''), false);
  const dev = { trustedWebContentsIds: [1], appFileRoot: null, devServerUrl: 'http://localhost:5173/' };
  assert.equal(isTrustedControlSender({ webContentsId: 1, frameUrl: 'http://localhost:5173/index.html', isMainFrame: true }, dev), true);
  assert.equal(isTrustedControlSender({ webContentsId: 1, frameUrl: 'http://localhost:5174/', isMainFrame: true }, dev), false);
});
