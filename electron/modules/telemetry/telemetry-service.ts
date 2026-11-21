/**
 * Telemetry service: owns the TelemetryStream connection to the running game, keeps the merged
 * state, derives events, and uploads a throttled snapshot + events to VOIDLOG.GG.
 *
 * Electron-free on purpose (deps are injected) so it can be driven by a fake gRPC server in tests.
 */
import { EventEmitter } from 'node:events';
import { TelemetryClient, DEFAULT_TELEMETRY_ADDRESS, type StreamHandle } from './telemetry-client';
import { TelemetryState, type TelemetryEvent, type Obj } from './telemetry-state';

export type TelemetryStatus =
  | 'disabled'
  /** no stream; trying to reach 127.0.0.1:2942 (game closed, telemetry off, or LIVE without the API) */
  | 'waiting_for_game'
  /** stream accepted but no frame yet (character not spawned) */
  | 'connected'
  /** frames arriving */
  | 'streaming';

/** Hints read from Game.log lines (independent of the gRPC connection). */
export type TelemetryLogHints = {
  cfgEnabled: boolean | null;
  serviceRegistered: boolean;
  serverAddress: string | null;
  componentInitialized: boolean;
  lastHintAt: string | null;
};

export type TelemetryUploadPayload =
  | { kind: 'snapshot'; snapshot: Obj; capturedAt: string; fps: number }
  | { kind: 'events'; events: TelemetryEvent[] };

export type TelemetryServiceOptions = {
  address?: string;
  /** Upload hook (returns true when actually sent). Called only while sharing is enabled. */
  upload?: (payload: TelemetryUploadPayload) => boolean;
  isSharingEnabled?: () => boolean;
  includeBalance?: () => boolean;
  log?: (level: 'info' | 'warn' | 'debug', msg: string) => void;
  /** Override for tests */
  clientFactory?: (address: string) => Pick<TelemetryClient, 'openStream' | 'close'>;
  retryMs?: number[];
  silenceMs?: number;
  snapshotIntervalMs?: number;
  heartbeatMs?: number;
  eventFlushMs?: number;
  now?: () => number;
};

const MAX_RECENT_EVENTS = 100;
const MAX_SNAPSHOT_BYTES = 16 * 1024;

export class TelemetryService extends EventEmitter {
  readonly state = new TelemetryState();
  status: TelemetryStatus = 'disabled';
  lastError: string | null = null;
  connectAttempts = 0;
  streamOpenedAt = 0;
  bytesReceived = 0;
  logHints: TelemetryLogHints = { cfgEnabled: null, serviceRegistered: false, serverAddress: null, componentInitialized: false, lastHintAt: null };
  recentEvents: Array<TelemetryEvent & { shared?: boolean }> = [];
  lastSharedSnapshot: { at: string; bytes: number; snapshot: Obj } | null = null;

  #opts: Required<Omit<TelemetryServiceOptions, 'upload' | 'clientFactory' | 'address'>> & Pick<TelemetryServiceOptions, 'upload' | 'clientFactory'>;
  #address: string;
  #client: Pick<TelemetryClient, 'openStream' | 'close'> | null = null;
  #stream: StreamHandle | null = null;
  #retryTimer: NodeJS.Timeout | null = null;
  #tickTimer: NodeJS.Timeout | null = null;
  #uploadTimer: NodeJS.Timeout | null = null;
  #eventTimer: NodeJS.Timeout | null = null;
  #attempt = 0;
  #lastActivity = 0;
  #pendingEvents: TelemetryEvent[] = [];
  #lastSnapshotJson = '';
  #lastSnapshotSentAt = 0;
  #running = false;

  constructor(opts: TelemetryServiceOptions = {}) {
    super();
    this.#address = opts.address ?? DEFAULT_TELEMETRY_ADDRESS;
    this.#opts = {
      upload: opts.upload,
      clientFactory: opts.clientFactory,
      isSharingEnabled: opts.isSharingEnabled ?? (() => false),
      includeBalance: opts.includeBalance ?? (() => false),
      log: opts.log ?? (() => {}),
      retryMs: opts.retryMs ?? [1000, 2000, 5000, 10000],
      silenceMs: opts.silenceMs ?? 15000,
      snapshotIntervalMs: opts.snapshotIntervalMs ?? 1000,
      heartbeatMs: opts.heartbeatMs ?? 10000,
      eventFlushMs: opts.eventFlushMs ?? 250,
      now: opts.now ?? Date.now,
    };
  }

  get address(): string {
    return this.#address;
  }

  get running(): boolean {
    return this.#running;
  }

  start(): void {
    if (this.#running) return;
    this.#running = true;
    this.#attempt = 0;
    this.#setStatus('waiting_for_game');
    this.#open();
    this.#tickTimer = setInterval(() => this.#tick(), 500);
    this.#uploadTimer = setInterval(() => this.#uploadSnapshot(), this.#opts.snapshotIntervalMs);
    this.#eventTimer = setInterval(() => this.#flushEvents(), this.#opts.eventFlushMs);
  }

  stop(): void {
    this.#running = false;
    this.#stream?.cancel();
    this.#stream = null;
    for (const t of [this.#retryTimer]) if (t) clearTimeout(t);
    for (const t of [this.#tickTimer, this.#uploadTimer, this.#eventTimer]) if (t) clearInterval(t);
    this.#retryTimer = this.#tickTimer = this.#uploadTimer = this.#eventTimer = null;
    this.#client?.close();
    this.#client = null;
    this.state.reset();
    this.#setStatus('disabled');
  }

  /** A new Game.log started: the hints read from the previous one no longer apply. */
  resetLogHints(): void {
    this.logHints = { cfgEnabled: null, serviceRegistered: false, serverAddress: null, componentInitialized: false, lastHintAt: null };
  }

  /** Reconnect now (e.g. Game.log says the telemetry server just came up). */
  kick(reason: string): void {
    if (!this.#running) return;
    if (this.status === 'streaming' || this.status === 'connected') return;
    this.#opts.log('info', `Telemetry reconnect requested: ${reason}`);
    if (this.#retryTimer) clearTimeout(this.#retryTimer);
    this.#retryTimer = null;
    this.#stream?.cancel();
    this.#stream = null;
    this.#attempt = 0;
    this.#open();
  }

  /**
   * Feed new Game.log content. Picks up the lines the game writes about its telemetry server:
   *   [User CFG ] server.game.telemetry.enabled=true
   *   <Register Service> Service 'sc.game.telemetry.v1.GameTelemetryService' registered
   *   <GameTelemetry> Local services server is running on 127.0.0.1:2942
   *   Initializing game telemetry component of local player
   */
  noteLogChunk(chunk: string): void {
    if (!chunk.includes('elemetry')) return; // cheap pre-filter (Telemetry / telemetry)
    let kicked = false;
    for (const line of chunk.split('\n')) {
      if (!line.includes('elemetry')) continue;
      const cfg = line.match(/server\.game\.telemetry\.enabled\s*=\s*(\w+)/i);
      if (cfg) this.logHints.cfgEnabled = /^(1|true)$/i.test(cfg[1]);
      if (/GameTelemetryService'?\s+registered/.test(line)) this.logHints.serviceRegistered = true;
      const addr = line.match(/Local services server is running on\s+([\d.]+:\d+)/);
      if (addr) {
        this.logHints.serverAddress = addr[1];
        if (addr[1] !== this.#address) {
          this.#opts.log('info', `Game reports telemetry server at ${addr[1]} (was ${this.#address})`);
          this.#address = addr[1];
          this.#client?.close();
          this.#client = null;
        }
        kicked = true;
      }
      if (/Initializing game telemetry component/i.test(line)) {
        this.logHints.componentInitialized = true;
        kicked = true;
      }
      this.logHints.lastHintAt = new Date(this.#opts.now()).toISOString();
    }
    if (kicked) this.kick('Game.log telemetry line');
  }

  // --- stream lifecycle ------------------------------------------------------

  #getClient(): Pick<TelemetryClient, 'openStream' | 'close'> {
    if (!this.#client) {
      this.#client = this.#opts.clientFactory ? this.#opts.clientFactory(this.#address) : new TelemetryClient(this.#address);
    }
    return this.#client;
  }

  #open(): void {
    if (!this.#running) return;
    this.#retryTimer = null;
    this.connectAttempts++;
    this.#lastActivity = this.#opts.now();
    let client: Pick<TelemetryClient, 'openStream' | 'close'>;
    try {
      client = this.#getClient();
    } catch (err) {
      this.lastError = `schema/client: ${(err as Error).message}`;
      this.#opts.log('warn', `Telemetry client could not be created: ${this.lastError}`);
      this.#scheduleRetry();
      return;
    }
    const handle = client.openStream(
      (frame, bytes) => this.#onFrame(frame, bytes, handle),
      (err) => this.#onEnd(err, handle),
    );
    this.#stream = handle;
  }

  #onFrame(frame: Obj, bytes: number, handle: StreamHandle): void {
    if (handle !== this.#stream) return;
    const now = this.#opts.now();
    this.#attempt = 0;
    this.#lastActivity = now;
    this.bytesReceived += bytes;
    if (this.status !== 'streaming') {
      this.streamOpenedAt = now;
      this.lastError = null;
      this.#setStatus('streaming');
    }
    const events = this.state.applyFrame(frame, now);
    for (const e of events) this.#recordEvent(e);
    this.emit('frame', frame);
  }

  #onEnd(err: Error | undefined, handle: StreamHandle): void {
    if (handle !== this.#stream) return;
    this.#stream = null;
    if (err) {
      const msg = err.message || String(err);
      // UNAVAILABLE / ECONNREFUSED is the normal "game not running" case: keep it quiet.
      if (msg !== this.lastError) this.#opts.log(/UNAVAILABLE|ECONNREFUSED|No connection established/i.test(msg) ? 'debug' : 'warn', `Telemetry stream ended: ${msg}`);
      this.lastError = msg;
    }
    if (this.status === 'streaming' || this.status === 'connected') {
      for (const e of this.state.tick(this.#opts.now() + this.state.staleMs)) this.#recordEvent(e);
      this.state.reset();
    }
    this.#setStatus('waiting_for_game');
    this.#scheduleRetry();
  }

  #scheduleRetry(): void {
    if (!this.#running) return;
    const r = this.#opts.retryMs;
    const delay = r[Math.min(this.#attempt, r.length - 1)];
    this.#attempt++;
    this.#retryTimer = setTimeout(() => this.#open(), delay);
  }

  #tick(): void {
    const now = this.#opts.now();
    if (this.#stream && now - this.#lastActivity >= this.#opts.silenceMs) {
      // Stream accepted but silent (opened before spawn, or game froze): restart it.
      this.#opts.log('debug', 'Telemetry stream silent, reopening');
      const s = this.#stream;
      this.#stream = null;
      s.cancel();
      // Also drop the gRPC channel: the game only notices a client leaving when the connection closes,
      // so cancelled streams on a reused connection pile up as "Client connected (total=N)" in the game.
      this.#client?.close();
      this.#client = null;
      if (this.status === 'streaming') this.#setStatus('connected');
      this.#scheduleRetry();
    }
    if (this.status === 'streaming') {
      for (const e of this.state.tick(now)) this.#recordEvent(e);
    }
  }

  #setStatus(s: TelemetryStatus): void {
    if (this.status === s) return;
    const prev = this.status;
    this.status = s;
    this.emit('status', s, prev);
  }

  // --- events + upload ---------------------------------------------------------

  #recordEvent(e: TelemetryEvent): void {
    const entry = { ...e } as TelemetryEvent & { shared?: boolean };
    this.recentEvents.unshift(entry);
    if (this.recentEvents.length > MAX_RECENT_EVENTS) this.recentEvents.length = MAX_RECENT_EVENTS;
    if (!e.data?.localOnly) this.#pendingEvents.push(e);
    else entry.shared = false;
    this.emit('event', entry);
  }

  #flushEvents(): void {
    if (!this.#pendingEvents.length) return;
    const batch = this.#pendingEvents.splice(0, this.#pendingEvents.length);
    let sent = false;
    if (this.#opts.isSharingEnabled() && this.#opts.upload) {
      sent = this.#opts.upload({ kind: 'events', events: batch });
    }
    for (const e of batch) {
      const rec = this.recentEvents.find((r) => r.id === e.id);
      if (rec) rec.shared = sent;
      this.emit('event-shared', e.id, sent);
    }
  }

  #uploadSnapshot(): void {
    if (this.status !== 'streaming' || !this.#opts.isSharingEnabled() || !this.#opts.upload) return;
    const now = this.#opts.now();
    const snapshot = this.state.buildSharedSnapshot({ includeBalance: this.#opts.includeBalance() }, now);
    if (!Object.keys(snapshot).length) return;
    const json = JSON.stringify(snapshot);
    const changed = json !== this.#lastSnapshotJson;
    if (!changed && now - this.#lastSnapshotSentAt < this.#opts.heartbeatMs) return;
    if (json.length > MAX_SNAPSHOT_BYTES) {
      this.#opts.log('warn', `Telemetry snapshot too large (${json.length} B), skipped`);
      return;
    }
    const ok = this.#opts.upload({ kind: 'snapshot', snapshot, capturedAt: new Date(now).toISOString(), fps: Math.round(this.state.fps() * 10) / 10 });
    if (ok) {
      this.#lastSnapshotJson = json;
      this.#lastSnapshotSentAt = now;
      this.lastSharedSnapshot = { at: new Date(now).toISOString(), bytes: json.length, snapshot };
    }
  }
}
