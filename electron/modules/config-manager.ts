import Store from 'electron-store';
import path from 'node:path';
import { app } from 'electron';
import { StoreSchema, ProfileData, SessionInfo } from '../../shared/types';
import * as logger from './logger'; // Import the logger utility

const MODULE_NAME = 'ConfigManager'; // Define module name for logger

// Schema definition helps with type safety and defaults
const schema = {
  logFilePath: {
    type: 'string',
    default: 'E:\\StarCitizen\\LIVE\\Game.log' // Default path - Consider making this OS-aware or prompting user
  },
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
  profileCache: {
    type: 'object',
    default: {} as Record<string, { data: ProfileData, lastFetched: number }> // Key: username, Value: { data: ProfileData, lastFetched: number }
  },
  playSoundEffects: {
    type: 'boolean',
    default: true // Enable by default
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
  }
} as const; // Use 'as const' for stronger type inference if Store supports it well, otherwise define schema type explicitly

// Initialize the store with our schema
// Explicitly type the store instance with StoreSchema
export const store = new Store<StoreSchema>({ schema });

// --- Helper Functions ---

// Function to get the current log path from store
export function getCurrentLogPath(): string {
  return store.get('logFilePath');
}

// Function to set the log path in store
// NOTE: Updating the watcher is handled separately now (e.g., in ipc-handlers or log-watcher)
export function setLogPath(newPath: string): boolean {
  const currentPath = getCurrentLogPath();
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