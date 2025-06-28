
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
});
