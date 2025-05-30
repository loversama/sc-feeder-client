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
    getWebContentStatus // Added
} from './window-manager.ts'; // Added close functions and status getters
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
        ConfigManager.setLaunchOnStartup(!!value);
        // Set OS login item
        app.setLoginItemSettings({
            openAtLogin: !!value,
            args: ['--hidden'] // Electron convention for "start hidden/in tray"
        });
        return !!value;
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
    ipcMain.handle('open-web-content-window', (_event, initialTab?: 'profile' | 'leaderboard') => { // Type the initialTab
      logger.info(MODULE_NAME, `Received 'open-web-content-window' request. Initial tab: ${initialTab || 'default'}`);
      // Pass initialTab directly to createWebContentWindow, which now handles the URL hash
      const webWindow = createWebContentWindow(initialTab); // Pass initialTab here

      if (webWindow) {
          // Send status update regardless of whether it was created or focused
          // Use initialTab if provided, otherwise maybe default to a known section or null?
          // Let's assume for now the web content window itself determines the default if no hash is present.
          getMainWindow()?.webContents.send('web-content-window-status', { isOpen: true, activeSection: initialTab });
          logger.info(MODULE_NAME, `Sent web-content-window-status { isOpen: true, activeSection: ${initialTab || 'default'} }`);

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

    // --- Custom Title Bar Window Controls ---
    ipcMain.on('window:minimize', (event) => {
        const win = getMainWindow(); // Or get window from event sender if needed
        if (win) {
            logger.debug(MODULE_NAME, "Minimizing main window.");
            win.minimize();
        } else {
             logger.warn(MODULE_NAME, "Minimize requested but main window not found.");
        }
    });

    ipcMain.on('window:toggleMaximize', (event) => {
        const win = getMainWindow();
        if (win) {
            if (win.isMaximized()) {
                logger.debug(MODULE_NAME, "Unmaximizing main window.");
                win.unmaximize();
            } else {
                logger.debug(MODULE_NAME, "Maximizing main window.");
                win.maximize();
            }
        } else {
             logger.warn(MODULE_NAME, "Toggle maximize requested but main window not found.");
        }
    });

    ipcMain.on('window:close', (event) => {
        const win = getMainWindow();
        if (win) {
            logger.debug(MODULE_NAME, "Closing main window.");
            win.close(); // This will trigger the 'close' event handler in window-manager
        } else {
             logger.warn(MODULE_NAME, "Close requested but main window not found.");
        }
    });


    // --- Debug Action Handlers ---
    ipcMain.handle('reset-sessions', () => {
        SessionManager.clearSessionHistory();
        return true;
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

    logger.success(MODULE_NAME, "IPC handlers registered.");
}