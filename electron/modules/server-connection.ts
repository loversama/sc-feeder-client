import EventEmitter from 'events';
import { io } from 'socket.io-client';
import * as logger from './logger';
import os from 'node:os';
import {
  getAuthStatus,
  getAccessToken,
  getGuestToken,
  getPersistedClientId,
  refreshToken,
  setGuestToken,
  clearGuestToken,
  getRefreshToken,
} from './auth-manager';
import { getMainWindow } from './window-manager';
import { getDetailedUserAgent } from './app-lifecycle';
import type { KillEvent } from '../../shared/types';
import { processKillEvent } from './event-processor';
import { SERVER_URL } from './server-config';
import { countLogUpload, countTelemetryUpload, countDropped, pushDebugEvent } from './telemetry/debug-bus';
import type { TelemetryUploadPayload } from './telemetry/telemetry-service';
import { ServerLink, makePrepareAuth, type LinkSocket, type LinkStatus } from './server-link';

const MODULE_NAME = 'ServerConnection';

/** Refresh the access token when it expires within this window (the server checks it at handshake). */
const TOKEN_MIN_VALIDITY_MS = 60_000;
/** Log chunks kept while offline (oldest dropped first). */
const MAX_BUFFERED_CHUNKS = 2000;

/**
 * Connection events for the rest of the app:
 *  - 'authenticated'   the server accepted this client (fresh socket or after a reconnect); uploads resume
 *  - 'unauthenticated' the authenticated socket was lost
 *  - 'connected' / 'reconnected' (legacy names, emitted together with 'authenticated')
 */
const connectionEvents = new EventEmitter();
let everAuthenticated = false;

/** Credentials for the next handshake (see makePrepareAuth). */
const prepareAuth = makePrepareAuth({
  getAccessToken,
  hasUserSession: () => !!getRefreshToken(),
  refresh: async () => !!(await refreshToken()),
  getGuestToken,
  clearGuestToken,
  minValidityMs: TOKEN_MIN_VALIDITY_MS,
  log: (level, msg) => logger[level](MODULE_NAME, msg),
});

// Assume production by default, only use the development path if explicitly set
const socketPath = process.env.NODE_ENV === 'development' ? '/socket.io/' : '/production/socket.io/';

const link = new ServerLink({
  url: `${SERVER_URL}/client`,
  path: socketPath,
  io: (url, opts) => io(url, opts) as unknown as LinkSocket,
  prepareAuth,
  onGuestToken: (token) => setGuestToken(token),
  query: () => ({ hostname: os.hostname(), userAgent: getDetailedUserAgent(), clientId: getPersistedClientId() }),
  log: (level, msg) => logger[level](MODULE_NAME, msg),
});

function sendConnectionStatus(status: LinkStatus, attempts: number, nextDelay?: number) {
  logger.info(MODULE_NAME, `Connection status update: ${status} (attempts: ${attempts}${nextDelay !== undefined ? `, nextDelay: ${nextDelay}ms` : ''})`);
  getMainWindow()?.webContents.send('connection-status-changed', status, attempts, nextDelay);
}

link.on('status', (status: LinkStatus, _prev: LinkStatus, attempt: number) => sendConnectionStatus(status, attempt));
link.on('reconnect-scheduled', (attempt: number, delay: number) => sendConnectionStatus('disconnected', attempt, delay));
link.on('authenticated', () => {
  connectionEvents.emit(everAuthenticated ? 'reconnected' : 'connected');
  everAuthenticated = true;
  connectionEvents.emit('authenticated');
  flushLogBuffer();
});
link.on('unauthenticated', () => connectionEvents.emit('unauthenticated'));

let logChunkBuffer: Array<{ chunk: string; channel?: string }> = []; // chunks waiting for an authenticated socket (tagged with their game channel)
let flushing = false;

export function connectToServer(): void {
  if (!getAccessToken() && !getGuestToken() && !getRefreshToken() && !getPersistedClientId()) {
    logger.warn(MODULE_NAME, 'No access token, guest token, or clientId available. Cannot connect to server.');
    return;
  }
  link.start();
}

export function disconnectFromServer(): void {
  logger.info(MODULE_NAME, 'Disconnecting from server...');
  link.stop();
}

export function reconnectNow(): void {
  logger.info(MODULE_NAME, 'Manual reconnection requested');
  link.reconnectNow();
}

export function isConnected(): boolean {
  return link.connected;
}

/** Connected AND accepted by the server (what uploads need). */
export function isServerAuthenticated(): boolean {
  return link.authenticated;
}

export function getServerLink(): ServerLink {
  return link;
}

export function sendLogChunk(chunk: string, channel?: string): boolean {
  const payload = {
    clientId: getPersistedClientId(),
    chunk,
    ...(channel ? { channel } : {}), // Star Citizen channel (LIVE, PTU, ...) the chunk came from
  };
  // submit_log_chunk is never acknowledged by the server (void handler), so no ack watchdog here.
  if (!link.send('submit_log_chunk', payload)) {
    logger.warn(MODULE_NAME, 'Cannot send log chunk, not connected to server.');
    return false;
  }
  countLogUpload(chunk.length);
  return true;
}

/**
 * Send SC game telemetry (throttled snapshot or a batch of derived events) to the server.
 * Only while the server has authenticated this client as a signed-in user. Returns true when emitted.
 * The server acks every submit_telemetry; missing acks make the link re-authenticate.
 */
export function sendTelemetry(payload: TelemetryUploadPayload, channel?: string): boolean {
  const count = payload.kind === 'events' ? payload.events.length : 1;
  // The server only accepts telemetry from signed-in users (guests are rejected).
  if (!getAuthStatus().isAuthenticated) {
    countDropped(count);
    return false;
  }
  if (!link.authenticated) {
    countDropped(count);
    return false;
  }
  const body = { clientId: getPersistedClientId(), ...(channel ? { channel } : {}), ...payload };
  const bytes = JSON.stringify(body).length;
  const sent = link.sendWithAck('submit_telemetry', body, (ack?: { ok?: boolean; error?: string }) => {
    if (!ack || ack.ok === false) {
      countDropped(count);
      if (ack) logger.warn(MODULE_NAME, `Server rejected telemetry ${payload.kind}: ${ack.error ?? 'unknown'}`);
    }
  });
  if (!sent) {
    countDropped(count);
    return false;
  }
  countTelemetryUpload(payload.kind === 'snapshot' ? 'snapshot' : 'events', bytes, payload.kind === 'events' ? payload.events.length : 0);
  return true;
}

function flushLogBuffer(): void {
  if (flushing || !link.authenticated || logChunkBuffer.length === 0) return;
  flushing = true;
  logger.info(MODULE_NAME, `Flushing ${logChunkBuffer.length} buffered log chunks...`);
  const sendNext = () => {
    if (!logChunkBuffer.length) {
      flushing = false;
      logger.info(MODULE_NAME, 'Log buffer flushed successfully.');
      return;
    }
    if (!link.authenticated) {
      flushing = false;
      logger.warn(MODULE_NAME, `Connection lost during buffer flush. ${logChunkBuffer.length} chunks kept.`);
      return;
    }
    const next = logChunkBuffer.shift()!;
    sendLogChunk(next.chunk, next.channel);
    setTimeout(sendNext, 50);
  };
  sendNext();
}

/** Send now when the server has authenticated this client; otherwise buffer and make sure we are (re)connecting. */
export function ensureConnectedAndSendLogChunk(chunk: string, channel?: string): void {
  if (link.authenticated && !flushing && logChunkBuffer.length === 0) {
    sendLogChunk(chunk, channel);
    return;
  }
  // Keep order: queue behind chunks still waiting / being flushed.
  logChunkBuffer.push({ chunk, channel });
  if (logChunkBuffer.length > MAX_BUFFERED_CHUNKS) logChunkBuffer.splice(0, logChunkBuffer.length - MAX_BUFFERED_CHUNKS);
  if (link.authenticated) flushLogBuffer();
  else connectToServer();
}

link.onServer('processed_event', (event: any) => {
  logger.info(MODULE_NAME, `Processed event received from server: ${event?.type} ${event?.id}`);
  handleProcessedServerEvent(event);
});

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
    pushDebugEvent({ source: 'server', type: String(serverEvent?.type ?? 'event'), summary: clientEvent.eventDescription || String(serverEvent?.type ?? 'server event') });
    
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

export { connectionEvents };
