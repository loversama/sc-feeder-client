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
let webContentWindow: BrowserWindow | null = null; // Added for Web Content Window
let currentWebContentSection: 'profile' | 'leaderboard' | null = null; // Track active section
// Store data for the event details window temporarily
let activeEventDataForWindow: KillEvent | null = null;

// electron-store setup for window state
// Define the type for the store schema explicitly
type WindowStoreSchema = {
    windowBounds?: Rectangle;
    settingsWindowBounds?: Rectangle;
    eventDetailsWindowBounds?: Rectangle;
    webContentWindowBounds?: Rectangle; // Added for Web Content Window
};

// electron-store setup for window state
const store = new Store<WindowStoreSchema>({
    defaults: {
        windowBounds: undefined,
        settingsWindowBounds: undefined,
        eventDetailsWindowBounds: undefined,
        webContentWindowBounds: undefined // Added for Web Content Window
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
    const appPath = app.getAppPath(); // Path to app root (e.g., app.asar or unpacked dir)
    let iconPath = '';

    // Determine the platform-specific preferred icon filename
    const isWindows = process.platform === 'win32';
    const preferredIconFilename = isWindows ? 'voidlog-icon.ico' : 'voidlog-icon.png';

    let basePath = '';
    if (isProd) {
        // In production, assets are often within the app's packaged code directory, specifically the build output ('dist')
        // Use app.getAppPath() which points to 'resources/app' or similar
        basePath = path.join(app.getAppPath(), 'dist'); // Look inside the 'dist' folder within the app path
        logger.info(MODULE_NAME, `Production mode. Using app.getAppPath()/dist as base: ${basePath}`);
        // Removed logging for __dirname and process.resourcesPath as app.getAppPath() is more relevant now
    } else {
        // In development, use VITE_PUBLIC which points to the 'public' source folder
        basePath = vitePublic || ''; // Use vitePublic, fallback to empty string
        logger.info(MODULE_NAME, `Development mode detected. Using VITE_PUBLIC as base for icons: ${basePath}`);
    }

    if (basePath && typeof basePath === 'string') {
        const iconFullPath = path.join(basePath, preferredIconFilename);
        logger.info(MODULE_NAME, `Checking production icon path inside app/dist: ${iconFullPath}`); // Log the full path being checked
        try {
             if (fsSync.existsSync(iconFullPath)) {
                 iconPath = iconFullPath; // Use the preferred icon if it exists
                 logger.info(MODULE_NAME, `Found icon at: ${iconPath}`);
             } else {
                  logger.error(MODULE_NAME, `Preferred icon (${preferredIconFilename}) not found at ${iconFullPath}.`);
                  // Optional: Check for fallback SVG on Windows if ICO failed?
                  if (isWindows) {
                      const fallbackPngPath = path.join(basePath, 'voidlog-icon.png'); // Fallback to PNG
                      logger.warn(MODULE_NAME, `Windows ICO not found, checking for PNG fallback: ${fallbackPngPath}`);
                      if (fsSync.existsSync(fallbackPngPath)) {
                          iconPath = fallbackPngPath;
                          logger.info(MODULE_NAME, `Found fallback PNG icon at: ${iconPath}`);
                      } else {
                           logger.error(MODULE_NAME, `Fallback PNG icon also not found at ${fallbackPngPath}.`);
                      }
                  }
             }
        } catch (err: any) {
             logger.error(MODULE_NAME, `Error checking icon path ${iconFullPath}: ${err.message}`);
        }
    } else {
        logger.error(MODULE_NAME, `Base path for icon is invalid or not determined. isProd=${isProd}, appPath=${appPath}, vitePublic=${vitePublic}`);
    }

    if (!iconPath) {
        logger.warn(MODULE_NAME, "Could not find a valid icon path. Windows/Tray might lack an icon.");
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
        const isDevelopment = process.env.NODE_ENV === 'development';
        const WEBSITE_BASE_URL = isDevelopment
          ? 'http://localhost:3001' // Development URL
          : 'https://killfeed.sinfulshadows.com'; // Production URL

        try {
            const parsedUrl = new URL(url);
            const parsedPath = parsedUrl.pathname;

            if (parsedPath.startsWith('/profile') || parsedPath.startsWith('/leaderboard')) {
                const newUrl = `${WEBSITE_BASE_URL}${parsedPath}`;
                logger.info(MODULE_NAME, `Opening environment-specific link: ${newUrl}`);
                shell.openExternal(newUrl);
                return { action: 'deny' }; // Prevent default Electron window
            }
        } catch (e) {
            logger.error(MODULE_NAME, `Failed to parse or handle URL: ${url}`, e);
            // Fallback to default behavior or deny if parsing fails
        }

        // Allow other URLs to open in the default browser
        if (url.startsWith('http:') || url.startsWith('https:')) {
             logger.info(MODULE_NAME, `Opening external link from main window: ${url}`);
             shell.openExternal(url);
             return { action: 'deny' }; // Still deny opening in a new Electron window
        }

        // Deny any other types of URLs or unhandled cases
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
    const primaryDisplay = screen.getPrimaryDisplay();
    const screenWidth = primaryDisplay.workAreaSize.width;
    const defaultSettingsWidth = Math.floor(screenWidth * 0.38); // Calculate 38% of screen width

    const settingsWindowOptions: Electron.BrowserWindowConstructorOptions = {
        width: defaultSettingsWidth, // Use calculated width
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
        // Emit status update when shown
        getMainWindow()?.webContents.send('settings-window-status', { isOpen: true });
        logger.info(MODULE_NAME, 'Sent settings-window-status { isOpen: true }');
        if (!app.isPackaged) {
            settingsWindow?.webContents.openDevTools(); // Open dev tools for settings in dev
        }
    });

    settingsWindow.on('closed', () => {
        settingsWindow = null; // Dereference the window object
        // Emit status update when closed
        getMainWindow()?.webContents.send('settings-window-status', { isOpen: false });
        logger.info(MODULE_NAME, 'Sent settings-window-status { isOpen: false }');
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

// --- NEW Web Content Window ---
export function createWebContentWindow(section?: 'profile' | 'leaderboard'): BrowserWindow | null {
    // --- Handle Existing Window ---
    if (webContentWindow && !webContentWindow.isDestroyed()) {
        logger.info(MODULE_NAME, `Web content window already exists. Focusing and checking section: ${section}`);
        if (webContentWindow.isMinimized()) {
            webContentWindow.restore(); // Restore if minimized
        }
        webContentWindow.focus(); // Bring to front

        // Check if section needs changing
        const newSection = section || null; // Default to null if undefined
        if (newSection && newSection !== currentWebContentSection) {
            logger.info(MODULE_NAME, `Switching section from ${currentWebContentSection} to ${newSection}`);
            // Send IPC to renderer to navigate
            webContentWindow.webContents.send('navigate-to-section', newSection);
            // Update tracked section
            currentWebContentSection = newSection;
            // Send status update to main window
            getMainWindow()?.webContents.send('web-content-window-status', { isOpen: true, activeSection: currentWebContentSection });
            logger.info(MODULE_NAME, `Sent web-content-window-status update for section switch: { isOpen: true, activeSection: ${currentWebContentSection} }`);
        } else {
             logger.debug(MODULE_NAME, `Requested section (${section}) is same as current (${currentWebContentSection}) or null. No navigation needed.`);
        }
        return webContentWindow; // Return existing window
    }

    // --- Create New Window ---
    logger.info(MODULE_NAME, `Creating new web content window for section: ${section}`);
    currentWebContentSection = section || null; // Set initial section *before* loading

    // --- Web Content Window Bounds ---
    const savedBounds = store.get('webContentWindowBounds');
    const defaultWidth = 1024;
    const defaultHeight = 768;

    const webContentWindowOptions: Electron.BrowserWindowConstructorOptions = {
        width: defaultWidth,
        height: defaultHeight,
        x: undefined,
        y: undefined,
        title: 'SC Feeder - Web Content',
        webPreferences: {
            preload: getPreloadPath(),
            nodeIntegration: false,
            contextIsolation: true,
            devTools: !app.isPackaged,
            spellcheck: false,
            webviewTag: true // Enable the <webview> tag
        },
        frame: false, // Required for custom title bar
        titleBarStyle: 'hidden',
        titleBarOverlay: true, // Enable overlay for custom controls
        autoHideMenuBar: true,
        show: false, // Don't show until ready
        icon: getIconPath() || undefined,
        minWidth: 800, // Set reasonable minimum dimensions
        minHeight: 600,
        backgroundColor: '#1a1a1a' // Match other windows if desired
    };

    // Validate and apply saved bounds
    if (savedBounds) {
        const displays = screen.getAllDisplays();
        const isVisible = displays.some(display => {
            const displayBounds = display.workArea;
            return (
                savedBounds.x < displayBounds.x + displayBounds.width &&
                savedBounds.x + savedBounds.width > displayBounds.x &&
                savedBounds.y < displayBounds.y + displayBounds.height &&
                savedBounds.y + savedBounds.height > displayBounds.y
            );
        });

        if (isVisible) {
            logger.info(MODULE_NAME, 'Applying saved web content window bounds:', savedBounds);
            webContentWindowOptions.x = savedBounds.x;
            webContentWindowOptions.y = savedBounds.y;
            webContentWindowOptions.width = savedBounds.width;
            webContentWindowOptions.height = savedBounds.height;
        } else {
            logger.warn(MODULE_NAME, 'Saved web content window bounds are outside visible screen area. Using defaults.');
            store.delete('webContentWindowBounds'); // Clear invalid bounds
        }
    } else {
        logger.info(MODULE_NAME, `No saved web content bounds found. Using default size: ${defaultWidth}x${defaultHeight}`);
    }

    webContentWindow = new BrowserWindow(webContentWindowOptions);

    attachTitlebarToWindow(webContentWindow); // Attach the custom title bar

    // Load web content URL
    const devServerUrl = process.env['VITE_DEV_SERVER_URL'];
    if (devServerUrl) {
         // Append section hash if provided
         const webContentUrl = `${devServerUrl}/web-content.html${section ? '#' + section : ''}`;
         logger.info(MODULE_NAME, `Loading web content window from dev server: ${webContentUrl}`);
         webContentWindow.loadURL(webContentUrl)
             .catch(err => logger.error(MODULE_NAME, 'Failed to load web-content.html from dev server:', err));
    } else {
        // Production: Load file using url.format
        const productionWebContentUrl = url.format({
            pathname: path.join(__dirname, '..', 'dist', 'web-content.html'), // Base path
            protocol: 'file:',
            slashes: true,
            hash: section ? section : '' // Append hash if provided
        });
        logger.info(MODULE_NAME, `Loading web content window from URL: ${productionWebContentUrl}`);
        webContentWindow.loadURL(productionWebContentUrl)
            .catch(err => {
                logger.error(MODULE_NAME, `Failed to load web-content.html from ${productionWebContentUrl}:`, err);
                if (webContentWindow) { // Add null check
                    webContentWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`<h1>Error</h1><p>Could not load web content page from ${productionWebContentUrl}.</p><p>${err}</p>`)}`);
                }
            });
    }

    webContentWindow.once('ready-to-show', () => {
        logger.info(MODULE_NAME, 'Web content window ready-to-show');
        webContentWindow?.show();
        // Emit status update when shown, reflecting the initially loaded section
        getMainWindow()?.webContents.send('web-content-window-status', { isOpen: true, activeSection: currentWebContentSection });
        logger.info(MODULE_NAME, `Sent web-content-window-status { isOpen: true, activeSection: ${currentWebContentSection} }`);
        if (!app.isPackaged) {
            webContentWindow?.webContents.openDevTools(); // Open dev tools in dev
        }
    });

    webContentWindow.on('closed', () => {
        webContentWindow = null; // Dereference the window object
        currentWebContentSection = null; // Reset the active section
        logger.debug(MODULE_NAME, 'Web content window closed, dereferenced, and section reset.');
        // Emit status update when closed
        getMainWindow()?.webContents.send('web-content-window-status', { isOpen: false, activeSection: null });
        logger.info(MODULE_NAME, 'Sent web-content-window-status { isOpen: false, activeSection: null }');
    });

    // --- Save Web Content Window Bounds ---
    const saveWebContentBounds = createSaveBoundsHandler(webContentWindow, 'webContentWindowBounds');
    webContentWindow.on('resize', saveWebContentBounds);
    webContentWindow.on('move', saveWebContentBounds);

    // Handle external links in web content window
    webContentWindow.webContents.setWindowOpenHandler(({ url }) => {
        if (url.startsWith('http:') || url.startsWith('https:')) {
            logger.info(MODULE_NAME, `Opening external link from web content window: ${url}`);
            shell.openExternal(url);
            return { action: 'deny' };
        }
        logger.warn(MODULE_NAME, `Denying window open request for non-external URL: ${url}`);
        return { action: 'deny' };
    });

    return webContentWindow;
}


// --- Window Closing Functions ---

export function closeSettingsWindow() {
    if (settingsWindow && !settingsWindow.isDestroyed()) {
        logger.info(MODULE_NAME, "Closing settings window programmatically.");
        settingsWindow.close(); // This will trigger the 'closed' event and status update
    } else {
        logger.info(MODULE_NAME, "Close settings window requested, but window not found or already destroyed.");
    }
}

export function closeWebContentWindow() {
    if (webContentWindow && !webContentWindow.isDestroyed()) {
        logger.info(MODULE_NAME, "Closing web content window programmatically.");
        webContentWindow.close(); // This will trigger the 'closed' event and status update
    } else {
        logger.info(MODULE_NAME, "Close web content window requested, but window not found or already destroyed.");
    }
}

// --- Status Getters (Synchronous) ---

/**
 * Gets the current status of the Settings window.
 * @returns {{ isOpen: boolean }}
 */
export function getSettingsStatus(): { isOpen: boolean } {
    const isOpen = !!settingsWindow && !settingsWindow.isDestroyed();
    logger.debug(MODULE_NAME, `Getting settings status: ${isOpen}`);
    return { isOpen };
}

/**
 * Gets the current status of the Web Content window, including the active section.
 * @returns {{ isOpen: boolean, activeSection: 'profile' | 'leaderboard' | null }}
 */
export function getWebContentStatus(): { isOpen: boolean, activeSection: 'profile' | 'leaderboard' | null } {
    const isOpen = !!webContentWindow && !webContentWindow.isDestroyed();
    const section = isOpen ? currentWebContentSection : null;
    logger.debug(MODULE_NAME, `Getting web content status: isOpen=${isOpen}, activeSection=${section}`);
    return { isOpen, activeSection: section };
}

// --- Accessor Functions ---

export function getMainWindow(): BrowserWindow | null {
    return mainWindow;
}

export function getSettingsWindow(): BrowserWindow | null {
    return settingsWindow;
}

export function getWebContentWindow(): BrowserWindow | null { // Added accessor
    return webContentWindow;
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
        // Updated to include webContentWindow
        if (window === mainWindow || window === settingsWindow || window === webContentWindow /* add details window if needed */) {
             window.close();
        }
        // Or simply close all: window.close();
    });
    mainWindow = null;
    settingsWindow = null;
    webContentWindow = null; // Added dereference
    activeEventDataForWindow = null;
}