/**
 * Settings of the in-game party / org overlay (pure: defaults + validation, unit-tested).
 * Stored in electron-store next to the telemetry settings (config-manager.ts).
 */
export type PartyOverlaySettings = {
  partyOverlayEnabled: boolean;
  /** Which list to show: an org (by tag) or the user's current party. */
  partyOverlaySource: 'org' | 'party';
  /** Legacy single org tag (0.3.4/0.3.5). Only used when the server cannot list the user's orgs. */
  partyOverlayOrgTag: string;
  /**
   * Orgs the user switched OFF in the org checklist. Everything else the user is a verified member of
   * is shown, so orgs joined later appear automatically.
   */
  partyOverlayOrgsUnticked: string[];
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
  partyOverlayEnabled: true, // on by default since 0.3.7: shows by itself when Star Citizen is detected
  partyOverlaySource: 'org',
  partyOverlayOrgTag: '',
  partyOverlayOrgsUnticked: [],
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
    case 'partyOverlayOrgsUnticked': {
      if (!Array.isArray(value)) return undefined;
      const tags = [...new Set(value.filter((t): t is string => typeof t === 'string').map((t) => t.trim().toUpperCase()).filter((t) => /^[A-Z0-9_-]{1,20}$/.test(t)))].slice(0, 100);
      return tags as PartyOverlaySettings[K];
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

/**
 * 0.3.7: the overlay is on by default. Older versions stored the old default (off) for everyone, so the
 * stored value cannot tell "never touched" from "turned off". Once per install (`migrated`), users who never
 * used the switch in 0.3.7+ (`touched` unset) are switched on; the switch then sets `touched`, so turning it
 * off later sticks. Returns the store writes to make (null = nothing to do).
 */
export function partyOverlayDefaultOnMigration(stored: { migrated: unknown; touched: unknown }): { partyOverlayEnabled?: true; migrated: true } | null {
  if (stored.migrated === true) return null;
  return stored.touched === true ? { migrated: true } : { partyOverlayEnabled: true, migrated: true };
}

/** Store keys of the 0.3.7 default-on migration. */
export const OVERLAY_MIGRATED_KEY = 'partyOverlayDefaultOnMigrated';
export const OVERLAY_TOUCHED_KEY = 'partyOverlayEnabledTouched';
type Kv = { get(key: string): unknown; set(key: string, value: unknown): void };

/** Run the default-on migration against a store (electron-store in the app, a Map in tests). True = switched on. */
export function runPartyOverlayMigration(kv: Kv): boolean {
  const writes = partyOverlayDefaultOnMigration({ migrated: kv.get(OVERLAY_MIGRATED_KEY), touched: kv.get(OVERLAY_TOUCHED_KEY) });
  if (!writes) return false;
  if (writes.partyOverlayEnabled) kv.set('partyOverlayEnabled', true);
  kv.set(OVERLAY_MIGRATED_KEY, true);
  return !!writes.partyOverlayEnabled;
}

/** A settings patch from the user: remember that they used the on/off switch. */
export function markOverlaySwitchTouched(kv: Kv, patch: Partial<PartyOverlaySettings> | null | undefined): void {
  if (patch && typeof patch.partyOverlayEnabled === 'boolean') kv.set(OVERLAY_TOUCHED_KEY, true);
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
