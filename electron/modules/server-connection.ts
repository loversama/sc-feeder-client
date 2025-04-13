import { io, Socket } from 'socket.io-client';
import * as logger from './logger';
import { getAccessToken, getGuestToken, getPersistedClientId } from './auth-manager'; // Import token getters AND clientId getter
import { getMainWindow } from './window-manager'; // Import window manager to send messages
// Client ID logic moved to auth-manager

const MODULE_NAME = 'ServerConnection';

// Determine server URL based on environment
const isProduction = process.env.NODE_ENV === 'production';
const DEV_SERVER_URL = 'ws://localhost:5324'; // Use ws:// for local dev
const PROD_SERVER_URL = 'wss://server-killfeed.sinfulshadows.com'; // Use wss:// for production
const SERVER_URL = isProduction ? PROD_SERVER_URL : DEV_SERVER_URL;

let socket: Socket | null = null;
let isAuthenticated = false; // Track authentication status
type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';
let currentStatus: ConnectionStatus = 'disconnected';

// Helper function to send status updates to renderer
function sendConnectionStatus(status: ConnectionStatus) {
    if (status !== currentStatus) {
        logger.info(MODULE_NAME, `Connection status changed: ${currentStatus} -> ${status}`);
        currentStatus = status;
        getMainWindow()?.webContents.send('connection-status-changed', status);
    }
}
let logChunkBuffer: string[] = []; // Buffer for offline/unauthenticated chunks
export function connectToServer(): void {
  // Determine which token to use for auth handshake (ONLY user access token)
  const accessToken = getAccessToken();
  const guestToken = getGuestToken(); // Still get guest token for logging/potential future use
  const tokenForHandshake = accessToken; // Only send access token in handshake
  const tokenType = accessToken ? 'User Access Token' : (guestToken ? 'Guest Token (Not Sent)' : 'No Token');

  // Decide if connection is possible (needs at least a guest token conceptually, even if not sent)
  const canConnect = !!accessToken || !!guestToken;

  // If neither token is available conceptually, don't attempt connection
  if (!canConnect) {
      logger.warn(MODULE_NAME, 'No user or guest token available conceptually. Cannot connect to server.');
      // Ensure socket is null if we explicitly decide not to connect
      if (socket) {
          socket.disconnect();
          socket = null;
      }
      return;
  }

  // Don't reconnect if already connected with the same socket instance
  if (socket?.connected) {
    // TODO: Optionally check if the token has changed and force reconnect if needed
    logger.warn(MODULE_NAME, 'Already connected to server.');
    return;
  }

  logger.info(MODULE_NAME, `Attempting to connect to server at ${SERVER_URL} (Env: ${process.env.NODE_ENV}) using ${tokenType}`);
  sendConnectionStatus('connecting'); // Update status: Connecting

  // Disconnect previous socket if exists (e.g., if token changed)
  if (socket) {
    socket.disconnect();
    socket = null; // Ensure we create a new socket instance
  }

  socket = io(SERVER_URL, {
    reconnection: true, // Ensure reconnection is enabled (default)
    reconnectionAttempts: Infinity, // Keep trying indefinitely
    reconnectionDelay: 10000, // Initial delay 10 seconds
    reconnectionDelayMax: 60000, // Max delay 60 seconds (optional, prevents excessive delays)
    transports: ['websocket'], // Use WebSocket transport
    // Send access token for authentication
    auth: (cb) => {
      // ONLY pass the access token if available. If only guest token exists, send nothing.
      const tokenToSend = accessToken; // Explicitly use accessToken here
      const sendingType = tokenToSend ? 'User Access Token' : 'No Token';
      logger.debug(MODULE_NAME, `Socket auth callback: Providing ${sendingType}: ${tokenToSend ? 'Yes (first 10 chars: ' + tokenToSend.substring(0, 10) + '...)' : 'No'}`);
      cb(tokenToSend ? { token: tokenToSend } : {}); // Send empty object if no access token
    }
  });

  socket.on('connect', () => {
    logger.info(MODULE_NAME, `Successfully connected to server: ${socket?.id}. Checking authentication method...`);

    // Check if we connected as a guest (no access token sent in handshake, but guest token exists)
    const currentAccessToken = getAccessToken();
    const currentGuestToken = getGuestToken();

    if (!currentAccessToken && currentGuestToken) {
      // Connected without user auth, attempt guest auth via message
      logger.info(MODULE_NAME, `Connected without user token. Sending authenticate_guest message...`);
      socket?.emit('authenticate_guest', { token: currentGuestToken }, (ack: { success: boolean; error?: string }) => {
         if (ack?.success) {
            logger.info(MODULE_NAME, 'Server acknowledged guest authentication request.');
            // Wait for the 'authenticated' event from the server now
         } else {
            logger.error(MODULE_NAME, `Server rejected guest authentication: ${ack?.error || 'Unknown error'}`);
            // Handle error - maybe disconnect or retry? For now, just log.
            // The 'authenticated' event will likely not arrive.
         }
      });
    } else if (currentAccessToken) {
       // Connected with user access token, waiting for 'authenticated' event from server handshake validation
       logger.info(MODULE_NAME, `Connected with user token. Waiting for server authentication confirmation...`);
    } else {
       // Connected without any token (should not happen based on connectToServer logic, but handle defensively)
       logger.warn(MODULE_NAME, `Connected without any token. Cannot authenticate.`);
    }
    // Still 'connecting' until server confirms 'authenticated' event via handshake or message response
  });

  // Listen for custom 'authenticated' event from server
  socket.on('authenticated', () => {
      logger.info(MODULE_NAME, `Server confirmed authentication for socket: ${socket?.id}`);
      isAuthenticated = true;
      sendConnectionStatus('connected'); // Update status: Connected (after auth confirmation)
      flushLogBuffer(); // Attempt to send any buffered logs
  });

  socket.on('disconnect', (reason: Socket.DisconnectReason) => { // Add type for reason
    logger.warn(MODULE_NAME, `Disconnected from server: ${reason}`);
    isAuthenticated = false; // Reset auth status on disconnect
    sendConnectionStatus('disconnected'); // Update status: Disconnected
    // Socket.io handles reconnection attempts automatically based on options
  });

  socket.on('connect_error', (error: Error) => { // Add type for error
    logger.error(MODULE_NAME, `Connection error: ${error.message}`);
    sendConnectionStatus('error'); // Update status: Error
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
       logger.debug(MODULE_NAME, `Server acknowledgement: ${ack.message}`);
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
     logger.info(MODULE_NAME, 'Connected but not authenticated. Buffering log chunk.');
     logChunkBuffer.push(chunk);
     // No need to call connectToServer again if already connected but waiting for auth
  } else {
    // Connected and authenticated, send immediately
    // Also attempt to flush buffer in case connection dropped and re-established
    flushLogBuffer(); // Try flushing first
    sendLogChunk(chunk); // Then send the current chunk
  }
}