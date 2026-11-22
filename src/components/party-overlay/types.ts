import type { OverlayLayout, OverlayRoster } from '../../../shared/overlay/overlay-resolve';

/** State pushed by the main process (electron/modules/overlay/party-overlay-feed.ts). */
export type PartyOverlayState = {
  /** live | connecting | signed-out | no-access | no-source | error */
  status: string;
  message?: string;
  source: { scope: 'org' | 'party'; id: string; label: string } | null;
  roster: OverlayRoster | null;
  layout: OverlayLayout | null;
  compact: boolean;
  /** Our opaque member id in the subscribed room ("you" marker); member ids are room-scoped. */
  selfId?: string | null;
  hotkey?: string | null;
};
