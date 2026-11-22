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
  #windowId: string | null = null;
  #windowCheckedAt = 0;
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
      this.#tokens = (this.#params.maxKbps * 1000) / 8;
      this.#refilledAt = this.#now();
      this.#schedule(0);
    }
  }

  /** Server `bodycam_live_stop`, setting turned off, or local shutdown. Immediate. */
  stop(reason = 'stopped'): void {
    const was = this.#running;
    this.#running = false;
    if (this.#timer != null) (this.#d.clearTimer ?? clearTimeout)(this.#timer as any);
    this.#timer = null;
    this.#windowId = null;
    this.#params = null;
    try {
      this.#d.closeCapture();
    } catch {
      /* ignore */
    }
    if (was || this.status.state !== 'idle') this.#set({ state: 'idle', viewers: 0, detail: reason === 'stopped' ? undefined : reason });
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
        const g = await this.#d.grab(this.#quality, { width: p.width, height: p.height });
        if (!g) {
          this.#block('no frame');
        } else if (g.blank) {
          this.#block('blank frame');
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
