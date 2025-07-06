import { ipcRenderer, contextBridge } from 'electron';

const MODULE_NAME = 'WebContentsViewPreload';
console.log(`${MODULE_NAME}: Enhanced WebContentsView preload script loaded`);

// Enhanced API - simplified from complex webview guest/host chain
contextBridge.exposeInMainWorld('electronAPI', {
    // Direct authentication API (no complex IPC chain)
    getAuthData: () => {
        console.log(`${MODULE_NAME}: Getting auth data from main process`);
        return ipcRenderer.invoke('enhanced-auth:get-data');
    },

    // Send new tokens to main process (simplified)
    updateTokens: (tokens) => {
        console.log(`${MODULE_NAME}: Updating tokens in main process`);
        return ipcRenderer.invoke('enhanced-auth:update-tokens', tokens);
    },

    // Request token refresh
    refreshTokens: () => {
        console.log(`${MODULE_NAME}: Requesting token refresh`);
        return ipcRenderer.invoke('enhanced-auth:refresh');
    },

    // Navigation within the same window
    navigateToSection: (section) => {
        console.log(`${MODULE_NAME}: Requesting navigation to: ${section}`);
        ipcRenderer.send('enhanced-navigation:change-section', section);
    },

    // Listen for auth updates from main process
    onAuthUpdate: (callback) => {
        const listener = (_, authData) => {
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
window.fetch = async function(input, init) {
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
            const authData = await window.electronAPI.getAuthData();
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
XMLHttpRequest.prototype.open = function(method, url, ...args) {
    this.addEventListener('loadstart', async () => {
        const urlStr = url.toString();
        const isApiRequest = urlStr.includes('/api/') || 
                            urlStr.includes('localhost') || 
                            urlStr.includes('voidlog.gg') || 
                            urlStr.includes('killfeed.sinfulshadows.com');

        if (isApiRequest) {
            try {
                const authData = await window.electronAPI.getAuthData();
                if (authData.accessToken) {
                    this.setRequestHeader('Authorization', `Bearer ${authData.accessToken}`);
                    console.log(`${MODULE_NAME}: Added Authorization header to XHR: ${urlStr}`);
                }
            } catch (error) {
                console.warn(`${MODULE_NAME}: Failed to get auth data for XHR:`, error);
            }
        }
    });

    return originalXHROpen.call(this, method, url, ...args);
};

// Automatic authentication setup on DOM ready
document.addEventListener('DOMContentLoaded', async () => {
    console.log(`${MODULE_NAME}: DOM ready, setting up authentication`);
    
    try {
        const authData = await window.electronAPI.getAuthData();
        
        if (authData.isAuthenticated) {
            // Store in localStorage for web app compatibility (like external windows)
            if (authData.accessToken) {
                localStorage.setItem('auth.accessToken', authData.accessToken);
                localStorage.setItem('accessToken', authData.accessToken); // Legacy support
            }
            if (authData.refreshToken) {
                localStorage.setItem('auth.refreshToken', authData.refreshToken);
                localStorage.setItem('refreshToken', authData.refreshToken); // Legacy support
            }
            if (authData.user) {
                localStorage.setItem('auth.user', JSON.stringify(authData.user));
                localStorage.setItem('user', JSON.stringify(authData.user)); // Legacy support
            }
            
            console.log(`${MODULE_NAME}: Authentication data stored in localStorage`);
            
            // Notify web app that authentication is ready
            window.dispatchEvent(new CustomEvent('electron-auth-ready', {
                detail: authData
            }));
        } else {
            console.log(`${MODULE_NAME}: User not authenticated`);
        }
    } catch (error) {
        console.error(`${MODULE_NAME}: Failed to setup authentication:`, error);
    }
});

// Listen for auth updates from main process
window.electronAPI.onAuthUpdate((authData) => {
    console.log(`${MODULE_NAME}: Received auth update:`, authData);
    
    if (authData.isAuthenticated) {
        // Store updated tokens
        if (authData.accessToken) {
            localStorage.setItem('auth.accessToken', authData.accessToken);
            localStorage.setItem('accessToken', authData.accessToken);
        }
        if (authData.refreshToken) {
            localStorage.setItem('auth.refreshToken', authData.refreshToken);
            localStorage.setItem('refreshToken', authData.refreshToken);
        }
        if (authData.user) {
            localStorage.setItem('auth.user', JSON.stringify(authData.user));
            localStorage.setItem('user', JSON.stringify(authData.user));
        }
        
        console.log(`${MODULE_NAME}: Updated authentication data in localStorage`);
    } else {
        // Clear tokens on logout
        localStorage.removeItem('auth.accessToken');
        localStorage.removeItem('auth.refreshToken');
        localStorage.removeItem('auth.user');
        localStorage.removeItem('accessToken');
        localStorage.removeItem('refreshToken');
        localStorage.removeItem('user');
        
        console.log(`${MODULE_NAME}: Cleared authentication data from localStorage`);
    }
    
    // Notify web app of auth change
    window.dispatchEvent(new CustomEvent('electron-auth-updated', {
        detail: authData
    }));
});

// Enhanced error handling for network requests
window.addEventListener('unhandledrejection', (event) => {
    if (event.reason && typeof event.reason === 'object') {
        const error = event.reason;
        
        // Check for authentication errors
        if (error.status === 401 || error.statusCode === 401) {
            console.warn(`${MODULE_NAME}: Detected 401 error, requesting token refresh`);
            window.electronAPI.refreshTokens().then((success) => {
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
    }, {});

    // Sync cookies to localStorage
    if (cookies.access_token && !localStorage.getItem('auth.accessToken')) {
        localStorage.setItem('auth.accessToken', cookies.access_token);
        localStorage.setItem('accessToken', cookies.access_token);
        console.log(`${MODULE_NAME}: Synced access_token from cookies to localStorage`);
    }

    if (cookies.refresh_token && !localStorage.getItem('auth.refreshToken')) {
        localStorage.setItem('auth.refreshToken', cookies.refresh_token);
        localStorage.setItem('refreshToken', cookies.refresh_token);
        console.log(`${MODULE_NAME}: Synced refresh_token from cookies to localStorage`);
    }

    if (cookies.user_data && !localStorage.getItem('auth.user')) {
        try {
            const userData = JSON.parse(cookies.user_data);
            localStorage.setItem('auth.user', JSON.stringify(userData));
            localStorage.setItem('user', JSON.stringify(userData));
            console.log(`${MODULE_NAME}: Synced user_data from cookies to localStorage`);
        } catch (error) {
            console.warn(`${MODULE_NAME}: Failed to parse user_data cookie:`, error);
        }
    }

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

console.log(`${MODULE_NAME}: Enhanced preload script setup completed`);