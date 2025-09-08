import { ipcMain, BrowserWindow, WebContentsView, session, app } from 'electron';
import * as logger from './modules/logger';
import { getCurrentAuthTokens, getAuthStatus, storeTokens, refreshToken } from './modules/auth-manager';
import { 
    createEmbeddedWebContentManager, 
    getEmbeddedWebContentManager, 
    closeEmbeddedWebContentManager 
} from './modules/embedded-webcontents-manager';
import { getMainWindow, getPreloadPath, createWebContentWindow } from './modules/window-manager';
import { getLastLoggedInUser } from './modules/config-manager';

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

    // NOTE: Enhanced navigation handler removed to avoid conflict with navigation controller

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
                // Hide the WebContentsView by removing it from the window
                try {
                    senderWindow.contentView.removeChildView(webContentView);
                    logger.info(MODULE_NAME, 'Hidden WebContentsView by removing from window');
                } catch (error) {
                    logger.error(MODULE_NAME, 'Failed to remove WebContentsView:', error);
                    // Fallback: move off-screen
                    const windowBounds = senderWindow.getContentBounds();
                    webContentView.setBounds({ 
                        x: -windowBounds.width * 2, 
                        y: -windowBounds.height * 2, 
                        width: windowBounds.width, 
                        height: windowBounds.height 
                    });
                    logger.info(MODULE_NAME, 'Hidden WebContentsView by moving off-screen (fallback)');
                }
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
                // Show the WebContentsView by re-adding it to the window
                try {
                    // First check if it's already attached
                    const children = senderWindow.contentView.children;
                    const isAttached = children.includes(webContentView);
                    
                    if (!isAttached) {
                        // Re-add to window
                        senderWindow.contentView.addChildView(webContentView);
                        logger.info(MODULE_NAME, 'Re-added WebContentsView to window');
                    }
                    
                    // Set proper bounds
                    const windowBounds = senderWindow.getContentBounds();
                    const headerHeight = 80;
                    webContentView.setBounds({
                        x: 0,
                        y: headerHeight,
                        width: windowBounds.width,
                        height: windowBounds.height - headerHeight
                    });
                    logger.info(MODULE_NAME, 'Restored WebContentsView bounds');
                    
                } catch (error) {
                    logger.error(MODULE_NAME, 'Failed to show WebContentsView:', error);
                    
                    // Fallback: just restore bounds
                    try {
                        const windowBounds = senderWindow.getContentBounds();
                        webContentView.setBounds({
                            x: 0,
                            y: 80,
                            width: windowBounds.width,
                            height: windowBounds.height - 80
                        });
                        logger.info(MODULE_NAME, 'Used fallback bounds for WebContentsView');
                    } catch (fallbackError) {
                        logger.error(MODULE_NAME, 'Fallback positioning also failed:', fallbackError);
                    }
                }
            }
        } catch (error) {
            logger.error(MODULE_NAME, 'Failed to show WebContentsView:', error);
        }
    });

    // Window close
    ipcMain.on('enhanced-window:close', async (event) => {
        try {
            // Try to close the WebContentPage window first
            const senderWindow = BrowserWindow.fromWebContents(event.sender);
            if (senderWindow && senderWindow.getTitle().includes('Web Content')) {
                logger.info(MODULE_NAME, 'Closing WebContentPage window');
                senderWindow.close();
                return;
            }
            
            // If no WebContentPage window, check for any web content windows
            const allWindows = BrowserWindow.getAllWindows();
            const webContentWindow = allWindows.find(win => 
                win.getTitle().includes('Web Content') && 
                !win.isDestroyed()
            );
            
            if (webContentWindow) {
                logger.info(MODULE_NAME, 'Found and closing web content window');
                webContentWindow.close();
                return;
            }
            
            logger.warn(MODULE_NAME, 'No web content window found to close');
        } catch (error) {
            logger.error(MODULE_NAME, 'Failed to close window:', error instanceof Error ? error.message : 'Unknown error');
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
    ipcMain.handle('enhanced-window:attach-to-existing', async (event, section: 'profile' | 'leaderboard' | 'map' | 'events' | 'stats' | 'profile-settings' = 'profile') => {
        try {
            logger.info(MODULE_NAME, `Handling enhanced window request for section: ${section}`);
            
            // FIRST: Try to find or create the proper WebContentPage window
            logger.info(MODULE_NAME, `Looking for web content window for section: ${section}`);
            
            // Find the web content window by title or check all windows
            let webContentWindow: BrowserWindow | null = null;
            
            // Log all available windows for debugging
            const allWindows = BrowserWindow.getAllWindows();
            logger.info(MODULE_NAME, 'All available windows:', allWindows.map(win => ({
                id: win.id,
                title: win.getTitle(),
                isDestroyed: win.isDestroyed()
            })));
            
            // First check if there's already a web content window open
            webContentWindow = allWindows.find(win => 
                win.getTitle().includes('Web Content') && 
                !win.isDestroyed()
            ) || null;
            
            if (webContentWindow) {
                logger.info(MODULE_NAME, 'Found existing web content window:', {
                    id: webContentWindow.id,
                    title: webContentWindow.getTitle()
                });
            } else {
                logger.info(MODULE_NAME, 'No existing web content window found');
                
                // Check if sender is the web content window (unlikely when called from main)
                const senderWindow = BrowserWindow.fromWebContents(event.sender);
                if (senderWindow && senderWindow.getTitle().includes('Web Content')) {
                    webContentWindow = senderWindow;
                    logger.info(MODULE_NAME, 'Using sender as web content window');
                }
            }
            
            if (!webContentWindow) {
                logger.info(MODULE_NAME, 'Web content window not found, creating new one');
                
                // Use the imported createWebContentWindow function
                if (createWebContentWindow) {
                    // Filter out profile-settings as it's not supported by createWebContentWindow
                    const validSection = section === 'profile-settings' ? undefined : section;
                    webContentWindow = createWebContentWindow(validSection);
                    if (webContentWindow) {
                        logger.info(MODULE_NAME, 'Created new web content window successfully');
                        
                        // Wait a moment for window to be ready
                        await new Promise(resolve => setTimeout(resolve, 100));
                        
                        return {
                            success: true,
                            architecture: 'webcontent-window',
                            section,
                            timestamp: new Date().toISOString()
                        };
                    }
                }
                
                // Don't fallback - just report the error
                logger.error(MODULE_NAME, 'Failed to create web content window - createWebContentWindow returned null');
                return {
                    success: false,
                    error: 'Failed to create web content window',
                    architecture: 'webcontent-window',
                    timestamp: new Date().toISOString()
                };
            } else {
                logger.info(MODULE_NAME, 'Found existing web content window');
                
                // Restore if minimized
                if (webContentWindow.isMinimized()) {
                    logger.info(MODULE_NAME, 'Window is minimized, restoring...');
                    webContentWindow.restore();
                }
                
                // Focus the window
                webContentWindow.focus();
                
                // Check if WebContentsView already exists for this window
                const existingView = windowWebContentsViews.get(webContentWindow.id);
                
                if (existingView && existingView.webContents && !existingView.webContents.isDestroyed()) {
                    // WebContentsView exists, just navigate it
                    logger.info(MODULE_NAME, `WebContentsView already exists, navigating to ${section}`);
                    await navigateWebContentsViewToSection(existingView, section);
                    
                    // Also send navigation event to the window
                    if (section && webContentWindow.webContents) {
                        webContentWindow.webContents.send('navigate-to-section', section);
                    }
                } else {
                    // No WebContentsView exists, create one
                    logger.info(MODULE_NAME, 'No existing WebContentsView, creating new one');
                    await createWebContentsViewForWindow(webContentWindow, section);
                }
            }
            
            logger.info(MODULE_NAME, 'WebContentsView navigation completed successfully');
            
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

    // DEPRECATED: Create embedded WebContentsView overlay - now redirects to proper WebContentPage
    ipcMain.handle('enhanced-window:create', async (_, section: 'profile' | 'leaderboard' | 'map' | 'events' | 'stats' | 'profile-settings' = 'profile') => {
        try {
            logger.warn(MODULE_NAME, `DEPRECATED: enhanced-window:create called, redirecting to WebContentPage for section: ${section}`);
            
            // Redirect to proper WebContentPage window creation
            if (createWebContentWindow) {
                // Filter out profile-settings as it's not supported by createWebContentWindow
                const validSection = section === 'profile-settings' ? undefined : section;
                const window = createWebContentWindow(validSection);
                if (window) {
                    logger.info(MODULE_NAME, 'Created WebContentPage window instead of embedded overlay');
                    return {
                        success: true,
                        architecture: 'webcontent-window',
                        section,
                        timestamp: new Date().toISOString()
                    };
                }
            }
            
            return {
                success: false,
                error: 'Failed to create WebContentPage window',
                architecture: 'webcontent-window'
            };
        } catch (error) {
            logger.error(MODULE_NAME, 'Failed to create window:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
                architecture: 'unknown'
            };
        }
    });

    // Close WebContentPage window (previously embedded overlay)
    ipcMain.handle('enhanced-window:close-window', async () => {
        try {
            // Find and close the WebContentPage window
            const allWindows = BrowserWindow.getAllWindows();
            const webContentWindow = allWindows.find(win => 
                win.getTitle().includes('Web Content') && 
                !win.isDestroyed()
            );
            
            if (webContentWindow) {
                logger.info(MODULE_NAME, 'Closing WebContentPage window');
                webContentWindow.close();
                return true;
            } else {
                logger.warn(MODULE_NAME, 'No WebContentPage window found to close');
                return false;
            }
        } catch (error) {
            logger.error(MODULE_NAME, 'Failed to close WebContentPage window:', error);
            return false;
        }
    });

    // Get WebContentPage window status
    ipcMain.handle('enhanced-window:get-status', async () => {
        try {
            // Find the WebContentPage window
            const allWindows = BrowserWindow.getAllWindows();
            const webContentWindow = allWindows.find(win => 
                win.getTitle().includes('Web Content') && 
                !win.isDestroyed()
            );
            
            if (webContentWindow) {
                // Get the current section from window state or WebContentsView
                let activeSection = null;
                const webContentView = windowWebContentsViews.get(webContentWindow.id);
                
                if (webContentView && webContentView.webContents && !webContentView.webContents.isDestroyed()) {
                    const currentUrl = webContentView.webContents.getURL();
                    activeSection = detectSectionFromUrl(currentUrl);
                }
                
                return {
                    isOpen: true,
                    activeSection: activeSection,
                    architecture: 'webcontent-window',
                    authenticationEnabled: true,
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
            logger.error(MODULE_NAME, 'Failed to get WebContentPage window status:', error);
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

    // Navigate to a specific section in the web content window
    ipcMain.handle('web-content:navigate-to-section', async (event, section: 'profile' | 'leaderboard' | 'map') => {
        try {
            logger.info(MODULE_NAME, `Navigation request to section: ${section}`);
            
            // First try to navigate existing window
            const manager = getEmbeddedWebContentManager();
            if (manager && manager.isOverlayVisible()) {
                await manager.navigateToSection(section);
                logger.info(MODULE_NAME, `Navigated existing window to ${section}`);
                
                return {
                    success: true,
                    section,
                    architecture: 'embedded-webcontentsview'
                };
            }
            
            // Check for existing web content windows
            const allWindows = BrowserWindow.getAllWindows();
            const webContentWindow = allWindows.find(win => 
                win.getTitle().includes('Web Content') && 
                !win.isDestroyed()
            );
            
            if (webContentWindow) {
                // Check if it has a WebContentsView
                const existingView = windowWebContentsViews.get(webContentWindow.id);
                
                if (existingView && existingView.webContents && !existingView.webContents.isDestroyed()) {
                    // Navigate existing WebContentsView
                    await navigateWebContentsViewToSection(existingView, section);
                    webContentWindow.webContents.send('navigate-to-section', section);
                    
                    return {
                        success: true,
                        section,
                        architecture: 'webcontentsview'
                    };
                }
            }
            
            // No existing window/view found, create proper WebContentPage window
            logger.info(MODULE_NAME, 'No existing window found, creating proper WebContentPage window');
            
            if (createWebContentWindow) {
                const newWindow = createWebContentWindow(section);
                if (newWindow) {
                    logger.info(MODULE_NAME, 'Created new WebContentPage window successfully');
                    return {
                        success: true,
                        section,
                        architecture: 'webcontent-window'
                    };
                }
            }
            
            // Return error instead of falling back to embedded manager
            return {
                success: false,
                error: 'Failed to create WebContentPage window'
            };
        } catch (error) {
            logger.error(MODULE_NAME, 'Failed to navigate to section:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error'
            };
        }
    });

    // Update authentication tokens in WebContentsView
    ipcMain.handle('web-content:update-auth-tokens', async (event, tokens: { accessToken?: string; refreshToken?: string; user?: any }) => {
        try {
            logger.info(MODULE_NAME, 'Updating auth tokens in WebContentsView');
            
            // Update tokens in auth manager
            if (tokens && tokens.accessToken && tokens.refreshToken) {
                await storeTokens({
                    accessToken: tokens.accessToken,
                    refreshToken: tokens.refreshToken,
                    user: tokens.user || null
                });
            }
            
            // Update embedded manager if it exists
            const manager = getEmbeddedWebContentManager();
            if (manager) {
                await manager.refreshAuthentication();
            }
            
            // Update any existing WebContentsViews
            windowWebContentsViews.forEach((view, windowId) => {
                if (view && view.webContents && !view.webContents.isDestroyed()) {
                    view.webContents.send('auth-data-updated', tokens);
                }
            });
            
            // Broadcast to all windows
            const currentAuth = await getCurrentAuthTokens();
            await broadcastAuthUpdate(currentAuth);
            
            return {
                success: true,
                message: 'Auth tokens updated successfully'
            };
        } catch (error) {
            logger.error(MODULE_NAME, 'Failed to update auth tokens:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error'
            };
        }
    });

    // Set WebContentsView architecture preference (legacy - always returns true now)
    ipcMain.handle('web-content:set-architecture', async (event, useWebContentsView: boolean) => {
        try {
            logger.info(MODULE_NAME, `Architecture preference set to: ${useWebContentsView ? 'WebContentsView' : 'BrowserWindow'}`);
            
            // In the new architecture, we always use WebContentsView
            // This handler exists for backwards compatibility
            
            return {
                success: true,
                architecture: 'webcontentsview',
                message: 'Architecture is fixed to WebContentsView in current implementation'
            };
        } catch (error) {
            logger.error(MODULE_NAME, 'Failed to set architecture:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error'
            };
        }
    });

    // Get current architecture being used
    ipcMain.handle('web-content:get-architecture', async () => {
        try {
            // Check if embedded manager exists
            const manager = getEmbeddedWebContentManager();
            const hasManager = !!manager;
            
            // Check for any WebContentsViews
            const hasWebContentsViews = windowWebContentsViews.size > 0;
            
            return {
                current: 'webcontentsview',
                isWebContentsViewAvailable: true,
                hasEmbeddedManager: hasManager,
                hasAttachedViews: hasWebContentsViews,
                architecture: hasManager ? 'embedded-webcontentsview' : 'attached-webcontentsview'
            };
        } catch (error) {
            logger.error(MODULE_NAME, 'Failed to get architecture:', error);
            return {
                current: 'unknown',
                isWebContentsViewAvailable: false,
                error: error instanceof Error ? error.message : 'Unknown error'
            };
        }
    });

    // --- Config Management Handlers ---

    // Get event filter preference
    ipcMain.handle('config:get-event-filter', async () => {
        try {
            const { getEventFilter } = await import('./modules/config-manager');
            const filter = getEventFilter();
            logger.debug(MODULE_NAME, `Retrieved event filter preference: ${filter}`);
            return filter;
        } catch (error) {
            logger.error(MODULE_NAME, 'Failed to get event filter preference:', error);
            return 'all'; // Default fallback
        }
    });

    // Set event filter preference
    ipcMain.handle('config:set-event-filter', async (event, filter: 'all' | 'local') => {
        try {
            const { setEventFilter } = await import('./modules/config-manager');
            setEventFilter(filter);
            logger.info(MODULE_NAME, `Set event filter preference to: ${filter}`);
            return { success: true };
        } catch (error) {
            logger.error(MODULE_NAME, 'Failed to set event filter preference:', error);
            return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
        }
    });

    // Get discovered event categories
    ipcMain.handle('config:get-discovered-categories', async () => {
        try {
            const { getDiscoveredCategories } = await import('./modules/config-manager');
            const categories = getDiscoveredCategories();
            logger.debug(MODULE_NAME, `Retrieved ${Object.keys(categories).length} discovered categories`);
            return categories;
        } catch (error) {
            logger.error(MODULE_NAME, 'Failed to get discovered categories:', error);
            return {}; // Default fallback
        }
    });

    // Get selected category filters
    ipcMain.handle('config:get-selected-category-filters', async () => {
        try {
            const { getSelectedCategoryFilters } = await import('./modules/config-manager');
            const filters = getSelectedCategoryFilters();
            logger.debug(MODULE_NAME, `Retrieved ${filters.length} selected category filters`);
            return filters;
        } catch (error) {
            logger.error(MODULE_NAME, 'Failed to get selected category filters:', error);
            return []; // Default fallback
        }
    });

    // Set selected category filters
    ipcMain.handle('config:set-selected-category-filters', async (event, categoryIds: string[]) => {
        try {
            const { setSelectedCategoryFilters } = await import('./modules/config-manager');
            setSelectedCategoryFilters(categoryIds);
            logger.info(MODULE_NAME, `Set ${categoryIds.length} selected category filters`);
            return { success: true };
        } catch (error) {
            logger.error(MODULE_NAME, 'Failed to set selected category filters:', error);
            return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
        }
    });

    // Toggle a category filter
    ipcMain.handle('config:toggle-category-filter', async (event, categoryId: string) => {
        try {
            const { toggleCategoryFilter } = await import('./modules/config-manager');
            toggleCategoryFilter(categoryId);
            logger.info(MODULE_NAME, `Toggled category filter: ${categoryId}`);
            return { success: true };
        } catch (error) {
            logger.error(MODULE_NAME, 'Failed to toggle category filter:', error);
            return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
        }
    });

    // --- Search API Handlers ---

    // Proxy search API calls through Electron main process (bypasses CORS)
    ipcMain.handle('search-api:query', async (event, query: string) => {
        try {
            logger.info(MODULE_NAME, `Search API request for query: "${query}"`);
            
            // Determine API base URL - default to production
            const isDevelopment = process.env.NODE_ENV === 'development';
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
                const result = await webContentView.webContents.executeJavaScript(jsCode);
                logger.debug(MODULE_NAME, 'JavaScript executed in WebContentsView successfully');
                return { success: true, result };
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

    // Navigate to search page with query parameters (Deprecated - use search overlay instead)
    ipcMain.handle('enhanced-webcontents:navigate-to-search', async (event, query: string) => {
        try {
            logger.warn(MODULE_NAME, 'navigateToSearchPage is deprecated - use search overlay instead');
            return { success: false, error: 'Direct search navigation is no longer supported - use the search overlay' };
        } catch (error) {
            logger.error(MODULE_NAME, 'Failed to navigate to search page:', error);
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

    // --- WebContentsView Navigation Handlers ---
    
    // Handle section navigation for WebContentsView windows
    ipcMain.on('web-content-navigate-to-section', async (event, section: 'profile' | 'leaderboard' | 'map' | 'events' | 'stats' | 'profile-settings') => {
        try {
            logger.info(MODULE_NAME, `Received WebContentsView navigation request for section: ${section}`);
            
            const senderWindow = BrowserWindow.fromWebContents(event.sender);
            if (!senderWindow) {
                logger.error(MODULE_NAME, 'Could not find sender window for WebContentsView navigation');
                return;
            }
            
            const windowId = senderWindow.id;
            const webContentView = windowWebContentsViews.get(windowId);
            
            if (webContentView && webContentView.webContents && !webContentView.webContents.isDestroyed()) {
                logger.info(MODULE_NAME, `Navigating existing WebContentsView to section: ${section}`);
                try {
                    await navigateWebContentsViewToSection(webContentView, section);
                    logger.info(MODULE_NAME, `Successfully navigated WebContentsView to ${section}`);
                } catch (navError) {
                    logger.error(MODULE_NAME, `Error during WebContentsView navigation:`, navError);
                    // Try to recreate the WebContentsView if navigation failed
                    logger.warn(MODULE_NAME, `Attempting to recreate WebContentsView after navigation failure`);
                    await createWebContentsViewForWindow(senderWindow, section);
                }
            } else {
                logger.warn(MODULE_NAME, `No WebContentsView found for window ${windowId}, creating new one`);
                // Create new WebContentsView if one doesn't exist
                await createWebContentsViewForWindow(senderWindow, section);
                logger.info(MODULE_NAME, `Created new WebContentsView and navigated to ${section}`);
            }
        } catch (error) {
            logger.error(MODULE_NAME, `Failed to navigate WebContentsView to section ${section}:`, error);
        }
    });

    // Handle URL navigation for WebContentsView windows (for search results)
    ipcMain.on('enhanced-window:navigate-to-url', async (event, url: string) => {
        try {
            logger.info(MODULE_NAME, `Received WebContentsView navigation request for URL: ${url}`);
            
            const senderWindow = BrowserWindow.fromWebContents(event.sender);
            if (!senderWindow) {
                logger.error(MODULE_NAME, 'Could not find sender window for WebContentsView navigation');
                return;
            }
            
            const windowId = senderWindow.id;
            const webContentView = windowWebContentsViews.get(windowId);
            
            if (webContentView && webContentView.webContents && !webContentView.webContents.isDestroyed()) {
                const currentUrl = webContentView.webContents.getURL();
                const isDevelopment = process.env.NODE_ENV === 'development';
                const expectedDomain = isDevelopment ? 'localhost' : 'voidlog.gg';
                
                // Check if we're already on the web app for fast navigation
                if (currentUrl && currentUrl.includes(expectedDomain)) {
                    logger.info(MODULE_NAME, `Already on web app, attempting fast navigation to: ${url}`);
                    
                    // Try using SPA navigation first
                    const spaNavigationScript = `
                        (function() {
                            // Check if Vue Router is available
                            if (window.$router) {
                                window.$router.push('${url}');
                                return 'router-navigation';
                            }
                            // Check for Next.js router
                            else if (window.next && window.next.router) {
                                window.next.router.push('${url}');
                                return 'nextjs-navigation';
                            }
                            // Check for React Router
                            else if (window.history && window.history.pushState) {
                                window.history.pushState(null, '', '${url}');
                                window.dispatchEvent(new PopStateEvent('popstate'));
                                return 'history-navigation';
                            }
                            return 'no-spa-router';
                        })();
                    `;
                    
                    try {
                        const result = await webContentView.webContents.executeJavaScript(spaNavigationScript);
                        logger.info(MODULE_NAME, `SPA navigation result: ${result}`);
                        
                        if (result !== 'no-spa-router') {
                            logger.info(MODULE_NAME, `Fast SPA navigation to ${url} completed using ${result}`);
                            
                            // Detect section from URL and broadcast status
                            const section = detectSectionFromUrl(url);
                            if (section) {
                                broadcastNavigationStatus(section);
                                // Also notify the specific window
                                senderWindow.webContents.send('navigate-to-section', section);
                            }
                            
                            return; // Fast path complete
                        }
                    } catch (err) {
                        logger.warn(MODULE_NAME, `SPA navigation attempt failed:`, err);
                    }
                }
                
                // Fallback to full URL navigation
                const baseUrl = isDevelopment ? 'http://localhost:3001' : 'https://voidlog.gg';
                const fullUrl = baseUrl + url;
                
                logger.info(MODULE_NAME, `Falling back to full URL navigation: ${fullUrl}`);
                await webContentView.webContents.loadURL(fullUrl);
                logger.info(MODULE_NAME, `Successfully navigated WebContentsView to ${fullUrl}`);
            } else {
                logger.warn(MODULE_NAME, `No WebContentsView found for window ${windowId}`);
            }
        } catch (error) {
            logger.error(MODULE_NAME, `Failed to navigate WebContentsView to URL ${url}:`, error);
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

// Helper function to detect section from URL
function detectSectionFromUrl(url: string): 'profile' | 'leaderboard' | 'map' | 'events' | 'stats' | 'profile-settings' | null {
    try {
        // Remove query parameters for clean matching
        const urlWithoutParams = url.split('?')[0];
        
        if (urlWithoutParams.includes('/leaderboard')) return 'leaderboard';
        if (urlWithoutParams.includes('/map')) return 'map';
        if (urlWithoutParams.includes('/events')) return 'events';
        if (urlWithoutParams.includes('/stats')) return 'stats';
        if (urlWithoutParams.includes('/settings')) return 'profile-settings';
        if (urlWithoutParams.includes('/user/') || urlWithoutParams.includes('/profile') || urlWithoutParams.endsWith('/')) return 'profile';
        
        return null;
    } catch (error) {
        logger.error(MODULE_NAME, 'Failed to detect section from URL:', error);
        return null;
    }
}

// Helper function to broadcast navigation status to all windows
function broadcastNavigationStatus(section: 'profile' | 'leaderboard' | 'map' | 'events' | 'stats' | 'profile-settings') {
    const windows = BrowserWindow.getAllWindows();
    const status = {
        isOpen: true,
        activeSection: section,
        architecture: 'attached-webcontentsview'
    };
    
    windows.forEach(window => {
        if (!window.isDestroyed()) {
            window.webContents.send('web-content-window-status', status);
        }
    });
    
    logger.info(MODULE_NAME, `Broadcasted navigation status: ${JSON.stringify(status)}`);
}

// Export function to navigate WebContentsView for a specific window
export async function navigateWebContentsViewForWindow(
    windowId: number, 
    section: 'profile' | 'leaderboard' | 'map' | 'events' | 'stats' | 'profile-settings'
): Promise<boolean> {
    try {
        logger.info(MODULE_NAME, `navigateWebContentsViewForWindow called for window ${windowId}, section: ${section}`);
        logger.info(MODULE_NAME, `Current WebContentsView map size: ${windowWebContentsViews.size}`);
        logger.info(MODULE_NAME, `Available window IDs in map: ${Array.from(windowWebContentsViews.keys()).join(', ')}`);
        
        const webContentView = windowWebContentsViews.get(windowId);
        
        if (webContentView && webContentView.webContents && !webContentView.webContents.isDestroyed()) {
            logger.info(MODULE_NAME, `Found WebContentsView for window ${windowId}, navigating to section: ${section}`);
            await navigateWebContentsViewToSection(webContentView, section);
            logger.info(MODULE_NAME, `Successfully navigated WebContentsView to ${section}`);
            return true;
        } else {
            logger.warn(MODULE_NAME, `No WebContentsView found for window ${windowId}`);
            
            // Try to find the web content window and create WebContentsView
            const allWindows = BrowserWindow.getAllWindows();
            const webContentWindow = allWindows.find(win => 
                win.id === windowId || 
                (win.getTitle().includes('Web Content') && !win.isDestroyed())
            );
            
            if (webContentWindow) {
                logger.info(MODULE_NAME, `Found web content window (ID: ${webContentWindow.id}), creating WebContentsView`);
                await createWebContentsViewForWindow(webContentWindow, section);
                return true;
            }
            
            return false;
        }
    } catch (error) {
        logger.error(MODULE_NAME, `Failed to navigate WebContentsView for window ${windowId} to section ${section}:`, error);
        return false;
    }
}

// Helper function to create WebContentsView for an existing window
async function createWebContentsViewForWindow(targetWindow: BrowserWindow, section: 'profile' | 'leaderboard' | 'map' | 'events' | 'stats' | 'profile-settings'): Promise<WebContentsView> {
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
            preloadPath = getPreloadPath('webcontents-view-preload.mjs');
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
                devTools: !app.isPackaged, // Disable DevTools in production
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
        
        // Position the WebContentsView with proper bounds
        const windowBounds = targetWindow.getContentBounds();
        const bounds = {
            x: 0,
            y: 80, // Account for header height
            width: Math.max(100, windowBounds.width || 1200), // Ensure minimum width
            height: Math.max(100, (windowBounds.height - 80) || 600) // Ensure minimum height
        };
        
        // Ensure view is visible before setting bounds
        webContentView.setVisible(true);
        webContentView.setBounds(bounds);
        logger.info(MODULE_NAME, 'WebContentsView positioned with bounds:', bounds);
        
        // Force a layout update - removed as View.layout() is no longer available in newer Electron versions
        
        // Get actual bounds to verify
        const actualBounds = webContentView.getBounds();
        logger.info(MODULE_NAME, 'WebContentsView actual bounds after setting:', actualBounds);
        
        // Store the WebContentsView ID for debugging
        logger.info(MODULE_NAME, `WebContentsView created and stored with window ID: ${windowId}`);
        
        // Set background color to ensure visibility
        webContentView.setBackgroundColor('#1a1a1a');
        
        // Open DevTools for debugging in development
        if (!app.isPackaged) {
            webContentView.webContents.openDevTools({ mode: 'detach' });
            logger.info(MODULE_NAME, 'Opened DevTools for WebContentsView debugging');
        }
        
        // Then try to get exact container bounds without delay
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
                logger.info(MODULE_NAME, 'WebContentsView repositioned in container:', bounds);
            }
        }).catch((error) => {
            logger.error(MODULE_NAME, 'Failed to get container bounds:', error);
            // Already positioned with fallback bounds, no action needed
        });
        
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
        const isDevelopment = process.env.NODE_ENV === 'development';
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

// Helper function to inject navbar hiding CSS and JavaScript
function injectNavbarHidingCSS(webContentView: WebContentsView): void {
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
        
        /* Fix sticky header container position */
        .sticky-header-container {
            top: -1px !important;
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
}

// Helper function to setup WebContentsView event handlers
function setupWebContentsViewEventHandlers(webContentView: WebContentsView, targetWindow: BrowserWindow): void {
    webContentView.webContents.on('dom-ready', () => {
        // Inject navbar hiding CSS and JavaScript
        injectNavbarHidingCSS(webContentView);
        
        // Notify the host window that WebContentsView is ready
        targetWindow.webContents.send('webcontents-view-ready');
    });

    webContentView.webContents.on('did-navigate', (event, url) => {
        logger.info(MODULE_NAME, `WebContentsView navigated to: ${url}`);
        // Re-inject cookies for new URL
        injectAuthenticationCookies(webContentView.webContents.session);
        
        // Detect section from URL
        const section = detectSectionFromUrl(url);
        if (section) {
            logger.info(MODULE_NAME, `Detected section from navigation: ${section}`);
            
            // Emit status update to all windows
            broadcastNavigationStatus(section);
            
            // Also notify the specific window
            targetWindow.webContents.send('navigate-to-section', section);
        }
        
        // Notify the host window that navigation started
        targetWindow.webContents.send('webcontents-view-loading');
    });

    webContentView.webContents.on('did-finish-load', () => {
        logger.info(MODULE_NAME, 'WebContentsView finished loading');
        // Notify the host window that content is ready
        targetWindow.webContents.send('webcontents-view-loaded');
    });

    webContentView.webContents.on('did-navigate-in-page', (event, url) => {
        logger.info(MODULE_NAME, `WebContentsView navigated in-page to: ${url}`);
        
        // Detect section from URL for SPA navigation
        const section = detectSectionFromUrl(url);
        if (section) {
            logger.info(MODULE_NAME, `Detected section from SPA navigation: ${section}`);
            
            // Emit status update to all windows
            broadcastNavigationStatus(section);
            
            // Also notify the specific window
            targetWindow.webContents.send('navigate-to-section', section);
        }
        
        // For SPA navigation, also notify that the page changed
        targetWindow.webContents.send('webcontents-view-loaded');
    });

    webContentView.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
        logger.error(MODULE_NAME, `WebContentsView load failed: ${errorCode} - ${errorDescription}`);
        // Notify the host window about the error
        targetWindow.webContents.send('webcontents-view-error', { errorCode, errorDescription });
    });
}

// Helper function to navigate WebContentsView to a section
async function navigateWebContentsViewToSection(webContentView: WebContentsView, section: 'profile' | 'leaderboard' | 'map' | 'events' | 'stats' | 'profile-settings'): Promise<void> {
    try {
        // Prevent crashes from destroyed WebContentsView
        if (!webContentView || !webContentView.webContents || webContentView.webContents.isDestroyed()) {
            logger.error(MODULE_NAME, `WebContentsView is destroyed or invalid, cannot navigate to ${section}`);
            return;
        }
        
        logger.info(MODULE_NAME, `Navigating WebContentsView to section: ${section}`);
        
        // Immediately broadcast the navigation status
        broadcastNavigationStatus(section);
        
        // First, try to navigate using the web app's internal navigation (MUCH faster)
        const currentUrl = webContentView.webContents.getURL();
        const isDevelopment = process.env.NODE_ENV === 'development';
        const expectedDomain = isDevelopment ? 'localhost' : 'voidlog.gg';
        
        // Check if we're already on the web app
        if (currentUrl && currentUrl.includes(expectedDomain)) {
            logger.info(MODULE_NAME, `Already on web app, checking for fast navigation capability`);
            
            // For voidlog.gg, we need to navigate by URL since it's an external site
            // Build the navigation URL
            const webAppBaseUrl = isDevelopment ? 'http://localhost:3001' : 'https://voidlog.gg';
            const currentTokens = getCurrentAuthTokens();
            let targetPath = '';
            
            switch (section) {
                case 'profile':
                    if (currentTokens?.user?.username) {
                        targetPath = `/user/${currentTokens.user.username}`;
                    } else {
                        targetPath = '/profile';
                    }
                    break;
                case 'leaderboard':
                    targetPath = '/leaderboard';
                    break;
                case 'map':
                    targetPath = '/map';
                    break;
                case 'events':
                    targetPath = '/events';
                    break;
                case 'stats':
                    targetPath = '/stats';
                    break;
                case 'profile-settings':
                    targetPath = '/settings';
                    break;
            }
            
            // Check if we're already on the target section
            if (currentUrl.includes(targetPath)) {
                logger.info(MODULE_NAME, `Already on section ${section}, no navigation needed`);
                return;
            }
            
            // Try using Vue Router navigation if available (for SPA navigation)
            const spaNavigationScript = `
                (function() {
                    // Check if Vue Router is available
                    if (window.$router) {
                        window.$router.push('${targetPath}');
                        return 'router-navigation';
                    }
                    // Check for Next.js router
                    else if (window.next && window.next.router) {
                        window.next.router.push('${targetPath}');
                        return 'nextjs-navigation';
                    }
                    // Check for React Router
                    else if (window.history && window.history.pushState) {
                        window.history.pushState(null, '', '${targetPath}');
                        window.dispatchEvent(new PopStateEvent('popstate'));
                        return 'history-navigation';
                    }
                    return 'no-spa-router';
                })();
            `;
            
            try {
                const result = await webContentView.webContents.executeJavaScript(spaNavigationScript);
                logger.info(MODULE_NAME, `SPA navigation result: ${result}`);
                
                if (result !== 'no-spa-router') {
                    logger.info(MODULE_NAME, `Fast SPA navigation to ${section} completed using ${result}`);
                    return; // Fast path complete
                }
            } catch (err) {
                logger.warn(MODULE_NAME, `SPA navigation attempt failed:`, err);
            }
        }
        
        // Fallback to full URL navigation (slower but reliable)
        logger.info(MODULE_NAME, `Using full URL navigation (slower path)`);
        
        const webAppBaseUrl = isDevelopment ? 'http://localhost:3001' : 'https://voidlog.gg';
        const currentTokens = getCurrentAuthTokens();
        let url = webAppBaseUrl;
        
        switch (section) {
            case 'profile':
                if (currentTokens?.user?.username) {
                    url += `/user/${currentTokens.user.username}`;
                } else {
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
            case 'events':
                url += '/events';
                break;
            case 'stats':
                url += '/stats';
                break;
            case 'profile-settings':
                url += '/settings';
                break;
        }
        
        url += '?source=electron&embedded=true';
        if (currentTokens?.accessToken) {
            url += '&auth=true';
        }

        logger.info(MODULE_NAME, `Loading URL: ${url}`);
        await webContentView.webContents.loadURL(url);
    } catch (error) {
        logger.error(MODULE_NAME, `Failed to navigate WebContentsView to section ${section}:`, error);
    }
}