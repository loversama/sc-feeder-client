/**
 * Local game control: ListTriggerableActions + TriggerGameAction on the player's own game.
 *
 * Electron-free core (injected client, clock and settings) so it is unit-tested against a fake gRPC
 * server. Safety rules enforced here, not just in the UI:
 *   - off unless the player enabled game control
 *   - only actions the game listed are sent (unknown names never reach the game)
 *   - dangerous actions need a single-use token from arm(), redeemed only after a minimum delay
 *     (the hold time). This is a minimum delay enforced in the main process so a fast click or a
 *     buggy page can't fire instantly; it is NOT proof that a person held the button (a compromised
 *     renderer can still call arm(), wait, then trigger). The renderer's hold UI provides the intent.
 *   - client-side rate limit (global gap, per-action cooldown, burst cap) on top of the game debounce
 *   - hold_ms only for holdable actions
 *   - a failed or timed-out trigger is NEVER retried (toggles would double-fire)
 */
import { EventEmitter } from 'node:events';
import { randomBytes } from 'node:crypto';
import { classifyAction, ACTION_NAME_RE, type ControlAction } from './game-control-catalog';
import type { GameAction } from './telemetry-client';

export type GameStatusCode =
  | 'OK'
  | 'UNKNOWN_ACTION'
  | 'MAP_INACTIVE'
  | 'RATE_LIMITED'
  | 'FAILED'
  | 'HOLD_NOT_ALLOWED'
  | 'FILTERED'
  | 'UNSPECIFIED';

export type ControlResultCode =
  | GameStatusCode
  /** Checks done in the client before anything is sent to the game: */
  | 'DISABLED'
  | 'INVALID'
  | 'LOCAL_RATE_LIMITED'
  | 'CONFIRM_REQUIRED'
  /** Transport problems (gRPC errors, not a game status): */
  | 'GAME_UNREACHABLE'
  | 'TIMEOUT'
  | 'ERROR';

export type ControlResult = {
  ok: boolean;
  code: ControlResultCode;
  action: string;
  label?: string;
  /** Human-readable explanation for the toast. */
  message: string;
  /** Raw message from the game (if any). */
  gameMessage?: string;
  /** Whether the request reached the game (false for local refusals). */
  sent: boolean;
  retryAfterMs?: number;
  /** Where the press came from (hotkey results are pushed to the UI as toasts). */
  source?: 'ui' | 'hotkey';
  at: number;
};

export type ControlClient = {
  listActions(timeoutMs?: number): Promise<GameAction[]>;
  triggerAction(name: string, holdMs: number, timeoutMs?: number): Promise<{ status: string; message: string }>;
};

export type RateLimitConfig = {
  /** Minimum gap between any two triggers. */
  minGapMs: number;
  /** Minimum gap between two triggers of the same action. */
  perActionMs: number;
  /** At most `burstMax` triggers per `burstWindowMs`. */
  burstMax: number;
  burstWindowMs: number;
};

export const DEFAULT_RATE_LIMIT: RateLimitConfig = { minGapMs: 200, perActionMs: 600, burstMax: 10, burstWindowMs: 10_000 };
export const CONFIRM_HOLD_MS = 1200;
export const CONFIRM_TTL_MS = 10_000;
export const MAX_HOLD_MS = 5000;

export type GameControlOptions = {
  getClient: () => ControlClient;
  isEnabled: () => boolean;
  now?: () => number;
  rateLimit?: Partial<RateLimitConfig>;
  confirmHoldMs?: number;
  confirmTtlMs?: number;
  timeoutMs?: number;
  log?: (level: 'debug' | 'info' | 'warn' | 'error', msg: string) => void;
};

const GAME_STATUS: Record<string, GameStatusCode> = {
  TRIGGER_GAME_ACTION_STATUS_OK: 'OK',
  TRIGGER_GAME_ACTION_STATUS_UNKNOWN_ACTION: 'UNKNOWN_ACTION',
  TRIGGER_GAME_ACTION_STATUS_MAP_INACTIVE: 'MAP_INACTIVE',
  TRIGGER_GAME_ACTION_STATUS_RATE_LIMITED: 'RATE_LIMITED',
  TRIGGER_GAME_ACTION_STATUS_FAILED: 'FAILED',
  TRIGGER_GAME_ACTION_STATUS_HOLD_NOT_ALLOWED: 'HOLD_NOT_ALLOWED',
  TRIGGER_GAME_ACTION_STATUS_FILTERED: 'FILTERED',
  TRIGGER_GAME_ACTION_STATUS_UNSPECIFIED: 'UNSPECIFIED',
};

/** Enum name (or number) from the game → our status code. Unknown values map to UNSPECIFIED. */
export function mapGameStatus(status: unknown): GameStatusCode {
  if (typeof status === 'number') {
    const byNum: GameStatusCode[] = ['UNSPECIFIED', 'OK', 'UNKNOWN_ACTION', 'MAP_INACTIVE', 'RATE_LIMITED', 'FAILED', 'HOLD_NOT_ALLOWED', 'FILTERED'];
    return byNum[status] ?? 'UNSPECIFIED';
  }
  return GAME_STATUS[String(status)] ?? 'UNSPECIFIED';
}

export const RESULT_MESSAGES: Record<ControlResultCode, string> = {
  OK: 'Done',
  UNKNOWN_ACTION: "The game doesn't know this action (it may have been removed in a patch).",
  MAP_INACTIVE: "Not available right now: you're not in the right seat or mode for this action.",
  RATE_LIMITED: 'The game is rate-limiting actions. Wait a moment and try again.',
  FAILED: 'The game could not perform this action.',
  HOLD_NOT_ALLOWED: "This action can't be held.",
  FILTERED: 'The game refused this action. Check that game control is enabled in user.cfg (server.game.telemetry.trigger.actions.enabled=1) and restart the game.',
  UNSPECIFIED: 'The game gave no status for this action.',
  DISABLED: 'Game control is off. Turn it on in the Controls page first.',
  INVALID: 'Invalid action request.',
  LOCAL_RATE_LIMITED: 'Too fast: slow down a little.',
  CONFIRM_REQUIRED: 'This action is dangerous: hold the button to confirm.',
  GAME_UNREACHABLE: "Star Citizen isn't reachable. Is the game running with telemetry enabled?",
  TIMEOUT: "The game didn't answer in time. The action may or may not have happened (not retried).",
  ERROR: 'Unexpected error talking to the game.',
};

type ArmToken = { action: string; armedAt: number; expiresAt: number };

export class GameControl extends EventEmitter {
  #opts: GameControlOptions;
  #now: () => number;
  #rate: RateLimitConfig;
  #confirmHoldMs: number;
  #confirmTtlMs: number;
  #timeoutMs: number;
  #actions: Map<string, ControlAction> | null = null;
  #refreshing: Promise<ControlAction[] | null> | null = null;
  #lastRefreshAt = 0;
  #lastRefreshError: string | null = null;
  #tokens = new Map<string, ArmToken>();
  #lastAny = -Infinity;
  #lastByAction = new Map<string, number>();
  #window: number[] = [];
  #history: ControlResult[] = [];

  constructor(opts: GameControlOptions) {
    super();
    this.#opts = opts;
    this.#now = opts.now ?? Date.now;
    this.#rate = { ...DEFAULT_RATE_LIMIT, ...(opts.rateLimit ?? {}) };
    this.#confirmHoldMs = opts.confirmHoldMs ?? CONFIRM_HOLD_MS;
    this.#confirmTtlMs = opts.confirmTtlMs ?? CONFIRM_TTL_MS;
    this.#timeoutMs = opts.timeoutMs ?? 2000;
  }

  get actions(): ControlAction[] {
    return this.#actions ? [...this.#actions.values()] : [];
  }

  get confirmHoldMs(): number {
    return this.#confirmHoldMs;
  }

  state() {
    return {
      enabled: this.#opts.isEnabled(),
      loaded: !!this.#actions,
      actions: this.actions,
      lastRefreshAt: this.#lastRefreshAt || null,
      lastRefreshError: this.#lastRefreshError,
      confirmHoldMs: this.#confirmHoldMs,
      history: this.history(),
    };
  }

  history(): ControlResult[] {
    return [...this.#history];
  }

  getAction(name: string): ControlAction | undefined {
    return this.#actions?.get(name);
  }

  /** Clear the cache (e.g. game closed); the next refresh/trigger reloads it. */
  invalidate(): void {
    this.#actions = null;
    this.#tokens.clear();
  }

  /** Reload the action list from the game. Concurrent calls share one request. Never throws. */
  refresh(): Promise<ControlAction[] | null> {
    if (this.#refreshing) return this.#refreshing;
    this.#refreshing = (async () => {
      try {
        const list = await this.#opts.getClient().listActions(this.#timeoutMs);
        const map = new Map<string, ControlAction>();
        for (const a of list) {
          if (typeof a?.name !== 'string' || !ACTION_NAME_RE.test(a.name)) continue;
          map.set(a.name, classifyAction(a));
        }
        this.#actions = map;
        this.#lastRefreshAt = this.#now();
        this.#lastRefreshError = null;
        this.#opts.log?.('info', `Game control: ${map.size} triggerable actions`);
        this.emit('actions', this.actions);
        return this.actions;
      } catch (err) {
        this.#lastRefreshError = describeTransportError(err).code;
        this.#opts.log?.('warn', `Game control: ListTriggerableActions failed: ${(err as Error)?.message ?? err}`);
        this.emit('actions', this.actions);
        return null;
      } finally {
        this.#refreshing = null;
      }
    })();
    return this.#refreshing;
  }

  /**
   * Start a hold-to-confirm for a dangerous action. Returns a single-use token that trigger()
   * accepts only between holdMs and ttl after arming.
   */
  arm(name: string): { ok: true; token: string; holdMs: number; expiresAt: number } | { ok: false; code: ControlResultCode; message: string } {
    if (!this.#opts.isEnabled()) return { ok: false, code: 'DISABLED', message: RESULT_MESSAGES.DISABLED };
    if (typeof name !== 'string' || !ACTION_NAME_RE.test(name)) return { ok: false, code: 'INVALID', message: RESULT_MESSAGES.INVALID };
    const now = this.#now();
    for (const [t, v] of this.#tokens) if (v.expiresAt <= now) this.#tokens.delete(t);
    if (this.#tokens.size > 32) this.#tokens.clear();
    const token = randomBytes(16).toString('hex');
    const expiresAt = now + this.#confirmTtlMs;
    this.#tokens.set(token, { action: name, armedAt: now, expiresAt });
    return { ok: true, token, holdMs: this.#confirmHoldMs, expiresAt };
  }

  /** Cancel a pending confirmation (button released early). */
  disarm(token: string): void {
    this.#tokens.delete(token);
  }

  async trigger(name: string, opts: { holdMs?: number; confirmToken?: string; source?: 'ui' | 'hotkey' } = {}): Promise<ControlResult> {
    const now = this.#now();
    const local = (code: ControlResultCode, extra: Partial<ControlResult> = {}): ControlResult =>
      this.#record({ ok: false, code, action: String(name), message: RESULT_MESSAGES[code], sent: false, source: opts.source ?? 'ui', at: now, ...extra });

    if (!this.#opts.isEnabled()) return local('DISABLED');
    if (typeof name !== 'string' || !ACTION_NAME_RE.test(name)) return local('INVALID');
    let holdMs = opts.holdMs ?? 0;
    if (typeof holdMs !== 'number' || !Number.isFinite(holdMs) || holdMs < 0) return local('INVALID');
    holdMs = Math.min(Math.round(holdMs), MAX_HOLD_MS);

    if (!this.#actions) await this.refresh();
    if (!this.#actions) return local((this.#lastRefreshError as ControlResultCode) ?? 'GAME_UNREACHABLE');
    const action = this.#actions.get(name);
    if (!action) return local('UNKNOWN_ACTION');
    const label = action.label;
    if (holdMs > 0 && !action.holdable) return local('HOLD_NOT_ALLOWED', { label });

    let token: ArmToken | undefined;
    if (action.dangerous) {
      if (opts.source === 'hotkey') return local('CONFIRM_REQUIRED', { label, message: 'Dangerous actions cannot be triggered from a hotkey.' });
      token = opts.confirmToken ? this.#tokens.get(opts.confirmToken) : undefined;
      if (!token || token.action !== name || now > token.expiresAt) return local('CONFIRM_REQUIRED', { label });
      if (now - token.armedAt < this.#confirmHoldMs) return local('CONFIRM_REQUIRED', { label, message: 'Keep holding to confirm.' });
    }

    const wait = this.#rateLimitWait(name, now);
    if (wait > 0) return local('LOCAL_RATE_LIMITED', { label, retryAfterMs: wait });
    if (opts.confirmToken) this.#tokens.delete(opts.confirmToken);
    this.#lastAny = now;
    this.#lastByAction.set(name, now);
    this.#window.push(now);

    try {
      const res = await this.#opts.getClient().triggerAction(name, action.holdable ? holdMs : 0, this.#timeoutMs);
      const code = mapGameStatus(res?.status);
      return this.#record({
        ok: code === 'OK',
        code,
        action: name,
        label,
        message: RESULT_MESSAGES[code],
        gameMessage: res?.message || undefined,
        sent: true,
        source: opts.source ?? 'ui',
        at: now,
      });
    } catch (err) {
      const t = describeTransportError(err);
      if (t.code === 'GAME_UNREACHABLE') this.invalidate();
      // Deliberately no retry: a toggle might already have fired.
      return this.#record({ ok: false, code: t.code, action: name, label, message: RESULT_MESSAGES[t.code], gameMessage: t.detail, sent: true, source: opts.source ?? 'ui', at: now });
    }
  }

  #rateLimitWait(name: string, now: number): number {
    const r = this.#rate;
    this.#window = this.#window.filter((t) => now - t < r.burstWindowMs);
    let wait = 0;
    wait = Math.max(wait, this.#lastAny + r.minGapMs - now);
    const last = this.#lastByAction.get(name);
    if (last !== undefined) wait = Math.max(wait, last + r.perActionMs - now);
    if (this.#window.length >= r.burstMax) wait = Math.max(wait, this.#window[0] + r.burstWindowMs - now);
    return Math.max(0, Math.ceil(wait));
  }

  #record(r: ControlResult): ControlResult {
    this.#history.unshift(r);
    if (this.#history.length > 100) this.#history.length = 100;
    this.#opts.log?.(r.ok ? 'info' : 'warn', `Game control: ${r.action} → ${r.code}${r.gameMessage ? ` (${r.gameMessage})` : ''}`);
    this.emit('result', r);
    return r;
  }
}

/**
 * Address for TriggerGameAction: always 127.0.0.1. The telemetry service may learn another address
 * from Game.log (e.g. with grpc.client.server.external on); control never follows it off the
 * machine. Only the port is taken from it, and only if valid.
 */
export function loopbackControlAddress(address: string | null | undefined, defaultPort = 2942): string {
  const m = String(address ?? '').match(/:(\d{1,5})$/);
  const port = m ? Number(m[1]) : NaN;
  return `127.0.0.1:${port >= 1 && port <= 65535 ? port : defaultPort}`;
}

/** gRPC error → result code. 14 UNAVAILABLE, 4 DEADLINE_EXCEEDED. */
export function describeTransportError(err: unknown): { code: 'GAME_UNREACHABLE' | 'TIMEOUT' | 'ERROR'; detail?: string } {
  const e = err as { code?: number; details?: string; message?: string } | undefined;
  const detail = e?.details || e?.message || undefined;
  if (e?.code === 14) return { code: 'GAME_UNREACHABLE', detail };
  if (e?.code === 4) return { code: 'TIMEOUT', detail };
  return { code: 'ERROR', detail };
}
