import { app, dialog } from 'electron'; // Keep app and dialog from electron
import { autoUpdater } from 'electron-updater'; // Import autoUpdater specifically from electron-updater
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as AppLifecycle from './modules/app-lifecycle.ts'; // Added .ts
import { getMainWindow } from './modules/window-manager.ts'; // Import getMainWindow - Added .ts
import * as logger from './modules/logger'; // Import the logger utility
import { setupTitlebar } from "custom-electron-titlebar/main"; // Import for custom title bar
import { URL } from 'node:url'; // Import URL for parsing deep links
import { SERVER_API_URL } from './modules/server-config.ts'; // Import API_BASE_URL
const MODULE_NAME = 'Main'; // Define module name for logger

// --- Basic Setup ---

// Set APP_ROOT environment variable early, as other modules might rely on it.
// Note: __dirname in ESM corresponds to the directory of the current file.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// process.env.APP_ROOT = path.join(__dirname, '..'); // REMOVED: Will be set later using app.getAppPath()

logger.info(MODULE_NAME, `Application starting... APP_ROOT will be set after app is ready.`);

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
          fetch(serverEndpoint)
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

  // Set AppUserModelID for Windows to prevent "electron.app" in notifications
  if (process.platform === 'win32') {
    app.setAppUserModelId(app.name);
    logger.info(MODULE_NAME, `AppUserModelID set to: ${app.name}`);
  }

  // --- Initialize Application ---
  // The initialize function now sets up all app event listeners,
  // creates windows, tray, registers IPC handlers, etc.
  AppLifecycle.initialize();
}

// --- Auto Updater Event Listeners ---
// Configure logging for electron-updater (optional but recommended)
// You can redirect this to your main logger if preferred
autoUpdater.logger = logger; // Use the existing logger module
// autoUpdater.logger.transports.file.level = 'info'; // Adjust level if needed via logger config

autoUpdater.on('update-available', (info) => {
  logger.info(MODULE_NAME, `Update available: ${info.version}`);
  autoUpdater.downloadUpdate();
});

autoUpdater.on('update-not-available', (info) => {
  logger.info(MODULE_NAME, `Update not available: ${info.version}`);
  // Optional: Silently log or notify user if needed
});

autoUpdater.on('error', (err) => {
  logger.error(MODULE_NAME, `Error in auto-updater: ${err.message || err}`);
  dialog.showErrorBox('Update Error', `Failed to check or download updates: ${err.message || err}`);
});

autoUpdater.on('download-progress', (progressObj) => {
  const log_message = `Update Download speed: ${Math.round(progressObj.bytesPerSecond / 1024)} KB/s - Downloaded ${progressObj.percent.toFixed(2)}% (${Math.round(progressObj.transferred / 1024)}/${Math.round(progressObj.total / 1024)} KB)`;
  logger.info(MODULE_NAME, log_message);
  // Optional: Send progress to renderer process to display in UI
  const mainWindow = getMainWindow();
  if (mainWindow) {
      // TODO: Implement download progress bar in renderer process
      // Example:
      // if (mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
      //   mainWindow.webContents.send('update-download-progress', progressObj.percent);
      // }
  }
});

autoUpdater.on('update-downloaded', (info) => {
  logger.info(MODULE_NAME, `Update downloaded: ${info.version}`);
  dialog.showMessageBox({
    type: 'info',
    title: 'Update Ready',
    message: `Version ${info.version} has been downloaded. Restart the application to apply the update.`,
    buttons: ['Restart Now', 'Later']
  }).then(({ response }) => {
    if (response === 0) { // User clicked 'Restart Now'
      logger.info(MODULE_NAME, 'User agreed to restart for update.');
      setImmediate(() => autoUpdater.quitAndInstall());
    } else {
      logger.info(MODULE_NAME, 'User chose to restart later.');
    }
  });
});

// --- Auto Update Check Interval ---
// Check for updates every 5 minutes (300000 milliseconds)
setInterval(() => {
logger.info(MODULE_NAME, 'Checking for updates...');
autoUpdater.checkForUpdates();
}, 300000);
