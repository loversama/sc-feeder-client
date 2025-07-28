import EventEmitter from 'events';
import { io, Socket } from 'socket.io-client';
import * as logger from './logger';
import { getAccessToken, getGuestToken, getPersistedClientId } from './auth-manager';
import { getMainWindow } from './window-manager';
import { SERVER_URL } from './server-config';
import type { KillEvent } from '../../shared/types';

const MODULE_NAME = 'FrontendConnection';

let frontendSocket: Socket | null = null;
let isConnectedToFrontend = false;
type FrontendConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';
let currentFrontendStatus: FrontendConnectionStatus = 'disconnected';

// Heartbeat configuration
const HEARTBEAT_INTERVAL = 30000; // 30 seconds
const HEARTBEAT_TIMEOUT = 10000; // 10 seconds to wait for pong
let heartbeatInterval: NodeJS.Timeout | null = null;
let lastPongTime = Date.now();

const frontendEvents = new EventEmitter();

// Heartbeat functions
function startHeartbeat() {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
  }
  
  lastPongTime = Date.now();
  
  heartbeatInterval = setInterval(() => {
    if (!frontendSocket || !frontendSocket.connected) {
      stopHeartbeat();
      return;
    }
    
    // Check if we've received a pong recently
    const timeSinceLastPong = Date.now() - lastPongTime;
    if (timeSinceLastPong > HEARTBEAT_INTERVAL + HEARTBEAT_TIMEOUT) {
      logger.warn(MODULE_NAME, `No pong received for ${timeSinceLastPong}ms, connection may be unhealthy`);
      // Trigger reconnection
      frontendSocket.disconnect();
      frontendSocket.connect();
      return;
    }
    
    // Send ping
    frontendSocket.emit('ping', {
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

// Helper function to send frontend connection status updates to renderer
function sendFrontendConnectionStatus(status: FrontendConnectionStatus) {
  if (status !== currentFrontendStatus) {
    logger.info(MODULE_NAME, `Frontend connection status changed: ${currentFrontendStatus} -> ${status}`);
    currentFrontendStatus = status;
    getMainWindow()?.webContents.send('frontend-connection-status-changed', status);
  }
}

/**
 * Connects to the /frontend WebSocket namespace for receiving role-filtered events.
 * Server determines what events this client should receive based on authentication.
 * Client has no role awareness - just receives what server sends.
 */
export function connectToFrontend(): void {
  logger.info(MODULE_NAME, '🟢 ═══════════════════════════════════════════════════════════════');
  logger.info(MODULE_NAME, '🟢 connectToFrontend() CALLED - Starting frontend connection process');
  logger.info(MODULE_NAME, '🟢 ═══════════════════════════════════════════════════════════════');
  
  // Don't reconnect if already connected
  if (frontendSocket?.connected) {
    logger.warn(MODULE_NAME, 'Already connected to frontend namespace.');
    return;
  }

  const accessToken = getAccessToken();
  const guestToken = getGuestToken();
  const tokenType = accessToken ? 'User Access Token' : guestToken ? 'Guest Token' : 'No Token';

  // Assume production by default, only use development path if explicitly set
  const socketPath = process.env.NODE_ENV === 'development' ? '/socket.io/' : '/production/socket.io/';
  logger.info(MODULE_NAME, `Connecting to frontend namespace at ${SERVER_URL}/frontend using ${tokenType}`);
  logger.info(MODULE_NAME, `Using Socket.IO path: ${socketPath}`);
  sendFrontendConnectionStatus('connecting');

  // Disconnect previous socket if exists
  if (frontendSocket) {
    frontendSocket.disconnect();
    frontendSocket = null;
  }

  // Prepare authentication with client ID
  let authData: any = {
    clientId: getPersistedClientId() // Include client ID for server-side filtering
  };
  if (accessToken) {
    authData.token = accessToken;
  } else if (guestToken) {
    authData.token = guestToken;
  }

  frontendSocket = io(`${SERVER_URL}/frontend`, {
    // Add production path prefix if server is in production mode
    path: socketPath,
    reconnection: true,
    reconnectionAttempts: Infinity, // Keep trying indefinitely
    reconnectionDelay: 1000, // Start with 1 second delay
    reconnectionDelayMax: 60000, // Max 60 seconds between attempts
    timeout: 30000, // 30 second connection timeout
    transports: ['websocket'],
    auth: authData,
    forceNew: false,
    upgrade: true,
    rememberUpgrade: true,
  });

  frontendSocket.on('connect', () => {
    logger.success(MODULE_NAME, '🟢 ═══════════════════════════════════════════════════════════════');
    logger.success(MODULE_NAME, '🟢 ✅ FRONTEND WEBSOCKET CONNECTED SUCCESSFULLY!');
    logger.success(MODULE_NAME, `🟢 Socket ID: ${frontendSocket?.id}`);
    logger.success(MODULE_NAME, `🟢 Connected to: ${SERVER_URL}/frontend`);
    logger.success(MODULE_NAME, '🟢 ═══════════════════════════════════════════════════════════════');
    isConnectedToFrontend = true;
    sendFrontendConnectionStatus('connected');
    startHeartbeat(); // Start heartbeat when connected
    frontendEvents.emit('connected');
  });

  frontendSocket.on('disconnect', (reason) => {
    logger.warn(MODULE_NAME, `Disconnected from frontend namespace: ${reason}`);
    isConnectedToFrontend = false;
    stopHeartbeat(); // Stop heartbeat when disconnected
    sendFrontendConnectionStatus('disconnected');
    frontendEvents.emit('disconnected', reason);
  });

  frontendSocket.on('connect_error', (error) => {
    logger.error(MODULE_NAME, '🔴 ═══════════════════════════════════════════════════════════════');
    logger.error(MODULE_NAME, '🔴 ❌ FRONTEND WEBSOCKET CONNECTION FAILED!');
    logger.error(MODULE_NAME, `🔴 Error: ${error.message}`);
    logger.error(MODULE_NAME, `🔴 Error Details: ${JSON.stringify(error)}`);
    logger.error(MODULE_NAME, `🔴 Server URL: ${SERVER_URL}/frontend`);
    logger.error(MODULE_NAME, '🔴 ═══════════════════════════════════════════════════════════════');
    sendFrontendConnectionStatus('error');
    frontendEvents.emit('error', error);
  });

  // Note: Event reception is handled by /client namespace
  // /frontend is used for admin features, stats, and dashboard updates only

  // Listen for global stats updates
  frontendSocket.on('globalStatsUpdate', (stats: any) => {
    logger.debug(MODULE_NAME, 'Received global stats update');
    getMainWindow()?.webContents.send('global-stats-update', stats);
  });

  // Listen for dashboard stats updates
  frontendSocket.on('dashboardStatsUpdate', (stats: any) => {
    logger.debug(MODULE_NAME, 'Received dashboard stats update');
    getMainWindow()?.webContents.send('dashboard-stats-update', stats);
  });

  // Handle pong responses for heartbeat
  frontendSocket.on('pong', (data: any) => {
    lastPongTime = Date.now();
    const roundTripTime = data.received ? lastPongTime - data.received : 0;
    logger.debug(MODULE_NAME, `Heartbeat pong received (RTT: ${roundTripTime}ms)`);
  });
}

/**
 * Disconnects from the frontend namespace
 */
export function disconnectFromFrontend(): void {
  if (frontendSocket) {
    logger.info(MODULE_NAME, 'Disconnecting from frontend namespace...');
    stopHeartbeat(); // Stop heartbeat before disconnecting
    frontendSocket.disconnect();
    frontendSocket = null;
    isConnectedToFrontend = false;
    sendFrontendConnectionStatus('disconnected');
  }
}

/**
 * Checks if connected to frontend namespace
 */
export function isFrontendConnected(): boolean {
  return frontendSocket?.connected ?? false;
}

/**
 * Gets the current frontend connection status
 */
export function getFrontendConnectionStatus(): FrontendConnectionStatus {
  return currentFrontendStatus;
}

export { frontendEvents };