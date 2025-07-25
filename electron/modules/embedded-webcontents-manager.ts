import { WebContentsView, session, BrowserWindow, app } from 'electron';
import path from 'node:path';
import * as logger from './logger';
import { getCurrentAuthTokens } from './auth-manager';
import { getPreloadPath } from './window-manager';

const MODULE_NAME = 'EmbeddedWebContentsManager';

// Type for auth tokens
interface AuthTokens {
    accessToken?: string;
    refreshToken?: string;
    user?: any;
}

export class EmbeddedWebContentsManager {
    private separateWindow: BrowserWindow | null = null;
    private webContentView: WebContentsView | null = null;
    private currentSection: 'profile' | 'leaderboard' | 'map' | 'events' | 'stats' = 'profile';
    private isVisible: boolean = false;
    private authenticationEnabled: boolean = true;
    private sessionPartition: string = 'persist:embedded-webcontent';
    private webAppBaseUrl: string;
    
    // Trusted domains for authentication (same as external windows)
    private trustedDomains = [
        'killfeed.sinfulshadows.com',
        'server-killfeed.sinfulshadows.com',
        'voidlog.gg',
        'localhost'
    ];

    constructor() {
        
        // Determine base URL based on environment - default to production
        const isDevelopment = process.env.NODE_ENV === 'development';
        this.webAppBaseUrl = isDevelopment
            ? 'http://localhost:3001'
            : 'https://voidlog.gg';
            
        logger.info(MODULE_NAME, `Initialized embedded manager with base URL: ${this.webAppBaseUrl}`);
    }

    public async initialize(): Promise<void> {
        try {
            await this.createSeparateWindow();
            await this.createWebContentView();
            this.setupEventHandlers();
            logger.info(MODULE_NAME, 'Embedded WebContentsView manager initialized successfully');
        } catch (error) {
            logger.error(MODULE_NAME, 'Failed to initialize embedded WebContentsView manager:', error);
            throw error;
        }
    }

    private async createSeparateWindow(): Promise<void> {
        try {
            // Create a separate window (like the old webview system)
            this.separateWindow = new BrowserWindow({
                width: 1024,
                height: 768,
                title: 'SC Feeder - Web Content',
                show: false,
                resizable: true,
                minimizable: true,
                maximizable: true,
                titleBarStyle: 'default',
                backgroundColor: '#1a1a1a',
                minWidth: 800,
                minHeight: 600,
                webPreferences: {
                    nodeIntegration: false,
                    contextIsolation: true,
                    webSecurity: true,
                    devTools: !app.isPackaged // Disable DevTools in production
                }
            });

            logger.info(MODULE_NAME, 'Separate window created successfully');
        } catch (error) {
            logger.error(MODULE_NAME, 'Failed to create separate window:', error);
            throw error;
        }
    }

    private async createWebContentView(): Promise<void> {
        try {
            // Get authenticated session
            const webContentSession = session.fromPartition(this.sessionPartition);
            
            this.webContentView = new WebContentsView({
                webPreferences: {
                    nodeIntegration: false,
                    contextIsolation: true,
                    webSecurity: true,
                    allowRunningInsecureContent: false,
                    session: webContentSession,
                    preload: getPreloadPath('webcontents-view-preload.js'),
                    devTools: !app.isPackaged // Disable DevTools in production
                }
            });

            // Set up authentication for this session
            await this.setupAuthentication(webContentSession);
            
            // Add WebContentsView to the separate window
            if (this.separateWindow && this.separateWindow.contentView) {
                this.separateWindow.contentView.addChildView(this.webContentView);
                this.updateWebContentBounds();
                logger.info(MODULE_NAME, 'WebContentsView added to separate window');
            }

            logger.info(MODULE_NAME, 'WebContentsView created successfully');
        } catch (error) {
            logger.error(MODULE_NAME, 'Failed to create WebContentsView:', error);
            throw error;
        }
    }

    private updateWebContentBounds(): void {
        if (!this.separateWindow || !this.webContentView) return;

        const windowBounds = this.separateWindow.getBounds();
        
        // Fill the entire separate window
        this.webContentView.setBounds({
            x: 0,
            y: 0,
            width: windowBounds.width,
            height: windowBounds.height
        });

        logger.debug(MODULE_NAME, 'Updated WebContentsView bounds:', windowBounds);
    }

    private setupEventHandlers(): void {
        if (!this.separateWindow || !this.webContentView) return;

        // Window resize handler
        this.separateWindow.on('resize', () => {
            this.updateWebContentBounds();
        });

        // Window close handler
        this.separateWindow.on('closed', () => {
            this.isVisible = false;
            this.separateWindow = null;
            this.webContentView = null;
        });

        // Web content events
        this.webContentView.webContents.on('dom-ready', () => {
            this.sendAuthenticationData();
        });

        this.webContentView.webContents.on('did-navigate', (event, url) => {
            logger.info(MODULE_NAME, `WebContentsView navigated to: ${url}`);
            // Re-inject cookies for new URL
            if (this.webContentView) {
                this.injectAuthenticationCookies(this.webContentView.webContents.session);
            }
        });

        this.webContentView.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
            logger.error(MODULE_NAME, `WebContentsView load failed: ${errorCode} - ${errorDescription}`);
            this.handleLoadFailure(errorCode, errorDescription);
        });

        logger.info(MODULE_NAME, 'Embedded event handlers setup completed');
    }

    private async setupAuthentication(webContentSession: Electron.Session): Promise<void> {
        if (!this.authenticationEnabled) return;

        try {
            // Set up request interception (same as external windows)
            webContentSession.webRequest.onBeforeSendHeaders((details, callback) => {
                const currentTokens = getCurrentAuthTokens();
                
                if (currentTokens?.accessToken) {
                    const url = details.url;
                    const isApiRequest = url.includes('/api/') || 
                                        this.trustedDomains.some(domain => url.includes(domain));

                    if (isApiRequest && !details.requestHeaders['Authorization']) {
                        details.requestHeaders['Authorization'] = `Bearer ${currentTokens.accessToken}`;
                        logger.debug(MODULE_NAME, `Added Authorization header to: ${url}`);
                    }
                }

                callback({ requestHeaders: details.requestHeaders });
            });

            // Inject authentication cookies
            await this.injectAuthenticationCookies(webContentSession);

            logger.info(MODULE_NAME, 'Authentication setup completed for embedded overlay');
        } catch (error) {
            logger.error(MODULE_NAME, 'Failed to setup authentication for embedded overlay:', error);
        }
    }

    private async injectAuthenticationCookies(webContentSession: Electron.Session): Promise<void> {
        const currentTokens = getCurrentAuthTokens();
        if (!currentTokens?.accessToken) return;

        try {
            const urlObj = new URL(this.webAppBaseUrl);

            // Set access token cookie
            await webContentSession.cookies.set({
                url: urlObj.origin,
                name: 'access_token',
                value: currentTokens.accessToken,
                expirationDate: Date.now() / 1000 + (15 * 60), // 15 minutes
                httpOnly: false,
                secure: urlObj.protocol === 'https:'
            });

            // Set refresh token cookie if available
            if (currentTokens.refreshToken) {
                await webContentSession.cookies.set({
                    url: urlObj.origin,
                    name: 'refresh_token',
                    value: currentTokens.refreshToken,
                    expirationDate: Date.now() / 1000 + (7 * 24 * 60 * 60), // 7 days
                    httpOnly: false,
                    secure: urlObj.protocol === 'https:'
                });
            }

            // Set user data cookie if available
            if (currentTokens.user) {
                await webContentSession.cookies.set({
                    url: urlObj.origin,
                    name: 'user_data',
                    value: JSON.stringify(currentTokens.user),
                    expirationDate: Date.now() / 1000 + (24 * 60 * 60), // 24 hours
                    httpOnly: false,
                    secure: urlObj.protocol === 'https:'
                });
            }

            logger.info(MODULE_NAME, 'Authentication cookies injected successfully');
        } catch (error) {
            logger.error(MODULE_NAME, 'Failed to inject authentication cookies:', error);
        }
    }

    private sendAuthenticationData(): void {
        const currentTokens = getCurrentAuthTokens();
        if (this.webContentView && currentTokens) {
            this.webContentView.webContents.send('auth-data-updated', {
                accessToken: currentTokens.accessToken,
                refreshToken: currentTokens.refreshToken,
                user: currentTokens.user,
                isAuthenticated: !!currentTokens.accessToken
            });
        }
    }

    private handleLoadFailure(errorCode: number, errorDescription: string): void {
        logger.error(MODULE_NAME, `Load failure - Code: ${errorCode}, Description: ${errorDescription}`);
        
        // Show error message in WebContentsView
        if (this.webContentView) {
            const errorHTML = `
                <html>
                <head>
                    <title>Load Error</title>
                    <style>
                        body { 
                            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; 
                            background: #1a1a1a; 
                            color: #ffffff; 
                            display: flex; 
                            align-items: center; 
                            justify-content: center; 
                            margin: 0; 
                            padding: 20px;
                        }
                        .error-container { 
                            text-align: center; 
                            max-width: 500px; 
                        }
                        .error-title { 
                            color: #ff6b6b; 
                            margin-bottom: 16px; 
                        }
                        .retry-button { 
                            background: #6366f1; 
                            color: white; 
                            border: none; 
                            padding: 12px 24px; 
                            border-radius: 6px; 
                            cursor: pointer; 
                            margin-top: 16px;
                        }
                        .retry-button:hover { 
                            background: #5856eb; 
                        }
                    </style>
                </head>
                <body>
                    <div class="error-container">
                        <h2 class="error-title">Failed to Load Content</h2>
                        <p>Error ${errorCode}: ${errorDescription}</p>
                        <button class="retry-button" onclick="location.reload()">Retry</button>
                        <p><small>Close this window to return to the main app</small></p>
                    </div>
                </body>
                </html>
            `;
            
            this.webContentView.webContents.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(errorHTML)}`);
        }
    }

    public async show(): Promise<void> {
        if (!this.separateWindow) return;

        this.isVisible = true;
        this.separateWindow.show();
        
        // Focus the separate window
        this.separateWindow.focus();
        
        logger.info(MODULE_NAME, 'Separate WebContentsView window shown');
    }

    public async hide(): Promise<void> {
        if (!this.separateWindow) return;

        this.isVisible = false;
        this.separateWindow.hide();
        
        logger.info(MODULE_NAME, 'Separate WebContentsView window hidden');
    }

    public async navigateToSection(section: 'profile' | 'leaderboard' | 'map' | 'events' | 'stats'): Promise<void> {
        this.currentSection = section;
        
        // Build URL with same pattern as current WebContentPage.vue
        const currentTokens = getCurrentAuthTokens();
        let url = `${this.webAppBaseUrl}`;
        
        switch (section) {
            case 'profile':
                if (currentTokens?.user?.username) {
                    url += `/user/${currentTokens.user.username}`;
                } else {
                    url += '/profile';
                }
                break;
            case 'leaderboard':
                url += '/leaderboard';
                break;
            case 'map':
                url += '/map';
                break;
            case 'events':
                url += '/events';
                break;
            case 'stats':
                url += '/stats';
                break;
        }
        
        url += '?source=electron&embedded=true';
        if (currentTokens?.accessToken) {
            url += '&auth=true';
        }

        logger.info(MODULE_NAME, `Navigating separate WebContentsView to section: ${section} - ${url}`);
        
        if (this.webContentView) {
            await this.webContentView.webContents.loadURL(url);
        }
    }

    public getCurrentSection(): 'profile' | 'leaderboard' | 'map' | 'events' | 'stats' {
        return this.currentSection;
    }

    public isOverlayVisible(): boolean {
        return this.isVisible && !!this.separateWindow && this.separateWindow.isVisible();
    }

    public isAuthenticationEnabled(): boolean {
        return this.authenticationEnabled;
    }

    public async refreshAuthentication(): Promise<void> {
        if (this.webContentView) {
            await this.injectAuthenticationCookies(this.webContentView.webContents.session);
            this.sendAuthenticationData();
            logger.info(MODULE_NAME, 'Authentication refreshed for separate WebContentsView');
        }
    }

    public dispose(): void {
        if (this.separateWindow) {
            try {
                this.separateWindow.close();
                this.separateWindow = null;
                this.webContentView = null;
                logger.info(MODULE_NAME, 'Separate WebContentsView window disposed');
            } catch (error) {
                logger.error(MODULE_NAME, 'Error disposing separate WebContentsView window:', error);
            }
        }
        
        this.isVisible = false;
    }
}

// Global manager instance
let embeddedManager: EmbeddedWebContentsManager | null = null;

export async function createEmbeddedWebContentManager(): Promise<EmbeddedWebContentsManager> {
    if (embeddedManager) {
        embeddedManager.dispose();
    }
    
    embeddedManager = new EmbeddedWebContentsManager();
    await embeddedManager.initialize();
    
    logger.info(MODULE_NAME, 'Separate WebContentsView manager created and initialized');
    return embeddedManager;
}

export function getEmbeddedWebContentManager(): EmbeddedWebContentsManager | null {
    return embeddedManager;
}

export function closeEmbeddedWebContentManager(): boolean {
    if (embeddedManager) {
        embeddedManager.dispose();
        embeddedManager = null;
        logger.info(MODULE_NAME, 'Separate WebContentsView manager closed');
        return true;
    }
    return false;
}