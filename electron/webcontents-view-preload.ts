import { ipcRenderer, contextBridge } from 'electron';
import { Titlebar, TitlebarColor } from 'custom-electron-titlebar';

const MODULE_NAME = 'WebContentsViewPreload';
console.log(`${MODULE_NAME}: Preload script for WebContentsView loaded.`);

// --- Auth Bridge ---
// This bridge allows the web content to interact with the Electron main process for auth.
contextBridge.exposeInMainWorld('electronAuthBridge', {
  /**
   * Notifies the Electron main process that the webview content has new tokens.
   * @param tokens - The authentication tokens.
   */
  notifyElectronOfNewTokens: (tokens: { accessToken: string; refreshToken: string; user?: any }) => {
    console.log(`${MODULE_NAME}: Sending auth:store-tokens to main process.`);
    ipcRenderer.send('auth:store-tokens', tokens);
  },

  /**
   * Requests the stored authentication data from the main process.
   */
  getStoredAuthData: () => {
    console.log(`${MODULE_NAME}: Requesting auth:get-tokens from main process.`);
    return ipcRenderer.invoke('auth:get-tokens');
  },

  /**
   * Request token refresh from main process
   */
  refreshAuthTokens: () => {
    console.log(`${MODULE_NAME}: Requesting auth:refreshToken from main process.`);
    return ipcRenderer.invoke('auth:refreshToken');
  }
});

// --- Enhanced Auth Bridge for WebContentsView ---
contextBridge.exposeInMainWorld('webContentsViewAuth', {
  /**
   * Get current authentication status
   */
  getAuthStatus: () => {
    return ipcRenderer.invoke('auth:getStatus');
  },

  /**
   * Trigger token refresh
   */
  refreshTokens: () => {
    return ipcRenderer.invoke('auth:refreshToken');
  },

  /**
   * Clear authentication data
   */
  clearAuth: () => {
    localStorage.removeItem('auth.accessToken');
    localStorage.removeItem('auth.refreshToken');
    localStorage.removeItem('auth.user');
    console.log(`${MODULE_NAME}: Cleared authentication data from localStorage.`);
  }
});

// --- Token Handling ---
// Listen for token updates from the main process.
ipcRenderer.on('auth-tokens-updated', (_event, authData: { accessToken: string | null; refreshToken: string | null; user: any | null }) => {
  console.log(`${MODULE_NAME}: Received auth-tokens-updated event.`, { 
    hasAccessToken: !!authData?.accessToken, 
    hasRefreshToken: !!authData?.refreshToken,
    hasUser: !!authData?.user 
  });

  if (authData && (authData.accessToken || authData.refreshToken)) {
    // Store tokens in localStorage for the web app to use.
    if (authData.accessToken) {
      localStorage.setItem('auth.accessToken', authData.accessToken);
    }
    if (authData.refreshToken) {
      localStorage.setItem('auth.refreshToken', authData.refreshToken);
    }
    // Store user profile data as well.
    if (authData.user) {
      localStorage.setItem('auth.user', JSON.stringify(authData.user));
    }
    console.log(`${MODULE_NAME}: Tokens and user data stored in localStorage.`);
    
    // Dispatch a custom event to notify the web app that it has been authenticated.
    window.dispatchEvent(new CustomEvent('auth-tokens-received', { detail: authData }));
    window.dispatchEvent(new CustomEvent('electron-auth-ready', { 
      detail: { 
        source: 'ipc',
        hasAccessToken: !!authData.accessToken,
        hasRefreshToken: !!authData.refreshToken,
        hasUser: !!authData.user
      } 
    }));
  } else {
    // If tokens are null, it means the user logged out.
    localStorage.removeItem('auth.accessToken');
    localStorage.removeItem('auth.refreshToken');
    localStorage.removeItem('auth.user');
    console.log(`${MODULE_NAME}: Tokens and user data removed from localStorage.`);
    // Notify the app of logout
    window.dispatchEvent(new CustomEvent('auth-logout'));
  }
});

// --- Enhanced Request Interception for Authorization Headers ---
// Store original fetch for restoration if needed
const originalFetch = window.fetch;

// Enhanced fetch wrapper with automatic token refresh
window.fetch = async function(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const request = new Request(input, init);
  const url = request.url;
  
  // Only add auth headers for same-origin requests or API requests
  const isApiRequest = url.includes('/api/') || 
                      url.includes('localhost') || 
                      url.includes('voidlog.gg') || 
                      url.includes('killfeed.sinfulshadows.com') ||
                      url.includes('server-killfeed.sinfulshadows.com');
  
  if (isApiRequest) {
    let accessToken = localStorage.getItem('auth.accessToken');
    
    // Add Authorization header if we have a token and it's not already set
    if (accessToken && !request.headers.get('Authorization')) {
      request.headers.set('Authorization', `Bearer ${accessToken}`);
      console.log(`${MODULE_NAME}: Added Authorization header to request: ${url}`);
    }
    
    // Make the request
    const response = await originalFetch(request);
    
    // Handle 401 responses with automatic token refresh
    if (response.status === 401 && accessToken) {
      console.log(`${MODULE_NAME}: Received 401 response, attempting token refresh...`);
      
      try {
        // Attempt to refresh tokens via the auth bridge
        const refreshResult = await window.electronAuthBridge?.refreshAuthTokens?.();
        
        if (refreshResult && refreshResult.username) {
          // Get the new access token
          const newAccessToken = localStorage.getItem('auth.accessToken');
          
          if (newAccessToken && newAccessToken !== accessToken) {
            console.log(`${MODULE_NAME}: Token refreshed successfully, retrying request...`);
            
            // Clone the original request with the new token
            const retryRequest = request.clone();
            retryRequest.headers.set('Authorization', `Bearer ${newAccessToken}`);
            
            // Retry the request
            const retryResponse = await originalFetch(retryRequest);
            console.log(`${MODULE_NAME}: Retry request status: ${retryResponse.status}`);
            return retryResponse;
          }
        }
        
        console.warn(`${MODULE_NAME}: Token refresh failed or didn't provide new token`);
      } catch (error) {
        console.error(`${MODULE_NAME}: Error during token refresh:`, error);
      }
    }
    
    return response;
  }
  
  // For non-API requests, use original fetch
  return originalFetch(request);
};

// --- Error Recovery and Fallback Mechanisms ---
// Listen for network errors and connection issues
window.addEventListener('online', () => {
  console.log(`${MODULE_NAME}: Network connection restored, checking auth status...`);
  // Optionally refresh auth status when network is restored
  window.electronAuthBridge?.getStoredAuthData?.().then(authData => {
    if (authData) {
      console.log(`${MODULE_NAME}: Auth data available after network restoration`);
    }
  }).catch(error => {
    console.error(`${MODULE_NAME}: Error checking auth data after network restoration:`, error);
  });
});

window.addEventListener('offline', () => {
  console.log(`${MODULE_NAME}: Network connection lost`);
});

// --- Custom Title Bar Initialization (Optional) ---
// Only initialize if this WebContentsView needs a custom titlebar
let titlebarInitialized = false;

function initializeTitlebar() {
  if (titlebarInitialized) {
    return;
  }
  
  try {
    new Titlebar({
      backgroundColor: TitlebarColor.TRANSPARENT,
      titleHorizontalAlignment: 'center',
      enableMnemonics: false,
      unfocusEffect: false,
    });
    titlebarInitialized = true;
    console.log(`${MODULE_NAME}: Custom titlebar initialized`);
  } catch (error) {
    console.warn(`${MODULE_NAME}: Failed to initialize custom titlebar:`, error);
  }
}

// --- Initial Authentication Setup ---
document.addEventListener('DOMContentLoaded', () => {
  console.log(`${MODULE_NAME}: DOMContentLoaded event fired. Setting up authentication...`);
  
  // Initialize titlebar if needed (can be disabled for embedded views)
  const shouldInitTitlebar = new URLSearchParams(window.location.search).get('titlebar') !== 'false';
  if (shouldInitTitlebar) {
    initializeTitlebar();
  }
  
  // Signal readiness for auth tokens
  ipcRenderer.send('webview-ready-for-token');
  
  // Check for existing cookies and synchronize with localStorage
  const accessTokenCookie = document.cookie.split(';').find(cookie => cookie.trim().startsWith('access_token='));
  const refreshTokenCookie = document.cookie.split(';').find(cookie => cookie.trim().startsWith('refresh_token='));
  const userDataCookie = document.cookie.split(';').find(cookie => cookie.trim().startsWith('user_data='));
  
  let cookieAuthData: any = {};
  let hasCookieAuth = false;
  
  if (accessTokenCookie) {
    const accessToken = accessTokenCookie.split('=')[1];
    localStorage.setItem('auth.accessToken', accessToken);
    cookieAuthData.accessToken = accessToken;
    hasCookieAuth = true;
    console.log(`${MODULE_NAME}: Found access_token cookie, stored in localStorage`);
  }
  
  if (refreshTokenCookie) {
    const refreshToken = refreshTokenCookie.split('=')[1];
    localStorage.setItem('auth.refreshToken', refreshToken);
    cookieAuthData.refreshToken = refreshToken;
    hasCookieAuth = true;
    console.log(`${MODULE_NAME}: Found refresh_token cookie, stored in localStorage`);
  }
  
  if (userDataCookie) {
    try {
      const userData = decodeURIComponent(userDataCookie.split('=')[1]);
      localStorage.setItem('auth.user', userData);
      cookieAuthData.user = JSON.parse(userData);
      hasCookieAuth = true;
      console.log(`${MODULE_NAME}: Found user_data cookie, stored in localStorage`);
    } catch (error) {
      console.error(`${MODULE_NAME}: Failed to parse user_data cookie:`, error);
    }
  }
  
  // Dispatch event to notify the web app of available authentication
  if (hasCookieAuth) {
    window.dispatchEvent(new CustomEvent('auth-tokens-received', { detail: cookieAuthData }));
    window.dispatchEvent(new CustomEvent('electron-auth-ready', { 
      detail: { 
        source: 'cookies',
        hasAccessToken: !!cookieAuthData.accessToken,
        hasRefreshToken: !!cookieAuthData.refreshToken,
        hasUser: !!cookieAuthData.user
      } 
    }));
  }
  
  // Set up periodic token validation
  setupTokenValidation();
});

// --- Token Validation and Auto-Refresh ---
function setupTokenValidation() {
  // Check token validity every 5 minutes
  setInterval(async () => {
    const accessToken = localStorage.getItem('auth.accessToken');
    
    if (accessToken) {
      try {
        // Simple token validation - try to decode JWT payload
        const tokenParts = accessToken.split('.');
        if (tokenParts.length === 3) {
          const payload = JSON.parse(atob(tokenParts[1]));
          const currentTime = Math.floor(Date.now() / 1000);
          
          // Check if token expires within 2 minutes
          if (payload.exp && payload.exp - currentTime < 120) {
            console.log(`${MODULE_NAME}: Access token expires soon, attempting refresh...`);
            
            try {
              const refreshResult = await window.electronAuthBridge?.refreshAuthTokens?.();
              if (refreshResult && refreshResult.username) {
                console.log(`${MODULE_NAME}: Token auto-refresh successful`);
              } else {
                console.warn(`${MODULE_NAME}: Token auto-refresh failed`);
              }
            } catch (error) {
              console.error(`${MODULE_NAME}: Error during token auto-refresh:`, error);
            }
          }
        }
      } catch (error) {
        console.warn(`${MODULE_NAME}: Error validating token:`, error);
      }
    }
  }, 5 * 60 * 1000); // 5 minutes
}

// --- Enhanced Cookie Synchronization ---
// Watch for cookie changes and sync to localStorage
const cookieChangeObserver = new MutationObserver(() => {
  // This is a simple approach - in practice, you might want more sophisticated cookie monitoring
  const currentAccessToken = localStorage.getItem('auth.accessToken');
  const cookieAccessToken = document.cookie.split(';')
    .find(cookie => cookie.trim().startsWith('access_token='))?.split('=')[1];
  
  if (cookieAccessToken && cookieAccessToken !== currentAccessToken) {
    localStorage.setItem('auth.accessToken', cookieAccessToken);
    console.log(`${MODULE_NAME}: Updated localStorage from cookie change`);
    
    // Notify the app of the change
    window.dispatchEvent(new CustomEvent('auth-tokens-received', { 
      detail: { 
        accessToken: cookieAccessToken,
        refreshToken: localStorage.getItem('auth.refreshToken'),
        user: localStorage.getItem('auth.user') ? JSON.parse(localStorage.getItem('auth.user')!) : null
      } 
    }));
  }
});

// Start observing cookie changes (this is basic - consider more sophisticated approaches)
cookieChangeObserver.observe(document, { childList: true, subtree: true });

console.log(`${MODULE_NAME}: WebContentsView preload script initialization complete`);