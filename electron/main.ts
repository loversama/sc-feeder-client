// Import polyfills first to ensure __filename and __dirname are available
import './polyfills.ts';

import { app, dialog, Menu } from 'electron'; // Keep app and dialog from electron, add Menu
import { autoUpdater } from 'electron-updater'; // Import autoUpdater specifically from electron-updater

// Add global error handlers to catch unhandled errors
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Define __filename and __dirname for ES module scope
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import * as AppLifecycle from './modules/app-lifecycle.ts'; // Added .ts
import { getMainWindow } from './modules/window-manager.ts'; // Import getMainWindow - Added .ts
import * as logger from './modules/logger'; // Import the logger utility
import { setupTitlebar } from "custom-electron-titlebar/main"; // Import for custom title bar
import { URL } from 'node:url'; // Import URL for parsing deep links
import { SERVER_API_URL } from './modules/server-config.ts'; // Import API_BASE_URL
import { initializeDefinitions } from './modules/definitionsService.ts';
import { getDetailedUserAgent } from './modules/app-lifecycle.ts';
import { initializeNavigationStateManager } from './modules/navigation-state-manager.ts';
import { initializeNavigationController } from './modules/navigation-controller.ts';
const MODULE_NAME = 'Main'; // Define module name for logger

// --- Basic Setup ---

// Set APP_ROOT environment variable early, as other modules might rely on it.
// Note: __dirname in ESM corresponds to the directory of the current file.
// (__filename and __dirname are now defined globally above)
// process.env.APP_ROOT = path.join(__dirname, '..'); // REMOVED: Will be set later using app.getAppPath()

logger.startup(MODULE_NAME, 'SC Feeder Client starting up...');

// --- Environment Setup (Centralized) ---
// REMOVED: Path calculations moved to app-lifecycle.ts after app is ready
// export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL'];
// export const MAIN_DIST = path.join(appRoot || '', 'dist-electron');
// process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(appRoot || '', 'public') : path.join(appRoot || '', 'dist');
// logger.info(MODULE_NAME, `VITE_PUBLIC set to: ${process.env.VITE_PUBLIC}`);
// logger.info(MODULE_NAME, `MAIN_DIST set to: ${MAIN_DIST}`);

// Disable hardware acceleration to potentially mitigate rendering issues
// app.disableHardwareAcceleration(); // Uncomment if needed

// Ensure only a single instance of the application is running
if (!app.requestSingleInstanceLock()) {
  logger.error(MODULE_NAME, 'Another instance is already running. Quitting.');
  app.quit();
} else {
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    logger.info(MODULE_NAME, `Second instance launched with command line: ${commandLine.join(' ')}`);

    // Find the deep link URL in the command line arguments
    const deepLinkUrl = commandLine.find(arg => arg.startsWith('myapp://auth/client-init'));

    if (deepLinkUrl) {
      logger.info(MODULE_NAME, `Deep link found: ${deepLinkUrl}`);
      try {
        const url = new URL(deepLinkUrl);
        const token = url.searchParams.get('token');

        if (token) {
          logger.info(MODULE_NAME, `Token extracted from deep link.`);
          // Construct the server endpoint URL
          const serverEndpoint = `${SERVER_API_URL}/api/auth/client-init?token=${token}`;
          logger.info(MODULE_NAME, `Making GET request to: ${serverEndpoint}`);

          // Make the GET request to the server
          fetch(serverEndpoint, {
            headers: { 'User-Agent': getDetailedUserAgent() },
          })
            .then(response => {
              if (response.ok) {
                logger.info(MODULE_NAME, `Server request to ${serverEndpoint} successful.`);
                // Optional: Handle response body if needed
                // return response.json();
              } else {
                logger.error(MODULE_NAME, `Server request to ${serverEndpoint} failed with status: ${response.status}`);
              }
            })
            .then(data => {
              // Optional: Process response data
              // logger.info(MODULE_NAME, 'Server response data:', data);
            })
            .catch(error => {
              logger.error(MODULE_NAME, `Error making server request to ${serverEndpoint}: ${error}`);
            });

        } else {
          logger.warn(MODULE_NAME, 'Deep link found but no token parameter.');
        }
      } catch (error) {
        logger.error(MODULE_NAME, `Failed to parse deep link URL: ${deepLinkUrl}`, error);
      }
    } else {
      logger.info(MODULE_NAME, 'No deep link found in command line arguments.');
    }

    // Someone tried to run a second instance, we should focus our window.
    const mainWindow = getMainWindow(); // Use the imported function
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  // Setup the titlebar main process
  setupTitlebar();

  // Disable application menu globally to ensure no native menu bars appear
  Menu.setApplicationMenu(null);
  logger.info(MODULE_NAME, 'Global application menu disabled');

  // Set AppUserModelID for Windows to prevent "electron.app" in notifications
  if (process.platform === 'win32') {
    app.setAppUserModelId(app.name);
    logger.info(MODULE_NAME, `AppUserModelID set to: ${app.name}`);
  }

  // --- Initialize Application ---
  // The initialize function now sets up all app event listeners,
  // creates windows, tray, registers IPC handlers, etc.
  AppLifecycle.initialize();
  
  // Initialize navigation system
  initializeNavigationStateManager();
  initializeNavigationController();
  
  initializeDefinitions(SERVER_API_URL).catch(err => {
    logger.error(MODULE_NAME, 'Failed to initialize definitions on startup:', err);
  });
}

// --- Auto Updater Event Listeners ---
// Configure logging for electron-updater (optional but recommended)
// You can redirect this to your main logger if preferred
autoUpdater.logger = logger; // Use the existing logger module
// autoUpdater.logger.transports.file.level = 'info'; // Adjust level if needed via logger config

autoUpdater.on('update-available', (info) => {
  logger.info(MODULE_NAME, `Update available: ${info.version}`);
  const mainWindow = getMainWindow();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('update-available', {
      version: info.version,
      releaseDate: info.releaseDate,
      releaseNotes: info.releaseNotes
    });
  }
  // Don't auto-download - let user decide
});

autoUpdater.on('update-not-available', (info) => {
  logger.info(MODULE_NAME, `Update not available: ${info.version}`);
  const mainWindow = getMainWindow();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('update-not-available');
  }
});

autoUpdater.on('error', (err) => {
  logger.error(MODULE_NAME, `Error in auto-updater: ${err.message || err}`);
  const mainWindow = getMainWindow();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('update-error', err.message || err.toString());
  }
});

autoUpdater.on('download-progress', (progressObj) => {
  const log_message = `Update Download speed: ${Math.round(progressObj.bytesPerSecond / 1024)} KB/s - Downloaded ${progressObj.percent.toFixed(2)}% (${Math.round(progressObj.transferred / 1024)}/${Math.round(progressObj.total / 1024)} KB)`;
  logger.info(MODULE_NAME, log_message);
  const mainWindow = getMainWindow();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('update-download-progress', 
      progressObj.percent,
      progressObj.bytesPerSecond,
      progressObj.transferred,
      progressObj.total
    );
  }
});

autoUpdater.on('update-downloaded', (info) => {
  logger.info(MODULE_NAME, `Update downloaded: ${info.version}`);
  const mainWindow = getMainWindow();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('update-downloaded', {
      version: info.version,
      releaseDate: info.releaseDate,
      releaseNotes: info.releaseNotes
    });
  }
});

// --- Auto Update Check Interval ---
let lastNotificationTime = 0;
const NOTIFICATION_COOLDOWN = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

// Check for updates every 1 hour (3600000 milliseconds) to reduce update conflicts
setInterval(() => {
  logger.info(MODULE_NAME, 'Checking for updates...');
  const mainWindow = getMainWindow();
  
  // Only show notification if 24 hours have passed since last notification
  const now = Date.now();
  const shouldShowNotification = (now - lastNotificationTime) >= NOTIFICATION_COOLDOWN;
  
  if (mainWindow && !mainWindow.isDestroyed() && shouldShowNotification) {
    mainWindow.webContents.send('update-checking');
    lastNotificationTime = now;
    
    // Auto-hide notification after 5 seconds
    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('update-checking-timeout');
      }
    }, 5000);
  }
  
  // Always check for updates in background
  autoUpdater.checkForUpdates();
}, 3600000); // 1 hour = 3600000 milliseconds
