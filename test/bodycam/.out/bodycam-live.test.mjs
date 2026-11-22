// test/bodycam/bodycam-live.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

// electron/modules/bodycam-live.ts
var LIVE_DEADMAN_MS = 6e4;
var LIVE_WINDOW_RECHECK_MS = 3e4;
var LIVE_RESTART_DEBOUNCE_MS = 3e3;
var LIVE_WARM_MS = 1e4;
var LIVE_MIN_FPS = 4;
var LIVE_MAX_FPS = 8;
var LiveSharer = class {
  #d;
  #params = null;
  #timer = null;
  #running = false;
  #busy = false;
  #lastKeepalive = 0;
  #stoppedAt = 0;
  #warmTimer = null;
  #windowId = null;
  #windowCheckedAt = 0;
  #quality = 40;
  #tokens = 0;
  #refilledAt = 0;
  status = { state: "idle", viewers: 0, framesSent: 0 };
  constructor(deps) {
    this.#d = deps;
  }
  get active() {
    return this.#running;
  }
  #now() {
    return (this.#d.now ?? Date.now)();
  }
  #set(p) {
    this.status = { ...this.status, ...p };
    this.#d.onStatus?.(this.status);
  }
  /** Server `bodycam_live_start` (first viewer, viewer-count change or 20 s keepalive). */
  start(params) {
    const s = this.#d.getSettings();
    if (!s.enabled || !s.allowLive || !s.orgs.length) {
      this.stop("not allowed");
      return;
    }
    const fps = Math.min(LIVE_MAX_FPS, Math.max(LIVE_MIN_FPS, Math.round(params.fps) || 5));
    this.#params = { ...params, fps, maxFrameBytes: Math.min(params.maxFrameBytes || 1e4, 4e4), maxKbps: Math.min(params.maxKbps || 400, 400) };
    this.#lastKeepalive = this.#now();
    this.#set({ viewers: params.viewers });
    if (!this.#running) {
      this.#running = true;
      this.#clearWarm();
      this.#windowCheckedAt = 0;
      this.#tokens = this.#params.maxKbps * 1e3 / 8;
      this.#refilledAt = this.#now();
      this.#schedule(Math.max(0, this.#stoppedAt + LIVE_RESTART_DEBOUNCE_MS - this.#now()));
    }
  }
  /** Server `bodycam_live_stop`, setting turned off, or local shutdown. Immediate. */
  stop(reason = "stopped", opts = {}) {
    const was = this.#running;
    this.#running = false;
    if (was) this.#stoppedAt = this.#now();
    if (this.#timer != null) (this.#d.clearTimer ?? clearTimeout)(this.#timer);
    this.#timer = null;
    this.#params = null;
    this.#clearWarm();
    if (opts.soft && was && this.#windowId) {
      this.#warmTimer = (this.#d.setTimer ?? setTimeout)(() => this.#closeCapture(), LIVE_WARM_MS);
    } else {
      this.#closeCapture();
    }
    if (was || this.status.state !== "idle") this.#set({ state: "idle", viewers: 0, detail: reason === "stopped" ? void 0 : reason });
  }
  #clearWarm() {
    if (this.#warmTimer != null) (this.#d.clearTimer ?? clearTimeout)(this.#warmTimer);
    this.#warmTimer = null;
  }
  #closeCapture() {
    this.#warmTimer = null;
    this.#windowId = null;
    try {
      this.#d.closeCapture();
    } catch {
    }
  }
  /** `bodycam_live_rejected` from the server: show why frames are not getting through. */
  noteServerRejection(reason) {
    this.#set({ detail: `live frames rejected: ${reason}` });
  }
  #schedule(ms) {
    if (!this.#running) return;
    this.#timer = (this.#d.setTimer ?? setTimeout)(() => void this.tick(), ms);
  }
  /** One frame attempt (exported for tests). */
  async tick() {
    if (!this.#running || !this.#params || this.#busy) return this.status;
    this.#busy = true;
    const p = this.#params;
    let next = Math.round(1e3 / p.fps);
    try {
      const now = this.#now();
      const s = this.#d.getSettings();
      if (now - this.#lastKeepalive > LIVE_DEADMAN_MS) {
        this.stop("no keepalive from the server");
        return this.status;
      }
      if (!s.enabled || !s.allowLive || !s.orgs.length) {
        this.stop("live view switched off");
        return this.status;
      }
      if (!this.#d.isGameRunning()) {
        this.#block("game not running");
        next = 2e3;
      } else if (!this.#d.isOnline()) {
        this.#block("offline");
        next = 2e3;
      } else {
        if (!this.#windowId || now - this.#windowCheckedAt > LIVE_WINDOW_RECHECK_MS) {
          const w = await this.#d.findWindow();
          this.#windowCheckedAt = now;
          if (!w) {
            if (this.#windowId) this.#d.closeCapture();
            this.#windowId = null;
            this.#block("game window not found");
            next = 2e3;
            return this.status;
          }
          if (w.sourceId !== this.#windowId) {
            if (this.#windowId) this.#d.closeCapture();
            await this.#d.openCapture(w.sourceId, { width: p.width, height: p.height }, p.fps);
            this.#windowId = w.sourceId;
          }
        }
        const g = await this.#d.grab(this.#quality, { width: p.width, height: p.height });
        if (!g) {
          this.#block("no frame");
        } else if (g.blank) {
          this.#block("blank frame");
        } else if (g.jpeg.length > p.maxFrameBytes) {
          this.#quality = Math.max(15, this.#quality - 5);
        } else {
          const rate = p.maxKbps * 1e3 / 8;
          this.#tokens = Math.min(rate, this.#tokens + (now - this.#refilledAt) / 1e3 * rate);
          this.#refilledAt = now;
          if (this.#tokens >= g.jpeg.length && this.#d.send(g.jpeg)) {
            this.#tokens -= g.jpeg.length;
            if (g.jpeg.length < p.maxFrameBytes * 0.6) this.#quality = Math.min(50, this.#quality + 2);
            this.#set({ state: "live", framesSent: this.status.framesSent + 1, detail: void 0 });
          }
        }
      }
    } catch (err) {
      this.#block(`capture error: ${err.message}`);
      this.#windowId = null;
      try {
        this.#d.closeCapture();
      } catch {
      }
      next = 2e3;
    } finally {
      this.#busy = false;
      this.#schedule(next);
    }
    return this.status;
  }
  #block(detail) {
    this.#set({ state: "blocked", detail });
  }
};

// test/bodycam/bodycam-live.test.ts
var PARAMS = { fps: 5, width: 480, height: 270, maxFrameBytes: 1e4, maxKbps: 400, viewers: 1 };
function harness(over = {}) {
  const log = { sent: 0, opened: [], closed: 0, grabs: [], finds: 0 };
  const timers = [];
  let t = 1e6;
  const deps = {
    getSettings: () => ({ enabled: true, allowLive: true, orgs: ["VOID"] }),
    isGameRunning: () => true,
    isOnline: () => true,
    findWindow: async () => (log.finds++, { sourceId: "window:7:0" }),
    openCapture: async (id) => void log.opened.push(id),
    grab: async (q) => (log.grabs.push(q), { jpeg: Buffer.alloc(over.jpegBytes ?? 5e3, 1), blank: false }),
    closeCapture: () => void log.closed++,
    send: () => (log.sent++, true),
    setTimer: (fn, ms) => (timers.push({ fn, ms }), timers.length),
    clearTimer: () => void 0,
    now: () => t,
    ...over
  };
  return { live: new LiveSharer(deps), log, timers, advance: (ms) => t += ms };
}
test("does nothing until the server asks (no viewers = no capture)", async () => {
  const { live, log } = harness();
  await live.tick();
  assert.equal(live.active, false);
  assert.equal(log.finds, 0);
  assert.equal(log.sent, 0);
});
test("starts on the server command, sends frames, stops immediately on bodycam_live_stop", async () => {
  const { live, log, timers } = harness();
  live.start(PARAMS);
  assert.equal(live.active, true);
  assert.equal(timers[0].ms, 0);
  await live.tick();
  assert.deepEqual(log.opened, ["window:7:0"]);
  assert.equal(log.sent, 1);
  assert.equal(live.status.state, "live");
  assert.equal(timers.at(-1).ms, 200);
  live.stop();
  assert.equal(live.active, false);
  assert.ok(log.closed >= 1);
  assert.equal(live.status.state, "idle");
  await live.tick();
  assert.equal(log.sent, 1);
});
test('never starts unless screenshots sharing AND "allow live view" are both on', async () => {
  for (const s of [{ enabled: false, allowLive: true, orgs: ["VOID"] }, { enabled: true, allowLive: false, orgs: ["VOID"] }, { enabled: true, allowLive: true, orgs: [] }]) {
    const { live, log } = harness({ getSettings: () => s });
    live.start(PARAMS);
    assert.equal(live.active, false);
    await live.tick();
    assert.equal(log.finds, 0);
    assert.equal(log.sent, 0);
  }
});
test("turning the setting off mid-stream stops at the next tick", async () => {
  let allow = true;
  const { live, log } = harness({ getSettings: () => ({ enabled: true, allowLive: allow, orgs: ["VOID"] }) });
  live.start(PARAMS);
  await live.tick();
  allow = false;
  await live.tick();
  assert.equal(live.active, false);
  assert.equal(log.sent, 1);
});
test("captures nothing when the game window cannot be verified (title/process check failed)", async () => {
  const { live, log } = harness({ findWindow: async () => null });
  live.start(PARAMS);
  await live.tick();
  assert.equal(log.grabs.length, 0);
  assert.equal(log.sent, 0);
  assert.equal(live.status.state, "blocked");
});
test("captures nothing when the game is not running or the link is down", async () => {
  for (const over of [{ isGameRunning: () => false }, { isOnline: () => false }]) {
    const { live, log, timers } = harness(over);
    live.start(PARAMS);
    await live.tick();
    assert.equal(log.grabs.length, 0);
    assert.equal(log.finds, 0);
    assert.equal(timers.at(-1).ms, 2e3);
  }
});
test("blank frames are skipped", async () => {
  const { live, log } = harness({ grab: async () => ({ jpeg: Buffer.alloc(3e3), blank: true }) });
  live.start(PARAMS);
  await live.tick();
  assert.equal(log.sent, 0);
  assert.equal(live.status.detail, "blank frame");
});
test("dead-man: stops by itself when the server keepalive is missing for 60 s; keepalive prevents it", async () => {
  const a = harness();
  a.live.start(PARAMS);
  await a.live.tick();
  a.advance(LIVE_DEADMAN_MS - 1e3);
  a.live.start({ ...PARAMS, viewers: 2 });
  a.advance(LIVE_DEADMAN_MS - 1e3);
  await a.live.tick();
  assert.equal(a.live.active, true);
  assert.equal(a.live.status.viewers, 2);
  a.advance(2e3);
  await a.live.tick();
  assert.equal(a.live.active, false);
  assert.match(a.live.status.detail ?? "", /keepalive/);
});
test("re-verifies the window every 30 s and switches/stops capture when it changes", async () => {
  let id = "window:7:0";
  const { live, log, advance } = harness({ findWindow: async () => id ? { sourceId: id } : null });
  live.start(PARAMS);
  await live.tick();
  advance(1e4);
  live.start(PARAMS);
  await live.tick();
  assert.equal(log.opened.length, 1);
  advance(25e3);
  live.start(PARAMS);
  id = "window:9:0";
  await live.tick();
  assert.deepEqual(log.opened, ["window:7:0", "window:9:0"]);
  advance(31e3);
  live.start(PARAMS);
  id = null;
  const sent = log.sent;
  await live.tick();
  assert.equal(log.sent, sent);
});
test("adapts JPEG quality down when frames are over the budget and skips those frames", async () => {
  const { live, log } = harness({ jpegBytes: 12e3 });
  live.start(PARAMS);
  await live.tick();
  await live.tick();
  assert.equal(log.sent, 0);
  assert.ok(log.grabs[1] < log.grabs[0]);
});
test("local bitrate cap: at 8 fps with big frames the sent bytes stay under 400 kbps", async () => {
  const { live, log, advance } = harness({ jpegBytes: 9500 });
  live.start({ ...PARAMS, fps: 8 });
  for (let i = 0; i < 80; i++) {
    advance(125);
    live.start({ ...PARAMS, fps: 8 });
    await live.tick();
  }
  const seconds = 10;
  assert.ok(log.sent * 9500 <= 5e4 * seconds + 5e4, `sent ${log.sent * 9500} bytes`);
});
test("a throwing capture closes the source and backs off instead of crashing", async () => {
  const { live, log, timers } = harness({ grab: async () => {
    throw new Error("gum failed");
  } });
  live.start(PARAMS);
  await live.tick();
  assert.equal(live.active, true);
  assert.ok(log.closed >= 1);
  assert.equal(timers.at(-1).ms, 2e3);
  assert.equal(live.status.state, "blocked");
});
test("soft stop keeps the hidden capture warm for 10 s, then closes it; a quick re-watch reuses it", async () => {
  const { live, log, timers, advance } = harness();
  live.start(PARAMS);
  await live.tick();
  assert.equal(log.opened.length, 1);
  const closedBefore = log.closed;
  live.stop("stopped", { soft: true });
  assert.equal(live.active, false);
  assert.equal(log.closed, closedBefore);
  const warm = timers.at(-1);
  assert.equal(warm.ms, LIVE_WARM_MS);
  advance(LIVE_RESTART_DEBOUNCE_MS + 1);
  live.start(PARAMS);
  assert.equal(timers.at(-1).ms, 0);
  await live.tick();
  assert.equal(log.opened.length, 1);
  assert.equal(log.closed, closedBefore);
  live.stop("stopped", { soft: true });
  timers.at(-1).fn();
  assert.equal(log.closed, closedBefore + 1);
});
test("stop -> start within 3 s is held back until the debounce has passed", async () => {
  const { live, timers, advance } = harness();
  live.start(PARAMS);
  await live.tick();
  live.stop("stopped", { soft: true });
  advance(1e3);
  live.start(PARAMS);
  assert.equal(timers.at(-1).ms, LIVE_RESTART_DEBOUNCE_MS - 1e3);
});
test("hard stops (setting off, not allowed) close the capture immediately", async () => {
  const { live, log } = harness();
  live.start(PARAMS);
  await live.tick();
  const c = log.closed;
  live.stop("live view off");
  assert.equal(log.closed, c + 1);
});
test("a warm capture is re-verified before the first frame of the next watch", async () => {
  const { live, log, advance } = harness();
  live.start(PARAMS);
  await live.tick();
  live.stop("stopped", { soft: true });
  advance(LIVE_RESTART_DEBOUNCE_MS + 1);
  live.start(PARAMS);
  const finds = log.finds;
  await live.tick();
  assert.equal(log.finds, finds + 1);
});
test("server rejection reasons are surfaced in the status", async () => {
  const { live } = harness();
  live.start(PARAMS);
  live.noteServerRejection("EXIF/XMP metadata (APP1) is not allowed");
  assert.match(live.status.detail ?? "", /live frames rejected: EXIF/);
});
