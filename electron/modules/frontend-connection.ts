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

const frontendEvents = new EventEmitter();

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

  logger.info(MODULE_NAME, `Connecting to frontend namespace at ${SERVER_URL}/frontend using ${tokenType}`);
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
    reconnection: true,
    reconnectionAttempts: 5,
    reconnectionDelay: 1000,
    transports: ['websocket'],
    auth: authData,
  });

  frontendSocket.on('connect', () => {
    logger.success(MODULE_NAME, '🟢 ═══════════════════════════════════════════════════════════════');
    logger.success(MODULE_NAME, '🟢 ✅ FRONTEND WEBSOCKET CONNECTED SUCCESSFULLY!');
    logger.success(MODULE_NAME, `🟢 Socket ID: ${frontendSocket?.id}`);
    logger.success(MODULE_NAME, `🟢 Connected to: ${SERVER_URL}/frontend`);
    logger.success(MODULE_NAME, '🟢 ═══════════════════════════════════════════════════════════════');
    isConnectedToFrontend = true;
    sendFrontendConnectionStatus('connected');
    frontendEvents.emit('connected');
  });

  frontendSocket.on('disconnect', (reason) => {
    logger.warn(MODULE_NAME, `Disconnected from frontend namespace: ${reason}`);
    isConnectedToFrontend = false;
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

  // Listen for role-filtered events from server - the ONLY source for external events
  // Listen for both old and new event names for backward compatibility
  frontendSocket.on('verified_event', (event: any) => {
    logger.info(MODULE_NAME, `\n🟢 ═══════════════════════════════════════════════════════════════`);
    logger.info(MODULE_NAME, `📥 SERVER EVENT RECEIVED FROM WEBSOCKET (verified_event - legacy)`);
    logger.info(MODULE_NAME, `   Event ID: ${event.id}`);
    logger.info(MODULE_NAME, `   Event Type: ${event.type}`);
    logger.info(MODULE_NAME, `   Timestamp: ${event.timestamp}`);
    logger.info(MODULE_NAME, `   Killers: ${event.data?.killers?.join(', ') || 'Unknown'}`);
    logger.info(MODULE_NAME, `   Victims: ${event.data?.victims?.join(', ') || 'Unknown'}`);
    logger.info(MODULE_NAME, `   Source Client: ${event.clientId || event.guestClientId || 'Unknown'}`);
    logger.info(MODULE_NAME, `   Raw Event Data: ${JSON.stringify(event.data || {})}`);
    logger.info(MODULE_NAME, `🔄 Processing server event...`);
    
    handleServerEvent(event);
  });

  frontendSocket.on('newEvent', (event: any) => {
    logger.info(MODULE_NAME, `\n🟢 ═══════════════════════════════════════════════════════════════`);
    logger.info(MODULE_NAME, `📥 SERVER EVENT RECEIVED FROM WEBSOCKET (newEvent)`);
    logger.info(MODULE_NAME, `   Event ID: ${event.id}`);
    logger.info(MODULE_NAME, `   Event Type: ${event.type}`);
    logger.info(MODULE_NAME, `   Timestamp: ${event.timestamp}`);
    logger.info(MODULE_NAME, `   Killers: ${event.data?.killers?.join(', ') || 'Unknown'}`);
    logger.info(MODULE_NAME, `   Victims: ${event.data?.victims?.join(', ') || 'Unknown'}`);
    logger.info(MODULE_NAME, `   Source Client: ${event.clientId || event.guestClientId || 'Unknown'}`);
    logger.info(MODULE_NAME, `   Raw Event Data: ${JSON.stringify(event.data || {})}`);
    logger.info(MODULE_NAME, `🔄 Processing server event...`);
    
    handleServerEvent(event);
  });

  // Listen for event batches (catch-up events for late joiners)
  frontendSocket.on('eventBatch', (events: any[]) => {
    logger.info(MODULE_NAME, `\n🟢 ═══════════════════════════════════════════════════════════════`);
    logger.info(MODULE_NAME, `📥 EVENT BATCH RECEIVED FROM WEBSOCKET (${events?.length || 0} events)`);
    logger.info(MODULE_NAME, `🔄 Processing batch of server events...`);
    
    if (events && Array.isArray(events)) {
      events.forEach((event, index) => {
        logger.debug(MODULE_NAME, `   Processing batch event ${index + 1}/${events.length}: ${event.id}`);
        handleServerEvent(event);
      });
    }
    
    logger.info(MODULE_NAME, `✅ Completed processing event batch (${events?.length || 0} events)`);
    logger.info(MODULE_NAME, `═══════════════════════════════════════════════════════════════\n`);
  });

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
}

/**
 * Handles events received from the server.
 * Server has already filtered events based on client's role - client just processes them.
 */
function handleServerEvent(serverEvent: any) {
  try {
    logger.info(MODULE_NAME, `🔄 CONVERTING SERVER EVENT TO CLIENT FORMAT`);
    logger.info(MODULE_NAME, `   Original server event type: ${serverEvent.type}`);
    logger.info(MODULE_NAME, `   Original server event ID: ${serverEvent.id}`);
    
    // Convert server event format to client KillEvent format
    const clientEvent: KillEvent = convertServerEventToClient(serverEvent);
    
    logger.info(MODULE_NAME, `✅ CONVERSION COMPLETE:`);
    logger.info(MODULE_NAME, `   Client event ID: ${clientEvent.id}`);
    logger.info(MODULE_NAME, `   Client death type: ${clientEvent.deathType}`);
    logger.info(MODULE_NAME, `   Client killers: ${clientEvent.killers.join(', ')}`);
    logger.info(MODULE_NAME, `   Client victims: ${clientEvent.victims.join(', ')}`);
    logger.info(MODULE_NAME, `   Client description: ${clientEvent.eventDescription}`);
    
    // Add source metadata to indicate this is an external event
    if (!clientEvent.metadata) {
      clientEvent.metadata = {};
    }
    clientEvent.metadata.source = {
      server: true,
      local: false,
      external: true // This is an external event from the server
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

    logger.success(MODULE_NAME, `🟢 ✅ SUCCESSFULLY FORWARDED SERVER EVENT TO RENDERER`);
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
 * Converts server GameEvent format to client KillEvent format
 */
function convertServerEventToClient(serverEvent: any): KillEvent {
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
    eventDescription: `External: ${killers.join(', ')} → ${victims.join(', ')}`,
    isPlayerInvolved: false, // Server has already filtered - if we got it, we should see it
    data: serverEvent.data // Preserve original server data
  };

  return clientEvent;
}

/**
 * Disconnects from the frontend namespace
 */
export function disconnectFromFrontend(): void {
  if (frontendSocket) {
    logger.info(MODULE_NAME, 'Disconnecting from frontend namespace...');
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