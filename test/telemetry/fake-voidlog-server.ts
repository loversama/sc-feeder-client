/**
 * Minimal stand-in for the VOIDLOG.GG server's /client Socket.IO namespace, speaking the real
 * Engine.IO v4 / Socket.IO v5 wire protocol over `ws` (websocket transport only), so the real
 * socket.io-client is exercised. Behaves like LogsGateway:
 *  - handshake with a valid user token → `authenticated`
 *  - handshake with an expired / unknown token → stays connected, no `authenticated`, and every
 *    submit_telemetry is rejected by the guard (no ack + Nest `exception` event)
 *  - no token → `guestToken`
 *  - `ping` → `pong`; submit_telemetry acks { ok: true }
 * `stop()` drops every connection like a crashed / redeployed server; `start()` again on the same port.
 */
import http from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';

export const makeToken = (sub: string, expMs: number) =>
  `h.${Buffer.from(JSON.stringify({ sub, exp: Math.floor(expMs / 1000) })).toString('base64url')}.sig`;

const tokenExp = (t: string) => {
  try {
    return JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString()).exp * 1000;
  } catch {
    return 0;
  }
};

type Conn = { ws: WebSocket; authed: boolean; token?: string; query: URLSearchParams };

export class FakeVoidlogServer {
  port = 0;
  /** Every handshake token seen, in order. */
  handshakes: Array<{ token?: string; valid: boolean; at: number }> = [];
  telemetry: any[] = [];
  logChunks: any[] = [];
  /** When true, authenticated sockets stop being accepted (as if the server lost their session). */
  rejectUploads = false;
  #http: http.Server | null = null;
  #wss: WebSocketServer | null = null;
  #conns = new Set<Conn>();
  #sid = 0;

  async start(port = this.port): Promise<number> {
    this.#http = http.createServer();
    this.#wss = new WebSocketServer({ server: this.#http });
    this.#wss.on('connection', (ws, req) => this.#onConnection(ws, req));
    await new Promise<void>((resolve) => this.#http!.listen(port, '127.0.0.1', () => resolve()));
    this.port = (this.#http.address() as any).port;
    return this.port;
  }

  /** Kill the server: every socket drops (transport close), nothing listens until start(). */
  async stop(): Promise<void> {
    for (const c of this.#conns) c.ws.terminate();
    this.#conns.clear();
    await new Promise<void>((r) => (this.#wss ? this.#wss.close(() => r()) : r()));
    await new Promise<void>((r) => (this.#http ? this.#http.close(() => r()) : r()));
    this.#wss = null;
    this.#http = null;
  }

  get openSockets(): number {
    return this.#conns.size;
  }

  #onConnection(ws: WebSocket, req: http.IncomingMessage): void {
    const query = new URL(req.url ?? '/', 'http://x').searchParams;
    const conn: Conn = { ws, authed: false, query };
    this.#conns.add(conn);
    ws.on('close', () => this.#conns.delete(conn));
    ws.send(`0${JSON.stringify({ sid: `e${++this.#sid}`, upgrades: [], pingInterval: 25000, pingTimeout: 20000, maxPayload: 1e6 })}`);
    ws.on('message', (raw) => this.#onPacket(conn, raw.toString()));
  }

  #send(conn: Conn, event: string, data?: unknown): void {
    conn.ws.send(`42/client,${JSON.stringify(data === undefined ? [event] : [event, data])}`);
  }

  #onPacket(conn: Conn, p: string): void {
    if (p === '3') return; // engine.io pong
    if (!p.startsWith('4')) return;
    const m = p.match(/^4(\d)(?:\/client,)?(\d*)(.*)$/s);
    if (!m) return;
    const [, type, ackId, json] = m;
    if (type === '0') {
      const auth = json ? JSON.parse(json) : {};
      conn.ws.send(`40/client,${JSON.stringify({ sid: `s${++this.#sid}` })}`);
      const token: string | undefined = auth?.token;
      const valid = !!token && token.startsWith('h.') && tokenExp(token) > Date.now();
      this.handshakes.push({ token, valid, at: Date.now() });
      conn.token = token;
      if (!token) this.#send(conn, 'guestToken', { token: makeToken('guest', Date.now() + 3600_000) });
      else if (valid) {
        conn.authed = true;
        this.#send(conn, 'authenticated');
      }
      // invalid / expired: LogsGateway logs "TOKEN VERIFICATION FAILED" and leaves the socket as is
      return;
    }
    if (type === '1') {
      conn.ws.close();
      return;
    }
    if (type !== '2') return;
    const [event, data] = JSON.parse(json);
    if (event === 'ping') return this.#send(conn, 'pong', { timestamp: Date.now(), received: data?.timestamp });
    if (event === 'submit_log_chunk') {
      if (conn.authed && !this.rejectUploads) this.logChunks.push(data);
      return; // void handler: never acked
    }
    if (event === 'submit_telemetry') {
      if (!conn.authed || this.rejectUploads) {
        // WsJwtAuthGuard throws → Nest's BaseWsExceptionFilter; the ack callback is never called
        this.#send(conn, 'exception', { status: 'error', message: 'Internal server error' });
        return;
      }
      this.telemetry.push(data);
      if (ackId) conn.ws.send(`43/client,${ackId}${JSON.stringify([{ ok: true }])}`);
    }
  }
}
