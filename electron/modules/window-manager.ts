import { BrowserWindow, shell, app, screen, Rectangle, ipcMain } from 'electron'; // Import screen and Rectangle, and ipcMain
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

// Type for auth tokens
interface AuthTokens {
    accessToken?: string;
    refreshToken?: string;
    user?: any;
}

// Define __dirname for ES module scope
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- Module State ---

let mainWindow: BrowserWindow | null = null;
let settingsWindow: BrowserWindow | null = null;
let webContentWindow: BrowserWindow | null = null; // Added for Web Content Window
let loginWindow: BrowserWindow | null = null;
let currentWebContentSection: 'profile' | 'leaderboard' | 'map' | null = null; // Track active section
// Store data for the event details window temporarily
let activeEventDataForWindow: KillEvent | null = null;

// Aggressive function to force DevTools open for any window in development
function forceDevToolsOpen(window: BrowserWindow, windowType: string): void {
    if (!app.isPackaged && !process.env.CI) {
        logger.info(MODULE_NAME, `[DevTools] Setting up DevTools for ${windowType}`);
        
        // Method 1: Try opening immediately with docked mode (visible)
        try {
            window.webContents.openDevTools({ mode: 'right' });
            logger.info(MODULE_NAME, `[DevTools] Opened immediately (docked right) for ${windowType}`);
            
            // Check if DevTools are actually open
            setTimeout(() => {
                const isOpen = window.webContents.isDevToolsOpened();
                logger.info(MODULE_NAME, `[DevTools] Status check for ${windowType}: ${isOpen ? 'OPEN' : 'CLOSED'}`);
                
                if (!isOpen) {
                    // Try bottom if right didn't work
                    logger.warn(MODULE_NAME, `[DevTools] Right mode failed, trying bottom mode for ${windowType}`);
                    window.webContents.openDevTools({ mode: 'bottom' });
                    
                    setTimeout(() => {
                        const isOpenNow = window.webContents.isDevToolsOpened();
                        logger.info(MODULE_NAME, `[DevTools] After bottom attempt for ${windowType}: ${isOpenNow ? 'OPEN' : 'CLOSED'}`);
                    }, 500);
                }
            }, 1000);
        } catch (e) {
            logger.warn(MODULE_NAME, `[DevTools] Immediate open failed for ${windowType}:`, e);
        }
        
        // Method 2: Open when ready to show
        window.once('ready-to-show', () => {
            setTimeout(() => {
                try {
                    const isAlreadyOpen = window.webContents.isDevToolsOpened();
                    if (!isAlreadyOpen) {
                        window.webContents.openDevTools({ mode: 'right' });
                        logger.info(MODULE_NAME, `[DevTools] Opened on ready-to-show for ${windowType}`);
                    } else {
                        logger.info(MODULE_NAME, `[DevTools] Already open on ready-to-show for ${windowType}`);
                    }
                } catch (e) {
                    logger.warn(MODULE_NAME, `[DevTools] ready-to-show open failed for ${windowType}:`, e);
                }
            }, 100);
        });
        
        // Method 3: Open when content loads
        window.webContents.once('did-finish-load', () => {
            setTimeout(() => {
                try {
                    const isAlreadyOpen = window.webContents.isDevToolsOpened();
                    if (!isAlreadyOpen) {
                        window.webContents.openDevTools({ mode: 'bottom' });
                        logger.info(MODULE_NAME, `[DevTools] Opened on did-finish-load (bottom) for ${windowType}`);
                    } else {
                        logger.info(MODULE_NAME, `[DevTools] Already open on did-finish-load for ${windowType}`);
                    }
                } catch (e) {
                    logger.warn(MODULE_NAME, `[DevTools] did-finish-load open failed for ${windowType}:`, e);
                }
            }, 200);
        });
        
        // Simple final check (like other windows that work correctly)
        setTimeout(() => {
            if (window && !window.isDestroyed()) {
                const isOpen = window.webContents.isDevToolsOpened();
                logger.info(MODULE_NAME, `[DevTools] Final check for ${windowType}: ${isOpen ? 'OPEN' : 'CLOSED'}`);
            }
        }, 1000);
    }
}

// Helper function to inject custom titlebar CSS for dark theme
function injectTitlebarCSS(window: BrowserWindow): void {
    window.webContents.insertCSS(`
      /* Custom electron titlebar dark theme styling */
      .cet-titlebar {
        background-color: transparent !important;
        border-bottom: none !important;
      }
      
      /* Ensure window controls are dark themed */
      .cet-control-button {
        color: #ffffff !important;
        background-color: transparent !important;
      }
      
      .cet-control-button:hover {
        background-color: rgba(255, 255, 255, 0.1) !important;
      }
      
      .cet-control-button.cet-close:hover {
        background-color: #e81123 !important;
      }
      
      /* Hide title and icon since we want minimal titlebar */
      .cet-title, .cet-icon {
        display: none !important;
      }
      
      /* Ensure content doesn't have unnecessary spacing */
      #app, #login-app {
        height: 100vh !important;
        overflow: auto !important;
      }
    `).catch(err => logger.error(MODULE_NAME, "Failed to inject titlebar CSS:", err));
}

// WindowManager class
class WindowManager {
    private webContentWindow: BrowserWindow | null = null;
    private webAppUrl: string = '';

    constructor() {
        // Initialize webAppUrl from environment
        const isDevelopment = process.env.NODE_ENV === 'development';
        this.webAppUrl = isDevelopment
            ? 'http://localhost:3001'
            : 'https://killfeed.sinfulshadows.com';
    }

    // Method to send auth tokens to web content window
    public sendAuthTokensToWebContentWindow(tokens: AuthTokens | null): void {
        this.webContentWindow = webContentWindow; // Use the module-level webContentWindow
        
        if (this.webContentWindow && !this.webContentWindow.isDestroyed()) {
            this.webContentWindow.webContents.send('auth-tokens-updated', tokens);
            this._handleAuthTokensForCookie(tokens);
        }
    }

    // Private method to handle auth tokens for cookie setting
    private async _handleAuthTokensForCookie(tokens: AuthTokens | null): Promise<void> {
        console.log('[WindowManager CookieDebug] Entered _handleAuthTokensForCookie. Tokens:', tokens ? 'present' : 'null or undefined');
        
        if (!tokens) {
            logger.info(MODULE_NAME, 'No tokens provided to _handleAuthTokensForCookie');
            return;
        }

        if (!this.webContentWindow || this.webContentWindow.isDestroyed()) {
            logger.warn(MODULE_NAME, 'WebContentWindow is null or destroyed in _handleAuthTokensForCookie');
            return;
        }

        logger.info(MODULE_NAME, 'Setting auth cookies for web content window');
        
        try {
            const cookieUrl = this.webAppUrl;
            logger.info(MODULE_NAME, `[WindowManager CookieDebug] Attempting to set cookies for URL: ${cookieUrl}`);

            if (tokens.accessToken) {
                logger.info(MODULE_NAME, '[WindowManager CookieDebug] Setting access token cookie');
                await this.webContentWindow.webContents.session.cookies.set({
                    url: cookieUrl,
                    name: 'access_token',
                    value: tokens.accessToken,
                    httpOnly: false,
                    secure: cookieUrl.startsWith('https'),
                    sameSite: 'lax'
                });
                logger.info(MODULE_NAME, '[WindowManager CookieDebug] Successfully set access token cookie');
            }

            if (tokens.refreshToken) {
                logger.info(MODULE_NAME, '[WindowManager CookieDebug] Setting refresh token cookie');
                await this.webContentWindow.webContents.session.cookies.set({
                    url: cookieUrl,
                    name: 'refresh_token',
                    value: tokens.refreshToken,
                    httpOnly: false,
                    secure: cookieUrl.startsWith('https'),
                    sameSite: 'lax'
                });
                logger.info(MODULE_NAME, '[WindowManager CookieDebug] Successfully set refresh token cookie');
            }

            if (tokens.user) {
                logger.info(MODULE_NAME, '[WindowManager CookieDebug] Setting user data cookie');
                await this.webContentWindow.webContents.session.cookies.set({
                    url: cookieUrl,
                    name: 'user_data',
                    value: JSON.stringify(tokens.user),
                    httpOnly: false,
                    secure: cookieUrl.startsWith('https'),
                    sameSite: 'lax'
                });
                logger.info(MODULE_NAME, '[WindowManager CookieDebug] Successfully set user data cookie');
            }

            logger.info(MODULE_NAME, '[WindowManager CookieDebug] All cookies set successfully');
        } catch (error) {
            logger.error(MODULE_NAME, '[WindowManager CookieDebug] Error setting cookies:', error);
        }
    }
}

// Create a singleton instance
const windowManager = new WindowManager();

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
        logger.debug(MODULE_NAME, `Development mode detected. Using VITE_PUBLIC as base for icons: ${basePath}`);
    }

    if (basePath && typeof basePath === 'string') {
        const iconFullPath = path.join(basePath, preferredIconFilename);
        logger.debug(MODULE_NAME, `Checking production icon path inside app/dist: ${iconFullPath}`); // Log the full path being checked
        try {
             if (fsSync.existsSync(iconFullPath)) {
                 iconPath = iconFullPath; // Use the preferred icon if it exists
                 logger.debug(MODULE_NAME, `Found icon at: ${iconPath}`);
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

function getPreloadPath(filename: string): string {
    const appRoot = process.env.APP_ROOT;
    if (!appRoot) {
        logger.error(MODULE_NAME, "APP_ROOT not set when trying to get preload path. Cannot proceed.");
        throw new Error("APP_ROOT environment variable is not set.");
    }

    const mainDist = path.join(appRoot, 'dist-electron');
    logger.debug(MODULE_NAME, `Calculated mainDist for preload: ${mainDist}`);

    let resolvedPath: string | undefined;

    if (!app.isPackaged) { // Development
      // Path when running directly from source (e.g., with Vite dev server)
      const devPath = path.join(appRoot, 'electron', filename);
      logger.debug(MODULE_NAME, `[Dev Mode] Resolving preload path for: ${filename}. Checking: ${devPath}`);
      if (fsSync.existsSync(devPath)) {
        resolvedPath = devPath;
        logger.info(MODULE_NAME, `[Dev Mode] Preload path FOUND: ${resolvedPath}`);
      } else {
        logger.warn(MODULE_NAME, `[Dev Mode] Preload path NOT FOUND: ${devPath}. Attempting fallback.`);
        // Fallback for some dev scenarios or if mainDist is preferred (e.g., if built to dist-electron in dev)
        const devPathFallback = path.join(mainDist, filename);
        logger.debug(MODULE_NAME, `[Dev Mode] Checking fallback preload path: ${devPathFallback}`);
        if (fsSync.existsSync(devPathFallback)) {
          resolvedPath = devPathFallback;
          logger.info(MODULE_NAME, `[Dev Mode] Fallback preload path FOUND: ${resolvedPath}`);
        } else {
          logger.error(MODULE_NAME, `[Dev Mode] Fallback preload path NOT FOUND: ${devPathFallback}. Preload script will likely fail to load.`);
        }
      }
    } else { // Production
      resolvedPath = path.join(mainDist, filename);
      logger.info(MODULE_NAME, `[Prod Mode] Resolving preload path for: ${filename}. Checking: ${resolvedPath}`);
      if (!fsSync.existsSync(resolvedPath)) {
        logger.error(MODULE_NAME, `[Prod Mode] Preload path NOT FOUND: ${resolvedPath}. Preload script will fail to load.`);
      } else {
        logger.info(MODULE_NAME, `[Prod Mode] Preload path FOUND: ${resolvedPath}`);
      }
    }

    if (!resolvedPath) {
      const errorMessage = `Failed to resolve preload path for ${filename}. It will not be loaded.`;
      logger.error(MODULE_NAME, errorMessage);
      throw new Error(errorMessage);
    }

    logger.info(MODULE_NAME, `Resolved preload path for ${filename}: ${resolvedPath}`);
    return resolvedPath;
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
            preload: getPreloadPath('preload.mjs'),
            nodeIntegration: false,
            contextIsolation: true,
            devTools: !app.isPackaged, // Enable DevTools only in development (like other windows)
            spellcheck: false,
            webSecurity: app.isPackaged // Disable web security in development to allow HTTP images
        },
        frame: false, // Required for custom title bar
        titleBarStyle: 'hidden', // Add for custom title bar
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

    // Force DevTools open for main window in development
    forceDevToolsOpen(mainWindow, 'main window');

    mainWindow.on('ready-to-show', () => {
        mainWindow?.show();
        if (mainWindow) {
            injectTitlebarCSS(mainWindow);
        }
    });

    mainWindow.webContents.on('did-finish-load', () => {
        mainWindow?.webContents.send('main-process-message', `Main window loaded at ${(new Date).toLocaleString()}`);
        
        // FORCE DevTools open after content loads - final attempt with LONG delay
        if (!app.isPackaged && !process.env.CI) {
            // Try immediately
            setTimeout(() => {
                if (mainWindow && !mainWindow.isDestroyed()) {
                    logger.info(MODULE_NAME, '[DevTools] FORCING DevTools open after did-finish-load (attempt 1)');
                    try {
                        mainWindow.webContents.openDevTools({ mode: 'right' });
                    } catch (e) {
                        logger.error(MODULE_NAME, '[DevTools] Immediate force failed:', e);
                    }
                }
            }, 500);

            // Try again after 3 seconds
            setTimeout(() => {
                if (mainWindow && !mainWindow.isDestroyed()) {
                    logger.info(MODULE_NAME, '[DevTools] FORCING DevTools open (attempt 2 - 3 seconds)');
                    try {
                        mainWindow.webContents.openDevTools({ mode: 'bottom' });
                    } catch (e) {
                        logger.error(MODULE_NAME, '[DevTools] 3-second force failed:', e);
                    }
                }
            }, 3000);

            // Try again after 5 seconds
            setTimeout(() => {
                if (mainWindow && !mainWindow.isDestroyed()) {
                    logger.info(MODULE_NAME, '[DevTools] FORCING DevTools open (attempt 3 - 5 seconds)');
                    try {
                        mainWindow.webContents.openDevTools({ mode: 'detach' });
                        logger.info(MODULE_NAME, '[DevTools] Final force attempt completed');
                    } catch (e) {
                        logger.error(MODULE_NAME, '[DevTools] 5-second force failed:', e);
                    }
                }
            }, 5000);

            // Super aggressive final attempt after 10 seconds
            setTimeout(() => {
                if (mainWindow && !mainWindow.isDestroyed()) {
                    const isOpen = mainWindow.webContents.isDevToolsOpened();
                    if (!isOpen) {
                        logger.warn(MODULE_NAME, '[DevTools] STILL NOT OPEN after 10 seconds - NUCLEAR OPTION');
                        try {
                            // Close and reopen
                            mainWindow.webContents.closeDevTools();
                            setTimeout(() => {
                                if (mainWindow && !mainWindow.isDestroyed()) {
                                    mainWindow.webContents.openDevTools({ mode: 'right' });
                                }
                            }, 200);
                        } catch (e) {
                            logger.error(MODULE_NAME, '[DevTools] Nuclear option failed:', e);
                        }
                    } else {
                        logger.info(MODULE_NAME, '[DevTools] Finally confirmed open after delays');
                    }
                }
            }, 10000);
        }
        
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

export function createMainWindowAfterAuth(): BrowserWindow {
  // This function is called ONLY after authentication is complete
  // Ensures main window never appears before user authentication
  logger.info(MODULE_NAME, 'Creating main window after authentication complete');
  return createMainWindow();
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
            preload: getPreloadPath('preload.mjs'),
            nodeIntegration: false,
            contextIsolation: true,
            devTools: !app.isPackaged,
            spellcheck: false,
            webSecurity: app.isPackaged // Disable web security in development to allow HTTP images
        },
        frame: false,
        titleBarStyle: 'hidden',
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

    // Force DevTools open for settings window in development
    forceDevToolsOpen(settingsWindow, 'settings window');

    attachTitlebarToWindow(settingsWindow); // Attach the custom title bar
    
    // Listen for console messages from settings window
    settingsWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
        logger.debug(MODULE_NAME, `Settings window console [${level}]: ${message} (${sourceId}:${line})`);
    });
    
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

    settingsWindow.webContents.on('did-finish-load', () => {
        logger.info(MODULE_NAME, 'Settings window finished loading');
        
        // Check for console messages from settings-main.ts
        if (settingsWindow) {
            settingsWindow.webContents.executeJavaScript(`
              console.log('[WindowManager] Checking if settings-main.ts is loaded...');
              document.getElementById('app') ? 'app div found' : 'app div NOT found';
            `).then(result => {
              logger.info(MODULE_NAME, `Settings window DOM check: ${result}`);
            });
        }
    });

    settingsWindow.once('ready-to-show', () => {
        settingsWindow?.show();
        if (settingsWindow) {
            injectTitlebarCSS(settingsWindow);
        }
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
            shell.openExternal(url);
            return { action: 'deny' };
        }
        return { action: 'deny' };
    });

    return settingsWindow;
}

export function createEventDetailsWindow(eventData: KillEvent, currentUsername: string | null): BrowserWindow | null {
    if (!mainWindow) {
        logger.error(MODULE_NAME, "Cannot create event details window: Main window does not exist.");
        return null;
    }

    // Store the event data for retrieval by the renderer process
    activeEventDataForWindow = eventData;

    // --- Event Details Window Bounds ---
    const savedDetailsBounds = store.get('eventDetailsWindowBounds');
    const primaryDisplay = screen.getPrimaryDisplay();
    const screenWidth = primaryDisplay.workAreaSize.width;
    const defaultDetailsWidth = Math.floor(screenWidth * 0.45); // Calculate 45% of screen width

    const detailsWindowOptions: Electron.BrowserWindowConstructorOptions = {
        width: defaultDetailsWidth,
        height: 700,
        x: undefined,
        y: undefined,
        title: 'SC KillFeeder - Event Details',
        modal: false, // Changed to false to allow interaction with main window
        webPreferences: {
            preload: getPreloadPath('preload.mjs'),
            nodeIntegration: false,
            contextIsolation: true,
            devTools: !app.isPackaged,
            spellcheck: false
        },
        frame: false,
        titleBarStyle: 'hidden',
        autoHideMenuBar: true,
        show: false,
        icon: getIconPath() || undefined,
        minWidth: 600,
        minHeight: 500
    };

    // Validate and apply saved bounds
    if (savedDetailsBounds) {
        const displays = screen.getAllDisplays();
        const isVisible = displays.some(display => {
            const displayBounds = display.workArea;
            return (
                savedDetailsBounds.x < displayBounds.x + displayBounds.width &&
                savedDetailsBounds.x + savedDetailsBounds.width > displayBounds.x &&
                savedDetailsBounds.y < displayBounds.y + displayBounds.height &&
                savedDetailsBounds.y + savedDetailsBounds.height > displayBounds.y
            );
        });

        if (isVisible) {
            logger.info(MODULE_NAME, 'Applying saved event details window bounds:', savedDetailsBounds);
            detailsWindowOptions.x = savedDetailsBounds.x;
            detailsWindowOptions.y = savedDetailsBounds.y;
            detailsWindowOptions.width = savedDetailsBounds.width;
            detailsWindowOptions.height = savedDetailsBounds.height;
        } else {
            logger.warn(MODULE_NAME, 'Saved event details window bounds are outside visible screen area. Using defaults.');
            store.delete('eventDetailsWindowBounds'); // Clear invalid bounds
        }
    } else {
         logger.info(MODULE_NAME, `No saved event details bounds found. Using default size: ${detailsWindowOptions.width}x${detailsWindowOptions.height}`);
    }

    const detailsWindow = new BrowserWindow(detailsWindowOptions);
    
    // Force DevTools open for event details window in development
    forceDevToolsOpen(detailsWindow, 'event details window');
    
    attachTitlebarToWindow(detailsWindow);

    // Handle external links in event details window
    detailsWindow.webContents.setWindowOpenHandler(({ url }) => {
        if (url.startsWith('http:') || url.startsWith('https:')) {
            shell.openExternal(url);
            return { action: 'deny' };
        }
        return { action: 'deny' };
    });

    const devServerUrl = process.env['VITE_DEV_SERVER_URL'];
    if (devServerUrl) {
        const eventDetailsUrl = `${devServerUrl}/event-details.html`;
        logger.info(MODULE_NAME, `Loading event details window from dev server: ${eventDetailsUrl}`);
        detailsWindow.loadURL(eventDetailsUrl)
            .catch(err => logger.error(MODULE_NAME, 'Failed to load event-details.html from dev server:', err));
    } else {
        const productionEventDetailsUrl = url.format({
            pathname: path.join(__dirname, '..', 'dist', 'event-details.html'),
            protocol: 'file:',
            slashes: true
        });
        logger.info(MODULE_NAME, `Loading event details window from URL: ${productionEventDetailsUrl}`);
        detailsWindow.loadURL(productionEventDetailsUrl)
            .catch(err => {
                logger.error(MODULE_NAME, `Failed to load event-details.html from ${productionEventDetailsUrl}:`, err);
                if (detailsWindow) {
                    detailsWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`<h1>Error</h1><p>Could not load event details page from ${productionEventDetailsUrl}.</p><p>${err}</p>`)}`);
                }
            });
    }

    detailsWindow.once('ready-to-show', () => {
        detailsWindow?.show();
        if (detailsWindow) {
            injectTitlebarCSS(detailsWindow);
        }
        if (!app.isPackaged) {
            detailsWindow?.webContents.openDevTools();
        }
    });

    detailsWindow.on('closed', () => {
        activeEventDataForWindow = null; // Clear the stored data
        logger.info(MODULE_NAME, 'Event details window closed. Cleared active event data.');
    });

    // --- Save Event Details Window Bounds ---
    const saveDetailsBounds = createSaveBoundsHandler(detailsWindow, 'eventDetailsWindowBounds');
    detailsWindow.on('resize', saveDetailsBounds);
    detailsWindow.on('move', saveDetailsBounds);

    return detailsWindow;
}

export function createWebContentWindow(section?: 'profile' | 'leaderboard' | 'map'): BrowserWindow | null {
    if (webContentWindow) {
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
            preload: getPreloadPath('preload.mjs'), // Use standard preload for web content window
            nodeIntegration: false,
            contextIsolation: true,
            devTools: !app.isPackaged,
            spellcheck: false,
            webviewTag: true // Enable the <webview> tag
        },
        frame: false, // Required for custom title bar
        titleBarStyle: 'hidden',
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

    // Force DevTools open for web content window in development
    forceDevToolsOpen(webContentWindow, 'web content window');

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
            pathname: path.join(__dirname, '..', 'dist', 'web-content.html'),
            protocol: 'file:',
            slashes: true
        });
        logger.info(MODULE_NAME, `Loading web content window from URL: ${productionWebContentUrl}`);
        webContentWindow.loadURL(productionWebContentUrl)
            .catch(err => {
                logger.error(MODULE_NAME, `Failed to load web-content.html from ${productionWebContentUrl}:`, err);
                if (webContentWindow) {
                    webContentWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`<h1>Error</h1><p>Could not load web content page from ${productionWebContentUrl}.</p><p>${err}</p>`)}`);
                }
            });
    }

    webContentWindow.once('ready-to-show', () => {
        webContentWindow?.show();
        if (webContentWindow) {
            injectTitlebarCSS(webContentWindow);
        }
        if (!app.isPackaged) {
            webContentWindow?.webContents.openDevTools();
        }
    });

    webContentWindow.on('closed', () => {
        webContentWindow = null; // Dereference the window object
        currentWebContentSection = null; // Clear active section
        logger.info(MODULE_NAME, 'Web content window closed. Cleared active section.');
    });

    // --- Save Web Content Window Bounds ---
    const saveWebContentBounds = createSaveBoundsHandler(webContentWindow, 'webContentWindowBounds');
    webContentWindow.on('resize', saveWebContentBounds);
    webContentWindow.on('move', saveWebContentBounds);

    return webContentWindow;
}

export function closeSettingsWindow() {
    if (settingsWindow) {
        settingsWindow.close();
        settingsWindow = null;
    }
}

export function closeWebContentWindow(): void {
  if (webContentWindow && !webContentWindow.isDestroyed()) {
    webContentWindow.close();
    webContentWindow = null;
  }
}

export function createLoginWindow(): BrowserWindow | null {
  logger.info(MODULE_NAME, 'Creating login window...');
  
  if (loginWindow) {
    logger.info(MODULE_NAME, 'Login window already exists, focusing...');
    loginWindow.focus();
    return loginWindow;
  }

  const appIconPath = getIconPath();
  logger.debug(MODULE_NAME, `Using app icon path: ${appIconPath}`);
  
  // Get and log preload path
  const preloadPath = getPreloadPath('preload.mjs');
  logger.debug(MODULE_NAME, `LOGIN WINDOW - Using preload path: ${preloadPath}`);
  
  const loginWindowOptions: Electron.BrowserWindowConstructorOptions = {
    width: 400,
    height: 500,
    minWidth: 350,
    minHeight: 450,
    resizable: true,
    maximizable: true,
    minimizable: true,
    alwaysOnTop: true,
    modal: false, // Changed from true - no longer modal
    parent: undefined, // No parent window required
    icon: appIconPath || undefined,
    title: 'SC Kill Feed - Login',
    webPreferences: {
      preload: preloadPath,
      nodeIntegration: false,
      contextIsolation: true,
      devTools: !app.isPackaged,
      spellcheck: false
    },
    frame: false, // Remove native window frame completely
    titleBarStyle: 'hidden', // Hide native titlebar
    autoHideMenuBar: true, // Hide menu bar
    backgroundColor: '#222',
    show: false
  };

  try {
    loginWindow = new BrowserWindow(loginWindowOptions);
    logger.debug(MODULE_NAME, 'Login window BrowserWindow created successfully');
  } catch (error) {
    logger.error(MODULE_NAME, 'Error creating login window BrowserWindow:', error);
    return null;
  }
  
  // Force DevTools open for login window in development
  forceDevToolsOpen(loginWindow, 'login window');
  
  logger.debug(MODULE_NAME, 'Login window created, attaching custom titlebar...');
  
  try {
    attachTitlebarToWindow(loginWindow);
    logger.debug(MODULE_NAME, 'Custom titlebar attached successfully');
  } catch (error) {
    logger.error(MODULE_NAME, 'Error attaching custom titlebar:', error);
  }
  
  logger.debug(MODULE_NAME, 'Login window created, loading content...');

  // Listen for console messages from login window
  loginWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
    logger.debug(MODULE_NAME, `Login window console [${level}]: ${message} (${sourceId}:${line})`);
  });

  // Open DevTools for debugging in development
  if (!app.isPackaged) {
    loginWindow.webContents.openDevTools();
  }

  // Load login page
  const devServerUrl = process.env['VITE_DEV_SERVER_URL'];
  if (devServerUrl) {
    loginWindow.loadURL(`${devServerUrl}/login.html`);
  } else {
    const loginUrl = url.format({
      pathname: path.join(__dirname, '..', 'dist', 'login.html'),
      protocol: 'file:',
      slashes: true
    });
    loginWindow.loadURL(loginUrl);
  }

  loginWindow.once('ready-to-show', () => {
    logger.info(MODULE_NAME, 'Login window ready to show');
    if (loginWindow) {
      // Get current bounds and display info for debugging
      const bounds = loginWindow.getBounds();
      const displays = screen.getAllDisplays();
      const primaryDisplay = screen.getPrimaryDisplay();
      
      logger.debug(MODULE_NAME, `Login window bounds: x=${bounds.x}, y=${bounds.y}, width=${bounds.width}, height=${bounds.height}`);
      logger.debug(MODULE_NAME, `Primary display bounds: x=${primaryDisplay.bounds.x}, y=${primaryDisplay.bounds.y}, width=${primaryDisplay.bounds.width}, height=${primaryDisplay.bounds.height}`);
      logger.debug(MODULE_NAME, `Total displays: ${displays.length}`);
      
      // Force center the window on primary display
      const centerX = Math.round(primaryDisplay.bounds.x + (primaryDisplay.bounds.width - bounds.width) / 2);
      const centerY = Math.round(primaryDisplay.bounds.y + (primaryDisplay.bounds.height - bounds.height) / 2);
      
      loginWindow.setBounds({
        x: centerX,
        y: centerY,
        width: bounds.width,
        height: bounds.height
      });
      
      logger.debug(MODULE_NAME, `Centered login window at: x=${centerX}, y=${centerY}`);
      
      loginWindow.show();
      loginWindow.focus();
      loginWindow.setAlwaysOnTop(true);
      loginWindow.moveTop();
      
      logger.info(MODULE_NAME, 'Login window displayed and focused');
      
      injectTitlebarCSS(loginWindow);
      
      // Check visibility after CSS injection
      setTimeout(() => {
        if (loginWindow) {
          logger.info(MODULE_NAME, `After CSS injection - isVisible: ${loginWindow.isVisible()}, isFocused: ${loginWindow.isFocused()}, isMinimized: ${loginWindow.isMinimized()}`);
          
          // Try force showing again if not visible
          if (!loginWindow.isVisible()) {
            logger.warn(MODULE_NAME, 'Login window not visible after CSS injection, attempting to force show');
            loginWindow.show();
            loginWindow.focus();
            loginWindow.moveTop();
          }
        }
      }, 500);
      
      logger.debug(MODULE_NAME, 'Login window shown and focused');
    }
  });

  loginWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    logger.error(MODULE_NAME, `Login window failed to load: ${errorCode} - ${errorDescription} for URL: ${validatedURL}`);
  });

  loginWindow.webContents.on('did-finish-load', () => {
    logger.debug(MODULE_NAME, 'Login window finished loading');
    
    // Check for console messages from login.ts
    if (loginWindow) {
        loginWindow.webContents.executeJavaScript(`
          console.log('[WindowManager] Checking if login.ts is loaded...');
          document.getElementById('login-app') ? 'login-app div found' : 'login-app div NOT found';
        `).then(result => {
          logger.debug(MODULE_NAME, `Login window DOM check: ${result}`);
        });
    }
    
    // Force show the window immediately after content loads
    if (loginWindow) {
      logger.debug(MODULE_NAME, 'Attempting to show login window after content load');
      
      // Get current bounds and display info for debugging
      const bounds = loginWindow.getBounds();
      const displays = screen.getAllDisplays();
      const primaryDisplay = screen.getPrimaryDisplay();
      
      logger.info(MODULE_NAME, `Login window bounds: x=${bounds.x}, y=${bounds.y}, width=${bounds.width}, height=${bounds.height}`);
      logger.info(MODULE_NAME, `Primary display bounds: x=${primaryDisplay.bounds.x}, y=${primaryDisplay.bounds.y}, width=${primaryDisplay.bounds.width}, height=${primaryDisplay.bounds.height}`);
      
      // Force center the window on primary display
      const centerX = Math.round(primaryDisplay.bounds.x + (primaryDisplay.bounds.width - bounds.width) / 2);
      const centerY = Math.round(primaryDisplay.bounds.y + (primaryDisplay.bounds.height - bounds.height) / 2);
      
      loginWindow.setBounds({
        x: centerX,
        y: centerY,
        width: bounds.width,
        height: bounds.height
      });
      
      logger.debug(MODULE_NAME, `Centered login window at: x=${centerX}, y=${centerY}`);
      
      loginWindow.show();
      loginWindow.focus();
      loginWindow.setAlwaysOnTop(true);
      loginWindow.moveTop();
      
      logger.debug(MODULE_NAME, `After show calls - isVisible: ${loginWindow.isVisible()}, isFocused: ${loginWindow.isFocused()}`);
      
      // Inject CSS after a brief delay
      setTimeout(() => {
        if (loginWindow) {
          injectTitlebarCSS(loginWindow);
          logger.info(MODULE_NAME, `After CSS injection - isVisible: ${loginWindow.isVisible()}`);
        }
      }, 100);
    }
  });

  loginWindow.on('closed', () => {
    logger.info(MODULE_NAME, 'Login window closed');
    loginWindow = null;
  });

  return loginWindow;
}

export function closeLoginWindow(): void {
  if (loginWindow && !loginWindow.isDestroyed()) {
    loginWindow.close();
  }
}

export function getLoginWindow(): BrowserWindow | null {
  return loginWindow;
}

export function getMainWindow(): BrowserWindow | null {
    return mainWindow;
}

export function getSettingsStatus(): { isOpen: boolean } {
    return { isOpen: settingsWindow !== null };
}

export function getWebContentStatus(): { isOpen: boolean, activeSection: 'profile' | 'leaderboard' | 'map' | null } {
    return { isOpen: webContentWindow !== null, activeSection: currentWebContentSection };
}

export function getActiveEventDataForWindow(): KillEvent | null {
    return activeEventDataForWindow;
}

export function closeAllWindows() {
    BrowserWindow.getAllWindows().forEach(window => {
        if (!window.isDestroyed()) {
            window.close();
        }
    });
}

// --- Public API Functions ---

// Function to send auth tokens to web content window using WindowManager
export function sendAuthTokensToWebContentWindow(tokens: AuthTokens | null): void {
    windowManager.sendAuthTokensToWebContentWindow(tokens);
}

// Add this IPC Handler
ipcMain.handle('get-preload-path', (_event, filename: string) => {
  try {
    const preloadPath = getPreloadPath(filename);
    logger.info(MODULE_NAME, `IPC 'get-preload-path' resolved '${filename}' to: ${preloadPath}`);
    return preloadPath;
  } catch (error) {
    logger.error(MODULE_NAME, `IPC 'get-preload-path' failed for '${filename}':`, error);
    throw error; // Or return null/undefined and handle in renderer
  }
});

// Add IPC Handler for resizing login window
ipcMain.handle('auth:resize-login-window', (_event, newHeight: number) => {
  try {
    if (loginWindow && !loginWindow.isDestroyed()) {
      const currentBounds = loginWindow.getBounds();
      const newBounds = {
        x: currentBounds.x,
        y: currentBounds.y,
        width: currentBounds.width,
        height: newHeight
      };
      
      // Center window vertically if it goes off screen
      const primaryDisplay = screen.getPrimaryDisplay();
      const maxY = primaryDisplay.bounds.y + primaryDisplay.bounds.height - newHeight;
      if (newBounds.y < primaryDisplay.bounds.y) {
        newBounds.y = primaryDisplay.bounds.y;
      } else if (newBounds.y > maxY) {
        newBounds.y = maxY;
      }
      
      loginWindow.setBounds(newBounds);
      logger.info(MODULE_NAME, `Login window resized to height: ${newHeight}`);
      return true;
    }
    return false;
  } catch (error) {
    logger.error(MODULE_NAME, 'Failed to resize login window:', error);
    return false;
  }
});