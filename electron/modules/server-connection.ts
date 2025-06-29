import EventEmitter from 'events';
import { io, Socket } from 'socket.io-client';
import * as logger from './logger';
import os from 'node:os'; // Import os module for hostname
// Import refreshToken along with other auth functions
import { getAccessToken, getGuestToken, getPersistedClientId, refreshToken, setGuestToken, clearGuestToken, requestAndStoreGuestToken, getRefreshToken } from './auth-manager';
import { getMainWindow } from './window-manager'; // Import window manager to send messages
import { getDetailedUserAgent } from './app-lifecycle';
import type { KillEvent } from '../../shared/types';
// Client ID logic moved to auth-manager

const MODULE_NAME = 'ServerConnection';

// Determine server URL based on environment
import { SERVER_URL } from './server-config';

let socket: Socket | null = null;
let isAuthenticated = false; // Track authentication status
type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';
let currentStatus: ConnectionStatus = 'disconnected';

const connectionEvents = new EventEmitter();
// Custom Reconnection Logic State
const delays = [5000, 10000, 30000, 60000, 120000]; // Delays in ms
let reconnectionAttempt = 0;
let reconnectionTimeoutId: NodeJS.Timeout | null = null;

// Authentication Retry Logic State
let authRetryAttempt = 0;
let authRetryTimeoutId: NodeJS.Timeout | null = null;
let isRetryingAuth = false;
const authRetryDelays = [2000, 5000, 10000, 30000, 60000]; // Authentication retry delays in ms
 
// Helper function to send status updates to renderer
function sendConnectionStatus(status: ConnectionStatus) {
    if (status !== currentStatus) {
        logger.info(MODULE_NAME, `Connection status changed: ${currentStatus} -> ${status}`);
        currentStatus = status;
        getMainWindow()?.webContents.send('connection-status-changed', status);
    }
}
let logChunkBuffer: string[] = []; // Buffer for offline/unauthenticated chunks

// Function to attempt authentication when connected but not authenticated
async function attemptAuthentication(): Promise<void> {
  if (isRetryingAuth) {
    logger.debug(MODULE_NAME, 'Authentication retry already in progress, skipping.');
    return;
  }

  isRetryingAuth = true;
  logger.info(MODULE_NAME, 'Attempting authentication for connected but unauthenticated client...');

  try {
    const accessToken = getAccessToken();
    const refreshTokenAvailable = !!getRefreshToken();

    if (accessToken || refreshTokenAvailable) {
      // If we have tokens, try to refresh them
      logger.info(MODULE_NAME, 'Attempting token refresh for authentication...');
      const refreshedUserInfo = await refreshToken();
      
      if (refreshedUserInfo) {
        logger.info(MODULE_NAME, `Token refresh successful for ${refreshedUserInfo.username}. Reconnecting...`);
        // Disconnect and reconnect with new tokens
        disconnectFromServer();
        setTimeout(connectToServer, 500);
        return;
      } else {
        logger.warn(MODULE_NAME, 'Token refresh failed. Attempting guest registration...');
      }
    }

    // If no tokens or refresh failed, try guest registration
    logger.info(MODULE_NAME, 'Attempting guest token registration...');
    const guestTokenObtained = await requestAndStoreGuestToken();
    
    if (guestTokenObtained) {
      logger.info(MODULE_NAME, 'Guest token obtained. Reconnecting...');
      // Disconnect and reconnect with guest token
      disconnectFromServer();
      setTimeout(connectToServer, 500);
    } else {
      logger.error(MODULE_NAME, 'Failed to obtain guest token. Scheduling retry...');
      scheduleAuthRetry();
    }
  } catch (error: any) {
    logger.error(MODULE_NAME, 'Error during authentication attempt:', error.message);
    scheduleAuthRetry();
  } finally {
    isRetryingAuth = false;
  }
}

// Function to schedule authentication retry with backoff
function scheduleAuthRetry(): void {
  if (authRetryTimeoutId) {
    clearTimeout(authRetryTimeoutId);
  }

  const nextDelay = authRetryDelays[authRetryAttempt] ?? authRetryDelays[authRetryDelays.length - 1];
  logger.warn(MODULE_NAME, `Scheduling authentication retry attempt ${authRetryAttempt + 1} in ${nextDelay / 1000}s`);

  authRetryTimeoutId = setTimeout(() => {
    if (isConnected() && !isAuthenticated) {
      attemptAuthentication();
    }
    authRetryAttempt++;
  }, nextDelay);
}

// Function to reset authentication retry state
function resetAuthRetryState(): void {
  authRetryAttempt = 0;
  isRetryingAuth = false;
  if (authRetryTimeoutId) {
    clearTimeout(authRetryTimeoutId);
    authRetryTimeoutId = null;
  }
}

export function connectToServer(): void {
  // Determine which token to use for auth handshake
  const accessToken = getAccessToken();
  const guestToken = getGuestToken();
  const clientId = getPersistedClientId();
  const tokenType = accessToken
    ? 'User Access Token'
    : guestToken
    ? 'Guest Token'
    : 'No Token';

  // Don't reconnect if already connected with the same socket instance
  if (socket?.connected) {
    logger.warn(MODULE_NAME, 'Already connected to server.');
    return;
  }

  logger.info(
    MODULE_NAME,
    `Attempting to connect to server at ${SERVER_URL} (Env: ${process.env.NODE_ENV}) using ${tokenType}`,
  );
  sendConnectionStatus('connecting'); // Update status: Connecting

  // Disconnect previous socket if exists (e.g., if token changed)
  if (socket) {
    socket.disconnect();
    socket = null; // Ensure we create a new socket instance
  }

  // Prepare handshake options
  let handshakeAuth: any = {};
  const hostname = os.hostname(); // Get hostname
  let handshakeQuery: any = { hostname, userAgent: getDetailedUserAgent() }; // Add hostname to query

  if (accessToken) {
    handshakeAuth = { token: accessToken };
  } else if (guestToken) {
    handshakeAuth = { token: guestToken };
  }

  // ClientId should always be present, add it to the query regardless of token
  handshakeQuery.clientId = clientId;


  if (!accessToken && !guestToken && !clientId) { // Adjusted condition
    logger.warn(
      MODULE_NAME,
      'No access token, guest token, or clientId available. Cannot connect to server.',
    );
    return;
  }

  socket = io(SERVER_URL, {
    // path: '/api/socket.io/', // REMOVED: Use default path for default adapter
    reconnection: false, // Disable automatic reconnection
    // Removed reconnectionAttempts, reconnectionDelay, reconnectionDelayMax
    transports: ['websocket'],
    auth: handshakeAuth,
    query: handshakeQuery,
  });

  socket.on('connect', () => {
    const isReconnection = reconnectionAttempt > 0;
    logger.info(
      MODULE_NAME,
      `${isReconnection ? 'Reconnected' : 'Successfully connected'} to server: ${socket?.id}. Authentication handshake sent.`,
    );
    // Reset reconnection logic on successful connection
    if (reconnectionTimeoutId) {
        clearTimeout(reconnectionTimeoutId);
        reconnectionTimeoutId = null;
    }
    reconnectionAttempt = 0;
    logger.info(MODULE_NAME, 'Reconnection logic reset on successful connection.');
    // Emit event on successful connection/reconnection
    connectionEvents.emit(isReconnection ? 'reconnected' : 'connected');
    // No need to send authenticate_guest message; handled by handshake and guestToken event now.
  });
 
  // Listen for guestToken event from server and store it
  socket.on('guestToken', (data: { token: string }) => {
    if (data?.token) {
      logger.info(MODULE_NAME, 'Received guest token from server. Storing...');
      setGuestToken(data.token);
      disconnectFromServer();
      setTimeout(connectToServer, 100); // Reconnect with the new token
    }
  });

  // Listen for custom 'authenticated' event from server
  socket.on('authenticated', () => {
      // ---> ADDED DETAILED LOG <---
      logger.info(MODULE_NAME, `>>> Received 'authenticated' event from server for socket: ${socket?.id}. Setting isAuthenticated = true.`);
      isAuthenticated = true;
      resetAuthRetryState(); // Reset authentication retry state on successful auth
      sendConnectionStatus('connected'); // Update status: Connected (after auth confirmation)
      flushLogBuffer(); // Attempt to send any buffered logs
  });

  socket.on('disconnect', (reason: Socket.DisconnectReason) => { // Add type for reason
    logger.warn(MODULE_NAME, `Disconnected from server: ${reason}`);
    isAuthenticated = false; // Reset auth status on disconnect
    resetAuthRetryState(); // Reset authentication retry state on disconnect
    sendConnectionStatus('disconnected'); // Update status: Disconnected
 
    // Custom reconnection logic
    if (reconnectionTimeoutId) {
        clearTimeout(reconnectionTimeoutId); // Clear any existing timeout
    }
 
    const nextDelay = delays[reconnectionAttempt] ?? delays[delays.length - 1]; // Get next delay or max
    logger.warn(MODULE_NAME, `Disconnected. Scheduling reconnection attempt ${reconnectionAttempt + 1} in ${nextDelay / 1000}s. Reason: ${reason}`);
 
    reconnectionTimeoutId = setTimeout(() => {
      logger.info(MODULE_NAME, `Attempting to reconnect... (Attempt ${reconnectionAttempt + 1})`);
      // Don't call connectToServer() as it creates a new socket instance.
      // Instead, call connect() on the existing socket instance.
      // If the socket was manually disconnected (socket = null), this won't run, which is correct.
      socket?.connect();
    }, nextDelay);
 
    reconnectionAttempt++;
  });
 
  socket.on('connect_error', (error: Error) => {
    logger.error(MODULE_NAME, `Connection error: ${error.message}`);
    sendConnectionStatus('error');

    if (reconnectionTimeoutId) { // Add this check
      clearTimeout(reconnectionTimeoutId); // Clear any pending retry
    }

    // If the error is an authentication failure, clear guest token and retry as new guest
    if (
      error.message &&
      (error.message.includes('invalid signature') ||
        error.message.toLowerCase().includes('auth'))
    ) {
      logger.warn(MODULE_NAME, 'Clearing guest token and retrying as new guest...');
      clearGuestToken();
      setTimeout(connectToServer, 200); // Small delay to avoid rapid reconnect loop
    } else {
      // Custom reconnection logic for other errors
      const nextDelay = delays[reconnectionAttempt] ?? delays[delays.length - 1]; // Get next delay or max
      logger.error(MODULE_NAME, `Connection error. Scheduling reconnection attempt ${reconnectionAttempt + 1} in ${nextDelay / 1000}s. Error: ${error.message}`);

      reconnectionTimeoutId = setTimeout(() => {
        logger.info(MODULE_NAME, `Attempting to reconnect... (Attempt ${reconnectionAttempt + 1})`);
        socket?.connect();
      }, nextDelay);

      reconnectionAttempt++;
    }
  });

  // Listen for server telling us to retry authentication
  socket.on('retry_auth', async (data: { reason?: string }) => { // Make handler async
      logger.warn(MODULE_NAME, `Received 'retry_auth' event from server. Reason: ${data?.reason || 'No reason provided'}. Authentication failed.`);
      isAuthenticated = false; // Mark as not authenticated
      resetAuthRetryState(); // Reset authentication retry state when server requests retry
      sendConnectionStatus('connecting'); // Show user we are trying again

      // Explicitly disconnect the current socket instance.
      if (socket) {
          socket.off(); // Remove listeners from the old socket
          socket.disconnect();
          socket = null;
      }

      // Attempt to refresh the token BEFORE trying to reconnect
      logger.info(MODULE_NAME, 'Attempting token refresh before reconnecting...');
      const refreshedUserInfo = await refreshToken(); // Call the refresh token function

      if (refreshedUserInfo) {
          logger.info(MODULE_NAME, `Token refresh successful for ${refreshedUserInfo.username}. Proceeding with reconnection.`);
      } else {
          logger.warn(MODULE_NAME, 'Token refresh failed. Reconnection attempt might fail if token was invalid.');
          // If refresh fails, the user might be logged out by refreshToken().
          // connectToServer() will handle the case where no access token is available.
      }

      // Add a small delay before attempting to reconnect.
      setTimeout(() => {
          logger.info(MODULE_NAME, 'Attempting to reconnect after retry_auth event and refresh attempt...');
          connectToServer(); // Re-initiate the connection process
      }, 2000); // 2-second delay
  });

  // Listen for processed events from server (/logs namespace with role-based filtering)
  socket.on('processed_event', (event: any) => {
    logger.info(MODULE_NAME, `\n🟢 ═══════════════════════════════════════════════════════════════`);
    logger.info(MODULE_NAME, `📥 PROCESSED EVENT RECEIVED FROM SERVER (/logs namespace)`);
    logger.info(MODULE_NAME, `   Event ID: ${event.id}`);
    logger.info(MODULE_NAME, `   Event Type: ${event.type}`);
    logger.info(MODULE_NAME, `   Timestamp: ${event.timestamp}`);
    logger.info(MODULE_NAME, `   Killers: ${event.data?.killers?.join(', ') || 'Unknown'}`);
    logger.info(MODULE_NAME, `   Victims: ${event.data?.victims?.join(', ') || 'Unknown'}`);
    logger.info(MODULE_NAME, `   Source Client: ${event.clientId || event.guestClientId || 'Unknown'}`);
    logger.info(MODULE_NAME, `   Raw Event Data: ${JSON.stringify(event.data || {})}`);
    logger.info(MODULE_NAME, `🔄 Processing server event...`);
    
    handleProcessedServerEvent(event);
  });

  // Optional: Listen for server acknowledgements or errors
  // socket.on('log_chunk_error', (data) => {
  //   logger.error(MODULE_NAME, `Server reported error for log chunk: ${data.message}`);
  // });
}

export function disconnectFromServer(): void {
  if (socket) {
    logger.info(MODULE_NAME, 'Disconnecting from server...');
    socket.disconnect();
    socket = null;
    resetAuthRetryState(); // Reset authentication retry state on manual disconnect
    sendConnectionStatus('disconnected'); // Ensure status is updated on manual disconnect
  }
}

export function sendLogChunk(chunk: string): void {
  if (!socket?.connected) {
    logger.warn(MODULE_NAME, 'Cannot send log chunk, not connected to server.');
    // Optional: Queue chunks or attempt reconnect? For now, just drop.
    return;
  }

  // Construct the payload required by the server's LogsGateway
  const payload = {
    clientId: getPersistedClientId(), // Get the persistent client ID
    chunk: chunk,
  };

  // logger.debug(MODULE_NAME, `Sending log chunk for clientId: ${payload.clientId}`); // Removed as clientId is no longer sent directly
  // Add type for acknowledgement callback parameter
  socket.emit('submit_log_chunk', payload, (ack?: { error?: string; message?: string }) => {
    // Optional: Handle acknowledgement from server if implemented
    if (ack?.error) {
       logger.error(MODULE_NAME, `Server acknowledgement error: ${ack.error}`);
    } else if (ack?.message) {
       logger.debug(MODULE_NAME, 'Server acknowledgement: ${ack.message}');
    } else {
       logger.debug(MODULE_NAME, 'Server acknowledged log chunk (no specific message).');
    }
  });
}

export function isConnected(): boolean {
    return socket?.connected ?? false;
}

// Function to attempt sending buffered logs
function flushLogBuffer(): void {
    if (!isConnected() || !isAuthenticated) {
        logger.debug(MODULE_NAME, 'Cannot flush buffer: Not connected or not authenticated.');
        return;
    }
    if (logChunkBuffer.length === 0) {
        logger.debug(MODULE_NAME, 'Log buffer is empty, nothing to flush.');
        return;
    }

    logger.info(MODULE_NAME, `Flushing ${logChunkBuffer.length} buffered log chunks...`);

    // Send chunks sequentially with a small delay
    const sendInterval = 50; // ms delay between chunks
    let index = 0;

    const sendNext = () => {
        if (index < logChunkBuffer.length) {
            if (isConnected() && isAuthenticated) { // Double-check connection before each send
                const chunkToSend = logChunkBuffer[index];
                sendLogChunk(chunkToSend); // Use the existing send function
                index++;
                setTimeout(sendNext, sendInterval);
            } else {
                logger.warn(MODULE_NAME, 'Connection lost during buffer flush. Remaining chunks kept.');
                // Keep remaining chunks in buffer
                logChunkBuffer = logChunkBuffer.slice(index);
            }
        } else {
            logger.info(MODULE_NAME, 'Log buffer flushed successfully.');
            logChunkBuffer = []; // Clear the buffer
        }
    };

    sendNext();
}


// Updated function to ensure connection/auth before sending, buffers otherwise
export function ensureConnectedAndSendLogChunk(chunk: string): void {
  if (!isConnected()) {
    logger.info(MODULE_NAME, 'Not connected. Buffering log chunk and attempting connection...');
    logChunkBuffer.push(chunk);
    connectToServer(); // Attempt connection (checks for token internally)
  } else if (!isAuthenticated) {
     logger.info(MODULE_NAME, 'Connected but not authenticated. Buffering log chunk and attempting authentication...');
     logChunkBuffer.push(chunk);
     // Trigger authentication attempt for connected but unauthenticated state
     if (!isRetryingAuth) {
       attemptAuthentication();
     }
  } else {
    // Connected and authenticated, send immediately
    // Also attempt to flush buffer in case connection dropped and re-established
    flushLogBuffer(); // Try flushing first
    sendLogChunk(chunk); // Then send the current chunk
  }
}

/**
 * Handles processed events received from the server via /logs namespace.
 * These events have already been filtered by the server based on user roles.
 * This is similar to frontend-connection.ts but for the /logs namespace.
 */
function handleProcessedServerEvent(serverEvent: any) {
  try {
    logger.info(MODULE_NAME, `🔄 CONVERTING PROCESSED SERVER EVENT TO CLIENT FORMAT`);
    logger.info(MODULE_NAME, `   Original server event type: ${serverEvent.type}`);
    logger.info(MODULE_NAME, `   Original server event ID: ${serverEvent.id}`);
    
    // Convert server event format to client KillEvent format (reuse conversion logic)
    const clientEvent = convertProcessedServerEventToClient(serverEvent);
    
    logger.info(MODULE_NAME, `✅ CONVERSION COMPLETE:`);
    logger.info(MODULE_NAME, `   Client event ID: ${clientEvent.id}`);
    logger.info(MODULE_NAME, `   Client death type: ${clientEvent.deathType}`);
    logger.info(MODULE_NAME, `   Client killers: ${clientEvent.killers.join(', ')}`);
    logger.info(MODULE_NAME, `   Client victims: ${clientEvent.victims.join(', ')}`);
    logger.info(MODULE_NAME, `   Client description: ${clientEvent.eventDescription}`);
    
    // Add source metadata to indicate this is an external event from /logs namespace
    if (!clientEvent.metadata) {
      clientEvent.metadata = {};
    }
    clientEvent.metadata.source = {
      server: true,
      local: false,
      external: true // This is an external event from the server (/logs namespace)
    };

    logger.info(MODULE_NAME, `📤 SENDING TO RENDERER VIA IPC`);
    logger.info(MODULE_NAME, `   IPC Channel: 'kill-feed-event'`);
    logger.info(MODULE_NAME, `   Source: 'server'`);
    logger.info(MODULE_NAME, `   Metadata: ${JSON.stringify(clientEvent.metadata)}`);

    // Send to renderer via IPC
    const win = getMainWindow();
    if (!win) {
      logger.error(MODULE_NAME, `❌ NO MAIN WINDOW AVAILABLE - Cannot send to renderer!`);
      logger.info(MODULE_NAME, `═══════════════════════════════════════════════════════════════\n`);
      return;
    }

    win.webContents.send('kill-feed-event', {
      event: clientEvent,
      source: 'server'
    });

    logger.success(MODULE_NAME, `🟢 ✅ SUCCESSFULLY FORWARDED PROCESSED SERVER EVENT TO RENDERER`);
    logger.success(MODULE_NAME, `   Event: ${clientEvent.id}`);
    logger.success(MODULE_NAME, `   Description: ${clientEvent.eventDescription}`);
    logger.info(MODULE_NAME, `═══════════════════════════════════════════════════════════════\n`);
  } catch (error) {
    logger.error(MODULE_NAME, `❌ ERROR PROCESSING SERVER EVENT:`);
    logger.error(MODULE_NAME, `   Error: ${error}`);
    logger.error(MODULE_NAME, `   Server Event: ${JSON.stringify(serverEvent)}`);
    logger.info(MODULE_NAME, `═══════════════════════════════════════════════════════════════\n`);
  }
}

/**
 * Converts server GameEvent format to client KillEvent format for processed events.
 * Similar to frontend-connection.ts conversion but for /logs namespace.
 */
function convertProcessedServerEventToClient(serverEvent: any): KillEvent {

  // Extract participants from server event data
  const killers: string[] = [];
  const victims: string[] = [];

  if (serverEvent.data?.killers && Array.isArray(serverEvent.data.killers)) {
    for (const killer of serverEvent.data.killers) {
      if (typeof killer === 'string') {
        killers.push(killer);
      } else if (killer?.handle) {
        killers.push(killer.handle);
      }
    }
  }

  if (serverEvent.data?.victims && Array.isArray(serverEvent.data.victims)) {
    for (const victim of serverEvent.data.victims) {
      if (typeof victim === 'string') {
        victims.push(victim);
      } else if (victim?.handle) {
        victims.push(victim.handle);
      }
    }
  }

  // Map server event type to client death type
  let deathType: KillEvent['deathType'] = 'Unknown';
  switch (serverEvent.type) {
    case 'PLAYER_KILL':
      deathType = 'Combat';
      break;
    case 'VEHICLE_DESTRUCTION':
      deathType = 'Hard';
      break;
    case 'ENVIRONMENTAL_DEATH':
      deathType = 'Unknown';
      break;
    case 'DEATH':
      deathType = 'Unknown';
      break;
  }

  // Map server event to client format
  const clientEvent: KillEvent = {
    id: serverEvent.correlationId || serverEvent.id || `server_${Date.now()}`,
    timestamp: serverEvent.timestamp ? new Date(serverEvent.timestamp).toISOString() : new Date().toISOString(),
    killers: killers.length > 0 ? killers : ['Unknown'],
    victims: victims.length > 0 ? victims : ['Unknown'],
    deathType: deathType,
    vehicleType: serverEvent.data?.vehicle || 'Unknown',
    vehicleModel: serverEvent.data?.vehicle || 'Unknown',
    location: serverEvent.data?.location || '',
    weapon: serverEvent.data?.weapon || '',
    damageType: serverEvent.data?.damageType || '',
    gameMode: 'Unknown', // Server events don't specify game mode in current format
    eventDescription: `Server: ${killers.join(', ')} → ${victims.join(', ')}`,
    isPlayerInvolved: false, // Server has already filtered - if we got it, we should see it
    data: serverEvent.data // Preserve original server data
  };

  return clientEvent;
}

export { connectionEvents };