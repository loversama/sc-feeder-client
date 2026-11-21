import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BodycamSharer,
  BODYCAM_DEFAULT_INTERVAL_S,
  BODYCAM_MAX_BYTES,
  clampInterval,
  encodeFrame,
  isBlankBitmap,
  makeTitleMatcher,
  selectGameWindow,
  type BodycamDeps,
  type CamImage,
  type CamSource,
} from '../../electron/modules/bodycam';

/** Fake NativeImage: `kind` picks the pixel content. */
function img(kind: 'game' | 'black' | 'empty' = 'game', w = 640, h = 360, jpegBytes = 20_000): CamImage & { qualities: number[] } {
  const qualities: number[] = [];
  return {
    qualities,
    isEmpty: () => kind === 'empty',
    getSize: () => ({ width: w, height: h }),
    toBitmap: () => {
      const b = Buffer.alloc(w * h * 4);
      if (kind === 'game') for (let i = 0; i < b.length; i++) b[i] = (i * 31 + (i >> 4)) & 0xff;
      return b;
    },
    toJPEG: (q: number) => {
      qualities.push(q);
      return Buffer.alloc(Math.round(jpegBytes * (q / 60)), 1);
    },
  };
}
const src = (id: string, name: string, i: CamImage = img()): CamSource => ({ id, name, thumbnail: i });
const M = makeTitleMatcher(undefined);

test('window selection picks only the Star Citizen window', () => {
  const sources = [src('window:1:0', 'Discord'), src('window:2:0', 'Star Citizen'), src('window:3:0', 'Notepad')];
  assert.equal(selectGameWindow(sources, M)?.id, 'window:2:0');
  assert.equal(selectGameWindow([src('window:1:0', 'Discord')], M), null);
});

test('window selection never returns a screen source even if its name matches', () => {
  assert.equal(selectGameWindow([src('screen:0:0', 'Star Citizen')], M), null);
  assert.equal(selectGameWindow([src('screen:0:0', 'Entire screen'), src('window:9:0', 'Star Citizen')], M)?.id, 'window:9:0');
});

test('title matcher is EXACT (no suffix/prefix) and falls back to the default on a bad override', () => {
  assert.equal(selectGameWindow([src('window:1:0', 'Chat about Star Citizen - Discord')], M), null);
  assert.equal(selectGameWindow([src('window:1:0', 'Star Citizen - Google Chrome')], M), null);
  assert.equal(selectGameWindow([src('window:1:0', 'Star Citizen Wiki')], M), null);
  assert.equal(selectGameWindow([src('window:1:0', 'star citizen')], M)?.id, 'window:1:0');
  assert.equal(selectGameWindow([src('window:1:0', 'StarCitizen')], makeTitleMatcher('^StarCitizen$'))?.id, 'window:1:0');
  // invalid user regex falls back to the default
  assert.equal(selectGameWindow([src('window:1:0', 'Star Citizen')], makeTitleMatcher('(['))?.id, 'window:1:0');
});

test('more than one matching window = capture nothing (never guess)', () => {
  const two = [src('window:1:0', 'Star Citizen'), src('window:2:0', 'Star Citizen')];
  assert.equal(selectGameWindow(two, M), null);
  // an empty-thumbnail twin still counts as a second match
  assert.equal(selectGameWindow([src('window:1:0', 'Star Citizen'), src('window:2:0', 'Star Citizen', img('empty'))], M), null);
});

test('malformed source ids are ignored', () => {
  assert.equal(selectGameWindow([src('window:abc:0', 'Star Citizen')], M), null);
  assert.equal(selectGameWindow([src('window:12', 'Star Citizen')], M), null);
});

test('minimised (empty thumbnail) game window is not selected', () => {
  assert.equal(selectGameWindow([src('window:1:0', 'Star Citizen', img('empty'))], M), null);
});

test('blank/black frames are detected, real frames are not', () => {
  assert.equal(isBlankBitmap(img('black').toBitmap()), true);
  assert.equal(isBlankBitmap(Buffer.alloc(0)), true);
  assert.equal(isBlankBitmap(img('game').toBitmap()), false);
});

test('encode steps quality down to stay under the target and refuses oversized frames', () => {
  const ok = img('game', 640, 360, 100_000); // q60=100KB q50=83KB q40=66KB q30=50KB -> 50KB > 40KB, <= 70KB at q30
  const out = encodeFrame(ok)!;
  assert.deepEqual(ok.qualities, [60, 50, 40, 30]);
  assert.ok(out.length <= BODYCAM_MAX_BYTES);
  assert.equal(encodeFrame(img('game', 640, 360, 400_000)), null);
  assert.equal(encodeFrame(img('game', 640, 360, 30_000))!.length, 30_000);
});

test('interval is clamped 5..60 with a 15 s default', () => {
  assert.equal(clampInterval(1), 5);
  assert.equal(clampInterval(500), 60);
  assert.equal(clampInterval(undefined), BODYCAM_DEFAULT_INTERVAL_S);
  assert.equal(clampInterval(20), 20);
});

function harness(over: Partial<BodycamDeps> & { sources?: CamSource[]; settings?: any } = {}) {
  const calls = { sources: [] as any[], uploads: [] as Buffer[] };
  const timers: Array<{ fn: () => void; ms: number }> = [];
  const deps: BodycamDeps = {
    getSettings: () => over.settings ?? { enabled: true, intervalSec: 15, orgs: ['VOID'] },
    isGameRunning: () => true,
    isOnline: () => true,
    isGameWindow: async () => true,
    getWindowSources: async (o) => (calls.sources.push(o), over.sources ?? [src('window:2:0', 'Star Citizen')]),
    upload: async (f) => (calls.uploads.push(f), { ok: true }),
    setTimer: (fn, ms) => (timers.push({ fn, ms }), timers.length),
    clearTimer: () => undefined,
    now: () => 1_000_000,
    ...over,
  };
  return { sharer: new BodycamSharer(deps), calls, timers };
}

test('sharer only ever asks for window sources (never screens) with the small thumbnail', async () => {
  const { sharer, calls } = harness();
  const s = await sharer.tick();
  assert.equal(s.state, 'sharing');
  assert.deepEqual(calls.sources[0], { types: ['window'], thumbnailSize: { width: 640, height: 360 }, fetchWindowIcons: false });
  assert.equal(calls.uploads.length, 1);
});

test('nothing is captured when sharing is off, no org is chosen, the game is not running, or offline', async () => {
  for (const [name, over, state] of [
    ['disabled', { settings: { enabled: false, intervalSec: 15, orgs: ['VOID'] } }, 'off'],
    ['no orgs', { settings: { enabled: true, intervalSec: 15, orgs: [] } }, 'off'],
    ['game closed', { isGameRunning: () => false }, 'game-not-running'],
    ['offline', { isOnline: () => false }, 'offline'],
  ] as const) {
    const { sharer, calls } = harness(over as any);
    const s = await sharer.tick();
    assert.equal(s.state, state, name);
    assert.equal(calls.sources.length, 0, `${name}: must not touch the capturer`);
    assert.equal(calls.uploads.length, 0, name);
  }
});

test('window not found / minimised / blank frames are skipped with a status', async () => {
  let h = harness({ sources: [src('window:1:0', 'Discord')] });
  assert.equal((await h.sharer.tick()).state, 'window-not-found');
  h = harness({ sources: [src('window:2:0', 'Star Citizen', img('empty'))] });
  assert.equal((await h.sharer.tick()).state, 'window-not-found');
  h = harness({ sources: [src('window:2:0', 'Star Citizen', img('black'))] });
  assert.equal((await h.sharer.tick()).state, 'blank-frame');
  assert.equal(h.calls.uploads.length, 0);
});

test('no backlog: a failed/unacked upload is dropped, not retried', async () => {
  const { sharer, calls } = harness({ upload: async (f) => (calls2.push(f), undefined) });
  const calls2: Buffer[] = [];
  assert.equal((await sharer.tick()).state, 'offline');
  assert.equal(calls2.length, 1);
});

test('rate-limited ack backs off for at least the requested time', async () => {
  const { sharer, timers } = harness({ upload: async () => ({ ok: false, error: 'rate limited', retryInMs: 30_000 }) });
  sharer.start();
  await new Promise((r) => setImmediate(r));
  const t = timers[0];
  t.fn();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(sharer.status.state, 'rejected');
  assert.ok(timers.at(-1)!.ms >= 30_000);
});

test('stop() cancels the loop and resets to off', async () => {
  const { sharer, timers } = harness();
  sharer.start();
  assert.equal(sharer.active, true);
  sharer.stop();
  assert.equal(sharer.active, false);
  assert.equal(sharer.status.state, 'off');
  const n = timers.length;
  await sharer.tick(); // late tick after stop must not reschedule
  assert.equal(timers.length, n);
});

test('uses the configured interval between frames', async () => {
  const { sharer, timers } = harness({ settings: { enabled: true, intervalSec: 30, orgs: ['VOID'] } });
  sharer.start();
  timers[0].fn();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(timers.at(-1)!.ms, 30_000);
});

test('a window titled like the game that is NOT owned by StarCitizen.exe is never captured', async () => {
  const checked: string[] = [];
  const { sharer, calls } = harness({ isGameWindow: async (h) => (checked.push(h), false) });
  const st = await sharer.tick();
  assert.equal(st.state, 'window-not-found');
  assert.deepEqual(checked, ['2']);
  assert.equal(calls.uploads.length, 0);
});

test('process-check failure (throws) fails closed', async () => {
  const { sharer, calls } = harness({ isGameWindow: async () => { throw new Error('powershell missing'); } });
  assert.equal((await sharer.tick()).state, 'window-not-found');
  assert.equal(calls.uploads.length, 0);
});

test("'not sharing' re-syncs once, then pauses until resume()", async () => {
  let resyncs = 0;
  const calls3: Buffer[] = [];
  const { sharer, calls } = harness({ upload: async (f) => (calls3.push(f), { ok: false, error: 'not sharing' }), resync: async () => { resyncs++; } });
  await sharer.tick();
  assert.equal(resyncs, 1);
  await sharer.tick(); // still refused -> pause
  assert.equal(resyncs, 1);
  const n = calls3.length;
  const st = await sharer.tick(); // paused: no capture at all
  assert.equal(calls3.length, n);
  assert.equal(calls.sources.length, n);
  assert.match(st.detail ?? '', /paused/);
  sharer.resume();
  await sharer.tick();
  assert.equal(calls3.length, n + 1);
});
