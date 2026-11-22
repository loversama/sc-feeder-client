/**
 * Minimal client for Star Citizen's local game telemetry API.
 *
 *   service sc.game.telemetry.v1.GameTelemetryService @ 127.0.0.1:2942 (plaintext gRPC, no auth)
 *     rpc TelemetryStream(TelemetryStreamRequest) returns (stream TelemetryStreamResponse)
 *     rpc ListTriggerableActions(...)  / rpc TriggerGameAction(...)
 *
 * Enabled in-game with `server.game.telemetry.enabled=1` in the channel's user.cfg (5.0 PTU+).
 * The server doesn't support reflection, so messages are encoded/decoded with the embedded
 * FileDescriptorSet (schema-desc.ts).
 */
import * as grpc from '@grpc/grpc-js';
import protobuf from 'protobufjs';
import 'protobufjs/ext/descriptor/index.js'; // adds Root.fromDescriptor
import { SCHEMA_DESC_BASE64 } from './schema-desc';

export const TELEMETRY_PACKAGE = 'sc.game.telemetry.v1';
export const TELEMETRY_SERVICE = `${TELEMETRY_PACKAGE}.GameTelemetryService`;
export const DEFAULT_TELEMETRY_ADDRESS = '127.0.0.1:2942';

export type DecodedFrame = Record<string, any>;
export type StreamHandle = { cancel(): void };
export type GameAction = { name: string; category: string; holdable: boolean };

let cachedRoot: protobuf.Root | null = null;

export function loadTelemetryRoot(descBase64: string = SCHEMA_DESC_BASE64): protobuf.Root {
  if (cachedRoot && descBase64 === SCHEMA_DESC_BASE64) return cachedRoot;
  const buf = Buffer.from(descBase64, 'base64');
  const root = (protobuf.Root as any).fromDescriptor(buf) as protobuf.Root;
  if (descBase64 === SCHEMA_DESC_BASE64) cachedRoot = root;
  return root;
}

export class TelemetryClient {
  readonly address: string;
  #client: grpc.Client;
  #root: protobuf.Root;

  constructor(address = DEFAULT_TELEMETRY_ADDRESS, root: protobuf.Root = loadTelemetryRoot()) {
    this.address = address;
    this.#root = root;
    // Local-only server: cap gRPC's internal reconnect backoff so a game restart is picked up quickly.
    this.#client = new grpc.Client(address, grpc.credentials.createInsecure(), {
      'grpc.initial_reconnect_backoff_ms': 1000,
      'grpc.max_reconnect_backoff_ms': 5000,
    });
  }

  type(name: string): protobuf.Type {
    return this.#root.lookupType(`${TELEMETRY_PACKAGE}.${name}`);
  }

  /**
   * Open TelemetryStream. `onEnd` fires exactly once (server end, error, unreachable) and never
   * after `cancel()`.
   */
  openStream(onFrame: (frame: DecodedFrame, bytes: number) => void, onEnd: (err?: Error) => void): StreamHandle {
    const req = this.type('TelemetryStreamRequest');
    const res = this.type('TelemetryStreamResponse');
    let finished = false;
    let lastBytes = 0;
    const finish = (err?: Error) => {
      if (finished) return;
      finished = true;
      onEnd(err);
    };
    const call = this.#client.makeServerStreamRequest(
      `/${TELEMETRY_SERVICE}/TelemetryStream`,
      (o: object) => Buffer.from(req.encode(req.fromObject(o)).finish()),
      (b: Buffer) => {
        lastBytes = b.length;
        return res.toObject(res.decode(b), { enums: String, longs: String }) as DecodedFrame;
      },
      {},
    );
    call.on('data', (frame: DecodedFrame) => {
      if (!finished) onFrame(frame, lastBytes);
    });
    call.on('error', (err: Error) => finish(err));
    call.on('end', () => finish());
    return {
      cancel: () => {
        finished = true;
        call.cancel();
      },
    };
  }

  listActions(timeoutMs = 2000): Promise<GameAction[]> {
    return this.#unary('ListTriggerableActions', {}, timeoutMs).then((res) =>
      ((res.actions ?? []) as any[]).map((a) => ({ name: a.action_name, category: a.category, holdable: !!a.holdable })),
    );
  }

  /**
   * TriggerGameAction. Resolves with the game's status enum name (TRIGGER_GAME_ACTION_STATUS_*) and
   * message; rejects only on transport errors. Callers must not retry (toggles would double-fire).
   */
  triggerAction(name: string, holdMs = 0, timeoutMs = 2000): Promise<{ status: string; message: string }> {
    const req: Record<string, unknown> = { action_name: name };
    if (holdMs > 0) req.hold_ms = Math.round(holdMs);
    return this.#unary('TriggerGameAction', req, timeoutMs).then((res) => ({ status: String(res.status), message: String(res.message ?? '') }));
  }

  close(): void {
    this.#client.close();
  }

  #unary(rpc: string, request: object, timeoutMs: number): Promise<Record<string, any>> {
    const req = this.type(`${rpc}Request`);
    const res = this.type(`${rpc}Response`);
    return new Promise((resolve, reject) => {
      this.#client.makeUnaryRequest(
        `/${TELEMETRY_SERVICE}/${rpc}`,
        (o: object) => Buffer.from(req.encode(req.fromObject(o)).finish()),
        (b: Buffer) => res.toObject(res.decode(b), { enums: String, defaults: true }),
        request,
        { deadline: Date.now() + timeoutMs },
        (err, value) => (err ? reject(err) : resolve(value as Record<string, any>)),
      );
    });
  }
}
