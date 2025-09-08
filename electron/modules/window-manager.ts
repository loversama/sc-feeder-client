import { BrowserWindow, shell, app, screen, Rectangle, ipcMain, BaseWindow, WebContentsView } from 'electron'; // Import screen and Rectangle, BaseWindow, WebContentsView, and ipcMain
import path from 'node:path';
import url from 'node:url'; // Import the url module
import fsSync from 'node:fs';
import { fileURLToPath } from 'node:url'; // Added for ESM __dirname
import Store from 'electron-store'; // Import electron-store
import { isQuitting } from './app-lifecycle'; // Import the flag
import { KillEvent } from '../../shared/types';
import * as logger from './logger'; // Import the logger utility
import { attachTitlebarToWindow } from "custom-electron-titlebar/main"; // Import for custom title bar
import { webContentsViewAuth } from './webcontents-view-auth'; // Import WebContentsView authentication
import * as AuthManager from './auth-manager'; // Import AuthManager
const MODULE_NAME = 'WindowManager'; // Define module name for logger

// Type for auth tokens
interface AuthTokens {
    accessToken?: string;
    refreshToken?: string;
    user?: any;
}

// Import WebContentsView manager for integration
let webContentsViewManager: any = null;
async function getWebContentsViewManager() {
    if (!webContentsViewManager) {
        try {
            webContentsViewManager = await import('./webcontents-view-manager');
            logger.debug(MODULE_NAME, 'WebContentsView manager loaded successfully');
        } catch (error) {
            logger.warn(MODULE_NAME, 'Failed to load WebContentsView manager:', error);
        }
    }
    return webContentsViewManager;
}

// Define __dirname for ES module scope
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- Module State ---

let mainWindow: BrowserWindow | null = null;
let settingsWindow: BrowserWindow | null = null;
let webContentWindow: BrowserWindow | null = null; // Added for Web Content Window
let webContentBaseWindow: BaseWindow | null = null; // New BaseWindow for web content
let webContentView: WebContentsView | null = null; // Web content view for BaseWindow
let loginWindow: BrowserWindow | null = null;
let currentWebContentSection: 'profile' | 'leaderboard' | 'map' | 'events' | 'stats' | 'profile-settings' | null = null; // Track active section
// Store data for the event details window temporarily
let activeEventDataForWindow: KillEvent | null = null;

// Function to setup DevTools security - only allow in development
function setupDevToolsSecurity(window: BrowserWindow, windowType: string): void {
    const isDevelopment = !app.isPackaged && !process.env.CI;
    
    if (isDevelopment) {
        logger.info(MODULE_NAME, `[DevTools] Development mode - enabling DevTools for ${windowType}`);
        
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
    } else {
        // Production mode - implement comprehensive DevTools security
        logger.info(MODULE_NAME, `[DevTools] Production mode - implementing DevTools security for ${windowType}`);
        
        // Prevent DevTools from being opened via any method
        window.webContents.on('devtools-opened', () => {
            logger.warn(MODULE_NAME, `[Security] DevTools opening attempt blocked for ${windowType}`);
            window.webContents.closeDevTools();
        });
        
        // Block right-click context menu that could access DevTools
        window.webContents.on('context-menu', (event) => {
            logger.debug(MODULE_NAME, `[Security] Context menu blocked for ${windowType}`);
            event.preventDefault();
        });
        
        // Block specific keyboard shortcuts at the WebContents level
        window.webContents.on('before-input-event', (event, input) => {
            // Block common DevTools shortcuts
            const blockedShortcuts = [
                { ctrl: true, shift: true, key: 'I' }, // Ctrl+Shift+I
                { ctrl: true, shift: true, key: 'J' }, // Ctrl+Shift+J  
                { ctrl: true, alt: true, key: 'I' },   // Ctrl+Alt+I
                { key: 'F12' },                        // F12
                { ctrl: true, key: 'F12' },            // Ctrl+F12
                { alt: true, key: 'F12' }              // Alt+F12
            ];
            
            const isBlocked = blockedShortcuts.some(shortcut => {
                return Object.keys(shortcut).every(modifier => {
                    if (modifier === 'key') {
                        return input.key.toLowerCase() === (shortcut as any)[modifier].toLowerCase();
                    }
                    return (input as any)[modifier] === (shortcut as any)[modifier];
                });
            });
            
            if (isBlocked) {
                logger.warn(MODULE_NAME, `[Security] DevTools shortcut blocked: ${input.key} for ${windowType}`);
                event.preventDefault();
            }
        });
        
        logger.info(MODULE_NAME, `[DevTools] Security measures activated for ${windowType}`);
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

    // Method to send auth tokens to BaseWindow web content view
    public sendAuthTokensToWebContentBaseWindow(tokens: AuthTokens | null): void {
        if (webContentView && !webContentView.webContents.isDestroyed()) {
            webContentView.webContents.send('auth-tokens-updated', tokens);
            this._handleAuthTokensForBaseWindowCookie(tokens);
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

    // Private method to handle auth tokens for BaseWindow cookie setting
    private async _handleAuthTokensForBaseWindowCookie(tokens: AuthTokens | null): Promise<void> {
        console.log('[WindowManager BaseWindowCookieDebug] Entered _handleAuthTokensForBaseWindowCookie. Tokens:', tokens ? 'present' : 'null or undefined');
        
        if (!tokens) {
            logger.info(MODULE_NAME, 'No tokens provided to _handleAuthTokensForBaseWindowCookie');
            return;
        }

        if (!webContentView || webContentView.webContents.isDestroyed()) {
            logger.warn(MODULE_NAME, 'WebContentView is null or destroyed in _handleAuthTokensForBaseWindowCookie');
            return;
        }

        logger.info(MODULE_NAME, 'Setting auth cookies for BaseWindow web content view');
        
        try {
            const cookieUrl = this.webAppUrl;
            logger.info(MODULE_NAME, `[WindowManager BaseWindowCookieDebug] Attempting to set cookies for URL: ${cookieUrl}`);

            if (tokens.accessToken) {
                logger.info(MODULE_NAME, '[WindowManager BaseWindowCookieDebug] Setting access token cookie');
                await webContentView.webContents.session.cookies.set({
                    url: cookieUrl,
                    name: 'access_token',
                    value: tokens.accessToken,
                    httpOnly: false,
                    secure: cookieUrl.startsWith('https'),
                    sameSite: 'lax'
                });
                logger.info(MODULE_NAME, '[WindowManager BaseWindowCookieDebug] Successfully set access token cookie');
            }

            if (tokens.refreshToken) {
                logger.info(MODULE_NAME, '[WindowManager BaseWindowCookieDebug] Setting refresh token cookie');
                await webContentView.webContents.session.cookies.set({
                    url: cookieUrl,
                    name: 'refresh_token',
                    value: tokens.refreshToken,
                    httpOnly: false,
                    secure: cookieUrl.startsWith('https'),
                    sameSite: 'lax'
                });
                logger.info(MODULE_NAME, '[WindowManager BaseWindowCookieDebug] Successfully set refresh token cookie');
            }

            if (tokens.user) {
                logger.info(MODULE_NAME, '[WindowManager BaseWindowCookieDebug] Setting user data cookie');
                await webContentView.webContents.session.cookies.set({
                    url: cookieUrl,
                    name: 'user_data',
                    value: JSON.stringify(tokens.user),
                    httpOnly: false,
                    secure: cookieUrl.startsWith('https'),
                    sameSite: 'lax'
                });
                logger.info(MODULE_NAME, '[WindowManager BaseWindowCookieDebug] Successfully set user data cookie');
            }

            logger.info(MODULE_NAME, '[WindowManager BaseWindowCookieDebug] All cookies set successfully');
        } catch (error) {
            logger.error(MODULE_NAME, '[WindowManager BaseWindowCookieDebug] Error setting cookies:', error);
        }
    }

    // Enhanced method to create external website window with authentication
    public async createExternalWebWindow(url: string, options: { 
        width?: number, 
        height?: number, 
        title?: string,
        enableAuth?: boolean 
    } = {}): Promise<BrowserWindow | null> {
        try {
            const { width = 1200, height = 800, title = 'External Website', enableAuth = true } = options;
            
            // Create external web window with authentication preload
            const externalWindow = new BrowserWindow({
                width,
                height,
                title,
                webPreferences: {
                    nodeIntegration: false,
                    contextIsolation: true,
                    preload: enableAuth ? 
                        getPreloadPath('webview-preload.mjs') : undefined,
                    webSecurity: true,
                    allowRunningInsecureContent: false,
                    devTools: !app.isPackaged // Disable DevTools in production
                },
                show: false,
                resizable: true,
                minimizable: true,
                maximizable: true,
                closable: true,
                icon: getIconPath(),
                autoHideMenuBar: true,
                center: true, // Center the window on screen
                skipTaskbar: false, // Ensure it appears in taskbar
                alwaysOnTop: false // Don't make it always on top
            });
            
            logger.info(MODULE_NAME, `Created external window with dimensions: ${width}x${height}, title: ${title}`);

            // Set up authentication for external website if enabled
            if (enableAuth) {
                logger.info(MODULE_NAME, `Setting up authentication for external window: ${url}`);
                
                // Get current auth tokens from auth manager
                const authModule = await import('./auth-manager');
                const currentTokens = authModule.getCurrentAuthTokens();
                
                logger.info(MODULE_NAME, `Current tokens available: ${!!currentTokens}`);
                if (currentTokens) {
                    logger.info(MODULE_NAME, `Access token present: ${!!currentTokens.accessToken}, Refresh token present: ${!!currentTokens.refreshToken}`);
                    
                    // Set cookies for the external domain if it's our server domain
                    await this._setExternalWebsiteCookies(externalWindow, url, currentTokens);
                    
                    // Send tokens to the webview via IPC once loaded
                    externalWindow.webContents.once('dom-ready', () => {
                        logger.info(MODULE_NAME, 'DOM ready, sending auth tokens via IPC');
                        externalWindow.webContents.send('auth-tokens-updated', {
                            accessToken: currentTokens.accessToken,
                            refreshToken: currentTokens.refreshToken,
                            user: currentTokens.user
                        });
                    });
                } else {
                    logger.warn(MODULE_NAME, 'No authentication tokens available for external window');
                }
            }

            // Load the external URL
            logger.info(MODULE_NAME, `Loading URL in external window: ${url}`);
            await externalWindow.loadURL(url);
            
            // Show window once loaded
            externalWindow.once('ready-to-show', () => {
                logger.info(MODULE_NAME, `External window ready to show - displaying now`);
                externalWindow.show();
                externalWindow.focus(); // Ensure it's brought to front
            });
            
            // Backup show mechanism - force show after 3 seconds if ready-to-show doesn't fire
            const showTimeout = setTimeout(() => {
                if (!externalWindow.isDestroyed() && !externalWindow.isVisible()) {
                    logger.warn(MODULE_NAME, `ready-to-show didn't fire, forcing window to show`);
                    externalWindow.show();
                    externalWindow.focus();
                }
            }, 3000);
            
            // Add additional debugging
            externalWindow.webContents.on('did-finish-load', () => {
                logger.info(MODULE_NAME, `External window finished loading: ${url}`);
                clearTimeout(showTimeout); // Cancel backup show since page loaded
                // Force show if not already visible
                if (!externalWindow.isDestroyed() && !externalWindow.isVisible()) {
                    logger.info(MODULE_NAME, `Page loaded but window not visible, showing now`);
                    externalWindow.show();
                    externalWindow.focus();
                }
            });
            
            externalWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
                logger.error(MODULE_NAME, `External window failed to load: ${errorCode} - ${errorDescription}`);
                clearTimeout(showTimeout);
            });
            
            externalWindow.webContents.on('did-start-loading', () => {
                logger.info(MODULE_NAME, `External window started loading: ${url}`);
            });

            // Handle window closed
            externalWindow.on('closed', () => {
                logger.info(MODULE_NAME, `External web window closed: ${url}`);
            });

            // Clean up timeout if window is destroyed
            externalWindow.on('closed', () => {
                clearTimeout(showTimeout);
                logger.info(MODULE_NAME, `External web window closed: ${url}`);
            });
            
            logger.info(MODULE_NAME, `Created external web window for: ${url}`);
            return externalWindow;
            
        } catch (error) {
            logger.error(MODULE_NAME, 'Failed to create external web window:', error);
            return null;
        }
    }

    // Set authentication cookies for external websites
    private async _setExternalWebsiteCookies(window: BrowserWindow, url: string, tokens: AuthTokens): Promise<void> {
        try {
            const urlObj = new URL(url);
            const domain = urlObj.hostname;
            
            // Only set cookies for trusted domains (our server domains)
            const trustedDomains = [
                'killfeed.sinfulshadows.com',
                'server-killfeed.sinfulshadows.com',
                'voidlog.gg',
                'localhost' // For development
            ];
            
            const isTrustedDomain = trustedDomains.some(trusted => 
                domain === trusted || domain.endsWith(`.${trusted}`)
            );
            
            if (!isTrustedDomain) {
                logger.debug(MODULE_NAME, `Skipping cookie injection for untrusted domain: ${domain}`);
                return;
            }

            const session = window.webContents.session;
            const cookieOptions = {
                url: urlObj.origin,
                httpOnly: false,
                secure: urlObj.protocol === 'https:',
                sameSite: 'lax' as const
            };

            logger.info(MODULE_NAME, `Setting cookies for domain: ${domain} with tokens: access=${!!tokens.accessToken}, refresh=${!!tokens.refreshToken}`);
            
            // Set authentication cookies
            await Promise.all([
                session.cookies.set({
                    ...cookieOptions,
                    name: 'access_token',
                    value: tokens.accessToken || '',
                    expirationDate: Date.now() / 1000 + (15 * 60) // 15 minutes
                }).then(() => logger.info(MODULE_NAME, 'Successfully set access_token cookie')),
                session.cookies.set({
                    ...cookieOptions,
                    name: 'refresh_token',
                    value: tokens.refreshToken || '',
                    httpOnly: true,
                    expirationDate: Date.now() / 1000 + (7 * 24 * 60 * 60) // 7 days
                }).then(() => logger.info(MODULE_NAME, 'Successfully set refresh_token cookie')),
                session.cookies.set({
                    ...cookieOptions,
                    name: 'user_data',
                    value: JSON.stringify(tokens.user || {}),
                    expirationDate: Date.now() / 1000 + (24 * 60 * 60) // 24 hours
                }).then(() => logger.info(MODULE_NAME, 'Successfully set user_data cookie'))
            ]);

            logger.info(MODULE_NAME, `Set authentication cookies for domain: ${domain}`);
            
        } catch (error) {
            logger.error(MODULE_NAME, 'Failed to set external website cookies:', error);
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

export function getPreloadPath(filename: string): string {
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
    setupDevToolsSecurity(mainWindow, 'main window');

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
    setupDevToolsSecurity(settingsWindow, 'settings window');

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
    setupDevToolsSecurity(detailsWindow, 'event details window');
    
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

export function createWebContentBaseWindow(section?: 'profile' | 'leaderboard' | 'map'): BaseWindow | null {
    if (webContentBaseWindow) {
        if (webContentBaseWindow.isMinimized()) {
            webContentBaseWindow.restore(); // Restore if minimized
        }
        webContentBaseWindow.focus(); // Bring to front

        // Check if section needs changing
        const newSection = section || null; // Default to null if undefined
        if (newSection && newSection !== currentWebContentSection) {
            logger.info(MODULE_NAME, `Switching section from ${currentWebContentSection} to ${newSection}`);
            // Send IPC to renderer to navigate
            if (webContentView && !webContentView.webContents.isDestroyed()) {
                webContentView.webContents.send('navigate-to-section', newSection);
            }
            // Update tracked section
            currentWebContentSection = newSection;
            // Send status update to main window
            getMainWindow()?.webContents.send('web-content-window-status', { isOpen: true, activeSection: currentWebContentSection });
            logger.info(MODULE_NAME, `Sent web-content-window-status update for section switch: { isOpen: true, activeSection: ${currentWebContentSection} }`);
        } else {
             logger.debug(MODULE_NAME, `Requested section (${section}) is same as current (${currentWebContentSection}) or null. No navigation needed.`);
        }
        return webContentBaseWindow; // Return existing window
    }

    // --- Create New BaseWindow ---
    logger.info(MODULE_NAME, `Creating new web content BaseWindow for section: ${section}`);
    currentWebContentSection = section || null; // Set initial section *before* loading

    // --- Web Content Window Bounds ---
    const savedBounds = store.get('webContentWindowBounds');
    const defaultWidth = 1024;
    const defaultHeight = 768;

    let windowBounds = {
        x: undefined as number | undefined,
        y: undefined as number | undefined,
        width: defaultWidth,
        height: defaultHeight
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
            windowBounds.x = savedBounds.x;
            windowBounds.y = savedBounds.y;
            windowBounds.width = savedBounds.width;
            windowBounds.height = savedBounds.height;
        } else {
            logger.warn(MODULE_NAME, 'Saved web content window bounds are outside visible screen area. Using defaults.');
            store.delete('webContentWindowBounds'); // Clear invalid bounds
        }
    } else {
        logger.info(MODULE_NAME, `No saved web content bounds found. Using default size: ${defaultWidth}x${defaultHeight}`);
    }

    // Create the BaseWindow
    webContentBaseWindow = new BaseWindow({
        ...windowBounds,
        title: 'SC Feeder - Web Content',
        titleBarStyle: 'hidden',
        autoHideMenuBar: true,
        show: false, // Don't show until ready
        resizable: true,
        minimizable: true,
        maximizable: true,
        closable: true,
        skipTaskbar: false,
        alwaysOnTop: false,
        minWidth: 800,
        minHeight: 600,
        backgroundColor: '#1a1a1a'
    });

    // Set icon if available
    const iconPath = getIconPath();
    if (iconPath) {
        webContentBaseWindow.setIcon(iconPath);
    }

    // Create the navigation header view
    const headerHeight = 80;
    const headerView = new WebContentsView({
        webPreferences: {
            preload: getPreloadPath('preload.mjs'),
            nodeIntegration: false,
            contextIsolation: true,
            devTools: !app.isPackaged,
            spellcheck: false,
            webSecurity: app.isPackaged
        }
    });

    // Create the web content view
    webContentView = new WebContentsView({
        webPreferences: {
            preload: getPreloadPath('webview-preload.mjs'),
            nodeIntegration: false,
            contextIsolation: true,
            devTools: !app.isPackaged,
            spellcheck: false,
            webSecurity: app.isPackaged,
            partition: 'persist:logmonitorweb'
        }
    });

    // Add views to the BaseWindow
    webContentBaseWindow.contentView.addChildView(headerView);
    webContentBaseWindow.contentView.addChildView(webContentView);

    // Set up view bounds
    const updateViewBounds = () => {
        const bounds = webContentBaseWindow!.getBounds();
        
        // Header view at the top
        headerView.setBounds({
            x: 0,
            y: 0,
            width: bounds.width,
            height: headerHeight
        });

        // Web content view below header
        webContentView!.setBounds({
            x: 0,
            y: headerHeight,
            width: bounds.width,
            height: bounds.height - headerHeight
        });
    };

    // Initial bounds setup
    updateViewBounds();

    // Update bounds when window resizes
    webContentBaseWindow.on('resize', updateViewBounds);

    // Load the navigation header content
    const loadHeaderContent = () => {
        const isDevelopment = process.env.NODE_ENV === 'development';
        const devServerUrl = process.env['VITE_DEV_SERVER_URL'];
        
        if (devServerUrl) {
            // In development, create a simple header HTML
            const headerHtml = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>Navigation Header</title>
    <style>
        body {
            margin: 0;
            padding: 0;
            height: 100vh;
            background: #171717;
            border-bottom: 1px solid #262626;
            display: flex;
            align-items: center;
            justify-content: flex-start;
            padding-left: 50px;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            color: #e5e5e5;
            user-select: none;
            -webkit-app-region: drag;
        }
        .nav-buttons {
            display: flex;
            gap: 16px;
            -webkit-app-region: no-drag;
        }
        .nav-btn {
            padding: 8px 16px;
            border: none;
            border-radius: 6px;
            background: transparent;
            color: #e5e5e5;
            cursor: pointer;
            font-size: 14px;
            font-weight: 500;
            transition: all 0.2s;
        }
        .nav-btn:hover {
            background: rgba(255, 255, 255, 0.05);
            color: #4d4dea;
        }
        .nav-btn.active {
            background: rgba(255, 255, 255, 0.05);
            color: #6363f7;
        }
        .window-controls {
            position: absolute;
            top: 0;
            right: 0;
            height: 100%;
            display: flex;
            -webkit-app-region: no-drag;
        }
        .control-btn {
            width: 46px;
            height: 100%;
            border: none;
            background: transparent;
            color: #e5e5e5;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 12px;
        }
        .control-btn:hover {
            background: rgba(255, 255, 255, 0.1);
        }
        .control-btn.close:hover {
            background: #e81123;
        }
    </style>
</head>
<body>
    <div class="nav-buttons">
        <button class="nav-btn" data-section="profile" id="profile-btn">Profile</button>
        <button class="nav-btn" data-section="leaderboard" id="leaderboard-btn">Leaderboard</button>
        <button class="nav-btn" data-section="map" id="map-btn">Map</button>
    </div>
    <div class="window-controls">
        <button class="control-btn minimize" id="minimize-btn">—</button>
        <button class="control-btn maximize" id="maximize-btn">⧠</button>
        <button class="control-btn close" id="close-btn">×</button>
    </div>
    <script>
        // Set active section based on initial value
        const currentSection = '${section || 'profile'}';
        document.querySelectorAll('.nav-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.section === currentSection);
        });
        
        // Handle navigation clicks
        document.querySelectorAll('.nav-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const section = btn.dataset.section;
                document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                
                // Send section change to main process
                window.electronAPI?.invoke('web-content-section-change', section);
            });
        });
        
        // Handle window controls
        document.getElementById('minimize-btn').addEventListener('click', () => {
            window.electronAPI?.invoke('web-content-window-minimize');
        });
        
        document.getElementById('maximize-btn').addEventListener('click', () => {
            window.electronAPI?.invoke('web-content-window-maximize');
        });
        
        document.getElementById('close-btn').addEventListener('click', () => {
            window.electronAPI?.invoke('web-content-window-close');
        });
        
        // Listen for section changes from main process
        window.addEventListener('section-changed', (event) => {
            const section = event.detail.section;
            document.querySelectorAll('.nav-btn').forEach(btn => {
                btn.classList.toggle('active', btn.dataset.section === section);
            });
        });
    </script>
</body>
</html>`;
            headerView.webContents.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(headerHtml)}`);
        } else {
            // In production, use the same header HTML
            const headerHtml = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>Navigation Header</title>
    <style>
        body {
            margin: 0;
            padding: 0;
            height: 100vh;
            background: #171717;
            border-bottom: 1px solid #262626;
            display: flex;
            align-items: center;
            justify-content: flex-start;
            padding-left: 50px;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            color: #e5e5e5;
            user-select: none;
            -webkit-app-region: drag;
        }
        .nav-buttons {
            display: flex;
            gap: 16px;
            -webkit-app-region: no-drag;
        }
        .nav-btn {
            padding: 8px 16px;
            border: none;
            border-radius: 6px;
            background: transparent;
            color: #e5e5e5;
            cursor: pointer;
            font-size: 14px;
            font-weight: 500;
            transition: all 0.2s;
        }
        .nav-btn:hover {
            background: rgba(255, 255, 255, 0.05);
            color: #4d4dea;
        }
        .nav-btn.active {
            background: rgba(255, 255, 255, 0.05);
            color: #6363f7;
        }
        .window-controls {
            position: absolute;
            top: 0;
            right: 0;
            height: 100%;
            display: flex;
            -webkit-app-region: no-drag;
        }
        .control-btn {
            width: 46px;
            height: 100%;
            border: none;
            background: transparent;
            color: #e5e5e5;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 12px;
        }
        .control-btn:hover {
            background: rgba(255, 255, 255, 0.1);
        }
        .control-btn.close:hover {
            background: #e81123;
        }
    </style>
</head>
<body>
    <div class="nav-buttons">
        <button class="nav-btn" data-section="profile" id="profile-btn">Profile</button>
        <button class="nav-btn" data-section="leaderboard" id="leaderboard-btn">Leaderboard</button>
        <button class="nav-btn" data-section="map" id="map-btn">Map</button>
    </div>
    <div class="window-controls">
        <button class="control-btn minimize" id="minimize-btn">—</button>
        <button class="control-btn maximize" id="maximize-btn">⧠</button>
        <button class="control-btn close" id="close-btn">×</button>
    </div>
    <script>
        // Set active section based on initial value
        const currentSection = '${section || 'profile'}';
        document.querySelectorAll('.nav-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.section === currentSection);
        });
        
        // Handle navigation clicks
        document.querySelectorAll('.nav-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const section = btn.dataset.section;
                document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                
                // Send section change to main process (simplified for embedded context)
                console.log('Section change requested:', section);
            });
        });
        
        // Handle window controls
        document.getElementById('minimize-btn').addEventListener('click', () => {
            console.log('Minimize clicked');
        });
        
        document.getElementById('maximize-btn').addEventListener('click', () => {
            console.log('Maximize clicked');
        });
        
        document.getElementById('close-btn').addEventListener('click', () => {
            console.log('Close clicked');
        });
        
        // Listen for section changes from main process
        window.addEventListener('section-changed', (event) => {
            const section = event.detail.section;
            document.querySelectorAll('.nav-btn').forEach(btn => {
                btn.classList.toggle('active', btn.dataset.section === section);
            });
        });
    </script>
</body>
</html>`;
            headerView.webContents.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(headerHtml)}`);
        }
    };

    // Load the web content
    const loadWebContent = () => {
        const isDevelopment = process.env.NODE_ENV === 'development';
        const webAppBaseUrl = isDevelopment
            ? 'http://localhost:3001'
            : 'https://killfeed.sinfulshadows.com';
        
        let url = '';
        
        if (section === 'profile') {
            url = `${webAppBaseUrl}/profile?source=electron`;
        } else if (section === 'leaderboard') {
            url = `${webAppBaseUrl}/leaderboard?source=electron`;
        } else if (section === 'map') {
            url = `${webAppBaseUrl}/map?source=electron`;
        } else {
            url = `${webAppBaseUrl}?source=electron`;
        }
        
        logger.info(MODULE_NAME, `Loading web content: ${url}`);
        webContentView?.webContents.loadURL(url);
    };

    // Force DevTools open for web content view in development
    if (!app.isPackaged) {
        setupDevToolsSecurity({ webContents: webContentView.webContents } as any, 'web content view');
    }

    // Load content when ready
    (webContentBaseWindow as any).once('ready-to-show', () => {
        loadHeaderContent();
        loadWebContent();
        
        webContentBaseWindow?.show();
        if (!app.isPackaged) {
            // Open dev tools for debugging
            headerView.webContents.openDevTools({ mode: 'detach' });
            webContentView?.webContents.openDevTools({ mode: 'detach' });
        }
    });

    // Handle window closed
    webContentBaseWindow.on('closed', () => {
        webContentBaseWindow = null;
        webContentView = null;
        currentWebContentSection = null;
        logger.info(MODULE_NAME, 'Web content BaseWindow closed. Cleared active section.');
        
        // Send status update to main window
        getMainWindow()?.webContents.send('web-content-window-status', { isOpen: false, activeSection: null });
    });

    // --- Save Web Content Window Bounds ---
    const saveWebContentBounds = createSaveBoundsHandler(webContentBaseWindow as any, 'webContentWindowBounds');
    webContentBaseWindow.on('resize', saveWebContentBounds);
    webContentBaseWindow.on('move', saveWebContentBounds);

    // Send initial status update to main window
    getMainWindow()?.webContents.send('web-content-window-status', { isOpen: true, activeSection: currentWebContentSection });

    return webContentBaseWindow;
}

export function createWebContentWindow(section?: 'profile' | 'leaderboard' | 'map' | 'events' | 'stats' | 'profile-settings'): BrowserWindow | null {
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
    setupDevToolsSecurity(webContentWindow, 'web content window');

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
        // Send status update to main window
        getMainWindow()?.webContents.send('web-content-window-status', { isOpen: false, activeSection: null });
        logger.info(MODULE_NAME, 'Web content window closed. Cleared active section and sent status update.');
    });

    // --- Save Web Content Window Bounds ---
    const saveWebContentBounds = createSaveBoundsHandler(webContentWindow, 'webContentWindowBounds');
    webContentWindow.on('resize', saveWebContentBounds);
    webContentWindow.on('move', saveWebContentBounds);

    return webContentWindow;
}

// New authenticated WebContentsView-based web content window
export function createAuthenticatedWebContentWindow(section?: 'profile' | 'leaderboard' | 'map' | 'events' | 'stats'): BaseWindow | null {
    // Check if we should reuse existing window
    if (webContentBaseWindow && webContentView) {
        if (webContentBaseWindow.isMinimized()) {
            webContentBaseWindow.restore();
        }
        webContentBaseWindow.focus();

        // Handle section navigation
        const newSection = section || null;
        if (newSection && newSection !== currentWebContentSection) {
            logger.info(MODULE_NAME, `[AuthWebContents] Switching section from ${currentWebContentSection} to ${newSection}`);
            currentWebContentSection = newSection;
            
            // Navigate to new section
            const isDevelopment = process.env.NODE_ENV === 'development';
            const webAppBaseUrl = isDevelopment
                ? 'http://localhost:3001'
                : 'https://killfeed.sinfulshadows.com';
            
            let newUrl = '';
            if (newSection === 'profile') {
                newUrl = `${webAppBaseUrl}/profile?source=electron&auth=webcontents`;
            } else if (newSection === 'leaderboard') {
                newUrl = `${webAppBaseUrl}/leaderboard?source=electron&auth=webcontents`;
            } else if (newSection === 'map') {
                newUrl = `${webAppBaseUrl}/map?source=electron&auth=webcontents`;
            } else if (newSection === 'events') {
                newUrl = `${webAppBaseUrl}/events?source=electron&auth=webcontents`;
            } else if (newSection === 'stats') {
                newUrl = `${webAppBaseUrl}/stats?source=electron&auth=webcontents`;
            } else {
                newUrl = `${webAppBaseUrl}?source=electron&auth=webcontents`;
            }
            
            webContentView.webContents.loadURL(newUrl);
            
            // Send status update to main window
            getMainWindow()?.webContents.send('web-content-window-status', { 
                isOpen: true, 
                activeSection: currentWebContentSection,
                windowType: 'webcontents-view' 
            });
        }
        
        return webContentBaseWindow;
    }

    logger.info(MODULE_NAME, `[AuthWebContents] Creating new authenticated web content window for section: ${section}`);
    currentWebContentSection = section || null;

    // Get saved bounds
    const savedBounds = store.get('webContentWindowBounds');
    const defaultWidth = 1024;
    const defaultHeight = 768;

    const baseWindowOptions = {
        width: defaultWidth,
        height: defaultHeight,
        x: undefined as number | undefined,
        y: undefined as number | undefined,
        title: 'SC Feeder - Web Content (Authenticated)',
        titleBarStyle: 'hiddenInset' as const,
        show: false,
        backgroundColor: '#1a1a1a',
        minWidth: 800,
        minHeight: 600
    };

    // Apply saved bounds if valid
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
            logger.info(MODULE_NAME, '[AuthWebContents] Applying saved bounds:', savedBounds);
            baseWindowOptions.x = savedBounds.x;
            baseWindowOptions.y = savedBounds.y;
            baseWindowOptions.width = savedBounds.width;
            baseWindowOptions.height = savedBounds.height;
        }
    }

    try {
        // Create BaseWindow
        webContentBaseWindow = new BaseWindow(baseWindowOptions);
        logger.info(MODULE_NAME, '[AuthWebContents] Created BaseWindow');

        // Determine URL based on section and environment
        const isDevelopment = process.env.NODE_ENV === 'development';
        const webAppBaseUrl = isDevelopment
            ? 'http://localhost:3001'
            : 'https://killfeed.sinfulshadows.com';
        
        let webContentUrl = '';
        if (currentWebContentSection === 'profile') {
            webContentUrl = `${webAppBaseUrl}/profile?source=electron&auth=webcontents`;
        } else if (currentWebContentSection === 'leaderboard') {
            webContentUrl = `${webAppBaseUrl}/leaderboard?source=electron&auth=webcontents`;
        } else if (currentWebContentSection === 'map') {
            webContentUrl = `${webAppBaseUrl}/map?source=electron&auth=webcontents`;
        } else {
            webContentUrl = `${webAppBaseUrl}?source=electron&auth=webcontents`;
        }

        // Create authenticated WebContentsView
        webContentView = webContentsViewAuth.createAuthenticatedWebContentsView({
            url: webContentUrl,
            partition: 'persist:authenticated-webcontent',
            enableAuth: true
        });

        logger.info(MODULE_NAME, '[AuthWebContents] Created authenticated WebContentsView');

        // Set up the WebContentsView in the BaseWindow
        webContentBaseWindow.contentView = webContentView;
        webContentView.setBounds({ x: 0, y: 0, width: baseWindowOptions.width, height: baseWindowOptions.height });

        // Handle window ready to show
        (webContentBaseWindow as any).once('ready-to-show', () => {
            logger.info(MODULE_NAME, '[AuthWebContents] BaseWindow ready to show');
            webContentBaseWindow?.show();
            
            // Open dev tools in development
            if (!app.isPackaged) {
                webContentView?.webContents.openDevTools({ mode: 'detach' });
            }
        });

        // Handle window resize to update WebContentsView bounds
        webContentBaseWindow.on('resize', () => {
            if (webContentView && webContentBaseWindow) {
                const bounds = webContentBaseWindow.getBounds();
                webContentView.setBounds({ x: 0, y: 0, width: bounds.width, height: bounds.height });
            }
        });

        // Handle window closed
        webContentBaseWindow.on('closed', () => {
            logger.info(MODULE_NAME, '[AuthWebContents] BaseWindow closed');
            webContentBaseWindow = null;
            webContentView = null;
            currentWebContentSection = null;
            
            // Send status update to main window
            getMainWindow()?.webContents.send('web-content-window-status', { 
                isOpen: false, 
                activeSection: null,
                windowType: 'webcontents-view' 
            });
        });

        // Set up authentication token updates
        const updateAuthTokens = async () => {
            if (webContentView) {
                const currentTokens = AuthManager.getCurrentAuthTokens();
                await webContentsViewAuth.updateAuthTokens(webContentView, currentTokens);
            }
        };

        // Listen for auth status changes from AuthManager
        ipcMain.on('auth-status-changed-internal', updateAuthTokens);

        // Clean up listener when window closes
        webContentBaseWindow.once('closed', () => {
            ipcMain.removeListener('auth-status-changed-internal', updateAuthTokens);
        });

        // Save window bounds
        const saveWebContentBounds = createSaveBoundsHandler(webContentBaseWindow as any, 'webContentWindowBounds');
        webContentBaseWindow.on('resize', saveWebContentBounds);
        webContentBaseWindow.on('move', saveWebContentBounds);

        // Send initial status update
        getMainWindow()?.webContents.send('web-content-window-status', { 
            isOpen: true, 
            activeSection: currentWebContentSection,
            windowType: 'webcontents-view' 
        });

        logger.info(MODULE_NAME, '[AuthWebContents] Authenticated web content window created successfully');
        return webContentBaseWindow;

    } catch (error) {
        logger.error(MODULE_NAME, '[AuthWebContents] Failed to create authenticated web content window:', error);
        
        // Clean up on error
        if (webContentBaseWindow) {
            webContentBaseWindow.close();
            webContentBaseWindow = null;
        }
        if (webContentView) {
            webContentView = null;
        }
        
        return null;
    }
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

export function closeWebContentBaseWindow(): void {
  if (webContentBaseWindow && !webContentBaseWindow.isDestroyed()) {
    webContentBaseWindow.close();
    webContentBaseWindow = null;
    webContentView = null;
    currentWebContentSection = null;
  }
}

export function closeAuthenticatedWebContentWindow(): void {
  if (webContentBaseWindow && !webContentBaseWindow.isDestroyed()) {
    logger.info(MODULE_NAME, '[AuthWebContents] Closing authenticated web content window');
    webContentBaseWindow.close();
    webContentBaseWindow = null;
    webContentView = null;
    currentWebContentSection = null;
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
  setupDevToolsSecurity(loginWindow, 'login window');
  
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

export function getWebContentWindow(): BrowserWindow | null {
    return webContentWindow;
}

export function getSettingsWindow(): BrowserWindow | null {
    return settingsWindow;
}

export function getSettingsStatus(): { isOpen: boolean } {
    return { isOpen: settingsWindow !== null };
}

export function getWebContentStatus(): { isOpen: boolean, activeSection: 'profile' | 'leaderboard' | 'map' | 'events' | 'stats' | 'profile-settings' | null } {
    return { isOpen: webContentWindow !== null || webContentBaseWindow !== null, activeSection: currentWebContentSection };
}

// Export BaseWindow variables for IPC access
export { webContentBaseWindow, webContentView };

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

// Enhanced function to send auth tokens to web content window (supports both architectures)
export async function sendAuthTokensToWebContentWindow(tokens: AuthTokens | null): Promise<void> {
    try {
        // Try new WebContentsView architecture first
        const manager = await getWebContentsViewManager();
        if (manager && manager.updateAuthTokens) {
            logger.debug(MODULE_NAME, 'Sending auth tokens via WebContentsView manager');
            manager.updateAuthTokens(tokens);
        }
    } catch (error) {
        logger.warn(MODULE_NAME, 'Failed to send tokens via WebContentsView manager:', error);
    }

    // Also send via legacy WindowManager for backward compatibility
    try {
        windowManager.sendAuthTokensToWebContentWindow(tokens);
    } catch (error) {
        logger.warn(MODULE_NAME, 'Failed to send tokens via legacy WindowManager:', error);
    }
}

// Function to send auth tokens specifically to WebContentsView architecture
export async function sendAuthTokensToWebContentBaseWindow(tokens: AuthTokens | null): Promise<void> {
    try {
        logger.debug(MODULE_NAME, 'Sending auth tokens to WebContentBaseWindow');
        
        if (webContentBaseWindow && webContentView) {
            // Set authentication cookies directly
            const session = webContentView.webContents.session;
            const currentUrl = webContentView.webContents.getURL();
            
            if (tokens && currentUrl) {
                logger.info(MODULE_NAME, 'Setting authentication cookies for WebContentBaseWindow');
                // Note: Cookie setting method is private - would need to implement public method
                // await windowManager._setExternalWebsiteCookies(
                //     { webContents: { session } } as any,
                //     currentUrl,
                //     tokens
                // );
            }
            
            // Send tokens via IPC
            webContentView.webContents.send('auth-tokens-updated', {
                accessToken: tokens?.accessToken || null,
                refreshToken: tokens?.refreshToken || null,
                user: tokens?.user || null
            });
            
            logger.info(MODULE_NAME, 'Auth tokens sent to WebContentBaseWindow successfully');
        } else {
            logger.warn(MODULE_NAME, 'WebContentBaseWindow or WebContentView not available');
        }
    } catch (error) {
        logger.error(MODULE_NAME, 'Failed to send auth tokens to WebContentBaseWindow:', error);
    }
}

// Enhanced WebContentsView Manager Integration
import { 
    createWebContentViewManager, 
    getWebContentViewManager, 
    closeWebContentViewManager 
} from './webcontents-view-manager';

// Create WebContentsView-based window (new architecture)
export async function createEnhancedWebContentWindow(
    section: 'profile' | 'leaderboard' | 'map' = 'profile'
): Promise<boolean> {
    try {
        logger.info(MODULE_NAME, `Creating enhanced WebContentView window for section: ${section}`);
        
        const manager = await createWebContentViewManager();
        await manager.navigateToSection(section);
        manager.show();
        
        // Update current section tracking
        currentWebContentSection = section;
        
        // Send status update to main window
        getMainWindow()?.webContents.send('web-content-window-status', {
            isOpen: true,
            activeSection: section,
            architecture: 'webcontentsview'
        });
        
        logger.info(MODULE_NAME, 'Enhanced WebContentView window created successfully');
        return true;
    } catch (error) {
        logger.error(MODULE_NAME, 'Failed to create enhanced WebContentView window:', error);
        return false;
    }
}

// Close WebContentsView-based window
export function closeEnhancedWebContentWindow(): boolean {
    try {
        const success = closeWebContentViewManager();
        
        if (success) {
            currentWebContentSection = null;
            
            // Send status update to main window
            getMainWindow()?.webContents.send('web-content-window-status', {
                isOpen: false,
                activeSection: null,
                architecture: 'webcontentsview'
            });
        }
        
        return success;
    } catch (error) {
        logger.error(MODULE_NAME, 'Failed to close enhanced WebContentView window:', error);
        return false;
    }
}

// Get enhanced WebContentView status
export function getEnhancedWebContentStatus(): {
    isOpen: boolean;
    activeSection: 'profile' | 'leaderboard' | 'map' | null;
    architecture: string;
    authenticationEnabled: boolean;
} {
    try {
        const manager = getWebContentViewManager();
        
        if (manager) {
            return {
                isOpen: manager.isVisible(),
                activeSection: manager.getCurrentSection(),
                architecture: 'webcontentsview',
                authenticationEnabled: manager.isAuthenticationEnabled()
            };
        } else {
            return {
                isOpen: false,
                activeSection: null,
                architecture: 'none',
                authenticationEnabled: false
            };
        }
    } catch (error) {
        logger.error(MODULE_NAME, 'Failed to get enhanced WebContentView status:', error);
        return {
            isOpen: false,
            activeSection: null,
            architecture: 'error',
            authenticationEnabled: false
        };
    }
}

// Unified function that uses legacy BrowserWindow + WebContentsView integration
export async function createUnifiedWebContentWindow(
    section: 'profile' | 'leaderboard' | 'map' = 'profile'
): Promise<{ success: boolean; architecture: string; error?: string }> {
    try {
        // Use legacy BrowserWindow approach (which loads WebContentPage.vue)
        // WebContentPage.vue will automatically attach WebContentsView on load
        logger.info(MODULE_NAME, 'Creating web content window with BrowserWindow + WebContentsView integration');
        
        const legacyWindow = createWebContentWindow(section);
        
        if (legacyWindow) {
            return {
                success: true,
                architecture: 'browserwindow-with-webcontentsview'
            };
        } else {
            // Fallback to pure WebContentsView if BrowserWindow fails
            logger.warn(MODULE_NAME, 'BrowserWindow creation failed, falling back to pure WebContentsView');
            
            const success = await createEnhancedWebContentWindow(section);
            
            return {
                success: success,
                architecture: success ? 'webcontentsview' : 'failed'
            };
        }
    } catch (error) {
        logger.error(MODULE_NAME, 'Failed to create unified web content window:', error);
        
        // Final fallback to pure WebContentsView
        try {
            const success = await createEnhancedWebContentWindow(section);
            return {
                success: success,
                architecture: success ? 'webcontentsview' : 'failed',
                error: error instanceof Error ? error.message : 'Unknown error'
            };
        } catch (fallbackError) {
            return {
                success: false,
                architecture: 'failed',
                error: fallbackError instanceof Error ? fallbackError.message : 'Unknown error'
            };
        }
    }
}
export async function sendAuthTokensToWebContentsView(tokens: AuthTokens | null): Promise<void> {
    try {
        const manager = await getWebContentsViewManager();
        if (manager && manager.updateAuthTokens) {
            logger.debug(MODULE_NAME, 'Sending auth tokens to WebContentsView');
            manager.updateAuthTokens(tokens);
        } else {
            logger.warn(MODULE_NAME, 'WebContentsView manager not available for token update');
        }
    } catch (error) {
        logger.error(MODULE_NAME, 'Failed to send tokens to WebContentsView:', error);
    }
}

// Export function to create external web window with authentication
export function createExternalWebWindow(url: string, options?: { 
    width?: number, 
    height?: number, 
    title?: string,
    enableAuth?: boolean 
}): Promise<BrowserWindow | null> {
    return windowManager.createExternalWebWindow(url, options);
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