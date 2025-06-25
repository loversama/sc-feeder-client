
# Authentication

This document provides a detailed explanation of the authentication system in the `log-monitor-client`. It covers user and guest authentication, token management, and the process of sharing authentication state with the webview.

## 1. Token Management

The authentication system uses two types of tokens:

*   **Access Token:** A short-lived token that is used to authenticate requests to the `log-monitor-server`. It is stored in-memory and is cleared when the application quits.
*   **Refresh Token:** A long-lived token that is used to obtain a new access token when the current one expires. It is securely stored on the user's machine using `electron-store`.

### Token Storage

*   **`accessToken`**: Stored in a local variable in the `auth-manager.ts` module.
*   **`refreshToken`**: Stored in a separate `auth-state.json` file in the application's user data directory, managed by `electron-store`.

## 2. Authentication Flow

The `auth-manager.ts` module handles the entire authentication flow, from initial startup to user login and logout.

### a. Initialization (`initializeAuth()`)

1.  On application startup, the `initializeAuth()` function is called.
2.  It checks for an existing refresh token in `electron-store`.
3.  If a refresh token is found, it calls the `refreshToken()` function to obtain a new access token and user profile from the server.
4.  If no refresh token is found, or if the refresh fails, it calls the `requestAndStoreGuestToken()` function to obtain a guest token from the server.

### b. User Login (`login()`)

1.  The user enters their credentials in the `LoginPopup.vue` component, which triggers the `auth:login` IPC event.
2.  The `login()` function in `auth-manager.ts` sends a POST request to the `/api/auth/login` endpoint on the `log-monitor-server`.
3.  If the login is successful, the server returns an access token, a refresh token, and the user's profile.
4.  The `storeTokensAndUser()` function is called to store the tokens and user profile.
5.  The `broadcastAuthStatusChange()` function is called to notify all windows and webviews of the authentication state change.

### c. Guest Mode

If the user chooses to continue as a guest, or if the initial token refresh fails, the `requestAndStoreGuestToken()` function is called. This function sends a POST request to the `/api/auth/register-guest` endpoint to obtain a guest token, which is then stored in-memory.

### d. Logout (`logout()`)

1.  When the user logs out, the `logout()` function is called.
2.  It calls `clearAllTokensAndUser()` to clear the access token, refresh token, and user profile from memory and `electron-store`.
3.  It sends a POST request to the `/api/auth/logout` endpoint to invalidate the refresh token on the server.
4.  It then requests a new guest token to ensure the client can still communicate with the server for public data.

## 3. Webview Authentication

A key feature of the application is the seamless authentication between the Electron client and the embedded webview that displays the `log-monitor-web` application.

### a. `broadcastAuthStatusChange()`

This function is the cornerstone of the webview authentication. Whenever the authentication state changes (login, logout, token refresh), it is called to broadcast the new state to all renderer processes.

### b. `webview-ready-for-token`

The `webview-preload.ts` script, which is injected into the webview, sends a `webview-ready-for-token` IPC message to the main process when the webview content has loaded.

### c. `auth-tokens-updated`

In response to both `broadcastAuthStatusChange` and `webview-ready-for-token`, the `auth-manager.ts` module sends an `auth-tokens-updated` IPC message to the webview. This message contains the current access token, refresh token, and user profile.

The `webview-preload.ts` script listens for this message and stores the received tokens in the webview's `localStorage`. The `log-monitor-web` application can then use these tokens to make authenticated API requests to the `log-monitor-server`.
