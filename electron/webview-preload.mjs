console.log('[WebviewPreload] Preload script STARTED.');
const { contextBridge, ipcRenderer } = require('electron');

const AUTH_ACCESS_TOKEN_KEY = 'accessToken';
const AUTH_REFRESH_TOKEN_KEY = 'refreshToken';
const AUTH_USER_KEY = 'user';

console.log('[WebviewPreload] Script loaded.');

// Listen for token updates from the Electron main process (via WebContentPage)
// This is now the primary way tokens are pushed to the webview
ipcRenderer.on('auth-tokens-updated', (_event, payload) => {
  console.log('[WebviewPreload] Received "auth-tokens-updated" event:', payload);
  if (payload && typeof payload === 'object') {
    if (payload.accessToken) {
      localStorage.setItem(AUTH_ACCESS_TOKEN_KEY, payload.accessToken);
      console.log('[WebviewPreload] Access token stored in localStorage.');
    } else {
      localStorage.removeItem(AUTH_ACCESS_TOKEN_KEY);
      console.log('[WebviewPreload] Access token removed from localStorage (was null/undefined).');
    }

    if (payload.refreshToken) {
      localStorage.setItem(AUTH_REFRESH_TOKEN_KEY, payload.refreshToken);
      console.log('[WebviewPreload] Refresh token stored in localStorage.');
    } else {
      localStorage.removeItem(AUTH_REFRESH_TOKEN_KEY);
      console.log('[WebviewPreload] Refresh token removed from localStorage (was null/undefined).');
    }

    if (payload.user) {
      localStorage.setItem(AUTH_USER_KEY, JSON.stringify(payload.user));
      console.log('[WebviewPreload] User profile stored in localStorage.');
    } else {
      localStorage.removeItem(AUTH_USER_KEY);
      console.log('[WebviewPreload] User profile removed from localStorage (was null/undefined).');
    }

    // Optionally, dispatch a custom event on the window if the Nuxt app needs to react immediately
    // to localStorage changes without polling or relying solely on initial load.
    window.dispatchEvent(new CustomEvent('electron-auth-tokens-updated-in-storage', { detail: payload }));

  } else {
    console.warn('[WebviewPreload] Received "auth-tokens-updated" but payload was invalid:', payload);
  }
});

// Listen for initial token push when webview is first loaded and ready
// This is sent by WebContentPage.vue after it fetches tokens
ipcRenderer.on('initialize-with-tokens', (_event, payload) => {
  console.log('[WebviewPreload] Received "initialize-with-tokens" event:', payload);
  if (payload && typeof payload === 'object') {
    // Always explicitly set or remove based on payload presence
    if (payload.accessToken) {
      localStorage.setItem(AUTH_ACCESS_TOKEN_KEY, payload.accessToken);
    } else {
      localStorage.removeItem(AUTH_ACCESS_TOKEN_KEY);
    }
    if (payload.refreshToken) {
      localStorage.setItem(AUTH_REFRESH_TOKEN_KEY, payload.refreshToken);
    } else {
      localStorage.removeItem(AUTH_REFRESH_TOKEN_KEY);
    }
    // User is optional, but if provided, store it. If not, remove it.
    if (payload.user) {
      localStorage.setItem(AUTH_USER_KEY, JSON.stringify(payload.user));
    } else {
      localStorage.removeItem(AUTH_USER_KEY);
    }
    console.log('[WebviewPreload] Initial tokens and user profile stored in localStorage.');
    window.dispatchEvent(new CustomEvent('electron-auth-initialized-in-storage', { detail: payload }));
  } else {
    console.warn('[WebviewPreload] Received "initialize-with-tokens" but payload was invalid:', payload);
  }
});


contextBridge.exposeInMainWorld('electronAuthBridge', {
  // Called by the Nuxt app (log-monitor-web) when it gets new tokens
  // (e.g., after its own login or refresh call to the API server)
  notifyElectronOfNewTokens: (tokens) => ipcRenderer.send('auth-store-tokens', tokens), // Assumes 'auth-store-tokens' handles this

  // Called by the Nuxt app if it wants to explicitly request the latest tokens
  // (e.g., on initial load if 'initialize-with-tokens' hasn't fired or was missed)
  // This tells the Electron host (WebContentPage.vue) to send the tokens.
  requestInitialAuthData: () => {
    console.log('[WebviewPreload] Webview is requesting initial auth data via sendToHost.');
    ipcRenderer.sendToHost('webview-requests-auth-data');
  },

  // Provide a way for the Nuxt app to get tokens directly from localStorage,
  // which this preload script manages based on IPC messages.
  // This is an alternative/supplement to the Nuxt app managing its own localStorage reads.
  getStoredAuthData: () => ipcRenderer.invoke('auth-get-tokens'), // Assumes 'auth-get-tokens' returns { accessToken, refreshToken, user }

  clearStoredAuthTokens: () => {
    localStorage.removeItem(AUTH_ACCESS_TOKEN_KEY);
    localStorage.removeItem(AUTH_REFRESH_TOKEN_KEY);
    // Optionally, keep user profile in localStorage or clear it too
    // localStorage.removeItem(AUTH_USER_KEY);
    console.log('[WebviewPreload] Cleared auth tokens from localStorage.');
    // Optionally, notify the host if needed, though likely not for clearing
  }
});

console.log('[WebviewPreload] electronAuthBridge exposed via contextBridge. Checking window.electronAuthBridge directly:', typeof window.electronAuthBridge, window.electronAuthBridge);

// Signal to the Electron host (WebContentPage.vue) that the webview's preload script has finished loading.
// This is more reliable than waiting for 'dom-ready' on the webview tag itself for sending initial data.
ipcRenderer.sendToHost('webview-preload-loaded');
console.log('[WebviewPreload] Script execution finished. "electronAuthBridge" exposed.');