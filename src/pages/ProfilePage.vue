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
const currentUsername = ref<string | null>(null); // Use currentUsername for logged-in user
const lastUsername = ref<string | null>(null); // Keep lastUsername for guest fallback
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

  // Fetch current username if authenticated, or last username if not
  if (accessToken.value) {
    try {
      if (window.logMonitorApi && typeof window.logMonitorApi.authGetStatus === 'function') {
        const status = await window.logMonitorApi.authGetStatus();
        currentUsername.value = status.username;
        console.log('Fetched current username for logged-in user:', currentUsername.value);
      } else {
        console.error('logMonitorApi.authGetStatus is not available.');
        currentUsername.value = null;
      }
    } catch (userError) {
       console.error('Error fetching current username for logged-in user:', userError);
       currentUsername.value = null;
    }
  } else {
     // If not authenticated, try to get the last logged-in user for guest view
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

  // Loading is complete after attempting token and username fetch
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
  // Temporarily disable token-based URL for logged-in users
  // if (accessToken.value) {
  //   // Construct the client-init URL with the token
  //   const initUrl = new URL('/auth/client-init', webAppBaseUrl);
  //   initUrl.searchParams.set('token', accessToken.value);
  //   // Append the original target path (profile) as a hash or query param if needed by the web app
  //   // For now, just redirecting to client-init which should handle session and redirect
  //   // If the web app needs to know the target, adjust here:
  //   // initUrl.hash = '#profile'; // Example if using hash routing on web app side
  //   url = initUrl.toString();
  // } else {
  // Determine the username to use in the URL
  const usernameToUse = accessToken.value ? currentUsername.value : lastUsername.value;

  if (usernameToUse) {
    url = `${webAppBaseUrl}/user/${usernameToUse}`;
  } else {
    // Fallback if no username is available (neither current nor last)
    console.warn('No username available for profile view.');
    url = null; // Keep it null to prevent loading invalid URL
  }

  console.log(`[ProfilePage] usernameToUse: ${usernameToUse}`); // Added log
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