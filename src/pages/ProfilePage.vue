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
import { ref, onMounted, computed, watch } from 'vue'; // Import watch

const webviewRef = ref<Electron.WebviewTag | null>(null);
const accessToken = ref<string | null>(null);
const lastUsername = ref<string | null>(null); // Add ref for username
const isLoading = ref(true);
// Use Vite's import.meta.env.DEV to check for development mode
const isDevelopment = import.meta.env.DEV;
const webAppBaseUrl = isDevelopment
  ? 'http://localhost:3001'
  : 'https://killfeed.sinfulshadows.com'; // Define base URL

onMounted(async () => {
  console.log('[ProfilePage] Mounted');
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

  // Always try to get username if we might need it for guest mode (either no token or fetch failed)
  if (!accessToken.value) {
    try {
      if (window.logMonitorApi && typeof window.logMonitorApi.getLastLoggedInUser === 'function') {
        lastUsername.value = await window.logMonitorApi.getLastLoggedInUser();
        console.log('Fetched last username for guest mode:', lastUsername.value);
      } else {
        console.error('logMonitorApi.getLastLoggedInUser is not available.');
        lastUsername.value = null;
      }
    } catch (userError) {
       console.error('Error fetching last username for guest mode:', userError);
       lastUsername.value = null;
    }
  }

  // Loading is complete after attempting token and potentially username fetch
  isLoading.value = false;

  // Token injection logic moved to a watcher
});

// Watch for the webview element and the access token to be ready
watch([webviewRef, accessToken], ([webview, token]) => {
  // Also check isLoading to ensure token fetch attempt is complete
  if (webview && !isLoading.value) {
     console.log(`[ProfilePage] Watch triggered. Webview element available: ${!!webview}, isLoading: ${isLoading.value}`);

    // --- Add Detailed Event Listeners ---
    webview.addEventListener('did-start-loading', () => {
      console.log('[ProfilePage] Webview event: did-start-loading');
    });
    webview.addEventListener('did-stop-loading', () => {
      console.log('[ProfilePage] Webview event: did-stop-loading');
    });
    webview.addEventListener('dom-ready', () => {
      console.log('[ProfilePage] Webview event: dom-ready');
    });
    webview.addEventListener('did-fail-load', (event) => {
      console.error(`[ProfilePage] Webview event: did-fail-load - ErrorCode: ${event.errorCode}, ErrorDescription: ${event.errorDescription}, URL: ${event.validatedURL}`);
    });
    webview.addEventListener('console-message', (event) => {
      console.log(`[ProfilePage] Webview Console [${event.level}]: ${event.message} (Source: ${event.sourceId}:${event.line})`);
    });
    // --- End Detailed Event Listeners ---

    console.log('[ProfilePage] Webview ready and token status known. Injecting token if available.');
    const script = token
      ? `localStorage.setItem('electronInjectedToken', '${token}'); console.log('Electron injected token into webview localStorage.'); window.dispatchEvent(new Event('tokenInjected'));`
      : `localStorage.removeItem('electronInjectedToken'); console.log('Electron cleared token from webview localStorage.'); window.dispatchEvent(new Event('tokenCleared'));`;

    // Execute script when the webview finishes loading its *initial* content
    const injectTokenOnLoad = () => {
      console.log('[ProfilePage] Webview did-finish-load triggered. Executing script.');
      webview.executeJavaScript(script)
        .then(() => console.log('[ProfilePage] Token script executed successfully.'))
        .catch((error: any) => console.error('[ProfilePage] Failed to execute token script:', error));

      // Inject CSS to make the content fill the webview height
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
        .then(() => console.log('[ProfilePage] HTML/Body full height CSS injected successfully.'))
        .catch(err => console.error('[ProfilePage] Failed to inject HTML/Body full height CSS:', err));

      // Remove listener after first execution
      webview.removeEventListener('did-finish-load', injectTokenOnLoad);
    };

    // Add the listener
    webview.addEventListener('did-finish-load', injectTokenOnLoad);

    // The 'did-finish-load' listener handles both initial load and cases where
    // the webview might already be loaded when the watcher runs.
  }
}, { immediate: true }); // immediate: true might be needed

// Computed property for the final iframe URL
const webviewSrc = computed(() => {
  let url: string | null = null; // Define url variable
  if (accessToken.value) {
    // Construct the client-init URL with the token
    const initUrl = new URL('/auth/client-init', webAppBaseUrl);
    initUrl.searchParams.set('token', accessToken.value);
    // Append the original target path (profile) as a hash or query param if needed by the web app
    // For now, just redirecting to client-init which should handle session and redirect
    // If the web app needs to know the target, adjust here:
    // initUrl.hash = '#profile'; // Example if using hash routing on web app side
    url = initUrl.toString();
  } else {
    // If no token (guest user), construct the user profile URL
    if (lastUsername.value) {
      url = `${webAppBaseUrl}/user/${lastUsername.value}`;
    } else {
      // Fallback if username couldn't be fetched
      console.warn('No last username available for guest profile view.');
      url = null; // Keep it null to prevent loading invalid URL
    }
  }
  console.log(`[ProfilePage] Computed webviewSrc: ${url}`); // Log the computed URL
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