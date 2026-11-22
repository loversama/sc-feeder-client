/**
 * Body-cam LIVE view (client side; design + API in BODYCAM-SPEC.md "Live video"). Electron-free core.
 *
 * Captures ONLY while the server says someone is watching (`bodycam_live_start`), and only while:
 *  - "Allow live view" AND screenshot sharing are on with at least one org,
 *  - the game process runs, the link is authenticated, and
 *  - the single Star Citizen window (title + HWND -> StarCitizen.exe, see bodycam-window.ts) can be resolved.
 * Dead-man: stops by itself when the server's keepalive (re-sent every 20 s) is missing for 60 s.
 * Nothing is stored; frames are sent fire-and-forget and the newest frame always wins.
 */

export const LIVE_DEADMAN_MS = 60_000;
export const LIVE_WINDOW_RECHECK_MS = 30_000;
/** The game window is checked for presence (closed / minimised) at most this often; a loss closes the capture on that tick. */
export const LIVE_PRESENCE_CHECK_MS = 1000;
/** A start arriving this soon after a stop is held back (viewer flapping). */
export const LIVE_RESTART_DEBOUNCE_MS = 3000;
/** After a soft stop the hidden capture stays open this long so a quick re-watch is instant. */
export const LIVE_WARM_MS = 10_000;
export const LIVE_MIN_FPS = 4;
export const LIVE_MAX_FPS = 8;

export type LiveParams = { fps: number; width: number; height: number; maxFrameBytes: number; maxKbps: number; viewers: number };
export type LiveStatus = { state: 'idle' | 'live' | 'blocked'; viewers: number; framesSent: number; detail?: string };

export type LiveDeps = {
  getSettings: () => { enabled: boolean; allowLive: boolean; orgs: string[] };
  isGameRunning: () => boolean;
  isOnline: () => boolean;
  /** The one verified Star Citizen window, or null (not found / ambiguous / not StarCitizen.exe). */
  findWindow: () => Promise<{ sourceId: string } | null>;
  openCapture: (sourceId: string, size: { width: number; height: number }, fps: number) => Promise<void>;
  /** One JPEG of the opened window; `blank` = flat/black frame. Null = nothing available. */
  grab: (quality: number, size: { width: number; height: number }) => Promise<{ jpeg: Buffer; blank: boolean } | null>;
  closeCapture: () => void;
  /** Cheap check that the opened window still exists and is not minimised. Optional (tests). */
  windowAlive?: (sourceId: string) => Promise<boolean>;
  /** Fire-and-forget upload; false = not sent. */
  send: (jpeg: Buffer) => boolean;
  onStatus?: (s: LiveStatus) => void;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (t: unknown) => void;
  log?: (level: 'info' | 'warn' | 'debug', msg: string) => void;
};

export class LiveSharer {
  #d: LiveDeps;
  #params: LiveParams | null = null;
  #timer: unknown = null;
  #running = false;
  #busy = false;
  #lastKeepalive = 0;
  #stoppedAt = 0;
  #warmTimer: unknown = null;
  #windowId: string | null = null;
  #windowCheckedAt = 0;
  #presenceAt = 0;
  #quality = 40;
  #tokens = 0;
  #refilledAt = 0;
  status: LiveStatus = { state: 'idle', viewers: 0, framesSent: 0 };

  constructor(deps: LiveDeps) {
    this.#d = deps;
  }

  get active(): boolean {
    return this.#running;
  }

  #now(): number {
    return (this.#d.now ?? Date.now)();
  }

  #set(p: Partial<LiveStatus>): void {
    this.status = { ...this.status, ...p };
    this.#d.onStatus?.(this.status);
  }

  /** Server `bodycam_live_start` (first viewer, viewer-count change or 20 s keepalive). */
  start(params: LiveParams): void {
    const s = this.#d.getSettings();
    if (!s.enabled || !s.allowLive || !s.orgs.length) {
      this.stop('not allowed');
      return;
    }
    const fps = Math.min(LIVE_MAX_FPS, Math.max(LIVE_MIN_FPS, Math.round(params.fps) || 5));
    this.#params = { ...params, fps, maxFrameBytes: Math.min(params.maxFrameBytes || 10_000, 40_000), maxKbps: Math.min(params.maxKbps || 400, 400) };
    this.#lastKeepalive = this.#now();
    this.#set({ viewers: params.viewers });
    if (!this.#running) {
      this.#running = true;
      this.#clearWarm();
      this.#windowCheckedAt = 0; // always re-verify the window before the first frame (a warm capture is not trusted blindly)
      this.#tokens = (this.#params.maxKbps * 1000) / 8;
      this.#refilledAt = this.#now();
      // stop->start within 3 s: wait out the rest of the debounce instead of flapping the capture
      this.#schedule(Math.max(0, this.#stoppedAt + LIVE_RESTART_DEBOUNCE_MS - this.#now()));
    }
  }

  /** Server `bodycam_live_stop`, setting turned off, or local shutdown. Immediate. */
  stop(reason = 'stopped', opts: { soft?: boolean } = {}): void {
    const was = this.#running;
    this.#running = false;
    if (was) this.#stoppedAt = this.#now();
    if (this.#timer != null) (this.#d.clearTimer ?? clearTimeout)(this.#timer as any);
    this.#timer = null;
    this.#params = null;
    this.#clearWarm();
    if (opts.soft && was && this.#windowId) {
      // Nobody is watching any more: no frames, but keep the (hidden) capture warm for a few seconds.
      this.#warmTimer = (this.#d.setTimer ?? setTimeout)(() => this.#closeCapture(), LIVE_WARM_MS);
    } else {
      this.#closeCapture();
    }
    if (was || this.status.state !== 'idle') this.#set({ state: 'idle', viewers: 0, detail: reason === 'stopped' ? undefined : reason });
  }

  #clearWarm(): void {
    if (this.#warmTimer != null) (this.#d.clearTimer ?? clearTimeout)(this.#warmTimer as any);
    this.#warmTimer = null;
  }

  #closeCapture(): void {
    this.#warmTimer = null;
    this.#windowId = null;
    try {
      this.#d.closeCapture();
    } catch {
      /* ignore */
    }
  }

  /** `bodycam_live_rejected` from the server: show why frames are not getting through. */
  noteServerRejection(reason: string): void {
    this.#set({ detail: `live frames rejected: ${reason}` });
  }

  #schedule(ms: number): void {
    if (!this.#running) return;
    this.#timer = (this.#d.setTimer ?? setTimeout)(() => void this.tick(), ms);
  }

  /** One frame attempt (exported for tests). */
  async tick(): Promise<LiveStatus> {
    if (!this.#running || !this.#params || this.#busy) return this.status;
    this.#busy = true;
    const p = this.#params;
    let next = Math.round(1000 / p.fps);
    try {
      const now = this.#now();
      const s = this.#d.getSettings();
      if (now - this.#lastKeepalive > LIVE_DEADMAN_MS) {
        this.stop('no keepalive from the server');
        return this.status;
      }
      if (!s.enabled || !s.allowLive || !s.orgs.length) {
        this.stop('live view switched off');
        return this.status;
      }
      if (!this.#d.isGameRunning()) {
        this.#block('game not running');
        next = 2000;
      } else if (!this.#d.isOnline()) {
        this.#block('offline');
        next = 2000;
      } else {
        // (Re)validate the window on open and every 30 s: it must still be THE verified game window.
        if (!this.#windowId || now - this.#windowCheckedAt > LIVE_WINDOW_RECHECK_MS) {
          const w = await this.#d.findWindow();
          this.#windowCheckedAt = now;
          if (!w) {
            if (this.#windowId) this.#d.closeCapture();
            this.#windowId = null;
            this.#block('game window not found');
            next = 2000; // do not enumerate windows at frame rate
            return this.status;
          }
          if (w.sourceId !== this.#windowId) {
            if (this.#windowId) this.#d.closeCapture();
            await this.#d.openCapture(w.sourceId, { width: p.width, height: p.height }, p.fps);
            this.#windowId = w.sourceId;
          }
        }
        if (this.#windowId && this.#d.windowAlive && now - this.#presenceAt >= LIVE_PRESENCE_CHECK_MS) {
          this.#presenceAt = now;
          if (!(await this.#d.windowAlive(this.#windowId))) {
            this.#d.closeCapture(); // closed or minimised: stop capturing immediately instead of sending a frozen frame
            this.#windowId = null;
            this.#windowCheckedAt = 0;
            this.#block('game window closed or minimised');
            next = 1000;
            return this.status;
          }
        }
        const g = await this.#d.grab(this.#quality, { width: p.width, height: p.height });
        if (!g) {
          this.#block('no frame');
        } else if (g.blank) {
          this.#block('Skipped a blank picture (loading or black screen)');
        } else if (g.jpeg.length > p.maxFrameBytes) {
          this.#quality = Math.max(15, this.#quality - 5); // too big: lower quality, skip this frame
        } else {
          const rate = (p.maxKbps * 1000) / 8;
          this.#tokens = Math.min(rate, this.#tokens + ((now - this.#refilledAt) / 1000) * rate);
          this.#refilledAt = now;
          if (this.#tokens >= g.jpeg.length && this.#d.send(g.jpeg)) {
            this.#tokens -= g.jpeg.length;
            if (g.jpeg.length < p.maxFrameBytes * 0.6) this.#quality = Math.min(50, this.#quality + 2);
            this.#set({ state: 'live', framesSent: this.status.framesSent + 1, detail: undefined });
          }
        }
      }
    } catch (err) {
      this.#block(`capture error: ${(err as Error).message}`);
      this.#windowId = null;
      try {
        this.#d.closeCapture();
      } catch {
        /* ignore */
      }
      next = 2000;
    } finally {
      this.#busy = false;
      this.#schedule(next);
    }
    return this.status;
  }

  #block(detail: string): void {
    this.#set({ state: 'blocked', detail });
  }
}
