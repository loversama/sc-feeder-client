"use strict";
const require$$0 = require("electron");
const scriptRel = "modulepreload";
const assetsURL = function(dep) {
  return "/" + dep;
};
const seen = {};
const __vitePreload = function preload(baseModule, deps, importerUrl) {
  let promise = Promise.resolve();
  if (false) {
    document.getElementsByTagName("link");
    const cspNonceMeta = document.querySelector(
      "meta[property=csp-nonce]"
    );
    const cspNonce = (cspNonceMeta == null ? void 0 : cspNonceMeta.nonce) || (cspNonceMeta == null ? void 0 : cspNonceMeta.getAttribute("nonce"));
    promise = Promise.allSettled(
      deps.map((dep) => {
        dep = assetsURL(dep);
        if (dep in seen) return;
        seen[dep] = true;
        const isCss = dep.endsWith(".css");
        const cssSelector = isCss ? '[rel="stylesheet"]' : "";
        if (document.querySelector(`link[href="${dep}"]${cssSelector}`)) {
          return;
        }
        const link = document.createElement("link");
        link.rel = isCss ? "stylesheet" : scriptRel;
        if (!isCss) {
          link.as = "script";
        }
        link.crossOrigin = "";
        link.href = dep;
        if (cspNonce) {
          link.setAttribute("nonce", cspNonce);
        }
        document.head.appendChild(link);
        if (isCss) {
          return new Promise((res, rej) => {
            link.addEventListener("load", res);
            link.addEventListener(
              "error",
              () => rej(new Error(`Unable to preload CSS for ${dep}`))
            );
          });
        }
      })
    );
  }
  function handlePreloadError(err) {
    const e = new Event("vite:preloadError", {
      cancelable: true
    });
    e.payload = err;
    window.dispatchEvent(e);
    if (!e.defaultPrevented) {
      throw err;
    }
  }
  return promise.then((res) => {
    for (const item of res || []) {
      if (item.status !== "rejected") continue;
      handlePreloadError(item.reason);
    }
    return baseModule().catch(handlePreloadError);
  });
};
console.log("PRELOAD EXECUTING NOW");
let Titlebar = null;
let TitlebarColor = null;
require$$0.contextBridge.exposeInMainWorld("ipcRenderer", {
  on(...args) {
    const [channel, listener] = args;
    require$$0.ipcRenderer.on(channel, (event, ...args2) => listener(event, ...args2));
    return require$$0.ipcRenderer;
  },
  off(...args) {
    const [channel, ...omit] = args;
    require$$0.ipcRenderer.off(channel, ...omit);
    return require$$0.ipcRenderer;
  },
  send(...args) {
    const [channel, ...omit] = args;
    require$$0.ipcRenderer.send(channel, ...omit);
  },
  invoke(...args) {
    const [channel, ...omit] = args;
    return require$$0.ipcRenderer.invoke(channel, ...omit);
  },
  removeListener(...args) {
    const [channel, listener] = args;
    require$$0.ipcRenderer.removeListener(channel, listener);
    return require$$0.ipcRenderer;
  },
  removeAllListeners(channel) {
    require$$0.ipcRenderer.removeAllListeners(channel);
    return require$$0.ipcRenderer;
  },
  sendToHost(channel, ...args) {
    require$$0.ipcRenderer.sendToHost(channel, ...args);
  }
});
require$$0.contextBridge.exposeInMainWorld("electronAuthBridge", {
  getStoredAuthData: () => {
    return require$$0.ipcRenderer.invoke("auth:get-tokens");
  },
  notifyElectronOfNewTokens: (tokens) => {
    require$$0.ipcRenderer.send("auth:store-tokens", tokens);
  },
  onTokensUpdated: (callback) => {
    const listener = (_event, tokens) => callback(_event, tokens);
    require$$0.ipcRenderer.on("auth:tokens-updated", listener);
    return () => {
      require$$0.ipcRenderer.removeListener("auth:tokens-updated", listener);
    };
  }
});
require$$0.contextBridge.exposeInMainWorld("logMonitorApi", {
  // Generic IPC invoke method for any IPC channel
  invoke: (...args) => {
    const [channel, ...omit] = args;
    return require$$0.ipcRenderer.invoke(channel, ...omit);
  },
  // Renderer to Main (Invoke/Send)
  getLogPath: () => require$$0.ipcRenderer.invoke("get-log-path"),
  setLogPath: (newPath) => require$$0.ipcRenderer.send("set-log-path", newPath),
  selectLogDirectory: () => require$$0.ipcRenderer.invoke("select-log-directory"),
  getSessions: (limit) => require$$0.ipcRenderer.invoke("get-sessions", limit),
  // Kill Feed API
  getKillEvents: (limit) => require$$0.ipcRenderer.invoke("get-kill-events", limit),
  getGlobalKillEvents: (limit) => require$$0.ipcRenderer.invoke("get-global-kill-events", limit),
  setFeedMode: (mode) => require$$0.ipcRenderer.invoke("set-feed-mode", mode),
  getFeedMode: () => require$$0.ipcRenderer.invoke("get-feed-mode"),
  // EventStore Search and Pagination API
  searchEvents: (query, limit, offset) => require$$0.ipcRenderer.invoke("search-events", query, limit, offset),
  loadMoreEvents: (limit, offset) => require$$0.ipcRenderer.invoke("load-more-events", limit, offset),
  getEventStoreStats: () => require$$0.ipcRenderer.invoke("get-event-store-stats"),
  // Event Details API
  openEventDetailsWindow: (eventData) => {
    console.log("Preload: Calling openEventDetailsWindow with event ID:", eventData == null ? void 0 : eventData.id);
    try {
      const jsonString = JSON.stringify(eventData);
      const serializedData = JSON.parse(jsonString);
      console.log("Preload: Serialized event data successfully");
      return require$$0.ipcRenderer.invoke("open-event-details-window", serializedData);
    } catch (error) {
      console.error("Preload: Error serializing event data:", error);
      const minimalData = {
        id: (eventData == null ? void 0 : eventData.id) || "unknown-id",
        timestamp: (eventData == null ? void 0 : eventData.timestamp) || (/* @__PURE__ */ new Date()).toISOString(),
        deathType: (eventData == null ? void 0 : eventData.deathType) || "Unknown"
      };
      console.log("Preload: Trying with minimal data:", minimalData);
      return require$$0.ipcRenderer.invoke("open-event-details-window", minimalData);
    }
  },
  getPassedEventData: () => {
    console.log("Preload: Getting passed event data");
    return require$$0.ipcRenderer.invoke("get-passed-event-data");
  },
  closeCurrentWindow: () => {
    console.log("Preload: Requesting to close current window");
    return require$$0.ipcRenderer.invoke("close-current-window");
  },
  // Settings API
  getLastLoggedInUser: () => require$$0.ipcRenderer.invoke("get-last-logged-in-user"),
  getNotificationSettings: () => require$$0.ipcRenderer.invoke("get-notification-settings"),
  setNotificationSettings: (value) => require$$0.ipcRenderer.invoke("set-notification-settings", value),
  getLastActivePage: () => require$$0.ipcRenderer.invoke("get-last-active-page"),
  setLastActivePage: (page) => require$$0.ipcRenderer.invoke("set-last-active-page", page),
  getFetchProfileData: () => require$$0.ipcRenderer.invoke("get-fetch-profile-data"),
  setFetchProfileData: (value) => require$$0.ipcRenderer.invoke("set-fetch-profile-data", value),
  getSoundEffects: () => require$$0.ipcRenderer.invoke("get-sound-effects"),
  setSoundEffects: (value) => require$$0.ipcRenderer.invoke("set-sound-effects", value),
  // Launch on Startup
  getLaunchOnStartup: () => require$$0.ipcRenderer.invoke("get-launch-on-startup"),
  setLaunchOnStartup: (value) => require$$0.ipcRenderer.invoke("set-launch-on-startup", value),
  getApiSettings: () => require$$0.ipcRenderer.invoke("get-api-settings"),
  setApiSettings: (settings) => require$$0.ipcRenderer.invoke("set-api-settings", settings),
  getCsvLogPath: () => require$$0.ipcRenderer.invoke("get-csv-log-path"),
  setCsvLogPath: (newPath) => require$$0.ipcRenderer.invoke("set-csv-log-path", newPath),
  // Window Actions
  openSettingsWindow: () => require$$0.ipcRenderer.invoke("open-settings-window"),
  openWebContentWindow: (section) => require$$0.ipcRenderer.invoke("open-web-content-window", section),
  closeSettingsWindow: () => require$$0.ipcRenderer.invoke("close-settings-window"),
  closeWebContentWindow: () => require$$0.ipcRenderer.invoke("close-web-content-window"),
  // External website window with authentication
  openExternalWebWindow: (url, options) => require$$0.ipcRenderer.invoke("open-external-web-window", url, options),
  // Window controls are now handled by custom-electron-titlebar
  // Entity Resolution API
  resolveEntity: (entityId, serverEnriched) => require$$0.ipcRenderer.invoke("entity:resolve", entityId, serverEnriched),
  resolveEntitiesBatch: (entityIds) => require$$0.ipcRenderer.invoke("entity:resolve-batch", entityIds),
  isNpcEntity: (entityId) => require$$0.ipcRenderer.invoke("entity:is-npc", entityId),
  filterNpcs: (entityIds) => require$$0.ipcRenderer.invoke("entity:filter-npcs", entityIds),
  // Definitions API
  getDefinitions: () => require$$0.ipcRenderer.invoke("definitions:get"),
  getDefinitionsVersion: () => require$$0.ipcRenderer.invoke("definitions:get-version"),
  getDefinitionsStats: () => require$$0.ipcRenderer.invoke("definitions:get-stats"),
  forceRefreshDefinitions: (serverBaseUrl) => require$$0.ipcRenderer.invoke("definitions:force-refresh", serverBaseUrl),
  testNpcPatterns: () => require$$0.ipcRenderer.invoke("debug:test-npc-patterns"),
  forceRefreshNpcList: () => require$$0.ipcRenderer.invoke("force-refresh-npc-list"),
  // Debug Actions
  resetSessions: () => require$$0.ipcRenderer.invoke("reset-sessions"),
  resetEvents: () => require$$0.ipcRenderer.invoke("reset-events"),
  rescanLog: () => require$$0.ipcRenderer.invoke("rescan-log"),
  // Auth Actions
  authLogin: (identifier, password) => require$$0.ipcRenderer.invoke("auth:login", identifier, password),
  authLogout: () => require$$0.ipcRenderer.invoke("auth:logout"),
  authGetStatus: () => require$$0.ipcRenderer.invoke("auth:getStatus"),
  authGetAccessToken: () => require$$0.ipcRenderer.invoke("auth:getAccessToken"),
  authGetTokens: () => require$$0.ipcRenderer.invoke("auth:get-tokens"),
  authStoreTokens: (tokens) => require$$0.ipcRenderer.invoke("auth:store-tokens", tokens),
  authRefreshToken: () => require$$0.ipcRenderer.invoke("auth:refreshToken"),
  authShowLogin: () => require$$0.ipcRenderer.invoke("auth:show-login"),
  // Authentication Actions for Login Popup
  authLoginSuccess: () => require$$0.ipcRenderer.invoke("auth:loginSuccess"),
  authContinueAsGuest: () => require$$0.ipcRenderer.invoke("auth:continueAsGuest"),
  authCloseLoginWindow: () => require$$0.ipcRenderer.invoke("auth:closeLoginWindow"),
  authResizeLoginWindow: (newHeight) => require$$0.ipcRenderer.invoke("auth:resize-login-window", newHeight),
  // --- New WebContentsView Architecture API ---
  // Navigate to a specific section in WebContentsView
  webContentNavigateToSection: (section) => require$$0.ipcRenderer.invoke("web-content:navigate-to-section", section),
  // Update authentication tokens in WebContentsView
  webContentUpdateAuthTokens: (tokens) => require$$0.ipcRenderer.invoke("web-content:update-auth-tokens", tokens),
  // Switch between WebContentsView and BrowserWindow architecture
  webContentSetArchitecture: (useWebContentsView) => require$$0.ipcRenderer.invoke("web-content:set-architecture", useWebContentsView),
  // Get current architecture being used
  webContentGetArchitecture: () => require$$0.ipcRenderer.invoke("web-content:get-architecture"),
  // --- Authenticated WebContentsView Methods ---
  // Open authenticated WebContentsView window
  openAuthenticatedWebContentWindow: (section) => require$$0.ipcRenderer.invoke("open-authenticated-web-content-window", section),
  // Close authenticated WebContentsView window
  closeAuthenticatedWebContentWindow: () => require$$0.ipcRenderer.invoke("close-authenticated-web-content-window"),
  // --- Enhanced WebContentsView API ---
  // Open enhanced WebContentsView window (new architecture)
  openEnhancedWebContentWindow: (section) => require$$0.ipcRenderer.invoke("enhanced-window:attach-to-existing", section),
  // Close enhanced WebContentsView window
  closeEnhancedWebContentWindow: () => require$$0.ipcRenderer.invoke("enhanced-window:close-window"),
  // Get enhanced WebContentsView window status
  getEnhancedWebContentStatus: () => require$$0.ipcRenderer.invoke("enhanced-window:get-status"),
  // Execute JavaScript in WebContentsView (DOM bridge)
  executeInWebContentsView: (jsCode) => require$$0.ipcRenderer.invoke("enhanced-webcontents:execute-js", jsCode),
  // Navigate to search page with query parameters
  navigateToSearchPage: (query) => require$$0.ipcRenderer.invoke("enhanced-webcontents:navigate-to-search", query),
  // Window Status Methods
  getSettingsWindowStatus: () => require$$0.ipcRenderer.invoke("get-settings-window-status"),
  getWebContentWindowStatus: () => require$$0.ipcRenderer.invoke("get-web-content-window-status"),
  // Profile Action
  getProfile: () => require$$0.ipcRenderer.invoke("get-profile"),
  // Resource Path
  getResourcePath: () => require$$0.ipcRenderer.invoke("get-resource-path"),
  getPreloadPath: (scriptName) => require$$0.ipcRenderer.invoke("get-preload-path", scriptName),
  getAppVersion: () => require$$0.ipcRenderer.invoke("get-app-version"),
  getGuestModeStatus: () => require$$0.ipcRenderer.invoke("app:get-guest-mode-status"),
  // Location Data API
  getCurrentLocation: () => require$$0.ipcRenderer.invoke("get-current-location"),
  getLocationHistory: () => require$$0.ipcRenderer.invoke("get-location-history"),
  getLocationState: () => require$$0.ipcRenderer.invoke("get-location-state"),
  // --- Generic IPC Message Listener ---
  onIpcMessage: (channel, callback) => {
    const listener = (_event, ...args) => callback(...args);
    require$$0.ipcRenderer.on(channel, listener);
    return () => require$$0.ipcRenderer.removeListener(channel, listener);
  },
  onMainAuthUpdate: (callback) => {
    const listener = (_event, authData) => callback(_event, authData);
    require$$0.ipcRenderer.on("main-auth-update", listener);
    return () => {
      require$$0.ipcRenderer.removeListener("main-auth-update", listener);
    };
  },
  // Main to Renderer (Receive)
  onLogUpdate: (callback) => {
    require$$0.ipcRenderer.on("log-update", callback);
    return () => require$$0.ipcRenderer.removeListener("log-update", callback);
  },
  onLogReset: (callback) => {
    require$$0.ipcRenderer.on("log-reset", callback);
    return () => require$$0.ipcRenderer.removeListener("log-reset", callback);
  },
  onLogStatus: (callback) => {
    require$$0.ipcRenderer.on("log-status", callback);
    return () => require$$0.ipcRenderer.removeListener("log-status", callback);
  },
  onLogPathUpdated: (callback) => {
    require$$0.ipcRenderer.on("log-path-updated", callback);
    return () => require$$0.ipcRenderer.removeListener("log-path-updated", callback);
  },
  onKillFeedEvent: (callback) => {
    require$$0.ipcRenderer.on("kill-feed-event", callback);
    return () => require$$0.ipcRenderer.removeListener("kill-feed-event", callback);
  },
  onAuthStatusChanged: (callback) => {
    require$$0.ipcRenderer.on("auth-status-changed", callback);
    return () => require$$0.ipcRenderer.removeListener("auth-status-changed", callback);
  },
  onConnectionStatusChanged: (callback) => {
    require$$0.ipcRenderer.on("connection-status-changed", callback);
    return () => require$$0.ipcRenderer.removeListener("connection-status-changed", callback);
  },
  onGameModeUpdate: (callback) => {
    require$$0.ipcRenderer.on("game-mode-update", callback);
    return () => require$$0.ipcRenderer.removeListener("game-mode-update", callback);
  },
  onSettingsWindowStatus: (callback) => {
    require$$0.ipcRenderer.on("settings-window-status", callback);
    return () => require$$0.ipcRenderer.removeListener("settings-window-status", callback);
  },
  onWebContentWindowStatus: (callback) => {
    require$$0.ipcRenderer.on("web-content-window-status", callback);
    return () => require$$0.ipcRenderer.removeListener("web-content-window-status", callback);
  },
  // Update Events
  checkForUpdate: () => {
    require$$0.ipcRenderer.send("check-for-update");
  },
  downloadUpdate: () => {
    require$$0.ipcRenderer.send("download-update");
  },
  installUpdate: () => {
    require$$0.ipcRenderer.send("install-update");
  },
  onUpdateChecking: (callback) => {
    require$$0.ipcRenderer.on("update-checking", callback);
    return () => require$$0.ipcRenderer.removeListener("update-checking", callback);
  },
  onUpdateCheckingTimeout: (callback) => {
    require$$0.ipcRenderer.on("update-checking-timeout", callback);
    return () => require$$0.ipcRenderer.removeListener("update-checking-timeout", callback);
  },
  onUpdateAvailable: (callback) => {
    require$$0.ipcRenderer.on("update-available", callback);
    return () => require$$0.ipcRenderer.removeListener("update-available", callback);
  },
  onUpdateNotAvailable: (callback) => {
    require$$0.ipcRenderer.on("update-not-available", callback);
    return () => require$$0.ipcRenderer.removeListener("update-not-available", callback);
  },
  onUpdateDownloadProgress: (callback) => {
    require$$0.ipcRenderer.on("update-download-progress", callback);
    return () => require$$0.ipcRenderer.removeListener("update-download-progress", callback);
  },
  onUpdateDownloaded: (callback) => {
    require$$0.ipcRenderer.on("update-downloaded", callback);
    return () => require$$0.ipcRenderer.removeListener("update-downloaded", callback);
  },
  onUpdateError: (callback) => {
    require$$0.ipcRenderer.on("update-error", callback);
    return () => require$$0.ipcRenderer.removeListener("update-error", callback);
  },
  // Debug Update Simulation
  debugSimulateUpdateAvailable: () => {
    require$$0.ipcRenderer.send("debug:simulate-update-available");
  },
  debugSimulateUpdateDownload: () => {
    require$$0.ipcRenderer.send("debug:simulate-update-download");
  },
  debugSimulateUpdateError: () => {
    require$$0.ipcRenderer.send("debug:simulate-update-error");
  },
  debugSimulateUpdateChecking: () => {
    require$$0.ipcRenderer.send("debug:simulate-update-checking");
  },
  debugResetUpdateSimulation: () => {
    require$$0.ipcRenderer.send("debug:reset-update-simulation");
  },
  // Debug logging to main process
  sendLogToMain: (message) => {
    return require$$0.ipcRenderer.invoke("send-log-to-main", message);
  },
  // Open URL in default browser
  openExternal: (url) => {
    return require$$0.ipcRenderer.invoke("open-external", url);
  },
  removeAllListeners: () => {
    const channels = [
      "log-update",
      "log-reset",
      "log-status",
      "log-path-updated",
      "kill-feed-event",
      "auth-status-changed",
      "connection-status-changed",
      "game-mode-update",
      "settings-window-status",
      "web-content-window-status",
      "update-checking",
      "update-available",
      "update-not-available",
      "update-download-progress",
      "update-downloaded",
      "update-error"
    ];
    channels.forEach((channel) => require$$0.ipcRenderer.removeAllListeners(channel));
  }
});
require$$0.contextBridge.exposeInMainWorld("electronAPI", {
  minimizeWindow: () => {
    console.log("Minimize button clicked, sending window-minimize");
    require$$0.ipcRenderer.send("window-minimize");
  },
  maximizeWindow: () => {
    console.log("Maximize button clicked, sending window-maximize");
    require$$0.ipcRenderer.send("window-maximize");
  },
  closeWindow: () => {
    console.log("Close button clicked, sending window-close");
    require$$0.ipcRenderer.send("window-close");
  },
  navigation: {
    request: (section) => {
      console.log(`Navigation request for section: ${section}`);
      return require$$0.ipcRenderer.invoke("navigation:request", section);
    },
    close: (section) => {
      console.log(`Navigation close request for section: ${section || "current"}`);
      return require$$0.ipcRenderer.invoke("navigation:close", section);
    },
    getState: () => {
      console.log("Getting navigation state");
      return require$$0.ipcRenderer.invoke("navigation:get-state");
    },
    onStateChange: (callback) => {
      console.log("Setting up navigation state change listener");
      const listener = (_, state) => callback(state);
      require$$0.ipcRenderer.on("navigation-state-changed", listener);
      return () => {
        require$$0.ipcRenderer.removeListener("navigation-state-changed", listener);
      };
    }
  }
});
window.addEventListener("DOMContentLoaded", async () => {
  console.log("DOMContentLoaded - attempting to load titlebar...");
  try {
    console.log("Importing custom-electron-titlebar...");
    const titlebarModule = await __vitePreload(() => Promise.resolve().then(() => require("./index.mjs")).then((n) => n.index), false ? __VITE_PRELOAD__ : void 0);
    console.log("Titlebar module loaded:", titlebarModule);
    Titlebar = titlebarModule.Titlebar;
    TitlebarColor = titlebarModule.TitlebarColor;
    console.log("Creating titlebar with TitlebarColor.TRANSPARENT...");
    new Titlebar({
      backgroundColor: TitlebarColor.TRANSPARENT,
      titleHorizontalAlignment: "center",
      enableMnemonics: false,
      unfocusEffect: false
    });
    console.log("Titlebar initialized successfully");
  } catch (error) {
    console.error("Failed to load titlebar:", error);
    console.error("Error details:", error instanceof Error ? error.message : String(error));
    console.log("Creating fallback titlebar...");
    createFallbackTitlebar();
  }
});
function createFallbackTitlebar() {
  const titlebar = document.createElement("div");
  titlebar.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    height: 32px;
    background: transparent;
    display: flex;
    justify-content: flex-end;
    align-items: center;
    z-index: 9999;
    -webkit-app-region: drag;
  `;
  const controls = document.createElement("div");
  controls.style.cssText = `
    display: flex;
    -webkit-app-region: no-drag;
  `;
  const minimize = createControlButton("−", () => {
    console.log("Minimize button clicked in fallback titlebar");
    console.log("Sending window-minimize via direct ipcRenderer");
    require$$0.ipcRenderer.send("window-minimize");
  });
  const maximize = createControlButton("□", () => {
    console.log("Maximize button clicked in fallback titlebar");
    console.log("Sending window-maximize via direct ipcRenderer");
    require$$0.ipcRenderer.send("window-maximize");
  });
  const close = createControlButton("×", () => {
    console.log("Close button clicked in fallback titlebar");
    console.log("Sending window-close via direct ipcRenderer");
    require$$0.ipcRenderer.send("window-close");
  });
  close.addEventListener("mouseenter", () => {
    close.style.backgroundColor = "#e81123";
  });
  close.addEventListener("mouseleave", () => {
    close.style.backgroundColor = "transparent";
  });
  controls.appendChild(minimize);
  controls.appendChild(maximize);
  controls.appendChild(close);
  titlebar.appendChild(controls);
  document.body.appendChild(titlebar);
  console.log("Fallback titlebar created");
}
function createControlButton(text, onclick) {
  const button = document.createElement("button");
  button.textContent = text;
  button.style.cssText = `
    width: 46px;
    height: 32px;
    border: none;
    background: transparent;
    color: white;
    font-size: 16px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background-color 0.2s;
  `;
  button.addEventListener("mouseenter", () => {
    button.style.backgroundColor = "rgba(255, 255, 255, 0.1)";
  });
  button.addEventListener("mouseleave", () => {
    button.style.backgroundColor = "transparent";
  });
  button.addEventListener("click", onclick);
  return button;
}
