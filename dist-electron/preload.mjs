"use strict";
const electron = require("electron");
electron.contextBridge.exposeInMainWorld("ipcRenderer", {
  on(...args) {
    const [channel, listener] = args;
    return electron.ipcRenderer.on(channel, (event, ...args2) => listener(event, ...args2));
  },
  off(...args) {
    const [channel, ...omit] = args;
    return electron.ipcRenderer.off(channel, ...omit);
  },
  send(...args) {
    const [channel, ...omit] = args;
    return electron.ipcRenderer.send(channel, ...omit);
  },
  invoke(...args) {
    const [channel, ...omit] = args;
    return electron.ipcRenderer.invoke(channel, ...omit);
  }
  // You can expose other APTs you need here.
  // ...
});
electron.contextBridge.exposeInMainWorld("logMonitorApi", {
  // Renderer to Main (Invoke/Send)
  getLogPath: () => electron.ipcRenderer.invoke("get-log-path"),
  setLogPath: (newPath) => electron.ipcRenderer.send("set-log-path", newPath),
  selectLogDirectory: () => electron.ipcRenderer.invoke("select-log-directory"),
  getSessions: (limit) => electron.ipcRenderer.invoke("get-sessions", limit),
  // Kill Feed API
  getKillEvents: (limit) => electron.ipcRenderer.invoke("get-kill-events", limit),
  getGlobalKillEvents: (limit) => electron.ipcRenderer.invoke("get-global-kill-events", limit),
  setFeedMode: (mode) => electron.ipcRenderer.invoke("set-feed-mode", mode),
  getFeedMode: () => electron.ipcRenderer.invoke("get-feed-mode"),
  // Event Details API
  openEventDetailsWindow: (eventData) => {
    console.log("Preload: Calling openEventDetailsWindow with event ID:", eventData == null ? void 0 : eventData.id);
    try {
      const jsonString = JSON.stringify(eventData);
      const serializedData = JSON.parse(jsonString);
      console.log("Preload: Serialized event data successfully");
      return electron.ipcRenderer.invoke("open-event-details-window", serializedData);
    } catch (error) {
      console.error("Preload: Error serializing event data:", error);
      const minimalData = {
        id: (eventData == null ? void 0 : eventData.id) || "unknown-id",
        timestamp: (eventData == null ? void 0 : eventData.timestamp) || (/* @__PURE__ */ new Date()).toISOString(),
        deathType: (eventData == null ? void 0 : eventData.deathType) || "Unknown"
      };
      console.log("Preload: Trying with minimal data:", minimalData);
      return electron.ipcRenderer.invoke("open-event-details-window", minimalData);
    }
  },
  getPassedEventData: () => {
    console.log("Preload: Getting passed event data");
    return electron.ipcRenderer.invoke("get-passed-event-data");
  },
  closeCurrentWindow: () => {
    console.log("Preload: Requesting to close current window");
    return electron.ipcRenderer.invoke("close-current-window");
  },
  // Settings API
  getLastLoggedInUser: () => electron.ipcRenderer.invoke("get-last-logged-in-user"),
  getNotificationSettings: () => electron.ipcRenderer.invoke("get-notification-settings"),
  setNotificationSettings: (value) => electron.ipcRenderer.invoke("set-notification-settings", value),
  getLastActivePage: () => electron.ipcRenderer.invoke("get-last-active-page"),
  setLastActivePage: (page) => electron.ipcRenderer.invoke("set-last-active-page", page),
  getFetchProfileData: () => electron.ipcRenderer.invoke("get-fetch-profile-data"),
  setFetchProfileData: (value) => electron.ipcRenderer.invoke("set-fetch-profile-data", value),
  getSoundEffects: () => electron.ipcRenderer.invoke("get-sound-effects"),
  setSoundEffects: (value) => electron.ipcRenderer.invoke("set-sound-effects", value),
  // API/CSV Settings - Add these back if they were removed
  getApiSettings: () => electron.ipcRenderer.invoke("get-api-settings"),
  setApiSettings: (settings) => electron.ipcRenderer.invoke("set-api-settings", settings),
  getCsvLogPath: () => electron.ipcRenderer.invoke("get-csv-log-path"),
  setCsvLogPath: (newPath) => electron.ipcRenderer.invoke("set-csv-log-path", newPath),
  // Window Actions
  openSettingsWindow: () => electron.ipcRenderer.invoke("open-settings-window"),
  // Custom Title Bar / Window Controls
  windowMinimize: () => electron.ipcRenderer.send("window:minimize"),
  windowToggleMaximize: () => electron.ipcRenderer.send("window:toggleMaximize"),
  windowClose: () => electron.ipcRenderer.send("window:close"),
  // Debug Actions
  resetSessions: () => electron.ipcRenderer.invoke("reset-sessions"),
  resetEvents: () => electron.ipcRenderer.invoke("reset-events"),
  rescanLog: () => electron.ipcRenderer.invoke("rescan-log"),
  // Auth Actions
  authLogin: (identifier, password) => electron.ipcRenderer.invoke("auth:login", identifier, password),
  authLogout: () => electron.ipcRenderer.invoke("auth:logout"),
  authGetStatus: () => electron.ipcRenderer.invoke("auth:getStatus"),
  // Main to Renderer (Receive)
  onLogUpdate: (callback) => {
    electron.ipcRenderer.on("log-update", callback);
    return () => electron.ipcRenderer.removeListener("log-update", callback);
  },
  onLogReset: (callback) => {
    electron.ipcRenderer.on("log-reset", callback);
    return () => electron.ipcRenderer.removeListener("log-reset", callback);
  },
  onLogStatus: (callback) => {
    electron.ipcRenderer.on("log-status", callback);
    return () => electron.ipcRenderer.removeListener("log-status", callback);
  },
  onLogPathUpdated: (callback) => {
    electron.ipcRenderer.on("log-path-updated", callback);
    return () => electron.ipcRenderer.removeListener("log-path-updated", callback);
  },
  onKillFeedEvent: (callback) => {
    electron.ipcRenderer.on("kill-feed-event", callback);
    return () => electron.ipcRenderer.removeListener("kill-feed-event", callback);
  },
  // Listener for auth status changes from main process
  onAuthStatusChanged: (callback) => {
    electron.ipcRenderer.on("auth-status-changed", callback);
    return () => electron.ipcRenderer.removeListener("auth-status-changed", callback);
  },
  // Function to remove all listeners at once (optional, but good practice for component unmount)
  removeAllListeners: () => {
    electron.ipcRenderer.removeAllListeners("log-update");
    electron.ipcRenderer.removeAllListeners("log-reset");
    electron.ipcRenderer.removeAllListeners("log-status");
    electron.ipcRenderer.removeAllListeners("log-path-updated");
    electron.ipcRenderer.removeAllListeners("kill-feed-event");
    electron.ipcRenderer.removeAllListeners("auth-status-changed");
  }
});
