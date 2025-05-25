import { app, globalShortcut, BrowserWindow, session } from 'electron'; // Keep base electron imports, add session
import { autoUpdater, UpdateCheckResult } from 'electron-updater'; // Import autoUpdater and types from electron-updater
import { createMainWindow, getMainWindow, closeAllWindows } from './window-manager.ts'; // Added .ts
import { createTrayMenu, destroyTray } from './tray-manager.ts'; // Added .ts
import { startWatchingLogFile, stopWatchingLogFile } from './log-watcher.ts'; // Added .ts
import { endCurrentSession } from './session-manager.ts'; // Added .ts
import { loadHistoricKillTally } from './csv-logger.ts'; // Added .ts
import { registerIpcHandlers } from './ipc-handlers.ts'; // Added .ts
import { resetParserState } from './log-parser.ts'; // Import reset function - Added .ts
import * as logger from './logger'; // Import the logger utility
import { connectToServer, disconnectFromServer } from './server-connection';
import { registerAuthIpcHandlers, initializeAuth } from './auth-manager'; // Import initializeAuth
import { getOfflineMode } from './config-manager'; // Import offline mode getter

const MODULE_NAME = 'AppLifecycle'; // Define module name for logger

// --- Module State ---

export let isQuitting = false; // Export flag

// --- Event Handlers ---

import path from 'node:path'; // Ensure path is imported

async function onReady() {
    logger.info(MODULE_NAME, "App ready.");

    // --- Environment Setup (Moved here for app.getAppPath()) ---
    process.env.APP_ROOT = app.getAppPath();
    logger.info(MODULE_NAME, `APP_ROOT set using app.getAppPath(): ${process.env.APP_ROOT}`);

    if (typeof process.env.APP_ROOT !== 'string' || !process.env.APP_ROOT) {
        logger.error(MODULE_NAME, `FATAL: process.env.APP_ROOT is not a valid string after app.getAppPath()! Value: ${process.env.APP_ROOT}. Cannot proceed.`);
        // Consider quitting: app.quit();
        return; // Stop further execution in onReady if APP_ROOT is invalid
    }

    const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL'];
    // MAIN_DIST is not exported/used globally, calculate locally if needed or remove if unused
    // const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron');
    process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, 'public') : path.join(process.env.APP_ROOT, 'dist');
    logger.info(MODULE_NAME, `VITE_PUBLIC set to: ${process.env.VITE_PUBLIC}`);
    // logger.info(MODULE_NAME, `MAIN_DIST calculated as: ${MAIN_DIST}`); // Log if MAIN_DIST is kept


    // --- Set Custom User Agent ---
    const currentUA = session.defaultSession.getUserAgent();
    const appVersion = app.getVersion();
    const customUA = `${currentUA} SC-Feeder-Client/${appVersion}`;
    session.defaultSession.setUserAgent(customUA);
    logger.info(MODULE_NAME, `Set User-Agent to: ${customUA}`);

    // Register IPC handlers first (can now potentially use paths if needed)
    registerIpcHandlers(); // Register general handlers
    registerAuthIpcHandlers(); // Register auth handlers

    // Initialize authentication and connect to server only if NOT in offline mode
    if (!getOfflineMode()) {
        logger.info(MODULE_NAME, "Online mode: Initializing authentication...");
        const canConnect = await initializeAuth(); // Wait and check if we have a token

        // Connect to backend server only if initial auth state allows
        if (canConnect) {
            logger.info(MODULE_NAME, "Auth initialized with a token. Attempting server connection...");
            connectToServer();
        } else {
            logger.warn(MODULE_NAME, "Auth initialized without a token. Connection will be attempted later if needed (e.g., by log watcher or login).");
            // No initial connection attempt if no token
        }
    } else {
        logger.info(MODULE_NAME, "Offline mode enabled. Skipping initial authentication and server connection.");
        // Ensure server is disconnected if previously connected (e.g., mode changed while running)
        disconnectFromServer();
    }

    // Create UI components
    createTrayMenu(); // Create tray icon and menu
    createMainWindow(async () => {
        // This callback runs after the main window's 'did-finish-load' event
        logger.info(MODULE_NAME, "Main window finished loading.");

        // Check for updates after window is loaded (with a delay)
        logger.info(MODULE_NAME, "Scheduling update check...");
        setTimeout(() => {
            logger.info(MODULE_NAME, "Checking for updates...");
            autoUpdater.checkForUpdatesAndNotify()
              .then((result: UpdateCheckResult | null) => { // Add type for result
                // Result might be null if no update is available or if the check failed silently
                // The 'update-available' or 'update-not-available' events handle the outcome.
                logger.info(MODULE_NAME, `Update check promise resolved. Update available: ${result?.updateInfo?.version ?? 'No'}`);
              })
              .catch((err: Error) => { // Add type for error
                // Error event listener in main.ts will also catch this
                logger.error(MODULE_NAME, `Error invoking checkForUpdatesAndNotify: ${err.message}`);
              });
        }, 10000); // 10-second delay

        // Load historic tally *after* window is ready and IPC is registered
        try {
            await loadHistoricKillTally();
        } catch (err: any) {
            logger.error(MODULE_NAME, "Error loading historic kill tally:", err.message);
        }

        // Start watching log file *after* window is ready and tally is loaded
        try {
            await startWatchingLogFile();
            getMainWindow()?.webContents.send('log-status', 'Log monitoring active.');
        } catch (err: any) {
            logger.error(MODULE_NAME, "Error starting log watcher:", err.message);
            getMainWindow()?.webContents.send('log-status', `Error starting log monitoring: ${err.message}`);
        }
    }); // Create the main window and pass callback

    // Register global shortcuts
    registerGlobalShortcuts();
}

async function onWindowAllClosed() {
    logger.info(MODULE_NAME, "WindowAllClosed event.");
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    // On Windows/Linux, closing all windows usually quits the app.
    if (process.platform !== 'darwin') {
        logger.info(MODULE_NAME, "Quitting because all windows are closed (non-macOS).");
        // Ensure cleanup happens before quitting
        await performCleanup();
        app.quit();
    }
    // On macOS, the app continues running without windows.
}

function onActivate() {
    logger.info(MODULE_NAME, "Activate event.");
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow(async () => {
             // Re-initialize watcher if needed when window is recreated
             logger.info(MODULE_NAME, "Re-initializing log watcher after window activation.");
             resetParserState(); // Reset parser state as well
             await loadHistoricKillTally(); // Reload tally
             await startWatchingLogFile(); // Start watcher
             getMainWindow()?.webContents.send('log-status', 'Log monitoring active.');
        });
    } else {
        // If window exists, focus it
        getMainWindow()?.focus();
    }
}

async function onWillQuit(event: Electron.Event) {
    logger.info(MODULE_NAME, "WillQuit event.");
    // Prevent default quit behavior to allow async cleanup
    event.preventDefault();

    // Perform cleanup operations
    await performCleanup();

    // Explicitly exit after cleanup
    logger.info(MODULE_NAME, "Cleanup finished. Exiting application.");
    app.exit(); // Use app.exit() after async cleanup
}

// --- Helper Functions ---

async function performCleanup() {
    logger.info(MODULE_NAME, "Performing cleanup...");
    // Unregister all shortcuts.
    globalShortcut.unregisterAll();
    logger.info(MODULE_NAME, 'Unregistered all global shortcuts.');

    // Stop watching log file
    await stopWatchingLogFile(); // This now also calls endCurrentSession

    // Disconnect from server (always attempt during cleanup)
    disconnectFromServer();

    // Destroy tray icon
    destroyTray();

    // Close any remaining windows (forcefully if necessary)
    closeAllWindows();

    logger.info(MODULE_NAME, "Cleanup operations complete.");
}

function registerGlobalShortcuts() {
    // DevTools Toggle (CmdOrCtrl+Shift+I)
    const devToolsRet = globalShortcut.register('CommandOrControl+Shift+I', () => {
        const focusedWindow = BrowserWindow.getFocusedWindow();
        if (focusedWindow) {
            logger.debug(MODULE_NAME, 'DevTools shortcut pressed.');
            focusedWindow.webContents.toggleDevTools();
        }
    });
    if (!devToolsRet) {
        logger.warn(MODULE_NAME, 'Failed to register DevTools shortcut (CmdOrCtrl+Shift+I).');
    }

    // F12 as backup DevTools toggle
    const f12Ret = globalShortcut.register('F12', () => {
        const focusedWindow = BrowserWindow.getFocusedWindow();
        if (focusedWindow) {
            logger.debug(MODULE_NAME, 'F12 pressed - toggling DevTools.');
            focusedWindow.webContents.toggleDevTools();
        }
    });
    if (!f12Ret) {
        logger.warn(MODULE_NAME, 'Failed to register F12 shortcut.');
    }
}
// --- Initialization ---

// Function to explicitly set the quitting flag (called by tray manager)
export function setIsQuitting(value: boolean) {
    isQuitting = value;
    logger.info(MODULE_NAME, `isQuitting flag set to ${value}.`);
}

export function initialize() {

    // Main lifecycle listeners
    app.whenReady().then(onReady).catch(err => {
        logger.error(MODULE_NAME, "Error during app ready:", err);
        if (err instanceof Error) {
            logger.error(MODULE_NAME, "Error details:", err.message, err.stack);
        } else if (typeof err === 'object' && err !== null) {
            logger.error(MODULE_NAME, "Non-Error object caught:", JSON.stringify(err));
        }
    });
    app.on('window-all-closed', onWindowAllClosed);
    app.on('activate', onActivate);

    // Use 'before-quit' to set the flag, 'will-quit' for cleanup
    app.on('before-quit', () => {
        isQuitting = true;
        logger.info(MODULE_NAME, "BeforeQuit event: isQuitting flag set.");
    });
    app.on('will-quit', onWillQuit);

    // Note: The main window 'close' event (hide vs quit logic) is now handled
    // directly within window-manager.ts createMainWindow function.
    logger.success(MODULE_NAME, "Initialized.");
}

// Removed setupCloseHandler as it's no longer needed.