
# IPC Handlers and Preload Scripts

This document explains the Inter-Process Communication (IPC) mechanism used in the `log-monitor-client` to facilitate communication between the main process and the renderer processes. It covers the roles of both the `ipc-handlers.ts` and `preload.ts` files.

## 1. Preload Scripts (`preload.ts`)

The `preload.ts` script acts as a bridge between the Electron main process and the renderer process (the UI). It uses the `contextBridge` to securely expose a set of APIs to the renderer, allowing the UI to interact with the backend logic without having direct access to Node.js modules.

### a. `logMonitorApi`

This is the primary API exposed to the renderer process. It contains a comprehensive set of functions for:

*   **Invoking Main Process Logic:** Functions like `getLogPath`, `authLogin`, and `openSettingsWindow` allow the renderer to trigger actions in the main process and receive a promise-based response.
*   **Sending One-Way Messages:** Functions like `setLogPath` send data to the main process without expecting a direct response.
*   **Listening for Events:** Functions like `onLogUpdate` and `onAuthStatusChanged` allow the renderer to register listeners for events that are broadcast from the main process.

### b. `electronAuthBridge`

This is a specialized API designed for the webview. It provides a secure way for the `log-monitor-web` application to communicate with the Electron client for authentication purposes, such as storing and retrieving tokens.

## 2. IPC Handlers (`ipc-handlers.ts`)

The `ipc-handlers.ts` module is responsible for registering the handlers for all the IPC messages that are exposed by the preload scripts. The `registerIpcHandlers()` function sets up listeners for each channel defined in the `logMonitorApi`.

### a. `ipcMain.handle()`

This is used for two-way communication. When the renderer process invokes a channel (e.g., `ipcRenderer.invoke('get-log-path')`), the corresponding handler in `ipc-handlers.ts` is executed, and its return value is sent back to the renderer as a promise.

### b. `ipcMain.on()`

This is used for one-way communication. When the renderer process sends a message on a channel (e.g., `ipcRenderer.send('set-log-path', newPath)`), the corresponding handler is executed, but no response is sent back to the renderer.

## 3. Data Flow Summary

1.  The **UI (Renderer Process)** needs to perform an action, such as opening the settings window.
2.  It calls the corresponding function on the `window.logMonitorApi` object (e.g., `window.logMonitorApi.openSettingsWindow()`).
3.  The **Preload Script** sends an IPC message to the main process on the `open-settings-window` channel.
4.  The **IPC Handler** in `ipc-handlers.ts` receives the message and calls the `createSettingsWindow()` function in the `window-manager.ts` module.
5.  The main process can also send messages to the renderer process to notify it of events, such as a change in the authentication status. The renderer process listens for these messages using the `on...` functions exposed by the preload script.
