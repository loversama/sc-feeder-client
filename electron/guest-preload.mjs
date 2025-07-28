// log-monitor-client/electron/guest-preload.mjs
const { contextBridge, ipcRenderer } = require('electron');

console.log('[GuestPreload] Preload script STARTED for <webview> guest content.');

const GUEST_AUTH_BRIDGE_KEY = 'guestAuthBridge';

// API exposed to the Nuxt app (running inside the webview)
const guestApi = {
  // Called by Nuxt app to send its tokens to the Electron host page (WebContentPage.vue)
  notifyHostOfNewTokens: (tokens) => {
    console.log('[GuestPreload] Nuxt app notifying host of new tokens:', tokens);
    ipcRenderer.sendToHost('guest-new-tokens', tokens); // Will be caught by WebContentPage.vue
  },

  // Called by Nuxt app to request initial auth data from the host page
  requestInitialAuthDataFromHost: () => {
    console.log('[GuestPreload] Nuxt app requesting initial auth data from host.');
    ipcRenderer.sendToHost('guest-requests-auth-data'); // Will be caught by WebContentPage.vue
  },

  // Function for the host page (WebContentPage.vue) to call via webview.send()
  // to push auth data into this guest context.
  // This will be wrapped by an ipcRenderer.on() listener below.
  _receiveAuthDataFromHost: (tokens) => {
    console.log('[GuestPreload] Received auth data from host:', tokens);
    if (tokens && typeof tokens === 'object') {
      if (tokens.accessToken) localStorage.setItem('accessToken', tokens.accessToken);
      else localStorage.removeItem('accessToken');

      if (tokens.refreshToken) localStorage.setItem('refreshToken', tokens.refreshToken);
      else localStorage.removeItem('refreshToken');

      if (tokens.user) localStorage.setItem('user', JSON.stringify(tokens.user));
      else localStorage.removeItem('user');

      console.log('[GuestPreload] Auth data stored in guest localStorage.');
      // Notify the Nuxt app that new data is in localStorage
      window.dispatchEvent(new CustomEvent('guest-auth-data-updated', { detail: tokens }));
    }
  },

  // For Nuxt app to directly get what this preload script has stored.
  getStoredAuthData: () => {
    return {
      accessToken: localStorage.getItem('accessToken'),
      refreshToken: localStorage.getItem('refreshToken'),
      user: JSON.parse(localStorage.getItem('user') || 'null'),
    };
  },
};

// Listen for messages from the host page (WebContentPage.vue)
ipcRenderer.on('to-guest-auth-data', (_event, tokens) => {
  console.log('[GuestPreload] IPC "to-guest-auth-data" received from host.', tokens);
  guestApi._receiveAuthDataFromHost(tokens);
});

ipcRenderer.on('to-guest-clear-auth-data', (_event) => {
  console.log('[GuestPreload] IPC "to-guest-clear-auth-data" received from host.');
  localStorage.removeItem('accessToken');
  localStorage.removeItem('refreshToken');
  localStorage.removeItem('user');
  console.log('[GuestPreload] Auth data cleared from guest localStorage.');
  window.dispatchEvent(new CustomEvent('guest-auth-data-updated', { detail: null }));
});


try {
  contextBridge.exposeInMainWorld(GUEST_AUTH_BRIDGE_KEY, {
    notifyHostOfNewTokens: guestApi.notifyHostOfNewTokens,
    requestInitialAuthDataFromHost: guestApi.requestInitialAuthDataFromHost,
    getStoredAuthData: guestApi.getStoredAuthData,
    // Nuxt app can listen for this event:
    // window.addEventListener('guest-auth-data-updated', (event) => { /* handle event.detail */ });
  });
  console.log(`[GuestPreload] "${GUEST_AUTH_BRIDGE_KEY}" exposed to Nuxt app.`);
} catch (error) {
  console.error('[GuestPreload] Error exposing guestApi via contextBridge:', error);
}

// Signal to host that this preload script has loaded
ipcRenderer.sendToHost('guest-preload-loaded');
console.log('[GuestPreload] Script execution finished. Signalled "guest-preload-loaded" to host.');