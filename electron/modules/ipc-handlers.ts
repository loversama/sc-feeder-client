import { ipcMain, dialog, BrowserWindow, app, shell } from 'electron'; // Import app and shell
import path from 'node:path';
import fs from 'node:fs';
import { autoUpdater } from 'electron-updater';
import * as ConfigManager from './config-manager.ts';
import { updateStartupSetting, getStartupStatus } from './enhanced-startup-manager';
import { diagnoseStartupSystem, testStartupFunctionality } from './startup-diagnostics';
import { diagnoseAutoUpdateSystem, testUpdateWorkflow, applyAutoUpdateFixes } from './autoupdate-diagnostics'; // Added .ts
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
    closeAuthenticatedWebContentWindow, // Added for WebContentsView cleanup
    webContentBaseWindow // Add direct access to the webContentBaseWindow
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
import { getCurrentUsername, getCurrentLocation, getLocationHistory, getLocationState, getZoneServiceState, getZoneStatistics, getCurrentZoneInfo, getZoneHistory, addZoneToHistory, isZoneSystemAvailable } from './log-parser.ts'; // Needed for event details window and enhanced zone data - Added .ts
import * as logger from './logger'; // Import the logger utility
import * as AuthManager from './auth-manager'; // Import AuthManager
import { resolveEntityName, isNpcEntity, getDefinitions, getDefinitionsVersion, getCacheStats, forceRefreshDefinitions, forceRefreshNpcList } from './definitionsService.ts'; // Import entity resolution functions
import { SERVER_API_URL } from './server-config.ts'; // Import server config
import { registerEnhancedIPCHandlers } from '../enhanced-ipc-handlers'; // Import enhanced handlers

const MODULE_NAME = 'IPCHandlers'; // Define module name for logger

export function registerIpcHandlers() {
    logger.info(MODULE_NAME, "Registering IPC handlers...");
    
    // Debug: Check if handlers are already registered
    const registeredHandlers = (ipcMain as any)._invokeHandlers;
    if (registeredHandlers) {
        logger.debug(MODULE_NAME, 'Currently registered invoke handlers:', Object.keys(registeredHandlers));
    }

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

    // --- New Sound Preferences Handlers ---
    console.log('!!! REACHING SOUND PREFERENCES HANDLERS SECTION !!!');
    logger.info(MODULE_NAME, 'Registering sound preferences handlers...');
    
    try {
        ipcMain.handle('get-sound-preferences', () => {
            logger.debug(MODULE_NAME, 'get-sound-preferences handler called');
            return ConfigManager.getSoundPreferences();
        });
        logger.info(MODULE_NAME, 'get-sound-preferences handler registered');
    } catch (error) {
        logger.error(MODULE_NAME, 'Failed to register get-sound-preferences handler:', error);
    }
    
    ipcMain.handle('set-sound-preferences', (event, preferences) => {
        try {
            logger.debug(MODULE_NAME, 'Received sound preferences:', JSON.stringify(preferences));
            ConfigManager.setSoundPreferences(preferences);
            return true;
        } catch (error) {
            logger.error(MODULE_NAME, 'Error saving sound preferences:', error);
            return false; // Return false instead of throwing
        }
    });
    
    try {
        logger.info(MODULE_NAME, 'Registering select-sound-file handler...');
        ipcMain.handle('select-sound-file', async () => {
        try {
            logger.debug(MODULE_NAME, 'Opening file dialog for sound selection');
            
            const mainWindow = getMainWindow();
            const result = await dialog.showOpenDialog(mainWindow, {
                properties: ['openFile'],
                filters: [
                    { name: 'Audio Files', extensions: ['mp3', 'm4a', 'wav', 'ogg'] },
                    { name: 'All Files', extensions: ['*'] }
                ],
                title: 'Select Sound File'
            });
            
            logger.debug(MODULE_NAME, 'File dialog result:', result);
            
            if (result.canceled || !result.filePaths.length) {
                return null;
            }
            
            return result.filePaths[0];
        } catch (error) {
            logger.error(MODULE_NAME, 'Error showing file dialog:', error);
            return null;
        }
        });
        logger.info(MODULE_NAME, 'select-sound-file handler registered');
    } catch (error) {
        logger.error(MODULE_NAME, 'Failed to register select-sound-file handler:', error);
    }
    
    ipcMain.handle('test-sound', async (event, soundPath: string, volume?: number) => {
        try {
            logger.debug(MODULE_NAME, `Testing sound: ${soundPath}`);
            
            // For custom sounds, read the file and return as data URL
            if (soundPath.includes(':') || soundPath.startsWith('/')) {
                // Absolute path - custom sound
                if (!fs.existsSync(soundPath)) {
                    logger.warn(MODULE_NAME, `Sound file not found: ${soundPath}`);
                    return { success: false, error: 'File not found' };
                }
                
                try {
                    // Read the file and convert to base64 data URL
                    const data = fs.readFileSync(soundPath);
                    const base64 = data.toString('base64');
                    const ext = path.extname(soundPath).toLowerCase().slice(1);
                    const mimeType = ext === 'mp3' ? 'audio/mpeg' : 
                                   ext === 'm4a' ? 'audio/mp4' :
                                   ext === 'wav' ? 'audio/wav' :
                                   ext === 'ogg' ? 'audio/ogg' : 'audio/mpeg';
                    
                    const dataUrl = `data:${mimeType};base64,${base64}`;
                    return { success: true, dataUrl };
                } catch (readError) {
                    logger.error(MODULE_NAME, `Error reading sound file: ${readError}`);
                    return { success: false, error: 'Failed to read file' };
                }
            }
            
            // For built-in sounds, just validate
            return { success: true };
        } catch (error) {
            logger.error(MODULE_NAME, `Error testing sound: ${error}`);
            return { success: false, error: error.message };
        }
    });
    
    ipcMain.handle('get-default-sounds', () => {
        // Return list of available default sounds
        // For now we only have one sound file, but we can suggest different configurations
        return [
            { name: 'kill-event', displayName: 'Default Kill Sound' },
            { name: 'kill-event-low', displayName: 'Subtle Kill Sound (Low Volume)' },
            { name: 'kill-event-high', displayName: 'Intense Kill Sound (High Volume)' },
            // These would use the same sound file but with different volume/pitch settings
            // In the future, more sound files can be added here
        ];
    });

    // --- Enhanced Launch on Startup Handlers ---
    ipcMain.handle('get-launch-on-startup', () => {
        return ConfigManager.getLaunchOnStartup();
    });
    
    ipcMain.handle('set-launch-on-startup', async (event, value: boolean) => {
        const boolValue = !!value;
        logger.info(MODULE_NAME, `Setting launch on startup to: ${boolValue}`);
        
        try {
            const result = await updateStartupSetting(boolValue);
            
            if (result.success) {
                logger.success(MODULE_NAME, `Startup setting updated successfully: enabled=${result.enabled}, method=${result.method}`);
                
                if (result.warnings.length > 0) {
                    result.warnings.forEach(warning => 
                        logger.warn(MODULE_NAME, `Startup warning: ${warning}`)
                    );
                }
                
                return { 
                    success: true, 
                    enabled: result.enabled, 
                    method: result.method,
                    warnings: result.warnings 
                };
            } else {
                logger.error(MODULE_NAME, `Failed to update startup setting:`, result.errors);
                return { 
                    success: false, 
                    enabled: result.enabled, 
                    errors: result.errors,
                    warnings: result.warnings 
                };
            }
        } catch (error) {
            const errorMsg = `Exception while updating startup setting: ${error}`;
            logger.error(MODULE_NAME, errorMsg, error);
            return { 
                success: false, 
                enabled: boolValue, 
                errors: [errorMsg] 
            };
        }
    });

    // --- Startup Diagnostics Handlers ---
    ipcMain.handle('startup-diagnose', async () => {
        logger.info(MODULE_NAME, 'Running startup diagnostics...');
        try {
            const result = await diagnoseStartupSystem();
            logger.info(MODULE_NAME, `Diagnostics complete: ${result.errors.length} errors, ${result.warnings.length} warnings`);
            return result;
        } catch (error) {
            logger.error(MODULE_NAME, 'Startup diagnostics failed:', error);
            return {
                isConfigured: false,
                osRegistered: false,
                pathExists: false,
                errors: [`Diagnostics failed: ${error}`],
                warnings: [],
                recommendations: ['Contact support with log files'],
                platformDetails: {
                    platform: process.platform,
                    isPackaged: app.isPackaged,
                    execPath: process.execPath
                }
            };
        }
    });

    ipcMain.handle('startup-test', async () => {
        logger.info(MODULE_NAME, 'Running comprehensive startup functionality test...');
        try {
            await testStartupFunctionality();
            return { success: true, message: 'Startup test completed successfully' };
        } catch (error) {
            logger.error(MODULE_NAME, 'Startup functionality test failed:', error);
            return { success: false, error: `Test failed: ${error}` };
        }
    });

    ipcMain.handle('get-startup-status', () => {
        try {
            const status = getStartupStatus();
            logger.debug(MODULE_NAME, 'Startup status requested:', status);
            return status;
        } catch (error) {
            logger.error(MODULE_NAME, 'Failed to get startup status:', error);
            return {
                configStored: false,
                osRegistered: false,
                inSync: false,
                isOperationInProgress: false,
                loginItemSettings: null,
                error: `Failed to get status: ${error}`
            };
        }
    });

    // --- Auto-Update Diagnostics Handlers ---
    ipcMain.handle('autoupdate-diagnose', async () => {
        logger.info(MODULE_NAME, 'Running auto-update system diagnostics...');
        try {
            const result = await diagnoseAutoUpdateSystem();
            logger.info(MODULE_NAME, `Auto-update diagnostics complete: ${result.criticalIssues.length} critical, ${result.errors.length} errors, ${result.warnings.length} warnings`);
            return result;
        } catch (error) {
            logger.error(MODULE_NAME, 'Auto-update diagnostics failed:', error);
            return {
                updateSystemHealth: { isConfigured: false, canCheckUpdates: false, canDownloadUpdates: false, canInstallUpdates: false, hasValidSignature: false },
                buildConfiguration: { installer: 'unknown', isASAREnabled: false, hasCodeSigning: false, updateChannel: 'unknown', publishProvider: 'unknown' },
                startupCompatibility: { startupPathValid: false, squirrelExpected: false, squirrelFound: false, pathMismatch: false },
                networkConfiguration: { canReachUpdateServer: false, hasValidCredentials: false, rateLimit: false },
                errors: [`Diagnostics failed: ${error}`],
                warnings: [],
                recommendations: ['Contact support with log files'],
                criticalIssues: [`System diagnostic failure: ${error}`]
            };
        }
    });

    ipcMain.handle('autoupdate-test', async () => {
        logger.info(MODULE_NAME, 'Running comprehensive auto-update workflow test...');
        try {
            await testUpdateWorkflow();
            return { success: true, message: 'Auto-update test completed successfully' };
        } catch (error) {
            logger.error(MODULE_NAME, 'Auto-update workflow test failed:', error);
            return { success: false, error: `Test failed: ${error}` };
        }
    });

    ipcMain.handle('autoupdate-fix', async () => {
        logger.info(MODULE_NAME, 'Applying auto-update fixes...');
        try {
            const result = await applyAutoUpdateFixes();
            logger.info(MODULE_NAME, `Auto-update fixes completed: ${result.applied.length} applied, ${result.failed.length} failed`);
            return result;
        } catch (error) {
            logger.error(MODULE_NAME, 'Auto-update fix application failed:', error);
            return { success: false, applied: [], failed: [`Fix application failed: ${error}`] };
        }
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

    // NOTE: Legacy web-content handlers removed to avoid conflict with navigation controller

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


    ipcMain.handle('web-content-window-minimize', () => {
        logger.info(MODULE_NAME, "Received 'web-content-window-minimize' request.");
        try {
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
        const mainWindow = getMainWindow();
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('update-checking');
        }
        autoUpdater.checkForUpdates();
    });

    ipcMain.on('download-update', () => {
        logger.info(MODULE_NAME, 'Update download requested');
        autoUpdater.downloadUpdate();
    });

    ipcMain.on('install-update', async () => {
        logger.info(MODULE_NAME, 'Update install requested');
        
        try {
            
            // Note: Removed unreliable downloadedUpdateHelper check
            // The UI manages update state properly - if this IPC is called, an update is ready
            
            // Verify critical DLLs are present before update
            const appDir = path.dirname(process.execPath);
            const requiredFiles = ['ffmpeg.dll', 'libEGL.dll', 'libGLESv2.dll'];
            const missingFiles: string[] = [];
            
            for (const file of requiredFiles) {
                const filePath = path.join(appDir, file);
                if (!fs.existsSync(filePath)) {
                    missingFiles.push(file);
                    logger.warn(MODULE_NAME, `Critical file missing before update: ${file} at ${filePath}`);
                }
            }
            
            if (missingFiles.length > 0) {
                logger.warn(MODULE_NAME, `Missing DLLs detected: ${missingFiles.join(', ')}. Proceeding with update anyway.`);
            }
            
            logger.info(MODULE_NAME, 'Preparing to quit and install update...');
            
            // Give a brief moment for any pending operations to complete
            await new Promise(resolve => setTimeout(resolve, 500));
            
            // Force close all windows gracefully before installing
            const windows = BrowserWindow.getAllWindows();
            logger.info(MODULE_NAME, `Closing ${windows.length} windows before update installation`);
            
            for (const window of windows) {
                if (!window.isDestroyed()) {
                    window.removeAllListeners('close');
                    window.close();
                }
            }
            
            // Wait for windows to close properly
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            // Install the update - electron-updater handles internal ready state
            // First parameter: isSilent (false to show installation progress)
            // Second parameter: isForceRunAfter (true to restart app after installation)
            logger.info(MODULE_NAME, 'Executing quitAndInstall...');
            
            // Add a timeout wrapper in case quitAndInstall hangs
            const installTimeout = setTimeout(() => {
                logger.error(MODULE_NAME, 'Installation timeout - forcing app quit');
                app.quit();
            }, 30000); // 30 second timeout
            
            try {
                autoUpdater.quitAndInstall(false, true);
                clearTimeout(installTimeout);
            } catch (installError) {
                clearTimeout(installTimeout);
                throw installError; // Re-throw to be caught by outer catch
            }
            
        } catch (error) {
            logger.error(MODULE_NAME, 'Failed to install update:', error);
            const mainWindow = getMainWindow();
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('update-error', `Installation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
            }
        }
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

    // --- Location Data Handlers ---
    ipcMain.handle('get-current-location', () => {
        logger.debug(MODULE_NAME, 'Getting current location');
        return getCurrentLocation();
    });

    ipcMain.handle('get-location-history', () => {
        logger.debug(MODULE_NAME, 'Getting location history');
        return getLocationHistory();
    });

    ipcMain.handle('get-location-state', () => {
        logger.debug(MODULE_NAME, 'Getting location state for debugging');
        return getLocationState();
    });

    // --- Enhanced Zone System Handlers ---
    ipcMain.handle('zone:get-service-state', () => {
        try {
            logger.debug(MODULE_NAME, 'Getting enhanced zone service state');
            return getZoneServiceState();
        } catch (error) {
            logger.error(MODULE_NAME, 'Error getting zone service state:', error);
            return null;
        }
    });

    ipcMain.handle('zone:get-current-zone', () => {
        try {
            logger.debug(MODULE_NAME, 'Getting current zone information');
            return getCurrentZoneInfo();
        } catch (error) {
            logger.error(MODULE_NAME, 'Error getting current zone:', error);
            return null;
        }
    });

    ipcMain.handle('zone:get-history', (event, filter?: {
        classification?: 'primary' | 'secondary';
        system?: 'stanton' | 'pyro' | 'unknown';
        limit?: number;
    }) => {
        try {
            logger.debug(MODULE_NAME, 'Getting zone history with filter:', filter);
            return getZoneHistory(filter);
        } catch (error) {
            logger.error(MODULE_NAME, 'Error getting zone history:', error);
            return [];
        }
    });

    ipcMain.handle('zone:get-statistics', () => {
        try {
            logger.debug(MODULE_NAME, 'Getting zone statistics');
            return getZoneStatistics();
        } catch (error) {
            logger.error(MODULE_NAME, 'Error getting zone statistics:', error);
            return null;
        }
    });

    ipcMain.handle('zone:add-to-history', (event, zoneId: string, source: string, coordinates?: {x: number, y: number, z: number}) => {
        try {
            logger.debug(MODULE_NAME, `Manually adding zone to history: ${zoneId} (source: ${source})`);
            return addZoneToHistory(zoneId, source, coordinates);
        } catch (error) {
            logger.error(MODULE_NAME, 'Error adding zone to history:', error);
            return null;
        }
    });

    ipcMain.handle('zone:is-system-available', () => {
        try {
            return isZoneSystemAvailable();
        } catch (error) {
            logger.error(MODULE_NAME, 'Error checking zone system availability:', error);
            return false;
        }
    });

    ipcMain.handle('zone:get-primary-zones', (event, system?: 'stanton' | 'pyro' | 'unknown') => {
        try {
            logger.debug(MODULE_NAME, `Getting primary zones${system ? ` for system: ${system}` : ''}`);
            const history = getZoneHistory({ classification: 'primary', system, limit: 50 });
            return history;
        } catch (error) {
            logger.error(MODULE_NAME, 'Error getting primary zones:', error);
            return [];
        }
    });

    ipcMain.handle('zone:get-secondary-zones', (event, system?: 'stanton' | 'pyro' | 'unknown') => {
        try {
            logger.debug(MODULE_NAME, `Getting secondary zones${system ? ` for system: ${system}` : ''}`);
            const history = getZoneHistory({ classification: 'secondary', system, limit: 50 });
            return history;
        } catch (error) {
            logger.error(MODULE_NAME, 'Error getting secondary zones:', error);
            return [];
        }
    });

    ipcMain.handle('zone:get-recent-zones', (event, limit: number = 10) => {
        try {
            logger.debug(MODULE_NAME, `Getting recent zones (limit: ${limit})`);
            return getZoneHistory({ limit });
        } catch (error) {
            logger.error(MODULE_NAME, 'Error getting recent zones:', error);
            return [];
        }
    });

    // --- Debug Handlers ---
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
            logger.debug(MODULE_NAME, `Resolving entity: "${entityId}"`);
            const resolved = resolveEntityName(entityId);
            const isNpc = isNpcEntity(entityId);
            
            // Return full ResolvedEntity object that frontend expects
            const result = {
                displayName: resolved.displayName,
                isNpc: isNpc,
                category: resolved.category,
                matchMethod: resolved.matchMethod
            };
            
            logger.debug(MODULE_NAME, `Entity resolution result for "${entityId}": ${JSON.stringify(result)}`);
            return result;
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
            return entityIds.map(id => {
                const resolved = resolveEntityName(id);
                const isNpc = isNpcEntity(id);
                
                // Return full ResolvedEntity object that frontend expects
                return {
                    displayName: resolved.displayName,
                    isNpc: isNpc,
                    category: resolved.category,
                    matchMethod: resolved.matchMethod
                };
            });
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
            const SERVER_URL = serverBaseUrl || SERVER_API_URL; // Use proper config
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
            const SERVER_URL = SERVER_API_URL; // Use proper config
            return await forceRefreshNpcList(SERVER_URL);
        } catch (error) {
            logger.error(MODULE_NAME, 'Error force refreshing NPC list:', error);
            return false;
        }
    });

    // --- Debug NPC Detection Handler ---
    ipcMain.handle('debug:test-npc-patterns', () => {
        logger.info(MODULE_NAME, 'Testing NPC patterns with sample data...');
        
        const testEntities = [
            'ASD_Soldier_4893437',
            'ASD_Guard_123456',
            'PU_Human_Enemy_GroundCombat_NPC_ASD_soldier_789',
            'vlk_adult_irradiated_4983435925834',
            'PDC Turret',
            'Vanduul Blade',
            'PlayerName123',
            'AEGS_Gladius_456789'
        ];
        
        const results = testEntities.map(entityId => {
            const isNpc = isNpcEntity(entityId);
            const resolved = resolveEntityName(entityId);
            logger.info(MODULE_NAME, `Test: "${entityId}" -> NPC: ${isNpc}, Display: "${resolved.displayName}"`);
            return { entityId, isNpc, displayName: resolved.displayName };
        });
        
        return results;
    });

    // --- Enhanced WebContentsView IPC Handlers ---
    try {
        logger.info(MODULE_NAME, "Registering enhanced WebContentsView IPC handlers...");
        registerEnhancedIPCHandlers();
        logger.success(MODULE_NAME, "Enhanced WebContentsView handlers registered successfully.");
    } catch (error) {
        logger.error(MODULE_NAME, "Failed to register enhanced WebContentsView handlers:", error);
        // Don't throw - continue with other handlers
    }

    logger.success(MODULE_NAME, "All IPC handlers registered successfully.");
}