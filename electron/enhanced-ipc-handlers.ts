import { ipcMain, BrowserWindow, WebContentsView, session } from 'electron';
import * as logger from './modules/logger';
import { getCurrentAuthTokens, getAuthStatus, storeTokens, refreshToken } from './modules/auth-manager';
import { 
    createEmbeddedWebContentManager, 
    getEmbeddedWebContentManager, 
    closeEmbeddedWebContentManager 
} from './modules/embedded-webcontents-manager';
import { getMainWindow, getPreloadPath } from './modules/window-manager';

const MODULE_NAME = 'EnhancedIPCHandlers';

export function registerEnhancedIPCHandlers(): void {
    logger.info(MODULE_NAME, 'Registering enhanced IPC handlers for WebContentsView architecture');

    // --- Authentication Handlers ---

    // Get authentication data (simplified from complex webview chain)
    ipcMain.handle('enhanced-auth:get-data', async () => {
        try {
            const currentTokens = getCurrentAuthTokens();
            const authStatus = getAuthStatus();
            
            const authData = {
                accessToken: currentTokens?.accessToken || null,
                refreshToken: currentTokens?.refreshToken || null,
                user: currentTokens?.user || null,
                isAuthenticated: authStatus.isAuthenticated
            };

            logger.debug(MODULE_NAME, 'Returning auth data:', { 
                hasAccessToken: !!authData.accessToken, 
                hasRefreshToken: !!authData.refreshToken,
                isAuthenticated: authData.isAuthenticated 
            });

            return authData;
        } catch (error) {
            logger.error(MODULE_NAME, 'Failed to get auth data:', error instanceof Error ? error.message : 'Unknown error');
            return {
                accessToken: null,
                refreshToken: null,
                user: null,
                isAuthenticated: false
            };
        }
    });

    // Update tokens from web content (simplified)
    ipcMain.handle('enhanced-auth:update-tokens', async (_, tokens: {
        accessToken: string;
        refreshToken: string;
        user?: any;
    }) => {
        try {
            logger.info(MODULE_NAME, 'Updating tokens from web content');
            
            const result = await storeTokens(tokens);
            
            if (result.success) {
                // Broadcast to all WebContentsView windows
                await broadcastAuthUpdate({
                    accessToken: tokens.accessToken,
                    refreshToken: tokens.refreshToken,
                    user: tokens.user,
                    isAuthenticated: true
                });

                // Refresh authentication in embedded WebContentsView manager
                const manager = getEmbeddedWebContentManager();
                if (manager) {
                    await manager.refreshAuthentication();
                }

                logger.info(MODULE_NAME, 'Tokens updated successfully');
            }
            
            return result.success;
        } catch (error) {
            logger.error(MODULE_NAME, 'Failed to update tokens:', error instanceof Error ? error.message : 'Unknown error');
            return false;
        }
    });

    // Token refresh
    ipcMain.handle('enhanced-auth:refresh', async () => {
        try {
            logger.info(MODULE_NAME, 'Refreshing authentication tokens');
            
            const refreshResult = await refreshToken();
            
            if (refreshResult) {
                const currentTokens = getCurrentAuthTokens();
                
                // Broadcast updated tokens
                await broadcastAuthUpdate({
                    accessToken: currentTokens?.accessToken || null,
                    refreshToken: currentTokens?.refreshToken || null,
                    user: currentTokens?.user || null,
                    isAuthenticated: !!currentTokens?.accessToken
                });

                // Refresh authentication in embedded WebContentsView manager
                const manager = getEmbeddedWebContentManager();
                if (manager) {
                    await manager.refreshAuthentication();
                }

                logger.info(MODULE_NAME, 'Token refresh successful');
                return true;
            }
            
            logger.warn(MODULE_NAME, 'Token refresh failed');
            return false;
        } catch (error) {
            logger.error(MODULE_NAME, 'Failed to refresh tokens:', error instanceof Error ? error.message : 'Unknown error');
            return false;
        }
    });

    // --- Navigation Handlers ---

    // Section navigation within WebContentsView
    ipcMain.on('enhanced-navigation:change-section', async (event, section: string) => {
        try {
            logger.info(MODULE_NAME, `Navigation requested to section: ${section}`);
            
            // Get the sender window (should be the web content window)
            const senderWindow = BrowserWindow.fromWebContents(event.sender);
            if (!senderWindow) {
                logger.error(MODULE_NAME, 'Could not find sender window for navigation');
                return;
            }
            
            // Get the WebContentsView for this window
            const windowId = senderWindow.id;
            const webContentView = windowWebContentsViews.get(windowId);
            
            if (webContentView) {
                // Navigate the WebContentsView to the new section
                await navigateWebContentsViewToSection(webContentView, section as 'profile' | 'leaderboard' | 'map' | 'events' | 'stats');
                logger.info(MODULE_NAME, `Successfully navigated WebContentsView to section: ${section}`);
            } else {
                // If no WebContentsView exists yet, create one
                logger.info(MODULE_NAME, 'No WebContentsView found, creating new one for navigation');
                await createWebContentsViewForWindow(senderWindow, section as 'profile' | 'leaderboard' | 'map' | 'events' | 'stats');
            }
        } catch (error) {
            logger.error(MODULE_NAME, `Failed to navigate to section ${section}:`, error instanceof Error ? error.message : 'Unknown error');
        }
    });

    // --- Window Control Handlers ---

    // Hide/Show WebContentsView for search overlay
    ipcMain.on('enhanced-window:hide-webcontentsview', async (event) => {
        try {
            const senderWindow = BrowserWindow.fromWebContents(event.sender);
            if (!senderWindow) {
                logger.error(MODULE_NAME, 'Could not find sender window for hiding WebContentsView');
                return;
            }
            
            const windowId = senderWindow.id;
            const webContentView = windowWebContentsViews.get(windowId);
            
            if (webContentView) {
                // Hide the WebContentsView by setting its bounds to 0x0
                webContentView.setBounds({ x: 0, y: 0, width: 0, height: 0 });
                logger.info(MODULE_NAME, 'Hidden WebContentsView for search overlay');
            }
        } catch (error) {
            logger.error(MODULE_NAME, 'Failed to hide WebContentsView:', error);
        }
    });

    ipcMain.on('enhanced-window:show-webcontentsview', async (event) => {
        try {
            const senderWindow = BrowserWindow.fromWebContents(event.sender);
            if (!senderWindow) {
                logger.error(MODULE_NAME, 'Could not find sender window for showing WebContentsView');
                return;
            }
            
            const windowId = senderWindow.id;
            const webContentView = windowWebContentsViews.get(windowId);
            
            if (webContentView) {
                // Restore the WebContentsView bounds by getting container dimensions
                senderWindow.webContents.executeJavaScript(`
                    const container = document.getElementById('webcontents-container');
                    if (container) {
                        const rect = container.getBoundingClientRect();
                        ({ x: rect.left, y: rect.top, width: rect.width, height: rect.height });
                    } else {
                        null;
                    }
                `).then((bounds) => {
                    if (bounds && bounds.width > 0 && bounds.height > 0 && webContentView) {
                        webContentView.setBounds({
                            x: Math.round(bounds.x),
                            y: Math.round(bounds.y),
                            width: Math.round(bounds.width),
                            height: Math.round(bounds.height)
                        });
                        logger.info(MODULE_NAME, 'Restored WebContentsView bounds after search overlay');
                    } else {
                        // Fallback positioning
                        const windowBounds = senderWindow.getContentBounds();
                        webContentView.setBounds({
                            x: 0,
                            y: 80,
                            width: windowBounds.width,
                            height: windowBounds.height - 80
                        });
                        logger.info(MODULE_NAME, 'Used fallback bounds for WebContentsView');
                    }
                }).catch((error) => {
                    logger.error(MODULE_NAME, 'Failed to get container bounds for WebContentsView restore:', error);
                    // Fallback positioning
                    if (!senderWindow.isDestroyed()) {
                        const windowBounds = senderWindow.getContentBounds();
                        webContentView.setBounds({
                            x: 0,
                            y: 80,
                            width: windowBounds.width,
                            height: windowBounds.height - 80
                        });
                    }
                });
            }
        } catch (error) {
            logger.error(MODULE_NAME, 'Failed to show WebContentsView:', error);
        }
    });

    // Window close
    ipcMain.on('enhanced-window:close', async (event) => {
        try {
            // Close embedded overlay instead of entire window
            const manager = getEmbeddedWebContentManager();
            if (manager) {
                await manager.hide();
                logger.info(MODULE_NAME, 'Embedded overlay hidden');
            } else {
                logger.warn(MODULE_NAME, 'No embedded manager found to close');
            }
        } catch (error) {
            logger.error(MODULE_NAME, 'Failed to close embedded overlay:', error instanceof Error ? error.message : 'Unknown error');
        }
    });

    // Window minimize
    ipcMain.on('enhanced-window:minimize', (event) => {
        try {
            const mainWindow = getMainWindow();
            if (mainWindow) {
                mainWindow.minimize();
                logger.info(MODULE_NAME, 'Main window minimize requested');
            }
        } catch (error) {
            logger.error(MODULE_NAME, 'Failed to minimize window:', error instanceof Error ? error.message : 'Unknown error');
        }
    });

    // Window maximize/restore
    ipcMain.on('enhanced-window:maximize', (event) => {
        try {
            const mainWindow = getMainWindow();
            if (mainWindow) {
                if (mainWindow.isMaximized()) {
                    mainWindow.unmaximize();
                } else {
                    mainWindow.maximize();
                }
                logger.info(MODULE_NAME, 'Main window maximize/restore requested');
            }
        } catch (error) {
            logger.error(MODULE_NAME, 'Failed to maximize/restore window:', error instanceof Error ? error.message : 'Unknown error');
        }
    });

    // --- Enhanced Window Management ---

    // Attach WebContentsView to existing WebContentPage.vue window
    ipcMain.handle('enhanced-window:attach-to-existing', async (event, section: 'profile' | 'leaderboard' | 'map' | 'events' | 'stats' = 'profile') => {
        try {
            logger.info(MODULE_NAME, `Attaching WebContentsView to web content window for section: ${section}`);
            
            // Find the web content window by title or check all windows
            let webContentWindow: BrowserWindow | null = null;
            
            // Log all available windows for debugging
            const allWindows = BrowserWindow.getAllWindows();
            logger.info(MODULE_NAME, 'All available windows:', allWindows.map(win => ({
                id: win.id,
                title: win.getTitle(),
                isDestroyed: win.isDestroyed()
            })));
            
            // First try to get the sender window (should be the web content window)
            const senderWindow = BrowserWindow.fromWebContents(event.sender);
            logger.info(MODULE_NAME, 'Sender window info:', senderWindow ? {
                id: senderWindow.id,
                title: senderWindow.getTitle(),
                isDestroyed: senderWindow.isDestroyed()
            } : 'null');
            
            if (senderWindow && senderWindow.getTitle().includes('Web Content')) {
                webContentWindow = senderWindow;
                logger.info(MODULE_NAME, 'Using sender window as web content window');
            } else {
                // Fallback: find window by title
                webContentWindow = allWindows.find(win => 
                    win.getTitle().includes('Web Content') && 
                    !win.isDestroyed()
                ) || null;
                
                if (webContentWindow) {
                    logger.info(MODULE_NAME, 'Found web content window by title search');
                } else {
                    logger.warn(MODULE_NAME, 'Could not find web content window by title');
                }
            }
            
            if (!webContentWindow) {
                throw new Error('Web content window not found');
            }
            
            // Create WebContentsView for the web content window
            const webContentView = await createWebContentsViewForWindow(webContentWindow, section);
            
            logger.info(MODULE_NAME, 'WebContentsView attached to web content window successfully');
            
            return {
                success: true,
                architecture: 'attached-webcontentsview',
                section,
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            logger.error(MODULE_NAME, 'Failed to attach WebContentsView to web content window:', error);
            logger.error(MODULE_NAME, 'Error details:', {
                message: error instanceof Error ? error.message : 'Unknown error',
                stack: error instanceof Error ? error.stack : 'No stack trace',
                type: typeof error,
                stringified: JSON.stringify(error)
            });
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
                architecture: 'unknown'
            };
        }
    });

    // Create embedded WebContentsView overlay (replaces old webview system)
    ipcMain.handle('enhanced-window:create', async (_, section: 'profile' | 'leaderboard' | 'map' | 'events' | 'stats' = 'profile') => {
        try {
            logger.info(MODULE_NAME, `Creating embedded WebContentsView overlay for section: ${section}`);
            
            let manager = getEmbeddedWebContentManager();
            if (!manager) {
                manager = await createEmbeddedWebContentManager();
            }
            
            await manager.navigateToSection(section);
            await manager.show();
            
            logger.info(MODULE_NAME, 'Separate WebContentsView window created successfully');
            
            return {
                success: true,
                architecture: 'separate-webcontentsview',
                section,
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            logger.error(MODULE_NAME, 'Failed to create embedded WebContentsView overlay:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
                architecture: 'unknown'
            };
        }
    });

    // Close embedded WebContentsView overlay
    ipcMain.handle('enhanced-window:close-window', async () => {
        try {
            const manager = getEmbeddedWebContentManager();
            if (manager) {
                await manager.hide();
                logger.info(MODULE_NAME, 'Embedded WebContentsView overlay hidden');
                return true;
            } else {
                logger.warn(MODULE_NAME, 'No embedded manager found to hide');
                return false;
            }
        } catch (error) {
            logger.error(MODULE_NAME, 'Failed to hide embedded WebContentsView overlay:', error);
            return false;
        }
    });

    // Get embedded WebContentsView overlay status
    ipcMain.handle('enhanced-window:get-status', async () => {
        try {
            const manager = getEmbeddedWebContentManager();
            
            if (manager) {
                return {
                    isOpen: manager.isOverlayVisible(),
                    activeSection: manager.getCurrentSection(),
                    architecture: 'embedded-webcontentsview',
                    authenticationEnabled: manager.isAuthenticationEnabled(),
                    timestamp: new Date().toISOString()
                };
            } else {
                return {
                    isOpen: false,
                    activeSection: null,
                    architecture: 'none',
                    authenticationEnabled: false,
                    timestamp: new Date().toISOString()
                };
            }
        } catch (error) {
            logger.error(MODULE_NAME, 'Failed to get embedded WebContentsView overlay status:', error);
            return {
                isOpen: false,
                activeSection: null,
                architecture: 'error',
                authenticationEnabled: false,
                error: error instanceof Error ? error.message : 'Unknown error',
                timestamp: new Date().toISOString()
            };
        }
    });

    // --- Search API Handlers ---

    // Proxy search API calls through Electron main process (bypasses CORS)
    ipcMain.handle('search-api:query', async (event, query: string) => {
        try {
            logger.info(MODULE_NAME, `Search API request for query: "${query}"`);
            
            // Determine API base URL
            const isDevelopment = !process.env.NODE_ENV || process.env.NODE_ENV === 'development';
            const apiBaseUrl = isDevelopment ? 'http://localhost:5324' : 'https://api.voidlog.gg';
            
            // Get authentication token
            const currentTokens = getCurrentAuthTokens();
            const headers: Record<string, string> = {
                'Content-Type': 'application/json'
            };
            
            if (currentTokens?.accessToken) {
                headers['Authorization'] = `Bearer ${currentTokens.accessToken}`;
                logger.debug(MODULE_NAME, 'Adding authentication header to search request');
            }
            
            // Make the API call from main process (no CORS restrictions)
            const url = `${apiBaseUrl}/api/search?term=${encodeURIComponent(query)}`;
            logger.debug(MODULE_NAME, `Making search API call to: ${url}`);
            
            const response = await fetch(url, {
                method: 'GET',
                headers
            });
            
            if (!response.ok) {
                throw new Error(`Search API failed: ${response.status} ${response.statusText}`);
            }
            
            const data = await response.json();
            logger.info(MODULE_NAME, `Search API returned ${Array.isArray(data) ? data.length : 0} results`);
            
            return {
                success: true,
                data: data
            };
        } catch (error) {
            logger.error(MODULE_NAME, 'Search API call failed:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown search error'
            };
        }
    });

    // --- DOM Bridge Handlers ---

    // Execute JavaScript in WebContentsView
    ipcMain.handle('enhanced-webcontents:execute-js', async (event, jsCode: string) => {
        try {
            const senderWindow = BrowserWindow.fromWebContents(event.sender);
            if (!senderWindow) {
                logger.error(MODULE_NAME, 'Could not find sender window for JavaScript execution');
                return { success: false, error: 'Sender window not found' };
            }
            
            const windowId = senderWindow.id;
            const webContentView = windowWebContentsViews.get(windowId);
            
            if (webContentView && webContentView.webContents && !webContentView.webContents.isDestroyed()) {
                await webContentView.webContents.executeJavaScript(jsCode);
                // Only log JavaScript execution if it's not search-related to reduce spam
                if (!jsCode.includes('electronSearchState')) {
                    logger.debug(MODULE_NAME, 'JavaScript executed in WebContentsView successfully');
                }
                return { success: true };
            } else {
                logger.warn(MODULE_NAME, 'No WebContentsView found for JavaScript execution');
                return { success: false, error: 'WebContentsView not found' };
            }
        } catch (error) {
            logger.error(MODULE_NAME, 'Failed to execute JavaScript in WebContentsView:', error);
            return { 
                success: false, 
                error: error instanceof Error ? error.message : 'Unknown error' 
            };
        }
    });

    // --- Diagnostic and Debug Handlers ---

    // Get enhanced diagnostic information
    ipcMain.handle('enhanced-diagnostics:get-info', async () => {
        try {
            const manager = getEmbeddedWebContentManager();
            const currentTokens = getCurrentAuthTokens();
            const authStatus = getAuthStatus();

            return {
                architecture: {
                    type: 'embedded-webcontentsview',
                    available: true,
                    active: !!manager
                },
                authentication: {
                    isAuthenticated: authStatus.isAuthenticated,
                    hasAccessToken: !!currentTokens?.accessToken,
                    hasRefreshToken: !!currentTokens?.refreshToken,
                    hasUserData: !!currentTokens?.user
                },
                window: {
                    isOpen: manager?.isOverlayVisible() || false,
                    currentSection: manager?.getCurrentSection() || null
                },
                capabilities: {
                    cookieInjection: true,
                    requestInterception: true,
                    sessionManagement: true,
                    directIPC: true
                },
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            logger.error(MODULE_NAME, 'Failed to get diagnostic info:', error);
            return {
                architecture: { type: 'unknown', available: false, active: false },
                authentication: { isAuthenticated: false, hasAccessToken: false, hasRefreshToken: false, hasUserData: false },
                window: { isOpen: false, currentSection: null },
                capabilities: { cookieInjection: false, requestInterception: false, sessionManagement: false, directIPC: false },
                error: error instanceof Error ? error.message : 'Unknown error',
                timestamp: new Date().toISOString()
            };
        }
    });

    // Force authentication refresh
    ipcMain.handle('enhanced-diagnostics:refresh-auth', async () => {
        try {
            logger.info(MODULE_NAME, 'Force refreshing authentication');
            
            const manager = getEmbeddedWebContentManager();
            if (manager) {
                await manager.refreshAuthentication();
                return { success: true, message: 'Authentication refreshed' };
            } else {
                return { success: false, message: 'Embedded WebContentsView manager not found' };
            }
        } catch (error) {
            logger.error(MODULE_NAME, 'Failed to force refresh authentication:', error);
            return { success: false, message: error instanceof Error ? error.message : 'Unknown error' };
        }
    });

    logger.info(MODULE_NAME, 'Enhanced IPC handlers registered successfully');
}

// Helper function to broadcast auth updates to all windows
async function broadcastAuthUpdate(authData: {
    accessToken: string | null;
    refreshToken: string | null;
    user: any | null;
    isAuthenticated: boolean;
}): Promise<void> {
    try {
        // Broadcast to all BrowserWindows
        BrowserWindow.getAllWindows().forEach(window => {
            if (window.webContents && !window.webContents.isDestroyed()) {
                window.webContents.send('auth-data-updated', authData);
            }
        });

        // Also update embedded WebContentsView manager specifically
        const manager = getEmbeddedWebContentManager();
        if (manager) {
            // The manager will handle auth updates internally
            await manager.refreshAuthentication();
        }

        logger.debug(MODULE_NAME, 'Broadcasted auth update to all windows');
    } catch (error) {
        logger.error(MODULE_NAME, 'Failed to broadcast auth update:', error);
    }
}

// Store WebContentsView instances for each window
const windowWebContentsViews = new Map<number, WebContentsView>();

// Helper function to create WebContentsView for an existing window
async function createWebContentsViewForWindow(targetWindow: BrowserWindow, section: 'profile' | 'leaderboard' | 'map' | 'events' | 'stats'): Promise<WebContentsView> {
    try {
        const windowId = targetWindow.id;
        
        // Clean up existing WebContentsView if any
        if (windowWebContentsViews.has(windowId)) {
            const existingView = windowWebContentsViews.get(windowId);
            if (existingView) {
                try {
                    targetWindow.contentView.removeChildView(existingView);
                    if (existingView.webContents && !existingView.webContents.isDestroyed()) {
                        (existingView.webContents as any).destroy();
                    }
                } catch (error) {
                    logger.warn(MODULE_NAME, 'Error cleaning up existing WebContentsView:', error);
                }
            }
            windowWebContentsViews.delete(windowId);
        }
        
        // Create new WebContentsView with authentication
        logger.info(MODULE_NAME, 'Creating WebContentsView session and view');
        const webContentSession = session.fromPartition('persist:attached-webcontent');
        
        let preloadPath: string;
        try {
            preloadPath = getPreloadPath('webcontents-view-preload.js');
            logger.info(MODULE_NAME, 'Preload path resolved:', preloadPath);
        } catch (preloadError) {
            logger.warn(MODULE_NAME, 'Failed to get preload path, continuing without:', preloadError);
            preloadPath = '';
        }
        
        const webContentView = new WebContentsView({
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
                webSecurity: true,
                allowRunningInsecureContent: false,
                session: webContentSession,
                ...(preloadPath ? { preload: preloadPath } : {})
            }
        });
        
        logger.info(MODULE_NAME, 'WebContentsView created successfully');
        
        // Set up authentication for this session
        await setupAuthenticationForSession(webContentSession);
        
        // Add to window and store reference
        logger.info(MODULE_NAME, 'Adding WebContentsView to window contentView');
        targetWindow.contentView.addChildView(webContentView);
        windowWebContentsViews.set(windowId, webContentView);
        logger.info(MODULE_NAME, 'WebContentsView added to window and stored in map');
        
        // Set up event handlers
        setupWebContentsViewEventHandlers(webContentView, targetWindow);
        
        // Navigate to the requested section
        logger.info(MODULE_NAME, `Navigating WebContentsView to section: ${section}`);
        await navigateWebContentsViewToSection(webContentView, section);
        logger.info(MODULE_NAME, 'Navigation completed');
        
        // Position the WebContentsView to fill the webcontents-container div
        // Add a delay to ensure DOM is ready
        setTimeout(() => {
            targetWindow.webContents.executeJavaScript(`
                const container = document.getElementById('webcontents-container');
                if (container) {
                    const rect = container.getBoundingClientRect();
                    const windowRect = { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
                    windowRect;
                } else {
                    null;
                }
            `).then((bounds) => {
                if (bounds && bounds.width > 0 && bounds.height > 0) {
                    webContentView.setBounds({
                        x: Math.round(bounds.x),
                        y: Math.round(bounds.y),
                        width: Math.round(bounds.width),
                        height: Math.round(bounds.height)
                    });
                    logger.info(MODULE_NAME, 'WebContentsView positioned in container:', bounds);
                } else {
                    // Fallback: fill the window below the header
                    const windowBounds = targetWindow.getContentBounds();
                    webContentView.setBounds({
                        x: 0,
                        y: 80, // Account for header height
                        width: windowBounds.width,
                        height: windowBounds.height - 80
                    });
                    logger.info(MODULE_NAME, 'WebContentsView positioned with fallback bounds');
                }
            }).catch((error) => {
                logger.error(MODULE_NAME, 'Failed to get container bounds:', error);
                // Fallback positioning
                const windowBounds = targetWindow.getContentBounds();
                webContentView.setBounds({
                    x: 0,
                    y: 80,
                    width: windowBounds.width,
                    height: windowBounds.height - 80
                });
            });
        }, 200); // Give DOM time to render
        
        // Handle window resize
        targetWindow.on('resize', () => {
            if (!webContentView || !webContentView.webContents || webContentView.webContents.isDestroyed()) return;
            
            targetWindow.webContents.executeJavaScript(`
                const container = document.getElementById('webcontents-container');
                if (container) {
                    const rect = container.getBoundingClientRect();
                    ({ x: rect.left, y: rect.top, width: rect.width, height: rect.height });
                } else {
                    null;
                }
            `).then((bounds) => {
                if (bounds && bounds.width > 0 && bounds.height > 0 && webContentView) {
                    webContentView.setBounds({
                        x: Math.round(bounds.x),
                        y: Math.round(bounds.y),
                        width: Math.round(bounds.width),
                        height: Math.round(bounds.height)
                    });
                }
            }).catch(() => {
                // Fallback on error
                if (webContentView && !targetWindow.isDestroyed()) {
                    const windowBounds = targetWindow.getContentBounds();
                    webContentView.setBounds({
                        x: 0,
                        y: 80,
                        width: windowBounds.width,
                        height: windowBounds.height - 80
                    });
                }
            });
        });
        
        // Clean up on window close
        targetWindow.on('closed', () => {
            logger.info(MODULE_NAME, `Window ${windowId} closed, cleaning up WebContentsView`);
            if (windowWebContentsViews.has(windowId)) {
                const view = windowWebContentsViews.get(windowId);
                if (view && view.webContents && !view.webContents.isDestroyed()) {
                    try {
                        (view.webContents as any).destroy();
                    } catch (error) {
                        logger.warn(MODULE_NAME, 'Error destroying WebContentsView:', error);
                    }
                }
                windowWebContentsViews.delete(windowId);
            }
        });
        
        logger.info(MODULE_NAME, `WebContentsView created and attached to window ${windowId}`);
        return webContentView;
    } catch (error) {
        logger.error(MODULE_NAME, 'Failed to create WebContentsView for window:', error);
        throw error;
    }
}

// Helper function to setup authentication for a WebContentsView session
async function setupAuthenticationForSession(webContentSession: Electron.Session): Promise<void> {
    try {
        const trustedDomains = [
            'killfeed.sinfulshadows.com',
            'server-killfeed.sinfulshadows.com',
            'voidlog.gg',
            'localhost'
        ];
        
        // Set up request interception
        webContentSession.webRequest.onBeforeSendHeaders((details, callback) => {
            const currentTokens = getCurrentAuthTokens();
            
            if (currentTokens?.accessToken) {
                const url = details.url;
                
                // Only add auth headers to API requests, not static assets
                const isApiRequest = url.includes('/api/') && !url.includes('/_nuxt/');
                
                // Also add auth for specific trusted domain requests (but not static assets)
                const isTrustedDomainRequest = trustedDomains.some(domain => {
                    try {
                        const urlObj = new URL(url);
                        return urlObj.hostname === domain || urlObj.hostname.endsWith('.' + domain);
                    } catch {
                        return false;
                    }
                }) && !url.includes('/_nuxt/') && !url.includes('/node_modules/');

                if ((isApiRequest || isTrustedDomainRequest) && !details.requestHeaders['Authorization']) {
                    details.requestHeaders['Authorization'] = `Bearer ${currentTokens.accessToken}`;
                    logger.debug(MODULE_NAME, `Added Authorization header to: ${url}`);
                }
            }

            callback({ requestHeaders: details.requestHeaders });
        });

        // Inject authentication cookies
        await injectAuthenticationCookies(webContentSession);
        
        logger.info(MODULE_NAME, 'Authentication setup completed for WebContentsView session');
    } catch (error) {
        logger.error(MODULE_NAME, 'Failed to setup authentication for WebContentsView session:', error);
    }
}

// Helper function to inject authentication cookies
async function injectAuthenticationCookies(webContentSession: Electron.Session): Promise<void> {
    const currentTokens = getCurrentAuthTokens();
    if (!currentTokens?.accessToken) return;

    try {
        const isDevelopment = !process.env.NODE_ENV || process.env.NODE_ENV === 'development';
        const webAppBaseUrl = isDevelopment ? 'http://localhost:3001' : 'https://voidlog.gg';
        const urlObj = new URL(webAppBaseUrl);

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

// Helper function to setup WebContentsView event handlers
function setupWebContentsViewEventHandlers(webContentView: WebContentsView, targetWindow: BrowserWindow): void {
    webContentView.webContents.on('dom-ready', () => {
        // Send authentication data
        const currentTokens = getCurrentAuthTokens();
        if (currentTokens) {
            webContentView.webContents.send('auth-data-updated', {
                accessToken: currentTokens.accessToken,
                refreshToken: currentTokens.refreshToken,
                user: currentTokens.user,
                isAuthenticated: !!currentTokens.accessToken
            });
        }
        
        // Hide navigation bar with CSS and remove scrollbar rounded corners
        webContentView.webContents.insertCSS(`
            /* Hide the modern-navbar element */
            .modern-navbar {
                display: none !important;
            }
            
            /* Hide the first h-16 div */
            .h-16:first-of-type {
                display: none !important;
            }
            
            /* Remove rounded corners from scrollbars */
            ::-webkit-scrollbar {
                border-radius: 0 !important;
            }
            
            ::-webkit-scrollbar-thumb {
                border-radius: 0 !important;
            }
            
            ::-webkit-scrollbar-track {
                border-radius: 0 !important;
            }
            
            *::-webkit-scrollbar {
                border-radius: 0 !important;
            }
            
            *::-webkit-scrollbar-thumb {
                border-radius: 0 !important;
            }
            
            *::-webkit-scrollbar-track {
                border-radius: 0 !important;
            }
        `).catch((error) => {
            logger.warn(MODULE_NAME, 'Failed to inject navigation-hiding CSS:', error);
        });

        // Inject JavaScript as backup to ensure the first h-16 is hidden
        webContentView.webContents.executeJavaScript(`
            (() => {
                console.log('[VoidLog] Starting targeted navbar and spacer fix');
                
                function hideNavbarAndFirstSpacer() {
                    // Hide the modern-navbar element
                    const modernNavbar = document.querySelector('.modern-navbar');
                    if (modernNavbar) {
                        modernNavbar.style.display = 'none';
                        console.log('[VoidLog] Hidden modern-navbar element');
                    }
                    
                    // Hide/remove the first .h-16 element
                    const firstH16 = document.querySelector('.h-16');
                    if (firstH16) {
                        firstH16.style.display = 'none';
                        console.log('[VoidLog] Hidden first h-16 element');
                    }
                }
                
                // Run immediately
                hideNavbarAndFirstSpacer();
                
                // Run once more after a short delay to catch dynamic content
                setTimeout(hideNavbarAndFirstSpacer, 100);
                
                console.log('[VoidLog] Navbar and spacer fix completed');
            })();
        `).catch((error) => {
            logger.warn(MODULE_NAME, 'Failed to inject navbar fix JavaScript:', error);
        });
        
        // Notify the host window that WebContentsView is ready
        targetWindow.webContents.send('webcontents-view-ready');
    });

    webContentView.webContents.on('did-navigate', (event, url) => {
        logger.info(MODULE_NAME, `WebContentsView navigated to: ${url}`);
        // Re-inject cookies for new URL
        injectAuthenticationCookies(webContentView.webContents.session);
        
        // Notify the host window that navigation started
        targetWindow.webContents.send('webcontents-view-loading');
    });

    webContentView.webContents.on('did-finish-load', () => {
        logger.info(MODULE_NAME, 'WebContentsView finished loading');
        // Notify the host window that content is ready
        targetWindow.webContents.send('webcontents-view-loaded');
    });

    webContentView.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
        logger.error(MODULE_NAME, `WebContentsView load failed: ${errorCode} - ${errorDescription}`);
        // Notify the host window about the error
        targetWindow.webContents.send('webcontents-view-error', { errorCode, errorDescription });
    });
}

// Helper function to navigate WebContentsView to a section
async function navigateWebContentsViewToSection(webContentView: WebContentsView, section: 'profile' | 'leaderboard' | 'map' | 'events' | 'stats'): Promise<void> {
    try {
        const isDevelopment = !process.env.NODE_ENV || process.env.NODE_ENV === 'development';
        const webAppBaseUrl = isDevelopment ? 'http://localhost:3001' : 'https://voidlog.gg';
        
        const currentTokens = getCurrentAuthTokens();
        let url = webAppBaseUrl;
        
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

        logger.info(MODULE_NAME, `Navigating WebContentsView to section: ${section} - ${url}`);
        await webContentView.webContents.loadURL(url);
    } catch (error) {
        logger.error(MODULE_NAME, `Failed to navigate WebContentsView to section ${section}:`, error);
    }
}