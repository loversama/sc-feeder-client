
import { ipcRenderer, contextBridge } from 'electron';
import { Titlebar, TitlebarColor } from 'custom-electron-titlebar';

const MODULE_NAME = 'WebViewPreload';
console.log(`${MODULE_NAME}: Preload script for webview loaded.`);

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
});

// --- Token Handling ---
// Listen for token updates from the main process.
ipcRenderer.on('auth-tokens-updated', (_event, authData: { accessToken: string | null; refreshToken: string | null; user: any | null }) => {
  console.log(`${MODULE_NAME}: Received auth-tokens-updated event.`, { hasAccessToken: !!authData.accessToken, hasRefreshToken: !!authData.refreshToken });

  if (authData.accessToken && authData.refreshToken) {
    // Store tokens in localStorage for the web app to use.
    localStorage.setItem('auth.accessToken', authData.accessToken);
    localStorage.setItem('auth.refreshToken', authData.refreshToken);
    // Store user profile data as well.
    if (authData.user) {
      localStorage.setItem('auth.user', JSON.stringify(authData.user));
    }
    console.log(`${MODULE_NAME}: Tokens and user data stored in localStorage.`);
    
    // Dispatch a custom event to notify the web app that it has been authenticated.
    window.dispatchEvent(new CustomEvent('auth-tokens-received', { detail: authData }));
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

// --- Request Interception for Authorization Headers ---
// Intercept fetch requests to add Authorization headers
const originalFetch = window.fetch;
window.fetch = function(input: RequestInfo | URL, init?: RequestInit) {
  const request = new Request(input, init);
  
  // Only add auth headers for same-origin requests or API requests
  const url = request.url;
  const isApiRequest = url.includes('/api/') || url.includes('localhost') || url.includes('voidlog.gg') || url.includes('killfeed.sinfulshadows.com');
  
  if (isApiRequest) {
    const accessToken = localStorage.getItem('auth.accessToken');
    if (accessToken && !request.headers.get('Authorization')) {
      request.headers.set('Authorization', `Bearer ${accessToken}`);
      console.log(`${MODULE_NAME}: Added Authorization header to request: ${url}`);
    }
  }
  
  return originalFetch(request);
};

// --- Custom Title Bar Initialization ---
window.addEventListener('DOMContentLoaded', () => {
  new Titlebar({
    backgroundColor: TitlebarColor.TRANSPARENT,
    titleHorizontalAlignment: 'center', // This won't matter since we'll hide the title
    enableMnemonics: false, // Disable keyboard shortcuts for menu
    unfocusEffect: false, // Keep consistent appearance when unfocused
  });
});

// --- Initial Token Request ---
// When the webview's content is loaded, signal to the main process that it's ready for tokens.
document.addEventListener('DOMContentLoaded', () => {
  console.log(`${MODULE_NAME}: DOMContentLoaded event fired. Sending 'webview-ready-for-token' to main process.`);
  ipcRenderer.send('webview-ready-for-token');
  
  // Also check if we have cookies and set up localStorage from them
  const accessTokenCookie = document.cookie.split(';').find(cookie => cookie.trim().startsWith('access_token='));
  const refreshTokenCookie = document.cookie.split(';').find(cookie => cookie.trim().startsWith('refresh_token='));
  const userDataCookie = document.cookie.split(';').find(cookie => cookie.trim().startsWith('user_data='));
  
  if (accessTokenCookie) {
    const accessToken = accessTokenCookie.split('=')[1];
    localStorage.setItem('auth.accessToken', accessToken);
    console.log(`${MODULE_NAME}: Found access_token cookie, stored in localStorage`);
  }
  
  if (refreshTokenCookie) {
    const refreshToken = refreshTokenCookie.split('=')[1];
    localStorage.setItem('auth.refreshToken', refreshToken);
    console.log(`${MODULE_NAME}: Found refresh_token cookie, stored in localStorage`);
  }
  
  if (userDataCookie) {
    try {
      const userData = decodeURIComponent(userDataCookie.split('=')[1]);
      localStorage.setItem('auth.user', userData);
      console.log(`${MODULE_NAME}: Found user_data cookie, stored in localStorage`);
    } catch (error) {
      console.error(`${MODULE_NAME}: Failed to parse user_data cookie:`, error);
    }
  }
  
  // Dispatch event to notify the web app of available authentication
  if (accessTokenCookie || refreshTokenCookie) {
    window.dispatchEvent(new CustomEvent('electron-auth-ready', { 
      detail: { 
        source: 'cookies',
        hasAccessToken: !!accessTokenCookie,
        hasRefreshToken: !!refreshTokenCookie 
      } 
    }));
  }
});
