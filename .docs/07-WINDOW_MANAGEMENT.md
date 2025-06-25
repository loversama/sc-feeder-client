
# Window Management

This document explains how the `log-monitor-client` creates, manages, and persists the state of its various windows. The core logic for this is handled by the `window-manager.ts` module.

## 1. Window Types

The application uses several different types of windows, each with a specific purpose:

*   **Main Window:** The primary application window that displays the kill feed and other core UI elements.
*   **Login Window:** A modal window that is displayed on startup to allow the user to log in or continue as a guest.
*   **Settings Window:** A separate window for configuring the application's settings.
*   **Web Content Window:** A window that contains a `<webview>` tag to display the `log-monitor-web` application for features like user profiles and leaderboards.
*   **Event Details Window:** A window that displays detailed information about a specific kill event.

## 2. Window Creation

The `window-manager.ts` module provides a set of functions for creating each type of window (e.g., `createMainWindow()`, `createSettingsWindow()`). These functions are responsible for:

*   **Window Options:** Defining the size, position, and other properties of the window.
*   **Preload Scripts:** Specifying the correct preload script to be injected into the window's web contents. This is crucial for IPC communication and webview authentication.
*   **Loading Content:** Loading the correct HTML file or URL into the window. In development, the windows load content from the Vite dev server, while in production, they load the built HTML files.

## 3. Window State Persistence

The application uses `electron-store` to persist the size and position of each window. This ensures that the windows are restored to their previous state when the application is restarted.

*   **`createSaveBoundsHandler()`**: This function creates a debounced event handler that saves the window's bounds to the store whenever the window is moved or resized.
*   **Bounds Restoration**: When a window is created, the `window-manager` checks for saved bounds in the store and applies them if they exist and are within the visible screen area.

## 4. Web Content and Webview

The `createWebContentWindow()` function is responsible for creating the window that hosts the `log-monitor-web` application. This window is unique because it contains a `<webview>` tag, which is enabled via the `webviewTag: true` webPreference.

### a. Preload Script for Webview

The `webContentWindow` is created with a special preload script, `webview-preload.ts`. This script is essential for the seamless authentication between the client and the web application. It listens for authentication tokens from the main process and stores them in the webview's `localStorage`.

### b. Dynamic Content Loading

The `createWebContentWindow()` function can accept a `section` parameter (e.g., 'profile', 'leaderboard'). This parameter is used to append a hash to the URL, allowing the `log-monitor-web` application to navigate to the correct page on load.

## 5. Custom Title Bar

The application uses the `custom-electron-titlebar` library to create a custom title bar for its windows. This allows for a more modern and consistent look and feel across all platforms.
