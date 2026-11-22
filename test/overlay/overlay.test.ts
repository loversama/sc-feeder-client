/**
 * Party overlay: shared resolver vectors (same file as the server / website), display helpers,
 * settings validation and the main-process feed (fake link). Run: npm run test:overlay
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolveOverlay, type OverlayLayout, type OverlayRoster } from '../../shared/overlay/overlay-resolve';
import { healthTone, o2Tone, shieldArcs, shieldColor, shipLabel, topViewUrl } from '../../shared/overlay/overlay-format';
import { partyOverlayBounds, pickDisplay, PARTY_OVERLAY_DEFAULTS, sanitizePartyOverlaySetting, type PartyOverlaySettings } from '../../electron/modules/overlay/party-overlay-settings';
import { PartyOverlayFeed, type FeedLink, type PartyOverlayState } from '../../electron/modules/overlay/party-overlay-feed';

const vectors = JSON.parse(readFileSync('shared/overlay/overlay-vectors.json', 'utf8'));
const roster = vectors.roster as OverlayRoster;

for (const c of vectors.cases as Array<{ name: string; roster?: OverlayRoster; layout: OverlayLayout | null; expect: string[]; expanded?: Record<string, boolean>; crew?: Record<string, string[]> }>) {
  test(`resolver vector: ${c.name}`, () => {
    const rows = resolveOverlay(c.roster ?? roster, c.layout);
    assert.deepEqual(rows.map((r) => r.key), c.expect);
    for (const [key, exp] of Object.entries(c.expanded ?? {})) {
      const row = rows.find((r) => r.key === key);
      assert.equal(row?.kind === 'ship' && row.expanded, exp, key);
    }
    for (const [key, ids] of Object.entries(c.crew ?? {})) {
      const row = rows.find((r) => r.key === key);
      assert.deepEqual(row?.kind === 'ship' ? row.crew.map((m) => m.userId) : null, ids);
    }
  });
}

test('format helpers', () => {
  assert.match(topViewUrl('RSI_Galaxy') ?? '', /^https:\/\/api\.fleetyards\.net\//);
  assert.equal(topViewUrl('RSI_Galaxy_Extra_Token'), topViewUrl('RSI_Galaxy'));
  assert.equal(topViewUrl('NOPE_Unknown'), null);
  assert.equal(topViewUrl(''), null);
  assert.deepEqual(shipLabel('DRAK_Cutlass_Black'), { maker: 'DRAK', model: 'Cutlass Black' });
  assert.deepEqual(shipLabel('Ship'), { maker: '', model: 'Ship' });
  assert.equal(shieldColor(100), 'rgb(132,132,252)');
  assert.equal(shieldColor(0), 'rgb(239,68,68)');
  assert.equal(healthTone(null), 'dim');
  assert.equal(healthTone(20), 'bad');
  assert.equal(healthTone(40), 'warn');
  assert.equal(o2Tone(80), null);
  assert.equal(o2Tone(22), 'warn');
  assert.equal(o2Tone(9), 'bad');
});

test('shield arcs: a face at 0 is a gap; one face is a full ring; none = nothing', () => {
  assert.equal(shieldArcs([100, 64, 0, 80], 71, 50, 45).length, 3);
  assert.deepEqual(shieldArcs([12], 12, 50, 45).map((a) => a.full), [true]);
  assert.deepEqual(shieldArcs([0], 0, 50, 45), []);
  assert.deepEqual(shieldArcs([], null, 50, 45), []);
  assert.equal(shieldArcs([], 50, 50, 45)[0].full, true);
});

test('settings validation', () => {
  assert.equal(sanitizePartyOverlaySetting('partyOverlayEnabled', 'yes'), undefined);
  assert.equal(sanitizePartyOverlaySetting('partyOverlayEnabled', true), true);
  assert.equal(sanitizePartyOverlaySetting('partyOverlaySource', 'guild'), undefined);
  assert.equal(sanitizePartyOverlaySetting('partyOverlayOrgTag', ' void '), 'VOID');
  assert.equal(sanitizePartyOverlaySetting('partyOverlayOrgTag', 'bad tag!'), undefined);
  assert.equal(sanitizePartyOverlaySetting('partyOverlayScale', 9), 1.5);
  assert.equal(sanitizePartyOverlaySetting('partyOverlayScale', '1'), undefined);
  assert.equal(sanitizePartyOverlaySetting('partyOverlayOffsetY', -4), 0);
  assert.equal(sanitizePartyOverlaySetting('partyOverlayDisplayId', 2779098405), 2779098405);
  assert.equal(sanitizePartyOverlaySetting('partyOverlayDisplayId', -1), undefined);
  assert.equal(sanitizePartyOverlaySetting('partyOverlayDisplayId', 1.5), undefined);
  assert.equal(sanitizePartyOverlaySetting('partyOverlaySwitchHotkey', ' Ctrl+Alt+Shift+P '), 'Ctrl+Alt+Shift+P');
  const prim = { id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 } };
  const side = { id: 7, bounds: { x: 1920, y: 0, width: 2560, height: 1440 } };
  assert.equal(pickDisplay([prim, side], prim, 0), prim);
  assert.equal(pickDisplay([prim, side], prim, 7), side);
  assert.equal(pickDisplay([prim], prim, 7), prim, 'unplugged display falls back to primary');
  assert.deepEqual(partyOverlayBounds(side.bounds, { partyOverlayScale: 1, partyOverlayOffsetY: 18 }), { x: 4164, y: 259, width: 300, height: 1165 });
  assert.deepEqual(partyOverlayBounds({ x: 0, y: 0, width: 1920, height: 1080 }, { partyOverlayScale: 1, partyOverlayOffsetY: 18 }), { x: 1604, y: 194, width: 300, height: 870 });
});

// --- feed ---------------------------------------------------------------------------------------

class FakeLink implements FeedLink {
  authenticated = true;
  sent: Array<{ event: string; payload: any; ack?: (a: any) => void }> = [];
  handlers = new Map<string, (...a: any[]) => void>();
  events = new Map<string, () => void>();
  sendWithAck(event: string, payload: unknown, onAck?: (a: any) => void) {
    if (!this.authenticated) return false;
    this.sent.push({ event, payload, ack: onAck });
    return true;
  }
  onServer(event: string, fn: (...a: any[]) => void) {
    this.handlers.set(event, fn);
  }
  on(event: string, fn: () => void) {
    this.events.set(event, fn);
  }
}

function makeFeed(over: Partial<PartyOverlaySettings> = {}) {
  const link = new FakeLink();
  let settings: PartyOverlaySettings = { ...PARTY_OVERLAY_DEFAULTS, partyOverlayEnabled: true, partyOverlayOrgTag: 'VOID', ...over };
  const pushes: PartyOverlayState[] = [];
  let t = 0;
  const timers: Array<{ at: number; fn: () => void }> = [];
  const feed = new PartyOverlayFeed({
    link,
    getSettings: () => settings,
    isSignedIn: () => true,
    push: (s) => pushes.push(s),
    now: () => t,
    setTimer: (fn, ms) => {
      const timer = { at: t + ms, fn };
      timers.push(timer);
      return timer;
    },
    clearTimer: () => undefined,
  });
  const advance = (ms: number) => {
    t += ms;
    for (const tm of timers.splice(0)) if (tm.at <= t) tm.fn();
      else timers.push(tm);
  };
  return { link, feed, pushes, advance, setSettings: (s: Partial<PartyOverlaySettings>) => (settings = { ...settings, ...s }) };
}

const ackOk = (layoutVersion = 2) => ({ ok: true, source: { scope: 'org', id: 'VOID', label: '[VOID]' }, roster: { ...roster, generatedAt: 'a' }, layout: { scope: 'org', id: 'VOID', version: layoutVersion, entries: [], shipsExpandedByDefault: true, updatedAt: null, updatedBy: null }, party: null });

test('feed subscribes to the org, applies pushes, ignores stale layouts and foreign rosters', () => {
  const { link, feed, pushes, advance } = makeFeed();
  feed.resubscribe();
  assert.deepEqual(link.sent[0].payload, { scope: 'org', tag: 'VOID' });
  link.sent[0].ack!(ackOk(2));
  advance(300);
  assert.equal(feed.current.status, 'live');
  link.handlers.get('overlay_layout')!({ scope: 'org', id: 'VOID', version: 1, entries: [{ kind: 'member', userId: 'x' }], shipsExpandedByDefault: true });
  assert.equal(feed.current.layout?.version, 2);
  link.handlers.get('overlay_layout')!({ scope: 'org', id: 'VOID', version: 3, entries: [], shipsExpandedByDefault: false });
  assert.equal(feed.current.layout?.version, 3);
  link.handlers.get('overlay_roster')!({ ...roster, id: 'OTHER', generatedAt: 'b' });
  assert.equal(feed.current.roster?.generatedAt, 'a');
  link.handlers.get('overlay_roster')!({ ...roster, generatedAt: 'c' });
  assert.equal(feed.current.roster?.generatedAt, 'c');
  advance(300);
  assert.equal(pushes.at(-1)?.roster?.generatedAt, 'c');
});

test('feed throttles pushes to 4 Hz with a trailing push', () => {
  const { link, feed, pushes, advance } = makeFeed();
  feed.resubscribe();
  link.sent[0].ack!(ackOk());
  const before = pushes.length;
  for (let i = 0; i < 20; i++) link.handlers.get('overlay_roster')!({ ...roster, generatedAt: `r${i}` });
  advance(100);
  assert.ok(pushes.length - before <= 1, `pushed ${pushes.length - before} times within 100 ms`);
  advance(300);
  assert.equal(pushes.at(-1)?.roster?.generatedAt, 'r19');
});

test('feed re-subscribes on authenticated; stale acks are ignored; errors map to statuses', () => {
  const { link, feed, advance, setSettings } = makeFeed();
  feed.resubscribe();
  link.events.get('authenticated')!();
  assert.equal(link.sent.length, 2);
  link.sent[1].ack!({ ok: false, error: 'no-access' });
  link.sent[0].ack!(ackOk()); // older request answered late: ignored
  advance(300);
  assert.equal(feed.current.status, 'no-access');
  setSettings({ partyOverlayOrgTag: '' });
  feed.resubscribe();
  assert.equal(feed.current.status, 'no-source');
  setSettings({ partyOverlayEnabled: false });
  feed.resubscribe();
  assert.equal(feed.current.status, 'off');
});

test('feed: party source, removal from the party, offline link', () => {
  const { link, feed, setSettings } = makeFeed({ partyOverlaySource: 'party' });
  feed.resubscribe();
  assert.deepEqual(link.sent[0].payload, { scope: 'party' });
  link.sent[0].ack!({ ...ackOk(), source: { scope: 'party', id: 'p1', label: 'Wing' }, party: { id: 'p1', name: 'Wing', code: 'ABCDEF', ownerId: 'u1', members: [] } });
  link.handlers.get('overlay_party')!(null);
  assert.equal(feed.current.status, 'no-party');
  link.authenticated = false;
  setSettings({});
  feed.resubscribe();
  assert.equal(feed.current.status, 'connecting');
});

test('feed: selfId from the ack; owner keeps the code across broadcasts; members never get one', () => {
  const { link, feed } = makeFeed({ partyOverlaySource: 'party' });
  feed.resubscribe();
  const party = { id: 'p1', name: 'Wing', ownerId: 'aa11', members: [{ userId: 'aa11', name: 'Bo' }] };
  link.sent[0].ack!({ ...ackOk(), source: { scope: 'party', id: 'p1', label: 'Wing' }, selfId: 'aa11', party: { ...party, code: 'ABCDEF', selfId: 'aa11', isOwner: true } });
  assert.equal(feed.current.selfId, 'aa11');
  // broadcast after someone joined: no code in it, but we are still the owner
  link.handlers.get('overlay_party')!({ ...party, members: [...party.members, { userId: 'bb22', name: 'Ava' }] });
  assert.equal(feed.current.party?.code, 'ABCDEF');
  assert.equal(feed.current.party?.isOwner, true);
  assert.equal(feed.current.party?.members.length, 2);
  // ownership handed to bb22: the code is dropped
  link.handlers.get('overlay_party')!({ ...party, ownerId: 'bb22' });
  assert.equal(feed.current.party?.code, undefined);
  assert.equal(feed.current.party?.isOwner, false);
  assert.equal(link.sent.length, 1, 'no fetch when we are not the owner');
});

test('feed: becoming owner via broadcast fetches the code; rotate replies replace it', () => {
  const { link, feed } = makeFeed({ partyOverlaySource: 'party' });
  feed.resubscribe();
  const party = { id: 'p1', name: 'Wing', ownerId: 'aa11', members: [{ userId: 'aa11', name: 'Bo' }, { userId: 'bb22', name: 'Ava' }] };
  link.sent[0].ack!({ ...ackOk(), source: { scope: 'party', id: 'p1', label: 'Wing' }, selfId: 'bb22', party: { ...party, selfId: 'bb22', isOwner: false } });
  link.handlers.get('overlay_party')!({ ...party, ownerId: 'bb22' });
  const get = link.sent[1];
  assert.deepEqual(get.payload, { action: 'get' });
  get.ack!({ ok: true, party: { ...party, ownerId: 'bb22', code: 'QWERTY', selfId: 'bb22', isOwner: true } });
  assert.equal(feed.current.party?.code, 'QWERTY');
  void feed.party('rotate');
  link.sent[2].ack!({ ok: true, party: { ...party, ownerId: 'bb22', code: 'ZXCVBN', selfId: 'bb22', isOwner: true } });
  assert.equal(feed.current.party?.code, 'ZXCVBN');
});

test('feed: overlay_revoked shows no access', () => {
  const { link, feed } = makeFeed();
  feed.resubscribe();
  link.sent[0].ack!(ackOk());
  link.handlers.get('overlay_revoked')!({ reason: 'access-revoked' });
  assert.equal(feed.current.status, 'no-access');
  assert.equal(feed.current.roster, null);
});
