// test/bodycam/bodycam.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

// electron/modules/bodycam-window.ts
var GAME_PROCESS_NAME = "StarCitizen";
function hwndFromSourceId(id) {
  const m = /^window:(\d{1,20}):\d+$/.exec(id);
  return m ? m[1] : null;
}
var PS_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  `$m = @(Get-Process -Name ${GAME_PROCESS_NAME} -ErrorAction SilentlyContinue | ForEach-Object { $_.MainWindowHandle.ToInt64() })`,
  "if ($m -contains [int64]$h) { 'yes' } else { 'no' }"
].join("; ");

// electron/modules/bodycam.ts
var BODYCAM_THUMB = { width: 640, height: 360 };
var BODYCAM_MIN_INTERVAL_S = 5;
var BODYCAM_MAX_INTERVAL_S = 60;
var BODYCAM_DEFAULT_INTERVAL_S = 15;
var BODYCAM_MAX_BYTES = 70 * 1024;
var BODYCAM_TARGET_BYTES = 40 * 1024;
var BODYCAM_DEFAULT_TITLE_PATTERN = "^Star Citizen$";
var VERIFY_FAILED_MESSAGE = "Couldn't verify the game window \u2014 screenshots paused";
function makeTitleMatcher(pattern) {
  try {
    if (pattern && pattern.trim()) return new RegExp(pattern, "i");
  } catch {
  }
  return new RegExp(BODYCAM_DEFAULT_TITLE_PATTERN, "i");
}
function matchingWindows(sources, matcher) {
  return sources.filter((s) => typeof s?.id === "string" && /^window:\d+:\d+$/.test(s.id) && typeof s.name === "string" && matcher.test(s.name.trim()));
}
function selectGameWindow(sources, matcher) {
  const m = matchingWindows(sources, matcher);
  if (m.length !== 1) return null;
  const only = m[0];
  return only.thumbnail && !only.thumbnail.isEmpty() ? only : null;
}
function isBlankBitmap(bitmap, step = 4) {
  const pixels = Math.floor(bitmap.length / 4);
  if (pixels === 0) return true;
  let n = 0;
  let sum = 0;
  let sumSq = 0;
  for (let p = 0; p < pixels; p += step) {
    const i = p * 4;
    const l = (bitmap[i] + bitmap[i + 1] + bitmap[i + 2]) / 3;
    sum += l;
    sumSq += l * l;
    n++;
  }
  const mean = sum / n;
  const variance = Math.max(0, sumSq / n - mean * mean);
  return Math.sqrt(variance) < 1.5;
}
function encodeFrame(img2) {
  for (const q of [60, 50, 40, 30]) {
    const jpg = img2.toJPEG(q);
    if (jpg.length <= BODYCAM_TARGET_BYTES || q <= 30 && jpg.length <= BODYCAM_MAX_BYTES) return jpg;
  }
  return null;
}
function clampInterval(sec) {
  const n = typeof sec === "number" && Number.isFinite(sec) ? Math.round(sec) : BODYCAM_DEFAULT_INTERVAL_S;
  return Math.min(BODYCAM_MAX_INTERVAL_S, Math.max(BODYCAM_MIN_INTERVAL_S, n));
}
var BodycamSharer = class {
  #d;
  #timer = null;
  #running = false;
  #busy = false;
  #backoffUntil = 0;
  #resynced = false;
  #paused = false;
  status = { state: "off", lastSentAt: null, framesSent: 0, lastBytes: null };
  constructor(deps) {
    this.#d = deps;
  }
  get active() {
    return this.#running;
  }
  start() {
    if (this.#running) return;
    this.#running = true;
    this.#schedule(0);
  }
  /** Settings changed / reconnected: forget a server-side pause and try again. */
  resume() {
    this.#paused = false;
    this.#resynced = false;
    this.#backoffUntil = 0;
  }
  stop() {
    this.#running = false;
    if (this.#timer != null) (this.#d.clearTimer ?? clearTimeout)(this.#timer);
    this.#timer = null;
    this.#set({ state: "off" });
  }
  #schedule(ms) {
    if (!this.#running) return;
    this.#timer = (this.#d.setTimer ?? setTimeout)(() => void this.tick(), ms);
  }
  #set(p) {
    this.status = { ...this.status, ...p, detail: p.detail };
    this.#d.onStatus?.(this.status);
  }
  #lastVerdict = false;
  async #safeIsGameWindow(hwnd) {
    try {
      this.#lastVerdict = await this.#d.isGameWindow(hwnd);
    } catch {
      this.#lastVerdict = "unknown";
    }
    return this.#lastVerdict === true;
  }
  /** One capture attempt (exported for tests). Always reschedules while running. */
  async tick() {
    if (this.#busy) return this.status;
    this.#busy = true;
    const s = this.#d.getSettings();
    let next = clampInterval(s.intervalSec) * 1e3;
    try {
      const now = (this.#d.now ?? Date.now)();
      if (!s.enabled || !s.orgs.length) {
        this.#set({ state: "off" });
      } else if (!this.#d.isGameRunning()) {
        this.#set({ state: "game-not-running" });
      } else if (!this.#d.isOnline()) {
        this.#set({ state: "offline" });
      } else if (this.#paused) {
        this.#set({ state: "rejected", detail: "paused: the server is not sharing your frames. Re-toggle sharing or reconnect" });
      } else if (now < this.#backoffUntil) {
      } else {
        const sources = await this.#d.getWindowSources({ types: ["window"], thumbnailSize: { ...BODYCAM_THUMB }, fetchWindowIcons: false });
        const matcher = makeTitleMatcher(s.titlePattern);
        const candidates = matchingWindows(sources, matcher);
        const win = selectGameWindow(sources, matcher);
        const hwnd = win ? hwndFromSourceId(win.id) : null;
        if (candidates.length > 1) {
          this.#set({ state: "window-not-found", detail: "more than one window is titled like the game; capturing nothing" });
        } else if (!win || !hwnd) {
          this.#set({ state: "window-not-found" });
        } else if (await this.#safeIsGameWindow(hwnd) !== true) {
          const unknown = this.#lastVerdict === "unknown";
          this.#set({ state: "window-not-found", detail: unknown ? VERIFY_FAILED_MESSAGE : "the window is not owned by StarCitizen.exe; capturing nothing" });
        } else if (isBlankBitmap(win.thumbnail.toBitmap())) {
          this.#set({ state: "blank-frame" });
        } else {
          const jpg = encodeFrame(win.thumbnail);
          if (!jpg) {
            this.#set({ state: "error", detail: "frame too large" });
          } else {
            const ack = await this.#d.upload(jpg, new Date(now).toISOString());
            if (!ack) {
              this.#set({ state: "offline" });
            } else if (ack.ok) {
              this.#resynced = false;
              this.#set({ state: "sharing", detail: void 0, lastSentAt: now, framesSent: this.status.framesSent + 1, lastBytes: jpg.length });
            } else {
              if (ack.error === "not sharing") {
                if (!this.#resynced && this.#d.resync) {
                  this.#resynced = true;
                  try {
                    await this.#d.resync();
                  } catch {
                  }
                } else {
                  this.#paused = true;
                }
              }
              if (ack.retryInMs) this.#backoffUntil = now + ack.retryInMs;
              if (ack.error === "rate limited") next = Math.max(next, ack.retryInMs ?? 0);
              this.#set({ state: "rejected", detail: ack.error });
              this.#d.log?.("warn", `Body-cam frame rejected: ${ack.error}`);
            }
          }
        }
      }
    } catch (err) {
      this.#set({ state: "error", detail: err.message });
      this.#d.log?.("warn", `Body-cam capture failed: ${err.message}`);
    } finally {
      this.#busy = false;
      this.#schedule(next);
    }
    return this.status;
  }
};

// test/bodycam/bodycam.test.ts
function img(kind = "game", w = 640, h = 360, jpegBytes = 2e4) {
  const qualities = [];
  return {
    qualities,
    isEmpty: () => kind === "empty",
    getSize: () => ({ width: w, height: h }),
    toBitmap: () => {
      const b = Buffer.alloc(w * h * 4);
      if (kind === "game") for (let i = 0; i < b.length; i++) b[i] = i * 31 + (i >> 4) & 255;
      return b;
    },
    toJPEG: (q) => {
      qualities.push(q);
      return Buffer.alloc(Math.round(jpegBytes * (q / 60)), 1);
    }
  };
}
var src = (id, name, i = img()) => ({ id, name, thumbnail: i });
var M = makeTitleMatcher(void 0);
test("window selection picks only the Star Citizen window", () => {
  const sources = [src("window:1:0", "Discord"), src("window:2:0", "Star Citizen"), src("window:3:0", "Notepad")];
  assert.equal(selectGameWindow(sources, M)?.id, "window:2:0");
  assert.equal(selectGameWindow([src("window:1:0", "Discord")], M), null);
});
test("window selection never returns a screen source even if its name matches", () => {
  assert.equal(selectGameWindow([src("screen:0:0", "Star Citizen")], M), null);
  assert.equal(selectGameWindow([src("screen:0:0", "Entire screen"), src("window:9:0", "Star Citizen")], M)?.id, "window:9:0");
});
test("title matcher is EXACT (no suffix/prefix) and falls back to the default on a bad override", () => {
  assert.equal(selectGameWindow([src("window:1:0", "Chat about Star Citizen - Discord")], M), null);
  assert.equal(selectGameWindow([src("window:1:0", "Star Citizen - Google Chrome")], M), null);
  assert.equal(selectGameWindow([src("window:1:0", "Star Citizen Wiki")], M), null);
  assert.equal(selectGameWindow([src("window:1:0", "star citizen")], M)?.id, "window:1:0");
  assert.equal(selectGameWindow([src("window:1:0", "StarCitizen")], makeTitleMatcher("^StarCitizen$"))?.id, "window:1:0");
  assert.equal(selectGameWindow([src("window:1:0", "Star Citizen")], makeTitleMatcher("(["))?.id, "window:1:0");
});
test("more than one matching window = capture nothing (never guess)", () => {
  const two = [src("window:1:0", "Star Citizen"), src("window:2:0", "Star Citizen")];
  assert.equal(selectGameWindow(two, M), null);
  assert.equal(selectGameWindow([src("window:1:0", "Star Citizen"), src("window:2:0", "Star Citizen", img("empty"))], M), null);
});
test("malformed source ids are ignored", () => {
  assert.equal(selectGameWindow([src("window:abc:0", "Star Citizen")], M), null);
  assert.equal(selectGameWindow([src("window:12", "Star Citizen")], M), null);
});
test("minimised (empty thumbnail) game window is not selected", () => {
  assert.equal(selectGameWindow([src("window:1:0", "Star Citizen", img("empty"))], M), null);
});
test("dark scenes are not blank; only truly uniform frames are", () => {
  const dark = Buffer.alloc(640 * 360 * 4);
  for (let i = 0; i < dark.length; i += 4) {
    const v = (i * 7 + (i >> 5)) % 9;
    dark[i] = v;
    dark[i + 1] = v;
    dark[i + 2] = v;
    dark[i + 3] = 255;
  }
  assert.equal(isBlankBitmap(dark), false);
  assert.equal(isBlankBitmap(Buffer.alloc(640 * 360 * 4, 200)), true);
});
test("blank/black frames are detected, real frames are not", () => {
  assert.equal(isBlankBitmap(img("black").toBitmap()), true);
  assert.equal(isBlankBitmap(Buffer.alloc(0)), true);
  assert.equal(isBlankBitmap(img("game").toBitmap()), false);
});
test("encode steps quality down to stay under the target and refuses oversized frames", () => {
  const ok = img("game", 640, 360, 1e5);
  const out = encodeFrame(ok);
  assert.deepEqual(ok.qualities, [60, 50, 40, 30]);
  assert.ok(out.length <= BODYCAM_MAX_BYTES);
  assert.equal(encodeFrame(img("game", 640, 360, 4e5)), null);
  assert.equal(encodeFrame(img("game", 640, 360, 3e4)).length, 3e4);
});
test("interval is clamped 5..60 with a 15 s default", () => {
  assert.equal(clampInterval(1), 5);
  assert.equal(clampInterval(500), 60);
  assert.equal(clampInterval(void 0), BODYCAM_DEFAULT_INTERVAL_S);
  assert.equal(clampInterval(20), 20);
});
function harness(over = {}) {
  const calls = { sources: [], uploads: [] };
  const timers = [];
  const deps = {
    getSettings: () => over.settings ?? { enabled: true, intervalSec: 15, orgs: ["VOID"] },
    isGameRunning: () => true,
    isOnline: () => true,
    isGameWindow: async () => true,
    getWindowSources: async (o) => (calls.sources.push(o), over.sources ?? [src("window:2:0", "Star Citizen")]),
    upload: async (f) => (calls.uploads.push(f), { ok: true }),
    setTimer: (fn, ms) => (timers.push({ fn, ms }), timers.length),
    clearTimer: () => void 0,
    now: () => 1e6,
    ...over
  };
  return { sharer: new BodycamSharer(deps), calls, timers };
}
test("sharer only ever asks for window sources (never screens) with the small thumbnail", async () => {
  const { sharer, calls } = harness();
  const s = await sharer.tick();
  assert.equal(s.state, "sharing");
  assert.deepEqual(calls.sources[0], { types: ["window"], thumbnailSize: { width: 640, height: 360 }, fetchWindowIcons: false });
  assert.equal(calls.uploads.length, 1);
});
test("nothing is captured when sharing is off, no org is chosen, the game is not running, or offline", async () => {
  for (const [name, over, state] of [
    ["disabled", { settings: { enabled: false, intervalSec: 15, orgs: ["VOID"] } }, "off"],
    ["no orgs", { settings: { enabled: true, intervalSec: 15, orgs: [] } }, "off"],
    ["game closed", { isGameRunning: () => false }, "game-not-running"],
    ["offline", { isOnline: () => false }, "offline"]
  ]) {
    const { sharer, calls } = harness(over);
    const s = await sharer.tick();
    assert.equal(s.state, state, name);
    assert.equal(calls.sources.length, 0, `${name}: must not touch the capturer`);
    assert.equal(calls.uploads.length, 0, name);
  }
});
test("window not found / minimised / blank frames are skipped with a status", async () => {
  let h = harness({ sources: [src("window:1:0", "Discord")] });
  assert.equal((await h.sharer.tick()).state, "window-not-found");
  h = harness({ sources: [src("window:2:0", "Star Citizen", img("empty"))] });
  assert.equal((await h.sharer.tick()).state, "window-not-found");
  h = harness({ sources: [src("window:2:0", "Star Citizen", img("black"))] });
  assert.equal((await h.sharer.tick()).state, "blank-frame");
  assert.equal(h.calls.uploads.length, 0);
});
test("no backlog: a failed/unacked upload is dropped, not retried", async () => {
  const { sharer, calls } = harness({ upload: async (f) => (calls2.push(f), void 0) });
  const calls2 = [];
  assert.equal((await sharer.tick()).state, "offline");
  assert.equal(calls2.length, 1);
});
test("rate-limited ack backs off for at least the requested time", async () => {
  const { sharer, timers } = harness({ upload: async () => ({ ok: false, error: "rate limited", retryInMs: 3e4 }) });
  sharer.start();
  await new Promise((r) => setImmediate(r));
  const t = timers[0];
  t.fn();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(sharer.status.state, "rejected");
  assert.ok(timers.at(-1).ms >= 3e4);
});
test("stop() cancels the loop and resets to off", async () => {
  const { sharer, timers } = harness();
  sharer.start();
  assert.equal(sharer.active, true);
  sharer.stop();
  assert.equal(sharer.active, false);
  assert.equal(sharer.status.state, "off");
  const n = timers.length;
  await sharer.tick();
  assert.equal(timers.length, n);
});
test("uses the configured interval between frames", async () => {
  const { sharer, timers } = harness({ settings: { enabled: true, intervalSec: 30, orgs: ["VOID"] } });
  sharer.start();
  timers[0].fn();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(timers.at(-1).ms, 3e4);
});
test("a window titled like the game that is NOT owned by StarCitizen.exe is never captured", async () => {
  const checked = [];
  const { sharer, calls } = harness({ isGameWindow: async (h) => (checked.push(h), false) });
  const st = await sharer.tick();
  assert.equal(st.state, "window-not-found");
  assert.deepEqual(checked, ["2"]);
  assert.equal(calls.uploads.length, 0);
});
test("process-check failure (throws) fails closed", async () => {
  const { sharer, calls } = harness({ isGameWindow: async () => {
    throw new Error("powershell missing");
  } });
  assert.equal((await sharer.tick()).state, "window-not-found");
  assert.equal(calls.uploads.length, 0);
});
test("'not sharing' re-syncs once, then pauses until resume()", async () => {
  let resyncs = 0;
  const calls3 = [];
  const { sharer, calls } = harness({ upload: async (f) => (calls3.push(f), { ok: false, error: "not sharing" }), resync: async () => {
    resyncs++;
  } });
  await sharer.tick();
  assert.equal(resyncs, 1);
  await sharer.tick();
  assert.equal(resyncs, 1);
  const n = calls3.length;
  const st = await sharer.tick();
  assert.equal(calls3.length, n);
  assert.equal(calls.sources.length, n);
  assert.match(st.detail ?? "", /paused/);
  sharer.resume();
  await sharer.tick();
  assert.equal(calls3.length, n + 1);
});
test("when the process check cannot run, screenshots pause with a clear message and nothing is captured", async () => {
  const { sharer, calls } = harness({ isGameWindow: async () => "unknown" });
  const st = await sharer.tick();
  assert.equal(st.state, "window-not-found");
  assert.equal(st.detail, VERIFY_FAILED_MESSAGE);
  assert.equal(calls.uploads.length, 0);
  const t2 = harness({ isGameWindow: async () => {
    throw new Error("x");
  } });
  assert.equal((await t2.sharer.tick()).detail, VERIFY_FAILED_MESSAGE);
});
