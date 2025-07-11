import { BaseWindow, WebContentsView, session, Rectangle, app } from 'electron';
import path from 'node:path';
import Store from 'electron-store';
import * as logger from './logger';
import { getCurrentAuthTokens } from './auth-manager';
import { getPreloadPath, getIconPath } from './window-manager';
import { getLastLoggedInUser } from './config-manager';

const MODULE_NAME = 'WebContentsViewManager';

// Type for auth tokens
interface AuthTokens {
    accessToken?: string;
    refreshToken?: string;
    user?: any;
}

// Type for window store schema
type WindowStoreSchema = {
    webContentWindowBounds?: Rectangle;
};

const store = new Store<WindowStoreSchema>({
    defaults: {
        webContentWindowBounds: undefined
    }
});

export class WebContentsViewManager {
    private baseWindow: BaseWindow | null = null;
    private headerView: WebContentsView | null = null;
    private webContentView: WebContentsView | null = null;
    private currentSection: 'profile' | 'leaderboard' | 'map' = 'profile';
    private authenticationEnabled: boolean = true;
    private sessionPartition: string = 'persist:enhanced-webcontent';
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
            
        logger.info(MODULE_NAME, `Initialized with base URL: ${this.webAppBaseUrl}`);
    }

    public async initialize(): Promise<void> {
        try {
            await this.createBaseWindow();
            await this.createHeaderView();
            await this.createWebContentView();
            this.setupEventHandlers();
            logger.info(MODULE_NAME, 'WebContentsView manager initialized successfully');
        } catch (error) {
            logger.error(MODULE_NAME, 'Failed to initialize WebContentsView manager:', error);
            throw error;
        }
    }

    private async createBaseWindow(): Promise<void> {
        try {
            // Get saved bounds
            const savedBounds = store.get('webContentWindowBounds');
            const defaultWidth = 1024;
            const defaultHeight = 768;

            this.baseWindow = new BaseWindow({
                width: savedBounds?.width || defaultWidth,
                height: savedBounds?.height || defaultHeight,
                x: savedBounds?.x,
                y: savedBounds?.y,
                title: 'SC Feeder - Web Content',
                show: false,
                resizable: true,
                minimizable: true,
                maximizable: true,
                titleBarStyle: 'hiddenInset',
                backgroundColor: '#1a1a1a',
                minWidth: 800,
                minHeight: 600,
                icon: getIconPath()
            });

            logger.info(MODULE_NAME, 'BaseWindow created successfully');
        } catch (error) {
            logger.error(MODULE_NAME, 'Failed to create BaseWindow:', error);
            throw error;
        }
    }

    private async createHeaderView(): Promise<void> {
        try {
            this.headerView = new WebContentsView({
                webPreferences: {
                    nodeIntegration: false,
                    contextIsolation: true,
                    webSecurity: true,
                    preload: getPreloadPath('webcontents-header-preload.mjs'),
                    devTools: !app.isPackaged // Disable DevTools in production
                }
            });

            // Create header HTML content (Steam-like navigation)
            const headerHTML = `
                <!DOCTYPE html>
                <html>
                <head>
                    <meta charset="UTF-8">
                    <style>
                        * {
                            margin: 0;
                            padding: 0;
                            box-sizing: border-box;
                        }
                        body {
                            background: #171717;
                            color: #ffffff;
                            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
                            height: 80px;
                            display: flex;
                            align-items: center;
                            border-bottom: 1px solid #262626;
                            -webkit-app-region: drag;
                            user-select: none;
                        }
                        .nav-container {
                            display: flex;
                            margin-left: 50px;
                            -webkit-app-region: no-drag;
                        }
                        .nav-button {
                            padding: 8px 16px;
                            margin-right: 16px;
                            background: transparent;
                            border: none;
                            color: #ffffff;
                            cursor: pointer;
                            border-radius: 4px;
                            transition: all 0.2s ease;
                            font-size: 14px;
                            font-weight: 500;
                            outline: none;
                        }
                        .nav-button:hover {
                            background: rgba(255, 255, 255, 0.1);
                            color: #6363f7;
                        }
                        .nav-button.active {
                            background: rgba(99, 99, 247, 0.1);
                            color: #6363f7;
                        }
                        .nav-button:focus {
                            outline: 2px solid rgba(99, 99, 247, 0.5);
                            outline-offset: 2px;
                        }
                        .window-controls {
                            position: absolute;
                            right: 10px;
                            display: flex;
                            gap: 8px;
                            -webkit-app-region: no-drag;
                        }
                        .control-button {
                            width: 12px;
                            height: 12px;
                            border-radius: 50%;
                            border: none;
                            cursor: pointer;
                            transition: opacity 0.2s;
                        }
                        .control-button:hover {
                            opacity: 0.8;
                        }
                        .close-btn { background: #ff5f57; }
                        .minimize-btn { background: #ffbd2e; }
                        .maximize-btn { background: #28ca42; }
                    </style>
                </head>
                <body>
                    <div class="nav-container">
                        <button class="nav-button active" data-section="profile">Profile</button>
                        <button class="nav-button" data-section="leaderboard">Leaderboard</button>
                        <button class="nav-button" data-section="map">Map</button>
                    </div>
                    <div class="window-controls">
                        <button class="control-button close-btn" data-action="close"></button>
                        <button class="control-button minimize-btn" data-action="minimize"></button>
                        <button class="control-button maximize-btn" data-action="maximize"></button>
                    </div>
                    <script>
                        document.addEventListener('click', (e) => {
                            if (e.target.classList.contains('nav-button')) {
                                const section = e.target.dataset.section;
                                if (window.electronAPI?.navigateToSection) {
                                    window.electronAPI.navigateToSection(section);
                                }
                                
                                // Update active state
                                document.querySelectorAll('.nav-button').forEach(btn => btn.classList.remove('active'));
                                e.target.classList.add('active');
                            } else if (e.target.classList.contains('control-button')) {
                                const action = e.target.dataset.action;
                                if (window.electronAPI?.windowControl) {
                                    window.electronAPI.windowControl(action);
                                }
                            }
                        });
                        
                        // Update active state based on current section
                        window.electronAPI?.onSectionChange?.((section) => {
                            document.querySelectorAll('.nav-button').forEach(btn => {
                                btn.classList.toggle('active', btn.dataset.section === section);
                            });
                        });
                    </script>
                </body>
                </html>
            `;

            await this.headerView.webContents.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(headerHTML)}`);

            // Set header bounds (80px height)
            if (this.baseWindow) {
                const windowBounds = this.baseWindow.getBounds();
                this.headerView.setBounds({ x: 0, y: 0, width: windowBounds.width, height: 80 });
                this.baseWindow.contentView.addChildView(this.headerView);
            }

            logger.info(MODULE_NAME, 'Header view created successfully');
        } catch (error) {
            logger.error(MODULE_NAME, 'Failed to create header view:', error);
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
                    preload: getPreloadPath('webcontents-view-preload.mjs'),
                    devTools: !app.isPackaged // Disable DevTools in production
                }
            });

            // Set up authentication for this session
            await this.setupAuthentication(webContentSession);

            // Set web content bounds (below header)
            if (this.baseWindow) {
                this.updateWebContentBounds();
                this.baseWindow.contentView.addChildView(this.webContentView);
            }

            logger.info(MODULE_NAME, 'Web content view created successfully');
        } catch (error) {
            logger.error(MODULE_NAME, 'Failed to create web content view:', error);
            throw error;
        }
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

            // Handle 401 responses
            webContentSession.webRequest.onHeadersReceived((details, callback) => {
                if (details.statusCode === 401) {
                    logger.warn(MODULE_NAME, `Received 401 for: ${details.url}`);
                    // Could trigger token refresh here
                }
                callback({});
            });

            // Set initial authentication cookies
            await this.injectAuthenticationCookies(webContentSession);

            logger.info(MODULE_NAME, 'Authentication setup completed');
        } catch (error) {
            logger.error(MODULE_NAME, 'Authentication setup failed:', error);
        }
    }

    // Mirror the exact cookie setting from external windows
    private async injectAuthenticationCookies(webContentSession: Electron.Session): Promise<void> {
        try {
            const currentTokens = getCurrentAuthTokens();
            if (!currentTokens) {
                logger.warn(MODULE_NAME, 'No tokens available for cookie injection');
                return;
            }

            const url = this.getCurrentUrl();
            const urlObj = new URL(url);
            const domain = urlObj.hostname;

            // Same trusted domain check as external windows
            const isTrustedDomain = this.trustedDomains.some(trusted => 
                domain === trusted || domain.endsWith(`.${trusted}`)
            );

            if (!isTrustedDomain) {
                logger.debug(MODULE_NAME, `Skipping cookie injection for untrusted domain: ${domain}`);
                return;
            }

            // Exact same cookie options as working external windows
            const cookieOptions = {
                url: urlObj.origin,
                httpOnly: false,
                secure: urlObj.protocol === 'https:',
                sameSite: 'lax' as const
            };

            logger.info(MODULE_NAME, `Setting cookies for domain: ${domain} with tokens: access=${!!currentTokens.accessToken}, refresh=${!!currentTokens.refreshToken}`);

            // Set all authentication cookies (same as external windows)
            const cookiePromises = [];

            if (currentTokens.accessToken) {
                cookiePromises.push(
                    webContentSession.cookies.set({
                        ...cookieOptions,
                        name: 'access_token',
                        value: currentTokens.accessToken,
                        expirationDate: Date.now() / 1000 + (15 * 60) // 15 minutes
                    }).then(() => logger.info(MODULE_NAME, 'Successfully set access_token cookie'))
                );
            }

            if (currentTokens.refreshToken) {
                cookiePromises.push(
                    webContentSession.cookies.set({
                        ...cookieOptions,
                        name: 'refresh_token',
                        value: currentTokens.refreshToken,
                        httpOnly: true,
                        expirationDate: Date.now() / 1000 + (7 * 24 * 60 * 60) // 7 days
                    }).then(() => logger.info(MODULE_NAME, 'Successfully set refresh_token cookie'))
                );
            }

            if (currentTokens.user) {
                cookiePromises.push(
                    webContentSession.cookies.set({
                        ...cookieOptions,
                        name: 'user_data',
                        value: JSON.stringify(currentTokens.user),
                        expirationDate: Date.now() / 1000 + (24 * 60 * 60) // 24 hours
                    }).then(() => logger.info(MODULE_NAME, 'Successfully set user_data cookie'))
                );
            }

            await Promise.all(cookiePromises);
            logger.info(MODULE_NAME, `Set authentication cookies for domain: ${domain}`);
            
        } catch (error) {
            logger.error(MODULE_NAME, 'Failed to inject authentication cookies:', error);
        }
    }

    private setupEventHandlers(): void {
        if (!this.baseWindow || !this.webContentView) return;

        // Window events
        this.baseWindow.on('resize', () => {
            this.updateWebContentBounds();
            this.updateHeaderBounds();
        });

        this.baseWindow.on('closed', () => {
            this.dispose();
        });

        // Web content events
        this.webContentView.webContents.on('dom-ready', () => {
            this.sendAuthenticationData();
        });

        this.webContentView.webContents.on('did-navigate', (event, url) => {
            logger.info(MODULE_NAME, `Navigated to: ${url}`);
            // Re-inject cookies for new URL
            if (this.webContentView) {
                this.injectAuthenticationCookies(this.webContentView.webContents.session);
            }
        });

        this.webContentView.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
            logger.error(MODULE_NAME, `Load failed: ${errorCode} - ${errorDescription}`);
            this.handleLoadFailure(errorCode, errorDescription);
        });

        // Save bounds when window moves or resizes
        const saveBounds = this.debounce(() => {
            if (this.baseWindow && !this.baseWindow.isDestroyed()) {
                const bounds = this.baseWindow.getBounds();
                store.set('webContentWindowBounds', bounds);
                logger.debug(MODULE_NAME, 'Saved window bounds:', bounds);
            }
        }, 500);

        this.baseWindow.on('resize', saveBounds);
        this.baseWindow.on('move', saveBounds);

        logger.info(MODULE_NAME, 'Event handlers setup completed');
    }

    private updateWebContentBounds(): void {
        if (!this.baseWindow || !this.webContentView) return;

        const windowBounds = this.baseWindow.getBounds();
        const headerHeight = 80;

        this.webContentView.setBounds({
            x: 0,
            y: headerHeight,
            width: windowBounds.width,
            height: windowBounds.height - headerHeight
        });
    }

    private updateHeaderBounds(): void {
        if (!this.baseWindow || !this.headerView) return;

        const windowBounds = this.baseWindow.getBounds();
        this.headerView.setBounds({
            x: 0,
            y: 0,
            width: windowBounds.width,
            height: 80
        });
    }

    public async navigateToSection(section: 'profile' | 'leaderboard' | 'map'): Promise<void> {
        this.currentSection = section;
        
        // Build URL with same pattern as current WebContentPage.vue
        const currentTokens = getCurrentAuthTokens();
        let url = `${this.webAppBaseUrl}`;
        
        switch (section) {
            case 'profile':
                if (currentTokens?.user?.username) {
                    url += `/user/${currentTokens.user.username}`;
                } else {
                    // Use last known username when not authenticated
                    const lastKnownUser = getLastLoggedInUser();
                    if (lastKnownUser) {
                        url += `/user/${lastKnownUser}`;
                    } else {
                        url += '/profile';
                    }
                }
                break;
            case 'leaderboard':
                url += '/leaderboard';
                break;
            case 'map':
                url += '/map';
                break;
        }
        
        url += '?source=electron';
        if (currentTokens?.accessToken) {
            url += '&auth=true';
        }

        logger.info(MODULE_NAME, `Navigating to section: ${section} - ${url}`);
        
        if (this.webContentView) {
            await this.webContentView.webContents.loadURL(url);
        }
    }

    private async sendAuthenticationData(): Promise<void> {
        if (!this.authenticationEnabled || !this.webContentView) return;

        try {
            const currentTokens = getCurrentAuthTokens();
            
            // Direct IPC send - much simpler than webview guest chain
            this.webContentView.webContents.send('auth-data-updated', {
                accessToken: currentTokens?.accessToken || null,
                refreshToken: currentTokens?.refreshToken || null,
                user: currentTokens?.user || null,
                isAuthenticated: !!currentTokens?.accessToken
            });

            logger.info(MODULE_NAME, 'Sent authentication data via direct IPC');
        } catch (error) {
            logger.error(MODULE_NAME, 'Failed to send authentication data:', error);
        }
    }

    public async refreshAuthentication(): Promise<void> {
        try {
            // Re-inject cookies with current tokens
            if (this.webContentView) {
                await this.injectAuthenticationCookies(this.webContentView.webContents.session);
                await this.sendAuthenticationData();
            }
            logger.info(MODULE_NAME, 'Authentication refreshed successfully');
        } catch (error) {
            logger.error(MODULE_NAME, 'Authentication refresh failed:', error);
        }
    }

    private handleLoadFailure(errorCode: number, errorDescription: string): void {
        logger.error(MODULE_NAME, `Load failed: ${errorCode} - ${errorDescription}`);
        
        // Could implement retry logic or fallback content
        if (errorCode === -2) { // ERR_FAILED
            logger.warn(MODULE_NAME, 'Server may be down - considering retry');
        } else if (errorCode === -105) { // ERR_NAME_NOT_RESOLVED
            logger.warn(MODULE_NAME, 'DNS resolution failed - check internet connection');
        }
    }

    private getCurrentUrl(): string {
        if (this.webContentView) {
            return this.webContentView.webContents.getURL() || this.webAppBaseUrl;
        }
        return this.webAppBaseUrl;
    }

    // Utility method for debouncing
    private debounce<F extends (...args: any[]) => any>(func: F, waitFor: number) {
        let timeoutId: NodeJS.Timeout | null = null;
        return (...args: Parameters<F>): void => {
            if (timeoutId) {
                clearTimeout(timeoutId);
            }
            timeoutId = setTimeout(() => {
                func(...args);
                timeoutId = null;
            }, waitFor);
        };
    }

    // Public interface
    public show(): void {
        if (this.baseWindow) {
            this.baseWindow.show();
            this.baseWindow.focus();
        }
    }

    public close(): void {
        if (this.baseWindow) {
            this.baseWindow.close();
        }
    }

    public isVisible(): boolean {
        return this.baseWindow ? this.baseWindow.isVisible() : false;
    }

    public getCurrentSection(): 'profile' | 'leaderboard' | 'map' {
        return this.currentSection;
    }

    public isAuthenticationEnabled(): boolean {
        return this.authenticationEnabled;
    }

    public dispose(): void {
        if (this.webContentView) {
            this.webContentView.webContents.removeAllListeners();
        }
        if (this.headerView) {
            this.headerView.webContents.removeAllListeners();
        }
        if (this.baseWindow) {
            this.baseWindow.removeAllListeners();
        }
        
        this.webContentView = null;
        this.headerView = null;
        this.baseWindow = null;
        
        logger.info(MODULE_NAME, 'WebContentsView manager disposed');
    }
}

// Global instance
let webContentViewManager: WebContentsViewManager | null = null;

// Factory function to create or get existing instance
export async function createWebContentViewManager(): Promise<WebContentsViewManager> {
    if (webContentViewManager) {
        return webContentViewManager;
    }

    webContentViewManager = new WebContentsViewManager();
    await webContentViewManager.initialize();
    
    // Clean up on window close
    webContentViewManager['baseWindow']?.on('closed', () => {
        webContentViewManager = null;
    });

    return webContentViewManager;
}

// Get existing instance
export function getWebContentViewManager(): WebContentsViewManager | null {
    return webContentViewManager;
}

// Close and cleanup
export function closeWebContentViewManager(): boolean {
    if (webContentViewManager) {
        webContentViewManager.close();
        webContentViewManager = null;
        return true;
    }
    return false;
}