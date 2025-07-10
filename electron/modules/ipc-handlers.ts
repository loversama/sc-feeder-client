import { ipcMain, dialog, BrowserWindow, app, shell } from 'electron'; // Import app and shell
import path from 'node:path';
import * as ConfigManager from './config-manager.ts'; // Added .ts
// Import window management functions
import {
    getMainWindow,
    createSettingsWindow,
    createEventDetailsWindow,
    getActiveEventDataForWindow,
    createWebContentWindow,
    createWebContentBaseWindow, // Added BaseWindow function
    closeSettingsWindow,
    closeWebContentWindow,
    closeWebContentBaseWindow, // Added BaseWindow close function
    getSettingsStatus, // Added
    getWebContentStatus, // Added
    closeLoginWindow,
    createLoginWindow, // Added
    createExternalWebWindow, // Added for external website authentication
    createAuthenticatedWebContentWindow, // Added for WebContentsView authentication
    closeAuthenticatedWebContentWindow // Added for WebContentsView cleanup
} from './window-manager.ts'; // Added close functions and status getters

// Import enhanced WebContentsView functions
import {
    createUnifiedWebContentWindow,
    createEnhancedWebContentWindow,
    closeEnhancedWebContentWindow,
    getEnhancedWebContentStatus
} from './window-manager.ts';

import { setGuestModeAndRemember } from './auth-manager';
import * as SessionManager from './session-manager.ts'; // Added .ts
import * as EventProcessor from './event-processor.ts'; // Added .ts
import * as LogWatcher from './log-watcher.ts'; // Added .ts
import * as RsiScraper from './rsi-scraper.ts'; // Added .ts
import * as CsvLogger from './csv-logger.ts'; // Added .ts
import { getCurrentUsername } from './log-parser.ts'; // Needed for event details window - Added .ts
import * as logger from './logger'; // Import the logger utility
import * as AuthManager from './auth-manager'; // Import AuthManager
import { resolveEntityName, isNpcEntity, getDefinitions, getDefinitionsVersion, getCacheStats, forceRefreshDefinitions, forceRefreshNpcList } from './definitionsService.ts'; // Import entity resolution functions
import { registerEnhancedIPCHandlers } from '../enhanced-ipc-handlers'; // Import enhanced handlers

const MODULE_NAME = 'IPCHandlers'; // Define module name for logger

export function registerIpcHandlers() {
    logger.info(MODULE_NAME, "Registering IPC handlers...");

    // --- Log Path Handlers ---
    ipcMain.handle('get-log-path', () => {
        return ConfigManager.getCurrentLogPath();
    });

    // Handles direct path setting (less common now)
    ipcMain.on('set-log-path', (event, newPath: string) => {
        logger.info(MODULE_NAME, `Received 'set-log-path' for: ${newPath}`);
        const changed = ConfigManager.setLogPath(newPath);
        if (changed) {
            // Restart watcher only if path actually changed
            LogWatcher.startWatchingLogFile().catch(err => logger.error(MODULE_NAME, "Error restarting watcher after set-log-path:", err));
            // Notify renderer
            getMainWindow()?.webContents.send('log-path-updated', newPath);
        } else {
             getMainWindow()?.webContents.send('log-status', 'Log path was not changed.');
        }
    });

    // Handles directory selection dialog
    ipcMain.handle('select-log-directory', async () => {
        logger.info(MODULE_NAME, "Received 'select-log-directory'");
        const win = getMainWindow();
        if (!win) {
            logger.error(MODULE_NAME, "Cannot show dialog, main window not available.");
            return null;
        }
        const result = await dialog.showOpenDialog(win, {
            properties: ['openDirectory']
        });

        if (!result.canceled && result.filePaths.length > 0) {
            const directoryPath = result.filePaths[0];
            const newLogFilePath = path.join(directoryPath, 'Game.log');
            logger.info(MODULE_NAME, `Directory selected: ${directoryPath}, setting log path to: ${newLogFilePath}`);
            const changed = ConfigManager.setLogPath(newLogFilePath);
            if (changed) {
                 await LogWatcher.startWatchingLogFile(); // Restart watcher
                 getMainWindow()?.webContents.send('log-path-updated', newLogFilePath); // Notify renderer
                 return newLogFilePath; // Return the path that was set
            } else {
                 getMainWindow()?.webContents.send('log-status', 'Log path was not changed.');
                 return ConfigManager.getCurrentLogPath(); // Return current path if no change
            }
        }
        logger.info(MODULE_NAME, 'Directory selection cancelled.');
        return null; // Indicate cancellation
    });

    // --- Session Data Handler ---
    ipcMain.handle('get-sessions', (event, limit: number = 100) => {
        return SessionManager.getSessionHistory(limit);
    });

    // --- Kill Event Data Handlers ---
    ipcMain.handle('get-kill-events', async (event, limit: number = 100) => {
        try {
            logger.debug(MODULE_NAME, `Getting kill events (limit: ${limit})`);
            return await EventProcessor.getKillEvents(limit);
        } catch (error) {
            logger.error(MODULE_NAME, 'Failed to get kill events:', error);
            return []; // Return empty array on error
        }
    });

    ipcMain.handle('get-global-kill-events', async (event, limit: number = 100) => {
        try {
            logger.debug(MODULE_NAME, `Getting global kill events (limit: ${limit})`);
            return await EventProcessor.getGlobalKillEvents(limit);
        } catch (error) {
            logger.error(MODULE_NAME, 'Failed to get global kill events:', error);
            return []; // Return empty array on error
        }
    });

    // --- EventStore Search and Pagination Handlers ---
    ipcMain.handle('search-events', async (event, query: string, limit: number = 25, offset: number = 0) => {
        try {
            logger.debug(MODULE_NAME, `Searching events: "${query}" (limit: ${limit}, offset: ${offset})`);
            return await EventProcessor.searchEvents(query, limit, offset);
        } catch (error) {
            logger.error(MODULE_NAME, 'Failed to search events:', error);
            return { events: [], total: 0, hasMore: false };
        }
    });

    ipcMain.handle('load-more-events', async (event, limit: number = 25, offset: number = 0) => {
        try {
            logger.debug(MODULE_NAME, `Loading more events (limit: ${limit}, offset: ${offset})`);
            return await EventProcessor.loadMoreEvents(limit, offset);
        } catch (error) {
            logger.error(MODULE_NAME, 'Failed to load more events:', error);
            return { events: [], hasMore: false, totalLoaded: 0 };
        }
    });

    ipcMain.handle('get-event-store-stats', () => {
        try {
            return EventProcessor.getEventStoreStats();
        } catch (error) {
            logger.error(MODULE_NAME, 'Failed to get event store stats:', error);
            return null;
        }
    });

    // --- Feed Mode Handlers ---
    ipcMain.handle('set-feed-mode', (event, mode: 'player' | 'global') => {
        ConfigManager.setFeedMode(mode);
        logger.info(MODULE_NAME, `Feed mode set to: ${mode}`);
        return true; // Indicate success
    });

    ipcMain.handle('get-feed-mode', () => {
        return ConfigManager.getFeedMode();
    });

    // --- User/State Handlers ---
    ipcMain.handle('get-last-logged-in-user', () => {
        // Use the getter from log-parser as it holds the active state
        return getCurrentUsername();
        // return ConfigManager.getLastLoggedInUser(); // Or get from store if parser state isn't needed
    });

    // Handler to get the currently logged-in user's profile data
    ipcMain.handle('get-profile', () => {
        logger.debug(MODULE_NAME, "Received 'get-profile' request.");
        // Use the new getter from AuthManager to get the full loggedInUser object
        const loggedInUser = AuthManager.getLoggedInUser();

        if (loggedInUser) {
            logger.debug(MODULE_NAME, `Returning profile for user: ${loggedInUser.username}`);
            logger.debug(MODULE_NAME, `Profile data being returned: ${JSON.stringify(loggedInUser)}`);
            // Return the full loggedInUser object which now includes rsiHandle, rsiMoniker, avatar
            return loggedInUser;
        } else {
            logger.debug(MODULE_NAME, "No logged-in user found. Returning null profile.");
            return null; // Return null if no user is logged in
        }
    });

    // --- Settings Handlers ---
    ipcMain.handle('get-notification-settings', () => {
        return ConfigManager.getShowNotifications();
    });
    ipcMain.handle('set-notification-settings', (event, value: boolean) => {
        ConfigManager.setShowNotifications(!!value);
        return !!value;
    });

    ipcMain.handle('get-last-active-page', () => {
        return ConfigManager.getLastActivePage();
    });
    ipcMain.handle('set-last-active-page', (event, page: string) => {
        ConfigManager.setLastActivePage(page);
        return page;
    });
    // Note: 'page-changed' listener might be redundant if set-last-active-page is used consistently
    ipcMain.on('page-changed', (event, page: string) => {
        ConfigManager.setLastActivePage(page);
    });


    ipcMain.handle('get-fetch-profile-data', () => {
        return ConfigManager.getFetchProfileData();
    });
    ipcMain.handle('set-fetch-profile-data', (event, value: boolean) => {
        ConfigManager.setFetchProfileData(!!value);
        return !!value;
    });

    ipcMain.handle('get-sound-effects', () => {
        return ConfigManager.getPlaySoundEffects();
    });
    ipcMain.handle('set-sound-effects', (event, value: boolean) => {
        ConfigManager.setPlaySoundEffects(!!value);
        return !!value;
    });

    // --- Launch on Startup Handlers ---
    ipcMain.handle('get-launch-on-startup', () => {
        return ConfigManager.getLaunchOnStartup();
    });
    ipcMain.handle('set-launch-on-startup', (event, value: boolean) => {
        const boolValue = !!value;
        ConfigManager.setLaunchOnStartup(boolValue);
        
        try {
            // Don't set up auto-launch in development mode
            if (process.env.NODE_ENV === 'development') {
                logger.debug(MODULE_NAME, 'Development mode detected, skipping OS login item setup');
                return boolValue;
            }

            // Set OS login item with platform-specific configuration
            const appFolder = path.dirname(process.execPath);
            const exeName = path.basename(process.execPath);
            
            if (process.platform === 'win32' && app.isPackaged) {
                // Windows production - use Squirrel-compatible path for auto-updater
                const stubLauncher = path.resolve(appFolder, '..', exeName);
                logger.info(MODULE_NAME, `Setting Windows startup (${boolValue}) with Squirrel path: ${stubLauncher}`);
                
                app.setLoginItemSettings({
                    openAtLogin: boolValue,
                    path: stubLauncher,
                    args: [
                        '--processStart', `"${exeName}"`,
                        '--process-start-args', '"--hidden"'
                    ]
                });
            } else {
                // macOS, Linux, or development
                logger.info(MODULE_NAME, `Setting startup (${boolValue}) with standard configuration`);
                
                app.setLoginItemSettings({
                    openAtLogin: boolValue,
                    args: ['--hidden'] // Start hidden when launched at startup
                });
            }

            // Verify the setting was applied correctly
            const verifySettings = app.getLoginItemSettings();
            logger.info(MODULE_NAME, `Startup setting updated. New state: openAtLogin=${verifySettings.openAtLogin}`);
            
        } catch (error) {
            logger.error(MODULE_NAME, 'Failed to update OS login item settings:', error);
        }
        
        return boolValue;
    });

    // API/CSV Settings
    ipcMain.handle('get-api-settings', () => {
        // Only return offlineMode now
        return {
            // apiUrl: ConfigManager.getApiUrl(), // Removed
            // apiKey: ConfigManager.getApiKey(), // Removed
            offlineMode: ConfigManager.getOfflineMode()
        };
    });
    ipcMain.handle('set-api-settings', (event, settings: { offlineMode: boolean }) => {
        // Pass only offlineMode to config manager
        ConfigManager.setOfflineMode(settings.offlineMode); // Assuming a dedicated setter exists or update setApiSettings
        return true; // Indicate success
    });

    ipcMain.handle('get-csv-log-path', () => {
        return ConfigManager.getCsvLogPath();
    });
    ipcMain.handle('set-csv-log-path', (event, newPath: string) => {
        return ConfigManager.setCsvLogPath(newPath);
    });
// --- Resource Path Handler ---
logger.debug(MODULE_NAME, "Attempting to register handler for 'get-resource-path'...");
try {
    ipcMain.handle('get-resource-path', () => { // Keep only one handler call
        const isProd = app.isPackaged;
        const vitePublic = process.env.VITE_PUBLIC; // Set in app-lifecycle onReady
        const resourcesPath = process.resourcesPath;
        const basePath = isProd ? resourcesPath : vitePublic;
        logger.debug(MODULE_NAME, `Providing resource path: ${basePath} (isProd: ${isProd})`);
        // Ensure a valid string is returned
        if (basePath && typeof basePath === 'string') {
            return basePath;
        }
        logger.error(MODULE_NAME, `Could not determine valid resource path. isProd=${isProd}, resourcesPath=${resourcesPath}, vitePublic=${vitePublic}`);
        return ''; // Return empty string if path is invalid
    }); // End of handler function
    logger.info(MODULE_NAME, "Successfully registered handler for 'get-resource-path'.");
} catch (error: any) { // Correct catch syntax
     logger.error(MODULE_NAME, `FATAL: Failed to register handler for 'get-resource-path': ${error.message}`, error.stack);
     // Decide if the app should quit or continue without this functionality
} // End of try...catch

// --- App Version Handler ---
logger.debug(MODULE_NAME, "Attempting to register handler for 'get-app-version'...");
try {
    ipcMain.handle('get-app-version', () => {
        return app.getVersion();
    });
    logger.info(MODULE_NAME, "Successfully registered handler for 'get-app-version'.");
} catch (error: any) {
     logger.error(MODULE_NAME, `FATAL: Failed to register handler for 'get-app-version': ${error.message}`, error.stack);
}

    // --- Window Management Handlers ---
    ipcMain.handle('open-settings-window', () => {
        createSettingsWindow();
    });

    ipcMain.handle('open-event-details-window', async (event, eventData) => {
        // Pass current username for context
        const username = getCurrentUsername();
        const success = createEventDetailsWindow(eventData, username);
        return !!success; // Return true if window creation was attempted
    });

    // Enhanced Handler for Web Content Window with new WebContentsView architecture
    ipcMain.handle('open-web-content-window', async (_event, initialTab?: 'profile' | 'leaderboard' | 'stats' | 'map' | '/') => {
      logger.info(MODULE_NAME, `Received 'open-web-content-window' request. Initial tab: ${initialTab || 'default'}`);
      
      // Filter to only supported sections
      let supportedSection: 'profile' | 'leaderboard' | 'map' = 'profile';
      if (initialTab === 'profile' || initialTab === 'leaderboard' || initialTab === 'map') {
        supportedSection = initialTab;
      } else if (initialTab === 'stats' || initialTab === '/') {
        // Map unsupported sections to profile as default
        logger.info(MODULE_NAME, `Mapping unsupported section '${initialTab}' to 'profile'`);
        supportedSection = 'profile';
      }
      
      try {
        // Use new unified WebContentsView system
        const result = await createUnifiedWebContentWindow(supportedSection);
        
        if (result.success) {
          // Send status update to main window
          getMainWindow()?.webContents.send('web-content-window-status', { 
            isOpen: true, 
            activeSection: supportedSection,
            architecture: result.architecture,
            timestamp: new Date().toISOString()
          });
          
          logger.info(MODULE_NAME, `Successfully created web content window with ${result.architecture} architecture for section: ${supportedSection}`);
          
          return { 
            success: true, 
            architecture: result.architecture,
            section: supportedSection,
            timestamp: new Date().toISOString()
          };
        } else {
          logger.error(MODULE_NAME, `Failed to create web content window: ${result.error || 'Unknown error'}`);
          
          return { 
            success: false, 
            architecture: result.architecture,
            error: result.error || 'Failed to create window',
            timestamp: new Date().toISOString()
          };
        }
      } catch (error) {
        logger.error(MODULE_NAME, 'Unexpected error in open-web-content-window:', error);
        
        return { 
          success: false, 
          architecture: 'error',
          error: error instanceof Error ? error.message : 'Unknown error',
          timestamp: new Date().toISOString()
        };
      }
    });

    ipcMain.handle('get-passed-event-data', () => {
        return getActiveEventDataForWindow();
    });

    // NEW: Handler for Authenticated WebContentsView Web Content Window
    ipcMain.handle('open-authenticated-web-content-window', async (_event, initialTab?: 'profile' | 'leaderboard' | 'map') => {
        logger.info(MODULE_NAME, `Received 'open-authenticated-web-content-window' request. Initial tab: ${initialTab || 'default'}`);
        
        try {
            // Use the new authenticated WebContentsView architecture
            const authWindow = createAuthenticatedWebContentWindow(initialTab);
            
            if (authWindow) {
                logger.info(MODULE_NAME, `Successfully created authenticated WebContentsView window for section: ${initialTab}`);
                
                // Focus the window if it's minimized
                if (authWindow.isMinimized()) {
                    authWindow.restore();
                }
                authWindow.focus();
                
                return { 
                    success: true, 
                    architecture: 'webcontents-view-authenticated',
                    section: initialTab
                };
            } else {
                logger.error(MODULE_NAME, 'Failed to create authenticated WebContentsView window');
                return { 
                    success: false, 
                    error: 'Failed to create authenticated WebContentsView window',
                    architecture: 'webcontents-view-authenticated'
                };
            }
        } catch (error) {
            logger.error(MODULE_NAME, 'Error creating authenticated WebContentsView window:', error);
            return { 
                success: false, 
                error: error instanceof Error ? error.message : 'Unknown error',
                architecture: 'webcontents-view-authenticated'
            };
        }
    });

    ipcMain.handle('close-current-window', (event) => {
        const senderWindow = BrowserWindow.fromWebContents(event.sender); // Use imported BrowserWindow
        if (senderWindow) {
            senderWindow.close();
            return true;
        }
        return false;
    });

    // NEW: Handlers for closing specific windows
    ipcMain.handle('close-settings-window', () => {
        logger.info(MODULE_NAME, "Received 'close-settings-window' request.");
        closeSettingsWindow(); // Call the function from window-manager
        return true; // Indicate the call was made
    });

    ipcMain.handle('close-web-content-window', () => {
        logger.info(MODULE_NAME, "Received 'close-web-content-window' request.");
        
        try {
          // Try BaseWindow first, then fallback to legacy BrowserWindow
          closeWebContentBaseWindow();
          closeWebContentWindow(); // Also close legacy window if it exists
          return { success: true, architecture: 'basewindow' };
        } catch (error) {
          logger.error(MODULE_NAME, 'Error closing web content window:', error);
          return { success: false, error: 'Failed to close window' };
        }
    });

    // NEW: Handler for closing Authenticated WebContentsView Web Content Window
    ipcMain.handle('close-authenticated-web-content-window', () => {
        logger.info(MODULE_NAME, "Received 'close-authenticated-web-content-window' request.");
        
        try {
            closeAuthenticatedWebContentWindow();
            return { 
                success: true, 
                architecture: 'webcontents-view-authenticated' 
            };
        } catch (error) {
            logger.error(MODULE_NAME, 'Error closing authenticated web content window:', error);
            return { 
                success: false, 
                error: error instanceof Error ? error.message : 'Failed to close authenticated window',
                architecture: 'webcontents-view-authenticated'
            };
        }
    });

    // NEW: Handlers for getting window status synchronously
    ipcMain.handle('get-settings-window-status', () => {
        logger.info(MODULE_NAME, "Received 'get-settings-window-status' request.");
        return getSettingsStatus(); // Call the function from window-manager
    });

    ipcMain.handle('get-web-content-window-status', () => {
        logger.info(MODULE_NAME, "Received 'get-web-content-window-status' request.");
        
        try {
          // Return the status from window-manager which handles both BaseWindow and BrowserWindow
          const status = getWebContentStatus();
          logger.debug(MODULE_NAME, 'Returning web content status:', status);
          return { ...status, architecture: 'basewindow' };
        } catch (error) {
          logger.error(MODULE_NAME, 'Error getting web content window status:', error);
          return {
            isOpen: false,
            activeSection: null,
            architecture: 'unknown' as const,
            error: 'Failed to get status'
          };
        }
    });

    // BaseWindow specific handlers for window controls
    ipcMain.handle('web-content-section-change', (_event, section: 'profile' | 'leaderboard' | 'map') => {
        logger.info(MODULE_NAME, `Received 'web-content-section-change' request for section: ${section}`);
        try {
            // Import the webContentView and other needed variables from window-manager
            const windowManagerModule = require('./window-manager');
            const webContentView = windowManagerModule.webContentView;
            
            if (webContentView && !webContentView.webContents.isDestroyed()) {
                const isDevelopment = process.env.NODE_ENV === 'development';
                const webAppBaseUrl = isDevelopment
                    ? 'http://localhost:3001'
                    : 'https://killfeed.sinfulshadows.com';
                
                let url = '';
                if (section === 'profile') {
                    url = `${webAppBaseUrl}/profile?source=electron`;
                } else if (section === 'leaderboard') {
                    url = `${webAppBaseUrl}/leaderboard?source=electron`;
                } else if (section === 'map') {
                    url = `${webAppBaseUrl}/map?source=electron`;
                }
                
                if (url) {
                    webContentView.webContents.loadURL(url);
                    logger.info(MODULE_NAME, `Navigated web content to section: ${section}, URL: ${url}`);
                }
            }
            return { success: true };
        } catch (error) {
            logger.error(MODULE_NAME, 'Failed to change web content section:', error);
            return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
        }
    });

    ipcMain.handle('web-content-window-minimize', () => {
        logger.info(MODULE_NAME, "Received 'web-content-window-minimize' request.");
        try {
            const windowManagerModule = require('./window-manager');
            const webContentBaseWindow = windowManagerModule.webContentBaseWindow;
            
            if (webContentBaseWindow && !webContentBaseWindow.isDestroyed()) {
                webContentBaseWindow.minimize();
                return { success: true };
            }
            return { success: false, error: 'BaseWindow not available' };
        } catch (error) {
            logger.error(MODULE_NAME, 'Failed to minimize web content window:', error);
            return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
        }
    });

    ipcMain.handle('web-content-window-maximize', () => {
        logger.info(MODULE_NAME, "Received 'web-content-window-maximize' request.");
        try {
            const windowManagerModule = require('./window-manager');
            const webContentBaseWindow = windowManagerModule.webContentBaseWindow;
            
            if (webContentBaseWindow && !webContentBaseWindow.isDestroyed()) {
                if (webContentBaseWindow.isMaximized()) {
                    webContentBaseWindow.unmaximize();
                } else {
                    webContentBaseWindow.maximize();
                }
                return { success: true };
            }
            return { success: false, error: 'BaseWindow not available' };
        } catch (error) {
            logger.error(MODULE_NAME, 'Failed to maximize/unmaximize web content window:', error);
            return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
        }
    });

    ipcMain.handle('web-content-window-close', () => {
        logger.info(MODULE_NAME, "Received 'web-content-window-close' request.");
        try {
            closeWebContentBaseWindow();
            return { success: true };
        } catch (error) {
            logger.error(MODULE_NAME, 'Failed to close web content window:', error);
            return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
        }
    });

    // External web window handler with authentication
    ipcMain.handle('open-external-web-window', async (_event, url: string, options?: { 
        width?: number, 
        height?: number, 
        title?: string,
        enableAuth?: boolean 
    }) => {
        logger.info(MODULE_NAME, `Received 'open-external-web-window' request for URL: ${url}`);
        try {
            const window = await createExternalWebWindow(url, options);
            return { success: !!window, windowId: window?.id };
        } catch (error) {
            logger.error(MODULE_NAME, 'Failed to create external web window:', error);
            return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
        }
    });

    // Login popup handlers
    ipcMain.handle('auth:continueAsGuest', async () => {
      try {
        await setGuestModeAndRemember();
        ipcMain.emit('guest-mode-selected');
        return { success: true };
      } catch (error) {
        logger.error(MODULE_NAME, 'Error setting guest mode:', error);
        return { success: false, error: 'Failed to set guest mode' };
      }
    });

    ipcMain.handle('auth:loginSuccess', async () => {
      try {
        logger.info(MODULE_NAME, 'Login successful - emitting login-completed event');
        ipcMain.emit('login-completed');
        return { success: true };
      } catch (error) {
        logger.error(MODULE_NAME, 'Error handling login success:', error);
        return { success: false, error: 'Failed to handle login success' };
      }
    });

    ipcMain.handle('auth:closeLoginWindow', () => {
      closeLoginWindow();
      return { success: true };
    });

ipcMain.handle('auth:show-login', () => {
  logger.info(MODULE_NAME, "Received 'auth:show-login' request. Opening login window.");
  createLoginWindow();
  return { success: true };
});

    ipcMain.on('auth:reset-guest-mode', async () => {
      logger.info(MODULE_NAME, "Received 'auth:reset-guest-mode' request. Resetting guest mode and restarting app.");
      // 1. Set guestMode preference to false
      ConfigManager.setGuestModePreference(false); // Use the existing function

      // 2. Restart the application
      // This will close all windows and trigger the app's 'ready' event again,
      // which should then re-evaluate the login state and show the login window.
      app.relaunch({ args: process.argv.slice(1).concat(['--relaunch']) });
      app.exit();
    });

    // Get guest mode status
    ipcMain.handle('app:get-guest-mode-status', () => {
      logger.info(MODULE_NAME, "Received 'app:get-guest-mode-status' request.");
      return ConfigManager.getGuestModePreference();
    });

    // Open URL in default browser
    ipcMain.handle('open-external', async (_event, url: string) => {
      logger.info(MODULE_NAME, `Received 'open-external' request for URL: ${url}`);
      try {
        await shell.openExternal(url);
        logger.info(MODULE_NAME, `Successfully opened external URL: ${url}`);
      } catch (error) {
        logger.error(MODULE_NAME, `Failed to open external URL: ${url}`, error);
        throw error;
      }
    });

    // --- New WebContentsView Architecture Handlers ---
    
    // Navigate to a specific section in the WebContentsView
    ipcMain.handle('web-content:navigate-to-section', async (_event, section: 'profile' | 'leaderboard' | 'map') => {
      logger.info(MODULE_NAME, `Received 'web-content:navigate-to-section' request for: ${section}`);
      
      try {
        // Note: navigateToSection functionality would be handled by the web content itself
        
        // Send status update to main window
        const status = getWebContentStatus();
        getMainWindow()?.webContents.send('web-content-window-status', status);
        
        return { success: true, section, architecture: 'browserwindow' };
      } catch (error) {
        logger.error(MODULE_NAME, `Failed to navigate to section ${section}:`, error);
        return { success: false, error: error instanceof Error ? error.message : 'Navigation failed' };
      }
    });

    // Update authentication tokens in WebContentsView
    ipcMain.handle('web-content:update-auth-tokens', (_event, tokens: any) => {
      logger.info(MODULE_NAME, "Received 'web-content:update-auth-tokens' request.");
      
      try {
        // Note: updateAuthTokens functionality handled by sendAuthTokensToWebContentWindow
        // await sendAuthTokensToWebContentWindow(tokens); // Not implemented yet
        return { success: true };
      } catch (error) {
        logger.error(MODULE_NAME, 'Failed to update auth tokens:', error);
        return { success: false, error: error instanceof Error ? error.message : 'Failed to update tokens' };
      }
    });

    // Switch between WebContentsView and BrowserWindow architecture
    ipcMain.handle('web-content:set-architecture', (_event, useWebContentsView: boolean) => {
      logger.info(MODULE_NAME, `Received 'web-content:set-architecture' request. Use WebContentsView: ${useWebContentsView}`);
      
      try {
        // Note: Architecture switching not implemented yet
        const currentArch = 'browserwindow';
        
        return { 
          success: true, 
          architecture: currentArch,
          useWebContentsView: useWebContentsView
        };
      } catch (error) {
        logger.error(MODULE_NAME, 'Failed to set architecture:', error);
        return { success: false, error: error instanceof Error ? error.message : 'Failed to set architecture' };
      }
    });

    // Get current architecture being used
    ipcMain.handle('web-content:get-architecture', () => {
      logger.info(MODULE_NAME, "Received 'web-content:get-architecture' request.");
      
      try {
        const architecture = 'browserwindow';
        return { success: true, architecture };
      } catch (error) {
        logger.error(MODULE_NAME, 'Failed to get architecture:', error);
        return { success: false, error: error instanceof Error ? error.message : 'Failed to get architecture' };
      }
    });

    // Get diagnostic information for debugging
    ipcMain.handle('web-content:get-diagnostic-info', () => {
      logger.info(MODULE_NAME, "Received 'web-content:get-diagnostic-info' request.");
      
      try {
        const diagnosticInfo = { message: 'Diagnostic info not implemented' };
        return { success: true, diagnosticInfo };
      } catch (error) {
        logger.error(MODULE_NAME, 'Failed to get diagnostic info:', error);
        return { success: false, error: error instanceof Error ? error.message : 'Failed to get diagnostic info' };
      }
    });

    // Reset error state
    ipcMain.handle('web-content:reset-error-state', () => {
      logger.info(MODULE_NAME, "Received 'web-content:reset-error-state' request.");
      
      try {
        // Note: Error state reset not implemented
        return { success: true };
      } catch (error) {
        logger.error(MODULE_NAME, 'Failed to reset error state:', error);
        return { success: false, error: error instanceof Error ? error.message : 'Failed to reset error state' };
      }
    });

    // Force a specific architecture (for testing/debugging)
    ipcMain.handle('web-content:force-architecture', (_event, architecture: 'webcontentsview' | 'browserwindow') => {
      logger.info(MODULE_NAME, `Received 'web-content:force-architecture' request for: ${architecture}`);
      
      try {
        const result = { architecture: 'browserwindow' };
        return { success: true, ...result };
      } catch (error) {
        logger.error(MODULE_NAME, 'Failed to force architecture:', error);
        return { success: false, error: error instanceof Error ? error.message : 'Failed to force architecture' };
      }
    });

    // Window controls are now handled by custom-electron-titlebar

    // --- Debug Action Handlers ---
    ipcMain.handle('reset-sessions', () => {
        SessionManager.clearSessionHistory();
        return true;
    });

    // Debug logging bridge from renderer to main process
    ipcMain.handle('send-log-to-main', (event, message: string) => {
        // Log to main process console for debugging scroll detection
        console.log(message);
        // Also log through our logger system
        logger.debug('RENDERER-DEBUG', message);
        return true;
    });

    ipcMain.handle('app:get-version', () => {
        logger.info(MODULE_NAME, "Received 'app:get-version' request.");
        return app.getVersion();
    });

    ipcMain.handle('reset-events', () => {
        EventProcessor.clearEvents(); // Clears in-memory and notifies renderer
        return true;
    });

    ipcMain.handle('rescan-log', async () => {
        // This now calls the rescan function in log-watcher, which handles state reset and parsing
        try {
             await LogWatcher.rescanLogFile();
             return true;
        } catch (error: any) {
             logger.error(MODULE_NAME, "Error during rescan-log:", error);
             return false;
        }
    });

    // --- Update Handlers ---
    ipcMain.on('check-for-update', () => {
        logger.info(MODULE_NAME, 'Manual update check requested');
        const { autoUpdater } = require('electron-updater');
        const mainWindow = getMainWindow();
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('update-checking');
        }
        autoUpdater.checkForUpdates();
    });

    ipcMain.on('download-update', () => {
        logger.info(MODULE_NAME, 'Update download requested');
        const { autoUpdater } = require('electron-updater');
        autoUpdater.downloadUpdate();
    });

    ipcMain.on('install-update', () => {
        logger.info(MODULE_NAME, 'Update install requested');
        const { autoUpdater } = require('electron-updater');
        setImmediate(() => autoUpdater.quitAndInstall());
    });

    // --- Update Simulation Handlers (Debug) ---
    ipcMain.on('debug:simulate-update-available', () => {
        logger.info(MODULE_NAME, 'Debug: Simulating update available');
        const mainWindow = getMainWindow();
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('update-available', {
                version: '2.1.0',
                releaseDate: new Date().toISOString(),
                releaseNotes: 'This is a simulated update for testing the UI.'
            });
        }
    });

    ipcMain.on('debug:simulate-update-download', () => {
        logger.info(MODULE_NAME, 'Debug: Simulating update download');
        const mainWindow = getMainWindow();
        if (mainWindow && !mainWindow.isDestroyed()) {
            // Simulate progressive download
            let progress = 0;
            const downloadInterval = setInterval(() => {
                progress += Math.random() * 15 + 5; // Random progress increments
                if (progress >= 100) {
                    progress = 100;
                    clearInterval(downloadInterval);
                    // Send download complete
                    mainWindow.webContents.send('update-downloaded', {
                        version: '2.1.0',
                        releaseDate: new Date().toISOString(),
                        releaseNotes: 'This is a simulated update for testing the UI.'
                    });
                } else {
                    // Send download progress
                    const bytesPerSecond = Math.floor(Math.random() * 1024000) + 500000; // 500KB-1.5MB/s
                    const totalBytes = 50 * 1024 * 1024; // 50MB total
                    const transferredBytes = Math.floor((progress / 100) * totalBytes);
                    
                    mainWindow.webContents.send('update-download-progress', 
                        progress,
                        bytesPerSecond,
                        transferredBytes,
                        totalBytes
                    );
                }
            }, 200); // Update every 200ms
        }
    });

    ipcMain.on('debug:simulate-update-error', () => {
        logger.info(MODULE_NAME, 'Debug: Simulating update error');
        const mainWindow = getMainWindow();
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('update-error', 'Simulated update error for testing');
        }
    });

    ipcMain.on('debug:simulate-update-checking', () => {
        logger.info(MODULE_NAME, 'Debug: Simulating update checking');
        const mainWindow = getMainWindow();
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('update-checking');
            // After a delay, send update available
            setTimeout(() => {
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('update-available', {
                        version: '2.1.0',
                        releaseDate: new Date().toISOString(),
                        releaseNotes: 'This is a simulated update for testing the UI.'
                    });
                }
            }, 1500);
        }
    });

    ipcMain.on('debug:reset-update-simulation', () => {
        logger.info(MODULE_NAME, 'Debug: Resetting update simulation');
        const mainWindow = getMainWindow();
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('update-not-available');
        }
    });


    // Window control handlers for fallback titlebar
    ipcMain.on('window-minimize', (event) => {
        logger.info(MODULE_NAME, 'Received window-minimize command');
        const window = BrowserWindow.fromWebContents(event.sender);
        if (window) {
            logger.info(MODULE_NAME, 'Minimizing window');
            window.minimize();
        } else {
            logger.error(MODULE_NAME, 'Could not find window for minimize command');
        }
    });

    ipcMain.on('window-maximize', (event) => {
        logger.info(MODULE_NAME, 'Received window-maximize command');
        const window = BrowserWindow.fromWebContents(event.sender);
        if (window) {
            if (window.isMaximized()) {
                logger.info(MODULE_NAME, 'Unmaximizing window');
                window.unmaximize();
            } else {
                logger.info(MODULE_NAME, 'Maximizing window');
                window.maximize();
            }
        } else {
            logger.error(MODULE_NAME, 'Could not find window for maximize command');
        }
    });

    ipcMain.on('window-close', (event) => {
        logger.info(MODULE_NAME, 'Received window-close command');
        const window = BrowserWindow.fromWebContents(event.sender);
        if (window) {
            logger.info(MODULE_NAME, 'Closing window');
            window.close();
        } else {
            logger.error(MODULE_NAME, 'Could not find window for close command');
        }
    });

    // --- Entity Resolution Handlers ---
    ipcMain.handle('entity:resolve', (event, entityId: string, serverEnriched?: any) => {
        try {
            return resolveEntityName(entityId);
        } catch (error) {
            logger.error(MODULE_NAME, 'Error resolving entity:', error);
            return {
                displayName: entityId,
                isNpc: false,
                category: 'unknown',
                matchMethod: 'fallback'
            };
        }
    });

    ipcMain.handle('entity:resolve-batch', (event, entityIds: string[]) => {
        try {
            return entityIds.map(id => resolveEntityName(id));
        } catch (error) {
            logger.error(MODULE_NAME, 'Error resolving entities batch:', error);
            return entityIds.map(id => ({
                displayName: id,
                isNpc: false,
                category: 'unknown',
                matchMethod: 'fallback'
            }));
        }
    });

    ipcMain.handle('entity:is-npc', (event, entityId: string) => {
        try {
            return isNpcEntity(entityId);
        } catch (error) {
            logger.error(MODULE_NAME, 'Error checking NPC status:', error);
            return false;
        }
    });

    ipcMain.handle('entity:filter-npcs', (event, entityIds: string[]) => {
        try {
            return entityIds.filter(id => !isNpcEntity(id));
        } catch (error) {
            logger.error(MODULE_NAME, 'Error filtering NPCs:', error);
            return entityIds;
        }
    });

    ipcMain.handle('definitions:get', () => {
        try {
            return getDefinitions();
        } catch (error) {
            logger.error(MODULE_NAME, 'Error getting definitions:', error);
            return null;
        }
    });

    ipcMain.handle('definitions:get-version', () => {
        try {
            return getDefinitionsVersion();
        } catch (error) {
            logger.error(MODULE_NAME, 'Error getting definitions version:', error);
            return null;
        }
    });

    ipcMain.handle('definitions:get-stats', () => {
        try {
            return getCacheStats();
        } catch (error) {
            logger.error(MODULE_NAME, 'Error getting cache stats:', error);
            return {
                version: null,
                timestamp: null,
                lastUpdated: null,
                entityCounts: {},
                patternStats: { compiled: 0, failed: 0 },
                isLoaded: false
            };
        }
    });

    ipcMain.handle('definitions:force-refresh', async (event, serverBaseUrl?: string) => {
        try {
            // Use default server URL if not provided
            const SERVER_URL = serverBaseUrl || 'http://localhost:5252'; // Default from server-config
            return await forceRefreshDefinitions(SERVER_URL);
        } catch (error) {
            logger.error(MODULE_NAME, 'Error force refreshing definitions:', error);
            return false;
        }
    });

    // --- Force Refresh NPC List Handler ---
    ipcMain.handle('force-refresh-npc-list', async () => {
        try {
            // Use default server URL 
            const SERVER_URL = 'http://localhost:5252'; // Default from server-config
            return await forceRefreshNpcList(SERVER_URL);
        } catch (error) {
            logger.error(MODULE_NAME, 'Error force refreshing NPC list:', error);
            return false;
        }
    });

    // --- Enhanced WebContentsView IPC Handlers ---
    logger.info(MODULE_NAME, "Registering enhanced WebContentsView IPC handlers...");
    registerEnhancedIPCHandlers();

    logger.success(MODULE_NAME, "IPC handlers registered (including enhanced WebContentsView handlers).");
}