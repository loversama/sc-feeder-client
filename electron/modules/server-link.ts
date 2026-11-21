/**
 * Socket.IO link to the VOIDLOG.GG server (/client namespace): connect, authenticate, reconnect.
 *
 * Electron-free on purpose (everything app-specific is injected) so the whole lifecycle can be
 * driven against a fake server in tests (test/telemetry/server-link.test.ts).
 *
 * Rules that keep telemetry flowing across server restarts / redeploys:
 *  - Never handshake with an access token that is expired or about to expire (`prepareAuth` refreshes
 *    it first; when that fails because the server is unreachable we retry later instead of connecting
 *    with the stale token or silently falling back to a guest session).
 *  - "Authenticated" only ever comes from the server's `authenticated` event. A socket that connects
 *    but is not authenticated within `authTimeoutMs` is torn down and reconnected with a forced token
 *    refresh (the server leaves such sockets connected but rejects every message on them).
 *  - Uploads that use acks (submit_telemetry) are watched: repeated missing acks or an auth error ack
 *    mean the server no longer accepts this socket, so it is re-authenticated.
 *  - Every handler is bound to the socket instance it was registered on; events of an old socket
 *    (torn down by us) never touch the state of the new one.
 */
import { EventEmitter } from 'node:events';

export type LinkStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

/** The subset of socket.io-client's Socket used here (lets tests inject a fake). */
export interface LinkSocket {
  readonly connected: boolean;
  readonly id?: string;
  on(event: string, fn: (...args: any[]) => void): any;
  off(event?: string, fn?: (...args: any[]) => void): any;
  emit(event: string, ...args: any[]): any;
  timeout(ms: number): { emit(event: string, ...args: any[]): any };
  disconnect(): any;
}

export type PreparedAuth =
  | { ok: true; token?: string; kind: 'user' | 'guest' | 'none' }
  | { ok: false; reason: string };

export type ServerLinkOptions = {
  url: string;
  path: string;
  io: (url: string, opts: Record<string, any>) => LinkSocket;
  /**
   * Returns the token for the next handshake. `forceRefresh` = the previous token was not accepted
   * (refresh even if it looks valid; for guests drop the guest token so the server issues a new one).
   */
  prepareAuth: (forceRefresh: boolean) => Promise<PreparedAuth>;
  /** Server issued a guest token (connected without a token). */
  onGuestToken?: (token: string) => void;
  query?: () => Record<string, string>;
  log?: (level: 'info' | 'warn' | 'error' | 'debug', msg: string) => void;
  reconnectDelays?: number[];
  /** Random extra delay added once the fixed delays are used up (avoids herds after a server restart). */
  reconnectJitterMs?: number;
  authTimeoutMs?: number;
  heartbeatMs?: number;
  /** No pong for this long = connection dead. */
  heartbeatDeadMs?: number;
  ackTimeoutMs?: number;
  /** Consecutive missing acks (with no good ack for `ackTimeoutMs`) before re-authenticating. */
  maxAckFailures?: number;
  connectTimeoutMs?: number;
  now?: () => number;
};

const AUTH_ERROR_RE = /session required|unauthori[sz]ed|forbidden|jwt|auth/i;

/** Expiry (ms since epoch) of a JWT, or 0 when it can't be read. */
export function jwtExpiresAt(token: string | null | undefined): number {
  if (!token) return 0;
  const part = token.split('.')[1];
  if (!part) return 0;
  try {
    const json = JSON.parse(Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    return typeof json.exp === 'number' ? json.exp * 1000 : 0;
  } catch {
    return 0;
  }
}

export type AuthSource = {
  getAccessToken: () => string | null;
  /** A signed-in user session exists (a refresh token is stored). */
  hasUserSession: () => boolean;
  /** Refresh the access token; resolves true when a new one is available. */
  refresh: () => Promise<boolean>;
  getGuestToken: () => string | null;
  clearGuestToken: () => void;
  /** Refresh when the access token expires within this window (default 60 s). */
  minValidityMs?: number;
  now?: () => number;
  log?: (level: 'info' | 'warn', msg: string) => void;
};

/**
 * `prepareAuth` for ServerLink. A signed-in user never handshakes with an expired access token and
 * never silently degrades to a guest session while the server is merely unreachable.
 */
export function makePrepareAuth(src: AuthSource): (forceRefresh: boolean) => Promise<PreparedAuth> {
  const now = src.now ?? Date.now;
  const minValidity = src.minValidityMs ?? 60_000;
  return async (forceRefresh) => {
    if (src.hasUserSession()) {
      const access = src.getAccessToken();
      const validFor = jwtExpiresAt(access) - now();
      if (!forceRefresh && access && validFor > minValidity) return { ok: true, token: access, kind: 'user' };
      src.log?.(
        'info',
        forceRefresh
          ? 'Refreshing access token (server did not accept the previous one)'
          : `Refreshing access token before connecting (${access ? `expires in ${Math.round(validFor / 1000)}s` : 'none in memory'})`,
      );
      const ok = await src.refresh();
      const fresh = src.getAccessToken();
      if (ok && fresh) return { ok: true, token: fresh, kind: 'user' };
      if (src.hasUserSession()) return { ok: false, reason: 'access token refresh failed (server unreachable?)' };
      src.log?.('warn', 'Refresh token was rejected; continuing as guest');
    }
    if (forceRefresh) src.clearGuestToken(); // rejected guest token: the server issues a new one when we connect without
    const guest = src.getGuestToken();
    return guest ? { ok: true, token: guest, kind: 'guest' } : { ok: true, kind: 'none' };
  };
}

export class ServerLink extends EventEmitter {
  status: LinkStatus = 'disconnected';
  authenticated = false;
  /** Number of reconnect attempts since the last successful authentication. */
  attempt = 0;
  lastDisconnectReason: string | null = null;
  /** Counters for diagnostics / tests. */
  stats = { connects: 0, authenticated: 0, disconnects: 0, authTimeouts: 0, ackFailures: 0, reauths: 0 };

  #o: Required<Omit<ServerLinkOptions, 'onGuestToken'>> & Pick<ServerLinkOptions, 'onGuestToken'>;
  #socket: LinkSocket | null = null;
  #wanted = false;
  #connecting = false;
  #forceRefresh = false;
  #reconnectTimer: NodeJS.Timeout | null = null;
  #authTimer: NodeJS.Timeout | null = null;
  #heartbeatTimer: NodeJS.Timeout | null = null;
  #lastPong = 0;
  #ackFailures = 0;
  #lastGoodAck = 0;
  #handlers = new Map<string, Array<(...args: any[]) => void>>();

  constructor(opts: ServerLinkOptions) {
    super();
    this.#o = {
      query: () => ({}),
      log: () => {},
      reconnectDelays: [3000, 5000, 10000, 15000],
      reconnectJitterMs: 15000,
      authTimeoutMs: 10000,
      heartbeatMs: 20000,
      heartbeatDeadMs: 65000,
      ackTimeoutMs: 15000,
      maxAckFailures: 5,
      connectTimeoutMs: 30000,
      now: Date.now,
      ...opts,
    };
  }

  get socket(): LinkSocket | null {
    return this.#socket;
  }

  get connected(): boolean {
    return !!this.#socket?.connected;
  }

  /** Register a server→client event handler; it is attached to every (re)created socket. */
  onServer(event: string, fn: (...args: any[]) => void): void {
    const list = this.#handlers.get(event) ?? [];
    list.push(fn);
    this.#handlers.set(event, list);
    this.#socket?.on(event, fn);
  }

  /** Start (or keep) the link. Idempotent: does nothing while connecting / connected / waiting to retry. */
  start(): void {
    this.#wanted = true;
    if (this.#socket || this.#connecting || this.#reconnectTimer) return;
    void this.#connect();
  }

  /** Stop and stay disconnected until `start()`. */
  stop(): void {
    this.#wanted = false;
    this.#clearTimers();
    this.#teardown('stopped');
    this.#setStatus('disconnected');
  }

  /** Drop the current socket and connect again right away (user action, login/logout, new token). */
  reconnectNow(opts: { forceRefresh?: boolean } = {}): void {
    this.#wanted = true;
    if (opts.forceRefresh) this.#forceRefresh = true;
    this.#clearTimers();
    this.#teardown('reconnect requested');
    this.attempt = 0;
    void this.#connect();
  }

  /** Fire-and-forget emit; only while authenticated. */
  send(event: string, payload: unknown): boolean {
    if (!this.authenticated || !this.#socket?.connected) return false;
    this.#socket.emit(event, payload);
    return true;
  }

  /**
   * Emit with an acknowledgement watchdog (the server must ack every such message).
   * `onAck` gets the ack, or `undefined` on timeout.
   */
  sendWithAck(event: string, payload: unknown, onAck?: (ack: any | undefined) => void): boolean {
    if (!this.authenticated || !this.#socket?.connected) return false;
    const s = this.#socket;
    s.timeout(this.#o.ackTimeoutMs).emit(event, payload, (err: unknown, ack: any) => {
      if (s !== this.#socket) return;
      if (err) {
        this.#noteAckFailure(`no ack for ${event} within ${this.#o.ackTimeoutMs} ms`, false);
      } else if (ack && ack.ok === false && typeof ack.error === 'string' && AUTH_ERROR_RE.test(ack.error)) {
        this.#noteAckFailure(`server rejected ${event}: ${ack.error}`, true);
      } else {
        this.#ackFailures = 0;
        this.#lastGoodAck = this.#o.now();
      }
      onAck?.(err ? undefined : ack);
    });
    return true;
  }

  // --- internals -------------------------------------------------------------

  async #connect(): Promise<void> {
    if (!this.#wanted || this.#connecting) return;
    this.#connecting = true;
    this.#reconnectTimer = null;
    this.#setStatus('connecting');
    let auth: PreparedAuth;
    try {
      auth = await this.#o.prepareAuth(this.#forceRefresh);
    } catch (err) {
      auth = { ok: false, reason: (err as Error)?.message ?? String(err) };
    }
    this.#connecting = false;
    if (!this.#wanted) return;
    if (!auth.ok) {
      this.#o.log('warn', `Not connecting yet: ${auth.reason}`);
      this.#scheduleReconnect();
      return;
    }
    this.#forceRefresh = false;
    this.#teardown('replaced');
    this.stats.connects++;
    this.#o.log('info', `Connecting to ${this.#o.url} (${auth.kind} token, attempt ${this.attempt})`);
    const s = this.#o.io(this.#o.url, {
      path: this.#o.path,
      reconnection: false,
      timeout: this.#o.connectTimeoutMs,
      transports: ['websocket'],
      auth: auth.token ? { token: auth.token } : {},
      query: this.#o.query(),
      forceNew: true,
    });
    this.#socket = s;
    const mine = (fn: (...a: any[]) => void) => (...a: any[]) => {
      if (s === this.#socket) fn(...a);
    };

    s.on('connect', mine(() => {
      this.#o.log('info', `Socket connected (${s.id}), waiting for authentication`);
      this.#lastPong = this.#o.now();
      this.#authTimer = setTimeout(mine(() => {
        this.stats.authTimeouts++;
        this.#o.log('warn', `Server did not authenticate socket ${s.id} within ${this.#o.authTimeoutMs} ms; refreshing credentials and reconnecting`);
        this.#reauth('authentication timeout');
      }), this.#o.authTimeoutMs);
    }));
    s.on('authenticated', mine(() => {
      if (this.#authTimer) clearTimeout(this.#authTimer);
      this.#authTimer = null;
      this.authenticated = true;
      this.attempt = 0;
      this.#ackFailures = 0;
      this.#lastGoodAck = this.#o.now();
      this.stats.authenticated++;
      this.#o.log('info', `Authenticated (${s.id})`);
      this.#setStatus('connected');
      this.#startHeartbeat(s);
      this.emit('authenticated');
    }));
    s.on('guestToken', mine((data: { token?: string }) => {
      if (!data?.token) return;
      this.#o.log('info', 'Server issued a guest token; reconnecting with it');
      this.#o.onGuestToken?.(data.token);
      this.#clearTimers();
      this.#teardown('guest token received');
      void this.#connect();
    }));
    s.on('retry_auth', mine((data: { reason?: string }) => {
      this.#o.log('warn', `Server asked to re-authenticate: ${data?.reason ?? 'no reason'}`);
      this.#reauth('retry_auth');
    }));
    s.on('exception', mine((data: any) => {
      // Nest's WS exception filter (a guard rejected a message). Treat like a failed ack.
      const msg = typeof data?.message === 'string' ? data.message : JSON.stringify(data ?? {});
      this.#noteAckFailure(`server exception: ${msg}`, AUTH_ERROR_RE.test(msg));
    }));
    s.on('pong', mine(() => {
      this.#lastPong = this.#o.now();
    }));
    s.on('disconnect', mine((reason: string) => {
      this.#o.log('warn', `Disconnected: ${reason}`);
      this.lastDisconnectReason = reason;
      this.stats.disconnects++;
      this.#socket = null;
      s.off();
      this.#onLost();
    }));
    s.on('connect_error', mine((err: Error) => {
      const msg = err?.message ?? String(err);
      this.#o.log('warn', `Connection error: ${msg}`);
      this.lastDisconnectReason = msg;
      if (AUTH_ERROR_RE.test(msg)) this.#forceRefresh = true;
      this.#socket = null;
      s.off();
      s.disconnect();
      this.#onLost();
    }));
    for (const [event, fns] of this.#handlers) for (const fn of fns) s.on(event, fn);
  }

  #onLost(): void {
    const was = this.authenticated;
    this.authenticated = false;
    this.#stopHeartbeat();
    if (this.#authTimer) clearTimeout(this.#authTimer);
    this.#authTimer = null;
    if (was) this.emit('unauthenticated');
    this.#setStatus('disconnected');
    this.#scheduleReconnect();
  }

  /** The server no longer accepts our credentials on this socket: refresh and reconnect. */
  #reauth(reason: string): void {
    this.stats.reauths++;
    this.#forceRefresh = true;
    this.#clearTimers();
    const was = this.authenticated;
    this.#teardown(reason);
    if (was) this.emit('unauthenticated');
    this.#setStatus('disconnected');
    this.#scheduleReconnect(1000);
  }

  #noteAckFailure(why: string, authError: boolean): void {
    this.stats.ackFailures++;
    this.#ackFailures = authError ? this.#o.maxAckFailures : this.#ackFailures + 1;
    this.#o.log(authError ? 'warn' : 'debug', why);
    const sinceGood = this.#o.now() - this.#lastGoodAck;
    if (this.#ackFailures >= this.#o.maxAckFailures && (authError || sinceGood >= this.#o.ackTimeoutMs)) {
      this.#o.log('warn', `Server stopped accepting uploads on this socket (${why}); re-authenticating`);
      this.#ackFailures = 0;
      this.#reauth('uploads not acknowledged');
    }
  }

  #scheduleReconnect(delayOverride?: number): void {
    if (!this.#wanted || this.#reconnectTimer) return;
    const d = this.#o.reconnectDelays;
    const delay =
      delayOverride ??
      (this.attempt < d.length ? d[this.attempt] : d[d.length - 1] + Math.floor(Math.random() * this.#o.reconnectJitterMs));
    this.attempt++;
    this.#o.log('info', `Reconnecting in ${Math.round(delay / 100) / 10}s (attempt ${this.attempt})`);
    this.emit('reconnect-scheduled', this.attempt, delay);
    this.#reconnectTimer = setTimeout(() => {
      this.#reconnectTimer = null;
      void this.#connect();
    }, delay);
  }

  #startHeartbeat(s: LinkSocket): void {
    this.#stopHeartbeat();
    this.#lastPong = this.#o.now();
    this.#heartbeatTimer = setInterval(() => {
      if (s !== this.#socket || !s.connected) return this.#stopHeartbeat();
      const silent = this.#o.now() - this.#lastPong;
      if (silent > this.#o.heartbeatDeadMs) {
        this.#o.log('warn', `No pong for ${silent} ms; reconnecting`);
        this.#socket = null;
        s.off();
        s.disconnect();
        this.lastDisconnectReason = 'heartbeat timeout';
        this.#onLost();
        return;
      }
      s.emit('ping', { timestamp: this.#o.now() });
    }, this.#o.heartbeatMs);
  }

  #stopHeartbeat(): void {
    if (this.#heartbeatTimer) clearInterval(this.#heartbeatTimer);
    this.#heartbeatTimer = null;
  }

  #teardown(reason: string): void {
    const s = this.#socket;
    if (!s) return;
    this.#socket = null;
    this.authenticated = false;
    this.#stopHeartbeat();
    if (this.#authTimer) clearTimeout(this.#authTimer);
    this.#authTimer = null;
    this.#o.log('debug', `Closing socket ${s.id ?? ''} (${reason})`);
    s.off();
    s.disconnect();
  }

  #clearTimers(): void {
    if (this.#reconnectTimer) clearTimeout(this.#reconnectTimer);
    if (this.#authTimer) clearTimeout(this.#authTimer);
    this.#reconnectTimer = this.#authTimer = null;
    this.#stopHeartbeat();
  }

  #setStatus(s: LinkStatus): void {
    const prev = this.status;
    this.status = s;
    this.emit('status', s, prev, this.attempt);
  }
}
