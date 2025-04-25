import { ipcRenderer, contextBridge } from 'electron'
import { Titlebar, TitlebarColor } from "custom-electron-titlebar"; // Import TitlebarColor as well
// --------- Expose some API to the Renderer process ---------
contextBridge.exposeInMainWorld('ipcRenderer', {
  on(...args: Parameters<typeof ipcRenderer.on>) {
    const [channel, listener] = args
    return ipcRenderer.on(channel, (event, ...args) => listener(event, ...args))
  },
  off(...args: Parameters<typeof ipcRenderer.off>) {
    const [channel, ...omit] = args
    return ipcRenderer.off(channel, ...omit)
  },
  send(...args: Parameters<typeof ipcRenderer.send>) {
    const [channel, ...omit] = args
    return ipcRenderer.send(channel, ...omit)
  },
  invoke(...args: Parameters<typeof ipcRenderer.invoke>) {
    const [channel, ...omit] = args
    return ipcRenderer.invoke(channel, ...omit)
  },

  // You can expose other APTs you need here.
  // ...
})

// --------- Log Monitor Specific API ---------
contextBridge.exposeInMainWorld('logMonitorApi', {
  // Renderer to Main (Invoke/Send)
  getLogPath: (): Promise<string> => ipcRenderer.invoke('get-log-path'),
  setLogPath: (newPath: string): void => ipcRenderer.send('set-log-path', newPath),
  selectLogDirectory: (): Promise<string | null> => ipcRenderer.invoke('select-log-directory'),
  getSessions: (limit?: number): Promise<any[]> => ipcRenderer.invoke('get-sessions', limit),

  // Kill Feed API
  getKillEvents: (limit?: number): Promise<any[]> => ipcRenderer.invoke('get-kill-events', limit),
  getGlobalKillEvents: (limit?: number): Promise<any[]> => ipcRenderer.invoke('get-global-kill-events', limit),
  setFeedMode: (mode: 'player' | 'global'): Promise<boolean> => ipcRenderer.invoke('set-feed-mode', mode),
  getFeedMode: (): Promise<'player' | 'global'> => ipcRenderer.invoke('get-feed-mode'),
  
  // Event Details API
  openEventDetailsWindow: (eventData: any): Promise<boolean> => {
    console.log('Preload: Calling openEventDetailsWindow with event ID:', eventData?.id);
    try {
      // Make sure we're passing a serializable object (avoiding any potential proxies/refs)
      // First stringify to remove functions and non-serializable data
      const jsonString = JSON.stringify(eventData);
      // Then parse back to a clean object
      const serializedData = JSON.parse(jsonString);
      console.log('Preload: Serialized event data successfully');
      return ipcRenderer.invoke('open-event-details-window', serializedData);
    } catch (error) {
      console.error('Preload: Error serializing event data:', error);
      // Try with minimal data if serialization fails
      const minimalData = {
        id: eventData?.id || 'unknown-id',
        timestamp: eventData?.timestamp || new Date().toISOString(),
        deathType: eventData?.deathType || 'Unknown'
      };
      console.log('Preload: Trying with minimal data:', minimalData);
      return ipcRenderer.invoke('open-event-details-window', minimalData);
    }
  },
  getPassedEventData: (): Promise<any> => {
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
  
  // API/CSV Settings - Add these back if they were removed
  // Updated: Only offlineMode is relevant now
  getApiSettings: (): Promise<{ offlineMode: boolean }> => ipcRenderer.invoke('get-api-settings'),
  setApiSettings: (settings: { offlineMode: boolean }): Promise<boolean> => ipcRenderer.invoke('set-api-settings', settings),
  getCsvLogPath: (): Promise<string> => ipcRenderer.invoke('get-csv-log-path'),
  setCsvLogPath: (newPath: string): Promise<boolean> => ipcRenderer.invoke('set-csv-log-path', newPath),
  
  // Window Actions
  openSettingsWindow: (): Promise<void> => ipcRenderer.invoke('open-settings-window'),
  openWebContentWindow: (section: 'profile' | 'leaderboard'): Promise<void> => ipcRenderer.invoke('open-web-content-window', section), // Added for Profile/Leaderboard
  closeSettingsWindow: (): Promise<boolean> => ipcRenderer.invoke('close-settings-window'), // Added for toggle-close
  closeWebContentWindow: (): Promise<boolean> => ipcRenderer.invoke('close-web-content-window'), // Added for toggle-close
  // Custom Title Bar / Window Controls
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
  authGetAccessToken: (): Promise<string | null> => ipcRenderer.invoke('auth:getAccessToken'), // Added

  // Window Status Getters (Synchronous)
  getSettingsWindowStatus: (): Promise<{ isOpen: boolean }> => ipcRenderer.invoke('get-settings-window-status'),
  getWebContentWindowStatus: (): Promise<{ isOpen: boolean, activeSection: 'profile' | 'leaderboard' | null }> => ipcRenderer.invoke('get-web-content-window-status'),

  // Resource Path
  getResourcePath: (): Promise<string> => ipcRenderer.invoke('get-resource-path'),

  // Main to Renderer (Receive)
  onLogUpdate: (callback: (event: Electron.IpcRendererEvent, content: string) => void) => {
    ipcRenderer.on('log-update', callback)
    // Return a cleanup function
    return () => ipcRenderer.removeListener('log-update', callback)
  },
  onLogReset: (callback: (event: Electron.IpcRendererEvent) => void) => {
    ipcRenderer.on('log-reset', callback)
    return () => ipcRenderer.removeListener('log-reset', callback)
  },
  onLogStatus: (callback: (event: Electron.IpcRendererEvent, status: string) => void) => {
    ipcRenderer.on('log-status', callback)
    return () => ipcRenderer.removeListener('log-status', callback)
  },
  onLogPathUpdated: (callback: (event: Electron.IpcRendererEvent, newPath: string) => void) => {
    ipcRenderer.on('log-path-updated', callback)
    return () => ipcRenderer.removeListener('log-path-updated', callback)
  },
  onKillFeedEvent: (callback: (event: Electron.IpcRendererEvent, killEvent: any) => void) => {
    ipcRenderer.on('kill-feed-event', callback)
    return () => ipcRenderer.removeListener('kill-feed-event', callback)
  },
  // Listener for auth status changes from main process
  onAuthStatusChanged: (callback: (event: Electron.IpcRendererEvent, status: { isAuthenticated: boolean; username: string | null; userId: string | null }) => void) => {
    ipcRenderer.on('auth-status-changed', callback);
    return () => ipcRenderer.removeListener('auth-status-changed', callback);
  },
  // Listener for server connection status changes
  onConnectionStatusChanged: (callback: (event: Electron.IpcRendererEvent, status: 'disconnected' | 'connecting' | 'connected' | 'error') => void) => {
    ipcRenderer.on('connection-status-changed', callback);
    return () => ipcRenderer.removeListener('connection-status-changed', callback);
  },
  // Listener for stable game mode updates
  onGameModeUpdate: (callback: (event: Electron.IpcRendererEvent, mode: 'PU' | 'AC' | 'Unknown') => void) => {
    ipcRenderer.on('game-mode-update', callback);
    return () => ipcRenderer.removeListener('game-mode-update', callback); // Return cleanup function
  },
  // Listener for Settings window status
  onSettingsWindowStatus: (callback: (event: Electron.IpcRendererEvent, status: { isOpen: boolean }) => void) => {
    ipcRenderer.on('settings-window-status', callback);
    return () => ipcRenderer.removeListener('settings-window-status', callback);
  },
  // Listener for Web Content window status
  onWebContentWindowStatus: (callback: (event: Electron.IpcRendererEvent, status: { isOpen: boolean, activeSection: 'profile' | 'leaderboard' | null }) => void) => {
    ipcRenderer.on('web-content-window-status', callback);
    return () => ipcRenderer.removeListener('web-content-window-status', callback);
  },

  // Function to remove all listeners at once (optional, but good practice for component unmount)
  removeAllListeners: () => {
    ipcRenderer.removeAllListeners('log-update')
    ipcRenderer.removeAllListeners('log-reset')
    ipcRenderer.removeAllListeners('log-status')
    ipcRenderer.removeAllListeners('log-path-updated')
    ipcRenderer.removeAllListeners('kill-feed-event')
    ipcRenderer.removeAllListeners('auth-status-changed') // Clean up new listener
    ipcRenderer.removeAllListeners('connection-status-changed') // Clean up connection status listener
    ipcRenderer.removeAllListeners('game-mode-update') // Clean up game mode listener
    ipcRenderer.removeAllListeners('settings-window-status') // Clean up settings status listener
    ipcRenderer.removeAllListeners('web-content-window-status') // Clean up web content status listener
  }
})

// --- Custom Title Bar Initialization ---
window.addEventListener('DOMContentLoaded', () => {
  // Title bar implementation
  new Titlebar({
    iconSize: 60,
    enableMnemonics: true,
    backgroundColor: TitlebarColor.TRANSPARENT,
  });
});
