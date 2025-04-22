import { app, Menu, Tray, nativeImage } from 'electron'; // Removed ipcMain import
import path from 'node:path';
import fsSync from 'node:fs';
import { fileURLToPath } from 'node:url';
// Import necessary window functions, including createWebContentWindow
import { createMainWindow, createSettingsWindow, getMainWindow, getIconPath, createWebContentWindow } from './window-manager';
import { setIsQuitting } from './app-lifecycle';
import * as logger from './logger';

const MODULE_NAME = 'TrayManager';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let tray: Tray | null = null;

// Helper function to open/focus the web content window and navigate to a specific tab
function navigateWebContentWindow(tabName: string) {
    logger.info(MODULE_NAME, `Tray: Attempting to open/navigate web content window to: ${tabName}`);
    const webWindow = createWebContentWindow(); // This handles creation or focusing

    if (webWindow) {
        const navigate = () => {
            logger.info(MODULE_NAME, `Navigating web content window to hash: /${tabName}`);
            const currentURL = webWindow.webContents.getURL();
            const baseURL = currentURL.split('#')[0]; // Get URL before any existing hash
            // Ensure the base URL ends with .html before appending the hash
            const finalBaseURL = baseURL.endsWith('.html') ? baseURL : (baseURL.endsWith('/') ? baseURL + 'web-content.html' : baseURL + '/web-content.html');
            webWindow.loadURL(`${finalBaseURL}#/${tabName}`); // Use hash navigation
        };

        // Ensure the window is ready before navigating
        if (webWindow.webContents.isLoading()) {
            webWindow.webContents.once('did-finish-load', navigate);
        } else {
            navigate();
        }

        // Ensure window is visible and focused
        if (webWindow.isMinimized()) webWindow.restore();
        webWindow.focus();
    } else {
        logger.error(MODULE_NAME, `Failed to create or find web content window for navigation to ${tabName}.`);
    }
}


export function createTrayMenu() {
    const iconPath = getIconPath();

    try {
        if (iconPath && fsSync.existsSync(iconPath)) {
            logger.info(MODULE_NAME, `Attempting to create tray directly with path: ${iconPath}`);
            tray = new Tray(iconPath);
            logger.info(MODULE_NAME, "Successfully created tray with path.");
        } else {
            logger.warn(MODULE_NAME, `Icon path "${iconPath}" is invalid or file does not exist. Creating empty tray.`);
            tray = new Tray(nativeImage.createEmpty());
            logger.info(MODULE_NAME, "Successfully created empty tray as fallback.");
        }
    } catch (trayErr: any) {
        logger.error(MODULE_NAME, `Error creating tray (even with path/fallback): ${trayErr.message}. Final attempt with empty.`);
        try {
             tray = new Tray(nativeImage.createEmpty());
             logger.warn(MODULE_NAME, "Successfully created empty tray as final fallback.");
        } catch (finalErr: any) {
             logger.error(MODULE_NAME, `FATAL: Failed to create tray even with empty icon as final fallback: ${finalErr.message}`);
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
                    createMainWindow();
                }
            }
        },
        { type: 'separator' },
        {
            label: 'Kill Feed',
            click: () => {
                let win = getMainWindow();
                if (!win) {
                    win = createMainWindow();
                }
                win.show();
                setTimeout(() => win?.webContents.send('change-page', 'kill-feed'), 100);
            }
        },
        { type: 'separator' },
        {
          label: 'My Profile',
          click: () => {
            logger.info(MODULE_NAME, 'Tray: My Profile clicked.');
            navigateWebContentWindow('profile'); // Use helper function
          }
        },
        {
          label: 'Leaderboard',
          click: () => {
            logger.info(MODULE_NAME, 'Tray: Leaderboard clicked.');
            navigateWebContentWindow('leaderboard'); // Use helper function
          }
        },
        { type: 'separator' },
        {
            label: 'Settings',
            click: () => {
                createSettingsWindow();
            }
        },
        { type: 'separator' },
        {
            label: 'Quit',
            click: () => {
                logger.info(MODULE_NAME, "Quit clicked.");
                setIsQuitting(true);
                app.quit();
            }
        }
    ]);

    if (tray) {
        tray.setToolTip('SC Kill Feed');
        tray.setContextMenu(contextMenu);

        tray.on('click', () => {
            const win = getMainWindow();
            if (win) {
                if (win.isVisible() && !win.isMinimized()) {
                     win.focus();
                } else {
                     win.show();
                }
            } else {
                createMainWindow();
            }
        });

        logger.success(MODULE_NAME, "System tray icon created and configured successfully.");
    } else {
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