import { ipcRenderer, contextBridge } from 'electron';

const MODULE_NAME = 'WebContentsViewPreload';
console.log(`${MODULE_NAME}: Enhanced WebContentsView preload script loaded`);

// Enhanced API - simplified from complex webview guest/host chain
contextBridge.exposeInMainWorld('electronAPI', {
    // Direct authentication API (no complex IPC chain)
    getAuthData: (): Promise<{
        accessToken: string | null;
        refreshToken: string | null;
        user: any | null;
        isAuthenticated: boolean;
    }> => {
        console.log(`${MODULE_NAME}: Getting auth data from main process`);
        return ipcRenderer.invoke('enhanced-auth:get-data');
    },

    // Send new tokens to main process (simplified)
    updateTokens: (tokens: {
        accessToken: string;
        refreshToken: string;
        user?: any;
    }): Promise<boolean> => {
        console.log(`${MODULE_NAME}: Updating tokens in main process`);
        return ipcRenderer.invoke('enhanced-auth:update-tokens', tokens);
    },

    // Request token refresh
    refreshTokens: (): Promise<boolean> => {
        console.log(`${MODULE_NAME}: Requesting token refresh`);
        return ipcRenderer.invoke('enhanced-auth:refresh');
    },

    // Navigation within the same window - INTERNAL ONLY, should not close window
    navigateToSection: (section: string): void => {
        console.log(`${MODULE_NAME}: Internal navigation to: ${section} (will NOT trigger window operations)`);
        
        // Navigate within the WebContentsView only - do not trigger external navigation
        if (typeof window !== 'undefined') {
            const sectionPaths = {
                'profile': '/profile',
                'leaderboard': '/leaderboard', 
                'map': '/map',
                'events': '/events',
                'stats': '/stats'
            };
            
            const path = sectionPaths[section as keyof typeof sectionPaths] || '/';
            console.log(`${MODULE_NAME}: Navigating WebContentsView internally to: ${path}`);
            
            // Use window.location to navigate within the WebContentsView frame only
            const currentUrl = new URL(window.location.href);
            const newUrl = `${currentUrl.origin}${path}${currentUrl.search}`;
            
            // Navigate to the new URL within this WebContentsView frame
            window.location.href = newUrl;
        }
    },

    // DISABLED: External navigation should not be available in WebContentsView
    // This prevents the WebContentsView from accidentally navigating the main window
    navigation: {
        request: (section: string) => {
            console.error(`${MODULE_NAME}: ❌ BLOCKED external navigation request for section: ${section} - WebContentsView should use navigateToSection() instead!`);
            console.error(`${MODULE_NAME}: Use window.electronAPI.navigateToSection('${section}') for internal navigation`);
            return Promise.resolve({ success: false, error: 'External navigation blocked in WebContentsView' });
        },
        close: (section?: string) => {
            console.error(`${MODULE_NAME}: ❌ BLOCKED external navigation close request - WebContentsView should not close windows!`);
            return Promise.resolve({ success: false, error: 'External navigation blocked in WebContentsView' });
        },
        getState: () => {
            console.log(`${MODULE_NAME}: Getting navigation state`);
            return ipcRenderer.invoke('navigation:get-state');
        },
        onStateChange: (callback: (state: any) => void) => {
            console.log(`${MODULE_NAME}: Setting up navigation state change listener`);
            const listener = (_: any, state: any) => callback(state);
            ipcRenderer.on('navigation-state-changed', listener);
            return () => {
                ipcRenderer.removeListener('navigation-state-changed', listener);
            };
        }
    },

    // Listen for auth updates from main process
    onAuthUpdate: (callback: (authData: any) => void): (() => void) => {
        const listener = (_: any, authData: any) => {
            console.log(`${MODULE_NAME}: Received auth update:`, authData);
            callback(authData);
        };
        ipcRenderer.on('auth-data-updated', listener);
        return () => {
            ipcRenderer.removeListener('auth-data-updated', listener);
        };
    }
});

// Enhanced fetch with automatic token injection (like external windows)
const originalFetch = window.fetch;
window.fetch = async function(input: RequestInfo | URL, init?: RequestInit) {
    const request = new Request(input, init);
    const url = request.url;
    
    // Check if this is an API request that needs authentication
    const isApiRequest = url.includes('/api/') || 
                        url.includes('localhost') || 
                        url.includes('voidlog.gg') || 
                        url.includes('killfeed.sinfulshadows.com');

    if (isApiRequest) {
        try {
            // Get current auth data
            const authData = await (window as any).electronAPI.getAuthData();
            if (authData.accessToken && !request.headers.get('Authorization')) {
                request.headers.set('Authorization', `Bearer ${authData.accessToken}`);
                console.log(`${MODULE_NAME}: Added Authorization header to: ${url}`);
            }
        } catch (error) {
            console.warn(`${MODULE_NAME}: Failed to get auth data for request:`, error);
        }
    }

    return originalFetch(request);
};

// Enhanced XMLHttpRequest interception
const originalXHROpen = XMLHttpRequest.prototype.open;
XMLHttpRequest.prototype.open = function(method: string, url: string | URL, ...args: any[]) {
    this.addEventListener('loadstart', async () => {
        const urlStr = url.toString();
        const isApiRequest = urlStr.includes('/api/') || 
                            urlStr.includes('localhost') || 
                            urlStr.includes('voidlog.gg') || 
                            urlStr.includes('killfeed.sinfulshadows.com');

        if (isApiRequest) {
            try {
                const authData = await (window as any).electronAPI.getAuthData();
                if (authData.accessToken) {
                    this.setRequestHeader('Authorization', `Bearer ${authData.accessToken}`);
                    console.log(`${MODULE_NAME}: Added Authorization header to XHR: ${urlStr}`);
                }
            } catch (error) {
                console.warn(`${MODULE_NAME}: Failed to get auth data for XHR:`, error);
            }
        }
    });

    return (originalXHROpen as any).call(this, method, url, ...args);
};

// Automatic authentication setup on DOM ready
document.addEventListener('DOMContentLoaded', async () => {
    console.log(`${MODULE_NAME}: DOM ready, setting up authentication`);
    
    try {
        const authData = await (window as any).electronAPI.getAuthData();
        
        if (authData.isAuthenticated) {
            // Store user data (non-sensitive) in localStorage for web app compatibility
            if (authData.user) {
                localStorage.setItem('auth.user', JSON.stringify(authData.user));
                localStorage.setItem('user', JSON.stringify(authData.user)); // Legacy support
            }
            
            console.log(`${MODULE_NAME}: Authentication state ready (tokens handled via secure request interception)`);
            
            // Notify web app that authentication is ready
            window.dispatchEvent(new CustomEvent('electron-auth-ready', {
                detail: {
                    isAuthenticated: authData.isAuthenticated,
                    user: authData.user
                    // NOTE: Tokens are NOT included - they're handled via secure request interception
                }
            }));
        } else {
            console.log(`${MODULE_NAME}: User not authenticated`);
        }
    } catch (error) {
        console.error(`${MODULE_NAME}: Failed to setup authentication:`, error);
    }
});

// Listen for auth updates from main process
(window as any).electronAPI.onAuthUpdate((authData: any) => {
    console.log(`${MODULE_NAME}: Received auth update:`, authData);
    
    if (authData.isAuthenticated) {
        // Store user data (non-sensitive) for web app compatibility
        if (authData.user) {
            localStorage.setItem('auth.user', JSON.stringify(authData.user));
            localStorage.setItem('user', JSON.stringify(authData.user)); // Legacy support
        }
        
        console.log(`${MODULE_NAME}: Updated authentication state (tokens handled via secure request interception)`);
    } else {
        // Clear user data on logout
        localStorage.removeItem('auth.user');
        localStorage.removeItem('user');
        
        // Clear any legacy token storage if it exists
        localStorage.removeItem('auth.accessToken');
        localStorage.removeItem('auth.refreshToken');
        localStorage.removeItem('accessToken');
        localStorage.removeItem('refreshToken');
        
        console.log(`${MODULE_NAME}: Cleared authentication data from localStorage`);
    }
    
    // Notify web app of auth change
    window.dispatchEvent(new CustomEvent('electron-auth-updated', {
        detail: {
            isAuthenticated: authData.isAuthenticated,
            user: authData.user
            // NOTE: Tokens are NOT included - they're handled via secure request interception
        }
    }));
});

// Enhanced error handling for network requests
window.addEventListener('unhandledrejection', (event) => {
    if (event.reason && typeof event.reason === 'object') {
        const error = event.reason as any;
        
        // Check for authentication errors
        if (error.status === 401 || error.statusCode === 401) {
            console.warn(`${MODULE_NAME}: Detected 401 error, requesting token refresh`);
            (window as any).electronAPI.refreshTokens().then((success: any) => {
                if (success) {
                    console.log(`${MODULE_NAME}: Token refresh successful`);
                    // Could reload the page or retry the request
                } else {
                    console.warn(`${MODULE_NAME}: Token refresh failed`);
                }
            });
        }
    }
});

// Enhanced cookie handling (bridge between cookies and localStorage)
document.addEventListener('DOMContentLoaded', () => {
    // Check for cookies and sync to localStorage if needed
    const cookies = document.cookie.split(';').reduce((acc, cookie) => {
        const [name, value] = cookie.trim().split('=');
        if (name && value) {
            acc[name] = decodeURIComponent(value);
        }
        return acc;
    }, {} as Record<string, string>);

    // Sync user data (non-sensitive) from cookies to localStorage for web app compatibility
    if (cookies.user_data && !localStorage.getItem('auth.user')) {
        try {
            const userData = JSON.parse(cookies.user_data);
            localStorage.setItem('auth.user', JSON.stringify(userData));
            localStorage.setItem('user', JSON.stringify(userData)); // Legacy support
            console.log(`${MODULE_NAME}: Synced user_data from cookies to localStorage`);
        } catch (error) {
            console.warn(`${MODULE_NAME}: Failed to parse user_data cookie:`, error);
        }
    }
    
    // NOTE: Tokens are NOT synced from cookies to localStorage for security
    // They are handled via secure request interception instead

    // If we found any auth data, notify the web app
    if (cookies.access_token || cookies.refresh_token) {
        window.dispatchEvent(new CustomEvent('electron-auth-ready', {
            detail: {
                source: 'cookies',
                hasAccessToken: !!cookies.access_token,
                hasRefreshToken: !!cookies.refresh_token,
                isAuthenticated: !!cookies.access_token
            }
        }));
    }
});

// Intercept navigation clicks to use internal navigation instead of external
document.addEventListener('DOMContentLoaded', () => {
    console.log(`${MODULE_NAME}: Setting up navigation click interception`);
    
    // Intercept clicks on navigation links
    document.addEventListener('click', (event) => {
        const target = event.target as HTMLElement;
        
        // Check if clicked element or its parent is a navigation link
        const link = target.closest('a[href]') as HTMLAnchorElement;
        if (!link) return;
        
        const href = link.getAttribute('href');
        if (!href) return;
        
        // Check if it's an internal navigation link (starts with / and matches our sections)
        const internalSections = ['/profile', '/leaderboard', '/map', '/events', '/stats'];
        const isInternalNavigation = internalSections.some(section => href.startsWith(section));
        
        if (isInternalNavigation) {
            console.log(`${MODULE_NAME}: Intercepting internal navigation click to: ${href}`);
            event.preventDefault();
            event.stopPropagation();
            
            // Extract section from href
            const section = href.split('/')[1]; // e.g., '/map' -> 'map'
            if (section && (window as any).electronAPI?.navigateToSection) {
                (window as any).electronAPI.navigateToSection(section);
            }
        }
    }, true); // Use capture phase to intercept before other handlers
});

console.log(`${MODULE_NAME}: Enhanced preload script setup completed`);