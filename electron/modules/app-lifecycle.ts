import { app, globalShortcut, BrowserWindow, session } from 'electron'; // Keep base electron imports, add session
import * as os from 'os'; // Import os for hostname
import fs from 'node:fs';
import { autoUpdater, UpdateCheckResult } from 'electron-updater'; // Import autoUpdater and types from electron-updater
import {
  createMainWindow,
  getMainWindow,
  closeAllWindows,
  createLoginWindow,
  closeLoginWindow,
  getLoginWindow,
  createMainWindowAfterAuth // Import the new function
} from './window-manager.ts'; // Added .ts
import { createTrayMenu, destroyTray } from './tray-manager.ts'; // Added .ts
import { startWatchingLogFile, stopWatchingLogFile } from './log-watcher.ts'; // Added .ts
import { endCurrentSession } from './session-manager.ts'; // Added .ts
import { loadHistoricKillTally } from './csv-logger.ts'; // Added .ts
import { registerIpcHandlers } from './ipc-handlers.ts'; // Added .ts
import { resetParserState } from './log-parser.ts'; // Import reset function - Added .ts
import * as logger from './logger'; // Import the logger utility
import { connectToServer, disconnectFromServer } from './server-connection';
import { registerAuthIpcHandlers, initializeAuth, getPersistedClientId, setGuestMode, setGuestModeAndRemember, hasActiveAuthSession, getRefreshToken } from './auth-manager'; // Import initializeAuth and getPersistedClientId
import { initializeEventProcessor } from './event-processor'; // Import EventProcessor initialization
import {
  getOfflineMode,
  getLaunchOnStartup,
  getGuestModePreference
} from './config-manager';
import { ipcMain } from 'electron'; // Import ipcMain for login popup

export function getDetailedUserAgent(): string {
  const appVersion = app.getVersion();
  const hostname = os.hostname();
  const clientId = getPersistedClientId(); // Assuming this is synchronous
  return `VoidLogClient-${appVersion} (User Hostname: ${hostname}, Client ID: ${clientId})`;
}

const MODULE_NAME = 'AppLifecycle'; // Define module name for logger

// --- Module State ---

export let isQuitting = false; // Export flag

// --- Event Handlers ---

import path from 'node:path'; // Ensure path is imported

async function determineAuthState(): Promise<{
  requiresLoginPopup: boolean;
  authMode: 'authenticated' | 'guest' | 'unknown';
}> {
  logger.info(MODULE_NAME, 'determineAuthState called');
  
  // Check if there's an active authenticated session in memory
  const hasActive = hasActiveAuthSession();
  logger.info(MODULE_NAME, `hasActiveAuthSession() returned: ${hasActive}`);
  
  if (hasActive) {
    logger.info(MODULE_NAME, 'Active authenticated session found, skipping login popup');
    return { requiresLoginPopup: false, authMode: 'authenticated' };
  }
  
  // Check for stored refresh token (user was previously authenticated)
  const storedRefreshToken = getRefreshToken();
  logger.info(MODULE_NAME, `Checking for stored refresh token: ${storedRefreshToken ? 'found' : 'not found'}`);
  if (storedRefreshToken) {
    logger.info(MODULE_NAME, 'Stored refresh token found, attempting to restore authenticated session');
    return { requiresLoginPopup: false, authMode: 'authenticated' };
  }
  
  // Check if user previously chose guest mode
  const guestModePreference = getGuestModePreference();
  if (guestModePreference) {
    logger.info(MODULE_NAME, 'Guest mode preference found, skipping login popup');
    return { requiresLoginPopup: false, authMode: 'guest' };
  }
  
  // No stored authentication or guest preference - show login popup
  logger.info(MODULE_NAME, 'No stored auth state or guest preference - showing login popup');
  return { requiresLoginPopup: true, authMode: 'unknown' };
}

async function showLoginPopup(): Promise<{ authAlreadyInitialized: boolean }> {
  logger.info(MODULE_NAME, 'showLoginPopup called - creating login window');
  return new Promise((resolve) => {
    // Create login window - no main window dependency required
    const loginWindow = createLoginWindow();
    
    if (!loginWindow) {
      logger.error(MODULE_NAME, 'Failed to create login window');
      resolve({ authAlreadyInitialized: false });
      return;
    }
    
    logger.info(MODULE_NAME, 'Login window created successfully');

    // Listen for login completion
    const handleLoginComplete = () => {
      logger.info(MODULE_NAME, 'Login popup completed with authentication');
      closeLoginWindow();
      resolve({ authAlreadyInitialized: true }); // Auth was initialized by login popup
    };

    const handleGuestModeSelected = () => {
      logger.info(MODULE_NAME, 'Login popup completed with guest mode');
      closeLoginWindow();
      resolve({ authAlreadyInitialized: true }); // Guest mode was set by popup
    };

    // Listen for authentication events
    ipcMain.once('login-completed', handleLoginComplete);
    ipcMain.once('guest-mode-selected', handleGuestModeSelected);
    
    // Handle window close (temporary guest mode, don't save preference)
    loginWindow.on('closed', async () => {
      logger.info(MODULE_NAME, 'Login window closed, using temporary guest mode without saving preference');
      // Set guest mode for this session only, without saving the preference
      await setGuestMode(); // This sets guest mode temporarily without remembering the choice
      ipcMain.removeListener('login-completed', handleLoginComplete);
      ipcMain.removeListener('guest-mode-selected', handleGuestModeSelected);
      resolve({ authAlreadyInitialized: true }); // Guest mode was set temporarily
    });
  });
}

async function connectToLogServer(mainWindow: BrowserWindow, authAlreadyInitialized: boolean = false) {
  // Initialize authentication based on final state
  if (!getOfflineMode()) {
    if (authAlreadyInitialized) {
      logger.info(MODULE_NAME, "Auth already initialized, connecting to server...");
      connectToServer();
    } else {
      logger.info(MODULE_NAME, "Online mode: Initializing authentication...");
      const canConnect = await initializeAuth();
      
      if (canConnect) {
        logger.info(MODULE_NAME, "Auth state allows connection. Connecting to server...");
        connectToServer();
      } else {
        logger.warn(MODULE_NAME, "No auth token available. Will connect as guest if guest token obtained.");
      }
    }
  } else {
    logger.info(MODULE_NAME, "Offline mode enabled. Skipping server connection.");
    disconnectFromServer();
  }
}

async function loadHistoricData(mainWindow: BrowserWindow) {
  // Load historic tally *after* window is ready and IPC is registered
  try {
      await loadHistoricKillTally();
  } catch (err: any) {
      logger.error(MODULE_NAME, "Error loading historic kill tally:", err.message);
  }

  // Start watching log file *after* window is ready and tally is loaded
  try {
      await startWatchingLogFile();
      mainWindow.webContents.send('log-status', 'Log monitoring active.');
  } catch (err: any) {
      logger.error(MODULE_NAME, "Error starting log watcher:", err.message);
      mainWindow.webContents.send('log-status', `Error starting log monitoring: ${err.message}`);
  }
}

function registerGlobalShortcuts(mainWindow: BrowserWindow) {
  // Only register DevTools shortcuts in development mode
  const isDevelopment = !app.isPackaged && !process.env.CI;
  
  if (!isDevelopment) {
    logger.info(MODULE_NAME, 'Production mode detected - DevTools shortcuts disabled for security');
    return;
  }

  logger.info(MODULE_NAME, 'Development mode detected - registering DevTools shortcuts');

  // DevTools Toggle (CmdOrCtrl+Shift+I)
  const devToolsRet = globalShortcut.register('CommandOrCtrl+Shift+I', () => {
      const focusedWindow = BrowserWindow.getFocusedWindow();
      if (focusedWindow) {
          logger.debug(MODULE_NAME, 'DevTools shortcut pressed.');
          focusedWindow.webContents.toggleDevTools();
      }
  });
  if (!devToolsRet) {
      logger.warn(MODULE_NAME, 'Failed to register DevTools shortcut (CmdOrCtrl+Shift+I).');
  }

  // Try multiple DevTools shortcuts since F12 often fails on Windows
  const shortcuts = [
    { key: 'F12', name: 'F12' },
    { key: 'CommandOrCtrl+Shift+J', name: 'Ctrl+Shift+J' },
    { key: 'CommandOrCtrl+Alt+I', name: 'Ctrl+Alt+I' },
    { key: 'CommandOrCtrl+F12', name: 'Ctrl+F12' },
    { key: 'Alt+F12', name: 'Alt+F12' }
  ];

  let successCount = 0;
  shortcuts.forEach(({ key, name }) => {
    const success = globalShortcut.register(key, () => {
      const focusedWindow = BrowserWindow.getFocusedWindow();
      if (focusedWindow) {
        logger.info(MODULE_NAME, `${name} pressed - forcing DevTools open`);
        try {
          // Force open DevTools - stick with docked mode for visibility
          focusedWindow.webContents.openDevTools({ mode: 'right', activate: true });
          focusedWindow.focus();
          logger.info(MODULE_NAME, `${name} DevTools opened in docked mode (should be visible)`);
        } catch (e) {
          logger.error(MODULE_NAME, `Error opening DevTools with ${name}:`, e);
        }
      }
    });
    
    if (success) {
      logger.info(MODULE_NAME, `Successfully registered ${name} shortcut for DevTools`);
      successCount++;
    } else {
      logger.warn(MODULE_NAME, `Failed to register ${name} shortcut`);
    }
  });

  if (successCount === 0) {
    logger.error(MODULE_NAME, 'CRITICAL: No DevTools shortcuts could be registered!');
  } else {
    logger.info(MODULE_NAME, `Successfully registered ${successCount}/${shortcuts.length} DevTools shortcuts`);
  }
}

// Initialize launch on startup setting during app startup
function initializeLaunchOnStartup(): void {
  try {
    // Don't set up auto-launch in development mode
    if (process.env.NODE_ENV === 'development') {
      logger.debug(MODULE_NAME, 'Development mode detected, skipping launch on startup initialization');
      return;
    }

    // Get the stored setting
    const shouldLaunchOnStartup = getLaunchOnStartup();
    logger.info(MODULE_NAME, `Launch on startup setting: ${shouldLaunchOnStartup}`);

    // Check if app was launched at startup for logging purposes
    const loginItemSettings = app.getLoginItemSettings();
    if (loginItemSettings.wasOpenedAtLogin) {
      logger.info(MODULE_NAME, 'App was launched at system startup');
      if (loginItemSettings.wasOpenedAsHidden) {
        logger.info(MODULE_NAME, 'App should start hidden/minimized');
      }
    }

    // Apply the stored setting to the OS
    // For better compatibility with auto-updater on Windows, use appropriate path
    const appFolder = path.dirname(process.execPath);
    const exeName = path.basename(process.execPath);
    
    if (process.platform === 'win32' && app.isPackaged) {
      // Windows production - use Squirrel-compatible path
      const stubLauncher = path.resolve(appFolder, '..', exeName);
      logger.info(MODULE_NAME, `Setting up Windows startup with Squirrel-compatible path: ${stubLauncher}`);
      
      app.setLoginItemSettings({
        openAtLogin: shouldLaunchOnStartup,
        path: stubLauncher,
        args: [
          '--processStart', `"${exeName}"`,
          '--process-start-args', '"--hidden"'
        ]
      });
    } else {
      // macOS, Linux, or development - use standard approach
      logger.info(MODULE_NAME, `Setting up startup with standard path: ${process.execPath}`);
      
      app.setLoginItemSettings({
        openAtLogin: shouldLaunchOnStartup,
        args: ['--hidden'] // Start hidden/minimized when launched at startup
      });
    }

    // Verify the setting was applied
    const verifySettings = app.getLoginItemSettings();
    logger.info(MODULE_NAME, `Startup setting applied successfully. Current state:`, {
      openAtLogin: verifySettings.openAtLogin,
      executableWillLaunchAtLogin: verifySettings.executableWillLaunchAtLogin,
      launchItems: verifySettings.launchItems
    });

  } catch (error) {
    logger.error(MODULE_NAME, 'Failed to initialize launch on startup setting:', error);
  }
}

// Check if app should start minimized/hidden
function shouldStartMinimized(): boolean {
  const loginItemSettings = app.getLoginItemSettings();
  
  // Start minimized if:
  // 1. App was launched at login AND marked as hidden
  // 2. OR if --hidden argument was passed
  const wasLaunchedAtStartup = loginItemSettings.wasOpenedAtLogin && loginItemSettings.wasOpenedAsHidden;
  const hasHiddenArg = process.argv.includes('--hidden');
  
  const shouldMinimize = wasLaunchedAtStartup || hasHiddenArg;
  
  if (shouldMinimize) {
    logger.info(MODULE_NAME, `App should start minimized. wasLaunchedAtStartup: ${wasLaunchedAtStartup}, hasHiddenArg: ${hasHiddenArg}`);
  }
  
  return shouldMinimize;
}

// This is the new, correct onReady function
async function onReady() {
  logger.startup(MODULE_NAME, 'Application ready - starting initialization sequence...');
  
  // Environment setup
  process.env.APP_ROOT = app.getAppPath();
  logger.path(MODULE_NAME, 'APP_ROOT', process.env.APP_ROOT);

  if (typeof process.env.APP_ROOT !== 'string' || !process.env.APP_ROOT) {
      logger.error(MODULE_NAME, `FATAL: process.env.APP_ROOT is not a valid string after app.getAppPath()! Value: ${process.env.APP_ROOT}. Cannot proceed.`);
      return;
  }

  const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL'];
  process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, 'public') : path.join(process.env.APP_ROOT, 'dist');
  logger.path(MODULE_NAME, 'VITE_PUBLIC', process.env.VITE_PUBLIC);

  // Security: Remove application menu in production to prevent DevTools access
  const isDevelopment = !app.isPackaged && !process.env.CI;
  if (!isDevelopment) {
    const { Menu } = await import('electron');
    Menu.setApplicationMenu(null);
    logger.info(MODULE_NAME, 'Production mode - Application menu disabled for security');
  } else {
    logger.info(MODULE_NAME, 'Development mode - Application menu enabled');
  }
  
  // Verify critical DLLs are present on startup (Windows only)
  if (process.platform === 'win32' && app.isPackaged) {
    const appDir = path.dirname(process.execPath);
    const requiredFiles = ['ffmpeg.dll', 'libEGL.dll', 'libGLESv2.dll'];
    const missingFiles: string[] = [];
    
    for (const file of requiredFiles) {
      const filePath = path.join(appDir, file);
      try {
        if (!fs.existsSync(filePath)) {
          missingFiles.push(file);
          logger.error(MODULE_NAME, `CRITICAL: Missing required DLL: ${file} at ${filePath}`);
        } else {
          logger.debug(MODULE_NAME, `DLL verification passed: ${file}`);
        }
      } catch (error) {
        logger.error(MODULE_NAME, `Error checking for ${file}:`, error);
        missingFiles.push(file);
      }
    }
    
    if (missingFiles.length > 0) {
      logger.error(MODULE_NAME, `Missing DLLs detected: ${missingFiles.join(', ')}`);
      logger.error(MODULE_NAME, `App directory: ${appDir}`);
      logger.error(MODULE_NAME, `Process executable path: ${process.execPath}`);
      // Don't block startup, but log extensively for debugging
    } else {
      logger.info(MODULE_NAME, 'All required Windows DLLs verified successfully');
    }
  }

  // Register IPC handlers first
  registerIpcHandlers();
  registerAuthIpcHandlers();

  // Initialize EventProcessor with persistent storage
  try {
    await initializeEventProcessor();
    logger.success(MODULE_NAME, 'EventProcessor with persistent storage initialized successfully');
  } catch (error) {
    logger.error(MODULE_NAME, 'Failed to initialize EventProcessor:', error);
    // Continue with app initialization even if EventProcessor fails
  }

  // Initialize launch on startup setting early in app lifecycle
  initializeLaunchOnStartup();

  // 1. Determine if login is required. This MUST be the first step.
  const authState = await determineAuthState();

  // 2. If login is required, show the popup and WAIT for it to finish.
  let authAlreadyInitialized = false;
  if (authState.requiresLoginPopup) {
    const loginResult = await showLoginPopup();
    authAlreadyInitialized = loginResult.authAlreadyInitialized;
  } else {
    // Handle stored authentication or guest mode
    if (authState.authMode === 'guest') {
      logger.info(MODULE_NAME, 'Restoring guest mode from stored preference');
      await setGuestModeAndRemember(); // Set guest mode without showing popup
      authAlreadyInitialized = true;
    } else if (authState.authMode === 'authenticated') {
      logger.info(MODULE_NAME, 'Attempting to restore authenticated session from stored token');
      // Try to initialize auth immediately to see if the stored token is valid
      try {
        const canConnect = await initializeAuth();
        if (canConnect) {
          logger.info(MODULE_NAME, 'Successfully restored authenticated session');
          authAlreadyInitialized = true;
        } else {
          logger.warn(MODULE_NAME, 'Failed to restore authenticated session, token may be expired');
          authAlreadyInitialized = false;
        }
      } catch (error) {
        logger.error(MODULE_NAME, 'Error during auth restoration:', error);
        authAlreadyInitialized = false;
      }
    }
  }

  // 3. ONLY AFTER the entire auth flow is complete, create the main UI.
  createTrayMenu();
  
  // Check if app should start minimized (launched at startup)
  const startMinimized = shouldStartMinimized();
  const mainWindow = createMainWindow();
  
  // If launched at startup, minimize the window after creation
  if (startMinimized && mainWindow) {
    logger.info(MODULE_NAME, 'Starting minimized due to startup launch');
    // Wait a bit for window to be fully ready before minimizing
    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.minimize();
        mainWindow.hide(); // Also hide from taskbar on Windows
      }
    }, 1000);
  }

  // 4. Continue with the rest of the app initialization.
  if (mainWindow) {
    await connectToLogServer(mainWindow, authAlreadyInitialized);
    await loadHistoricData(mainWindow);
    registerGlobalShortcuts(mainWindow);
  }

  // Check for updates after window is loaded (with a delay)
  logger.info(MODULE_NAME, "Scheduling update check...");
  setTimeout(() => {
      logger.info(MODULE_NAME, "Checking for updates...");
      autoUpdater.checkForUpdatesAndNotify()
        .then((result: UpdateCheckResult | null) => {
          logger.info(MODULE_NAME, `Update check promise resolved. Update available: ${result?.updateInfo?.version ?? 'No'}`);
        })
        .catch((err: Error) => {
          logger.error(MODULE_NAME, `Error invoking checkForUpdatesAndNotify: ${err.message}`);
        });
  }, 10000); // 10-second delay

  logger.startup(MODULE_NAME, '✅ Application initialization completed successfully!');
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

    // Disconnect from server connections (always attempt during cleanup)
    disconnectFromServer();

    // Destroy tray icon
    destroyTray();

    // Close any remaining windows (forcefully if necessary)
    closeAllWindows();

    logger.info(MODULE_NAME, "Cleanup operations complete.");
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