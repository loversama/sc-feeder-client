import { BrowserWindow, shell, app, screen, Rectangle } from 'electron'; // Import screen and Rectangle
import path from 'node:path';
import url from 'node:url'; // Import the url module
import fsSync from 'node:fs';
import { fileURLToPath } from 'node:url'; // Added for ESM __dirname
import Store from 'electron-store'; // Import electron-store
import { isQuitting } from './app-lifecycle'; // Import the flag
import { KillEvent } from '../../shared/types';
import * as logger from './logger'; // Import the logger utility
import { attachTitlebarToWindow } from "custom-electron-titlebar/main"; // Import for custom title bar
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
// Define the type for the store schema explicitly
type WindowStoreSchema = {
    windowBounds?: Rectangle;
    settingsWindowBounds?: Rectangle;
    eventDetailsWindowBounds?: Rectangle;
};

// electron-store setup for window state
const store = new Store<WindowStoreSchema>({
    defaults: {
        windowBounds: undefined,
        settingsWindowBounds: undefined,
        eventDetailsWindowBounds: undefined
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
// --- Helper Functions (Continued) ---

// Define the valid keys as a type
type WindowStoreKey = keyof WindowStoreSchema;

// Generic function to create a debounced bounds saver
function createSaveBoundsHandler(window: BrowserWindow, storeKey: WindowStoreKey) {
    return debounce(() => {
        if (window && !window.isDestroyed() && !window.isMinimized()) {
            const bounds = window.getBounds();
            // Use String() to ensure storeKey is treated as a string for logging
            logger.debug(MODULE_NAME, `Saving bounds for ${String(storeKey)}:`, bounds);
            // Explicitly cast storeKey to the correct type for store.set
            store.set(storeKey as WindowStoreKey, bounds);
        }
    }, 500); // Debounce saving by 500ms
}

// --- Constants and Environment Variables ---
// These are now set centrally in main.ts and accessed via process.env
// VITE_DEV_SERVER_URL, MAIN_DIST, VITE_PUBLIC, APP_ROOT

// We still might need to read them here for convenience
// REMOVED: VITE_DEV_SERVER_URL will be read directly from process.env inside functions
// export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL'];
// REMOVED: MAIN_DIST will be calculated dynamically inside getPreloadPath
// export const MAIN_DIST = path.join(process.env.APP_ROOT!, 'dist-electron');
// VITE_PUBLIC is read directly from process.env where needed (e.g., icon paths)

// --- Helper Functions ---

// Function to determine the correct path for application icons
export function getIconPath(): string {
    const isProd = app.isPackaged;
    const vitePublic = process.env.VITE_PUBLIC; // Set in app-lifecycle onReady
    const resourcesPath = process.resourcesPath;
    let iconPath = '';

    // Determine base path: app root in prod, VITE_PUBLIC in dev
    // app.getAppPath() usually points to the root of the packaged app (e.g., app.asar or unpacked dir)
    const appPath = app.getAppPath();
    const basePath = isProd ? appPath : vitePublic;
    logger.debug(MODULE_NAME, `Icon Path Check: isProd=${isProd}, basePath=${basePath}`);

    if (basePath && typeof basePath === 'string') {
        // Determine the platform-specific preferred icon filename
        const isWindows = process.platform === 'win32';
        const preferredIconFilename = isWindows ? 'electron-vite.ico' : 'electron-vite.svg';
        const iconFullPath = path.join(basePath, preferredIconFilename);

        logger.debug(MODULE_NAME, `Checking for platform preferred icon (${preferredIconFilename}) at: ${iconFullPath}`);
        try {
             if (fsSync.existsSync(iconFullPath)) {
                 iconPath = iconFullPath; // Use the preferred icon if it exists
             } else {
                  logger.error(MODULE_NAME, `Preferred icon (${preferredIconFilename}) not found at ${iconFullPath}.`);
                  // Optional: Could add a check for a generic fallback like 'icon.png' here if desired
             }
        } catch (err: any) {
             logger.error(MODULE_NAME, `Error checking icon path ${iconFullPath}: ${err.message}`);
        }
    } else {
        logger.error(MODULE_NAME, `Base path for icon is invalid or not a string: ${basePath}`);
    }

    if (iconPath) {
        logger.info(MODULE_NAME, `Using icon path: ${iconPath}`);
    } else {
        logger.warn(MODULE_NAME, "Could not find a valid icon path. Windows/Tray might lack an icon.");
        // Consider returning a default path or letting Electron handle the default if empty string is problematic
    }
    return iconPath; // Return found path or empty string
}

function getPreloadPath(filename: string = 'preload.mjs'): string {
    const appRoot = process.env.APP_ROOT;
    if (!appRoot) {
        logger.error(MODULE_NAME, "APP_ROOT not set when trying to get preload path. Cannot proceed.");
        // Return a dummy path or throw an error, as preload is critical
        return ''; // Or throw new Error("APP_ROOT not set");
    }

    // Calculate MAIN_DIST path dynamically here
    const mainDist = path.join(appRoot, 'dist-electron');
    logger.debug(MODULE_NAME, `Calculated mainDist for preload: ${mainDist}`);

    let preloadPath: string | undefined;
    const possiblePaths = [
        path.join(__dirname, '..', filename), // Relative to modules dir -> electron dir (Dev path)
        path.join(mainDist, filename),        // Production path using dynamically calculated mainDist
        path.join(appRoot, 'dist-electron', filename) // Alternative production path (redundant but safe fallback)
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

    // Get the application icon path
    const appIconPath = getIconPath();

    // Define base window options
    const windowOptions: Electron.BrowserWindowConstructorOptions = {
        icon: appIconPath || undefined, // Use found path or let Electron default
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
        titleBarStyle: 'hidden', // Add for custom title bar
        titleBarOverlay: false, // Add for custom title bar (Windows controls overlay)
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
    attachTitlebarToWindow(mainWindow); // Attach the custom title bar

    mainWindow.setTitle('SC Kill Feed');
    // mainWindow.setMenu(null); // Removed: Let custom-electron-titlebar handle menu visibility

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
    const devServerUrl = process.env['VITE_DEV_SERVER_URL']; // Read env var inside function
    if (devServerUrl) {
        logger.info(MODULE_NAME, `Loading main window from dev server: ${devServerUrl}`);
        mainWindow.loadURL(devServerUrl)
            .catch(err => logger.error(MODULE_NAME, 'Failed to load main window from dev server:', err));
    } else {
        // Production: Load file using url.format relative to __dirname
        // Inside ASAR, __dirname points to the app.asar root. The 'dist' folder is at the same level.
        const productionIndexUrl = url.format({
            pathname: path.join(__dirname, '..', 'dist', 'index.html'), // Path relative to dist-electron -> app.asar/dist/index.html
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
    const saveMainWindowBounds = createSaveBoundsHandler(mainWindow, 'windowBounds');
    mainWindow.on('resize', saveMainWindowBounds);
    mainWindow.on('move', saveMainWindowBounds);

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

    // --- Settings Window Bounds ---
    const savedSettingsBounds = store.get('settingsWindowBounds');
    const settingsWindowOptions: Electron.BrowserWindowConstructorOptions = {
        width: 800,
        height: 650,
        x: undefined,
        y: undefined,
        title: 'SC KillFeeder - Settings',
        modal: false,
        webPreferences: {
            preload: getPreloadPath(),
            nodeIntegration: false,
            contextIsolation: true,
            devTools: !app.isPackaged,
            spellcheck: false
        },
        frame: false,
        titleBarStyle: 'hidden',
        titleBarOverlay: true,
        autoHideMenuBar: true,
        show: false,
        icon: getIconPath() || undefined, // Use centralized function
        minWidth: 500, // Add reasonable min dimensions
        minHeight: 400
    };

    // Validate and apply saved bounds
    if (savedSettingsBounds) {
        const displays = screen.getAllDisplays();
        const isVisible = displays.some(display => {
            const displayBounds = display.workArea;
            return (
                savedSettingsBounds.x < displayBounds.x + displayBounds.width &&
                savedSettingsBounds.x + savedSettingsBounds.width > displayBounds.x &&
                savedSettingsBounds.y < displayBounds.y + displayBounds.height &&
                savedSettingsBounds.y + savedSettingsBounds.height > displayBounds.y
            );
        });

        if (isVisible) {
            logger.info(MODULE_NAME, 'Applying saved settings window bounds:', savedSettingsBounds);
            settingsWindowOptions.x = savedSettingsBounds.x;
            settingsWindowOptions.y = savedSettingsBounds.y;
            settingsWindowOptions.width = savedSettingsBounds.width;
            settingsWindowOptions.height = savedSettingsBounds.height;
        } else {
            logger.warn(MODULE_NAME, 'Saved settings window bounds are outside visible screen area. Using defaults.');
            store.delete('settingsWindowBounds'); // Clear invalid bounds
        }
    } else {
         logger.info(MODULE_NAME, `No saved settings bounds found. Using default size: ${settingsWindowOptions.width}x${settingsWindowOptions.height}`);
    }

    settingsWindow = new BrowserWindow(settingsWindowOptions);

    attachTitlebarToWindow(settingsWindow); // Attach the custom title bar
    // settingsWindow.setMenu(null); // Removed: Let custom-electron-titlebar handle menu visibility

    // Load settings content
    const devServerUrlForSettings = process.env['VITE_DEV_SERVER_URL']; // Read env var inside function
    if (devServerUrlForSettings) {
        const settingsUrl = `${devServerUrlForSettings}/settings.html`;
        logger.info(MODULE_NAME, `Loading settings window from dev server: ${settingsUrl}`);
        settingsWindow.loadURL(settingsUrl)
            .catch(err => logger.error(MODULE_NAME, 'Failed to load settings.html from dev server:', err));
    } else {
        // Production: Load file using url.format relative to __dirname
        const productionSettingsUrl = url.format({
            pathname: path.join(__dirname, '..', 'dist', 'settings.html'),
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

    // --- Save Settings Window Bounds ---
    const saveSettingsBounds = createSaveBoundsHandler(settingsWindow, 'settingsWindowBounds');
    settingsWindow.on('resize', saveSettingsBounds);
    settingsWindow.on('move', saveSettingsBounds);

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

     // --- Event Details Window Bounds ---
     const savedEventDetailsBounds = store.get('eventDetailsWindowBounds');
     const detailsWindowOptions: Electron.BrowserWindowConstructorOptions = {
       width: 1260,
       height: 940,
       x: undefined,
       y: undefined,
       webPreferences: {
         preload: getPreloadPath(),
         nodeIntegration: false,
         contextIsolation: true,
         devTools: true,
         spellcheck: false
       },
       frame: false,
       titleBarStyle: 'hidden',
       titleBarOverlay: true,
       title: `Event Details - ${eventData.deathType} (${new Date(eventData.timestamp).toLocaleTimeString()})`,
       backgroundColor: '#1a1a1a',
       show: false,
       autoHideMenuBar: true,
       minWidth: 800, // Add reasonable min dimensions
       minHeight: 600,
       icon: getIconPath() || undefined, // Use centralized function
       // center: true, // Position is now managed by saved bounds
       // alwaysOnTop: true
     };

     // Validate and apply saved bounds
     if (savedEventDetailsBounds) {
         const displays = screen.getAllDisplays();
         const isVisible = displays.some(display => {
             const displayBounds = display.workArea;
             return (
                 savedEventDetailsBounds.x < displayBounds.x + displayBounds.width &&
                 savedEventDetailsBounds.x + savedEventDetailsBounds.width > displayBounds.x &&
                 savedEventDetailsBounds.y < displayBounds.y + displayBounds.height &&
                 savedEventDetailsBounds.y + savedEventDetailsBounds.height > displayBounds.y
             );
         });

         if (isVisible) {
             logger.info(MODULE_NAME, 'Applying saved event details window bounds:', savedEventDetailsBounds);
             detailsWindowOptions.x = savedEventDetailsBounds.x;
             detailsWindowOptions.y = savedEventDetailsBounds.y;
             detailsWindowOptions.width = savedEventDetailsBounds.width;
             detailsWindowOptions.height = savedEventDetailsBounds.height;
         } else {
             logger.warn(MODULE_NAME, 'Saved event details window bounds are outside visible screen area. Using defaults.');
             store.delete('eventDetailsWindowBounds'); // Clear invalid bounds
         }
     } else {
          logger.info(MODULE_NAME, `No saved event details bounds found. Using default size: ${detailsWindowOptions.width}x${detailsWindowOptions.height}`);
     }

     const detailsWindow = new BrowserWindow(detailsWindowOptions);

   attachTitlebarToWindow(detailsWindow); // Attach the custom title bar

     // detailsWindow.setMenu(null); // Removed: Let custom-electron-titlebar handle menu visibility

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
     const devServerUrlForDetails = process.env['VITE_DEV_SERVER_URL']; // Read env var inside function
     if (devServerUrlForDetails) {
         const detailsUrl = `${devServerUrlForDetails}/event-details.html`;
         logger.info(MODULE_NAME, `Loading event details window from dev server: ${detailsUrl}`);
       detailsWindow.loadURL(detailsUrl)
         .catch(err => logger.error(MODULE_NAME, 'Failed to load event-details.html from dev server:', err));
     } else {
       // Production: Load file using url.format relative to __dirname
       const productionDetailsUrl = url.format({
           pathname: path.join(__dirname, '..', 'dist', 'event-details.html'),
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
       // Always open DevTools for this window
       detailsWindow.webContents.openDevTools();
     });

     // Clear the stored data when the window is closed
     detailsWindow.on('closed', () => {
       // Check if the closed window was holding the currently active data
       if (activeEventDataForWindow?.id === eventData.id) {
         activeEventDataForWindow = null;
         logger.debug(MODULE_NAME, `Cleared activeEventDataForWindow for event ${eventData.id}`);
       }
     });

    // --- Save Event Details Window Bounds ---
    const saveEventDetailsBounds = createSaveBoundsHandler(detailsWindow, 'eventDetailsWindowBounds');
    detailsWindow.on('resize', saveEventDetailsBounds);
    detailsWindow.on('move', saveEventDetailsBounds);

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