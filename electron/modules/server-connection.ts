import EventEmitter from 'events';
import { io, Socket } from 'socket.io-client';
import * as logger from './logger';
import os from 'node:os'; // Import os module for hostname
// Import refreshToken along with other auth functions
import { getAccessToken, getGuestToken, getPersistedClientId, refreshToken, setGuestToken, clearGuestToken, requestAndStoreGuestToken, getRefreshToken } from './auth-manager';
import { getMainWindow } from './window-manager'; // Import window manager to send messages
import { getDetailedUserAgent } from './app-lifecycle';
import type { KillEvent } from '../../shared/types';
import { processKillEvent } from './event-processor';
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
// Progressive delays: 3s, 5s, 10s, 15s, then 15-30s randomly
function getReconnectDelay(attempt: number): number {
  const progressiveDelays = [3000, 5000, 10000, 15000];
  if (attempt < progressiveDelays.length) {
    return progressiveDelays[attempt];
  }
  // After 4 attempts, use random delay between 15-30 seconds
  return Math.floor(Math.random() * 15000) + 15000; // 15000-30000ms
}
let reconnectionAttempt = 0;
let reconnectionTimeoutId: NodeJS.Timeout | null = null;

// Authentication Retry Logic State
let authRetryAttempt = 0;
let authRetryTimeoutId: NodeJS.Timeout | null = null;

// Heartbeat configuration for server connection health monitoring
const HEARTBEAT_INTERVAL = 20000; // 20 seconds - more frequent to prevent timeouts
const HEARTBEAT_TIMEOUT = 10000; // 10 seconds to wait for pong
let heartbeatInterval: NodeJS.Timeout | null = null;
let lastPongTime = Date.now();
let isRetryingAuth = false;
const authRetryDelays = [2000, 5000, 10000, 30000, 60000]; // Authentication retry delays in ms
 
// Helper function to send status updates to renderer
function sendConnectionStatus(status: ConnectionStatus, attempts?: number, nextDelay?: number) {
    const actualAttempts = attempts ?? reconnectionAttempt;
    // Always send if attempts changed, even if status is the same
    logger.info(MODULE_NAME, `Connection status update: ${status} (attempts: ${actualAttempts}, nextDelay: ${nextDelay}ms)`);
    currentStatus = status;
    getMainWindow()?.webContents.send('connection-status-changed', status, actualAttempts, nextDelay);
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

// Heartbeat functions for server connection health monitoring
function startHeartbeat() {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
  }
  
  lastPongTime = Date.now();
  
  heartbeatInterval = setInterval(() => {
    if (!socket || !socket.connected) {
      stopHeartbeat();
      return;
    }
    
    // Check if we've received a pong recently
    const timeSinceLastPong = Date.now() - lastPongTime;
    if (timeSinceLastPong > HEARTBEAT_INTERVAL + HEARTBEAT_TIMEOUT) {
      logger.warn(MODULE_NAME, `No pong received for ${timeSinceLastPong}ms, connection may be unhealthy`);
      // Trigger reconnection through the existing manual reconnection system
      socket.disconnect();
      scheduleReconnection();
      return;
    }
    
    // Send ping
    socket.emit('ping', {
      timestamp: Date.now(),
      clientId: getPersistedClientId(),
    });
    
    logger.debug(MODULE_NAME, 'Heartbeat ping sent');
  }, HEARTBEAT_INTERVAL);
}

function stopHeartbeat() {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
}

// Function to schedule reconnection with progressive delays
function scheduleReconnection(): void {
  if (reconnectionTimeoutId) {
    clearTimeout(reconnectionTimeoutId);
  }

  const nextDelay = getReconnectDelay(reconnectionAttempt);
  logger.warn(MODULE_NAME, `Scheduling reconnection attempt ${reconnectionAttempt + 1} in ${nextDelay / 1000}s`);
  
  // Send the disconnected status with the delay that will be used
  sendConnectionStatus('disconnected', reconnectionAttempt, nextDelay);

  reconnectionTimeoutId = setTimeout(async () => {
    reconnectionAttempt++;
    logger.info(MODULE_NAME, `Attempting to reconnect... (Attempt ${reconnectionAttempt})`);
    
    // Before reconnecting, check if we need to refresh tokens
    const accessToken = getAccessToken();
    const refreshTokenAvailable = !!getRefreshToken();
    
    if (accessToken || refreshTokenAvailable) {
      logger.info(MODULE_NAME, 'Attempting token refresh before reconnection...');
      const refreshedUserInfo = await refreshToken();
      
      if (!refreshedUserInfo) {
        logger.warn(MODULE_NAME, 'Token refresh failed during reconnection attempt');
      }
    }
    
    // Reconnect with fresh tokens (or guest token if refresh failed)
    connectToServer();
  }, nextDelay);
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

  // Assume production by default, only use development path if explicitly set  
  const socketPath = process.env.NODE_ENV === 'development' ? '/socket.io/' : '/production/socket.io/';
  logger.info(
    MODULE_NAME,
    `Attempting to connect to server at ${SERVER_URL}/client (Env: ${process.env.NODE_ENV}) using ${tokenType}`,
  );
  logger.info(MODULE_NAME, `Using Socket.IO path: ${socketPath}`);
  sendConnectionStatus('connecting', reconnectionAttempt); // Update status: Connecting with attempt count

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

  socket = io(`${SERVER_URL}/client`, {
    // Add production path prefix if server is in production mode
    path: socketPath,
    reconnection: false, // Disable automatic reconnection (using manual logic)
    timeout: 30000, // 30 second connection timeout
    transports: ['websocket'],
    auth: handshakeAuth,
    query: handshakeQuery,
    forceNew: false,
    upgrade: true,
    rememberUpgrade: true
    // Configure ping/pong timeouts to prevent disconnections
    // pingInterval: 25000, // Send ping every 25 seconds - removed as not supported in socket.io v4
    // pingTimeout: 60000,  // Wait 60 seconds for pong response - removed as not supported in socket.io v4
  });

  socket.on('connect', () => {
    const isReconnection = reconnectionAttempt > 0;
    logger.info(
      MODULE_NAME,
      `${isReconnection ? 'Reconnected' : 'Successfully connected'} to server: ${socket?.id}. Authentication handshake sent.`,
    );
    // Initialize lastPongTime on connect to prevent false timeouts
    lastPongTime = Date.now();
    // Reset reconnection logic on successful connection
    if (reconnectionTimeoutId) {
        clearTimeout(reconnectionTimeoutId);
        reconnectionTimeoutId = null;
    }
    reconnectionAttempt = 0;
    logger.info(MODULE_NAME, 'Reconnection logic reset on successful connection.');
    // Emit event on successful connection/reconnection
    connectionEvents.emit(isReconnection ? 'reconnected' : 'connected');
    
    // Send 'connecting' status while waiting for authentication
    sendConnectionStatus('connecting', 0);
    logger.info(MODULE_NAME, 'Socket connected, waiting for authentication confirmation from server');
    
    // Set a timeout to check if authentication is received
    setTimeout(() => {
      if (socket && socket.connected && !isAuthenticated) {
        logger.warn(MODULE_NAME, 'Socket connected but authentication not received after 5 seconds');
        // Check if ping/pong is working
        const timeSinceLastPong = Date.now() - lastPongTime;
        logger.info(MODULE_NAME, `Time since last pong: ${timeSinceLastPong}ms`);
        
        // If we're getting pongs but no auth, assume we're connected
        if (timeSinceLastPong < 30000) {
          logger.info(MODULE_NAME, 'Heartbeat is active, marking as connected despite missing auth event');
          isAuthenticated = true;
          sendConnectionStatus('connected');
        } else {
          logger.error(MODULE_NAME, 'No heartbeat detected, connection may be broken');
          sendConnectionStatus('error');
        }
      }
    }, 5000);
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
      startHeartbeat(); // Start heartbeat monitoring when authenticated
      flushLogBuffer(); // Attempt to send any buffered logs
  });

  socket.on('disconnect', (reason: Socket.DisconnectReason) => { // Add type for reason
    logger.warn(MODULE_NAME, `Disconnected from server: ${reason}`);
    isAuthenticated = false; // Reset auth status on disconnect
    resetAuthRetryState(); // Reset authentication retry state on disconnect
    stopHeartbeat(); // Stop heartbeat when disconnected
    sendConnectionStatus('disconnected', reconnectionAttempt); // Update status: Disconnected with current attempts
 
    // Don't attempt to reconnect if manually disconnected
    if (!socket) {
      logger.info(MODULE_NAME, 'Socket manually disconnected, skipping auto-reconnection');
      return;
    }
 
    // Use the scheduleReconnection function which handles token refresh
    scheduleReconnection();
  });
 
  socket.on('connect_error', (error: Error) => {
    logger.error(MODULE_NAME, `Connection error: ${error.message}`);
    // Send 'disconnected' status so UI shows reconnecting message, not error
    sendConnectionStatus('disconnected', reconnectionAttempt);

    // If the error is an authentication failure, clear guest token and retry as new guest
    if (
      error.message &&
      (error.message.includes('invalid signature') ||
        error.message.toLowerCase().includes('auth') ||
        error.message.includes('jwt expired'))
    ) {
      logger.warn(MODULE_NAME, 'Authentication error detected. Attempting to refresh tokens...');
      
      // Clear any pending reconnection
      if (reconnectionTimeoutId) {
        clearTimeout(reconnectionTimeoutId);
        reconnectionTimeoutId = null;
      }
      
      // Try to refresh tokens first
      refreshToken().then((refreshedUserInfo) => {
        if (refreshedUserInfo) {
          logger.info(MODULE_NAME, 'Token refresh successful. Reconnecting with new tokens...');
          setTimeout(connectToServer, 500);
        } else {
          logger.warn(MODULE_NAME, 'Token refresh failed. Clearing tokens and retrying as guest...');
          clearGuestToken();
          setTimeout(connectToServer, 1000);
        }
      }).catch((err) => {
        logger.error(MODULE_NAME, 'Error during token refresh:', err);
        clearGuestToken();
        setTimeout(connectToServer, 1000);
      });
    } else {
      // Use scheduleReconnection for other errors
      scheduleReconnection();
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

  // Listen for pong response from server
  socket.on('pong', (data: { timestamp: number }) => {
    lastPongTime = Date.now();
    const latency = lastPongTime - (data?.timestamp || lastPongTime);
    logger.debug(MODULE_NAME, `Received pong from server, latency: ${latency}ms`);
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
async function handleProcessedServerEvent(serverEvent: any) {
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

    logger.info(MODULE_NAME, `📤 PROCESSING SERVER EVENT THROUGH EVENT PROCESSOR`);
    logger.info(MODULE_NAME, `   Event ID: ${clientEvent.id}`);
    logger.info(MODULE_NAME, `   Source: 'server'`);
    logger.info(MODULE_NAME, `   Metadata: ${JSON.stringify(clientEvent.metadata)}`);

    // Discover and track event category if present
    if (clientEvent.metadata?.category) {
      const { addDiscoveredCategory } = await import('./config-manager.ts');
      addDiscoveredCategory(clientEvent.metadata.category);
      logger.info(MODULE_NAME, `Discovered new event category from server: ${clientEvent.metadata.category.id} - ${clientEvent.metadata.category.name}`);
    }

    // Process the event through the event processor
    // This will:
    // 1. Save to SQLite database
    // 2. Handle deduplication
    // 3. Send to renderer with proper metadata
    // 4. Trigger notifications if needed
    await processKillEvent(clientEvent, false); // silentMode = false for server events

    logger.success(MODULE_NAME, `🟢 ✅ SUCCESSFULLY PROCESSED SERVER EVENT`);
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
  
  // First, check if server provides a specific death type
  if (serverEvent.data?.specificDeathType) {
    const specificType = serverEvent.data.specificDeathType;
    if (['Soft', 'Hard', 'Combat', 'Collision', 'Crash', 'BleedOut', 'Suffocation'].includes(specificType)) {
      deathType = specificType as KillEvent['deathType'];
    }
  } else {
    // Fallback to mapping from event type (handle both cases)
    const eventType = serverEvent.type?.toUpperCase();
    switch (eventType) {
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
  }

  // Map server event to client format
  const clientEvent: KillEvent = {
    id: serverEvent.id || serverEvent.correlationId || `server_${Date.now()}`,
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
    data: serverEvent.data, // Preserve original server data
    metadata: {} // Initialize metadata
  };

  // If server provided a category, include it in metadata
  if (serverEvent.category) {
    clientEvent.metadata!.category = {
      id: serverEvent.category.id || 'unknown',
      name: serverEvent.category.name || 'Unknown Category',
      icon: serverEvent.category.icon,
      color: serverEvent.category.color,
      priority: serverEvent.category.priority
    };
  }

  return clientEvent;
}

export function reconnectNow(): void {
  logger.info(MODULE_NAME, 'Manual reconnection requested');
  
  // Clear any pending reconnection timer
  if (reconnectionTimeoutId) {
    clearTimeout(reconnectionTimeoutId);
    reconnectionTimeoutId = null;
  }
  
  // If socket exists and is connected, disconnect it first
  if (socket && socket.connected) {
    logger.info(MODULE_NAME, 'Disconnecting current socket before reconnecting');
    socket.disconnect();
    // Give it a moment to properly disconnect
    setTimeout(() => {
      reconnectionAttempt = 0;
      connectToServer();
    }, 100);
  } else {
    // Reset attempt counter for manual reconnection
    reconnectionAttempt = 0;
    // Connect immediately
    connectToServer();
  }
}

export { connectionEvents };