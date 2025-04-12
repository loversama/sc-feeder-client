import { BrowserWindow, shell, app, screen, Rectangle } from 'electron'; // Import screen and Rectangle
import path from 'node:path';
import url from 'node:url'; // Import the url module
import fsSync from 'node:fs';
import { fileURLToPath } from 'node:url'; // Added for ESM __dirname
import Store from 'electron-store'; // Import electron-store
import { isQuitting } from './app-lifecycle'; // Import the flag
import { KillEvent } from '../../shared/types';
import * as logger from './logger'; // Import the logger utility

const MODULE_NAME = 'WindowManager'; // Define module name for logger

// Define __dirname for ES module scope
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- Module State ---

let mainWindow: BrowserWindow | null = null;
let settingsWindow: BrowserWindow | null = null;
// Store data for the event details window temporarily
let activeEventDataForWindow: KillEvent | null = null;

// electron-store setup for window state
const store = new Store<{ windowBounds?: Rectangle }>({
    defaults: {
        windowBounds: undefined // Initialize with no default bounds
    }
});

// Debounce helper function
function debounce<F extends (...args: any[]) => any>(func: F, waitFor: number) {
    let timeoutId: NodeJS.Timeout | null = null;
    return (...args: Parameters<F>): void => {
        if (timeoutId) {
            clearTimeout(timeoutId);
        }
        timeoutId = setTimeout(() => {
            func(...args);
            timeoutId = null; // Clear timeoutId after execution
        }, waitFor);
    };
}
// --- Constants and Environment Variables ---
// Moved from main.ts - needed for loading URLs/files

// Ensure APP_ROOT is set (consider moving this to a central init point if needed elsewhere)
process.env.APP_ROOT = process.env.APP_ROOT || path.join(__dirname, '..', '..'); // Adjust path relative to modules dir

export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL'];
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron');
// RENDERER_DIST is no longer needed, paths will be calculated relative to app.getAppPath() when packaged.
process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, 'public') : path.join(process.env.APP_ROOT, 'dist'); // Adjust VITE_PUBLIC calculation

// --- Helper Functions ---

function getPreloadPath(filename: string = 'preload.mjs'): string {
    let preloadPath: string | undefined;
    const possiblePaths = [
        path.join(__dirname, '..', filename), // Relative to modules dir -> electron dir
        path.join(MAIN_DIST, filename), // Production path
        path.join(process.env.APP_ROOT || '', 'dist-electron', filename) // Alternative production path
    ];

    if (app.isPackaged) {
        preloadPath = possiblePaths[1]; // Use MAIN_DIST first in production
        if (!fsSync.existsSync(preloadPath)) {
            preloadPath = possiblePaths[2]; // Fallback
        }
    } else {
        // Development: Check common locations
        preloadPath = possiblePaths[0]; // Check relative path first
        if (!fsSync.existsSync(preloadPath)) {
            preloadPath = possiblePaths[2]; // Fallback to dist-electron (might exist during dev build)
        }
    }

    // Final fallback if still not found
    if (!preloadPath || !fsSync.existsSync(preloadPath)) {
        logger.warn(MODULE_NAME, `Preload script '${filename}' not found at expected locations. Using default path: ${possiblePaths[1]}`);
        preloadPath = possiblePaths[1]; // Default to MAIN_DIST path
    }

    logger.info(MODULE_NAME, `Resolved preload path for ${filename}: ${preloadPath}`);
    return preloadPath;
}


// --- Window Creation Functions ---

export function createMainWindow(onFinishLoad?: () => void): BrowserWindow {
    if (mainWindow) {
        mainWindow.focus();
        return mainWindow;
    }

    // --- Window Bounds Calculation and Persistence ---
    const defaultWidth = 600; // Thinner width
    const primaryDisplay = screen.getPrimaryDisplay();
    const { height: screenHeight } = primaryDisplay.workAreaSize;
    const defaultHeight = Math.floor(screenHeight * 0.9); // 90% of screen height

    // Get saved bounds or use defaults
    const savedBounds = store.get('windowBounds');

    // Define base window options
    const windowOptions: Electron.BrowserWindowConstructorOptions = {
        icon: path.join(process.env.VITE_PUBLIC || '', 'electron-vite.svg'),
        title: 'SC Kill Feed',
        width: defaultWidth,
        height: defaultHeight,
        x: undefined, // Default position (centered)
        y: undefined,
        webPreferences: {
            preload: getPreloadPath(),
            nodeIntegration: false,
            contextIsolation: true,
            devTools: !app.isPackaged, // Enable DevTools only in development
            spellcheck: false
        },
        frame: false, // Make the window frameless
        autoHideMenuBar: true,
        useContentSize: true,
        backgroundColor: '#222',
        show: false, // Show when ready-to-show fires
        minWidth: 400, // Set a reasonable minimum width
        minHeight: 600 // Set a reasonable minimum height
    };

    // Apply saved bounds if they exist and are valid
    if (savedBounds) {
        // Basic validation: Ensure the window is at least partially visible
        const displays = screen.getAllDisplays();
        const isVisible = displays.some(display => {
            const displayBounds = display.workArea;
            // Check for overlap
            return (
                savedBounds.x < displayBounds.x + displayBounds.width &&
                savedBounds.x + savedBounds.width > displayBounds.x &&
                savedBounds.y < displayBounds.y + displayBounds.height &&
                savedBounds.y + savedBounds.height > displayBounds.y
            );
        });

        if (isVisible) {
            logger.info(MODULE_NAME, 'Applying saved window bounds:', savedBounds);
            windowOptions.x = savedBounds.x;
            windowOptions.y = savedBounds.y;
            windowOptions.width = savedBounds.width;
            windowOptions.height = savedBounds.height;
        } else {
            logger.warn(MODULE_NAME, 'Saved window bounds are outside visible screen area. Using defaults.');
            store.delete('windowBounds'); // Clear invalid bounds
        }
    } else {
         logger.info(MODULE_NAME, `No saved bounds found. Using default size: ${defaultWidth}x${defaultHeight}`);
    }

    // Create the window with calculated/saved options
    mainWindow = new BrowserWindow(windowOptions);

    mainWindow.setTitle('SC Kill Feed');
    mainWindow.setMenu(null);

    // Open DevTools automatically in development (but not in CI)
    if (!app.isPackaged && !process.env.CI) {
        mainWindow.webContents.openDevTools();
    }

    mainWindow.on('ready-to-show', () => {
        mainWindow?.show();
        // Optional: Insert CSS to ensure no margin/padding
        mainWindow?.webContents.insertCSS(`
          html, body { margin: 0; padding: 0; overflow: hidden; width: 100%; height: 100%; }
        `).catch(err => logger.error(MODULE_NAME, "Failed to insert CSS:", err));
    });

    mainWindow.webContents.on('did-finish-load', () => {
        mainWindow?.webContents.send('main-process-message', `Main window loaded at ${(new Date).toLocaleString()}`);
        onFinishLoad?.(); // Callback after load finishes
    });

    // Load URL or File
    if (VITE_DEV_SERVER_URL) {
        logger.info(MODULE_NAME, `Loading main window from dev server: ${VITE_DEV_SERVER_URL}`);
        mainWindow.loadURL(VITE_DEV_SERVER_URL)
            .catch(err => logger.error(MODULE_NAME, 'Failed to load main window from dev server:', err));
    } else {
        // Production: Load file using url.format relative to __dirname
        // Inside ASAR, __dirname points to the app.asar root. The 'dist' folder is at the same level.
        const productionIndexUrl = url.format({
            pathname: path.join(__dirname, '..', '..', 'dist', 'index.html'), // Correct path relative to modules dir -> app.asar/dist/index.html
            protocol: 'file:',
            slashes: true
        });
        logger.info(MODULE_NAME, `Loading main window from URL: ${productionIndexUrl}`);
        mainWindow.loadURL(productionIndexUrl)
            .catch(err => {
                logger.error(MODULE_NAME, `Failed to load index.html from ${productionIndexUrl}:`, err);
                // Display a more informative error within the window if loading fails
                if (mainWindow) { // Add null check
                    mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`<h1>Error</h1><p>Could not load application content from ${productionIndexUrl}. Please check application integrity and logs.</p><p>${err}</p>`)}`);
                }
            });
    }

    // Handle external links
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        if (url.startsWith('http:') || url.startsWith('https:')) {
            logger.info(MODULE_NAME, `Opening external link from main window: ${url}`);
            shell.openExternal(url);
            return { action: 'deny' };
        }
        return { action: 'deny' };
    });

    // Handle close event: Hide window instead of quitting unless isQuitting is true
    mainWindow.on('close', (event) => {
        if (!isQuitting) {
            logger.info(MODULE_NAME, "Main window close intercepted: Hiding window.");
            event.preventDefault(); // Prevent the window from actually closing
            mainWindow?.hide();     // Hide the window instead
        } else {
            logger.info(MODULE_NAME, "Main window close allowed during quit sequence.");
            // Allow the window to close normally if the app is quitting
        }
    });

    mainWindow.on('closed', () => {
        mainWindow = null; // Dereference
    });

    // --- Save Window Bounds on Resize/Move ---
    const saveBounds = debounce(() => {
        if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isMinimized()) {
            const bounds = mainWindow.getBounds();
            logger.debug(MODULE_NAME, 'Saving window bounds:', bounds);
            store.set('windowBounds', bounds);
        }
    }, 500); // Debounce saving by 500ms

    mainWindow.on('resize', saveBounds);
    mainWindow.on('move', saveBounds);

    return mainWindow;
}

export function createSettingsWindow(): BrowserWindow | null {
    if (settingsWindow) {
        settingsWindow.focus();
        return settingsWindow;
    }

    // Ensure main window exists before setting parent (optional)
    // if (!mainWindow) {
    //   console.error("[WindowManager] Cannot create settings window: Main window does not exist.");
    //   return null;
    // }

    settingsWindow = new BrowserWindow({
        width: 800,
        height: 650,
        title: 'SC KillFeeder - Settings',
        // parent: mainWindow, // Optional: Make it a child of the main window
        modal: false, // Set to true if it should block interaction with the main window
        webPreferences: {
            preload: getPreloadPath(), // Reuse preload script
            nodeIntegration: false,
            contextIsolation: true,
            devTools: !app.isPackaged, // Enable DevTools only in development
            spellcheck: false
        },
        autoHideMenuBar: true,
        show: false, // Show when ready
        icon: path.join(process.env.VITE_PUBLIC || '', 'electron-vite.svg') // Use app icon
    });

    settingsWindow.setMenu(null); // No menu bar

    // Load settings content
    if (VITE_DEV_SERVER_URL) {
        const settingsUrl = `${VITE_DEV_SERVER_URL}/settings.html`;
        logger.info(MODULE_NAME, `Loading settings window from dev server: ${settingsUrl}`);
        settingsWindow.loadURL(settingsUrl)
            .catch(err => logger.error(MODULE_NAME, 'Failed to load settings.html from dev server:', err));
    } else {
        // Production: Load file using url.format relative to __dirname
        const productionSettingsUrl = url.format({
            pathname: path.join(__dirname, '..', '..', 'dist', 'settings.html'),
            protocol: 'file:',
            slashes: true
        });
        logger.info(MODULE_NAME, `Loading settings window from URL: ${productionSettingsUrl}`);
        settingsWindow.loadURL(productionSettingsUrl)
            .catch(err => {
                logger.error(MODULE_NAME, `Failed to load settings.html from ${productionSettingsUrl}:`, err);
                if (settingsWindow) { // Add null check
                    settingsWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`<h1>Error</h1><p>Could not load settings page from ${productionSettingsUrl}.</p><p>${err}</p>`)}`);
                }
            });
    }

    settingsWindow.once('ready-to-show', () => {
        settingsWindow?.show();
        if (!app.isPackaged) {
            settingsWindow?.webContents.openDevTools(); // Open dev tools for settings in dev
        }
    });

    settingsWindow.on('closed', () => {
        settingsWindow = null; // Dereference the window object
    });

    // Handle external links in settings window
    settingsWindow.webContents.setWindowOpenHandler(({ url }) => {
        if (url.startsWith('http:') || url.startsWith('https:')) {
            logger.info(MODULE_NAME, `Opening external link from settings window: ${url}`);
            shell.openExternal(url);
            return { action: 'deny' };
        }
        return { action: 'deny' };
    });

    return settingsWindow;
}


export function createEventDetailsWindow(eventData: KillEvent, currentUsername: string | null): BrowserWindow | null {
     logger.info(MODULE_NAME, 'Request received to create event details window for event:', eventData?.id);

     // Add current player information to the event data before storing
     const enhancedEventData = {
       ...eventData,
       playerName: currentUsername || '' // Add current player name for "YOU" badge
     };
     activeEventDataForWindow = enhancedEventData; // Store temporarily

     const detailsWindow = new BrowserWindow({
       width: 1260,
       height: 940,
       webPreferences: {
         preload: getPreloadPath(), // Reuse preload
         nodeIntegration: false,
         contextIsolation: true,
         devTools: !app.isPackaged, // Enable DevTools only in development
         spellcheck: false
       },
       title: `Event Details - ${eventData.deathType} (${new Date(eventData.timestamp).toLocaleTimeString()})`,
       backgroundColor: '#1a1a1a',
       show: false,
       autoHideMenuBar: true,
       center: true,
       // alwaysOnTop: true // Avoid alwaysOnTop unless strictly necessary
     });

     detailsWindow.setMenu(null);

     // Intercept navigation requests and open external links
     detailsWindow.webContents.setWindowOpenHandler(({ url }) => {
       if (url.startsWith('http:') || url.startsWith('https:')) {
         logger.info(MODULE_NAME, `Opening external link from details window: ${url}`);
         shell.openExternal(url);
         return { action: 'deny' };
       }
       logger.warn(MODULE_NAME, `Denying window open request for non-external URL: ${url}`);
       return { action: 'deny' };
     });

     // Load event details content
     if (VITE_DEV_SERVER_URL) {
       const detailsUrl = `${VITE_DEV_SERVER_URL}/event-details.html`;
       logger.info(MODULE_NAME, `Loading event details window from dev server: ${detailsUrl}`);
       detailsWindow.loadURL(detailsUrl)
         .catch(err => logger.error(MODULE_NAME, 'Failed to load event-details.html from dev server:', err));
     } else {
       // Production: Load file using url.format relative to __dirname
       const productionDetailsUrl = url.format({
           pathname: path.join(__dirname, '..', '..', 'dist', 'event-details.html'),
           protocol: 'file:',
           slashes: true
       });
       logger.info(MODULE_NAME, `Loading event details window from URL: ${productionDetailsUrl}`);
       detailsWindow.loadURL(productionDetailsUrl)
           .catch(err => {
               logger.error(MODULE_NAME, `Failed to load event-details.html from ${productionDetailsUrl}:`, err);
               detailsWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`<h1>Error</h1><p>Could not load event details page from ${productionDetailsUrl}.</p><p>${err}</p>`)}`);
           });
     }

     detailsWindow.once('ready-to-show', () => {
       logger.info(MODULE_NAME, 'Event details window ready-to-show');
       detailsWindow.show();
       detailsWindow.focus();
       if (!app.isPackaged) {
           detailsWindow.webContents.openDevTools(); // Open dev tools in dev
       }
     });

     // Clear the stored data when the window is closed
     detailsWindow.on('closed', () => {
       // Check if the closed window was holding the currently active data
       if (activeEventDataForWindow?.id === eventData.id) {
         activeEventDataForWindow = null;
         logger.debug(MODULE_NAME, `Cleared activeEventDataForWindow for event ${eventData.id}`);
       }
     });

     return detailsWindow;
}

// --- Accessor Functions ---

export function getMainWindow(): BrowserWindow | null {
    return mainWindow;
}

export function getSettingsWindow(): BrowserWindow | null {
    return settingsWindow;
}

export function getActiveEventDataForWindow(): KillEvent | null {
    // This function is called by the IPC handler when the details window requests data
    const dataToReturn = activeEventDataForWindow;
    // Optionally clear it after retrieval if it's meant to be consumed once,
    // but keeping it allows refresh or reopening without passing again.
    // activeEventDataForWindow = null;
    logger.debug(MODULE_NAME, 'Providing activeEventDataForWindow:', dataToReturn?.id);
    return dataToReturn;
}

export function closeAllWindows() {
    BrowserWindow.getAllWindows().forEach(window => {
        // Check if it's one of our managed windows before closing forcefully
        if (window === mainWindow || window === settingsWindow /* add details window if needed */) {
             window.close();
        }
        // Or simply close all: window.close();
    });
    mainWindow = null;
    settingsWindow = null;
    activeEventDataForWindow = null;
}