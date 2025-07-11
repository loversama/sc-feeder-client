import Store from 'electron-store';
import * as logger from './logger';
import { ipcMain, BrowserWindow, webContents, safeStorage, session } from 'electron'; // Import BrowserWindow, webContents, safeStorage, and session
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
import { updateTrayMenu } from './tray-manager';
import { getSecureClientId } from './secure-client-id-manager';

const MODULE_NAME = 'AuthManager';
import { SERVER_API_URL } from './server-config';

// Secure storage for refresh token
const store = new Store({ name: 'auth-state' }); // Use a separate store file
logger.info(MODULE_NAME, `Auth store initialized at: ${store.path}`);

// Secure token storage utilities
function secureStoreRefreshToken(token: string): void {
    try {
        // Check if safeStorage is available at all
        if (typeof safeStorage === 'undefined') {
            logger.warn(MODULE_NAME, 'safeStorage is not available, storing refresh token in plain text');
            store.set('refreshToken', token);
            return;
        }
        
        if (safeStorage.isEncryptionAvailable()) {
            const encrypted = safeStorage.encryptString(token);
            logger.info(MODULE_NAME, `Encrypting token, result type: ${typeof encrypted}, is Buffer: ${Buffer.isBuffer(encrypted)}`);
            store.set('refreshToken', encrypted);
            logger.info(MODULE_NAME, 'Refresh token stored with encryption');
            
            // Verify we can decrypt it immediately
            try {
                const testDecrypt = safeStorage.decryptString(encrypted);
                logger.info(MODULE_NAME, 'Encryption verification successful');
            } catch (verifyError) {
                logger.error(MODULE_NAME, 'Encryption verification failed:', verifyError);
                // Fall back to plain text storage
                logger.warn(MODULE_NAME, 'Falling back to plain text storage');
                store.set('refreshToken', token);
            }
        } else {
            logger.warn(MODULE_NAME, 'Encryption not available, storing refresh token in plain text');
            store.set('refreshToken', token);
        }
    } catch (error) {
        logger.error(MODULE_NAME, 'Failed to store refresh token:', error);
        throw error;
    }
}

function secureGetRefreshToken(): string | null {
    try {
        const stored = store.get('refreshToken');
        logger.info(MODULE_NAME, `Checking stored refresh token: ${stored ? 'present' : 'not present'}`);
        if (!stored) return null;
        
        // Check if safeStorage is available at all
        if (typeof safeStorage === 'undefined') {
            logger.warn(MODULE_NAME, 'safeStorage is not available, returning stored value as-is');
            return stored as string;
        }
        
        const encryptionAvailable = safeStorage.isEncryptionAvailable();
        logger.info(MODULE_NAME, `Encryption available: ${encryptionAvailable}`);
        
        if (encryptionAvailable) {
            try {
                // Handle migration from plain text to encrypted
                if (typeof stored === 'string') {
                    // Plain text token - encrypt it and migrate
                    logger.info(MODULE_NAME, 'Migrating plain text refresh token to encrypted storage');
                    const encrypted = safeStorage.encryptString(stored);
                    store.set('refreshToken', encrypted);
                    logger.info(MODULE_NAME, 'Migration completed successfully');
                    return stored;
                } else {
                    // Encrypted token - decrypt it
                    logger.info(MODULE_NAME, 'Decrypting stored refresh token');
                    logger.info(MODULE_NAME, `Stored token type: ${typeof stored}, is Buffer: ${Buffer.isBuffer(stored)}`);
                    
                    // Ensure we have a proper Buffer
                    let tokenBuffer: Buffer;
                    if (Buffer.isBuffer(stored)) {
                        tokenBuffer = stored;
                    } else if (stored && typeof stored === 'object' && (stored as any).data) {
                        // Handle case where Buffer is serialized as object with data array
                        tokenBuffer = Buffer.from((stored as any).data);
                    } else {
                        logger.error(MODULE_NAME, 'Stored token is not a valid Buffer format');
                        store.delete('refreshToken');
                        return null;
                    }
                    
                    const decrypted = safeStorage.decryptString(tokenBuffer);
                    logger.info(MODULE_NAME, 'Decryption successful');
                    return decrypted;
                }
            } catch (decryptError: any) {
                logger.error(MODULE_NAME, 'Failed to decrypt refresh token, clearing stored token:', decryptError);
                logger.error(MODULE_NAME, 'Decryption error details:', {
                    message: decryptError?.message || 'Unknown error',
                    stack: decryptError?.stack || 'No stack trace',
                    storedType: typeof stored,
                    isBuffer: Buffer.isBuffer(stored),
                    storedValue: stored
                });
                store.delete('refreshToken');
                return null;
            }
        } else {
            // No encryption available, return plain text
            logger.info(MODULE_NAME, 'No encryption available, returning plain text token');
            return stored as string;
        }
    } catch (error) {
        logger.error(MODULE_NAME, 'Failed to retrieve refresh token:', error);
        return null;
    }
}

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
        secureStoreRefreshToken(refresh);
        logger.info(MODULE_NAME, 'Access and Refresh tokens stored. User profile updated.');
    } catch (error) {
        logger.error(MODULE_NAME, 'Failed to store refresh token:', error);
        accessToken = null; // Clear access token if refresh token storage fails
        loggedInUser = null;
    }
}

export function getRefreshTokenFromStore(): string | null {
    return secureGetRefreshToken();
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

// Comprehensive auth clearing function that clears all sessions and storage
export async function clearAllAuthDataComprehensive(): Promise<void> {
    logger.info(MODULE_NAME, 'Starting comprehensive auth data clearing...');
    
    // 1. Clear in-memory tokens and user data
    await clearAllTokensAndUser();
    
    // 2. Clear main session storage and cookies
    try {
        const defaultSession = session.defaultSession;
        await defaultSession.clearStorageData({
            storages: ['cookies', 'localstorage']
        });
        logger.info(MODULE_NAME, 'Cleared default session storage and cookies');
    } catch (error) {
        logger.error(MODULE_NAME, 'Failed to clear default session data:', error);
    }
    
    // 3. Clear all WebContentsView session partitions
    const sessionPartitions = [
        'persist:webcontents-auth',
        'persist:enhanced-webcontent', 
        'persist:embedded-webcontent'
    ];
    
    for (const partition of sessionPartitions) {
        try {
            const partitionSession = session.fromPartition(partition);
            await partitionSession.clearStorageData({
                storages: ['cookies', 'localstorage']
            });
            logger.info(MODULE_NAME, `Cleared ${partition} session data`);
            
            // Clear specific cookies for trusted domains
            const cookies = await partitionSession.cookies.get({});
            for (const cookie of cookies) {
                if (cookie.domain?.includes('voidlog.gg') || 
                    cookie.domain?.includes('.voidlog.gg') ||
                    cookie.domain?.includes('killfeed.sinfulshadows.com') ||
                    cookie.domain?.includes('localhost')) {
                    await partitionSession.cookies.remove(
                        `${cookie.secure ? 'https' : 'http'}://${cookie.domain}${cookie.path}`,
                        cookie.name
                    );
                }
            }
            
            // Also specifically clear the injected auth cookies by name
            const authCookieNames = ['access_token', 'refresh_token', 'user_data'];
            const trustedDomains = ['voidlog.gg', '.voidlog.gg', 'killfeed.sinfulshadows.com', 'localhost'];
            
            for (const domain of trustedDomains) {
                for (const cookieName of authCookieNames) {
                    try {
                        await partitionSession.cookies.remove(`https://${domain}/`, cookieName);
                        await partitionSession.cookies.remove(`http://${domain}/`, cookieName);
                    } catch (error) {
                        // Ignore errors for cookies that don't exist
                    }
                }
            }
            logger.info(MODULE_NAME, `Cleared ${partition} cookies for trusted domains`);
        } catch (error) {
            logger.error(MODULE_NAME, `Failed to clear ${partition} session data:`, error);
        }
    }
    
    // 4. Clear all webContents instances' session storage
    try {
        webContents.getAllWebContents().forEach(wc => {
            if (!wc.isDestroyed()) {
                // Execute JavaScript to clear sessionStorage and localStorage
                wc.executeJavaScript(`
                    try {
                        sessionStorage.clear();
                        localStorage.clear();
                        console.log('[AuthManager] Cleared web storage');
                    } catch (e) {
                        console.error('[AuthManager] Failed to clear web storage:', e);
                    }
                `).catch(err => {
                    logger.warn(MODULE_NAME, `Failed to clear storage for webContents ${wc.id}:`, err);
                });
            }
        });
        logger.info(MODULE_NAME, 'Cleared storage for all active webContents');
    } catch (error) {
        logger.error(MODULE_NAME, 'Failed to clear webContents storage:', error);
    }
    
    // 5. Notify all windows about logout
    try {
        BrowserWindow.getAllWindows().forEach(window => {
            if (!window.isDestroyed()) {
                window.webContents.send('auth-logout');
                window.webContents.send('auth-data-updated', {
                    accessToken: null,
                    refreshToken: null,
                    user: null,
                    isAuthenticated: false
                });
            }
        });
        logger.info(MODULE_NAME, 'Notified all windows about logout');
    } catch (error) {
        logger.error(MODULE_NAME, 'Failed to notify windows about logout:', error);
    }
    
    logger.info(MODULE_NAME, 'Comprehensive auth data clearing completed');
}

// Function to get/generate the persistent client ID (Exported)
// Maintains synchronous interface for backward compatibility
export function getPersistedClientId(): string {
  if (clientId) {
    return clientId;
  }
  
  // Fallback to legacy electron-store implementation for immediate availability
  // The secure initialization will happen asynchronously and update this cache
  let storedId: string | undefined;
  try {
    storedId = store.get('clientId') as string | undefined;
    if (storedId) {
      logger.debug(MODULE_NAME, `Retrieved stored clientId from electron-store (fallback)`);
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

// Initialize secure client ID storage asynchronously
// This will run in the background and update the cache when ready
export async function initializeSecureClientId(): Promise<void> {
  try {
    logger.info(MODULE_NAME, 'Initializing secure client ID storage...');
    const secureClientId = await getSecureClientId();
    
    // Update the memory cache with the secure client ID
    if (secureClientId !== clientId) {
      logger.info(MODULE_NAME, 'Updating client ID cache with secure storage value');
      clientId = secureClientId;
      
      // Ensure electron-store is synchronized
      try {
        store.set('clientId', secureClientId);
      } catch (error) {
        logger.warn(MODULE_NAME, 'Failed to sync client ID to electron-store:', error);
      }
    }
    
    logger.info(MODULE_NAME, 'Secure client ID initialization completed');
  } catch (error) {
    logger.error(MODULE_NAME, 'Failed to initialize secure client ID:', error);
    // Fallback: ensure we have a valid client ID from legacy storage
    if (!clientId) {
      getPersistedClientId();
    }
  }
}

// Async version for contexts that can use secure storage directly
export async function getPersistedClientIdSecure(): Promise<string> {
  try {
    const secureClientId = await getSecureClientId();
    
    // Update memory cache
    clientId = secureClientId;
    
    return secureClientId;
  } catch (error) {
    logger.error(MODULE_NAME, 'Failed to get secure client ID, falling back to legacy storage:', error);
    return getPersistedClientId();
  }
}

// Diagnostic function to check client ID storage status
export async function getClientIdStorageStatus(): Promise<{
  currentClientId: string;
  storageStatus: {
    hasSecureStorage: boolean;
    hasElectronStore: boolean;
    hasValidation: boolean;
    isEncryptionAvailable: boolean;
    lastValidationTime: number | null;
  };
}> {
  const { SecureClientIdManager } = await import('./secure-client-id-manager');
  const manager = SecureClientIdManager.getInstance();
  
  return {
    currentClientId: getPersistedClientId(),
    storageStatus: await manager.getStorageStatus()
  };
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

  // Also send to WebContentsView instances
  webContents.getAllWebContents().forEach(wc => {
    if (wc.getType() !== 'webview' && wc.getType() !== 'window' && !wc.isDestroyed()) {
      // Check if this WebContents belongs to a WebContentsView
      try {
        // Send auth tokens to WebContentsView content
        logger.info(MODULE_NAME, `Sending auth-tokens-updated to WebContentsView (ID: ${wc.id}) due to auth status change.`);
        wc.send('auth-tokens-updated', {
          accessToken: currentAccessToken,
          refreshToken: currentRefreshToken,
          user: currentUser
        });
      } catch (error) {
        logger.warn(MODULE_NAME, `Failed to send auth tokens to WebContentsView (ID: ${wc.id}):`, error);
      }
    }
  });

  // Emit internal event for WebContentsView auth manager
  ipcMain.emit('auth-status-changed-internal');
  
  // Update tray menu based on new authentication state
  try {
    updateTrayMenu();
  } catch (error) {
    logger.warn(MODULE_NAME, 'Failed to update tray menu:', error);
  }
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

export function getCurrentAuthTokens(): { accessToken?: string; refreshToken?: string; user?: typeof loggedInUser } | null {
    if (!accessToken) {
        return null;
    }
    return {
        accessToken: accessToken || undefined,
        refreshToken: getRefreshToken() || undefined,
        user: loggedInUser || undefined
    };
}

export async function login(identifier: string, password: string): Promise<{ success: boolean; error?: string }> {
    const hostname = os.hostname();
    const currentClientId = await getPersistedClientIdSecure();
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
    
    // Use comprehensive auth clearing instead of just clearAllTokensAndUser
    await clearAllAuthDataComprehensive();
    
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
    
    // Add a small delay to ensure all clearing operations complete
    await new Promise(resolve => setTimeout(resolve, 100));
    
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
    const currentClientId = await getPersistedClientIdSecure();
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

export async function setGuestModeAndRemember(): Promise<void> {
  logger.info(MODULE_NAME, 'Setting guest mode preference...');
  
  // Clear all auth data to ensure clean guest mode state
  await clearAllAuthDataComprehensive();
  
  setGuestModePreference(true);
  setHasShownInitialLogin(true);
  hasActiveSession = true; // Set active session flag for guest mode
  
  // Request guest token
  await requestAndStoreGuestToken();
  
  logger.info(MODULE_NAME, 'Guest mode preference set and remembered, auth data cleared');
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
// Store tokens from external source (like WebContentsView)
export async function storeTokens(tokens: {
    accessToken: string;
    refreshToken: string;
    user?: any;
}): Promise<{ success: boolean; error?: string }> {
    try {
        if (!tokens.accessToken || !tokens.refreshToken) {
            return { success: false, error: 'Missing required tokens' };
        }

        if (tokens.user && tokens.user.userId && tokens.user.username) {
            const userProfile = {
                userId: tokens.user.userId,
                username: tokens.user.username,
                rsiHandle: tokens.user.rsiHandle || null,
                rsiMoniker: tokens.user.rsiMoniker || null,
                avatar: tokens.user.avatar || null,
                roles: tokens.user.roles || ['user']
            };

            await storeTokensAndUser(tokens.accessToken, tokens.refreshToken, userProfile);
            guestToken = null;
            hasActiveSession = true;

            logger.info(MODULE_NAME, `Tokens stored successfully for user: ${userProfile.username}`);
            return { success: true };
        } else {
            return { success: false, error: 'Missing user data' };
        }
    } catch (error) {
        logger.error(MODULE_NAME, 'Failed to store tokens:', error);
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
}

export async function initializeAuth(): Promise<boolean> {
    logger.info(MODULE_NAME, 'Initializing authentication state...');
    
    // Initialize secure client ID storage first
    await initializeSecureClientId();
    
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