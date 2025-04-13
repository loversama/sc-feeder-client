import { app, Menu, Tray, nativeImage } from 'electron';
import path from 'node:path';
import fsSync from 'node:fs';
import { fileURLToPath } from 'node:url'; // Added for ESM __dirname
// Import getIconPath along with other window functions
import { createMainWindow, createSettingsWindow, getMainWindow, getIconPath } from './window-manager';
import { setIsQuitting } from './app-lifecycle';
import * as logger from './logger'; // Import the logger utility

const MODULE_NAME = 'TrayManager'; // Define module name for logger

// Define __dirname for ES module scope
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- Module State ---

let tray: Tray | null = null;

// --- Constants ---

// VITE_PUBLIC is set in window-manager.ts and stored in process.env
// We will read it directly in getIconPath

// --- Functions ---

// REMOVED: getPublicPath function is no longer needed.
// Path logic is now directly within createTrayMenu using resourcesPath.

export function createTrayMenu() {
    // Get the icon path using the centralized function from window-manager
    const iconPath = getIconPath(); // This function now handles dev/prod paths

    // Attempt to create NativeImage first
    let image: Electron.NativeImage | null = null;
    if (iconPath) {
        try {
            logger.info(MODULE_NAME, `Attempting to create NativeImage from: ${iconPath}`);
            image = nativeImage.createFromPath(iconPath);
            if (image.isEmpty()) {
                logger.error(MODULE_NAME, `NativeImage created from ${iconPath} is empty.`);
                image = null; // Treat as failure
            } else {
                 logger.info(MODULE_NAME, `Successfully created NativeImage from: ${iconPath}`);
            }
        } catch (imgErr: any) {
            logger.error(MODULE_NAME, `Error creating NativeImage from path "${iconPath}": ${imgErr.message}`);
            image = null; // Treat as failure
        }
    } else {
         logger.warn(MODULE_NAME, "No valid icon path found to create NativeImage.");
    }

    // Create Tray with image or fallback to empty
    try {
        if (image) {
            logger.info(MODULE_NAME, "Attempting to create tray with NativeImage.");
            tray = new Tray(image);
            logger.info(MODULE_NAME, "Successfully created tray with NativeImage.");
        } else {
            logger.warn(MODULE_NAME, "NativeImage is invalid or was not created. Creating empty tray.");
            tray = new Tray(nativeImage.createEmpty());
            logger.info(MODULE_NAME, "Successfully created empty tray.");
        }
    } catch (trayErr: any) {
        // Catch errors from new Tray() constructor itself
        logger.error(MODULE_NAME, `Error during new Tray() constructor: ${trayErr.message}. Falling back to final empty tray attempt.`);
        try {
            tray = new Tray(nativeImage.createEmpty());
            logger.warn(MODULE_NAME, "Successfully created empty tray as final fallback.");
        } catch (fallbackErr: any) {
            logger.error(MODULE_NAME, `FATAL: Failed to create tray even with empty icon as final fallback: ${fallbackErr.message}`);
            return;
        }
    }


    const contextMenu = Menu.buildFromTemplate([
        {
            label: 'Open SC Kill Feed',
            click: () => {
                const win = getMainWindow();
                if (win) {
                    win.show();
                } else {
                    createMainWindow(); // Recreate if closed
                }
            }
        },
        { type: 'separator' },
        {
            label: 'Kill Feed',
            click: () => {
                let win = getMainWindow();
                if (!win) {
                    win = createMainWindow(); // Create if doesn't exist
                }
                // Ensure window is shown before sending message
                win.show();
                // Send message after a short delay to ensure renderer is ready
                setTimeout(() => win?.webContents.send('change-page', 'kill-feed'), 100);
            }
        },
        // { // Removed Debug option from tray menu
        //     label: 'Debug',
        //     click: () => {
        //          let win = getMainWindow();
        //          if (!win) {
        //              win = createMainWindow(); // Create if doesn't exist
        //          }
        //          // Ensure window is shown before sending message
        //          win.show();
        //          // Send message after a short delay to ensure renderer is ready
        //          setTimeout(() => win?.webContents.send('change-page', 'debug'), 100);
        //     }
        // },
        {
            label: 'Settings',
            click: () => {
                createSettingsWindow(); // Open/focus the dedicated settings window
            }
        },
        { type: 'separator' },
        {
            label: 'Quit',
            click: () => {
                logger.info(MODULE_NAME, "Quit clicked.");
                setIsQuitting(true); // Set the flag in app-lifecycle
                app.quit();
            }
        }
    ]);

    // Configure the tray only if it was successfully created
    if (tray) {
        tray.setToolTip('SC Kill Feed');
        tray.setContextMenu(contextMenu);

        // Single click on tray icon shows the app
        tray.on('click', () => {
            const win = getMainWindow();
            if (win) {
                if (win.isVisible() && !win.isMinimized()) {
                     win.focus(); // Focus if visible and not minimized
                } else {
                     win.show(); // Show if hidden or minimized
                }
            } else {
                createMainWindow(); // Recreate if closed
            }
        });

        // Log success only if tray was configured
        logger.success(MODULE_NAME, "System tray icon created and configured successfully.");
    } else {
        // Log failure if tray is still null after all attempts
        logger.error(MODULE_NAME, "Tray icon could not be created after all attempts.");
    }
}

export function destroyTray() {
    if (tray && !tray.isDestroyed()) {
        tray.destroy();
        logger.info(MODULE_NAME, "System tray icon destroyed.");
    }
    tray = null;
}