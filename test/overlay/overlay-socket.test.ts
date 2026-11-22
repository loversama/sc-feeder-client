/**
 * Party overlay feed end to end: the real socket.io-client + ServerLink against the fake /client
 * namespace (test/telemetry/fake-voidlog-server.ts). Run: npm run test:overlay
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { io } from 'socket.io-client';
import { ServerLink, makePrepareAuth, type LinkSocket } from '../../electron/modules/server-link';
import { PartyOverlayFeed, type PartyOverlayState } from '../../electron/modules/overlay/party-overlay-feed';
import { PARTY_OVERLAY_DEFAULTS } from '../../electron/modules/overlay/party-overlay-settings';
import { FakeVoidlogServer, makeToken } from '../telemetry/fake-voidlog-server';

const roster = JSON.parse(readFileSync('shared/overlay/overlay-vectors.json', 'utf8')).roster;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(cond: () => boolean, ms = 4000, what = 'condition') {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(10);
  }
}
const ack = (version: number) => ({
  ok: true,
  source: { scope: 'org', id: 'VOID', label: '[VOID]' },
  roster: { ...roster, generatedAt: 'ack' },
  layout: { scope: 'org', id: 'VOID', version, entries: [], shipsExpandedByDefault: true, updatedAt: null, updatedBy: null },
  party: null,
});

test('feed over a real socket: subscribe, pushes, server restart → re-subscribed automatically', async () => {
  const server = new FakeVoidlogServer();
  const port = await server.start();
  const subscribes: any[] = [];
  server.handlers.set('overlay_subscribe', (data) => {
    subscribes.push(data);
    return ack(subscribes.length);
  });
  const link = new ServerLink({
    url: `http://127.0.0.1:${port}/client`,
    path: '/socket.io/',
    io: (url, o) => io(url, o) as unknown as LinkSocket,
    prepareAuth: makePrepareAuth({
      getAccessToken: () => makeToken('u1', Date.now() + 3600_000),
      hasUserSession: () => true,
      refresh: async () => true,
      getGuestToken: () => null,
      clearGuestToken: () => undefined,
    }),
    reconnectDelays: [50, 100],
    reconnectJitterMs: 20,
    authTimeoutMs: 500,
    heartbeatMs: 200,
    ackTimeoutMs: 500,
    connectTimeoutMs: 1000,
  });
  const pushes: PartyOverlayState[] = [];
  const feed = new PartyOverlayFeed({
    link,
    getSettings: () => ({ ...PARTY_OVERLAY_DEFAULTS, partyOverlayEnabled: true, partyOverlayOrgTag: 'VOID' }),
    isSignedIn: () => true,
    push: (s) => pushes.push(s),
    minPushMs: 20,
  });
  try {
    link.start();
    await until(() => feed.current.status === 'live', 4000, 'live');
    assert.deepEqual(subscribes[0], { scope: 'org', tag: 'VOID' });
    server.emitAll('overlay_roster', { ...roster, generatedAt: 'pushed' });
    await until(() => feed.current.roster?.generatedAt === 'pushed', 2000, 'roster push');
    await until(() => pushes.at(-1)?.roster?.generatedAt === 'pushed', 2000, 'window push');

    await server.stop();
    await until(() => feed.current.status === 'connecting', 3000, 'connecting after drop');
    await server.start(port);
    await until(() => subscribes.length === 2 && feed.current.status === 'live', 6000, 're-subscribe');
    assert.equal(feed.current.layout?.version, 2);
  } finally {
    link.stop();
    await server.stop();
  }
});
