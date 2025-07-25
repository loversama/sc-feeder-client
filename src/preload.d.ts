import { IpcRendererEvent } from 'electron';
import { KillEvent } from '../shared/types';

// Re-define a more specific Profile type for the API, matching loggedInUser structure
interface UserProfile {
  userId: string;
  username: string;
  rsiHandle: string | null;
  rsiMoniker: string | null;
  avatar: string | null;
  roles: string[];
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

  // EventStore Search and Pagination
  searchEvents: (query: string, limit?: number, offset?: number) => Promise<{ events: KillEvent[]; total: number; hasMore: boolean }>;
  loadMoreEvents: (limit?: number, offset?: number) => Promise<{ events: KillEvent[]; hasMore: boolean; totalLoaded: number }>;
  getEventStoreStats: () => Promise<{ memoryEvents: number; databaseEvents: number; playerEvents: number; sources: Record<string, number>; oldestEvent: Date | null; newestEvent: Date | null } | null>;

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
  openWebContentWindow: (section: 'profile' | 'leaderboard' | 'stats' | 'events' | 'map' | '/') => Promise<{
    success: boolean;
    architecture?: 'webcontentsview' | 'browserwindow';
    error?: string;
  }>; // Enhanced with architecture info
  closeSettingsWindow: () => Promise<boolean>;
  closeWebContentWindow: () => Promise<{
    success: boolean;
    architecture?: 'webcontentsview' | 'browserwindow' | 'unknown';
    error?: string;
  }>; // Enhanced with architecture info
  
  // External website window with authentication
  openExternalWebWindow: (url: string, options?: {
    width?: number;
    height?: number;
    title?: string;
    enableAuth?: boolean;
  }) => Promise<{ success: boolean; windowId?: number; error?: string }>;

  // Enhanced WebContentsView window operations
  openEnhancedWebContentWindow: (section?: 'profile' | 'leaderboard' | 'map' | 'events' | 'stats') => Promise<{
    success: boolean;
    architecture?: string;
    section?: string;
    error?: string;
    timestamp?: string;
  }>;
  closeEnhancedWebContentWindow: () => Promise<boolean>;
  getEnhancedWebContentStatus: () => Promise<{
    isOpen: boolean;
    activeSection: 'profile' | 'leaderboard' | 'map' | 'events' | 'stats' | null;
    architecture: string;
    authenticationEnabled: boolean;
  }>;

  // Additional methods that were missing
  openAuthenticatedWebContentWindow: (section?: 'profile' | 'leaderboard' | 'map' | 'events' | 'stats') => Promise<{
    success: boolean;
    error?: string;
  }>;
  closeAuthenticatedWebContentWindow: () => Promise<boolean>;
  invoke: (channel: string, ...args: any[]) => Promise<any>;
  navigateToSearchPage: (query: string) => Promise<{ success: boolean; error?: string }>;

  // Execute JavaScript in WebContentsView (DOM bridge)
  executeInWebContentsView: (jsCode: string) => Promise<{ success: boolean; error?: string }>;
  
  // Window controls are now handled by custom-electron-titlebar

  // Entity Resolution API
  resolveEntity: (entityId: string, serverEnriched?: any) => Promise<{
    displayName: string;
    isNpc: boolean;
    category: 'ship' | 'weapon' | 'object' | 'npc' | 'location' | 'unknown';
    matchMethod: 'exact' | 'pattern' | 'fallback';
  }>;
  resolveEntitiesBatch: (entityIds: string[]) => Promise<Array<{
    displayName: string;
    isNpc: boolean;
    category: 'ship' | 'weapon' | 'object' | 'npc' | 'location' | 'unknown';
    matchMethod: 'exact' | 'pattern' | 'fallback';
  }>>;
  isNpcEntity: (entityId: string) => Promise<boolean>;
  filterNpcs: (entityIds: string[]) => Promise<string[]>;

  // Definitions API
  getDefinitions: () => Promise<any>;
  getDefinitionsVersion: () => Promise<string | null>;
  getDefinitionsStats: () => Promise<{
    version: string | null;
    timestamp: number | null;
    lastUpdated: string | null;
    entityCounts: Record<string, number>;
    patternStats: { compiled: number; failed: number; };
    isLoaded: boolean;
  }>;
  forceRefreshDefinitions: (serverBaseUrl?: string) => Promise<boolean>;
  forceRefreshNpcList: () => Promise<boolean>;

  // Window Status
  getSettingsWindowStatus: () => Promise<{ isOpen: boolean }>;
  getWebContentWindowStatus: () => Promise<{
    isOpen: boolean;
    activeSection: 'profile' | 'leaderboard' | 'map' | 'events' | 'stats' | '/' | null;
    architecture: 'webcontentsview' | 'browserwindow' | 'unknown';
    error?: string;
  }>; // Enhanced with architecture info

  // Debug Actions
  resetSessions: () => Promise<boolean>;
  resetEvents: () => Promise<boolean>;
  rescanLog: () => Promise<boolean>;
  sendLogToMain: (message: string) => Promise<boolean>;

  // Enhanced Diagnostic Functions (added for auto-update and startup diagnostics)
  // These are accessed via invoke() method with specific channels

  // Auth Actions
  authLogin: (identifier: string, password: string) => Promise<{ success: boolean; error?: string }>;
  authLogout: () => Promise<boolean>;
  authGetStatus: () => Promise<{ isAuthenticated: boolean; username: string | null; userId: string | null }>;
  authGetAccessToken: () => Promise<string | null>; // May deprecate in favor of authGetTokens
  authGetTokens: () => Promise<{ accessToken: string | null; refreshToken: string | null; user: UserProfile | null }>; // New
  authStoreTokens: (tokens: { accessToken: string; refreshToken: string; user?: UserProfile }) => Promise<{ success: boolean; error?: string }>; // New
  authRefreshToken: () => Promise<UserProfile | null>; // Renamed from ipc-handler's 'auth:refreshToken'
  authShowLogin: () => Promise<void>;
  
  // Authentication Actions for Login Popup
  authLoginSuccess: () => Promise<void>;
  authContinueAsGuest: () => Promise<void>;
  authCloseLoginWindow: () => Promise<void>;
  authResizeLoginWindow: (newHeight: number) => Promise<boolean>;

  // --- New WebContentsView Architecture API ---
  
  // Navigate to a specific section in WebContentsView
  webContentNavigateToSection: (section: 'profile' | 'leaderboard' | 'map') => Promise<{
    success: boolean;
    section?: string;
    architecture?: 'webcontentsview' | 'browserwindow';
    error?: string;
  }>;

  // Update authentication tokens in WebContentsView
  webContentUpdateAuthTokens: (tokens: {
    accessToken?: string;
    refreshToken?: string;
    user?: UserProfile;
  } | null) => Promise<{
    success: boolean;
    error?: string;
  }>;

  // Switch between WebContentsView and BrowserWindow architecture
  webContentSetArchitecture: (useWebContentsView: boolean) => Promise<{
    success: boolean;
    architecture?: 'webcontentsview' | 'browserwindow' | 'unknown';
    useWebContentsView?: boolean;
    error?: string;
  }>;

  // Get current architecture being used
  webContentGetArchitecture: () => Promise<{
    success: boolean;
    architecture?: 'webcontentsview' | 'browserwindow' | 'unknown';
    error?: string;
  }>;

  // Resource Path
  getResourcePath: () => Promise<string>;
  getPreloadPath: (scriptName: string) => Promise<string>;
  getAppVersion: () => Promise<string>;
  getGuestModeStatus: () => Promise<boolean>;

  // Location Data API
  getCurrentLocation: () => Promise<string>;
  getLocationHistory: () => Promise<Array<{timestamp: string, location: string, source: string}>>;
  getLocationState: () => Promise<{currentLocation: string, locationHistory: Array<{timestamp: string, location: string, source: string}>, historyCount: number}>;

  // Listeners (Main to Renderer)
  onLogUpdate: (callback: (event: IpcRendererEvent, content: string) => void) => () => void;
  onLogReset: (callback: (event: IpcRendererEvent) => void) => () => void;
  onLogStatus: (callback: (event: IpcRendererEvent, status: string) => void) => () => void;
  onLogPathUpdated: (callback: (event: IpcRendererEvent, newPath: string) => void) => () => void;
  onKillFeedEvent: (callback: (event: IpcRendererEvent, data: { event: KillEvent, source: 'server' | 'local' } | null) => void) => () => void;
  onIpcMessage: (channel: string, callback: (...args: any[]) => void) => () => void;
  onAuthStatusChanged: (callback: (event: IpcRendererEvent, status: { isAuthenticated: boolean; username: string | null; userId: string | null }) => void) => () => void;
  onWebContentWindowStatus: (callback: (event: IpcRendererEvent, status: {
    isOpen: boolean;
    activeSection: 'profile' | 'leaderboard' | 'map' | 'events' | 'stats' | '/' | null;
    architecture?: 'webcontentsview' | 'browserwindow' | 'unknown';
  }) => void) => () => void;
  onWebContentWindowStatusChanged: (callback: (event: IpcRendererEvent, status: {
    isOpen: boolean;
    activeSection: 'profile' | 'leaderboard' | 'map' | 'events' | 'stats' | '/' | null;
    architecture?: 'webcontentsview' | 'browserwindow' | 'unknown';
  }) => void) => () => void;
  // For webview, it will listen to 'auth-tokens-updated' directly via window.ipcRenderer.on
  onConnectionStatusChanged: (callback: (event: IpcRendererEvent, status: 'disconnected' | 'connecting' | 'connected' | 'error') => void) => () => void;
  onGameModeUpdate: (callback: (event: IpcRendererEvent, mode: 'PU' | 'AC' | 'Unknown') => void) => () => void;
  onSettingsWindowStatus: (callback: (event: IpcRendererEvent, status: { isOpen: boolean }) => void) => () => void;
  onMainAuthUpdate: (callback: (event: IpcRendererEvent, authData: AuthData) => void) => () => void; // Added

  // Update Events
  checkForUpdate: () => void;
  downloadUpdate: () => void;
  installUpdate: () => void;
  onUpdateChecking: (callback: (event: IpcRendererEvent) => void) => () => void;
  onUpdateCheckingTimeout: (callback: (event: IpcRendererEvent) => void) => () => void;
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

  // External URL handling
  openExternal: (url: string) => Promise<void>;

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
    electron: {
      ipcRenderer: {
        on: (channel: string, listener: (event: any, ...args: any[]) => void) => void;
        send: (channel: string, ...args: any[]) => void;
        invoke: <T>(channel: string, ...args: any[]) => Promise<T>;
        removeListener: (channel: string, listener: (...args: any[]) => void) => void;
      };
    };
    logMonitorApi: LogMonitorApi;
    // For webview preload to communicate back to Electron host (WebContentPage.vue)
    electronAuthBridge: { // Changed to required as it's always exposed
      getStoredAuthData: () => Promise<AuthData>; // Added
      notifyElectronOfNewTokens: (tokens: { accessToken: string; refreshToken: string; user?: UserProfile }) => void; // Updated user to optional
      onTokensUpdated: (callback: (event: IpcRendererEvent, tokens: AuthData) => void) => () => void; // Added
    };
    electronAPI: {
      minimizeWindow: () => void;
      maximizeWindow: () => void;
      closeWindow: () => void;
      navigation: {
        request: (section: string) => Promise<{
          success: boolean;
          section?: string;
          error?: string;
          state?: any;
        }>;
        close: (section?: string) => Promise<{
          success: boolean;
          section?: string | null;
          error?: string;
          state?: any;
        }>;
        getState: () => Promise<any>;
        onStateChange: (callback: (state: any) => void) => () => void;
      };
    };
  }
}