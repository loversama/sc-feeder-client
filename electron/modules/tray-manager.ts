import { app, Menu, Tray, nativeImage } from 'electron';
import path from 'node:path';
import fsSync from 'node:fs';
import { fileURLToPath } from 'node:url'; // Added for ESM __dirname
import { createMainWindow, createSettingsWindow, getMainWindow } from './window-manager';
import { setIsQuitting } from './app-lifecycle';
import * as logger from './logger'; // Import the logger utility

const MODULE_NAME = 'TrayManager'; // Define module name for logger

// Define __dirname for ES module scope
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- Module State ---

let tray: Tray | null = null;

// --- Constants ---

// VITE_PUBLIC should be available via window-manager or set globally
const VITE_PUBLIC = process.env.VITE_PUBLIC || path.join(process.env.APP_ROOT || path.join(__dirname, '..', '..'), 'public');

// --- Functions ---

function getIconPath(): string {
    // Use existing electron-vite.svg or fallback to a png/ico if SVG is not supported
    let iconPath = path.join(VITE_PUBLIC, 'electron-vite.svg');

    // Check if the file exists, if not use the other icon in public
    try {
        fsSync.accessSync(iconPath);
    } catch (err) {
        // Fallback to vite.svg which should exist
        iconPath = path.join(VITE_PUBLIC, 'vite.svg');
        logger.info(MODULE_NAME, `Using fallback icon: ${iconPath}`);
        // Final check for fallback
        try {
            fsSync.accessSync(iconPath);
        } catch (fallbackErr) {
             logger.error(MODULE_NAME, `Fallback icon vite.svg not found either at ${iconPath}. Tray may lack an icon.`);
             // Return an empty string or handle error appropriately
             return ''; // Indicate no icon found
        }
    }
    return iconPath;
}

export function createTrayMenu() {
    const iconPath = getIconPath();
    if (!iconPath) {
        logger.error(MODULE_NAME, "Cannot create tray: Icon file not found.");
        // Optionally create a tray without an icon as a last resort
        try {
            tray = new Tray(nativeImage.createEmpty());
            logger.warn(MODULE_NAME, "Created tray with empty icon as fallback.");
        } catch (err: any) {
             logger.error(MODULE_NAME, `Failed to create tray even with empty icon: ${err.message}`);
             return; // Exit if tray creation fails completely
        }
    } else {
        try {
            tray = new Tray(iconPath);
        } catch (err: any) {
            logger.error(MODULE_NAME, `Failed to create tray icon with path ${iconPath}: ${err.message}`);
            // Fallback to empty icon
            try {
                 tray = new Tray(nativeImage.createEmpty());
                 logger.warn(MODULE_NAME, "Created tray with empty icon due to error with specific icon file.");
            } catch (fallbackErr: any) {
                 logger.error(MODULE_NAME, `Failed to create tray even with empty icon after primary icon error: ${fallbackErr.message}`);
                 return; // Exit if tray creation fails completely
            }
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
        {
            label: 'Debug',
            click: () => {
                 let win = getMainWindow();
                 if (!win) {
                     win = createMainWindow(); // Create if doesn't exist
                 }
                 // Ensure window is shown before sending message
                 win.show();
                 // Send message after a short delay to ensure renderer is ready
                 setTimeout(() => win?.webContents.send('change-page', 'debug'), 100);
            }
        },
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

    logger.success(MODULE_NAME, "System tray icon created successfully.");
}

export function destroyTray() {
    if (tray && !tray.isDestroyed()) {
        tray.destroy();
        logger.info(MODULE_NAME, "System tray icon destroyed.");
    }
    tray = null;
}