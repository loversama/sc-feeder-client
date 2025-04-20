import Store from 'electron-store';
import * as logger from './logger';
import { ipcMain, BrowserWindow } from 'electron'; // Import BrowserWindow
import os from 'node:os'; // Import os module for hostname
import { v4 as uuidv4 } from 'uuid';
import { connectToServer, disconnectFromServer } from './server-connection'; // Import connection functions

const MODULE_NAME = 'AuthManager';
import { SERVER_API_URL } from './server-config';

// Secure storage for refresh token
const store = new Store({ name: 'auth-state' }); // Use a separate store file

// In-memory storage for access token (cleared on app quit)
let accessToken: string | null = null;
let loggedInUser: { userId: string; username: string } | null = null;
let guestToken: string | null = null; // In-memory storage for guest token

// Exported function to set guest token
export function setGuestToken(token: string): void {
  guestToken = token;
}

// Exported function to clear guest token
export function clearGuestToken(): void {
  guestToken = null;
}
let clientId: string | null = null; // Persisted client ID

// --- Helper Functions ---

async function storeTokens(access: string, refresh: string): Promise<void> {
    accessToken = access;
    try {
        // Use electron-store's encryption capabilities if needed (requires setup)
        store.set('refreshToken', refresh);
        logger.info(MODULE_NAME, 'Refresh token stored securely.');
    } catch (error) {
        logger.error(MODULE_NAME, 'Failed to store refresh token:', error);
        // Handle error appropriately, maybe clear access token too?
        accessToken = null;
    }
}

function getRefreshToken(): string | null {
    try {
        return store.get('refreshToken') as string | null;
    } catch (error) {
        logger.error(MODULE_NAME, 'Failed to retrieve refresh token:', error);
        return null;
    }
}

async function clearTokens(): Promise<void> {
    accessToken = null;
    loggedInUser = null;
    guestToken = null; // Clear guest token on clearTokens
    try {
        store.delete('refreshToken');
        logger.info(MODULE_NAME, 'Refresh token cleared.');
    } catch (error) {
        logger.error(MODULE_NAME, 'Failed to clear refresh token:', error);
    }
}

// Function to get/generate the persistent client ID (Exported)
// Moved here from server-connection.ts for better cohesion
export function getPersistedClientId(): string { // Added export
  if (clientId) {
    return clientId;
  }
  let storedId = store.get('clientId') as string | undefined;
  if (!storedId) {
    storedId = uuidv4();
    store.set('clientId', storedId);
    logger.info(MODULE_NAME, `Generated and stored new clientId: ${storedId}`);
  } else {
    logger.info(MODULE_NAME, `Retrieved stored clientId: ${storedId}`);
  }
  clientId = storedId ?? uuidv4(); // Fallback just in case store fails
  return clientId; // Add missing return statement
}

// Helper function to broadcast auth status changes to all renderer windows
function broadcastAuthStatusChange(): void {
  const status = getAuthStatus();
  logger.info(MODULE_NAME, `Broadcasting auth status change: isAuthenticated=${status.isAuthenticated}`);
  BrowserWindow.getAllWindows().forEach(window => {
    if (window && !window.isDestroyed() && window.webContents) {
      window.webContents.send('auth-status-changed', status);
    }
  });
  // This function should not return anything (void)
}


// --- Public API ---

export function getAccessToken(): string | null {
    // TODO: Check expiry of access token here? Requires decoding JWT.
    // For simplicity now, just return it if it exists.
    return accessToken;
}

export function getGuestToken(): string | null {
    // TODO: Check expiry? Guest tokens are short-lived.
    return guestToken;
}

export function getAuthStatus(): { isAuthenticated: boolean; username: string | null; userId: string | null } {
    return {
        isAuthenticated: !!accessToken && !!loggedInUser,
        username: loggedInUser?.username ?? null,
        userId: loggedInUser?.userId ?? null,
    };
}

export async function login(identifier: string, password: string): Promise<{ success: boolean; error?: string }> {
    logger.info(MODULE_NAME, `Attempting login for identifier: ${identifier}`); // Use info
    try {
        // Use fetch or a dedicated HTTP client library (like axios)
        const response = await fetch(`${SERVER_API_URL}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ identifier, password }),
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ message: 'Login failed with status: ' + response.status }));
            logger.error(MODULE_NAME, `Login API request failed (${response.status}):`, errorData.message || response.statusText);
            return { success: false, error: errorData.message || `Login failed (${response.status})` };
        }

        const data = await response.json();
        logger.debug(MODULE_NAME, 'Received login response data:', JSON.stringify(data)); // Log the received data

        if (data.access_token) {
             // TODO: Need refresh token from server (e.g., in body or separate mechanism if cookie fails for Electron)
             // Assuming for now server returns both in body for client login
             const tempRefreshToken = data.refresh_token; // *** TEMPORARY ASSUMPTION ***
             if (!tempRefreshToken) {
                 logger.error(MODULE_NAME, 'Refresh token missing from login response.');
                 return { success: false, error: 'Server login response incomplete.' };
             }

             await storeTokens(data.access_token, tempRefreshToken);
             guestToken = null; // Clear guest token on successful user login

             // REMOVED: Client-side decoding of access token.
             // The client should trust the server's response or use a profile endpoint.
             // We need the user object from the server response directly.
             if (data.user && data.user.id && data.user.username) {
                 loggedInUser = { userId: data.user.id, username: data.user.username };
                 logger.info(MODULE_NAME, `Login successful for ${loggedInUser.username} (ID: ${loggedInUser.userId}) from server response.`);
             } else {
                 logger.error(MODULE_NAME, 'User info missing from login response data.');
                 await clearTokens(); // Clear potentially bad state
                 return { success: false, error: 'Server login response incomplete (missing user info).' };
             }
             // Force reconnect after successful login
             disconnectFromServer();
             connectToServer();
             broadcastAuthStatusChange(); // Broadcast change after successful login
             return { success: true };
        } else {
            logger.error(MODULE_NAME, 'Access token missing from login response.');
            return { success: false, error: 'Server login response invalid.' };
        }

    } catch (error: any) {
        logger.error(MODULE_NAME, 'Error during login API call:', error);
        return { success: false, error: error.message || 'Network or unexpected error during login.' };
    }
}

export async function logout(): Promise<boolean> {
    logger.info(MODULE_NAME, 'Attempting logout.'); // Use info
    const refreshToken = getRefreshToken();
    await clearTokens(); // Clear local tokens immediately
    disconnectFromServer(); // Disconnect after clearing tokens

    if (refreshToken) {
        try {
            // Call server to invalidate refresh token
            const response = await fetch(`${SERVER_API_URL}/api/auth/logout`, {
                method: 'POST',
                 headers: { 'Content-Type': 'application/json' },
                 // Need to send refresh token for server to invalidate correct one
                 body: JSON.stringify({ refreshToken: refreshToken }) // Send RT in body
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
    // Request a new guest token *before* reconnecting
    await requestAndStoreGuestToken();
    // Attempt to reconnect (should now use the new guest token)
    connectToServer();
    broadcastAuthStatusChange(); // Broadcast change after logout
    return true; // Logout considered successful locally even if server call fails
}

// Return user info on success, null on failure
export async function refreshToken(): Promise<{ userId: string; username: string } | null> {
     logger.info(MODULE_NAME, 'Attempting token refresh.'); // Use info
     const currentRefreshToken = getRefreshToken();
     if (!currentRefreshToken) {
         logger.warn(MODULE_NAME, 'No refresh token available for refresh attempt.');
         await clearTokens(); // Ensure logged out state
         return null;
     }

     try {
         const response = await fetch(`${SERVER_API_URL}/api/auth/refresh`, {
             method: 'POST',
             headers: { 'Content-Type': 'application/json' },
             body: JSON.stringify({ refreshToken: currentRefreshToken }) // Send RT in body
         });

         if (!response.ok) {
             const errorData = await response.json().catch(() => ({ message: 'Refresh failed with status: ' + response.status }));
             logger.error(MODULE_NAME, `Token refresh API request failed (${response.status}):`, errorData.message || response.statusText);
             await clearTokens(); // Log out if refresh fails
             return null;
         }

         const data = await response.json();
         if (data.access_token) {
             // TODO: Need new refresh token from server if rotation is enabled
             const newRefreshToken = data.refresh_token; // *** TEMPORARY ASSUMPTION ***
             if (!newRefreshToken) {
                  logger.error(MODULE_NAME, 'New refresh token missing from refresh response.');
                  await clearTokens();
                  return null;
             }
             await storeTokens(data.access_token, newRefreshToken);
             guestToken = null; // Clear guest token on successful user refresh
             // Decode new access token to update user info
             try {
                const decoded = JSON.parse(Buffer.from(data.access_token.split('.')[1], 'base64').toString());
                 if (decoded.sub && decoded.username) {
                    loggedInUser = { userId: decoded.sub, username: decoded.username };
                    logger.info(MODULE_NAME, `Tokens refreshed successfully for ${loggedInUser.username}`);
                 } else {
                     throw new Error('Invalid token payload structure');
                 }
             } catch (decodeError) {
                 logger.error(MODULE_NAME, 'Failed to decode access token after refresh:', decodeError);
                 await clearTokens(); // Clear state on decode error (includes guest token)
                 return null;
             }
             broadcastAuthStatusChange(); // Broadcast change after successful refresh
             return loggedInUser; // Return the user info object
         } else {
             logger.error(MODULE_NAME, 'Access token missing from refresh response.');
             // Ensure state is clear if no token found
             await clearTokens(); // This sets loggedInUser and guestToken to null
             return null;
         }

     } catch (error: any) {
         logger.error(MODULE_NAME, 'Error during token refresh API call:', error);
         await clearTokens(); // Log out on unexpected error (includes guest token)
         return null;
     }
}

// Request and store a guest token from the server
export async function requestAndStoreGuestToken(): Promise<boolean> {
    const currentClientId = getPersistedClientId();
    const currentHostname = os.hostname();
    logger.info(MODULE_NAME, `Requesting guest token for clientId: ${currentClientId}, hostname: ${currentHostname}`);

    try {
        const response = await fetch(`${SERVER_API_URL}/api/auth/register-guest`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ clientId: currentClientId, hostname: currentHostname }),
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ message: 'Guest registration failed with status: ' + response.status }));
            logger.error(MODULE_NAME, `Guest token request failed (${response.status}):`, errorData.message || response.statusText);
            guestToken = null; // Ensure guest token is null on failure
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


// --- IPC Handlers ---

export function registerAuthIpcHandlers(): void {
    ipcMain.handle('auth:login', async (_event, identifier, password) => {
        return await login(identifier, password);
    });

    // IPC handler simply calls logout, which handles getting the token
    ipcMain.handle('auth:logout', async () => {
        return await logout();
    });

    ipcMain.handle('auth:getStatus', () => {
        return getAuthStatus();
    });

    ipcMain.handle('auth:getAccessToken', () => {
         return getAccessToken();
    });

     ipcMain.handle('auth:refreshToken', async () => {
         return await refreshToken();
     });

    logger.info(MODULE_NAME, 'Registered auth IPC handlers.');
}

// --- Initialization ---
// Return true if ready to connect (has user or guest token), false otherwise
export async function initializeAuth(): Promise<boolean> {
    logger.info(MODULE_NAME, 'Initializing authentication state...');
    let connectionReady = false; // Flag to indicate if we have a token
    const existingRefreshToken = getRefreshToken();
    if (existingRefreshToken) {
        logger.info(MODULE_NAME, 'Existing refresh token found. Attempting refresh...');
        const refreshed = await refreshToken(); // Attempt to refresh
        if (refreshed) {
            // loggedInUser should be set by the refreshToken function now
            if (loggedInUser) {
                logger.info(MODULE_NAME, `Auth initialized successfully for ${loggedInUser.username} via refresh token.`);
                connectionReady = true; // Ready to connect as user
            } else {
                 logger.error(MODULE_NAME, 'Auth refresh reported success, but user info is missing.');
                 // connectionReady remains false
            }
        } else {
            logger.warn(MODULE_NAME, 'Failed to refresh token during initialization. User remains logged out.');
            // No return needed here, loggedInUser is already null
            // clearTokens() is called within refreshToken() on failure
        }
    } else {
        logger.info(MODULE_NAME, 'No existing refresh token found. User is logged out.');
        // Ensure state is clear if no token found
        await clearTokens(); // Ensure user tokens are cleared
        // Attempt to get a guest token if logged out
        const guestTokenObtained = await requestAndStoreGuestToken();
        connectionReady = guestTokenObtained; // Ready to connect if guest token obtained
    }
    return connectionReady; // Return the status
}