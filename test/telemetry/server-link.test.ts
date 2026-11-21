/**
 * Connection reliability tests: the real socket.io-client against a fake VOIDLOG.GG /client
 * namespace (fake-voidlog-server.ts), plus TelemetryService riding on top of it.
 *
 * Reproduces the "telemetry stops after a server restart until VOIDLOG is restarted" bug:
 * the client came back with an expired access token, the server left the socket unauthenticated,
 * and the client treated it as authenticated, so every upload was silently rejected.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { io } from 'socket.io-client';
import { ServerLink, makePrepareAuth, jwtExpiresAt, type LinkSocket } from '../../electron/modules/server-link';
import { TelemetryService } from '../../electron/modules/telemetry/telemetry-service';
import { FakeVoidlogServer, makeToken } from './fake-voidlog-server';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(cond: () => boolean, ms = 4000, what = 'condition'): Promise<void> {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await wait(10);
  }
}

/** Auth like auth-manager: refresh only works while the server is up. */
function fakeAuth(server: FakeVoidlogServer, opts: { accessTtlMs?: number } = {}) {
  const a = {
    access: makeToken('u1', Date.now() + (opts.accessTtlMs ?? 3600_000)) as string | null,
    refreshes: 0,
    serverUp: true,
    guest: null as string | null,
  };
  const prepareAuth = makePrepareAuth({
    getAccessToken: () => a.access,
    hasUserSession: () => true,
    refresh: async () => {
      a.refreshes++;
      await wait(5);
      if (!a.serverUp) return false; // network error / 502 while the server restarts: tokens kept
      a.access = makeToken('u1', Date.now() + 3600_000);
      return true;
    },
    getGuestToken: () => a.guest,
    clearGuestToken: () => (a.guest = null),
  });
  return { a, prepareAuth, server };
}

function makeLink(port: number, prepareAuth: ReturnType<typeof makePrepareAuth>, extra: Partial<ConstructorParameters<typeof ServerLink>[0]> = {}) {
  const logs: string[] = [];
  const link = new ServerLink({
    url: `http://127.0.0.1:${port}/client`,
    path: '/socket.io/',
    io: (url, o) => io(url, o) as unknown as LinkSocket,
    prepareAuth,
    reconnectDelays: [50, 100, 150],
    reconnectJitterMs: 50,
    authTimeoutMs: 300,
    heartbeatMs: 200,
    ackTimeoutMs: 300,
    maxAckFailures: 3,
    connectTimeoutMs: 1000,
    log: (_l, m) => logs.push(m),
    ...extra,
  });
  return { link, logs };
}

test('jwtExpiresAt reads exp, 0 for garbage', () => {
  const t = makeToken('x', 1_800_000_000_000);
  assert.equal(jwtExpiresAt(t), 1_800_000_000_000);
  assert.equal(jwtExpiresAt('nope'), 0);
  assert.equal(jwtExpiresAt(null), 0);
});

test('ServerLink: server restart with an access token that expired meanwhile → refresh first, re-auth, uploads resume', async () => {
  const server = new FakeVoidlogServer();
  const port = await server.start();
  const { a, prepareAuth } = fakeAuth(server);
  const { link } = makeLink(port, prepareAuth);
  let authEvents = 0;
  link.on('authenticated', () => authEvents++);
  link.start();
  await until(() => link.authenticated, 3000, 'first auth');
  assert.ok(link.sendWithAck('submit_telemetry', { kind: 'snapshot', n: 1 }));
  await until(() => server.telemetry.length === 1, 2000, 'first upload');

  // Server goes away (OOM kill / redeploy); while it is down the 15-min access token expires
  // and refresh calls fail like they do against Cloudflare/NPM 502s.
  a.serverUp = false;
  await server.stop();
  await until(() => !link.authenticated, 2000, 'disconnect noticed');
  a.access = makeToken('u1', Date.now() - 1000);
  assert.equal(link.sendWithAck('submit_telemetry', { kind: 'snapshot', n: 2 }), false, 'no uploads while down');
  await wait(400); // several reconnect attempts while down

  a.serverUp = true;
  await server.start(port);
  await until(() => link.authenticated, 4000, 're-auth after restart');
  assert.equal(authEvents, 2);
  assert.ok(server.handshakes.every((h) => h.valid), `never handshake with an expired token: ${JSON.stringify(server.handshakes.map((h) => h.valid))}`);
  assert.ok(link.sendWithAck('submit_telemetry', { kind: 'snapshot', n: 3 }));
  await until(() => server.telemetry.some((t) => t.n === 3), 2000, 'upload after restart');
  link.stop();
  await server.stop();
});

test('ServerLink: a socket the server never authenticates is NOT treated as authenticated; credentials are refreshed', async () => {
  const server = new FakeVoidlogServer();
  const port = await server.start();
  const { a, prepareAuth } = fakeAuth(server);
  // Clock skew / revoked session: the client believes its token is valid, the server does not.
  a.access = 'x.not-a-valid-token.sig';
  const pa: typeof prepareAuth = (force) => (force ? prepareAuth(true) : Promise.resolve({ ok: true, token: a.access!, kind: 'user' }));
  const { link } = makeLink(port, pa);
  link.start();
  await until(() => server.handshakes.length === 1, 2000, 'handshake');
  await wait(150);
  assert.equal(link.authenticated, false, 'never authenticated without the server saying so');
  assert.equal(link.sendWithAck('submit_telemetry', { kind: 'snapshot' }), false, 'no uploads into a dead socket');
  await until(() => link.authenticated, 3000, 'recovered with a refreshed token');
  assert.equal(link.stats.authTimeouts, 1);
  assert.equal(a.refreshes, 1);
  assert.deepEqual(server.handshakes.map((h) => h.valid), [false, true]);
  link.stop();
  await server.stop();
});

test('ServerLink: uploads that stop being acknowledged trigger re-authentication', async () => {
  const server = new FakeVoidlogServer();
  const port = await server.start();
  const { a, prepareAuth } = fakeAuth(server);
  const { link } = makeLink(port, prepareAuth);
  link.start();
  await until(() => link.authenticated, 3000, 'auth');
  server.rejectUploads = true; // server lost our session: guard rejects, no acks
  for (let i = 0; i < 6; i++) {
    link.sendWithAck('submit_telemetry', { kind: 'snapshot', i });
    await wait(120);
  }
  server.rejectUploads = false;
  await until(() => link.stats.reauths >= 1, 3000, 're-auth');
  await until(() => link.authenticated, 3000, 'authenticated again');
  assert.ok(a.refreshes >= 1, 'forced refresh');
  assert.ok(link.sendWithAck('submit_telemetry', { kind: 'snapshot', i: 99 }));
  await until(() => server.telemetry.some((t) => t.i === 99), 2000, 'upload accepted again');
  link.stop();
  await server.stop();
});

test('ServerLink: refresh failing while the server is down does not connect with the stale token nor fall back to guest', async () => {
  const server = new FakeVoidlogServer();
  const port = await server.start();
  await server.stop(); // nothing listening yet
  const { a, prepareAuth } = fakeAuth(server, { accessTtlMs: 10_000 }); // expires within the refresh window
  a.serverUp = false;
  const { link, logs } = makeLink(port, prepareAuth);
  link.start();
  await wait(350);
  assert.equal(server.handshakes.length, 0);
  assert.ok(a.refreshes >= 2, 'keeps retrying the refresh');
  assert.ok(logs.some((l) => /refresh failed/.test(l)));
  a.serverUp = true;
  await server.start(port);
  await until(() => link.authenticated, 3000, 'connects once refresh works');
  assert.equal(server.handshakes.length, 1);
  assert.ok(server.handshakes[0].valid);
  link.stop();
  await server.stop();
});

test('ServerLink: guest without token gets a guest token and reconnects with it; old socket handlers never leak', async () => {
  const server = new FakeVoidlogServer();
  const port = await server.start();
  let guest: string | null = null;
  const prepareAuth = makePrepareAuth({
    getAccessToken: () => null,
    hasUserSession: () => false,
    refresh: async () => false,
    getGuestToken: () => guest,
    clearGuestToken: () => (guest = null),
  });
  const { link } = makeLink(port, prepareAuth, { onGuestToken: (t) => (guest = t) });
  let auths = 0;
  link.on('authenticated', () => auths++);
  link.start();
  await until(() => link.authenticated, 3000, 'guest auth');
  assert.equal(auths, 1);
  assert.equal(server.handshakes[0].token, undefined);
  assert.ok(server.handshakes[1].valid);
  await wait(200);
  assert.equal(server.openSockets, 1, 'the token-less socket was closed');
  link.stop();
  await server.stop();
});

test('TelemetryService + ServerLink: snapshots and feed events resume after a server restart, no app restart', async () => {
  const server = new FakeVoidlogServer();
  const port = await server.start();
  const { a, prepareAuth } = fakeAuth(server);
  const { link } = makeLink(port, prepareAuth);

  // Game side: a fake telemetry stream driven by hand.
  let onFrame: ((f: any, b: number) => void) | null = null;
  const svc = new TelemetryService({
    address: 'fake',
    clientId: () => 'client-1',
    isSharingEnabled: () => true,
    upload: (p) => link.sendWithAck('submit_telemetry', { clientId: 'client-1', ...p }),
    snapshotIntervalMs: 40,
    heartbeatMs: 10_000,
    eventFlushMs: 20,
    silenceMs: 60_000,
    clientFactory: () => ({
      openStream: (f) => {
        onFrame = f;
        return { cancel: () => {} };
      },
      close: () => {},
    }),
  });
  link.on('authenticated', () => svc.resync());
  link.start();
  svc.start();
  const actor = (hp: number | null) => ({ actor: { vitals: { health: hp === null ? { max: 100 } : { current: hp, max: 100 } }, state: { locomotion: 'ACTOR_LOCOMOTION_STATE_ON_FOOT' } } });
  await until(() => link.authenticated && !!onFrame, 3000, 'link + stream');
  onFrame!(actor(100), 10);
  await until(() => server.telemetry.some((t) => t.kind === 'snapshot'), 2000, 'first snapshot');

  // Server dies; the player goes down and dies meanwhile.
  a.serverUp = false;
  await server.stop();
  await until(() => !link.authenticated, 2000, 'link lost');
  const before = server.telemetry.length;
  onFrame!({ ...actor(null), events: { events: [{ type: 'GAME_EVENT_TYPE_ACTOR_DOWNED' }] } }, 10);
  onFrame!({ ...actor(null), events: { events: [{ type: 'GAME_EVENT_TYPE_ACTOR_DEAD' }] } }, 10);
  await wait(150);
  assert.ok(svc.retainedFeedEvents.some((e) => e.type === 'player_dead'), 'feed events held while offline');

  a.serverUp = true;
  await server.start(port);
  await until(() => link.authenticated, 4000, 're-auth');
  await until(() => server.telemetry.some((t) => t.kind === 'events' && t.events.some((e: any) => e.type === 'player_dead')), 2000, 'held feed events delivered');
  const snapsAfter = () => server.telemetry.slice(before).filter((t) => t.kind === 'snapshot').length;
  await until(() => snapsAfter() >= 1, 2000, 'snapshot right after re-auth (unchanged state, before the 10 s heartbeat)');
  const downed = server.telemetry.flatMap((t) => (t.kind === 'events' ? t.events : [])).find((e: any) => e.type === 'player_downed');
  assert.ok(downed?.feed && downed.category === 'combat' && downed.id.startsWith('tm_client-1_player_downed_'));
  // Downed with health gone from the frame must not produce a bogus "Health low (0%)".
  assert.ok(!svc.recentEvents.some((e) => e.type === 'low_health' || e.type === 'health_zero'));
  svc.stop();
  link.stop();
  await server.stop();
});
