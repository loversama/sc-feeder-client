/**
 * Game.log parser tests for Star Citizen 4.10.200. Run with:  npm run test:parser
 * Fixtures in ./fixtures are verbatim log lines (local handle redacted to <player>); only the lines each test needs.
 * Electron-bound modules are stubbed (see run.mjs); processKillEvent calls are captured in `emitted`.
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseLogContent, resetParserState, PARSER_PATTERNS, PARSER_PATTERN_META } from '../../electron/modules/log-parser.ts';
import { emitted, clearEmitted } from './stubs/stubs';
import { Sc50LogTracker, prettyPlace } from '../../electron/modules/sc50-log-events.ts';

const fixtureDir = process.env.PARSER_FIXTURES ?? path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures'); // run.mjs sets it (the bundle lives in a different folder)
const fx = (name: string) => fs.readFileSync(path.join(fixtureDir, name), 'utf8').replace(/\r\n/g, '\n');
const parse = (content: string) => parseLogContent(content, true);
const events = () => emitted.map(e => e.event);
const GEID = '204772006105';

beforeEach(() => {
  resetParserState();
  clearEmitted();
});

async function login() {
  await parse(fx('login.txt'));
}

test('<Vehicle Destroyed>: 13/13 fixture lines (N1 + N2) match the pattern', () => {
  const lines = [...fx('vehicle-destroyed-n1.txt').split('\n'), ...fx('vehicle-destroyed-n2.txt').split('\n')].filter(Boolean);
  assert.equal(lines.length, 13);
  const matched = lines.filter(l => PARSER_PATTERNS.vehicleDestroyed.test(l));
  assert.equal(matched.length, 13);
  const g = lines[0].match(PARSER_PATTERNS.vehicleDestroyed)!.groups!;
  assert.ok(g.ownerId && g.killerId && g.reason && g.vehicleClass);
});

test('login line captures the local GEID and handle', async () => {
  assert.match(fx('login.txt'), new RegExp(`geid ${GEID}`));
  const g = fx('login.txt').match(PARSER_PATTERNS.loginGeid)!.groups!;
  assert.equal(g.geid, GEID);
  assert.equal(g.name, '<player>');
});

test('3 Combat NPC kills credit the local player; third-party wrecks are ignored', async () => {
  await login();
  await parse(fx('vehicle-destroyed-n1.txt'));
  await parse(fx('vehicle-destroyed-n2.txt'));
  const kills = events().filter(e => e.eventData?.reason === 'Combat');
  assert.equal(kills.length, 3);
  for (const k of kills) {
    assert.deepEqual(k.killers, ['<player>']);
    assert.equal(k.eventData.isNpcTarget, true);
    assert.equal(k.eventData.ownerGeid, '0');
    assert.equal(k.eventData.killerGeid, GEID);
    assert.equal(k.deathType, 'Combat');
    assert.equal(k.victims[0], k.eventData.vehicleClass);
    assert.match(k.eventData.vehicleClass, /_PU_AI_/);
    assert.equal(k.eventData.detectionMethod, 'vehicle_destroyed_4_10');
  }
  // 3 kills + 1 own loss; the 9 other lines are other players' crashes / self-destructs
  assert.equal(emitted.length, 4);
});

test('own C8R crash yields an own-loss with no killer credited', async () => {
  await login();
  await parse(fx('vehicle-destroyed-n2.txt'));
  const loss = events().find(e => e.eventData?.vehicleClass === 'ANVL_C8R_Pisces');
  assert.ok(loss, 'own loss event emitted');
  assert.deepEqual(loss.victims, ['<player>']);
  assert.deepEqual(loss.killers, ['Environment']);
  assert.equal(loss.deathType, 'Collision');
  assert.equal(loss.eventData.reason, 'Collision');
  assert.equal(loss.eventData.isNpcTarget, false);
  assert.equal(loss.eventData.collisionWith, undefined);
  assert.ok(!events().some(e => e.killers.includes('<player>') && e.eventData?.reason !== 'Combat'), 'no kill credited for non-Combat');
});

test('Collision blamed on another player is not credited; SelfDestruct and unknown owners are skipped', async () => {
  await login();
  const own = (reason: string, killer: string, killerId: string) =>
    `<2026-11-12T20:00:00.000Z> [Notice] <Vehicle Destroyed> Vehicle 'AEGS_Sabre_1' [1] class 'AEGS_Sabre' (owner player [${GEID}], driver [0]) destroyed: reason [${reason}] level [0] -> [2] flags [4066] killer '${killer}' [${killerId}] authority [0] [Team_CGP4][Vehicle]\n`;
  await parse(own('Collision', 'crt', '203604417626'));
  let ev = events().at(-1);
  assert.deepEqual(ev.killers, ['Environment']);
  assert.equal(ev.eventData.collisionWith, 'crt');
  clearEmitted();
  await parse(own('SelfDestruct', 'AEGS_Sabre_1', '1').replace("[0], driver", "[0], driver"));
  ev = events().at(-1);
  assert.deepEqual(ev.killers, ['Self-Destruct']);
  assert.deepEqual(ev.victims, ['<player>']);
  clearEmitted();
  // Combat by another player on the local player's ship: killer credited to them, victim is us
  await parse(own('Combat', 'SomePirate', '555'));
  ev = events().at(-1);
  assert.deepEqual(ev.killers, ['SomePirate']);
  assert.deepEqual(ev.victims, ['<player>']);
});

test('shop: request + Success in one parse call pairs into one purchase', async () => {
  await login();
  await parse(fx('shop-buy-success-req.txt') + fx('shop-buy-success-resp.txt'));
  const shop = events().filter(e => e.eventType === 'shop_transaction');
  assert.equal(shop.length, 1);
  const d = shop[0].eventData;
  assert.equal(d.action, 'buy');
  assert.equal(d.shopName, 'SCShop_Centermass_NewBabbage');
  assert.equal(d.shopDisplayName, 'Centermass New Babbage');
  assert.equal(d.item, 'behr_lmg_ballistic_01_mag');
  assert.equal(d.quantity, 45);
  assert.equal(d.price, 23400);
  assert.equal(d.currency, 'UEC');
  assert.equal(d.result, 'Success');
});

test('shop: request and response split across two parse calls still pair', async () => {
  await login();
  await parse(fx('shop-standard-req.txt'));
  assert.equal(emitted.length, 0, 'a request alone is not a purchase');
  await parse(fx('shop-standard-resp.txt'));
  assert.equal(emitted.length, 1);
  assert.equal(events()[0].eventData.item.length > 0, true);
  assert.equal(events()[0].eventData.currency, 'UEC');
});

test('shop: InsuffientStock yields nothing (same call and split across calls), and does not poison later pairs', async () => {
  await login();
  await parse(fx('shop-insufficient-req.txt') + fx('shop-insufficient-resp.txt'));
  assert.equal(emitted.length, 0);
  await parse(fx('shop-insufficient-req.txt'));
  await parse(fx('shop-insufficient-resp.txt'));
  assert.equal(emitted.length, 0);
  await parse(fx('shop-buy-success-req.txt'));
  await parse(fx('shop-buy-success-resp.txt'));
  assert.equal(emitted.length, 1);
});

test('shop: rental pairs on Success and uses offering', async () => {
  await login();
  await parse(fx('shop-rental-req.txt'));
  await parse(fx('shop-rental-resp.txt'));
  const ev = events().find(e => e.eventType === 'shop_transaction');
  assert.ok(ev);
  assert.equal(ev.eventData.action, 'rent');
  assert.equal(ev.eventData.item, 'RSI_Lynx');
  assert.equal(ev.eventData.offering, 0);
  assert.equal(ev.eventData.quantity, undefined);
});

test('shop: a response arriving far after the request does not pair', async () => {
  await login();
  const req = fx('shop-buy-success-req.txt');
  const resp = fx('shop-buy-success-resp.txt').replace('2026-11-13T19:05:52.726Z', '2026-11-13T19:06:52.726Z');
  await parse(req + resp);
  assert.equal(emitted.length, 0);
});

test('objective complete: title split across two lines is captured (pre-existing bug fix)', async () => {
  const text = fx('objective-complete.txt');
  const m = text.split('\n')[0].match(PARSER_PATTERNS.missionObjectiveComplete);
  assert.equal(m?.groups?.objectiveText, 'Go to Asteroid Mining Base');
  await login();
  await parse(text);
  const ev = events().find(e => e.eventType === 'objective_update');
  assert.ok(ev);
  assert.equal(ev.objectiveText, 'Go to Asteroid Mining Base');
  assert.match(ev.eventDescription, /Objective Complete/);
  // single-line form still works
  const single = '<2026-11-12T21:00:00.000Z> [Notice] <SHUDEvent_OnNotification> Added notification "Objective Complete: Defeat Hostile Ship: " [5] to queue.';
  assert.equal(single.match(PARSER_PATTERNS.missionObjectiveComplete)?.groups?.objectiveText, 'Defeat Hostile Ship');
});

test('party invite: inviter comes from the previous line, also across parse calls', async () => {
  const [title, body] = fx('party-invite.txt').split('\n').filter(Boolean);
  await login();
  await parse(title + '\n' + body + '\n');
  let inv = events().filter(e => e.eventType === 'party_invite');
  assert.equal(inv.length, 1);
  assert.equal(inv[0].partyMember, 'Axel-Sinclair');
  clearEmitted();
  await parse(title + '\n');
  await parse(body + '\n');
  inv = events().filter(e => e.eventType === 'party_invite');
  assert.equal(inv.length, 1);
  assert.equal(inv[0].partyMember, 'Axel-Sinclair');
  clearEmitted();
  // an unrelated line between title and body clears the state: no invite without a known inviter
  await parse(title + '\n<2026-10-09T19:04:43.600Z> [Notice] <Something Else> noise\n' + body + '\n');
  assert.equal(events().filter(e => e.eventType === 'party_invite').length, 0);
});

test('names are captured in full: Axel-Sinclair and spaced names', async () => {
  const [joined, left] = fx('channel-others.txt').split('\n').filter(Boolean);
  assert.equal(joined.match(PARSER_PATTERNS.channelOtherJoined)?.groups?.playerName, 'Axel-Sinclair');
  const lm = left.match(PARSER_PATTERNS.voipChannelLeft)?.groups;
  assert.equal(lm?.playerName, 'Axel-Sinclair');
  assert.equal(lm?.channelName, 'RSI Galaxy : <player>');
  const leftParty = '<2026-10-09T20:02:18.913Z> Captain Smokey has left the party.: " [34] to queue. New queue size: 2';
  assert.equal(leftParty.match(PARSER_PATTERNS.partyMemberLeft)?.groups?.playerName, 'Captain Smokey');
  const conn = '<2026-10-09T20:02:18.913Z> Axel-Sinclair connected.: " [34] to queue. New queue size: 2';
  assert.equal(conn.match(PARSER_PATTERNS.partyMemberConnected)?.groups?.playerName, 'Axel-Sinclair');
  await login();
  await parse(joined + '\n' + left + '\n');
  const voip = events().filter(e => e.eventType === 'voip_channel');
  assert.equal(voip.length, 2);
  assert.equal(voip[0].partyMember, 'Axel-Sinclair');
  assert.equal(voip[0].eventData.action, 'joined');
  assert.equal(voip[0].eventData.shipName, 'RSI Galaxy');
  assert.equal(voip[0].eventData.shipOwner, '<player>');
  assert.equal(voip[0].eventData.self, false);
  assert.equal(voip[1].partyMember, 'Axel-Sinclair');
  assert.equal(voip[1].eventData.action, 'left');
});

test('own ship channel join', async () => {
  await login();
  await parse(fx('channel-self.txt'));
  const voip = events().filter(e => e.eventType === 'voip_channel');
  assert.equal(voip.length, 1);
  assert.equal(voip[0].eventData.self, true);
  assert.equal(voip[0].eventData.action, 'joined');
  assert.equal(voip[0].eventData.shipName, 'RSI Galaxy');
});

test('mission comms tags attach organization/type to the mission event', async () => {
  await login();
  await parse(fx('comms-tags.txt'));
  const ev = events().find(e => e.eventType === 'mission_accepted');
  assert.ok(ev);
  assert.equal(ev.missionOrganization, 'Navy.Baramsco');
  assert.equal(ev.missionType, 'WaveAttack.SingleTarget');
});

test('objective progress is de-duplicated by id + text and template text is cleaned', async () => {
  await login();
  const raw = fx('objective-progress.txt');
  await parse(raw);
  const prog = events().filter(e => e.eventType === 'objective_update');
  const keys = new Set(raw.split('\n').filter(Boolean).map(l => {
    const g = l.match(PARSER_PATTERNS.objectiveProgress)!.groups!;
    return `${g.objectiveId}|${g.text}`;
  }));
  assert.equal(prog.length, keys.size);
  assert.ok(keys.size < raw.split('\n').filter(Boolean).length, 'fixture contains a duplicate');
  for (const p of prog) assert.ok(!/%ls|~mission/.test(p.objectiveText));
  // same lines again in a later chunk: still nothing new
  const before = emitted.length;
  await parse(raw);
  assert.equal(emitted.length, before);
});

test('reward, emergency services, zones, quantum travel, own status effects', async () => {
  await login();
  await parse(fx('reward.txt'));
  assert.equal(events().find(e => e.eventType === 'reward_earned')?.eventData.reward, 'MG Scrip');
  await parse(fx('emergency.txt'));
  assert.equal(events().filter(e => e.eventType === 'emergency_services').length, 1);
  await parse(fx('zones.txt'));
  const zones = events().filter(e => e.eventType === 'location_change');
  assert.deepEqual(zones.map(z => [z.eventData.zoneType, z.eventData.action]), [['armistice', 'enter'], ['private_property', 'leave']]);
  await parse(fx('quantum.txt'));
  const qt = events().filter(e => e.eventType === 'quantum_travel');
  assert.deepEqual(qt.map(q => q.eventData.phase), ['selected', 'arrived']);
  assert.equal(qt[0].destination, 'Microtech', 'readable name instead of the raw OOC_ id');
  assert.equal(qt[0].eventData.destinationRaw, 'OOC_Stanton_4_Microtech');
  assert.equal(qt[1].eventData.to, 'Microtech');
  assert.equal(qt[0].eventData.vehicle, 'RSI_Galaxy_927281380301');
  await parse(fx('status-effect.txt')); // second line names another player: ignored
  const st = events().filter(e => e.eventType === 'status_effect');
  assert.equal(st.length, 1);
  assert.equal(st[0].eventData.effect, 'Dehydrated');
});

test('PARSER_PATTERN_META covers every PARSER_PATTERNS entry with a valid status', () => {
  const names = Object.keys(PARSER_PATTERNS);
  assert.deepEqual(names.filter(n => !(n in PARSER_PATTERN_META)), []);
  assert.deepEqual(Object.keys(PARSER_PATTERN_META).filter(n => !(n in PARSER_PATTERNS)), []);
  for (const n of names) assert.ok(['active', 'sunset', 'unverified'].includes(PARSER_PATTERN_META[n].status), n);
  assert.equal(PARSER_PATTERN_META.incap.status, 'unverified');
  assert.equal(PARSER_PATTERN_META.newVehicleDestroyed.status, 'unverified');
  for (const n of ['kill', 'environmentDeath', 'vehicleDestruction', 'corpseLog']) assert.equal(PARSER_PATTERN_META[n].status, 'sunset', n);
  assert.equal(PARSER_PATTERN_META.vehicleDestroyed.status, 'active');
});

// ---------------------------------------------------------------------------------------------
// SC 5.0 (PTU 5.0.202, build 13248297) — fixtures *-50.txt are verbatim lines, handles redacted
// ---------------------------------------------------------------------------------------------

const lines50 = (name: string) => fx(name).split('\n').filter(Boolean);
/** Local events straight from the tracker (local-only: the server derives its own from the raw chunks). */
function track(names: string[], user = '<player>') {
  const t = new Sc50LogTracker();
  const outs = names.flatMap(n => lines50(n)).flatMap(l => t.handle(l, user).out);
  outs.push(...t.flushLoadout());
  return { t, local: outs.filter(o => o.local).map(o => o.local!) };
}

test('5.0 bug 1: "Entered Monitored Space" is not a jurisdiction; Entered/Exited both handled', async () => {
  await login();
  await parse(fx('monitored-space-50.txt'));
  const loc = events().filter(e => e.eventType === 'location_change');
  assert.ok(!loc.some(e => /Monitored Space/.test(e.location ?? '')), 'never sets location "Monitored Space"');
  const ms = loc.filter(e => e.eventData?.zoneType === 'monitored_space');
  assert.deepEqual(ms.map(e => e.eventData.action), ['enter', 'leave']);
  const jur = loc.filter(e => !e.eventData);
  assert.deepEqual(jur.map(e => e.eventDescription), ['Entered Ungoverned Jurisdiction', "Entered People's Alliance Jurisdiction"]);
  assert.ok(!PARSER_PATTERNS.jurisdictionEntered.test(lines50('monitored-space-50.txt')[0]));
});

test('5.0 bug 5: gameVersion pattern matches the 5.0 command line and is marked active', () => {
  const m = fx('version-50.txt').match(PARSER_PATTERNS.gameVersion);
  assert.equal(m?.groups?.gameversion, '500-13248297');
  assert.equal(PARSER_PATTERN_META.gameVersion.status, 'active');
});

test('5.0 bug 2: patterns marked active all have a handler; never-seen ones are honest', () => {
  for (const n of ['fatalCollision', 'missionEnded', 'memberLeftNotif', 'refuelRequest', 'missionObjectiveWithdrawn']) {
    assert.notEqual(PARSER_PATTERN_META[n].status, 'active', n);
  }
  for (const n of ['attachmentReceived', 'monitoredSpace', 'qtFuelRequest', 'qtStartLocation', 'hangarRequest']) {
    assert.equal(PARSER_PATTERN_META[n].status, 'active', n);
  }
  assert.equal(PARSER_PATTERN_META.actorStateDead.status, 'sunset');
});

test('5.0 quantum trip (bug 4 + addition 2): names instead of entity ids, obstructed, other ships ignored', async () => {
  await login();
  await parse(fx('qt-trip-obstructed-50.txt'));
  const qt = events().filter(e => e.eventType === 'quantum_travel');
  assert.deepEqual(qt.map(q => q.eventData.phase), ['selected', 'route_planned', 'obstructed'], 'the Polaris arrival is another ship: ignored');
  for (const q of qt) assert.ok(!/\d{9,}/.test(q.eventDescription), `no raw entity id in "${q.eventDescription}"`);
  assert.equal(qt[0].destination, 'Nyx I', "Planet 'nyx1' (entity 877480122483) resolves the target id");
  assert.equal(qt[1].eventDescription, 'Quantum route from Levski to Nyx I');
  assert.equal(qt[1].eventData.fuel, 696301);
  assert.match(qt[2].eventDescription, /blocked to Nyx I/);

  assert.deepEqual(qt[1].eventData, { phase: 'route_planned', from: 'Levski', to: 'Nyx I', fuel: 696301, vehicle: 'RSI_Galaxy_877609015558' });
});

test('5.0 quantum trip: own arrival with from/to and duration; other users\' QT errors never rename our target', () => {
  const { local } = track(['qt-trip-arrived-50.txt']);
  const arrived = local.find(l => l.eventData.phase === 'arrived')!;
  assert.ok(arrived, 'arrived');
  assert.equal(arrived.eventData.from, 'Levski');
  assert.equal(arrived.eventData.to, 'Nyx I');
  assert.equal(arrived.eventData.durationSec, 199);
  assert.equal(arrived.description, 'Quantum travel complete from Levski to Nyx I');
  assert.equal(arrived.timestamp, '2026-11-21T22:03:58.639Z');
  // the "Aligned Target: Nyx1" line belongs to Pilot1, not to us
  const t2 = track(['qt-trip-arrived-50.txt'], 'Pilot1');
  assert.ok(t2.local.filter(l => l.eventType === 'quantum_travel').every(l => l.destination === 'Nyx I'));
});

test('5.0 quantum: our own "Aligned Target" names the destination', () => {
  const t = new Sc50LogTracker();
  const sel = lines50('qt-trip-arrived-50.txt').filter(l => /Selected Quantum Target|Requested Fuel/.test(l));
  for (const l of sel) t.handle(l, '<player>');
  t.handle(lines50('qt-own-aligned-50.txt')[0], '<player>');
  const out = t.handle(lines50('qt-trip-arrived-50.txt').find(l => /Quantum Drive Arrived/.test(l))!, '<player>').out;
  assert.equal(out[0].local!.eventData.to, 'Hub');
});

test('prettyPlace: readable names, bare ids hidden', () => {
  assert.equal(prettyPlace('Nyx_Levski'), 'Levski (Nyx)');
  assert.equal(prettyPlace('sector_ht_a_swamp_001 (Northern Reach)'), 'Northern Reach');
  assert.equal(prettyPlace("location_ht_a_habitation_m_hubremote_001 (Ozaki's Central)"), "Ozaki's Central");
  assert.equal(prettyPlace('OOC_Stanton_4_Microtech'), 'Microtech');
  assert.equal(prettyPlace('nyx1'), 'Nyx I');
  assert.equal(prettyPlace('877562123546'), undefined);
});

test('5.0 addition 1: Incapacitated HUD notification → local event (the server stores the log player_downed)', async () => {
  await login();
  await parse(fx('incap-50.txt'));
  const inc = events().filter(e => e.eventType === 'incapacitated');
  assert.equal(inc.length, 1, 'the echo line does not double it');
  assert.equal(inc[0].timestamp, '2026-11-21T17:23:34.951Z');
});

test('5.0 addition 3: ship delivery — at spawn time, hangar name from the wrapped line, fleet size', async () => {
  await login();
  await parse(fx('hangar-50.txt'));
  const h = events().filter(e => e.eventType === 'hangar');
  // "Hangar Request Completed" (21:59:14) is the ATC request after boarding: local only
  assert.deepEqual(h.map(e => e.eventData.action), ['retrieved', 'request_completed']);
  assert.equal(h[0].timestamp, '2026-11-21T21:54:23.138Z', 'delivered when the ship spawns');
  assert.equal(h[0].eventData.hangar, 'XL Hangar');
  assert.equal(h[0].eventData.vehicleId, '877604806898');
  assert.equal(h[0].eventData.fleetSize, 55);
  // the hangar name must never leak the handle; someone else's hangar name is dropped
  assert.ok(!JSON.stringify(track(['hangar-50.txt']).local).includes('<player>'));
  // a later single-vehicle query ("0 out of 1") does not shrink the fleet
  const t = new Sc50LogTracker();
  const ls = lines50('hangar-50.txt');
  t.handle(ls[0], '<player>');
  t.handle(ls[0].replace('55 entitlements out of 55', '0 entitlements out of 1'), '<player>');
  const outs = ls.slice(1).flatMap(l => t.handle(l, '<player>').out);
  assert.equal(outs[0].local!.eventData.fleetSize, 55);
  const other = track(['hangar-50.txt'], 'SomeoneElse').local;
  assert.equal(other[0].eventData.hangar, undefined);
});

test('5.0 hangar: "Joined hangar queue." (real line from LIVE 4.x) → hangar_queued', () => {
  const t = new Sc50LogTracker();
  const out = t.handle('<2026-03-26T21:06:59.578Z> [Notice] <SHUDEvent_OnNotification> Added notification "Joined hangar queue.', '<player>').out;
  assert.equal(out[0].local!.eventData.action, 'queued');
});

test('5.0 addition 4: readable location from RequestLocationInventory (own player only, numeric Update Inventory Location ignored)', async () => {
  await login();
  await parse(fx('location-inventory-50.txt'));
  const loc = events().filter(e => e.eventData?.zoneType === 'inventory_location');
  assert.deepEqual(loc.map(e => e.location), ['Levski (Nyx)', 'Northern Reach', "Ozaki's Central"]);
  assert.deepEqual(track(['location-inventory-50.txt']).local.map(l => [l.eventType, l.location]), [
    ['location_change', 'Levski (Nyx)'], ['location_change', 'Northern Reach'], ['location_change', "Ozaki's Central"]]);
  assert.equal(track(['location-inventory-50.txt'], 'SomeoneElse').local.length, 0);
});

test('5.0 addition 5: medical bed and the loadout burst after spawn (counter)', async () => {
  await login();
  await parse(fx('medical-bed-50.txt'));
  assert.equal(events().filter(e => e.eventType === 'medical').length, 1);

  clearEmitted();
  await parse(fx('attachments-50.txt'));
  // burst still open at the end of the chunk; a later line closes it
  await parse('<2026-11-21T21:54:05.000Z> [Notice] <Something> unrelated\n');
  const lo = events().filter(e => e.eventType === 'loadout');
  assert.equal(lo.length, 1);
  assert.equal(lo[0].eventData.items, 6);
  assert.equal(lo[0].eventData.armorPieces, 5, "undersuit, arms, helmet, legs, torso");
});
