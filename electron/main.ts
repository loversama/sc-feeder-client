import { app, dialog } from 'electron'; // Keep app and dialog from electron
import { autoUpdater } from 'electron-updater'; // Import autoUpdater specifically from electron-updater
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as AppLifecycle from './modules/app-lifecycle.ts'; // Added .ts
import { getMainWindow } from './modules/window-manager.ts'; // Import getMainWindow - Added .ts
import * as logger from './modules/logger'; // Import the logger utility
import { setupTitlebar } from "custom-electron-titlebar/main"; // Import for custom title bar
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
    // Someone tried to run a second instance, we should focus our window.
    const mainWindow = getMainWindow(); // Use the imported function
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  // Setup the titlebar main process
  setupTitlebar();

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
  dialog.showMessageBox({
    type: 'info',
    title: 'Update Available',
    message: `A new version (${info.version}) of SC Kill Feed is available. Do you want to download and install it now?`,
    buttons: ['Yes', 'No']
  }).then(({ response }) => {
    if (response === 0) { // User clicked 'Yes'
      logger.info(MODULE_NAME,'User agreed to download update.');
      autoUpdater.downloadUpdate();
    } else {
      logger.info(MODULE_NAME,'User declined update download.');
    }
  });
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
      // Example: mainWindow.webContents.send('update-download-progress', progressObj.percent);
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
