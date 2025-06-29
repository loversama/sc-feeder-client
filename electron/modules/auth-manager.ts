import Store from 'electron-store';
import * as logger from './logger';
import { ipcMain, BrowserWindow, webContents } from 'electron'; // Import BrowserWindow and webContents
import os from 'node:os'; // Import os module for hostname
import { v4 as uuidv4 } from 'uuid';
import { connectToServer, disconnectFromServer } from './server-connection'; // Import connection functions
import { getDetailedUserAgent } from './app-lifecycle';
import {
  getGuestModePreference,
  setGuestModePreference,
  clearGuestModePreference,
  setHasShownInitialLogin
} from './config-manager';

const MODULE_NAME = 'AuthManager';
import { SERVER_API_URL } from './server-config';

// Secure storage for refresh token
const store = new Store({ name: 'auth-state' }); // Use a separate store file

// In-memory storage for access token (cleared on app quit)
let accessToken: string | null = null;
// Updated type to include full profile data including roles
let loggedInUser: { userId: string; username: string; rsiHandle: string | null; rsiMoniker: string | null; avatar: string | null; roles: string[] } | null = null;
let guestToken: string | null = null; // In-memory storage for guest token
// Track if user has an active authenticated session (not just stored tokens)
let hasActiveSession: boolean = false;

// Exported function to set guest token
export function setGuestToken(token: string): void {
  guestToken = token;
}

// Exported function to clear guest token
export function clearGuestToken(): void {
  guestToken = null;
}

// Exported function to check if there's an active session
export function hasActiveAuthSession(): boolean {
  return hasActiveSession;
}

let clientId: string | null = null; // Persisted client ID

// --- Helper Functions ---

async function storeTokensAndUser(
    access: string,
    refresh: string,
    user: { userId: string; username: string; rsiHandle: string | null; rsiMoniker: string | null; avatar: string | null; roles: string[] } | null
): Promise<void> {
    accessToken = access;
    loggedInUser = user;
    try {
        store.set('refreshToken', refresh);
        logger.info(MODULE_NAME, 'Access and Refresh tokens stored. User profile updated.');
    } catch (error) {
        logger.error(MODULE_NAME, 'Failed to store refresh token:', error);
        accessToken = null; // Clear access token if refresh token storage fails
        loggedInUser = null;
    }
}

export function getRefreshTokenFromStore(): string | null {
    try {
        return store.get('refreshToken') as string | null;
    } catch (error) {
        logger.error(MODULE_NAME, 'Failed to retrieve refresh token:', error);
        return null;
    }
}

async function clearAllTokensAndUser(): Promise<void> {
    accessToken = null;
    loggedInUser = null;
    guestToken = null;
    try {
        store.delete('refreshToken');
        logger.info(MODULE_NAME, 'All tokens and user data cleared.');
    } catch (error) {
        logger.error(MODULE_NAME, 'Failed to clear refresh token from store:', error);
    }
}

// Function to get/generate the persistent client ID (Exported)
export function getPersistedClientId(): string {
  if (clientId) {
    return clientId;
  }
  let storedId: string | undefined;
  try {
    storedId = store.get('clientId') as string | undefined;
    if (storedId) {
      logger.info(MODULE_NAME, `Retrieved stored clientId: ${storedId}`);
    }
  } catch (error) {
    logger.error(MODULE_NAME, 'Error reading clientId from store:', error);
    storedId = undefined;
  }

  if (!storedId) {
    const newClientId = uuidv4();
    try {
      store.set('clientId', newClientId);
      logger.info(MODULE_NAME, `Generated and stored new clientId: ${newClientId}`);
      storedId = newClientId;
    } catch (error) {
      logger.error(MODULE_NAME, 'Error writing new clientId to store:', error);
      storedId = newClientId;
      logger.warn(MODULE_NAME, `Using new clientId ${newClientId} for current session, but failed to persist it.`);
    }
  }
  clientId = storedId ?? uuidv4();
  return clientId;
}

// Helper function to broadcast auth status changes to all renderer windows
function broadcastAuthStatusChange(): void {
  const status = getAuthStatus();
  logger.info(MODULE_NAME, `Broadcasting auth status change: isAuthenticated=${status.isAuthenticated}`);
  const currentAccessToken = getAccessToken();
  const currentRefreshToken = getRefreshTokenFromStore(); // Get refresh token for webviews
  const currentUser = getLoggedInUser();

  BrowserWindow.getAllWindows().forEach(window => {
    if (window && !window.isDestroyed() && window.webContents) {
      window.webContents.send('auth-status-changed', status);

      webContents.getAllWebContents().forEach(wc => {
        if (wc.getType() === 'webview' && !wc.isDestroyed()) {
          const ownerWindow = BrowserWindow.fromWebContents(wc.hostWebContents || wc);
          if (ownerWindow) {
            logger.info(MODULE_NAME, `Sending auth-tokens-updated to webview (ID: ${wc.id}) due to auth status change.`);
            // Send both tokens and user profile
            wc.send('auth-tokens-updated', {
              accessToken: currentAccessToken,
              refreshToken: currentRefreshToken,
              user: currentUser
            });
          }
        }
      });
    }
  });
}


// --- Public API ---

export function getAccessToken(): string | null {
    return accessToken;
}

export function getRefreshToken(): string | null { // Renamed for clarity from getRefreshTokenFromStore for export
    return getRefreshTokenFromStore();
}

export function getGuestToken(): string | null {
    return guestToken;
}

export function getAuthStatus(): { isAuthenticated: boolean; username: string | null; userId: string | null } {
    return {
        isAuthenticated: !!accessToken && !!loggedInUser,
        username: loggedInUser?.username ?? null,
        userId: loggedInUser?.userId ?? null,
    };
}

export function getLoggedInUser(): typeof loggedInUser {
    return loggedInUser;
}

export async function login(identifier: string, password: string): Promise<{ success: boolean; error?: string }> {
    const hostname = os.hostname();
    const currentClientId = getPersistedClientId();
    logger.info(MODULE_NAME, `Attempting login for identifier: ${identifier} from hostname: ${hostname}, clientId: ${currentClientId}`);
    
    // Add small delay to ensure all modules are properly initialized
    await new Promise(resolve => setTimeout(resolve, 100));
    try {
        const response = await fetch(`${SERVER_API_URL}/api/auth/login`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': getDetailedUserAgent(),
            },
            body: JSON.stringify({ identifier, password, hostname, clientId: currentClientId }),
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ message: 'Login failed with status: ' + response.status }));
            logger.error(MODULE_NAME, `Login API request failed (${response.status}):`, errorData.message || response.statusText);
            return { success: false, error: errorData.message || `Login failed (${response.status})` };
        }

        const data = await response.json();
        logger.info(MODULE_NAME, 'Received login response data with the following structure:');
        logger.info(MODULE_NAME, `- access_token: ${data.access_token ? 'present' : 'missing'}`);
        logger.info(MODULE_NAME, `- refresh_token: ${data.refresh_token ? 'present' : 'missing'}`);
        logger.info(MODULE_NAME, `- user object: ${data.user ? 'present' : 'missing'}`);
        if (data.user) {
            logger.info(MODULE_NAME, `- user.id: ${data.user.id || 'missing'}`);
            logger.info(MODULE_NAME, `- user.username: ${data.user.username || 'missing'}`);
            logger.info(MODULE_NAME, `- user.rsiHandle: ${data.user.rsiHandle || 'null'}`);
            logger.info(MODULE_NAME, `- user.rsiMoniker: ${data.user.rsiMoniker || 'null'}`);
            logger.info(MODULE_NAME, `- user.avatar: ${data.user.avatar ? 'present' : 'null'}`);
            logger.info(MODULE_NAME, `- user.roles: [${data.user.roles ? data.user.roles.join(', ') : 'missing'}]`);
        }

        if (data.access_token && data.refresh_token && data.user && data.user.id && data.user.username) {
            const userProfile = {
                userId: data.user.id,
                username: data.user.username,
                rsiHandle: data.user.rsiHandle || null,
                rsiMoniker: data.user.rsiMoniker || null,
                avatar: data.user.avatar || null,
                roles: data.user.roles || ['user'], // Default to 'user' role if not provided
            };
            await storeTokensAndUser(data.access_token, data.refresh_token, userProfile);
            guestToken = null;
            hasActiveSession = true; // Set active session flag
            
            // Clear guest preference when user successfully logs in
            clearGuestModePreference();
            setHasShownInitialLogin(true);

            logger.info(MODULE_NAME, `Login successful for ${userProfile.username} (ID: ${userProfile.userId}).`);
            disconnectFromServer();
            connectToServer();
            broadcastAuthStatusChange();
            return { success: true };
        } else {
            logger.error(MODULE_NAME, 'Login response missing tokens or user info.');
            return { success: false, error: 'Server login response incomplete.' };
        }

    } catch (error: any) {
        logger.error(MODULE_NAME, 'Error during login API call:', {
            message: error?.message || 'No error message',
            name: error?.name || 'Unknown error type',
            stack: error?.stack || 'No stack trace',
            errorObject: error
        });
        return { success: false, error: error?.message || 'Network or unexpected error during login.' };
    }
}

export async function logout(): Promise<boolean> {
    logger.info(MODULE_NAME, 'Attempting logout.');
    const currentRefreshToken = getRefreshTokenFromStore();
    await clearAllTokensAndUser();
    disconnectFromServer();
    hasActiveSession = false; // Clear active session flag
    
    // Clear guest preference to force login popup on next launch
    clearGuestModePreference();

    if (currentRefreshToken) {
        try {
            const response = await fetch(`${SERVER_API_URL}/api/auth/logout`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'User-Agent': getDetailedUserAgent(),
                },
                body: JSON.stringify({ refreshToken: currentRefreshToken })
            });
            if (!response.ok) {
                logger.warn(MODULE_NAME, `Server logout endpoint failed (${response.status}), but tokens cleared locally.`);
            } else {
                logger.info(MODULE_NAME, 'Server confirmed logout.');
            }
        } catch (error: any) {
            logger.warn(MODULE_NAME, 'Error calling server logout endpoint:', error.message);
        }
    }
    await requestAndStoreGuestToken();
    connectToServer();
    broadcastAuthStatusChange();
    return true;
}

export async function refreshToken(): Promise<{ userId: string; username: string; rsiHandle: string | null; rsiMoniker: string | null; avatar: string | null; roles: string[] } | null> {
     logger.info(MODULE_NAME, 'Attempting token refresh.');
     const currentRefreshToken = getRefreshTokenFromStore();
     if (!currentRefreshToken) {
         logger.warn(MODULE_NAME, 'No refresh token available for refresh attempt.');
         await clearAllTokensAndUser();
         return null;
     }

     try {
         const response = await fetch(`${SERVER_API_URL}/api/auth/refresh`, {
             method: 'POST',
             headers: {
                 'Content-Type': 'application/json',
                 'User-Agent': getDetailedUserAgent(),
             },
             body: JSON.stringify({ refreshToken: currentRefreshToken })
         });

         if (!response.ok) {
             const errorData = await response.json().catch(() => ({ message: 'Refresh failed with status: ' + response.status }));
             logger.error(MODULE_NAME, `Token refresh API request failed (${response.status}):`, errorData.message || response.statusText);
             await clearAllTokensAndUser();
             broadcastAuthStatusChange(); // Broadcast after clearing tokens on failed refresh
             return null;
         }

         const data = await response.json();
         logger.info(MODULE_NAME, 'Received token refresh response data with the following structure:');
         logger.info(MODULE_NAME, `- access_token: ${data.access_token ? 'present' : 'missing'}`);
         logger.info(MODULE_NAME, `- refresh_token: ${data.refresh_token ? 'present' : 'missing'}`);
         logger.info(MODULE_NAME, `- user object: ${data.user ? 'present' : 'missing'}`);
         if (data.user) {
             logger.info(MODULE_NAME, `- user.id: ${data.user.id || 'missing'}`);
             logger.info(MODULE_NAME, `- user.username: ${data.user.username || 'missing'}`);
             logger.info(MODULE_NAME, `- user.rsiHandle: ${data.user.rsiHandle || 'null'}`);
             logger.info(MODULE_NAME, `- user.rsiMoniker: ${data.user.rsiMoniker || 'null'}`);
             logger.info(MODULE_NAME, `- user.avatar: ${data.user.avatar ? 'present' : 'null'}`);
             logger.info(MODULE_NAME, `- user.roles: [${data.user.roles ? data.user.roles.join(', ') : 'missing'}]`);
         }
         
         // Expecting new access_token, new refresh_token, and full user object from refresh
         if (data.access_token && data.refresh_token && data.user && data.user.id && data.user.username) {
             const userProfile = {
                 userId: data.user.id,
                 username: data.user.username,
                 rsiHandle: data.user.rsiHandle || null,
                 rsiMoniker: data.user.rsiMoniker || null,
                 avatar: data.user.avatar || null,
                 roles: data.user.roles || ['user'], // Default to 'user' role if not provided
             };
             await storeTokensAndUser(data.access_token, data.refresh_token, userProfile);
             guestToken = null;
             logger.info(MODULE_NAME, `Tokens refreshed successfully for ${userProfile.username}`);
             broadcastAuthStatusChange();
             // Reconnect WebSocket if it was disconnected due to token expiry
             // connectToServer(); // Consider if this is always needed or if server-connection handles it
             return userProfile;
         } else {
             logger.error(MODULE_NAME, 'Refresh response missing tokens or user info.');
             await clearAllTokensAndUser();
             broadcastAuthStatusChange();
             return null;
         }

     } catch (error: any) {
         logger.error(MODULE_NAME, 'Error during token refresh API call:', error);
         await clearAllTokensAndUser();
         broadcastAuthStatusChange();
         return null;
     }
}

export async function requestAndStoreGuestToken(): Promise<boolean> {
    const currentClientId = getPersistedClientId();
    const currentHostname = os.hostname();
    logger.info(MODULE_NAME, `Requesting guest token for clientId: ${currentClientId}, hostname: ${currentHostname}`);

    try {
        const response = await fetch(`${SERVER_API_URL}/api/auth/register-guest`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': getDetailedUserAgent(),
            },
            body: JSON.stringify({ clientId: currentClientId, hostname: currentHostname }),
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ message: 'Guest registration failed with status: ' + response.status }));
            logger.error(MODULE_NAME, `Guest token request failed (${response.status}):`, errorData.message || response.statusText);
            guestToken = null;
            return false;
        }

        const data = await response.json();
        if (data.guestToken && typeof data.guestToken === 'string') {
            guestToken = data.guestToken;
            logger.info(MODULE_NAME, 'Successfully obtained and stored guest token.');
            return true;
        } else {
            logger.error(MODULE_NAME, 'Guest token missing or invalid in server response.');
            guestToken = null;
            return false;
        }
    } catch (error: any) {
        logger.error(MODULE_NAME, 'Error during guest token request API call:', error);
        guestToken = null;
        return false;
    }
}

export function setGuestModeAndRemember(): void {
  setGuestModePreference(true);
  setHasShownInitialLogin(true);
  hasActiveSession = true; // Set active session flag for guest mode
  logger.info(MODULE_NAME, 'Guest mode preference set and remembered');
}


// --- IPC Handlers ---

export function registerAuthIpcHandlers(): void {
    ipcMain.handle('auth:login', async (_event, identifier, password) => {
        try {
            return await login(identifier, password);
        } catch (error: any) {
            logger.error(MODULE_NAME, 'Unhandled error in login IPC handler:', {
                message: error?.message || 'No error message',
                name: error?.name || 'Unknown error type',
                stack: error?.stack || 'No stack trace',
                errorObject: error
            });
            return { success: false, error: error?.message || 'Unexpected error during login' };
        }
    });

    ipcMain.handle('auth:logout', async () => {
        return await logout();
    });

    ipcMain.handle('auth:getStatus', () => {
        return getAuthStatus();
    });

    ipcMain.handle('auth:getAccessToken', () => { // Kept for compatibility if some parts only need access token
         return getAccessToken();
    });

    ipcMain.handle('auth:get-tokens', () => { // New handler for both tokens
        return {
            accessToken: getAccessToken(),
            refreshToken: getRefreshTokenFromStore()
        };
    });

    ipcMain.handle('auth:store-tokens', async (_event, tokens: { accessToken: string; refreshToken: string; user?: any }) => {
        logger.info(MODULE_NAME, 'Received tokens from renderer/webview to store.');
        if (tokens && tokens.accessToken && tokens.refreshToken) {
            // If user profile is also sent (e.g., from webview login), use it.
            // Otherwise, we might need to fetch it or assume it's already consistent.
            // For now, let's assume the user object structure matches `loggedInUser`.
            const userProfile = tokens.user ? {
                userId: tokens.user.userId || tokens.user.id, // Allow for different property names
                username: tokens.user.username,
                rsiHandle: tokens.user.rsiHandle || null,
                rsiMoniker: tokens.user.rsiMoniker || null,
                avatar: tokens.user.avatar || null,
                roles: tokens.user.roles || ['user'], // Default to 'user' role if not provided
            } : loggedInUser; // Fallback to existing if not provided

            if (userProfile && userProfile.userId && userProfile.username) {
                await storeTokensAndUser(tokens.accessToken, tokens.refreshToken, userProfile);
                guestToken = null; // Clear guest token if user tokens are stored
                hasActiveSession = true; // Set active session flag
                broadcastAuthStatusChange();
                return { success: true };
            } else {
                logger.error(MODULE_NAME, 'User profile data missing or invalid when storing tokens from renderer/webview.');
                return { success: false, error: 'User profile data invalid.' };
            }
        } else {
            logger.error(MODULE_NAME, 'Invalid token data received for auth:store-tokens.');
            return { success: false, error: 'Invalid token data.' };
        }
    });

    ipcMain.handle('auth:refreshToken', async () => {
         return await refreshToken();
     });

    logger.info(MODULE_NAME, 'Registered auth IPC handlers.');

    // Handle webview readiness to receive auth token (now sends both tokens)
    ipcMain.on('webview-ready-for-token', (event) => {
      const accessToken = getAccessToken();
      const refreshToken = getRefreshTokenFromStore();
      const user = getLoggedInUser();
      logger.info(MODULE_NAME, `Webview ready. Sending tokens (Access: ${!!accessToken}, Refresh: ${!!refreshToken}) and user to webview (ID: ${event.sender.id})`);
      event.sender.send('auth-tokens-updated', { accessToken, refreshToken, user }); // Use the same event 'auth-tokens-updated'
    });
}

// --- Initialization ---
export async function initializeAuth(): Promise<boolean> {
    logger.info(MODULE_NAME, 'Initializing authentication state...');
    let connectionReady = false;
    const existingRefreshToken = getRefreshTokenFromStore();

    if (existingRefreshToken) {
        logger.info(MODULE_NAME, 'Existing refresh token found. Attempting refresh...');
        const refreshedUserProfile = await refreshToken();
        if (refreshedUserProfile) {
            logger.info(MODULE_NAME, `Auth initialized successfully for ${refreshedUserProfile.username} via refresh token.`);
            hasActiveSession = true; // Set active session flag on successful refresh
            connectionReady = true;
        } else {
            logger.warn(MODULE_NAME, 'Failed to refresh token during initialization. User remains logged out.');
            hasActiveSession = false; // Clear active session flag
            // clearAllTokensAndUser() is called within refreshToken() on failure.
            // Attempt to get a guest token if refresh failed and user is effectively logged out.
            const guestTokenObtained = await requestAndStoreGuestToken();
            connectionReady = guestTokenObtained;
        }
    } else {
        logger.info(MODULE_NAME, 'No existing refresh token found. User is logged out.');
        await clearAllTokensAndUser();
        hasActiveSession = false; // Clear active session flag
        const guestTokenObtained = await requestAndStoreGuestToken();
        connectionReady = guestTokenObtained;
    }
    broadcastAuthStatusChange(); // Ensure status is broadcast after initialization
    return connectionReady;
}