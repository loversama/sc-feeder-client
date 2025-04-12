import { IpcRendererEvent } from 'electron';
import { KillEvent } from '../shared/types'; // Assuming shared types are here

// Define the structure of the API exposed by preload.ts
export interface LogMonitorApi {
  // Log Path
  getLogPath: () => Promise<string>;
  setLogPath: (newPath: string) => void;
  selectLogDirectory: () => Promise<string | null>;

  // Sessions
  getSessions: (limit?: number) => Promise<any[]>; // Consider defining a Session type

  // Kill Feed
  getKillEvents: (limit?: number) => Promise<KillEvent[]>;
  getGlobalKillEvents: (limit?: number) => Promise<KillEvent[]>;
  setFeedMode: (mode: 'player' | 'global') => Promise<boolean>;
  getFeedMode: () => Promise<'player' | 'global'>;

  // Event Details
  openEventDetailsWindow: (eventData: KillEvent) => Promise<boolean>;
  getPassedEventData: () => Promise<KillEvent | null>;
  closeCurrentWindow: () => Promise<boolean>;

  // Settings
  getLastLoggedInUser: () => Promise<string>;
  getNotificationSettings: () => Promise<boolean>;
  setNotificationSettings: (value: boolean) => Promise<boolean>;
  getLastActivePage: () => Promise<string>;
  setLastActivePage: (page: string) => Promise<string>;
  getFetchProfileData: () => Promise<boolean>;
  setFetchProfileData: (value: boolean) => Promise<boolean>;
  getSoundEffects: () => Promise<boolean>;
  setSoundEffects: (value: boolean) => Promise<boolean>;
  getApiSettings: () => Promise<{ apiUrl: string; apiKey: string; offlineMode: boolean }>;
  setApiSettings: (settings: { apiUrl: string; apiKey: string; offlineMode: boolean }) => Promise<boolean>;
  getCsvLogPath: () => Promise<string>;
  setCsvLogPath: (newPath: string) => Promise<boolean>;

  // Window Actions
  openSettingsWindow: () => Promise<void>;
  windowMinimize: () => void; // Added
  windowToggleMaximize: () => void; // Added
  windowClose: () => void; // Added

  // Debug Actions
  resetSessions: () => Promise<boolean>;
  resetEvents: () => Promise<boolean>;
  rescanLog: () => Promise<boolean>;

  // Auth Actions
  authLogin: (identifier: string, password: string) => Promise<{ success: boolean; error?: string }>;
  authLogout: () => Promise<boolean>;
  authGetStatus: () => Promise<{ isAuthenticated: boolean; username: string | null; userId: string | null }>;

  // Listeners (Main to Renderer)
  onLogUpdate: (callback: (event: IpcRendererEvent, content: string) => void) => () => void;
  onLogReset: (callback: (event: IpcRendererEvent) => void) => () => void;
  onLogStatus: (callback: (event: IpcRendererEvent, status: string) => void) => () => void;
  onLogPathUpdated: (callback: (event: IpcRendererEvent, newPath: string) => void) => () => void;
  onKillFeedEvent: (callback: (event: IpcRendererEvent, data: { event: KillEvent, source: 'player' | 'global' } | null) => void) => () => void;

  // Cleanup
  removeAllListeners: () => void;
}

// Augment the global Window interface
declare global {
  interface Window {
    ipcRenderer: { // Keep existing ipcRenderer definition if needed
      on: (channel: string, listener: (event: IpcRendererEvent, ...args: any[]) => void) => void;
      off: (channel: string, listener: (...args: any[]) => void) => void;
      send: (channel: string, ...args: any[]) => void;
      invoke: (channel: string, ...args: any[]) => Promise<any>;
      removeListener: (channel: string, listener: (...args: any[]) => void) => void; // Added removeListener
      removeAllListeners: (channel: string) => void;
    };
    logMonitorApi: LogMonitorApi; // Add our custom API
  }
}