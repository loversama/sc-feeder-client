/// <reference types="vite/client" />
/// <reference path="./types/chokidar.d.ts" />

// Define the session info interface globally
interface SessionInfo {
  id: string;        // A unique ID for the session
  startTime: string; // ISO timestamp for when the session started
  endTime: string;   // ISO timestamp for when the session ended (or null if ongoing)
  logSize: number;   // Size of log in bytes when session ended
}

// Define Kill Event interface matching the one exported from main.ts
// This ensures type consistency across the main and renderer processes
interface KillEvent {
  id: string;
  timestamp: string;
  killers: string[];
  victims: string[];
  deathType: 'Soft' | 'Hard' | 'Combat' | 'Collision' | 'Crash' | 'BleedOut' | 'Suffocation' | 'Unknown'; // Added new types
  vehicleType?: string;
  vehicleModel?: string; // Added
  vehicleId?: string;
  location?: string;
  weapon?: string;
  damageType?: string;
  gameMode?: 'PU' | 'AC' | 'Unknown';
  gameVersion?: string;
  coordinates?: { x: number; y: number; z: number; };
  playerShip?: string;
  eventDescription: string;
  // Optional fields from RSI lookup for victim
  victimEnlisted?: string;
  victimRsiRecord?: string;
  victimOrg?: string;
  victimPfpUrl?: string;
  
  // Optional fields from RSI lookup for attacker
  attackerEnlisted?: string;
  attackerRsiRecord?: string;
  attackerOrg?: string;
  attackerPfpUrl?: string;
  attackerShip?: string; // Added attacker ship
  
  isPlayerInvolved: boolean;
  playerName?: string; // Added player name (passed from main)
}

// Augment the Window interface to include APIs exposed by the preload script
declare global {
  interface Window {
    // The generic ipcRenderer exposed by the template (can be removed if not used directly)
    ipcRenderer: {
      on: (channel: string, listener: (event: Electron.IpcRendererEvent, ...args: any[]) => void) => Electron.IpcRenderer;
      off: (channel: string, listener: (...args: any[]) => void) => Electron.IpcRenderer;
      send: (channel: string, ...args: any[]) => void;
      invoke: (channel: string, ...args: any[]) => Promise<any>;
    };
    // Our specific API for log monitoring
    logMonitorApi: {
      getLogPath: () => Promise<string>;
      setLogPath: (newPath: string) => void;
      selectLogDirectory: () => Promise<string | null>; // Returns the new full path or null
      getSessions: (limit?: number) => Promise<SessionInfo[]>; // Returns session history
      
      // Kill Feed API
      getKillEvents: (limit?: number) => Promise<KillEvent[]>; // Returns player kill event history
      getGlobalKillEvents: (limit?: number) => Promise<KillEvent[]>; // Returns global kill event history
      setFeedMode: (mode: 'player' | 'global') => Promise<boolean>; // Sets feed mode preference
      getFeedMode: () => Promise<'player' | 'global'>; // Gets feed mode preference
      
      // Event Details API
      openEventDetailsWindow: (eventData: KillEvent) => Promise<boolean>; // Opens details window
      getPassedEventData: () => Promise<KillEvent | null>; // Gets passed event data in the details window
      closeCurrentWindow: () => Promise<boolean>; // Close the current window (fallback for window.close())
      
      // Settings API
      getLastLoggedInUser: () => Promise<string>;
      getNotificationSettings: () => Promise<boolean>;
      setNotificationSettings: (value: boolean) => Promise<boolean>;
      getLastActivePage: () => Promise<string>;
      setLastActivePage: (page: string) => Promise<string>;
      getFetchProfileData: () => Promise<boolean>; // Get profile data fetching setting
      setFetchProfileData: (value: boolean) => Promise<boolean>; // Set profile data fetching setting
      getSoundEffects: () => Promise<boolean>; // Get sound effects setting
      setSoundEffects: (value: boolean) => Promise<boolean>; // Set sound effects setting
      
      // API/CSV Settings
      getApiSettings: () => Promise<{ apiUrl: string; apiKey: string; offlineMode: boolean }>;
      setApiSettings: (settings: { apiUrl: string; apiKey: string; offlineMode: boolean }) => Promise<boolean>;
      getCsvLogPath: () => Promise<string>;
      setCsvLogPath: (newPath: string) => Promise<boolean>;
      
      // Window Actions
      openSettingsWindow: () => Promise<void>; // Added
      
      // Debug Actions
      resetSessions: () => Promise<boolean>;
      resetEvents: () => Promise<boolean>;
      rescanLog: () => Promise<boolean>;

      // Auth Actions (Add these)
      authLogin: (identifier: string, password: string) => Promise<{ success: boolean; error?: string }>;
      authLogout: () => Promise<boolean>;
      authGetStatus: () => Promise<{ isAuthenticated: boolean; username: string | null; userId: string | null }>;

      // Listeners
      onLogUpdate: (callback: (event: Electron.IpcRendererEvent, content: string) => void) => () => void; // Returns cleanup function
      onLogReset: (callback: (event: Electron.IpcRendererEvent) => void) => () => void; // Returns cleanup function
      onLogStatus: (callback: (event: Electron.IpcRendererEvent, status: string) => void) => () => void; // Returns cleanup function
      onLogPathUpdated: (callback: (event: Electron.IpcRendererEvent, newPath: string) => void) => () => void; // Returns cleanup function
      // Correct signature to match preload.ts and main.ts event structure
      onKillFeedEvent: (callback: (event: Electron.IpcRendererEvent, data: { event: KillEvent, source: 'player' | 'global' } | null) => void) => () => void;
      removeAllListeners: () => void;
    };
  }
}

// Ensure this file is treated as a module.
export {};
