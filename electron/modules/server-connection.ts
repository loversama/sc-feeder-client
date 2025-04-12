import { io, Socket } from 'socket.io-client';
import * as logger from './logger';
import { getAccessToken, getGuestToken, getPersistedClientId } from './auth-manager'; // Import token getters AND clientId getter
// Client ID logic moved to auth-manager

const MODULE_NAME = 'ServerConnection';
const SERVER_URL = 'http://localhost:5324'; // TODO: Make this configurable

let socket: Socket | null = null;
let isAuthenticated = false; // Track authentication status
let logChunkBuffer: string[] = []; // Buffer for offline/unauthenticated chunks
export function connectToServer(): void {
  // Determine which token to use (user access token takes priority)
  let tokenToUse = getAccessToken();
  let tokenType = 'User Access Token';
  if (!tokenToUse) {
    tokenToUse = getGuestToken();
    tokenType = 'Guest Token';
  }

  // If neither token is available, don't attempt connection
  if (!tokenToUse) {
    logger.warn(MODULE_NAME, 'No user or guest token available. Cannot connect to server.');
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

  logger.info(MODULE_NAME, `Attempting to connect to server at ${SERVER_URL} using ${tokenType}`);

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
      // Pass the determined token (user or guest)
      logger.debug(MODULE_NAME, `Socket auth callback: Providing ${tokenType}: ${tokenToUse ? 'Yes (first 10 chars: ' + tokenToUse.substring(0, 10) + '...)' : 'No'}`);
      cb({ token: tokenToUse });
    }
  });

  socket.on('connect', () => {
    logger.info(MODULE_NAME, `Successfully connected to server: ${socket?.id}. Waiting for authentication...`);
    // Authentication happens via the guard on the server now for the connection itself
    // We need a confirmation event from the server.
  });

  // Listen for custom 'authenticated' event from server
  socket.on('authenticated', () => {
      logger.info(MODULE_NAME, `Server confirmed authentication for socket: ${socket?.id}`);
      isAuthenticated = true;
      flushLogBuffer(); // Attempt to send any buffered logs
  });

  socket.on('disconnect', (reason: Socket.DisconnectReason) => { // Add type for reason
    logger.warn(MODULE_NAME, `Disconnected from server: ${reason}`);
    isAuthenticated = false; // Reset auth status on disconnect
    // Socket.io handles reconnection attempts automatically based on options
  });

  socket.on('connect_error', (error: Error) => { // Add type for error
    logger.error(MODULE_NAME, `Connection error: ${error.message}`);
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