<template>
  <div class="flex flex-col h-screen overflow-hidden bg-theme-bg-dark text-theme-text-light">
    <!-- Navigation Header -->
    <header class="p-2 bg-[#171717] border-b border-[#262626] shadow-md shrink-0 h-[80px] flex items-center justify-between">
      <nav class="mt-2 flex items-center">
        <!-- Navigation Links -->
        <button
          @click="setActiveSection('profile')"
          class="ml-[50px] p-2 rounded transition-colors duration-200"
          :class="{ 
            'text-[rgb(99,99,247)] bg-white/5': activeSection === 'profile',
            'hover:bg-white/5 hover:text-[rgb(77,77,234)] text-theme-text-light': activeSection !== 'profile' 
          }"
        >
          Profile
        </button>
        <button
          @click="setActiveSection('leaderboard')"
          class="ml-4 p-2 rounded transition-colors duration-200"
          :class="{ 
            'text-[rgb(99,99,247)] bg-white/5': activeSection === 'leaderboard',
            'hover:bg-white/5 hover:text-[rgb(77,77,234)] text-theme-text-light': activeSection !== 'leaderboard' 
          }"
        >
          Leaderboard
        </button>
        <button
          @click="setActiveSection('map')"
          class="ml-4 p-2 rounded transition-colors duration-200"
          :class="{ 
            'text-[rgb(99,99,247)] bg-white/5': activeSection === 'map',
            'hover:bg-white/5 hover:text-[rgb(77,77,234)] text-theme-text-light': activeSection !== 'map' 
          }"
        >
          Map
        </button>
      </nav>
    </header>

    <!-- Main Webview Content -->
    <div class="flex-1 overflow-hidden">
      <webview
        ref="webviewRef"
        :src="webviewSrc"
        :preload="guestPreloadScriptPath"
        style="width: 100%; height: 100%;"
        partition="persist:logmonitorweb"
        allowpopups
        @dom-ready="onWebviewDomReady"
        @ipc-message="handleIpcMessage"
        @console-message="handleConsoleMessage"
        @did-fail-load="handleLoadFail"
        @did-navigate="handleDidNavigate"
        @did-frame-navigate="handleDidFrameNavigate"
      ></webview>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed, watch } from 'vue';
import type { IpcRendererEvent } from 'electron';
import type { AuthData, UserProfile } from '../preload';

const webviewRef = ref<Electron.WebviewTag | null>(null);
const activeSection = ref<'profile' | 'leaderboard' | 'map'>('profile'); // Current active section
const baseWebUrl = import.meta.env.VITE_WEB_CONTENT_URL || 'http://localhost:3001';

// State for authentication
const isAuthenticated = ref(false);
const currentUsername = ref<string | null>(null);

// Computed webview URL based on active section and authentication status
const webviewSrc = computed(() => {
  const isDevelopment = import.meta.env.DEV;
  const webAppBaseUrl = isDevelopment
    ? 'http://localhost:3001'
    : 'https://killfeed.sinfulshadows.com';
  
  let url = '';
  
  // Use different URLs based on authentication status
  if (isAuthenticated.value) {
    // Authenticated user URLs - token-based authentication
    if (activeSection.value === 'profile' && currentUsername.value) {
      url = `${webAppBaseUrl}/user/${currentUsername.value}?source=electron&auth=true`;
    } else if (activeSection.value === 'leaderboard') {
      url = `${webAppBaseUrl}/leaderboard?source=electron&auth=true`;
    } else if (activeSection.value === 'map') {
      url = `${webAppBaseUrl}/map?source=electron&auth=true`;
    } else {
      url = `${webAppBaseUrl}?source=electron&auth=true`;
    }
  } else {
    // Guest mode URLs
    if (activeSection.value === 'profile' && currentUsername.value) {
      url = `${webAppBaseUrl}/user/${currentUsername.value}?source=electron`;
    } else if (activeSection.value === 'leaderboard') {
      url = `${webAppBaseUrl}/leaderboard?source=electron`;
    } else if (activeSection.value === 'map') {
      url = `${webAppBaseUrl}/map?source=electron`;
    } else {
      url = `${webAppBaseUrl}?source=electron`;
    }
  }
  
  console.log(`[WebContentPage] Computed webviewSrc: ${url} for section: ${activeSection.value}, authenticated: ${isAuthenticated.value}`);
  return url;
});

// Function to change active section
const setActiveSection = (section: 'profile' | 'leaderboard' | 'map') => {
  console.log(`[WebContentPage] Setting active section to: ${section}`);
  activeSection.value = section;
};

// Watch for section changes and authentication changes to reload webview
watch([activeSection, isAuthenticated, currentUsername], ([newSection, newAuth, newUsername], [oldSection, oldAuth, oldUsername]) => {
  console.log(`[WebContentPage] State changed - section: "${oldSection}" -> "${newSection}", auth: ${oldAuth} -> ${newAuth}, username: "${oldUsername}" -> "${newUsername}"`);
  isGuestPreloadReady = false; // Reset guest preload readiness on navigation
  if (webviewRef.value) {
    console.log(`[WebContentPage] Loading new URL: ${webviewSrc.value}`);
    webviewRef.value.loadURL(webviewSrc.value);
  }
});

const guestPreloadScriptPath = ref('');
let isGuestPreloadReady = false;

// Function to fetch tokens using the MAIN bridge and send to webview guest
const sendAuthDataToWebviewGuest = async (reason: string) => {
  if (!webviewRef.value) {
    console.warn(`[WebContentPage] sendAuthDataToWebviewGuest (${reason}): webviewRef is null.`);
    return;
  }
  if (!isGuestPreloadReady) {
    console.warn(`[WebContentPage] sendAuthDataToWebviewGuest (${reason}): Guest preload not ready. Will wait for 'guest-preload-loaded' IPC.`);
    return;
  }
  if (webviewRef.value.isLoading()) {
    console.warn(`[WebContentPage] sendAuthDataToWebviewGuest (${reason}): webview is still loading. Aborting send for now.`);
    return;
  }

  console.log(`[WebContentPage] Attempting to send auth data to webview GUEST. Reason: ${reason}.`);
  try {
    // Use the main electronAuthBridge, which IS available in this host page's context
    if (window.electronAuthBridge && window.electronAuthBridge.getStoredAuthData) {
      console.log('[WebContentPage] Calling window.electronAuthBridge.getStoredAuthData()');
      const authData = await window.electronAuthBridge.getStoredAuthData(); // Assuming this can be async or sync
      console.log('[WebContentPage] Auth data from main bridge:', authData);

      if (authData && (authData.accessToken || authData.refreshToken || authData.user)) {
        console.log('[WebContentPage] Sending "to-guest-auth-data" to webview GUEST with payload:', authData);
        webviewRef.value.send('to-guest-auth-data', authData);
      } else {
        console.warn('[WebContentPage] No auth data from main bridge. Sending clear signal to guest.');
        webviewRef.value.send('to-guest-clear-auth-data');
      }
    } else {
      console.error('[WebContentPage] window.electronAuthBridge.getStoredAuthData is not available.');
      webviewRef.value.send('to-guest-clear-auth-data'); // Tell guest to clear if we can't get data
    }
  } catch (error) {
    console.error('[WebContentPage] Error fetching from main bridge or sending to guest:', error);
  }
};


// Function to update authentication status
const updateAuthStatus = async () => {
  try {
    if (window.logMonitorApi && window.logMonitorApi.authGetStatus) {
      const status = await window.logMonitorApi.authGetStatus();
      isAuthenticated.value = status.isAuthenticated;
      currentUsername.value = status.username;
      console.log(`[WebContentPage] Auth status updated: authenticated=${isAuthenticated.value}, username=${currentUsername.value}`);
    }
  } catch (error) {
    console.error('[WebContentPage] Failed to get auth status:', error);
    isAuthenticated.value = false;
    currentUsername.value = null;
  }
};

onMounted(async () => {
  console.log('[WebContentPage] Mounted.');

  // Get authentication status first
  await updateAuthStatus();

  // Get guest preload script path
  if (window.logMonitorApi && window.logMonitorApi.getPreloadPath) {
    try {
      guestPreloadScriptPath.value = await window.logMonitorApi.getPreloadPath('guest-preload.mjs');
      console.log('[WebContentPage] Preload path for GUEST webview set to:', guestPreloadScriptPath.value);
    } catch (error) {
      console.error('[WebContentPage] Failed to get GUEST webview preload path:', error);
    }
  }

  // Get initial section from window status
  if (window.logMonitorApi && window.logMonitorApi.getWebContentWindowStatus) {
    try {
      const status = await window.logMonitorApi.getWebContentWindowStatus();
      if (status.isOpen && status.activeSection) {
        if (status.activeSection === 'profile' || status.activeSection === 'leaderboard' || status.activeSection === 'map') {
          activeSection.value = status.activeSection;
          console.log(`[WebContentPage] Initial section set to: ${activeSection.value}`);
        }
      }
    } catch (error) {
      console.error('[WebContentPage] Failed to get initial window status:', error);
    }
  }

  // Listen for navigation requests from main process
  window.addEventListener('web-content-navigate', (event: any) => {
    const section = event.detail?.section;
    if (section === 'profile' || section === 'leaderboard' || section === 'map') {
      console.log(`[WebContentPage] Received navigation request for: ${section}`);
      setActiveSection(section);
    }
  });

  // Listen for auth status changes
  if (window.logMonitorApi && window.logMonitorApi.onAuthStatusChanged) {
    window.logMonitorApi.onAuthStatusChanged((_event: IpcRendererEvent, status: any) => {
      console.log('[WebContentPage] Received auth-status-changed:', status);
      isAuthenticated.value = status.isAuthenticated;
      currentUsername.value = status.username;
      // URL will automatically update due to computed property
    });
  }

  // Listen for auth updates from main process
  if (window.logMonitorApi && window.logMonitorApi.onMainAuthUpdate) {
    window.logMonitorApi.onMainAuthUpdate(async (_event: IpcRendererEvent, authData: AuthData) => {
      console.log('[WebContentPage] Received main-auth-update:', authData);
      // Update local auth state
      await updateAuthStatus();
      
      if (webviewRef.value && isGuestPreloadReady) {
        if (authData && (authData.accessToken || authData.refreshToken || authData.user)) {
          console.log('[WebContentPage] Forwarding auth data to guest webview');
          webviewRef.value.send('to-guest-auth-data', authData);
        } else {
          console.log('[WebContentPage] Clearing auth data in guest webview');
          webviewRef.value.send('to-guest-clear-auth-data');
        }
      }
    });
  }
});

const onWebviewDomReady = () => {
  console.log(`[WebContentPage] Webview DOM ready. Source: ${webviewRef.value?.getURL()}. Guest preload ready: ${isGuestPreloadReady}`);
  // webviewRef.value?.openDevTools(); // Uncomment for debugging webview content
  // Don't send here directly; wait for 'guest-preload-loaded'
};

const handleIpcMessage = async (event: Electron.IpcMessageEvent) => {
  console.log('[WebContentPage] IPC message from GUEST webview:', event.channel, event.args);
  const channel = event.channel;
  const args = event.args;

  if (channel === 'guest-preload-loaded') {
    console.log(`[WebContentPage] GUEST preload script has loaded. Payload: ${JSON.stringify(args)}.`);
    isGuestPreloadReady = true;
    await sendAuthDataToWebviewGuest('guest-preload-loaded');

  } else if (channel === 'guest-new-tokens') {
    const tokens = args[0] as AuthData;
    // Pass these tokens up to the main process via the MAIN electronAuthBridge
    if (tokens && tokens.accessToken && tokens.refreshToken && window.electronAuthBridge && window.electronAuthBridge.notifyElectronOfNewTokens) {
      console.log('[WebContentPage] Received new tokens from GUEST, forwarding to MAIN bridge:', tokens);
      try {
        // No await needed if notifyElectronOfNewTokens is fire-and-forget IPC send
        window.electronAuthBridge.notifyElectronOfNewTokens({
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          user: tokens.user ?? undefined
        });
        console.log('[WebContentPage] Successfully forwarded new tokens to MAIN bridge.');
      } catch (error) {
        console.error('[WebContentPage] Error forwarding new tokens to MAIN bridge:', error);
      }
    } else {
      console.error('[WebContentPage] Cannot forward tokens from GUEST: main bridge or method not available, or tokens are incomplete.');
    }

  } else if (channel === 'guest-requests-auth-data') {
    console.log(`[WebContentPage] GUEST webview is requesting auth data. Payload: ${JSON.stringify(args)}.`);
    await sendAuthDataToWebviewGuest('guest-request');
  }
};

// ... (keep handleConsoleMessage, handleLoadFail, handleDidNavigate, handleDidFrameNavigate, onUnmounted)
const handleConsoleMessage = (event: Electron.ConsoleMessageEvent) => {
  console.log(`[WebviewConsole][${event.level}] ${event.message} (Source: ${event.sourceId}:${event.line})`);
};

const handleLoadFail = (event: Electron.DidFailLoadEvent) => {
  console.error('[WebContentPage] Webview failed to load:', {
    errorCode: event.errorCode,
    errorDescription: event.errorDescription,
    validatedURL: event.validatedURL,
    isMainFrame: event.isMainFrame,
  });
  
  // Handle specific error cases
  if (event.errorCode === -3) { // ERR_ABORTED
    console.warn('[WebContentPage] Load was aborted, possibly due to navigation or server unavailable');
    // Don't retry automatically for aborted loads as they might be intentional
  } else if (event.errorCode === -2) { // ERR_FAILED
    console.error('[WebContentPage] Network error - server may be down');
    // Could show user-friendly error message
  } else if (event.errorCode === -105) { // ERR_NAME_NOT_RESOLVED
    console.error('[WebContentPage] DNS resolution failed - check internet connection');
  } else {
    console.error('[WebContentPage] Unknown error loading webview content');
  }
  
  // Reset guest preload readiness on load failure
  isGuestPreloadReady = false;
};

const handleDidNavigate = (event: Electron.DidNavigateEvent) => {
    console.log(`[WebContentPage] Webview navigated (did-navigate). URL: ${event.url}. Guest preload ready: ${isGuestPreloadReady}`);
    isGuestPreloadReady = false; // Reset on any main frame navigation
};

const handleDidFrameNavigate = (event: Electron.DidFrameNavigateEvent) => {
    console.log(`[WebContentPage] Webview frame navigated (did-frame-navigate). URL: ${event.url}. Is main frame: ${event.isMainFrame}. Guest preload ready: ${isGuestPreloadReady}`);
    if (event.isMainFrame) {
        isGuestPreloadReady = false; // Reset on main frame navigation
    }
};


onUnmounted(() => {
  // Cleanup if window.logMonitorApi.onMainAuthUpdate had a remover
});

</script>

<style scoped>
/* Custom titlebar styles */
.cet-title.cet-title-center {
  display: none !important;
}

.cet-container {
  position: relative !important;
  top: 0px !important;
  bottom: 0;
  overflow: auto;
  z-index: 1;
}

.cet-drag-region {
  z-index: 1 !important;
}

.cet-menubar {
  display: none !important;
}

.cet-icon {
  display: none !important;
}

/* Ensure webview takes full space */
webview {
  border: none;
  outline: none;
}

/* Navigation button states */
button {
  outline: none;
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;
}

button:focus {
  outline: 2px solid rgba(99, 99, 247, 0.5);
  outline-offset: 2px;
}
</style>