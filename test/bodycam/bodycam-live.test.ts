import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LiveSharer, LIVE_DEADMAN_MS, LIVE_RESTART_DEBOUNCE_MS, LIVE_WARM_MS, type LiveDeps, type LiveParams } from '../../electron/modules/bodycam-live';

const PARAMS: LiveParams = { fps: 5, width: 480, height: 270, maxFrameBytes: 10_000, maxKbps: 400, viewers: 1 };

function harness(over: Partial<LiveDeps> & { jpegBytes?: number } = {}) {
  const log = { sent: 0, opened: [] as string[], closed: 0, grabs: [] as number[], finds: 0 };
  const timers: Array<{ fn: () => void; ms: number }> = [];
  let t = 1_000_000;
  const deps: LiveDeps = {
    getSettings: () => ({ enabled: true, allowLive: true, orgs: ['VOID'] }),
    isGameRunning: () => true,
    isOnline: () => true,
    findWindow: async () => (log.finds++, { sourceId: 'window:7:0' }),
    openCapture: async (id) => void log.opened.push(id),
    grab: async (q) => (log.grabs.push(q), { jpeg: Buffer.alloc(over.jpegBytes ?? 5000, 1), blank: false }),
    closeCapture: () => void log.closed++,
    send: () => (log.sent++, true),
    setTimer: (fn, ms) => (timers.push({ fn, ms }), timers.length),
    clearTimer: () => undefined,
    now: () => t,
    ...over,
  };
  return { live: new LiveSharer(deps), log, timers, advance: (ms: number) => (t += ms) };
}

test('does nothing until the server asks (no viewers = no capture)', async () => {
  const { live, log } = harness();
  await live.tick();
  assert.equal(live.active, false);
  assert.equal(log.finds, 0);
  assert.equal(log.sent, 0);
});

test('starts on the server command, sends frames, stops immediately on bodycam_live_stop', async () => {
  const { live, log, timers } = harness();
  live.start(PARAMS);
  assert.equal(live.active, true);
  assert.equal(timers[0].ms, 0);
  await live.tick();
  assert.deepEqual(log.opened, ['window:7:0']);
  assert.equal(log.sent, 1);
  assert.equal(live.status.state, 'live');
  assert.equal(timers.at(-1)!.ms, 200); // 5 fps
  live.stop();
  assert.equal(live.active, false);
  assert.ok(log.closed >= 1);
  assert.equal(live.status.state, 'idle');
  await live.tick(); // late tick after stop captures nothing
  assert.equal(log.sent, 1);
});

test('never starts unless screenshots sharing AND "allow live view" are both on', async () => {
  for (const s of [{ enabled: false, allowLive: true, orgs: ['VOID'] }, { enabled: true, allowLive: false, orgs: ['VOID'] }, { enabled: true, allowLive: true, orgs: [] }]) {
    const { live, log } = harness({ getSettings: () => s });
    live.start(PARAMS);
    assert.equal(live.active, false);
    await live.tick();
    assert.equal(log.finds, 0);
    assert.equal(log.sent, 0);
  }
});

test('turning the setting off mid-stream stops at the next tick', async () => {
  let allow = true;
  const { live, log } = harness({ getSettings: () => ({ enabled: true, allowLive: allow, orgs: ['VOID'] }) });
  live.start(PARAMS);
  await live.tick();
  allow = false;
  await live.tick();
  assert.equal(live.active, false);
  assert.equal(log.sent, 1);
});

test('captures nothing when the game window cannot be verified (title/process check failed)', async () => {
  const { live, log } = harness({ findWindow: async () => null });
  live.start(PARAMS);
  await live.tick();
  assert.equal(log.grabs.length, 0);
  assert.equal(log.sent, 0);
  assert.equal(live.status.state, 'blocked');
});

test('captures nothing when the game is not running or the link is down', async () => {
  for (const over of [{ isGameRunning: () => false }, { isOnline: () => false }]) {
    const { live, log, timers } = harness(over);
    live.start(PARAMS);
    await live.tick();
    assert.equal(log.grabs.length, 0);
    assert.equal(log.finds, 0);
    assert.equal(timers.at(-1)!.ms, 2000);
  }
});

test('blank frames are skipped', async () => {
  const { live, log } = harness({ grab: async () => ({ jpeg: Buffer.alloc(3000), blank: true }) });
  live.start(PARAMS);
  await live.tick();
  assert.equal(log.sent, 0);
  assert.equal(live.status.detail, 'blank frame');
});

test('dead-man: stops by itself when the server keepalive is missing for 60 s; keepalive prevents it', async () => {
  const a = harness();
  a.live.start(PARAMS);
  await a.live.tick();
  a.advance(LIVE_DEADMAN_MS - 1000);
  a.live.start({ ...PARAMS, viewers: 2 }); // keepalive
  a.advance(LIVE_DEADMAN_MS - 1000);
  await a.live.tick();
  assert.equal(a.live.active, true);
  assert.equal(a.live.status.viewers, 2);
  a.advance(2000);
  await a.live.tick();
  assert.equal(a.live.active, false);
  assert.match(a.live.status.detail ?? '', /keepalive/);
});

test('re-verifies the window every 30 s and switches/stops capture when it changes', async () => {
  let id: string | null = 'window:7:0';
  const { live, log, advance } = harness({ findWindow: async () => (id ? { sourceId: id } : null) });
  live.start(PARAMS);
  await live.tick();
  advance(10_000);
  live.start(PARAMS);
  await live.tick();
  assert.equal(log.opened.length, 1); // not re-checked yet
  advance(25_000);
  live.start(PARAMS);
  id = 'window:9:0';
  await live.tick();
  assert.deepEqual(log.opened, ['window:7:0', 'window:9:0']);
  advance(31_000);
  live.start(PARAMS);
  id = null;
  const sent = log.sent;
  await live.tick();
  assert.equal(log.sent, sent);
});

test('adapts JPEG quality down when frames are over the budget and skips those frames', async () => {
  const { live, log } = harness({ jpegBytes: 12_000 });
  live.start(PARAMS);
  await live.tick();
  await live.tick();
  assert.equal(log.sent, 0);
  assert.ok(log.grabs[1] < log.grabs[0]);
});

test('local bitrate cap: at 8 fps with big frames the sent bytes stay under 400 kbps', async () => {
  const { live, log, advance } = harness({ jpegBytes: 9_500 });
  live.start({ ...PARAMS, fps: 8 });
  for (let i = 0; i < 80; i++) {
    advance(125);
    live.start({ ...PARAMS, fps: 8 });
    await live.tick();
  }
  const seconds = 10;
  assert.ok(log.sent * 9_500 <= 50_000 * seconds + 50_000, `sent ${log.sent * 9_500} bytes`);
});

test('a throwing capture closes the source and backs off instead of crashing', async () => {
  const { live, log, timers } = harness({ grab: async () => { throw new Error('gum failed'); } });
  live.start(PARAMS);
  await live.tick();
  assert.equal(live.active, true);
  assert.ok(log.closed >= 1);
  assert.equal(timers.at(-1)!.ms, 2000);
  assert.equal(live.status.state, 'blocked');
});

test('soft stop keeps the hidden capture warm for 10 s, then closes it; a quick re-watch reuses it', async () => {
  const { live, log, timers, advance } = harness();
  live.start(PARAMS);
  await live.tick();
  assert.equal(log.opened.length, 1);
  const closedBefore = log.closed;
  live.stop('stopped', { soft: true });
  assert.equal(live.active, false); // frames stop immediately
  assert.equal(log.closed, closedBefore); // capture still warm
  const warm = timers.at(-1)!;
  assert.equal(warm.ms, LIVE_WARM_MS);
  // re-watch after the debounce reuses the open capture
  advance(LIVE_RESTART_DEBOUNCE_MS + 1);
  live.start(PARAMS);
  assert.equal(timers.at(-1)!.ms, 0);
  await live.tick();
  assert.equal(log.opened.length, 1);
  assert.equal(log.closed, closedBefore);
  // and a soft stop that is not followed by a start closes it when the warm timer fires
  live.stop('stopped', { soft: true });
  timers.at(-1)!.fn();
  assert.equal(log.closed, closedBefore + 1);
});

test('stop -> start within 3 s is held back until the debounce has passed', async () => {
  const { live, timers, advance } = harness();
  live.start(PARAMS);
  await live.tick();
  live.stop('stopped', { soft: true });
  advance(1000);
  live.start(PARAMS);
  assert.equal(timers.at(-1)!.ms, LIVE_RESTART_DEBOUNCE_MS - 1000);
});

test('hard stops (setting off, not allowed) close the capture immediately', async () => {
  const { live, log } = harness();
  live.start(PARAMS);
  await live.tick();
  const c = log.closed;
  live.stop('live view off');
  assert.equal(log.closed, c + 1);
});

test('a warm capture is re-verified before the first frame of the next watch', async () => {
  const { live, log, advance } = harness();
  live.start(PARAMS);
  await live.tick();
  live.stop('stopped', { soft: true });
  advance(LIVE_RESTART_DEBOUNCE_MS + 1);
  live.start(PARAMS);
  const finds = log.finds;
  await live.tick();
  assert.equal(log.finds, finds + 1);
});

test('server rejection reasons are surfaced in the status', async () => {
  const { live } = harness();
  live.start(PARAMS);
  live.noteServerRejection('EXIF/XMP metadata (APP1) is not allowed');
  assert.match(live.status.detail ?? '', /live frames rejected: EXIF/);
});

test('closes the capture on the next tick once the game window is minimised or closed', async () => {
  let alive = true;
  let checks = 0;
  const { live, log, advance } = harness({ windowAlive: async () => (checks++, alive) });
  live.start(PARAMS);
  await live.tick();
  assert.equal(log.sent, 1);
  assert.equal(checks, 1);
  alive = false;
  advance(200);
  await live.tick(); // within the 1 s presence interval: no extra check, still capturing
  assert.equal(checks, 1);
  assert.equal(log.sent, 2);
  advance(1000);
  const closedBefore = log.closed;
  await live.tick();
  assert.equal(checks, 2);
  assert.equal(log.closed, closedBefore + 1);
  assert.equal(log.sent, 2); // no frozen frame sent
  assert.equal(live.status.state, 'blocked');
  assert.match(live.status.detail ?? '', /closed or minimised/);
});

test('re-opens the capture when the window comes back', async () => {
  let alive = false;
  const { live, log, advance } = harness({ windowAlive: async () => alive });
  live.start(PARAMS);
  await live.tick();
  assert.equal(log.sent, 0);
  alive = true;
  advance(1500);
  await live.tick();
  assert.equal(log.opened.length, 2);
  assert.equal(log.sent, 1);
});
