/**
 * Debug bus for the in-game overlay: a ring buffer of every "event" that passes through the
 * client (telemetry-derived, Game.log parser, server-pushed) plus counters for what was
 * uploaded to VOIDLOG.GG. Pure module.
 */

export type DebugEventSource = 'telemetry' | 'log' | 'server' | 'system';

export type DebugEvent = {
  id: string;
  at: string;
  source: DebugEventSource;
  type: string;
  summary: string;
  severity?: 'info' | 'warn' | 'alert';
  /** true once it was sent to the VOIDLOG.GG server, false if kept local, undefined = n/a */
  shared?: boolean;
};

export type UploadCounters = {
  logChunks: number;
  logBytes: number;
  telemetrySnapshots: number;
  telemetryEvents: number;
  telemetryBytes: number;
  lastTelemetryUploadAt: string | null;
  lastLogUploadAt: string | null;
  dropped: number;
};

const MAX_EVENTS = 60;
const events: DebugEvent[] = [];
let seq = 0;
const counters: UploadCounters = {
  logChunks: 0,
  logBytes: 0,
  telemetrySnapshots: 0,
  telemetryEvents: 0,
  telemetryBytes: 0,
  lastTelemetryUploadAt: null,
  lastLogUploadAt: null,
  dropped: 0,
};
const listeners = new Set<(e: DebugEvent) => void>();

export function pushDebugEvent(e: Omit<DebugEvent, 'id' | 'at'> & { id?: string; at?: string }): DebugEvent {
  const ev: DebugEvent = { ...e, id: e.id ?? `dbg-${Date.now()}-${++seq}`, at: e.at ?? new Date().toISOString() };
  events.unshift(ev);
  if (events.length > MAX_EVENTS) events.length = MAX_EVENTS;
  for (const l of listeners) {
    try {
      l(ev);
    } catch {
      /* listener errors never break the producer */
    }
  }
  return ev;
}

/** Mark an already-pushed event as shared/not shared (e.g. after the upload batch went out). */
export function markDebugEventShared(id: string, shared: boolean): void {
  const ev = events.find((e) => e.id === id);
  if (ev) ev.shared = shared;
}

export function getDebugEvents(limit = MAX_EVENTS): DebugEvent[] {
  return events.slice(0, limit);
}

export function onDebugEvent(listener: (e: DebugEvent) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function countLogUpload(bytes: number): void {
  counters.logChunks++;
  counters.logBytes += bytes;
  counters.lastLogUploadAt = new Date().toISOString();
}

export function countTelemetryUpload(kind: 'snapshot' | 'events', bytes: number, eventCount = 0): void {
  if (kind === 'snapshot') counters.telemetrySnapshots++;
  counters.telemetryEvents += eventCount;
  counters.telemetryBytes += bytes;
  counters.lastTelemetryUploadAt = new Date().toISOString();
}

export function countDropped(n = 1): void {
  counters.dropped += n;
}

export function getUploadCounters(): UploadCounters {
  return { ...counters };
}
