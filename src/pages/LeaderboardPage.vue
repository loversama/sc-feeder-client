<template>
  <!-- Always render the container and webview, rely on :src binding -->
  <div class="webview-container h-full">
     <!-- Add webpreferences attribute -->
    <webview
      ref="webviewRef"
      :src="webviewSrc || ''"
      style="width:100%; height:100%; border:none;"
      webpreferences="contextIsolation=true,devTools=true"
   ></webview>
   <div v-if="isLoading" class="absolute inset-0 flex items-center justify-center bg-theme-bg-dark bg-opacity-80">Loading...</div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed, watch } from 'vue';
// Removed direct import: import { getGuestToken } from '../../electron/modules/auth-manager';

const webviewRef = ref<Electron.WebviewTag | null>(null);
const accessToken = ref<string | null>(null);
const isLoading = ref(true);
// Use Vite's import.meta.env.DEV to check for development mode
const isDevelopment = import.meta.env.DEV;
const webAppBaseUrl = isDevelopment
  ? 'http://localhost:3001'
  : 'https://killfeed.sinfulshadows.com'; // Define base URL

onMounted(async () => {
  console.log('[LeaderboardPage] Mounted');
  isLoading.value = true;
  let fetchedToken: string | null = null;

  try {
    // Attempt to fetch access token
    if (window.logMonitorApi && typeof window.logMonitorApi.authGetAccessToken === 'function') {
      fetchedToken = await window.logMonitorApi.authGetAccessToken();
      console.log('Attempted to fetch access token:', fetchedToken ? 'Token received' : 'No token');
    } else {
      console.error('logMonitorApi.authGetAccessToken is not available.');
    }
  } catch (error) {
    console.error('Error fetching access token, falling back to guest mode:', error);
    fetchedToken = null; // Ensure token is null on error
  }

  // Assign the potentially fetched token
  accessToken.value = fetchedToken;

  // Loading is complete after attempting token fetch
  isLoading.value = false;

  // Token injection logic moved to a watcher
});

// Watch for the webview element and the access token to be ready
watch([webviewRef, accessToken], ([webview, token]) => {
  if (webview && !isLoading.value) { // Ensure loading is finished before trying to inject
    console.log(`[LeaderboardPage] Watch triggered. Webview element available: ${!!webview}, isLoading: ${isLoading.value}`);

    // --- Add Detailed Event Listeners ---
    webview.addEventListener('did-start-loading', () => {
      console.log('[LeaderboardPage] Webview event: did-start-loading');
    });
    webview.addEventListener('did-stop-loading', () => {
      console.log('[LeaderboardPage] Webview event: did-stop-loading');
    });
    webview.addEventListener('dom-ready', () => {
      console.log('[LeaderboardPage] Webview event: dom-ready');
    });
    webview.addEventListener('did-fail-load', (event) => {
      console.error(`[LeaderboardPage] Webview event: did-fail-load - ErrorCode: ${event.errorCode}, ErrorDescription: ${event.errorDescription}, URL: ${event.validatedURL}`);
    });
    webview.addEventListener('console-message', (event) => {
      console.log(`[LeaderboardPage] Webview Console [${event.level}]: ${event.message} (Source: ${event.sourceId}:${event.line})`);
    });
    // --- End Detailed Event Listeners ---


    console.log('[LeaderboardPage] Webview ready and token status known. Injecting token if available.');
    const script = token
      ? `localStorage.setItem('electronInjectedToken', '${token}'); console.log('Electron injected token into webview localStorage.'); window.dispatchEvent(new Event('tokenInjected'));`
      : `localStorage.removeItem('electronInjectedToken'); console.log('Electron cleared token from webview localStorage.'); window.dispatchEvent(new Event('tokenCleared'));`;

    // Execute script when the webview finishes loading its *initial* content
    const injectTokenOnLoad = () => {
      console.log('[LeaderboardPage] Webview did-finish-load triggered. Executing script and injecting CSS.');

      // Inject CSS to force full height
      const css = `
        html, body {
          height: 100% !important;
          margin: 0 !important;
          padding: 0 !important;
          overflow: auto !important; /* Or hidden, depending on desired behavior */
        }
        #app { /* Assuming the main app div has id="app" */
          height: 100% !important;
        }
      `;
      webview.insertCSS(css)
        .then(() => console.log('[LeaderboardPage] Full height CSS injected successfully.'))
        .catch((error: any) => console.error('[LeaderboardPage] Failed to inject CSS:', error)); // Fixed typo here

      // Execute token script
      webview.executeJavaScript(script)
        .then(() => console.log('[LeaderboardPage] Token script executed successfully.'))
        .catch((error: any) => console.error('[LeaderboardPage] Failed to execute token script:', error));

      // Remove listener after first execution to avoid re-injecting on internal navigation
      webview.removeEventListener('did-finish-load', injectTokenOnLoad);
    };

    // Add the listener
    webview.addEventListener('did-finish-load', injectTokenOnLoad);

    // If webview is *already* loaded (e.g., component re-mount), the 'did-finish-load'
    // event might have already fired. The listener handles this by executing immediately
    // if added after the event. We don't need the isLoading check.
    // The 'did-finish-load' listener handles both initial load and cases where
    // the webview might already be loaded when the watcher runs.
  }
}, { immediate: true }); // immediate: true might be needed if webviewRef is set quickly

// Computed property for the final iframe URL
const webviewSrc = computed(() => {
  let url: string | null = null; // Define url variable
  // Temporarily disable token-based URL for logged-in users
  // if (accessToken.value) {
  //   // Construct the client-init URL with the token
  //   const initUrl = new URL('/auth/client-init', webAppBaseUrl);
  //   initUrl.searchParams.set('token', accessToken.value);
  //   // Append the original target path (leaderboard) as a hash or query param if needed by the web app
  //   // For now, just redirecting to client-init which should handle session and redirect
  //   // If the web app needs to know the target, adjust here:
  //   // initUrl.hash = '#leaderboard'; // Example if using hash routing on web app side
  //   url = initUrl.toString();
  // } else {
    // Always use the guest logic for now
    url = `${webAppBaseUrl}/leaderboard`;
  // }
  console.log(`[LeaderboardPage] Computed webviewSrc: ${url}`); // Log the computed URL
  return url;
});
</script>

<style scoped>
.webview-container {
  /* Container takes full height from parent */
}
.webview-container webview {
}
</style>