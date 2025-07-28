import { app, Menu, Tray, nativeImage } from 'electron'; // Removed ipcMain import
import path from 'node:path';
import fsSync from 'node:fs';
import { fileURLToPath } from 'node:url';
// Import necessary window functions, including createWebContentWindow
import { createMainWindow, createSettingsWindow, getMainWindow, getIconPath, createWebContentWindow, createLoginWindow } from './window-manager';
import { setIsQuitting } from './app-lifecycle';
import { hasActiveAuthSession, getAuthStatus } from './auth-manager';
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

    // Build tray menu based on authentication state
    const contextMenu = buildTrayMenuTemplate();

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

// Helper function to create SVG icon from Element Plus icon style
function createSVGIcon(iconType: string): Electron.NativeImage | undefined {
    try {
        let svgContent = '';
        
        switch (iconType) {
            case 'kill-feed':
                // Monitor icon (similar to Element Plus Monitor)
                svgContent = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <rect x="2" y="4" width="20" height="12" rx="2" stroke="currentColor" stroke-width="2" fill="none"/>
                    <rect x="8" y="18" width="8" height="2" rx="1" fill="currentColor"/>
                    <line x1="6" y1="20" x2="18" y2="20" stroke="currentColor" stroke-width="2"/>
                </svg>`;
                break;
            case 'profile':
                // User icon (similar to Element Plus User)
                svgContent = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <circle cx="12" cy="8" r="4" stroke="currentColor" stroke-width="2" fill="none"/>
                    <path d="M6 20c0-4 2.7-6 6-6s6 2 6 6" stroke="currentColor" stroke-width="2" fill="none"/>
                </svg>`;
                break;
            case 'leaderboard':
                // Tickets icon (similar to Element Plus Tickets)
                svgContent = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <rect x="3" y="6" width="18" height="12" rx="2" stroke="currentColor" stroke-width="2" fill="none"/>
                    <path d="M7 6V4a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v2" stroke="currentColor" stroke-width="2" fill="none"/>
                    <line x1="7" y1="11" x2="17" y2="11" stroke="currentColor" stroke-width="1.5"/>
                    <line x1="7" y1="14" x2="13" y2="14" stroke="currentColor" stroke-width="1.5"/>
                </svg>`;
                break;
            case 'map':
                // MapLocation icon (similar to Element Plus MapLocation)
                svgContent = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M12 2C8.1 2 5 5.1 5 9c0 5.3 7 13 7 13s7-7.7 7-13c0-3.9-3.1-7-7-7z" stroke="currentColor" stroke-width="2" fill="none"/>
                    <circle cx="12" cy="9" r="2" stroke="currentColor" stroke-width="2" fill="none"/>
                </svg>`;
                break;
            case 'events':
                // Calendar/Clock icon for events
                svgContent = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <rect x="3" y="4" width="18" height="16" rx="2" stroke="currentColor" stroke-width="2" fill="none"/>
                    <line x1="16" y1="2" x2="16" y2="6" stroke="currentColor" stroke-width="2"/>
                    <line x1="8" y1="2" x2="8" y2="6" stroke="currentColor" stroke-width="2"/>
                    <line x1="3" y1="10" x2="21" y2="10" stroke="currentColor" stroke-width="2"/>
                    <circle cx="12" cy="15" r="2" fill="currentColor"/>
                </svg>`;
                break;
            case 'stats':
                // Chart/Statistics icon
                svgContent = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <rect x="3" y="12" width="4" height="8" fill="currentColor"/>
                    <rect x="10" y="8" width="4" height="12" fill="currentColor"/>
                    <rect x="17" y="4" width="4" height="16" fill="currentColor"/>
                </svg>`;
                break;
            case 'login':
                // Key icon (similar to Element Plus Key)
                svgContent = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="2" fill="none"/>
                    <path d="M14 14l6 6" stroke="currentColor" stroke-width="2"/>
                    <path d="M18 18l2 2" stroke="currentColor" stroke-width="2"/>
                    <path d="M20 16l2 2" stroke="currentColor" stroke-width="2"/>
                </svg>`;
                break;
            case 'quit':
                // X/Close icon for quit
                svgContent = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <line x1="18" y1="6" x2="6" y2="18" stroke="currentColor" stroke-width="2"/>
                    <line x1="6" y1="6" x2="18" y2="18" stroke="currentColor" stroke-width="2"/>
                </svg>`;
                break;
            default:
                return undefined;
        }

        // Convert SVG to buffer and create nativeImage
        const svgBuffer = Buffer.from(svgContent);
        return nativeImage.createFromBuffer(svgBuffer);
    } catch (error) {
        logger.warn(MODULE_NAME, `Failed to create SVG icon for ${iconType}:`, error);
        return undefined;
    }
}

// Helper function to build tray menu template based on authentication state
function buildTrayMenuTemplate() {
    const authStatus = getAuthStatus();
    const isAuthenticated = hasActiveAuthSession();
    
    logger.info(MODULE_NAME, `Building tray menu for auth state: ${isAuthenticated ? 'authenticated' : 'guest'}`);

    const menuItems = [
        {
            label: 'Kill Feed',
            icon: createSVGIcon('kill-feed'),
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
            label: 'Profile',
            icon: createSVGIcon('profile'),
            click: () => {
                logger.info(MODULE_NAME, 'Tray: Profile clicked.');
                navigateWebContentWindow('profile');
            }
        },
        {
            label: 'Leaderboard',
            icon: createSVGIcon('leaderboard'),
            click: () => {
                logger.info(MODULE_NAME, 'Tray: Leaderboard clicked.');
                navigateWebContentWindow('leaderboard');
            }
        },
        {
            label: 'Map',
            icon: createSVGIcon('map'),
            click: () => {
                logger.info(MODULE_NAME, 'Tray: Map clicked.');
                navigateWebContentWindow('map');
            }
        },
        {
            label: 'Events',
            icon: createSVGIcon('events'),
            click: () => {
                logger.info(MODULE_NAME, 'Tray: Events clicked.');
                navigateWebContentWindow('events');
            }
        },
        {
            label: 'Stats',
            icon: createSVGIcon('stats'),
            click: () => {
                logger.info(MODULE_NAME, 'Tray: Stats clicked.');
                navigateWebContentWindow('stats');
            }
        },
        { type: 'separator' },
    ];

    // Add Login option if not authenticated
    if (!isAuthenticated) {
        menuItems.push({
            label: 'Login',
            icon: createSVGIcon('login'),
            click: () => {
                logger.info(MODULE_NAME, 'Tray: Login clicked.');
                createLoginWindow();
            }
        });
        menuItems.push({ type: 'separator' });
    }

    // Add Quit option
    menuItems.push({
        label: 'Quit',
        icon: createSVGIcon('quit'),
        click: () => {
            logger.info(MODULE_NAME, "Quit clicked.");
            setIsQuitting(true);
            app.quit();
        }
    });

    return Menu.buildFromTemplate(menuItems as Electron.MenuItemConstructorOptions[]);
}

// Function to update tray menu when authentication state changes
export function updateTrayMenu() {
    if (tray && !tray.isDestroyed()) {
        const contextMenu = buildTrayMenuTemplate();
        tray.setContextMenu(contextMenu);
        logger.info(MODULE_NAME, "Tray menu updated based on authentication state.");
    }
}

export function destroyTray() {
    if (tray && !tray.isDestroyed()) {
        tray.destroy();
        logger.info(MODULE_NAME, "System tray icon destroyed.");
    }
    tray = null;
}