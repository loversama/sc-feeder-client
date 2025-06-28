import { IpcRendererEvent } from 'electron';
import { KillEvent } from '../shared/types';

// Re-define a more specific Profile type for the API, matching loggedInUser structure
interface UserProfile {
  userId: string;
  username: string;
  rsiHandle: string | null;
  rsiMoniker: string | null;
  avatar: string | null;
}

interface AuthData {
  accessToken: string | null;
  refreshToken: string | null;
  user: UserProfile | null;
}

// Define the structure of the API exposed by preload.ts
export interface LogMonitorApi {
  // Profile
  getProfile: () => Promise<UserProfile | null>; // Updated to return UserProfile or null

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
  getLastLoggedInUser: () => Promise<string>; // This might be just username, consider if UserProfile is better
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
  openWebContentWindow: (section: 'profile' | 'leaderboard' | 'stats' | 'map' | '/') => Promise<void>; // Expanded
  closeSettingsWindow: () => Promise<boolean>;
  closeWebContentWindow: () => Promise<boolean>;
  // Window controls are now handled by custom-electron-titlebar

  // Window Status
  getSettingsWindowStatus: () => Promise<{ isOpen: boolean }>;
  getWebContentWindowStatus: () => Promise<{ isOpen: boolean, activeSection: 'profile' | 'leaderboard' | 'map' | 'stats' | '/' | null }>; // Expanded

  // Debug Actions
  resetSessions: () => Promise<boolean>;
  resetEvents: () => Promise<boolean>;
  rescanLog: () => Promise<boolean>;

  // Auth Actions
  authLogin: (identifier: string, password: string) => Promise<{ success: boolean; error?: string }>;
  authLogout: () => Promise<boolean>;
  authGetStatus: () => Promise<{ isAuthenticated: boolean; username: string | null; userId: string | null }>;
  authGetAccessToken: () => Promise<string | null>; // May deprecate in favor of authGetTokens
  authGetTokens: () => Promise<{ accessToken: string | null; refreshToken: string | null; user: UserProfile | null }>; // New
  authStoreTokens: (tokens: { accessToken: string; refreshToken: string; user?: UserProfile }) => Promise<{ success: boolean; error?: string }>; // New
  authRefreshToken: () => Promise<UserProfile | null>; // Renamed from ipc-handler's 'auth:refreshToken'
  
  // Authentication Actions for Login Popup
  authLoginSuccess: () => Promise<void>;
  authContinueAsGuest: () => Promise<void>;
  authCloseLoginWindow: () => Promise<void>;

  // Resource Path
  getResourcePath: () => Promise<string>;
  getPreloadPath: (scriptName: string) => Promise<string>;
  getAppVersion: () => Promise<string>;
  getGuestModeStatus: () => Promise<boolean>;

  // Listeners (Main to Renderer)
  onLogUpdate: (callback: (event: IpcRendererEvent, content: string) => void) => () => void;
  onLogReset: (callback: (event: IpcRendererEvent) => void) => () => void;
  onLogStatus: (callback: (event: IpcRendererEvent, status: string) => void) => () => void;
  onLogPathUpdated: (callback: (event: IpcRendererEvent, newPath: string) => void) => () => void;
  onKillFeedEvent: (callback: (event: IpcRendererEvent, data: { event: KillEvent, source: 'player' | 'global' } | null) => void) => () => void;
  onAuthStatusChanged: (callback: (event: IpcRendererEvent, status: { isAuthenticated: boolean; username: string | null; userId: string | null }) => void) => () => void;
  // For webview, it will listen to 'auth-tokens-updated' directly via window.ipcRenderer.on
  onConnectionStatusChanged: (callback: (event: IpcRendererEvent, status: 'disconnected' | 'connecting' | 'connected' | 'error') => void) => () => void;
  onGameModeUpdate: (callback: (event: IpcRendererEvent, mode: 'PU' | 'AC' | 'Unknown') => void) => () => void;
  onSettingsWindowStatus: (callback: (event: IpcRendererEvent, status: { isOpen: boolean }) => void) => () => void;
  onWebContentWindowStatus: (callback: (event: IpcRendererEvent, status: { isOpen: boolean, activeSection: 'profile' | 'leaderboard' | 'map' | 'stats' | '/' | null }) => void) => () => void; // Expanded
  onMainAuthUpdate: (callback: (event: IpcRendererEvent, authData: AuthData) => void) => () => void; // Added

  // Update Events
  checkForUpdate: () => void;
  downloadUpdate: () => void;
  installUpdate: () => void;
  onUpdateChecking: (callback: (event: IpcRendererEvent) => void) => () => void;
  onUpdateAvailable: (callback: (event: IpcRendererEvent, info: { version: string; releaseDate?: string; releaseNotes?: string }) => void) => () => void;
  onUpdateNotAvailable: (callback: (event: IpcRendererEvent) => void) => () => void;
  onUpdateDownloadProgress: (callback: (event: IpcRendererEvent, progress: number, speed: number, transferred: number, total: number) => void) => () => void;
  onUpdateDownloaded: (callback: (event: IpcRendererEvent, info: { version: string; releaseDate?: string; releaseNotes?: string }) => void) => () => void;
  onUpdateError: (callback: (event: IpcRendererEvent, error: string) => void) => () => void;

  // Debug Update Simulation
  debugSimulateUpdateAvailable: () => void;
  debugSimulateUpdateDownload: () => void;
  debugSimulateUpdateError: () => void;
  debugSimulateUpdateChecking: () => void;
  debugResetUpdateSimulation: () => void;

  // Cleanup
  removeAllListeners: () => void;
}

declare global {
  interface Window {
    ipcRenderer: { // Standard Electron IpcRenderer type
      on: (channel: string, listener: (event: IpcRendererEvent, ...args: any[]) => void) => Electron.IpcRenderer;
      off: (channel: string, listener: (...args: any[]) => void) => Electron.IpcRenderer;
      send: (channel: string, ...args: any[]) => void;
      invoke: <T>(channel: string, ...args: any[]) => Promise<T>;
      removeListener: (channel: string, listener: (...args: any[]) => void) => Electron.IpcRenderer;
      removeAllListeners: (channel: string) => Electron.IpcRenderer;
      sendToHost: (channel: string, ...args: any[]) => void; // For webview preload
    };
    logMonitorApi: LogMonitorApi;
    // For webview preload to communicate back to Electron host (WebContentPage.vue)
    electronAuthBridge: { // Changed to required as it's always exposed
      getStoredAuthData: () => Promise<AuthData>; // Added
      notifyElectronOfNewTokens: (tokens: { accessToken: string; refreshToken: string; user?: UserProfile }) => void; // Updated user to optional
      onTokensUpdated: (callback: (event: IpcRendererEvent, tokens: AuthData) => void) => () => void; // Added
    }
  }
}