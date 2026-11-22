/**
 * Party overlay: shared resolver vectors (same file as the server / website), display helpers,
 * settings validation and the main-process feed (fake link). Run: npm run test:overlay
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolveOverlay, type OverlayLayout, type OverlayRoster } from '../../shared/overlay/overlay-resolve';
import { healthTone, o2Tone, shieldArcs, shieldColor, shipLabel, topViewUrl } from '../../shared/overlay/overlay-format';
import { normalizeOrgTag, sanitizeOrgChoices } from '../../shared/overlay/org-tag';
import { markOverlaySwitchTouched, partyOverlayBounds, partyOverlayDefaultOnMigration, pickDisplay, PARTY_OVERLAY_DEFAULTS, runPartyOverlayMigration, sanitizePartyOverlaySetting, type PartyOverlaySettings } from '../../electron/modules/overlay/party-overlay-settings';
import { PartyOverlayFeed, type FeedLink, type PartyOverlayState } from '../../electron/modules/overlay/party-overlay-feed';
import { fitPlans, isCollapsed, mergeSections, overlayCard, planFit, selectedOrgTags, toggleOrg, WAITING_CARD_MS } from '../../shared/overlay/overlay-sections';

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

const tick = () => new Promise((r) => setImmediate(r));
const VOID_ORG = [{ tag: 'VOID', name: 'Void', primary: true }];
/** Org mode: answer the overlay_orgs request, then the subscribe is sent. Returns the subscribe entry. */
async function answerOrgs(link: FakeLink, orgs: unknown[] | null = VOID_ORG) {
  const req = link.sent.at(-1)!;
  assert.equal(req.event, 'overlay_orgs');
  req.ack!(orgs ? { ok: true, orgs } : undefined);
  await tick();
  return link.sent.at(-1)!;
}
const multiAck = (...tags: string[]) => ({
  ok: true,
  multi: true,
  sections: tags.map((t) => ({ source: { scope: 'org', id: t, label: `[${t}]` }, selfId: `me-${t}`, roster: { ...roster, id: t, generatedAt: 'a' }, layout: { scope: 'org', id: t, version: 1, entries: [], shipsExpandedByDefault: true, updatedAt: null, updatedBy: null } })),
  refused: [],
});

test('feed subscribes to the org, applies pushes, ignores stale layouts and foreign rosters', async () => {
  const { link, feed, pushes, advance } = makeFeed();
  feed.resubscribe();
  const sub = await answerOrgs(link);
  assert.deepEqual(sub.payload, { scope: 'org', tags: ['VOID'] });
  sub.ack!(ackOk(2));
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

test('feed throttles pushes to 4 Hz with a trailing push', async () => {
  const { link, feed, pushes, advance } = makeFeed();
  feed.resubscribe();
  (await answerOrgs(link)).ack!(ackOk());
  const before = pushes.length;
  for (let i = 0; i < 20; i++) link.handlers.get('overlay_roster')!({ ...roster, generatedAt: `r${i}` });
  advance(100);
  assert.ok(pushes.length - before <= 1, `pushed ${pushes.length - before} times within 100 ms`);
  advance(300);
  assert.equal(pushes.at(-1)?.roster?.generatedAt, 'r19');
});

test('feed re-subscribes on authenticated; stale acks are ignored; errors map to statuses', async () => {
  const { link, feed, advance, setSettings } = makeFeed();
  feed.resubscribe();
  const first = await answerOrgs(link);
  link.events.get('authenticated')!();
  const second = await answerOrgs(link);
  second.ack!({ ok: false, error: 'no-access' });
  first.ack!(ackOk()); // older request answered late: ignored
  advance(300);
  assert.equal(feed.current.status, 'no-access');
  assert.equal(feed.current.sections[0]?.source.label, '[VOID]', 'header label kept for the card');
  setSettings({ partyOverlayOrgsUnticked: ['VOID'] });
  const sentBefore = link.sent.length;
  feed.resubscribe();
  await tick();
  assert.equal(link.sent.length, sentBefore, 'a settings change reuses the cached org list (no overlay_orgs, nothing to subscribe)');
  assert.equal(feed.current.status, 'no-source');
  assert.match(feed.current.message ?? '', /No orgs selected/);
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
  // as owner we re-fetch: the code may have been rotated elsewhere (website)
  assert.deepEqual(link.sent[1].payload, { action: 'get' });
  link.sent[1].ack!({ ok: true, party: { ...party, members: [...party.members, { userId: 'bb22', name: 'Ava' }], code: 'NEWONE', selfId: 'aa11', isOwner: true } });
  assert.equal(feed.current.party?.code, 'NEWONE');
  // ownership handed to bb22: the code is dropped
  link.handlers.get('overlay_party')!({ ...party, ownerId: 'bb22' });
  assert.equal(feed.current.party?.code, undefined);
  assert.equal(feed.current.party?.isOwner, false);
  assert.equal(link.sent.length, 2, 'no fetch when we are not the owner');
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

test('feed: overlay_revoked shows no access', async () => {
  const { link, feed } = makeFeed();
  feed.resubscribe();
  (await answerOrgs(link)).ack!(ackOk());
  link.handlers.get('overlay_revoked')!({ reason: 'access-revoked' });
  assert.equal(feed.current.status, 'no-access');
  assert.equal(feed.current.roster, null);
});

test('org tag: normalise, validate, sanitise server choices', () => {
  assert.equal(normalizeOrgTag(' void '), 'VOID');
  assert.equal(normalizeOrgTag(''), '');
  assert.equal(normalizeOrgTag('bad tag!'), null);
  assert.equal(normalizeOrgTag('X'.repeat(21)), null);
  assert.deepEqual(
    sanitizeOrgChoices([{ tag: 'wing', name: 'Wingmen' }, { tag: 'VOID', name: 'Voidrunners', primary: true }, { tag: 'VOID' }, { tag: 'no good' }, null]),
    [
      { tag: 'VOID', name: 'Voidrunners', primary: true },
      { tag: 'WING', name: 'Wingmen', primary: false },
    ],
  );
  assert.deepEqual(sanitizeOrgChoices('nope'), []);
});

test('feed.orgs: ack, timeout (older server without overlay_orgs) and offline', async () => {
  const { link, feed, advance } = makeFeed();
  const p1 = feed.orgs();
  assert.equal(link.sent.at(-1)!.event, 'overlay_orgs');
  link.sent.at(-1)!.ack!({ ok: true, orgs: [{ tag: 'void', name: 'V', primary: true }] });
  assert.deepEqual(await p1, [{ tag: 'VOID', name: 'V', primary: true }]);
  const p2 = feed.orgs(5000);
  advance(5001);
  assert.equal(await p2, null);
  link.authenticated = false;
  assert.equal(await feed.orgs(), null);
});

// --- multi-org (0.3.6) ----------------------------------------------------------------------------

test('org selection: all verified orgs minus unticked, org order kept, max 10; toggle keeps the unticked set', () => {
  const orgs = ['VOID', 'WING', 'AAA'].map((tag, i) => ({ tag, name: null, primary: i === 0 }));
  assert.deepEqual(selectedOrgTags(orgs, []), ['VOID', 'WING', 'AAA']);
  assert.deepEqual(selectedOrgTags(orgs, ['wing', 'GONE']), ['VOID', 'AAA']);
  const many = Array.from({ length: 12 }, (_, i) => ({ tag: `O${i}`, name: null, primary: false }));
  assert.equal(selectedOrgTags(many, []).length, 10);
  assert.deepEqual(toggleOrg([], 'WING', false), ['WING']);
  assert.deepEqual(toggleOrg(['WING', 'X'], 'WING', true), ['X']);
  assert.deepEqual(toggleOrg(['WING'], 'WING', false), ['WING']);
});

test('settings: unticked orgs are validated (upper-cased, deduped, junk dropped)', () => {
  assert.deepEqual(sanitizePartyOverlaySetting('partyOverlayOrgsUnticked', ['void', 'VOID', 'bad tag', 3, 'wing']), ['VOID', 'WING']);
  assert.equal(sanitizePartyOverlaySetting('partyOverlayOrgsUnticked', 'VOID'), undefined);
  assert.deepEqual(PARTY_OVERLAY_DEFAULTS.partyOverlayOrgsUnticked, [], 'all orgs selected by default');
});

test('feed multi-org: subscribes to every selected org, one section each; pushes and layouts go to the right one', async () => {
  const { link, feed, advance } = makeFeed({ partyOverlayOrgsUnticked: ['MUTE'] });
  feed.resubscribe();
  const sub = await answerOrgs(link, [{ tag: 'VOID', name: 'Void', primary: true }, { tag: 'mute', name: 'M' }, { tag: 'WING', name: 'Wing' }]);
  assert.deepEqual(sub.payload, { scope: 'org', tags: ['VOID', 'WING'] });
  sub.ack!(multiAck('VOID', 'WING'));
  advance(300);
  assert.equal(feed.current.status, 'live');
  assert.deepEqual(feed.current.sections.map((x) => x.source.id), ['VOID', 'WING']);
  assert.equal(feed.current.sections[1].selfId, 'me-WING');
  link.handlers.get('overlay_roster')!({ ...roster, id: 'WING', generatedAt: 'w2' });
  assert.equal(feed.current.sections[1].roster?.generatedAt, 'w2');
  assert.equal(feed.current.sections[0].roster?.generatedAt, 'a');
  link.handlers.get('overlay_layout')!({ scope: 'org', id: 'WING', version: 5, entries: [], shipsExpandedByDefault: false });
  assert.equal(feed.current.sections[1].layout?.version, 5);
  assert.equal(feed.current.sections[0].layout?.version, 1);
  // losing one org drops only its section
  link.handlers.get('overlay_revoked')!({ reason: 'access-revoked', scope: 'org', id: 'VOID' });
  assert.deepEqual(feed.current.sections.map((x) => x.source.id), ['WING']);
  assert.equal(feed.current.status, 'live');
  assert.equal(feed.current.source?.id, 'WING', 'mirror fields follow the first section');
  link.handlers.get('overlay_revoked')!({ reason: 'access-revoked', scope: 'org', id: 'WING' });
  assert.equal(feed.current.status, 'no-access');
});

test('feed multi-org: no verified orgs, older server fallback to the single tag, org list change re-subscribes', async () => {
  const a = makeFeed();
  a.feed.resubscribe();
  await answerOrgs(a.link, []);
  assert.equal(a.feed.current.status, 'no-source');
  assert.match(a.feed.current.message ?? '', /No verified org/);

  const b = makeFeed({ partyOverlayOrgTag: 'OLD' });
  b.feed.resubscribe();
  const sub = await answerOrgs(b.link, null); // server without overlay_orgs
  assert.deepEqual(sub.payload, { scope: 'org', tag: 'OLD' });

  const c = makeFeed();
  c.feed.resubscribe();
  (await answerOrgs(c.link)).ack!(ackOk());
  const p = c.feed.refreshOrgs();
  c.link.sent.at(-1)!.ack!({ ok: true, orgs: [...VOID_ORG, { tag: 'NEW', name: 'Joined later' }] });
  await p;
  await tick();
  const sub2 = c.link.sent.at(-1)!;
  assert.equal(sub2.event, 'overlay_subscribe');
  assert.deepEqual(sub2.payload, { scope: 'org', tags: ['VOID', 'NEW'] }, 'a newly joined org is on without ticking it');
});

test('feed multi-org: a server without tags support ("bad tag") gets the first org as a single tag', async () => {
  const { link, feed } = makeFeed();
  feed.resubscribe();
  const sub = await answerOrgs(link, [...VOID_ORG, { tag: 'WING', name: 'W' }]);
  sub.ack!({ ok: false, error: 'bad tag' });
  const retry = link.sent.at(-1)!;
  assert.deepEqual(retry.payload, { scope: 'org', tag: 'VOID' });
  retry.ack!(ackOk());
  assert.equal(feed.current.status, 'live');
  assert.deepEqual(feed.current.sections.map((x) => x.source.id), ['VOID']);
});

test('feed multi-org: org list cached across settings saves; a failed refetch on reconnect keeps it', async () => {
  const { link, feed, advance, setSettings } = makeFeed();
  feed.resubscribe();
  (await answerOrgs(link, [...VOID_ORG, { tag: 'WING', name: 'W' }])).ack!(multiAck('VOID', 'WING'));
  const orgsCalls = () => link.sent.filter((x) => x.event === 'overlay_orgs').length;
  for (let i = 0; i < 5; i++) {
    setSettings({ partyOverlayCompact: i % 2 === 0 });
    feed.resubscribe();
    await tick();
  }
  assert.equal(orgsCalls(), 1, 'five settings saves, still one overlay_orgs');
  assert.deepEqual(link.sent.at(-1)!.payload, { scope: 'org', tags: ['VOID', 'WING'] });
  // reconnect: refetch; it times out (rate-limited / slow) -> the cached list is used, not the legacy tag
  link.events.get('authenticated')!();
  assert.equal(orgsCalls(), 2);
  advance(5001);
  await tick();
  assert.deepEqual(link.sent.at(-1)!.payload, { scope: 'org', tags: ['VOID', 'WING'] });
});

test('sections: a member in two orgs is listed once, in the first section (by vid, not name); online = real org total', () => {
  const m = (userId: string, name: string, status = 'on-foot') => ({ userId, name, status, health: 100, o2: null, shipKey: null }) as any;
  const sec = (id: string, members: any[], vids?: Record<string, string>) => ({ source: { scope: 'org' as const, id, label: `[${id}]` }, selfId: null, layout: null, vids, roster: { scope: 'org' as const, id, generatedAt: 'x', members, ships: [] } });
  // Bo is a1 in A and b1 in B (room ids differ) with the same vid; "Twin" in B is a different person with the same name
  const out = mergeSections([
    sec('A', [m('a1', 'Bo'), m('a2', 'Ava', 'offline'), m('a3', 'Twin')], { a1: 'v-bo', a2: 'v-ava', a3: 'v-twin1' }),
    sec('B', [m('b1', 'Bo'), m('b2', 'Cy'), m('b3', 'Twin')], { b1: 'v-bo', b2: 'v-cy', b3: 'v-twin2' }),
  ]);
  assert.deepEqual(out[0].roster!.members.map((x) => x.name), ['Bo', 'Ava', 'Twin']);
  assert.deepEqual(out[1].roster!.members.map((x) => x.name), ['Cy', 'Twin'], 'same name, different vid: both shown');
  assert.deepEqual(out.map((x) => x.online), [2, 3], 'header count = the org\'s real online total');
  assert.deepEqual(out.map((x) => x.shownOnline), [2, 2]);
  // no vids (single org / older server): nothing is merged
  const plain = mergeSections([sec('A', [m('a1', 'Bo')]), sec('B', [m('b1', 'Bo')])]);
  assert.deepEqual(plain.map((x) => x.roster!.members.length), [1, 1]);
});

test('feed multi-org: vids from the ack and overlay_vids updates land on the right section', async () => {
  const { link, feed } = makeFeed();
  feed.resubscribe();
  const ack = multiAck('VOID', 'WING');
  (ack.sections[0] as any).vids = { x1: 'v1' };
  (ack.sections[1] as any).vids = { y1: 'v1' };
  (await answerOrgs(link, [...VOID_ORG, { tag: 'WING', name: 'W' }])).ack!(ack);
  assert.deepEqual(feed.current.sections[1].vids, { y1: 'v1' });
  link.handlers.get('overlay_vids')!({ scope: 'org', id: 'WING', vids: { y1: 'v1', y2: 'v9' } });
  assert.deepEqual(feed.current.sections[1].vids, { y1: 'v1', y2: 'v9' });
  assert.deepEqual(feed.current.sections[0].vids, { x1: 'v1' });
  link.handlers.get('overlay_vids')!({ scope: 'org', id: 'NOPE', vids: { z: 'z' } });
  link.handlers.get('overlay_vids')!(undefined);
  assert.equal(feed.current.sections.length, 2);
});

test('status card: shown without a live roster; "Waiting for Star Citizen" only for the first 30 s', () => {
  assert.equal(overlayCard({ status: 'off' }, null), null);
  assert.equal(overlayCard({ status: 'no-source', message: 'No orgs selected. Tick one in Settings' }, 0)?.detail, 'No orgs selected. Tick one in Settings');
  assert.equal(overlayCard({ status: 'connecting' }, null)?.title, 'Connecting to VOIDLOG.GG');
  const offlineSelf = [{ source: { scope: 'org' as const, id: 'A', label: '[A]' }, selfId: 'me', layout: null, roster: { scope: 'org' as const, id: 'A', generatedAt: 'x', ships: [], members: [{ userId: 'me', name: 'Me', status: 'offline', health: null, o2: null, shipKey: null }] } }] as any;
  assert.equal(overlayCard({ status: 'live', sections: offlineSelf }, 1000)?.title, 'Waiting for Star Citizen');
  assert.equal(overlayCard({ status: 'live', sections: offlineSelf }, WAITING_CARD_MS + 1), null);
  const onlineSelf = JSON.parse(JSON.stringify(offlineSelf));
  onlineSelf[0].roster.members[0].status = 'on-foot';
  assert.equal(overlayCard({ status: 'live', sections: onlineSelf }, 1000), null);
});

test('auto-fit: full if it fits, else compact, else collapse the lowest sections; the main org never collapses', async () => {
  // fake renderer: 3 sections, full rows 400 px each, compact 250, a collapsed section 30
  const height = (p: { compact: boolean; collapsed: number }) => [0, 1, 2].reduce((h, i) => h + (isCollapsed(p, i, 3) ? 30 : p.compact ? 250 : 400), 0);
  const fit = (max: number, userCompact = false) => planFit(3, userCompact, max, async (p) => height(p));
  assert.deepEqual(await fit(1300), { compact: false, collapsed: 0 }, 'everything fits');
  assert.deepEqual(await fit(869), { compact: true, collapsed: 0 }, '1080p: compact fits');
  assert.deepEqual(await fit(600), { compact: true, collapsed: 1 }, 'lowest section folded');
  assert.deepEqual(await fit(320), { compact: true, collapsed: 2 }, 'all but the main org folded');
  assert.deepEqual(await fit(100), { compact: true, collapsed: 2 }, 'nothing fits: most folded, main org still open');
  assert.deepEqual(await fit(1300, true), { compact: true, collapsed: 0 }, 'user compact: never goes back to full');
  assert.deepEqual(await planFit(3, false, null, async () => 99999), { compact: false, collapsed: 0 }, 'unknown height: no fitting');
  assert.equal(isCollapsed({ compact: true, collapsed: 5 }, 0, 3), false);
  assert.deepEqual(fitPlans(1, false), [{ compact: false, collapsed: 0 }, { compact: true, collapsed: 0 }]);
});

// --- 0.3.7: on by default -----------------------------------------------------------------------

test('defaults (fresh install): overlay on, source Org, every verified org ticked', () => {
  assert.equal(PARTY_OVERLAY_DEFAULTS.partyOverlayEnabled, true);
  assert.equal(PARTY_OVERLAY_DEFAULTS.partyOverlaySource, 'org');
  assert.deepEqual(PARTY_OVERLAY_DEFAULTS.partyOverlayOrgsUnticked, []);
});

test('default-on migration: upgrade switches on once; a later "off" sticks; users who chose sticks', () => {
  const store = (init: Record<string, unknown>) => {
    const m = new Map(Object.entries(init));
    return { m, get: (k: string) => m.get(k), set: (k: string, v: unknown) => void m.set(k, v) };
  };
  // upgrade from 0.3.6: the old default (off) was stored, no flags yet -> on, migration recorded
  const up = store({ partyOverlayEnabled: false });
  assert.equal(runPartyOverlayMigration(up), true);
  assert.equal(up.m.get('partyOverlayEnabled'), true);
  assert.equal(up.m.get('partyOverlayDefaultOnMigrated'), true);
  // the user turns it off in Settings -> touched; next start: the migration does nothing, it stays off
  markOverlaySwitchTouched(up, { partyOverlayEnabled: false });
  up.set('partyOverlayEnabled', false);
  assert.equal(runPartyOverlayMigration(up), false);
  assert.equal(up.m.get('partyOverlayEnabled'), false);
  // other settings saves do not count as touching the switch
  const other = store({});
  markOverlaySwitchTouched(other, { partyOverlayCompact: true });
  assert.equal(other.m.get('partyOverlayEnabledTouched'), undefined);
  // fresh install: nothing stored -> on (same as the default), recorded
  const fresh = store({});
  assert.equal(runPartyOverlayMigration(fresh), true);
  assert.equal(fresh.m.get('partyOverlayEnabled'), true);
  // touched but not yet migrated (switch used in 0.3.7 before the migration ran): the choice wins
  assert.deepEqual(partyOverlayDefaultOnMigration({ migrated: undefined, touched: true }), { migrated: true });
  assert.equal(partyOverlayDefaultOnMigration({ migrated: true, touched: undefined }), null);
});
