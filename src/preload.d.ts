import { IpcRendererEvent } from 'electron';
import { KillEvent } from '../shared/types';

interface Profile {
  username: string
  rsiHandle: string
  rsiMoniker: string | null
  avatar: string
}

// Define the structure of the API exposed by preload.ts
export interface LogMonitorApi {
  // Profile
  getProfile: () => Promise<Profile>;

  // Log Path
  getLogPath: () => Promise<string>;
  setLogPath: (newPath: string) => void;
  selectLogDirectory: () => Promise<string | null>;

  // Sessions
  getSessions: (limit?: number) => Promise<any[]>;

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
  getApiSettings: () => Promise<{ offlineMode: boolean }>;
  setApiSettings: (settings: { offlineMode: boolean }) => Promise<boolean>;
  getCsvLogPath: () => Promise<string>;
  setCsvLogPath: (newPath: string) => Promise<boolean>;

  // Launch on Startup
  getLaunchOnStartup: () => Promise<boolean>;
  setLaunchOnStartup: (value: boolean) => Promise<boolean>;

  // Window Actions
  openSettingsWindow: () => Promise<void>;
  openWebContentWindow: (section: 'profile' | 'leaderboard') => Promise<void>;
  closeSettingsWindow: () => Promise<boolean>;
  closeWebContentWindow: () => Promise<boolean>;
  windowMinimize: () => void;
  windowToggleMaximize: () => void;
  windowClose: () => void;

  // Window Status (Synchronous Getters)
  getSettingsWindowStatus: () => Promise<{ isOpen: boolean }>;
  getWebContentWindowStatus: () => Promise<{ isOpen: boolean, activeSection: 'profile' | 'leaderboard' | null }>;

  // Debug Actions
  resetSessions: () => Promise<boolean>;
  resetEvents: () => Promise<boolean>;
  rescanLog: () => Promise<boolean>;

  // Auth Actions
  authLogin: (identifier: string, password: string) => Promise<{ success: boolean; error?: string }>;
  authLogout: () => Promise<boolean>;
  authGetStatus: () => Promise<{ isAuthenticated: boolean; username: string | null; userId: string | null }>;
  authGetAccessToken: () => Promise<string | null>;

  // Resource Path
  getResourcePath: () => Promise<string>;

  // Listeners (Main to Renderer)
  onLogUpdate: (callback: (event: IpcRendererEvent, content: string) => void) => () => void;
  onLogReset: (callback: (event: IpcRendererEvent) => void) => () => void;
  onLogStatus: (callback: (event: IpcRendererEvent, status: string) => void) => () => void;
  onLogPathUpdated: (callback: (event: IpcRendererEvent, newPath: string) => void) => () => void;
  onKillFeedEvent: (callback: (event: IpcRendererEvent, data: { event: KillEvent, source: 'player' | 'global' } | null) => void) => () => void;
  onAuthStatusChanged: (callback: (event: IpcRendererEvent, status: { isAuthenticated: boolean; username: string | null; userId: string | null }) => void) => () => void;
  onConnectionStatusChanged: (callback: (event: IpcRendererEvent, status: 'disconnected' | 'connecting' | 'connected' | 'error') => void) => () => void;
  onGameModeUpdate: (callback: (event: IpcRendererEvent, mode: 'PU' | 'AC' | 'Unknown') => void) => () => void;
  onSettingsWindowStatus: (callback: (event: IpcRendererEvent, status: { isOpen: boolean }) => void) => () => void;
  onWebContentWindowStatus: (callback: (event: IpcRendererEvent, status: { isOpen: boolean, activeSection: 'profile' | 'leaderboard' | null }) => void) => () => void;
  
  // Cleanup
  removeAllListeners: () => void;
}

declare global {
  interface Window {
    ipcRenderer: {
      on: (channel: string, listener: (event: IpcRendererEvent, ...args: any[]) => void) => void;
      off: (channel: string, listener: (...args: any[]) => void) => void;
      send: (channel: string, ...args: any[]) => void;
      invoke: (channel: string, ...args: any[]) => Promise<any>;
      removeListener: (channel: string, listener: (...args: any[]) => void) => void;
      removeAllListeners: (channel: string) => void;
    };
    logMonitorApi: LogMonitorApi;
  }
}