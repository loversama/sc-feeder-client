/**
 * Game.log → telemetry feed bridge.
 *
 * Some feed-worthy moments only appear in Game.log on SC 5.0 (quantum trips, ship retrieval, medical
 * bed, the "Incapacitated" HUD notification when game telemetry is off). The parser publishes them
 * here; telemetry-manager hands them to TelemetryService, which gives them the same id/shape as
 * telemetry events (`tm_<clientId>_<type>_<epochMs>`, feed/category/context/vehicle) and uploads
 * them with `submit_telemetry` (kind 'events'). Every item carries `context.source = 'game_log'`.
 *
 * Kept dependency-free so the parser (bundled in tests with stubs) can import it.
 */
import { EventEmitter } from 'node:events';
import type { TelemetryEventCategory, TelemetryEventSeverity, TelemetryVehicleRef } from './telemetry-state';

export type LogFeedItem = {
  type: string;
  /** Game time of the log line (ms since epoch). */
  at: number;
  severity: TelemetryEventSeverity;
  summary: string;
  category: TelemetryEventCategory;
  feed?: boolean;
  context?: Record<string, string | number | boolean>;
  vehicle?: TelemetryVehicleRef;
  /**
   * Fallback for a telemetry type (e.g. 'player_downed'): dropped when game telemetry reported the
   * same type within ±15 s, so a moment is never sent twice.
   */
  fallbackFor?: string;
};

export const logFeed = new EventEmitter();

export function publishLogFeedItem(item: LogFeedItem): void {
  logFeed.emit('item', item);
}
