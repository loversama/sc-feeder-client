import Store from 'electron-store';
import path from 'node:path';
import { app } from 'electron';
import { StoreSchema, ProfileData, SessionInfo, EventCategory, SoundPreferences } from '../../shared/types';
import * as logger from './logger'; // Import the logger utility
import { PARTY_OVERLAY_DEFAULTS, PARTY_OVERLAY_KEYS, sanitizePartyOverlaySetting, type PartyOverlaySettings } from './overlay/party-overlay-settings';

/** Built-in Game.log location, used only until the player's own install is detected or chosen. */
export const DEFAULT_LOG_FILE_PATH = 'C:\\Program Files\\Roberts Space Industries\\StarCitizen\\LIVE\\Game.log';

const MODULE_NAME = 'ConfigManager'; // Define module name for logger

// Schema definition helps with type safety and defaults
const schema = {
  logFilePath: {
    type: 'string',
    default: DEFAULT_LOG_FILE_PATH // Default path - Consider making this OS-aware or prompting user
  },
  /** Star Citizen install root (the folder holding LIVE, PTU, ...). '' = single-file mode (logFilePath only). */
  gameRoot: { type: 'string', default: '' },
  /** gameRoot was derived from logFilePath once (or the user chose single-file mode) */
  gameRootMigrated: { type: 'boolean', default: false },
  sessions: {
    type: 'array',
    default: [] as SessionInfo[] // Will store session objects
  },
  lastLoggedInUser: {
    type: 'string',
    default: ''
  },
  showNotifications: {
    type: 'boolean',
    default: true
  },
  lastActivePage: {
    type: 'string',
    default: 'kill-feed'
  },
  // apiUrl: { // Removed
  //   type: 'string',
  //   default: ''
  // },
  // apiKey: { // Removed
  //   type: 'string',
  //   default: ''
  // },
  offlineMode: {
    type: 'boolean',
    default: false
  },
  csvLogPath: {
    type: 'string',
    default: path.join(app.getPath('userData'), 'Kill-Log.csv') // Default to app data folder
  },
  fetchProfileData: {
    type: 'boolean',
    default: true // Enable by default
  },
  eventFilter: {
    type: 'string',
    default: 'all' // 'all' or 'local'
  },
  discoveredCategories: {
    type: 'object',
    default: {} as Record<string, EventCategory> // Key is category ID
  },
  selectedCategoryFilters: {
    type: 'array',
    default: [] as string[] // Array of selected category IDs
  },
  profileCache: {
    type: 'object',
    default: {} as Record<string, { data: ProfileData, lastFetched: number }> // Key: username, Value: { data: ProfileData, lastFetched: number }
  },
  playSoundEffects: {
    type: 'boolean',
    default: true // Enable by default
  },
  soundPreferences: {
    type: 'object',
    default: {
      enabled: true,
      eventSounds: {
        vehicleDestruction: {
          type: 'default',
          path: 'clean_pop',  // Clean pop sound for vehicle destruction
          volume: 0.6
        },
        crash: {
          type: 'default',
          path: 'kill-event-high',  // Intense sound for crashes
          volume: 0.7
        },
        playerKill: {
          type: 'default',
          path: 'metallic_din_1',  // Metallic ding for player kills
          volume: 0.5
        },
        npcKill: {
          type: 'default',
          path: 'metallic_din_npc',  // Best metallic ding for NPC kills
          volume: 0.4
        },
        playerDeath: {
          type: 'default',
          path: 'kill-event-high',  // Intense sound for player death
          volume: 0.8
        },
        missionComplete: {
          type: 'default',
          path: 'crispy_ping_1',
          volume: 0.5
        },
        missionAccepted: {
          type: 'default',
          path: 'crispy_ping_2',
          volume: 0.3
        },
        partyJoin: {
          type: 'default',
          path: 'arcade_pop',
          volume: 0.3
        },
        partyLeave: {
          type: 'default',
          path: 'arcade_pop',
          volume: 0.2
        }
      }
    } as SoundPreferences
  },
  feedMode: {
    type: 'string', // Storing as string, validation in getter/setter
    default: 'player'
  },
  launchOnStartup: {
    type: 'boolean',
    default: true
  },
  guestModePreference: {
    type: 'boolean',
    default: false
  },
  hasShownInitialLogin: {
    type: 'boolean',
    default: false
  },
  // --- Star Citizen game telemetry (5.0+ local gRPC API) ---
  telemetryEnabled: { type: 'boolean', default: true },
  /** Share telemetry snapshot + derived events with VOIDLOG.GG */
  telemetryShare: { type: 'boolean', default: true },
  /** Include the aUEC wallet balance in what is shared (off by default) */
  telemetryShareBalance: { type: 'boolean', default: false },
  /** In-game debug overlay (bottom-right, click-through) */
  overlayEnabled: { type: 'boolean', default: false },
  /** Show the overlay even when StarCitizen.exe isn't detected (for testing) */
  overlayAlwaysShow: { type: 'boolean', default: false },
  overlayHotkey: { type: 'string', default: 'CommandOrControl+Alt+O' },
  // --- In-game party / org overlay (right side; see electron/modules/overlay) ---
  partyOverlayEnabled: { type: 'boolean', default: PARTY_OVERLAY_DEFAULTS.partyOverlayEnabled },
  partyOverlaySource: { type: 'string', default: PARTY_OVERLAY_DEFAULTS.partyOverlaySource },
  partyOverlayOrgTag: { type: 'string', default: PARTY_OVERLAY_DEFAULTS.partyOverlayOrgTag },
  partyOverlayHotkey: { type: 'string', default: PARTY_OVERLAY_DEFAULTS.partyOverlayHotkey },
  partyOverlayCompact: { type: 'boolean', default: PARTY_OVERLAY_DEFAULTS.partyOverlayCompact },
  partyOverlayScale: { type: 'number', default: PARTY_OVERLAY_DEFAULTS.partyOverlayScale },
  partyOverlayOffsetY: { type: 'number', default: PARTY_OVERLAY_DEFAULTS.partyOverlayOffsetY },
  partyOverlayDisplayId: { type: 'number', default: PARTY_OVERLAY_DEFAULTS.partyOverlayDisplayId },
  partyOverlaySwitchHotkey: { type: 'string', default: PARTY_OVERLAY_DEFAULTS.partyOverlaySwitchHotkey },
  /** Track Game.log line signatures and diff against the previous log */
  logDiffEnabled: { type: 'boolean', default: true },
  /** Record telemetry changes to <userData>/telemetry-recordings/*.log (local only) */
  telemetryRecord: { type: 'boolean', default: true },
  // --- Game control (TriggerGameAction on the player's own game; local only) ---
  /** Off by default: the player turns it on in the Controls page. */
  gameControlEnabled: { type: 'boolean', default: false },
  gameControlFavourites: { type: 'array', default: [] as string[] },
  /** action name → accelerator */
  gameControlHotkeys: { type: 'object', default: {} as Record<string, string> },
  scannedLogBackups: {
    type: 'object',
    default: {} as Record<string, { size: number; mtime: number; scannedAt: string }>
  }
} as const; // Use 'as const' for stronger type inference if Store supports it well, otherwise define schema type explicitly

// Initialize the store with our schema
// Explicitly type the store instance with StoreSchema
export const store = new Store<StoreSchema>({ schema });

// --- Helper Functions ---

// Game.log of the active Star Citizen channel (set by the channel tracker); falls back to the stored path.
let activeLogPath: string | null = null;

export function setActiveLogPath(p: string | null): void {
  activeLogPath = p || null;
}

// Function to get the current log path: the active channel's Game.log, else the stored logFilePath
export function getCurrentLogPath(): string {
  return activeLogPath ?? store.get('logFilePath');
}

export function getStoredLogPath(): string {
  return store.get('logFilePath');
}

export function getGameRoot(): string {
  return ((store as any).get('gameRoot') as string) || '';
}

/** Set the game root ('' = single-file mode). Marks the migration as done either way. */
export function setGameRoot(root: string): void {
  (store as any).set('gameRoot', root || '');
  (store as any).set('gameRootMigrated', true);
}

export function isGameRootMigrated(): boolean {
  return !!(store as any).get('gameRootMigrated');
}

// Function to set the log path in store
// NOTE: Updating the watcher is handled separately now (e.g., in ipc-handlers or log-watcher)
export function setLogPath(newPath: string): boolean {
  const currentPath = getStoredLogPath();
  if (typeof newPath === 'string' && newPath && newPath !== currentPath) {
    logger.info(MODULE_NAME, `Setting log file path to: ${newPath}`);
    store.set('logFilePath', newPath); // Save to store
    return true; // Indicate path was changed
  } else if (newPath === currentPath) {
    logger.debug(MODULE_NAME, `Path is already set to: ${newPath}. No change needed.`);
    return false; // Indicate no change
  }
  logger.warn(MODULE_NAME, `Invalid path provided: ${newPath}`);
  return false; // Indicate failure/no change
}

// --- Launch on Startup ---
export function getLaunchOnStartup(): boolean {
  return store.get('launchOnStartup');
}
export function setLaunchOnStartup(value: boolean): void {
  store.set('launchOnStartup', !!value);
}

export function getGuestModePreference(): boolean {
  return store.get('guestModePreference');
}

export function setGuestModePreference(value: boolean): void {
  store.set('guestModePreference', !!value);
  logger.info(MODULE_NAME, `Guest Mode Preference set to: ${!!value}`);
}

export function clearGuestModePreference(): void {
  store.delete('guestModePreference');
  logger.info(MODULE_NAME, 'Guest Mode Preference cleared');
}

export function getHasShownInitialLogin(): boolean {
  return store.get('hasShownInitialLogin');
}

export function setHasShownInitialLogin(value: boolean): void {
  store.set('hasShownInitialLogin', !!value);
}

// Event Filter Preference
export function getEventFilter(): 'all' | 'local' {
  const filter = store.get('eventFilter');
  return (filter === 'local') ? 'local' : 'all'; // Ensure valid value
}

export function setEventFilter(value: 'all' | 'local'): void {
  store.set('eventFilter', value);
  logger.info(MODULE_NAME, `Event filter preference set to: ${value}`);
}

// Discovered Categories Management
export function getDiscoveredCategories(): Record<string, EventCategory> {
  return store.get('discoveredCategories') || {};
}

export function addDiscoveredCategory(category: EventCategory): void {
  const categories = getDiscoveredCategories();
  categories[category.id] = {
    ...category,
    firstSeen: category.firstSeen || new Date().toISOString(),
    lastSeen: new Date().toISOString(),
    count: (categories[category.id]?.count || 0) + 1
  };
  store.set('discoveredCategories', categories);
  logger.info(MODULE_NAME, `Added/updated discovered category: ${category.id} - ${category.name}`);
}

export function updateCategoryCount(categoryId: string): void {
  const categories = getDiscoveredCategories();
  if (categories[categoryId]) {
    categories[categoryId].count = (categories[categoryId].count || 0) + 1;
    categories[categoryId].lastSeen = new Date().toISOString();
    store.set('discoveredCategories', categories);
  }
}

export function clearDiscoveredCategories(): void {
  store.set('discoveredCategories', {});
  logger.info(MODULE_NAME, 'Cleared all discovered categories');
}

// Selected Category Filters
export function getSelectedCategoryFilters(): string[] {
  return store.get('selectedCategoryFilters') || [];
}

export function setSelectedCategoryFilters(categoryIds: string[]): void {
  store.set('selectedCategoryFilters', categoryIds);
  logger.info(MODULE_NAME, `Selected category filters updated: ${categoryIds.join(', ')}`);
}

export function toggleCategoryFilter(categoryId: string): void {
  const filters = getSelectedCategoryFilters();
  const index = filters.indexOf(categoryId);
  
  if (index === -1) {
    filters.push(categoryId);
  } else {
    filters.splice(index, 1);
  }
  
  setSelectedCategoryFilters(filters);
}

// Getters and Setters for other settings (Example)

export function getShowNotifications(): boolean {
    return store.get('showNotifications');
}

export function setShowNotifications(value: boolean): void {
    store.set('showNotifications', value);
}

// Removed getApiUrl
// Removed getApiKey

export function getOfflineMode(): boolean {
    return store.get('offlineMode');
}

// Renamed and simplified to only handle offlineMode
export function setOfflineMode(offlineMode: boolean): void {
    store.set('offlineMode', !!offlineMode); // Ensure boolean
    logger.info(MODULE_NAME, `Offline Mode Updated: ${!!offlineMode}`);
}


export function getCsvLogPath(): string {
    return store.get('csvLogPath');
}

export function setCsvLogPath(newPath: string): boolean {
    if (typeof newPath === 'string') {
        store.set('csvLogPath', newPath);
        logger.info(MODULE_NAME, 'CSV Log Path Updated:', newPath);
        return true;
    }
    return false;
}

export function getFetchProfileData(): boolean {
    return store.get('fetchProfileData');
}

export function setFetchProfileData(value: boolean): void {
    store.set('fetchProfileData', value);
}

export function getProfileCache(): Record<string, { data: ProfileData, lastFetched: number }> {
    return store.get('profileCache');
}

export function setProfileCache(cache: Record<string, { data: ProfileData, lastFetched: number }>): void {
    store.set('profileCache', cache);
}

export function getPlaySoundEffects(): boolean {
    return store.get('playSoundEffects');
}

export function setPlaySoundEffects(value: boolean): void {
    store.set('playSoundEffects', value);
}

// Sound Preferences - New system
export function getSoundPreferences(): SoundPreferences {
    let prefs = store.get('soundPreferences');
    
    // Handle migration from old playSoundEffects boolean
    if (!prefs) {
        const oldPlaySounds = store.get('playSoundEffects');
        prefs = {
            enabled: oldPlaySounds ?? true,
            eventSounds: {
                vehicleDestruction: {
                    type: 'default',
                    path: 'clean_pop',
                    volume: 0.6
                },
                crash: {
                    type: 'default',
                    path: 'kill-event-high',
                    volume: 0.7
                },
                playerKill: {
                    type: 'default',
                    path: 'metallic_din_1',
                    volume: 0.5
                },
                npcKill: {
                    type: 'default',
                    path: 'metallic_din_npc',
                    volume: 0.4
                },
                playerDeath: {
                    type: 'default',
                    path: 'kill-event-high',
                    volume: 0.8
                },
                missionComplete: {
                    type: 'default',
                    path: 'crispy_ping_1',
                    volume: 0.5
                },
                missionAccepted: {
                    type: 'default',
                    path: 'crispy_ping_2',
                    volume: 0.3
                },
                partyJoin: {
                    type: 'default',
                    path: 'arcade_pop',
                    volume: 0.3
                },
                partyLeave: {
                    type: 'default',
                    path: 'arcade_pop',
                    volume: 0.2
                }
            }
        };
        store.set('soundPreferences', prefs);
        logger.info(MODULE_NAME, 'Migrated sound settings from playSoundEffects to soundPreferences');
    }

    // Ensure new sound types exist for existing users who already have preferences
    if (prefs && prefs.eventSounds) {
        let updated = false;
        if (!prefs.eventSounds.missionComplete) {
            prefs.eventSounds.missionComplete = { type: 'default', path: 'crispy_ping_1', volume: 0.5 };
            updated = true;
        }
        if (!prefs.eventSounds.missionAccepted) {
            prefs.eventSounds.missionAccepted = { type: 'default', path: 'crispy_ping_2', volume: 0.3 };
            updated = true;
        }
        if (!prefs.eventSounds.partyJoin) {
            prefs.eventSounds.partyJoin = { type: 'default', path: 'arcade_pop', volume: 0.3 };
            updated = true;
        }
        if (!prefs.eventSounds.partyLeave) {
            prefs.eventSounds.partyLeave = { type: 'default', path: 'arcade_pop', volume: 0.2 };
            updated = true;
        }
        if (updated) {
            store.set('soundPreferences', prefs);
            logger.info(MODULE_NAME, 'Added missing sound preference types for new event types');
        }
    }

    return prefs;
}

export function setSoundPreferences(preferences: SoundPreferences): void {
    store.set('soundPreferences', preferences);
    logger.info(MODULE_NAME, 'Sound preferences updated');
}

export function getLastLoggedInUser(): string {
    return store.get('lastLoggedInUser');
}

export function setLastLoggedInUser(username: string): void {
    store.set('lastLoggedInUser', username);
}

export function getSessions(): SessionInfo[] {
    return store.get('sessions');
}

export function setSessions(sessions: SessionInfo[]): void {
    store.set('sessions', sessions);
}

export function getLastActivePage(): string {
    return store.get('lastActivePage');
}

export function setLastActivePage(page: string): void {
    store.set('lastActivePage', page);
}

export function getFeedMode(): 'player' | 'global' {
    const mode = store.get('feedMode');
    if (mode === 'player' || mode === 'global') {
        return mode;
    }
    return 'player'; // Default to 'player' if invalid value stored
}

export function setFeedMode(mode: 'player' | 'global'): void {
    if (mode === 'player' || mode === 'global') {
        store.set('feedMode', mode);
    } else {
        logger.warn(MODULE_NAME, `Invalid feed mode specified: ${mode}. Defaulting to 'player'.`);
        store.set('feedMode', 'player');
    }
}
// --- Telemetry / overlay settings ---
export type TelemetrySettings = {
  telemetryEnabled: boolean;
  telemetryShare: boolean;
  telemetryShareBalance: boolean;
  overlayEnabled: boolean;
  overlayAlwaysShow: boolean;
  overlayHotkey: string;
  logDiffEnabled: boolean;
  telemetryRecord: boolean;
};

const TELEMETRY_SETTING_KEYS: (keyof TelemetrySettings)[] = [
  'telemetryEnabled', 'telemetryShare', 'telemetryShareBalance', 'overlayEnabled', 'overlayAlwaysShow', 'overlayHotkey', 'logDiffEnabled', 'telemetryRecord',
];

export function getTelemetrySettings(): TelemetrySettings {
  const out: any = {};
  for (const k of TELEMETRY_SETTING_KEYS) out[k] = (store as any).get(k);
  return out as TelemetrySettings;
}

// --- Party / org overlay settings (validated by party-overlay-settings.ts) ---
export function getPartyOverlaySettings(): PartyOverlaySettings {
  const out: any = {};
  for (const k of PARTY_OVERLAY_KEYS) {
    const v = (store as any).get(k);
    out[k] = sanitizePartyOverlaySetting(k, v) ?? PARTY_OVERLAY_DEFAULTS[k];
  }
  return out as PartyOverlaySettings;
}

export function setPartyOverlaySettings(patch: Partial<PartyOverlaySettings>): PartyOverlaySettings {
  for (const k of PARTY_OVERLAY_KEYS) {
    if (!patch || patch[k] === undefined) continue;
    const v = sanitizePartyOverlaySetting(k, patch[k]);
    if (v !== undefined) (store as any).set(k, v);
  }
  return getPartyOverlaySettings();
}

export function setTelemetrySettings(patch: Partial<TelemetrySettings>): TelemetrySettings {
  for (const k of TELEMETRY_SETTING_KEYS) {
    if (patch[k] === undefined) continue;
    const v = patch[k];
    if (k === 'overlayHotkey' ? typeof v === 'string' : typeof v === 'boolean') (store as any).set(k, v);
  }
  return getTelemetrySettings();
}

// --- Game control settings ---
export type GameControlSettings = { enabled: boolean; favourites: string[]; hotkeys: Record<string, string> };

const ACTION_NAME_OK = /^[A-Za-z0-9_]{1,64}$/;
/** Stored hotkeys: action-name keys only, string accelerators of sane length, bounded count. */
function cleanHotkeys(hk: unknown): Record<string, string> {
  if (!hk || typeof hk !== 'object' || Array.isArray(hk)) return {};
  return Object.fromEntries(
    Object.entries(hk as Record<string, unknown>)
      .filter(([k, v]) => ACTION_NAME_OK.test(k) && typeof v === 'string' && v.length > 0 && v.length <= 64)
      .slice(0, 64),
  ) as Record<string, string>;
}

export function getGameControlSettings(): GameControlSettings {
  const fav = (store as any).get('gameControlFavourites');
  const hk = (store as any).get('gameControlHotkeys');
  return {
    enabled: (store as any).get('gameControlEnabled') === true,
    favourites: Array.isArray(fav) ? fav.filter((x: unknown) => typeof x === 'string' && ACTION_NAME_OK.test(x)) : [],
    hotkeys: cleanHotkeys(hk),
  };
}

export function setGameControlSettings(patch: Partial<GameControlSettings>): GameControlSettings {
  if (typeof patch.enabled === 'boolean') (store as any).set('gameControlEnabled', patch.enabled);
  if (Array.isArray(patch.favourites)) (store as any).set('gameControlFavourites', [...new Set(patch.favourites.filter((x) => typeof x === 'string' && ACTION_NAME_OK.test(x)))].slice(0, 48));
  if (patch.hotkeys && typeof patch.hotkeys === 'object') (store as any).set('gameControlHotkeys', cleanHotkeys(patch.hotkeys));
  return getGameControlSettings();
}
