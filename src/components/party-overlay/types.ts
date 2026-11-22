import type { OverlayLayout, OverlayRoster } from '../../../shared/overlay/overlay-resolve';
import type { OverlaySectionState } from '../../../shared/overlay/overlay-sections';

/** State pushed by the main process (electron/modules/overlay/party-overlay-feed.ts). */
export type PartyOverlayState = {
  /** live | connecting | signed-out | no-access | no-party | no-source | error */
  status: string;
  message?: string;
  /** One per subscribed room in display order (several in multi-org mode). */
  sections?: OverlaySectionState[];
  /** ms since Star Citizen was detected (null = not running / unknown): drives the "waiting" card. */
  gameSinceMs?: number | null;
  /** First section (older pushes / party mode). */
  source: { scope: 'org' | 'party'; id: string; label: string } | null;
  roster: OverlayRoster | null;
  layout: OverlayLayout | null;
  compact: boolean;
  /** Our opaque member id in the subscribed room ("you" marker); member ids are room-scoped. */
  selfId?: string | null;
  hotkey?: string | null;
};
