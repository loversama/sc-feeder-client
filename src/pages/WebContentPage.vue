<template>
  <div class="web-content-container">
    <webview
      ref="webviewRef"
      :src="webviewSrc"
      :preload="guestPreloadScriptPath" <!-- CHANGED -->
      style="width: 100%; height: 100vh;"
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
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed, watch } from 'vue';
// import { useRoute } from 'vue-router'; // No longer using route from here for initial path
// import path from 'path'; // window.logMonitorApi.getPreloadPath will handle path resolution

const webviewRef = ref<Electron.WebviewTag | null>(null);
const baseWebUrl = import.meta.env.VITE_WEB_CONTENT_URL || 'http://localhost:3001'; // Ensure this is correct
// const route = useRoute(); // Not used for initial path

// Determine the target path for the webview based on the route query parameter
// or a prop if this component were to be used more generically.
// The 'section' is passed via openWebContentWindow in main.ts and set as a query param.
const targetPath = ref('/'); // Default to homepage, will be updated by main process status

const webviewSrc = computed(() => {
  const fullPath = `${baseWebUrl}${targetPath.value.startsWith('/') ? '' : '/'}${targetPath.value}`;
  console.log(`[WebContentPage] Computed webviewSrc: ${fullPath}. Current targetPath: ${targetPath.value}`);
  return fullPath;
});

watch(targetPath, (newPath, oldPath) => {
  console.log(`[WebContentPage] targetPath changed from "${oldPath}" to "${newPath}". Webview will attempt to navigate.`);
  isGuestPreloadReady = false; // Reset guest preload readiness on navigation
  if (webviewRef.value && webviewRef.value.getURL() !== webviewSrc.value) {
    console.log(`[WebContentPage] Calling webviewRef.value.loadURL(${webviewSrc.value})`);
    webviewRef.value.loadURL(webviewSrc.value);
  }
});

const guestPreloadScriptPath = ref('');
let isGuestPreloadReady = false; // Flag to track if the GUEST preload script has loaded

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


onMounted(async () => {
  console.log('[WebContentPage] Mounted. Checking for MAIN electronAuthBridge in host page:', typeof window.electronAuthBridge, window.electronAuthBridge);
  if (window.electronAuthBridge) {
    console.log('[WebContentPage] MAIN electronAuthBridge IS ACCESSIBLE in the host page!');
  } else {
    console.warn('[WebContentPage] MAIN electronAuthBridge IS NOT ACCESSIBLE in the host page. This is unexpected!');
  }

  if (window.logMonitorApi && window.logMonitorApi.getPreloadPath) {
    try {
      // Get path for the GUEST preload script
      guestPreloadScriptPath.value = await window.logMonitorApi.getPreloadPath('guest-preload.mjs'); // CHANGED filename
      console.log('[WebContentPage] Preload path for GUEST webview set to:', guestPreloadScriptPath.value);
      if (!guestPreloadScriptPath.value) {
        console.error("[WebContentPage] FATAL: getPreloadPath('guest-preload.mjs') returned empty or null!");
      }
    } catch (error) {
      console.error('[WebContentPage] Failed to get GUEST webview preload path:', error);
    }
  } else {
    console.error('[WebContentPage] logMonitorApi.getPreloadPath not available. Cannot set guest preload.');
  }

  if (window.logMonitorApi && window.logMonitorApi.getWebContentWindowStatus) {
    const status = await window.logMonitorApi.getWebContentWindowStatus();
    if (status.isOpen && status.activeSection) {
      targetPath.value = status.activeSection === '/' ? '/' : `/${status.activeSection}`;
      console.log(`[WebContentPage] Initial targetPath set to: ${targetPath.value}`);
    } else {
      // Fallback if no active section is provided, e.g. load a default like homepage
       targetPath.value = '/'; // Or some other sensible default
       console.log(`[WebContentPage] No active section from main, defaulting targetPath to: ${targetPath.value}`);
    }
  }

  if (window.logMonitorApi && window.logMonitorApi.onWebContentWindowStatus) {
    window.logMonitorApi.onWebContentWindowStatus((_event, status) => {
      console.log('[WebContentPage] Received webContentWindowStatus update:', status);
      if (status.isOpen && status.activeSection) {
        const newPath = status.activeSection === '/' ? '/' : `/${status.activeSection}`;
        if (targetPath.value !== newPath) {
          targetPath.value = newPath;
        }
      }
    });
  }

  // Listen for token updates from the MAIN Electron process (via webview-preload.mjs -> main bridge)
  // This is if the main process pushes tokens down to this host page.
  if (window.electronAuthBridge && typeof window.electronAuthBridge.onTokensUpdated === 'function') {
      // This assumes webview-preload.mjs would be modified to provide an 'onTokensUpdated'
      // For now, we'll rely on guest requesting or main bridge pushing via direct send.
      // Let's simplify: when main auth state changes, main process should tell this window,
      // and this window tells the guest.
      // For now, we will use the guest-initiated request.
  }
  // Alternative: Main process sends an IPC to this window when auth state changes.
  if (window.logMonitorApi && window.logMonitorApi.onMainAuthUpdate) {
    window.logMonitorApi.onMainAuthUpdate(async (_event, authData) => {
        console.log('[WebContentPage] Received "main-auth-update" from main process with data:', authData);
        // Now send this to the guest
        if (webviewRef.value && isGuestPreloadReady) {
             if (authData && (authData.accessToken || authData.refreshToken || authData.user)) {
                console.log('[WebContentPage] Forwarding "to-guest-auth-data" to webview GUEST from main-auth-update:', authData);
                webviewRef.value.send('to-guest-auth-data', authData);
              } else {
                console.warn('[WebContentPage] No auth data from main-auth-update. Sending clear signal to guest.');
                webviewRef.value.send('to-guest-clear-auth-data');
              }
        } else {
            console.warn('[WebContentPage] Cannot forward main-auth-update to guest: webview or guest preload not ready.');
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
    const tokens = args[0] as { accessToken: string; refreshToken: string; user: any };
    // Pass these tokens up to the main process via the MAIN electronAuthBridge
    if (tokens && window.electronAuthBridge && window.electronAuthBridge.notifyElectronOfNewTokens) {
      console.log('[WebContentPage] Received new tokens from GUEST, forwarding to MAIN bridge:', tokens);
      try {
        // No await needed if notifyElectronOfNewTokens is fire-and-forget IPC send
        window.electronAuthBridge.notifyElectronOfNewTokens(tokens);
        console.log('[WebContentPage] Successfully forwarded new tokens to MAIN bridge.');
      } catch (error) {
        console.error('[WebContentPage] Error forwarding new tokens to MAIN bridge:', error);
      }
    } else {
      console.error('[WebContentPage] Cannot forward tokens from GUEST: main bridge or method not available.');
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
  // Potentially show an error message to the user
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
.web-content-container { /* ... */ }
webview { /* ... */ }
</style>