/**
 * Optional "body-cam" screenshots (opt-in). Electron-free core so it can be tested with node:test;
 * everything app-specific (desktopCapturer, link, settings) is injected - see bodycam-manager.ts.
 *
 * Privacy rules enforced HERE (and covered by test/bodycam/bodycam.test.ts):
 *  - Only OS-level WINDOW capture of the Star Citizen window. `screen:` sources are never requested
 *    and never accepted, and no other window is ever looked at.
 *  - Nothing is captured unless sharing is switched on, orgs are chosen, the game process is running
 *    and the server link is authenticated. No injection or hooks into the game.
 *  - Blank/black frames (exclusive fullscreen) are skipped; frames are small JPEGs; offline = drop
 *    (no backlog, only the newest frame matters).
 */

export const BODYCAM_THUMB = { width: 640, height: 360 } as const;
export const BODYCAM_MIN_INTERVAL_S = 5;
export const BODYCAM_MAX_INTERVAL_S = 60;
export const BODYCAM_DEFAULT_INTERVAL_S = 15;
/** Server hard cap is 80 KB; we aim for < 40 KB and never send more than this. */
export const BODYCAM_MAX_BYTES = 70 * 1024;
export const BODYCAM_TARGET_BYTES = 40 * 1024;
/**
 * Window-title matcher: EXACT title "Star Citizen" (case-insensitive). The title alone is never
 * enough (a browser tab can be called that too): the window must also belong to StarCitizen.exe.
 * The real Windows title could not be verified from the dev machine, so a main-process-only env
 * override exists for debugging (VOIDLOG_BODYCAM_TITLE, a RegExp source); it is NOT a user setting.
 */
export const BODYCAM_DEFAULT_TITLE_PATTERN = '^Star Citizen$';

import { hwndFromSourceId } from './bodycam-window';

/** Shown in settings when the process check cannot run (fails closed). */
export const VERIFY_FAILED_MESSAGE = "Couldn't verify the game window — screenshots paused";

export type BodycamState =
  | 'off' // sharing disabled / no orgs chosen
  | 'sharing' // last frame sent
  | 'game-not-running'
  | 'window-not-found' // not found, minimised, or no thumbnail
  | 'blank-frame' // black frame (exclusive fullscreen)
  | 'offline' // not connected/authenticated: frame dropped
  | 'rejected' // server said no (flag off, rate limit, ...)
  | 'error';

export type BodycamStatus = { state: BodycamState; detail?: string; lastSentAt: number | null; framesSent: number; lastBytes: number | null };

/** The slice of Electron's NativeImage that is used. */
export interface CamImage {
  isEmpty(): boolean;
  getSize(): { width: number; height: number };
  /** Raw BGRA/RGBA 4-bytes-per-pixel bitmap. */
  toBitmap(): Buffer;
  toJPEG(quality: number): Buffer;
}

/** The slice of Electron's DesktopCapturerSource that is used. */
export interface CamSource {
  id: string;
  name: string;
  thumbnail: CamImage;
}

export function makeTitleMatcher(pattern: string | undefined | null): RegExp {
  try {
    if (pattern && pattern.trim()) return new RegExp(pattern, 'i');
  } catch {
    /* fall back */
  }
  return new RegExp(BODYCAM_DEFAULT_TITLE_PATTERN, 'i');
}

/**
 * Every `window:` source whose title matches. `screen:` sources (and anything else) are never returned.
 * Minimised windows (empty thumbnail) are still listed: they count for the ambiguity check.
 */
export function matchingWindows(sources: readonly CamSource[], matcher: RegExp): CamSource[] {
  return sources.filter((s) => typeof s?.id === 'string' && /^window:\d+:\d+$/.test(s.id) && typeof s.name === 'string' && matcher.test(s.name.trim()));
}

/**
 * Pick THE Star Citizen window: exactly one title match with a usable thumbnail. If several windows
 * match (e.g. a browser tab with the same title) we pick none - capturing nothing beats guessing.
 */
export function selectGameWindow(sources: readonly CamSource[], matcher: RegExp): CamSource | null {
  const m = matchingWindows(sources, matcher);
  if (m.length !== 1) return null;
  const only = m[0];
  return only.thumbnail && !only.thumbnail.isEmpty() ? only : null;
}

/** True when the frame is one flat colour (black screen from exclusive fullscreen etc.). */
export function isBlankBitmap(bitmap: Buffer, step = 4): boolean {
  const pixels = Math.floor(bitmap.length / 4);
  if (pixels === 0) return true;
  let n = 0;
  let sum = 0;
  let sumSq = 0;
  for (let p = 0; p < pixels; p += step) {
    const i = p * 4;
    // BGRA or RGBA: a plain average of the first three channels is fine for blankness
    const l = (bitmap[i] + bitmap[i + 1] + bitmap[i + 2]) / 3;
    sum += l;
    sumSq += l * l;
    n++;
  }
  const mean = sum / n;
  const variance = Math.max(0, sumSq / n - mean * mean);
  // Only truly uniform frames count as blank; a dark scene still has some variation and passes.
  return Math.sqrt(variance) < 1.5;
}

/** JPEG-encode under the size budget (steps quality down). Null when it cannot fit. */
export function encodeFrame(img: CamImage): Buffer | null {
  for (const q of [60, 50, 40, 30]) {
    const jpg = img.toJPEG(q);
    if (jpg.length <= BODYCAM_TARGET_BYTES || (q <= 30 && jpg.length <= BODYCAM_MAX_BYTES)) return jpg;
  }
  return null;
}

export function clampInterval(sec: unknown): number {
  const n = typeof sec === 'number' && Number.isFinite(sec) ? Math.round(sec) : BODYCAM_DEFAULT_INTERVAL_S;
  return Math.min(BODYCAM_MAX_INTERVAL_S, Math.max(BODYCAM_MIN_INTERVAL_S, n));
}

export type BodycamDeps = {
  getSettings: () => { enabled: boolean; intervalSec: number; orgs: string[]; titlePattern?: string };
  /** True only when the window with this HWND belongs to StarCitizen.exe (fails closed: false on any error). */
  isGameWindow: (hwnd: string) => Promise<boolean | 'unknown'>;
  /** Re-send the opt-in to the server (after a 'not sharing' reply). */
  resync?: () => Promise<void>;
  isGameRunning: () => boolean;
  /** Why the game is not detected (e.g. "Could not check for the game: ..."); shown next to game-not-running. */
  gameDetail?: () => string | undefined;
  /** Connected AND authenticated as a signed-in user. */
  isOnline: () => boolean;
  /** desktopCapturer.getSources - must be called with window types only (the sharer passes that). */
  getWindowSources: (opts: { types: ['window']; thumbnailSize: { width: number; height: number }; fetchWindowIcons: false }) => Promise<CamSource[]>;
  /** Upload; resolves the server ack (undefined = no ack / not sent). */
  upload: (frame: Buffer, capturedAt: string) => Promise<{ ok?: boolean; error?: string; retryInMs?: number } | undefined>;
  onStatus?: (s: BodycamStatus) => void;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (t: unknown) => void;
  log?: (level: 'info' | 'warn' | 'debug', msg: string) => void;
};

export class BodycamSharer {
  #d: BodycamDeps;
  #timer: unknown = null;
  #running = false;
  #busy = false;
  #backoffUntil = 0;
  #resynced = false;
  #paused = false;
  status: BodycamStatus = { state: 'off', lastSentAt: null, framesSent: 0, lastBytes: null };

  constructor(deps: BodycamDeps) {
    this.#d = deps;
  }

  get active(): boolean {
    return this.#running;
  }

  start(): void {
    if (this.#running) return;
    this.#running = true;
    this.#schedule(0);
  }

  /** Settings changed / reconnected: forget a server-side pause and try again. */
  resume(): void {
    this.#paused = false;
    this.#resynced = false;
    this.#backoffUntil = 0;
  }

  stop(): void {
    this.#running = false;
    if (this.#timer != null) (this.#d.clearTimer ?? clearTimeout)(this.#timer as any);
    this.#timer = null;
    this.#set({ state: 'off' });
  }

  #schedule(ms: number): void {
    if (!this.#running) return;
    this.#timer = (this.#d.setTimer ?? setTimeout)(() => void this.tick(), ms);
  }

  #set(p: Partial<BodycamStatus>): void {
    this.status = { ...this.status, ...p, detail: p.detail };
    this.#d.onStatus?.(this.status);
  }

  #lastVerdict: boolean | 'unknown' = false;

  async #safeIsGameWindow(hwnd: string): Promise<boolean> {
    try {
      this.#lastVerdict = await this.#d.isGameWindow(hwnd);
    } catch {
      this.#lastVerdict = 'unknown';
    }
    return this.#lastVerdict === true;
  }

  /** One capture attempt (exported for tests). Always reschedules while running. */
  async tick(): Promise<BodycamStatus> {
    if (this.#busy) return this.status;
    this.#busy = true;
    const s = this.#d.getSettings();
    let next = clampInterval(s.intervalSec) * 1000;
    try {
      const now = (this.#d.now ?? Date.now)();
      if (!s.enabled || !s.orgs.length) {
        this.#set({ state: 'off' });
      } else if (!this.#d.isGameRunning()) {
        this.#set({ state: 'game-not-running', detail: this.#d.gameDetail?.() });
      } else if (!this.#d.isOnline()) {
        this.#set({ state: 'offline' }); // drop: no backlog
      } else if (this.#paused) {
        this.#set({ state: 'rejected', detail: 'paused: the server is not sharing your frames. Re-toggle sharing or reconnect' });
      } else if (now < this.#backoffUntil) {
        /* server asked us to slow down */
      } else {
        const sources = await this.#d.getWindowSources({ types: ['window'], thumbnailSize: { ...BODYCAM_THUMB }, fetchWindowIcons: false });
        const matcher = makeTitleMatcher(s.titlePattern);
        const candidates = matchingWindows(sources, matcher);
        const win = selectGameWindow(sources, matcher);
        const hwnd = win ? hwndFromSourceId(win.id) : null;
        if (candidates.length > 1) {
          this.#set({ state: 'window-not-found', detail: 'more than one window is titled like the game; capturing nothing' });
        } else if (candidates.length === 0) {
          this.#set({ state: 'window-not-found', detail: 'no window titled exactly "Star Citizen" was found (still loading, or running under another title?)' });
        } else if (!win) {
          this.#set({ state: 'window-not-found', detail: 'the Star Citizen window is minimised or cannot be captured right now' });
        } else if (!hwnd) {
          this.#set({ state: 'window-not-found', detail: 'could not read the game window handle' });
        } else if ((await this.#safeIsGameWindow(hwnd)) !== true) {
          const unknown = this.#lastVerdict === 'unknown';
          this.#set({ state: 'window-not-found', detail: unknown ? VERIFY_FAILED_MESSAGE : 'the window is not owned by StarCitizen.exe; capturing nothing' });
        } else if (isBlankBitmap(win.thumbnail.toBitmap())) {
          this.#set({ state: 'blank-frame' });
        } else {
          const jpg = encodeFrame(win.thumbnail);
          if (!jpg) {
            this.#set({ state: 'error', detail: 'frame too large' });
          } else {
            const ack = await this.#d.upload(jpg, new Date(now).toISOString());
            if (!ack) {
              this.#set({ state: 'offline' });
            } else if (ack.ok) {
              this.#resynced = false;
              this.#set({ state: 'sharing', detail: undefined, lastSentAt: now, framesSent: this.status.framesSent + 1, lastBytes: jpg.length });
            } else {
              if (ack.error === 'not sharing') {
                // The server forgot our opt-in: re-send it once; if it still refuses, pause until
                // the settings change or the link reconnects.
                if (!this.#resynced && this.#d.resync) {
                  this.#resynced = true;
                  try {
                    await this.#d.resync();
                  } catch {
                    /* retried next tick */
                  }
                } else {
                  this.#paused = true;
                }
              }
              if (ack.retryInMs) this.#backoffUntil = now + ack.retryInMs;
              if (ack.error === 'rate limited') next = Math.max(next, ack.retryInMs ?? 0);
              this.#set({ state: 'rejected', detail: ack.error });
              this.#d.log?.('warn', `Body-cam frame rejected: ${ack.error}`);
            }
          }
        }
      }
    } catch (err) {
      this.#set({ state: 'error', detail: (err as Error).message });
      this.#d.log?.('warn', `Body-cam capture failed: ${(err as Error).message}`);
    } finally {
      this.#busy = false;
      this.#schedule(next);
    }
    return this.status;
  }
}
