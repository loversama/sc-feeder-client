import { WebContentsView, session, BrowserWindow, ipcMain, app } from 'electron';
import path from 'node:path';
import fsSync from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as logger from './logger';
import * as AuthManager from './auth-manager';

const MODULE_NAME = 'WebContentsViewAuth';

// Define __dirname for ES module scope
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Type for auth tokens
interface AuthTokens {
    accessToken?: string;
    refreshToken?: string;
    user?: any;
}

// Function to get preload path
function getPreloadPath(filename: string): string {
    const appRoot = process.env.APP_ROOT;
    if (!appRoot) {
        logger.error(MODULE_NAME, "APP_ROOT not set when trying to get preload path. Cannot proceed.");
        throw new Error("APP_ROOT environment variable is not set.");
    }

    const mainDist = path.join(appRoot, 'dist-electron');
    let resolvedPath: string | undefined;

    if (process.env.NODE_ENV !== 'development') { // Production (default)
        resolvedPath = path.join(mainDist, filename);
        logger.info(MODULE_NAME, `[Prod Mode] Resolving preload path for: ${filename}. Checking: ${resolvedPath}`);
        if (!fsSync.existsSync(resolvedPath)) {
            logger.error(MODULE_NAME, `[Prod Mode] Preload path NOT FOUND: ${resolvedPath}. Preload script will fail to load.`);
        } else {
            logger.info(MODULE_NAME, `[Prod Mode] Preload path FOUND: ${resolvedPath}`);
        }
    } else { // Development
        const devPath = path.join(appRoot, 'electron', filename);
        logger.debug(MODULE_NAME, `[Dev Mode] Resolving preload path for: ${filename}. Checking: ${devPath}`);
        if (fsSync.existsSync(devPath)) {
            resolvedPath = devPath;
            logger.info(MODULE_NAME, `[Dev Mode] Preload path FOUND: ${resolvedPath}`);
        } else {
            logger.warn(MODULE_NAME, `[Dev Mode] Preload path NOT FOUND: ${devPath}. Attempting fallback.`);
            const devPathFallback = path.join(mainDist, filename);
            logger.debug(MODULE_NAME, `[Dev Mode] Checking fallback preload path: ${devPathFallback}`);
            if (fsSync.existsSync(devPathFallback)) {
                resolvedPath = devPathFallback;
                logger.info(MODULE_NAME, `[Dev Mode] Fallback preload path FOUND: ${resolvedPath}`);
            } else {
                logger.error(MODULE_NAME, `[Dev Mode] Fallback preload path NOT FOUND: ${devPathFallback}. Preload script will likely fail to load.`);
            }
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

export class WebContentsViewAuth {
    private webAppUrl: string = '';
    private trustedDomains: string[] = [
        'killfeed.sinfulshadows.com',
        'server-killfeed.sinfulshadows.com', 
        'voidlog.gg',
        'localhost' // For development
    ];

    constructor() {
        // Initialize webAppUrl from environment
        const isDevelopment = process.env.NODE_ENV === 'development';
        this.webAppUrl = isDevelopment
            ? 'http://localhost:3001'
            : 'https://killfeed.sinfulshadows.com';
        
        logger.info(MODULE_NAME, `Initialized with webAppUrl: ${this.webAppUrl}`);
    }

    // Create authenticated WebContentsView
    public createAuthenticatedWebContentsView(options: {
        url: string;
        partition?: string;
        enableAuth?: boolean;
        preloadScript?: string;
    }): WebContentsView {
        const { url, partition = 'persist:webcontents-auth', enableAuth = true, preloadScript = 'webcontents-view-preload.mjs' } = options;
        
        logger.info(MODULE_NAME, `Creating authenticated WebContentsView for URL: ${url}`);

        // Get the session for this partition
        const viewSession = session.fromPartition(partition);
        
        const webContentsView = new WebContentsView({
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
                preload: enableAuth ? getPreloadPath(preloadScript) : undefined,
                webSecurity: true,
                allowRunningInsecureContent: false,
                session: viewSession,
                devTools: !app.isPackaged // Disable DevTools in production
            }
        });

        // Set up authentication if enabled
        if (enableAuth) {
            this._setupAuthenticationForView(webContentsView, url, viewSession);
        }

        // Load the URL
        webContentsView.webContents.loadURL(url);

        logger.info(MODULE_NAME, `Created WebContentsView with session partition: ${partition}`);
        return webContentsView;
    }

    // Set up authentication for WebContentsView
    private async _setupAuthenticationForView(
        webContentsView: WebContentsView, 
        url: string, 
        viewSession: Electron.Session
    ): Promise<void> {
        try {
            const urlObj = new URL(url);
            const domain = urlObj.hostname;

            // Only set up authentication for trusted domains
            const isTrustedDomain = this.trustedDomains.some(trusted => 
                domain === trusted || domain.endsWith(`.${trusted}`)
            );

            if (!isTrustedDomain) {
                logger.debug(MODULE_NAME, `Skipping authentication setup for untrusted domain: ${domain}`);
                return;
            }

            logger.info(MODULE_NAME, `Setting up authentication for trusted domain: ${domain}`);

            // Get current auth tokens
            const currentTokens = AuthManager.getCurrentAuthTokens();
            
            if (currentTokens) {
                logger.info(MODULE_NAME, `Setting cookies for domain: ${domain} with tokens: access=${!!currentTokens.accessToken}, refresh=${!!currentTokens.refreshToken}`);
                await this._setAuthCookies(viewSession, url, currentTokens);
            }

            // Set up request interception for Authorization headers
            this._setupRequestInterception(viewSession, currentTokens);

            // Send tokens via IPC once DOM is ready
            webContentsView.webContents.once('dom-ready', () => {
                logger.info(MODULE_NAME, 'WebContentsView DOM ready, sending auth tokens via IPC');
                if (currentTokens) {
                    webContentsView.webContents.send('auth-tokens-updated', {
                        accessToken: currentTokens.accessToken,
                        refreshToken: currentTokens.refreshToken,
                        user: currentTokens.user
                    });
                } else {
                    webContentsView.webContents.send('auth-tokens-updated', null);
                }
            });

            // Handle navigation events
            webContentsView.webContents.on('did-navigate', (event, navigationUrl) => {
                logger.info(MODULE_NAME, `WebContentsView navigated to: ${navigationUrl}`);
                // Re-setup authentication for new URL if needed
                const newUrlObj = new URL(navigationUrl);
                const newDomain = newUrlObj.hostname;
                const isNewTrustedDomain = this.trustedDomains.some(trusted => 
                    newDomain === trusted || newDomain.endsWith(`.${trusted}`)
                );
                
                if (isNewTrustedDomain && currentTokens) {
                    this._setAuthCookies(viewSession, navigationUrl, currentTokens);
                }
            });

        } catch (error) {
            logger.error(MODULE_NAME, 'Failed to setup authentication for WebContentsView:', error);
        }
    }

    // Set authentication cookies (adapted from _setExternalWebsiteCookies)
    private async _setAuthCookies(
        viewSession: Electron.Session, 
        url: string, 
        tokens: AuthTokens
    ): Promise<void> {
        try {
            const urlObj = new URL(url);
            const cookieOptions = {
                url: urlObj.origin,
                httpOnly: false,
                secure: urlObj.protocol === 'https:',
                sameSite: 'lax' as const
            };

            logger.info(MODULE_NAME, `Setting cookies for URL: ${urlObj.origin}`);

            // Set authentication cookies
            const cookiePromises = [];

            if (tokens.accessToken) {
                cookiePromises.push(
                    viewSession.cookies.set({
                        ...cookieOptions,
                        name: 'access_token',
                        value: tokens.accessToken,
                        expirationDate: Date.now() / 1000 + (15 * 60) // 15 minutes
                    }).then(() => logger.info(MODULE_NAME, 'Successfully set access_token cookie'))
                );
            }

            if (tokens.refreshToken) {
                cookiePromises.push(
                    viewSession.cookies.set({
                        ...cookieOptions,
                        name: 'refresh_token',
                        value: tokens.refreshToken,
                        httpOnly: true,
                        expirationDate: Date.now() / 1000 + (7 * 24 * 60 * 60) // 7 days
                    }).then(() => logger.info(MODULE_NAME, 'Successfully set refresh_token cookie'))
                );
            }

            if (tokens.user) {
                cookiePromises.push(
                    viewSession.cookies.set({
                        ...cookieOptions,
                        name: 'user_data',
                        value: JSON.stringify(tokens.user),
                        expirationDate: Date.now() / 1000 + (24 * 60 * 60) // 24 hours
                    }).then(() => logger.info(MODULE_NAME, 'Successfully set user_data cookie'))
                );
            }

            await Promise.all(cookiePromises);
            logger.info(MODULE_NAME, `Set authentication cookies for: ${urlObj.origin}`);
            
        } catch (error) {
            logger.error(MODULE_NAME, 'Failed to set authentication cookies:', error);
        }
    }

    // Set up request interception for Authorization headers
    private _setupRequestInterception(
        viewSession: Electron.Session, 
        tokens: AuthTokens | null
    ): void {
        if (!tokens?.accessToken) {
            logger.info(MODULE_NAME, 'No access token available for request interception');
            return;
        }

        // Set up request interception
        viewSession.webRequest.onBeforeSendHeaders((details, callback) => {
            const url = details.url;
            const isApiRequest = url.includes('/api/') || 
                                this.trustedDomains.some(domain => url.includes(domain));

            if (isApiRequest && tokens.accessToken) {
                // Add Authorization header if not already present
                if (!details.requestHeaders['Authorization']) {
                    details.requestHeaders['Authorization'] = `Bearer ${tokens.accessToken}`;
                    logger.debug(MODULE_NAME, `Added Authorization header to request: ${url}`);
                }
            }

            callback({ requestHeaders: details.requestHeaders });
        });

        logger.info(MODULE_NAME, 'Set up request interception for Authorization headers');
    }

    // Update authentication tokens for existing WebContentsView
    public async updateAuthTokens(
        webContentsView: WebContentsView, 
        tokens: AuthTokens | null
    ): Promise<void> {
        try {
            const currentUrl = webContentsView.webContents.getURL();
            if (!currentUrl) {
                logger.warn(MODULE_NAME, 'Cannot update auth tokens - no current URL');
                return;
            }

            const urlObj = new URL(currentUrl);
            const domain = urlObj.hostname;
            
            // Only update for trusted domains
            const isTrustedDomain = this.trustedDomains.some(trusted => 
                domain === trusted || domain.endsWith(`.${trusted}`)
            );

            if (!isTrustedDomain) {
                logger.debug(MODULE_NAME, `Skipping auth token update for untrusted domain: ${domain}`);
                return;
            }

            logger.info(MODULE_NAME, `Updating auth tokens for WebContentsView on domain: ${domain}`);

            // Update cookies
            if (tokens) {
                await this._setAuthCookies(webContentsView.webContents.session, currentUrl, tokens);
            } else {
                // Clear auth cookies
                await this._clearAuthCookies(webContentsView.webContents.session, currentUrl);
            }

            // Send updated tokens via IPC
            webContentsView.webContents.send('auth-tokens-updated', tokens);

            logger.info(MODULE_NAME, 'Successfully updated auth tokens for WebContentsView');
            
        } catch (error) {
            logger.error(MODULE_NAME, 'Failed to update auth tokens for WebContentsView:', error);
        }
    }

    // Clear authentication cookies
    private async _clearAuthCookies(
        viewSession: Electron.Session, 
        url: string
    ): Promise<void> {
        try {
            const urlObj = new URL(url);
            const cookieNames = ['access_token', 'refresh_token', 'user_data'];

            const clearPromises = cookieNames.map(name =>
                viewSession.cookies.remove(urlObj.origin, name)
                    .then(() => logger.info(MODULE_NAME, `Cleared ${name} cookie`))
                    .catch(error => logger.warn(MODULE_NAME, `Failed to clear ${name} cookie:`, error))
            );

            await Promise.all(clearPromises);
            logger.info(MODULE_NAME, `Cleared authentication cookies for: ${urlObj.origin}`);
            
        } catch (error) {
            logger.error(MODULE_NAME, 'Failed to clear authentication cookies:', error);
        }
    }

    // Handle token refresh for WebContentsView
    public async handleTokenRefresh(webContentsView: WebContentsView): Promise<boolean> {
        try {
            logger.info(MODULE_NAME, 'Handling token refresh for WebContentsView');
            
            // Attempt to refresh tokens via AuthManager
            const refreshedUser = await AuthManager.refreshToken();
            
            if (refreshedUser) {
                const newTokens = AuthManager.getCurrentAuthTokens();
                if (newTokens) {
                    await this.updateAuthTokens(webContentsView, newTokens);
                    logger.info(MODULE_NAME, 'Successfully refreshed tokens for WebContentsView');
                    return true;
                }
            }

            logger.warn(MODULE_NAME, 'Token refresh failed for WebContentsView');
            await this.updateAuthTokens(webContentsView, null);
            return false;
            
        } catch (error) {
            logger.error(MODULE_NAME, 'Error during token refresh for WebContentsView:', error);
            await this.updateAuthTokens(webContentsView, null);
            return false;
        }
    }

    // Get trusted domains
    public getTrustedDomains(): string[] {
        return [...this.trustedDomains];
    }

    // Add trusted domain
    public addTrustedDomain(domain: string): void {
        if (!this.trustedDomains.includes(domain)) {
            this.trustedDomains.push(domain);
            logger.info(MODULE_NAME, `Added trusted domain: ${domain}`);
        }
    }
}

// Create singleton instance
export const webContentsViewAuth = new WebContentsViewAuth();

// Register IPC handlers for WebContentsView authentication
ipcMain.handle('webcontents-view:create-authenticated', async (_event, options: {
    url: string;
    partition?: string;
    enableAuth?: boolean;
}) => {
    try {
        logger.info(MODULE_NAME, `IPC request to create authenticated WebContentsView: ${options.url}`);
        // Return configuration that can be used by renderer to create WebContentsView
        // Note: WebContentsView instances cannot be directly returned via IPC
        return {
            success: true,
            config: {
                partition: options.partition || 'persist:webcontents-auth',
                preloadPath: getPreloadPath('webcontents-view-preload.mjs'),
                enableAuth: options.enableAuth !== false
            }
        };
    } catch (error) {
        logger.error(MODULE_NAME, 'Failed to create authenticated WebContentsView config:', error);
        return { 
            success: false, 
            error: error instanceof Error ? error.message : 'Unknown error' 
        };
    }
});

// Handle token updates from renderer
ipcMain.on('webcontents-view:token-update', (event, tokens: AuthTokens | null) => {
    logger.info(MODULE_NAME, `Received token update from renderer: ${!!tokens}`);
    // This would typically be handled by the main process auth manager
    // and then broadcast to all relevant WebContentsViews
});

logger.info(MODULE_NAME, 'WebContentsView authentication module initialized');