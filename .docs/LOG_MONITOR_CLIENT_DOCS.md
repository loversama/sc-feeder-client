
# Log Monitor Client Documentation

## 1. High-Level Overview

### Purpose

The **Log Monitor Client** is a desktop application designed for Star Citizen players. Its primary purpose is to provide a real-time kill feed and detailed statistical analysis by actively monitoring the game's log files. It captures in-game events, such as kills, deaths, and vehicle destructions, and presents them in a user-friendly interface.

### Design Philosophy

The application is modeled after the **Steam client**, combining a native desktop experience with integrated web content. This hybrid approach allows for a persistent, responsive interface for core features like the kill feed, while leveraging the flexibility of web technology for dynamic, data-driven content like user profiles and leaderboards. The client provides a seamless experience, where users can log in once and have their credentials automatically shared with the integrated web views.

### Aesthetic

The client features a **dark, modern UI** designed to be easy on the eyes and fit in with a gaming-centric desktop environment. The color palette is dominated by dark grays and charcoals, with accents of blue and red to highlight important information and actions. The typography is clean and readable, and the overall layout is designed to be intuitive and uncluttered.

#### Color Scheme

The application's color scheme is defined in `log-monitor-web/assets/css/design-system.css`. The key colors are:

*   **Background & Surface Colors**
    *   `--color-background`: #0A0A0A (Deep black background)
    *   `--color-surface`: #111111 (Elevated surface)
    *   `--color-surface-secondary`: #1A1A1A (Secondary surface)
*   **Text Colors**
    *   `--color-text-primary`: #FFFFFF (Primary text - pure white)
    *   `--color-text-secondary`: #A1A1AA (Secondary text)
*   **Accent Colors**
    *   `--color-accent`: #E4E4E7 (Primary accent)
    *   `--color-accent-hover`: #D4D4D8 (Accent hover)
*   **Status Colors**
    *   `--color-success`: #10B981 (Success)
    *   `--color-warning`: #F59E0B (Warning)
    *   `--color-danger`: #EF4444 (Danger/Error)

## 2. System Architecture

The SC-KillFeeder ecosystem consists of three main components:

*   **`log-monitor-client`**: The Electron-based desktop application that runs on the user's machine. It is responsible for monitoring the game logs, parsing events, and displaying the kill feed.
*   **`log-monitor-server`**: A backend server that receives event data from the client, stores it in a database, and provides an API for the web application.
*   **`log-monitor-web`**: A web application that displays user profiles, leaderboards, and other statistical information. This web application is loaded into a webview within the `log-monitor-client`.

### Data Flow

1.  The **`log-monitor-client`** watches the Star Citizen `Game.log` file for changes.
2.  When a new event is detected, the client's **`log-parser`** module processes the raw log line and converts it into a structured `KillEvent` object.
3.  The event is then sent to the **`log-monitor-server`** via a WebSocket connection for persistent storage.
4.  The event is also displayed in the client's real-time **kill feed**.
5.  When the user opens the **Profile** or **Leaderboard** pages, the client opens a new window containing a **webview** that loads the **`log-monitor-web`** application.
6.  The client injects the user's authentication token into the webview, allowing for a seamless, single-sign-on experience.

## 3. Core Features & Functionality

### Log Monitoring

The client uses the `chokidar` library to efficiently monitor the `Game.log` file for changes. It can detect when the file is updated, truncated, or replaced, and it will automatically adjust its reading position accordingly.

### Event Parsing

The `log-parser.ts` module contains a series of regular expressions that are used to identify and extract data from the raw log lines. It can parse a wide variety of events, including:

*   Player logins
*   Game session starts
*   Vehicle destructions (both soft and hard deaths)
*   Player deaths (corpse logs)
*   Detailed combat kills
*   Environmental deaths (e.g., suffocation, bleeding out)

### Authentication

The client supports both authenticated and guest users. The authentication flow is as follows:

1.  When the application starts, it checks for a stored refresh token.
2.  If a valid refresh token is found, it attempts to refresh the access token with the `log-monitor-server`.
3.  If no refresh token is found, or if the refresh fails, the user is presented with a login window.
4.  The user can either log in with their credentials or continue as a guest.
5.  If the user logs in, the client stores the access and refresh tokens. The access token is stored in-memory, while the refresh token is persisted in `electron-store` for future sessions.
6.  If the user continues as a guest, a guest token is requested from the server.

### Web Content Integration

The Profile and Leaderboard pages are loaded into a `<webview>` tag within the `WebContentApp.vue` component. A dedicated preload script, `webview-preload.ts`, is injected into the webview's context. This script is responsible for:

*   Listening for `auth-tokens-updated` messages from the main process.
*   Storing the received tokens in the webview's `localStorage`.
*   Notifying the web application that it has been authenticated.

This mechanism allows the `log-monitor-web` application to make authenticated API requests to the `log-monitor-server` without requiring the user to log in again.

### Settings

The application's settings are managed in the `config-manager.ts` module and stored in a JSON file on the user's machine using `electron-store`. Users can configure a variety of options, including:

*   The path to the `Game.log` file
*   Notification preferences
*   Sound effect preferences
*   Whether to launch the application on startup

## 4. Technical Deep Dive

### Authentication Flow (Detailed)

The authentication system is managed by `auth-manager.ts`. It uses a combination of in-memory storage for the access token and `electron-store` for the refresh token. The `broadcastAuthStatusChange` function is the key to keeping the UI and webviews in sync with the user's authentication state. Whenever the auth state changes (e.g., login, logout, token refresh), this function is called to send an `auth-tokens-updated` IPC message to all windows and webviews.

The `webview-preload.ts` script, which is injected into the webview, listens for this message and stores the tokens in `localStorage`. This allows the `log-monitor-web` application to seamlessly authenticate with the `log-monitor-server`.

### IPC (Inter-Process Communication)

The application makes extensive use of Electron's IPC mechanism to communicate between the main process and the renderer processes. The `electron/preload.ts` script exposes a comprehensive API to the renderer process, allowing it to invoke main process modules and listen for events. The `ipc-handlers.ts` module registers the handlers for these IPC messages, providing a clear separation of concerns between the main process logic and the UI.

### State Management

State is managed in two places:

*   **Electron Main Process:** The `config-manager.ts` module uses `electron-store` to persist application settings and user preferences.
*   **Vue Renderer Process:** The application uses Vuex for managing the UI state. The `store/index.ts` file defines the Vuex store, which includes state for the user's profile, authentication status, and other UI-related data.

### Logging

The `logger.ts` module provides a simple but effective logging utility that uses the `chalk` library to color-code log messages based on their severity level. This makes it easy to identify and debug issues in the application. The logger is used throughout the main process modules to provide a detailed record of the application's activity.

## 5. Project Structure

*   `electron/`
    *   `main.ts`: The main entry point for the Electron application.
    *   `preload.ts`: The preload script for the main window, which exposes the IPC API to the renderer process.
    *   `webview-preload.ts`: The preload script for the webview, which handles authentication token injection.
    *   `modules/`: Contains the core backend logic for the application, including authentication, log parsing, and window management.
*   `src/`
    *   `main.ts`: The entry point for the Vue application.
    *   `App.vue`: The root Vue component.
    *   `components/`: Contains reusable Vue components, such as the kill feed and login popup.
    *   `pages/`: Contains the top-level Vue components for each page in the application.
    *   `router/`: Contains the Vue Router configuration.
    *   `store/`: Contains the Vuex store definition.
