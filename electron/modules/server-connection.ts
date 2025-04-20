import { io, Socket } from 'socket.io-client';
import * as logger from './logger';
// Import refreshToken along with other auth functions
import { getAccessToken, getGuestToken, getPersistedClientId, refreshToken, setGuestToken, clearGuestToken } from './auth-manager';
import { getMainWindow } from './window-manager'; // Import window manager to send messages
// Client ID logic moved to auth-manager

const MODULE_NAME = 'ServerConnection';

// Determine server URL based on environment
import { SERVER_URL } from './server-config';

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
  let handshakeQuery: any = {};

  if (accessToken) {
    handshakeAuth = { token: accessToken };
  } else if (guestToken) {
    handshakeAuth = { token: guestToken };
  } else if (clientId) {
    handshakeQuery = { clientId };
  } else {
    logger.warn(
      MODULE_NAME,
      'No access token, guest token, or clientId available. Cannot connect to server.',
    );
    return;
  }

  socket = io(SERVER_URL, {
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 10000,
    reconnectionDelayMax: 60000,
    transports: ['websocket'],
    auth: handshakeAuth,
    query: handshakeQuery,
  });

  socket.on('connect', () => {
    logger.info(
      MODULE_NAME,
      `Successfully connected to server: ${socket?.id}. Authentication handshake sent.`,
    );
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

  socket.on('connect_error', (error: Error) => {
    logger.error(MODULE_NAME, `Connection error: ${error.message}`);
    sendConnectionStatus('error');
    // If the error is an authentication failure, clear guest token and retry as new guest
    if (
      error.message &&
      (error.message.includes('invalid signature') ||
        error.message.toLowerCase().includes('auth'))
    ) {
      logger.warn(MODULE_NAME, 'Clearing guest token and retrying as new guest...');
      clearGuestToken();
      setTimeout(connectToServer, 200); // Small delay to avoid rapid reconnect loop
    }
  });

  // Listen for server telling us to retry authentication
  socket.on('retry_auth', async (data: { reason?: string }) => { // Make handler async
      logger.warn(MODULE_NAME, `Received 'retry_auth' event from server. Reason: ${data?.reason || 'No reason provided'}. Authentication failed.`);
      isAuthenticated = false; // Mark as not authenticated
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