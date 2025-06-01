import { ipcRenderer, contextBridge, IpcRendererEvent } from 'electron' // Added IpcRendererEvent
import { Titlebar, TitlebarColor } from "custom-electron-titlebar";
import type { KillEvent } from '../shared/types'; // For onKillFeedEvent - Corrected path

// Define UserProfile type matching preload.d.ts for clarity in this file
interface UserProfile {
  userId: string;
  username: string;
  rsiHandle: string | null;
  rsiMoniker: string | null;
  avatar: string | null;
}

// --------- Expose some API to the Renderer process ---------
contextBridge.exposeInMainWorld('ipcRenderer', {
  on(...args: Parameters<typeof ipcRenderer.on>) {
    const [channel, listener] = args
    ipcRenderer.on(channel, (event, ...args) => listener(event, ...args))
    return ipcRenderer; // Return ipcRenderer for chaining if needed, or void
  },
  off(...args: Parameters<typeof ipcRenderer.off>) {
    const [channel, ...omit] = args
    ipcRenderer.off(channel, ...omit)
    return ipcRenderer;
  },
  send(...args: Parameters<typeof ipcRenderer.send>) {
    const [channel, ...omit] = args
    ipcRenderer.send(channel, ...omit)
  },
  invoke<T>(...args: Parameters<typeof ipcRenderer.invoke>): Promise<T> { // Generic type for invoke
    const [channel, ...omit] = args
    return ipcRenderer.invoke(channel, ...omit)
  },
  removeListener(...args: Parameters<typeof ipcRenderer.removeListener>) {
    const [channel, listener] = args;
    ipcRenderer.removeListener(channel, listener);
    return ipcRenderer;
  },
  removeAllListeners(channel: string) {
    ipcRenderer.removeAllListeners(channel);
    return ipcRenderer;
  },
  sendToHost(channel: string, ...args: any[]) { // For webview preload
    ipcRenderer.sendToHost(channel, ...args);
  }
})

// --------- Electron Auth Bridge API ---------
contextBridge.exposeInMainWorld('electronAuthBridge', {
  getStoredAuthData: (): Promise<{ accessToken: string | null; refreshToken: string | null; user: any | null }> => {
    return ipcRenderer.invoke('auth:get-tokens');
  },
  notifyElectronOfNewTokens: (tokens: { accessToken: string; refreshToken: string; user?: any }): void => {
    ipcRenderer.send('auth:store-tokens', tokens);
  },
  onTokensUpdated: (callback: (event: IpcRendererEvent, tokens: { accessToken: string | null; refreshToken: string | null; user: any | null }) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, tokens: { accessToken: string | null; refreshToken: string | null; user: any | null }) => callback(_event, tokens);
    ipcRenderer.on('auth:tokens-updated', listener);
    return () => {
      ipcRenderer.removeListener('auth:tokens-updated', listener);
    };
  },
});

// --------- Log Monitor Specific API ---------
contextBridge.exposeInMainWorld('logMonitorApi', {
  // Renderer to Main (Invoke/Send)
  getLogPath: (): Promise<string> => ipcRenderer.invoke('get-log-path'),
  setLogPath: (newPath: string): void => ipcRenderer.send('set-log-path', newPath),
  selectLogDirectory: (): Promise<string | null> => ipcRenderer.invoke('select-log-directory'),
  getSessions: (limit?: number): Promise<any[]> => ipcRenderer.invoke('get-sessions', limit),

  // Kill Feed API
  getKillEvents: (limit?: number): Promise<KillEvent[]> => ipcRenderer.invoke('get-kill-events', limit),
  getGlobalKillEvents: (limit?: number): Promise<KillEvent[]> => ipcRenderer.invoke('get-global-kill-events', limit),
  setFeedMode: (mode: 'player' | 'global'): Promise<boolean> => ipcRenderer.invoke('set-feed-mode', mode),
  getFeedMode: (): Promise<'player' | 'global'> => ipcRenderer.invoke('get-feed-mode'),
  
  // Event Details API
  openEventDetailsWindow: (eventData: KillEvent): Promise<boolean> => {
    console.log('Preload: Calling openEventDetailsWindow with event ID:', eventData?.id);
    try {
      const jsonString = JSON.stringify(eventData);
      const serializedData = JSON.parse(jsonString);
      console.log('Preload: Serialized event data successfully');
      return ipcRenderer.invoke('open-event-details-window', serializedData);
    } catch (error) {
      console.error('Preload: Error serializing event data:', error);
      const minimalData = {
        id: eventData?.id || 'unknown-id',
        timestamp: eventData?.timestamp || new Date().toISOString(),
        deathType: eventData?.deathType || 'Unknown'
      };
      console.log('Preload: Trying with minimal data:', minimalData);
      return ipcRenderer.invoke('open-event-details-window', minimalData);
    }
  },
  getPassedEventData: (): Promise<KillEvent | null> => {
    console.log('Preload: Getting passed event data');
    return ipcRenderer.invoke('get-passed-event-data');
  },
  closeCurrentWindow: (): Promise<boolean> => {
    console.log('Preload: Requesting to close current window');
    return ipcRenderer.invoke('close-current-window');
  },
  
  // Settings API
  getLastLoggedInUser: (): Promise<string> => ipcRenderer.invoke('get-last-logged-in-user'),
  getNotificationSettings: (): Promise<boolean> => ipcRenderer.invoke('get-notification-settings'),
  setNotificationSettings: (value: boolean): Promise<boolean> => ipcRenderer.invoke('set-notification-settings', value),
  getLastActivePage: (): Promise<string> => ipcRenderer.invoke('get-last-active-page'),
  setLastActivePage: (page: string): Promise<string> => ipcRenderer.invoke('set-last-active-page', page),
  getFetchProfileData: (): Promise<boolean> => ipcRenderer.invoke('get-fetch-profile-data'),
  setFetchProfileData: (value: boolean): Promise<boolean> => ipcRenderer.invoke('set-fetch-profile-data', value),
  getSoundEffects: (): Promise<boolean> => ipcRenderer.invoke('get-sound-effects'),
  setSoundEffects: (value: boolean): Promise<boolean> => ipcRenderer.invoke('set-sound-effects', value),

  // Launch on Startup
  getLaunchOnStartup: (): Promise<boolean> => ipcRenderer.invoke('get-launch-on-startup'),
  setLaunchOnStartup: (value: boolean): Promise<boolean> => ipcRenderer.invoke('set-launch-on-startup', value),
  
  getApiSettings: (): Promise<{ offlineMode: boolean }> => ipcRenderer.invoke('get-api-settings'),
  setApiSettings: (settings: { offlineMode: boolean }): Promise<boolean> => ipcRenderer.invoke('set-api-settings', settings),
  getCsvLogPath: (): Promise<string> => ipcRenderer.invoke('get-csv-log-path'),
  setCsvLogPath: (newPath: string): Promise<boolean> => ipcRenderer.invoke('set-csv-log-path', newPath),
  
  // Window Actions
  openSettingsWindow: (): Promise<void> => ipcRenderer.invoke('open-settings-window'),
  openWebContentWindow: (section: 'profile' | 'leaderboard' | 'stats' | '/'): Promise<void> => ipcRenderer.invoke('open-web-content-window', section),
  closeSettingsWindow: (): Promise<boolean> => ipcRenderer.invoke('close-settings-window'),
  closeWebContentWindow: (): Promise<boolean> => ipcRenderer.invoke('close-web-content-window'),
  windowMinimize: (): void => ipcRenderer.send('window:minimize'),
  windowToggleMaximize: (): void => ipcRenderer.send('window:toggleMaximize'),
  windowClose: (): void => ipcRenderer.send('window:close'),

  // Debug Actions
  resetSessions: (): Promise<boolean> => ipcRenderer.invoke('reset-sessions'),
  resetEvents: (): Promise<boolean> => ipcRenderer.invoke('reset-events'),
  rescanLog: (): Promise<boolean> => ipcRenderer.invoke('rescan-log'),

  // Auth Actions
  authLogin: (identifier: string, password: string): Promise<{ success: boolean; error?: string }> => ipcRenderer.invoke('auth:login', identifier, password),
  authLogout: (): Promise<boolean> => ipcRenderer.invoke('auth:logout'),
  authGetStatus: (): Promise<{ isAuthenticated: boolean; username: string | null; userId: string | null }> => ipcRenderer.invoke('auth:getStatus'),
  authGetAccessToken: (): Promise<string | null> => ipcRenderer.invoke('auth:getAccessToken'),
  authGetTokens: (): Promise<{ accessToken: string | null; refreshToken: string | null; user: UserProfile | null }> => ipcRenderer.invoke('auth:get-tokens'),
  authStoreTokens: (tokens: { accessToken: string; refreshToken: string; user?: UserProfile }): Promise<{ success: boolean; error?: string }> => ipcRenderer.invoke('auth:store-tokens', tokens),
  authRefreshToken: (): Promise<UserProfile | null> => ipcRenderer.invoke('auth:refreshToken'),

  // Profile Action
  getProfile: (): Promise<UserProfile | null> => ipcRenderer.invoke('get-profile'),

  // Window Status Getters
  getSettingsWindowStatus: (): Promise<{ isOpen: boolean }> => ipcRenderer.invoke('get-settings-window-status'),
  getWebContentWindowStatus: (): Promise<{ isOpen: boolean, activeSection: 'profile' | 'leaderboard' | 'stats' | '/' | null }> => ipcRenderer.invoke('get-web-content-window-status'),

  // Resource Path
  getResourcePath: (): Promise<string> => ipcRenderer.invoke('get-resource-path'),
  getPreloadPath: (scriptName: string): Promise<string> => ipcRenderer.invoke('get-preload-path', scriptName),

  onMainAuthUpdate: (callback: (event: IpcRendererEvent, authData: any) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, authData: any) => callback(_event, authData);
    ipcRenderer.on('main-auth-update', listener);
    return () => { // Return a cleanup function
      ipcRenderer.removeListener('main-auth-update', listener);
    };
  },

  // Main to Renderer (Receive)
  onLogUpdate: (callback: (event: IpcRendererEvent, content: string) => void): (() => void) => {
    ipcRenderer.on('log-update', callback)
    return () => ipcRenderer.removeListener('log-update', callback)
  },
  onLogReset: (callback: (event: IpcRendererEvent) => void): (() => void) => {
    ipcRenderer.on('log-reset', callback)
    return () => ipcRenderer.removeListener('log-reset', callback)
  },
  onLogStatus: (callback: (event: IpcRendererEvent, status: string) => void): (() => void) => {
    ipcRenderer.on('log-status', callback)
    return () => ipcRenderer.removeListener('log-status', callback)
  },
  onLogPathUpdated: (callback: (event: IpcRendererEvent, newPath: string) => void): (() => void) => {
    ipcRenderer.on('log-path-updated', callback)
    return () => ipcRenderer.removeListener('log-path-updated', callback)
  },
  onKillFeedEvent: (callback: (event: IpcRendererEvent, data: { event: KillEvent, source: 'player' | 'global' } | null) => void): (() => void) => {
    ipcRenderer.on('kill-feed-event', callback)
    return () => ipcRenderer.removeListener('kill-feed-event', callback)
  },
  onAuthStatusChanged: (callback: (event: IpcRendererEvent, status: { isAuthenticated: boolean; username: string | null; userId: string | null }) => void): (() => void) => {
    ipcRenderer.on('auth-status-changed', callback);
    return () => ipcRenderer.removeListener('auth-status-changed', callback);
  },
  onConnectionStatusChanged: (callback: (event: IpcRendererEvent, status: 'disconnected' | 'connecting' | 'connected' | 'error') => void): (() => void) => {
    ipcRenderer.on('connection-status-changed', callback);
    return () => ipcRenderer.removeListener('connection-status-changed', callback);
  },
  onGameModeUpdate: (callback: (event: IpcRendererEvent, mode: 'PU' | 'AC' | 'Unknown') => void): (() => void) => {
    ipcRenderer.on('game-mode-update', callback);
    return () => ipcRenderer.removeListener('game-mode-update', callback);
  },
  onSettingsWindowStatus: (callback: (event: IpcRendererEvent, status: { isOpen: boolean }) => void): (() => void) => {
    ipcRenderer.on('settings-window-status', callback);
    return () => ipcRenderer.removeListener('settings-window-status', callback);
  },
  onWebContentWindowStatus: (callback: (event: IpcRendererEvent, status: { isOpen: boolean, activeSection: 'profile' | 'leaderboard' | 'stats' | '/' | null }) => void): (() => void) => {
    ipcRenderer.on('web-content-window-status', callback);
    return () => ipcRenderer.removeListener('web-content-window-status', callback);
  },

  removeAllListeners: () => {
    const channels = [
      'log-update', 'log-reset', 'log-status', 'log-path-updated',
      'kill-feed-event', 'auth-status-changed', 'connection-status-changed',
      'game-mode-update', 'settings-window-status', 'web-content-window-status'
    ];
    channels.forEach(channel => ipcRenderer.removeAllListeners(channel));
  }
})

// --- Custom Title Bar Initialization ---
window.addEventListener('DOMContentLoaded', () => {
  new Titlebar({
    iconSize: 60, // Consider making this smaller if it looks too large
    enableMnemonics: true,
    backgroundColor: TitlebarColor.TRANSPARENT,
    // menu: null, // Hides the default menu if you are using a custom one or none
  });
});
