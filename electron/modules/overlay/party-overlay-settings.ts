/**
 * Settings of the in-game party / org overlay (pure: defaults + validation, unit-tested).
 * Stored in electron-store next to the telemetry settings (config-manager.ts).
 */
export type PartyOverlaySettings = {
  partyOverlayEnabled: boolean;
  /** Which list to show: an org (by tag) or the user's current party. */
  partyOverlaySource: 'org' | 'party';
  /** Org tag for source 'org' (empty = not chosen yet). */
  partyOverlayOrgTag: string;
  partyOverlayHotkey: string;
  /** Local override: denser rows, smaller dials. */
  partyOverlayCompact: boolean;
  /** 0.75 .. 1.5 */
  partyOverlayScale: number;
  /** Distance of the panel's top from the top of the screen, percent of screen height (0 .. 60). */
  partyOverlayOffsetY: number;
  /** Electron display id to draw on; 0 = primary display (also the fallback when that display is gone). */
  partyOverlayDisplayId: number;
  /** Hotkey that switches the overlay between Party and Org (the choice is remembered). */
  partyOverlaySwitchHotkey: string;
};

export const PARTY_OVERLAY_DEFAULTS: PartyOverlaySettings = {
  partyOverlayEnabled: false,
  partyOverlaySource: 'org',
  partyOverlayOrgTag: '',
  partyOverlayHotkey: 'CommandOrControl+Alt+P',
  partyOverlayCompact: false,
  partyOverlayScale: 1,
  partyOverlayOffsetY: 18,
  partyOverlayDisplayId: 0,
  partyOverlaySwitchHotkey: 'CommandOrControl+Alt+Shift+P',
};

export const PARTY_OVERLAY_KEYS = Object.keys(PARTY_OVERLAY_DEFAULTS) as (keyof PartyOverlaySettings)[];

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/**
 * Validate one setting. Returns the value to store, or undefined to ignore the patch entry.
 * Wrong types are ignored (never stored), numbers are clamped, tags upper-cased.
 */
export function sanitizePartyOverlaySetting<K extends keyof PartyOverlaySettings>(key: K, value: unknown): PartyOverlaySettings[K] | undefined {
  switch (key) {
    case 'partyOverlayEnabled':
    case 'partyOverlayCompact':
      return (typeof value === 'boolean' ? value : undefined) as PartyOverlaySettings[K] | undefined;
    case 'partyOverlaySource':
      return (value === 'org' || value === 'party' ? value : undefined) as PartyOverlaySettings[K] | undefined;
    case 'partyOverlayOrgTag': {
      if (typeof value !== 'string') return undefined;
      const tag = value.trim().toUpperCase();
      return (tag === '' || /^[A-Z0-9_-]{1,20}$/.test(tag) ? tag : undefined) as PartyOverlaySettings[K] | undefined;
    }
    case 'partyOverlayHotkey':
    case 'partyOverlaySwitchHotkey':
      return (typeof value === 'string' && value.length <= 64 ? value.trim() : undefined) as PartyOverlaySettings[K] | undefined;
    case 'partyOverlayScale':
      return (typeof value === 'number' && Number.isFinite(value) ? Math.round(clamp(value, 0.75, 1.5) * 100) / 100 : undefined) as PartyOverlaySettings[K] | undefined;
    case 'partyOverlayOffsetY':
      return (typeof value === 'number' && Number.isFinite(value) ? Math.round(clamp(value, 0, 60)) : undefined) as PartyOverlaySettings[K] | undefined;
    case 'partyOverlayDisplayId':
      return (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined) as PartyOverlaySettings[K] | undefined;
    default:
      return undefined;
  }
}

/** Window geometry on a display: right edge, `MARGIN` px in, top at offsetY %, height capped. */
export const PARTY_OVERLAY_BASE_WIDTH = 300;
export function partyOverlayBounds(display: { x: number; y: number; width: number; height: number }, s: Pick<PartyOverlaySettings, 'partyOverlayScale' | 'partyOverlayOffsetY'>, margin = 16) {
  const width = Math.round(PARTY_OVERLAY_BASE_WIDTH * s.partyOverlayScale);
  const top = Math.round((display.height * s.partyOverlayOffsetY) / 100);
  const height = Math.max(200, display.height - top - margin);
  return { x: display.x + display.width - width - margin, y: display.y + top, width, height };
}

/** The display to use: the configured one when it is still connected, else the primary display. */
export function pickDisplay<D extends { id: number }>(displays: D[], primary: D, displayId: number): D {
  return (displayId && displays.find((d) => d.id === displayId)) || primary;
}
