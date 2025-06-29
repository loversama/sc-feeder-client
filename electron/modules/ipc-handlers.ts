import { ipcMain, dialog, BrowserWindow, app } from 'electron'; // Import app
import path from 'node:path';
import * as ConfigManager from './config-manager.ts'; // Added .ts
// Import createWebContentWindow specifically
// Import status getters as well
import {
    getMainWindow,
    createSettingsWindow,
    createEventDetailsWindow,
    getActiveEventDataForWindow,
    createWebContentWindow,
    closeSettingsWindow,
    closeWebContentWindow,
    getSettingsStatus, // Added
    getWebContentStatus, // Added
    closeLoginWindow,
    createLoginWindow // Added
} from './window-manager.ts'; // Added close functions and status getters
import { setGuestModeAndRemember } from './auth-manager';
import * as SessionManager from './session-manager.ts'; // Added .ts
import * as EventProcessor from './event-processor.ts'; // Added .ts
import * as LogWatcher from './log-watcher.ts'; // Added .ts
import * as RsiScraper from './rsi-scraper.ts'; // Added .ts
import * as CsvLogger from './csv-logger.ts'; // Added .ts
import { getCurrentUsername } from './log-parser.ts'; // Needed for event details window - Added .ts
import * as logger from './logger'; // Import the logger utility
import * as AuthManager from './auth-manager'; // Import AuthManager

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
    ipcMain.handle('get-kill-events', (event, limit: number = 100) => {
        return EventProcessor.getKillEvents(limit);
    });

    ipcMain.handle('get-global-kill-events', (event, limit: number = 100) => {
        return EventProcessor.getGlobalKillEvents(limit);
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

    // NEW: Handler for Web Content Window
    ipcMain.handle('open-web-content-window', (_event, initialTab?: 'profile' | 'leaderboard' | 'stats' | 'map' | '/') => { // Type the initialTab
      logger.info(MODULE_NAME, `Received 'open-web-content-window' request. Initial tab: ${initialTab || 'default'}`);
      
      // Filter to only supported sections for createWebContentWindow
      let supportedSection: 'profile' | 'leaderboard' | 'map' | undefined = undefined;
      if (initialTab === 'profile' || initialTab === 'leaderboard' || initialTab === 'map') {
        supportedSection = initialTab;
      } else if (initialTab === 'stats' || initialTab === '/') {
        // Map unsupported sections to profile as default
        logger.info(MODULE_NAME, `Mapping unsupported section '${initialTab}' to 'profile'`);
        supportedSection = 'profile';
      }
      
      // Pass filtered section to createWebContentWindow
      const webWindow = createWebContentWindow(supportedSection);

      if (webWindow) {
          // Send status update regardless of whether it was created or focused
          // Use supportedSection for the status update to match what was actually passed to createWebContentWindow
          getMainWindow()?.webContents.send('web-content-window-status', { isOpen: true, activeSection: supportedSection });
          logger.info(MODULE_NAME, `Sent web-content-window-status { isOpen: true, activeSection: ${supportedSection || 'default'} }`);

          // Ensure the window is focused/restored if it already existed
          if (webWindow.isMinimized()) webWindow.restore();
          webWindow.focus();
      }
      // Removed the post-creation navigation logic as createWebContentWindow handles the initial URL hash now.
    });

    ipcMain.handle('get-passed-event-data', () => {
        return getActiveEventDataForWindow();
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
        closeWebContentWindow(); // Call the function from window-manager
        return true; // Indicate the call was made
    });

    // NEW: Handlers for getting window status synchronously
    ipcMain.handle('get-settings-window-status', () => {
        logger.info(MODULE_NAME, "Received 'get-settings-window-status' request.");
        return getSettingsStatus(); // Call the function from window-manager
    });

    ipcMain.handle('get-web-content-window-status', () => {
        logger.info(MODULE_NAME, "Received 'get-web-content-window-status' request.");
        return getWebContentStatus(); // Call the function from window-manager
    });

    // Login popup handlers
    ipcMain.handle('auth:continueAsGuest', async () => {
      try {
        setGuestModeAndRemember();
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

    // Window controls are now handled by custom-electron-titlebar

    // --- Debug Action Handlers ---
    ipcMain.handle('reset-sessions', () => {
        SessionManager.clearSessionHistory();
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

    logger.success(MODULE_NAME, "IPC handlers registered.");
}