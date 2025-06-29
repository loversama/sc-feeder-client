import { KillEvent, ProfileData } from '../../shared/types';
import { store, getFeedMode, getLastLoggedInUser } from './config-manager'; // Import necessary config functions
import { fetchRsiProfileData, defaultProfileData } from './rsi-scraper';
import { showNotification } from './notification-manager';
// import { sendKillToApi, LogMode } from './api-client.ts'; // Removed API client dependency
import { logKillToCsv } from './csv-logger.ts'; // Add .ts
import { getMainWindow } from './window-manager';
import { getCurrentUsername } from './log-parser.ts'; // To check involvement - Added .ts
import * as logger from './logger'; // Import the logger utility
import { getEntityName } from './definitionsService'; // Import for readable names
import { getEventStore as getEventStoreInstance, type EventStore } from './event-store';
import { getOrInitializeEventStore, getInitializedEventStore } from './event-store-manager';

const MODULE_NAME = 'EventProcessor'; // Define module name for logger

// --- Module State (Migrated to EventStore) ---

// Legacy arrays - maintained for compatibility but now backed by EventStore
const killEvents: KillEvent[] = []; // Player-involved events (legacy)
const globalKillEvents: KillEvent[] = []; // All events (legacy)
const MAX_KILL_EVENTS = 25; // Maximum number of kill events to store per array (legacy, reduced for testing)

// EventStore instance
let eventStore: EventStore;

// --- Helper Functions ---

/**
 * Initialize the EventStore
 */
export async function initializeEventProcessor(): Promise<void> {
    try {
        logger.info(MODULE_NAME, 'Initializing EventProcessor with EventStore...');
        
        logger.debug(MODULE_NAME, 'Getting EventStore instance...');
        eventStore = getEventStoreInstance();
        logger.debug(MODULE_NAME, 'EventStore instance obtained');
        
        logger.debug(MODULE_NAME, 'Initializing EventStore...');
        await eventStore.initialize();
        logger.debug(MODULE_NAME, 'EventStore initialization completed');
        
        // Set up event listeners for UI updates
        logger.debug(MODULE_NAME, 'Setting up EventStore event listeners...');
        eventStore.on('events-updated', (events: KillEvent[]) => {
            // Update legacy arrays for compatibility
            globalKillEvents.length = 0;
            globalKillEvents.push(...events);
            
            killEvents.length = 0;
            const playerEvents = events.filter(e => e.isPlayerInvolved);
            killEvents.push(...playerEvents);
            
            logger.debug(MODULE_NAME, `Updated legacy arrays: ${events.length} total, ${playerEvents.length} player events`);
        });
        logger.debug(MODULE_NAME, 'Event listeners set up successfully');
        
        logger.info(MODULE_NAME, 'EventProcessor initialized successfully');
    } catch (error) {
        logger.error(MODULE_NAME, 'Failed to initialize EventProcessor:', error);
        logger.error(MODULE_NAME, 'Initialization error details:', {
            message: error instanceof Error ? error.message : 'Unknown error',
            stack: error instanceof Error ? error.stack : undefined,
            eventStoreExists: eventStore ? 'yes' : 'no'
        });
        throw error;
    }
}

// Helper to add/update an event using the new EventStore
export async function addOrUpdateEvent(event: KillEvent, source: 'local' | 'server' | 'merged' = 'local'): Promise<{ isNew: boolean, wasPlayerInvolved: boolean }> {
    if (!eventStore) {
        logger.warn(MODULE_NAME, 'EventStore not initialized, using legacy behavior');
        return addOrUpdateEventLegacy(event);
    }

    try {
        const result = await eventStore.addEvent(event, source);
        
        // EventStore handles all the persistence, deduplication, and UI updates
        // Just return compatibility info for existing code
        return { 
            isNew: result.isNew, 
            wasPlayerInvolved: false // EventStore doesn't track this legacy state
        };
    } catch (error) {
        logger.error(MODULE_NAME, 'Failed to add event to EventStore:', error);
        // Fall back to legacy behavior
        return addOrUpdateEventLegacy(event);
    }
}

// Legacy event handling for fallback
function addOrUpdateEventLegacy(event: KillEvent): { isNew: boolean, wasPlayerInvolved: boolean } {
    const win = getMainWindow();
    const currentUsername = getCurrentUsername();

    // Recalculate player involvement
    event.isPlayerInvolved = event.killers.includes(currentUsername || '') || event.victims.includes(currentUsername || '');

    let isNew = true;
    let wasPlayerInvolved = false;

    // Simple duplicate check by ID
    const existingGlobalIndex = globalKillEvents.findIndex(ev => ev.id === event.id);
    if (existingGlobalIndex !== -1) {
        isNew = false;
        wasPlayerInvolved = globalKillEvents[existingGlobalIndex].isPlayerInvolved;
        globalKillEvents[existingGlobalIndex] = event;
    } else {
        globalKillEvents.unshift(event);
        if (globalKillEvents.length > MAX_KILL_EVENTS) {
            globalKillEvents.pop();
        }
    }

    // Update player events
    const existingPlayerIndex = killEvents.findIndex(ev => ev.id === event.id);
    if (event.isPlayerInvolved) {
        if (existingPlayerIndex !== -1) {
            killEvents[existingPlayerIndex] = event;
        } else {
            killEvents.unshift(event);
            if (killEvents.length > MAX_KILL_EVENTS) {
                killEvents.pop();
            }
        }
    } else if (existingPlayerIndex !== -1) {
        killEvents.splice(existingPlayerIndex, 1);
    }

    // Send to renderer
    win?.webContents.send('kill-feed-event', {
        event: event,
        source: 'local'
    });

    return { isNew, wasPlayerInvolved };
}


// --- Core Event Processing Logic ---

// Receives partial event data, fetches RSI data, formats, adds/updates, and triggers side effects
export async function processKillEvent(partialEvent: Partial<KillEvent>, silentMode: boolean, destructionLevel: number = 0) {
    const win = getMainWindow();
    const currentUsername = getCurrentUsername();

    if (!partialEvent.id || !partialEvent.timestamp) {
        logger.error(MODULE_NAME, "Received partial event without id or timestamp. Skipping.", partialEvent);
        return;
    }

    // 1. Fetch RSI Data (if enabled)
    let profileDataMap: Record<string, ProfileData> = {};
    // Combine killers and victims, filter out 'Environment' and 'unknown'/'placeholder' names
    const playersToFetch = [
        ...(partialEvent.killers || []),
        ...(partialEvent.victims || [])
    ].filter(p => p && p !== 'Environment' && !p.includes('_') && p.toLowerCase() !== 'unknown'); // Basic filter

    const attackers = (partialEvent.killers || []).filter(p => p && p !== 'Environment' && p.toLowerCase() !== 'unknown');

    if (playersToFetch.length > 0) {
        try {
            profileDataMap = await fetchRsiProfileData(playersToFetch, attackers);
        } catch (err) {
            logger.error(MODULE_NAME, 'Error fetching RSI data for event', { id: partialEvent.id }, ':', err);
        }
    }

    // 2. Construct Full Event Object
    // Find existing event data if it's an update
    const existingEvent = globalKillEvents.find(ev => ev.id === partialEvent.id);

    // Merge partial data, existing data (if any), and default RSI data
    const victimName = partialEvent.victims?.[0] || 'Unknown';
    const killerName = partialEvent.killers?.[0] || 'Unknown';

    const victimRsiData = profileDataMap[victimName] || existingEvent || defaultProfileData;
    const attackerRsiData = profileDataMap[killerName] || existingEvent || defaultProfileData;


    // Debug logging for death type determination
    if (!partialEvent.deathType || partialEvent.deathType === 'Unknown') {
        logger.warn(MODULE_NAME, 'Event with Unknown or missing death type:', {
            id: partialEvent.id,
            deathType: partialEvent.deathType,
            damageType: partialEvent.damageType,
            killers: partialEvent.killers,
            victims: partialEvent.victims,
            vehicleType: partialEvent.vehicleType
        });
    }

    const fullEvent: KillEvent = {
        // Base required fields
        id: partialEvent.id,
        timestamp: partialEvent.timestamp,
        killers: partialEvent.killers || ['Unknown'],
        victims: partialEvent.victims || ['Unknown'],
        deathType: partialEvent.deathType || 'Unknown',
        eventDescription: '', // Will be formatted below
        isPlayerInvolved: partialEvent.isPlayerInvolved ?? false, // Default to false if not provided

        // Optional fields from partial event or existing event or defaults
        vehicleType: partialEvent.vehicleType || existingEvent?.vehicleType || 'Player',
        vehicleModel: partialEvent.vehicleModel || existingEvent?.vehicleModel || partialEvent.vehicleType || 'Player', // Fallback chain
        vehicleId: partialEvent.vehicleId || existingEvent?.vehicleId,
        location: partialEvent.location || existingEvent?.location,
        weapon: partialEvent.weapon || existingEvent?.weapon,
        damageType: partialEvent.damageType || existingEvent?.damageType,
        gameMode: partialEvent.gameMode || existingEvent?.gameMode || 'Unknown',
        gameVersion: partialEvent.gameVersion || existingEvent?.gameVersion,
        coordinates: partialEvent.coordinates || existingEvent?.coordinates,
        playerShip: partialEvent.playerShip || existingEvent?.playerShip, // Player's ship at time of event

        // Victim RSI Data (prioritize fresh scrape, then existing, then default)
        victimEnlisted: victimRsiData.victimEnlisted || '-',
        victimRsiRecord: victimRsiData.victimRsiRecord || '-',
        victimOrg: victimRsiData.victimOrg || '-',
        victimPfpUrl: victimRsiData.victimPfpUrl || defaultProfileData.victimPfpUrl,

        // Attacker RSI Data (prioritize fresh scrape, then existing, then default)
        attackerEnlisted: attackerRsiData.attackerEnlisted || '-',
        attackerRsiRecord: attackerRsiData.attackerRsiRecord || '-',
        attackerOrg: attackerRsiData.attackerOrg || '-',
        attackerPfpUrl: attackerRsiData.attackerPfpUrl || defaultProfileData.attackerPfpUrl,

        // Added for details window context
        playerName: currentUsername || ''
    };

    // 3. Resolve Entity Names before formatting description
    // Ensure we are working with copies if direct modification is not intended,
    // but for this case, modifying fullEvent directly before description formatting is fine.
    fullEvent.killers = fullEvent.killers.map(id => getEntityName(id));
    fullEvent.victims = fullEvent.victims.map(id => getEntityName(id));
    // If vehicleType or vehicleModel can also be entity IDs, resolve them too:
    // fullEvent.vehicleType = getEntityName(fullEvent.vehicleType || 'Unknown');
    // fullEvent.vehicleModel = getEntityName(fullEvent.vehicleModel || 'Unknown');
    // For now, assuming only killers and victims are entity IDs needing resolution.

    // 4. Format Description
    fullEvent.eventDescription = formatKillEventDescription(
        fullEvent.killers, // Now contains resolved names
        fullEvent.victims, // Now contains resolved names
        fullEvent.vehicleType || 'Unknown',
        fullEvent.vehicleModel || 'Unknown',
        fullEvent.deathType,
        destructionLevel // Pass destruction level for context
    );

    // 5. Add/Update Event in Lists & Send to Renderer
    const { isNew } = await addOrUpdateEvent(fullEvent, 'local'); // This also sends 'kill-feed-event' IPC

    // 6. Trigger Side Effects (Notifications, API, CSV)
    // Only trigger for significant events (e.g., hard death, collision, combat kill)
    // and potentially only for new events or significant updates?
    const isSignificantEvent = ['Hard', 'Combat', 'Collision', 'Crash', 'BleedOut', 'Suffocation'].includes(fullEvent.deathType);

    if (isSignificantEvent) {
        // Log to CSV directly (API call removed)
        logKillToCsv(fullEvent)
            .catch((err: any) => logger.error(MODULE_NAME, 'Error logging event to CSV', { id: fullEvent.id }, ':', err));

        // Show Notification (if not silent mode and player involved)
        if (!silentMode && fullEvent.isPlayerInvolved) {
            showNotification(
                `${fullEvent.deathType} Event`, // More specific title
                fullEvent.eventDescription
            );
        }
    }

    // Send status update
    win?.webContents.send('log-status', `Event: ${fullEvent.eventDescription}`);
    // Use structured logging for the processed event message
    logger.info(
        MODULE_NAME,
        'Processed event:',
        fullEvent.eventDescription, // Keep description as is for now, or break it down further if needed
        `(Silent: ${silentMode}, New: ${isNew}, Involved: ${fullEvent.isPlayerInvolved})`
    );
}


// --- Correlation Logic ---

// Tries to correlate a player death log with a recent vehicle destruction event
export async function correlateDeathWithDestruction(timestamp: string, playerName: string, silentMode: boolean) {
    const timestampMs = new Date(timestamp).getTime();
    const win = getMainWindow();
    const currentUsername = getCurrentUsername();

    logger.debug(MODULE_NAME, 'Attempting correlation for player death:', { victim: playerName }, 'at', timestamp);

    let targetEvent: KillEvent | null = null;
    let targetEventIndex = -1; // Index in globalKillEvents

    // Search global events for a potential match (vehicle destruction placeholder)
    targetEvent = globalKillEvents.find((event, index) => {
        // Basic criteria: Is it a vehicle event? Is the victim a placeholder (vehicle name)? Is it recent?
        if (event.id.startsWith('v_kill_') && // Check if it's a vehicle kill ID
            event.victims.length === 1 && // Usually starts with one victim
            event.victims[0] === event.vehicleType && // Victim is the placeholder vehicle type
            Math.abs(timestampMs - new Date(event.timestamp).getTime()) < 15000 // 15 sec window
           )
        {
            targetEventIndex = index;
            return true;
        }
        return false;
    }) || null;

    if (!targetEvent) {
        logger.debug(MODULE_NAME, 'Correlation: No recent vehicle destruction placeholder found for player', { victim: playerName });
        // Optional: Create a simple 'Player Death' event if no correlation?
        // For now, do nothing if no correlation.
        return;
    }

    logger.info(MODULE_NAME, 'Correlation: Found event', { id: targetEvent.id }, 'to update for player', { victim: playerName });

    // --- Update the Found Event ---
    const originalVictimPlaceholder = targetEvent.victims[0]; // Should be vehicleType
    // Resolve playerName just in case it's an ID, though typically it's a name here.
    // More importantly, ensure killers are resolved if they haven't been already.
    targetEvent.victims = [getEntityName(playerName)]; // Replace placeholder with actual player name (resolved)

    logger.info(MODULE_NAME, 'Updated victim in event', { id: targetEvent.id }, 'from', { ship: originalVictimPlaceholder }, 'to', { victim: targetEvent.victims[0] });

    // Fetch RSI data for the newly identified player victim (async)
    fetchRsiProfileData([playerName], []).then(profileDataMap => {
         if (targetEvent && profileDataMap[playerName]) { // Check event still exists and data was fetched
             const victimData = profileDataMap[playerName];
             targetEvent.victimEnlisted = victimData.victimEnlisted || '-';
             targetEvent.victimRsiRecord = victimData.victimRsiRecord || '-';
             targetEvent.victimOrg = victimData.victimOrg || '-';
             targetEvent.victimPfpUrl = victimData.victimPfpUrl || defaultProfileData.victimPfpUrl;
             logger.debug(MODULE_NAME, 'Updated RSI data for correlated victim', { victim: playerName }, 'in event', { id: targetEvent.id });
             // Re-send the updated event to the renderer
             addOrUpdateEvent(targetEvent); // Use helper to update and resend
         }
     }).catch(err => logger.error(MODULE_NAME, 'Error fetching RSI data for correlated victim', { victim: playerName }, ':', err));


    // Resolve killer names for the correlated event as well, as they might not have been if the event was processed before definitions were ready
    // or if this is an older event being updated.
    targetEvent.killers = targetEvent.killers.map(id => getEntityName(id));

    // Update description based on new victim info (and potentially resolved killer names)
    const destructionLevel = ['Hard', 'Combat', 'Collision', 'Crash'].includes(targetEvent.deathType) ? 2 : (targetEvent.deathType === 'Soft' ? 1 : 0);
    targetEvent.eventDescription = formatKillEventDescription(
        targetEvent.killers, // Now contains resolved names
        targetEvent.victims, // Now contains resolved player name
        targetEvent.vehicleType || 'Unknown Vehicle', // Potentially resolve if it can be an ID: getEntityName(targetEvent.vehicleType || 'Unknown Vehicle')
        targetEvent.vehicleModel || 'Unknown Model',   // Potentially resolve: getEntityName(targetEvent.vehicleModel || 'Unknown Model')
        targetEvent.deathType,
        destructionLevel
    );

    // Update player involvement flag & add/remove from player list if necessary
    const { wasPlayerInvolved } = await addOrUpdateEvent(targetEvent, 'local'); // This handles list management and renderer update

    // Show notification if player involvement changed or was already involved
    if (!silentMode && targetEvent.isPlayerInvolved) {
         showNotification(
             `${targetEvent.deathType} Event`,
             targetEvent.eventDescription
         );
    }

    // Decide if/how to update API/CSV. Sending again might create duplicates.
    // Let's skip re-sending for now to avoid duplicates.
    logger.debug(MODULE_NAME, 'Correlation: Skipping API/CSV update for event', { id: targetEvent.id }, 'after correlation.');
}


// --- Formatting and Type Determination ---
// Moved from main.ts

export function determineDeathType(
    level: number,
    damageType: string,
    caused_by: string,
    driver: string | null
): KillEvent['deathType'] {
    const isSelfInflicted = (caused_by === 'unknown' || (driver && caused_by === driver));
    
    logger.debug(MODULE_NAME, 'Determining death type:', {
        level,
        damageType,
        caused_by,
        driver,
        isSelfInflicted
    });

    // Handle specific damage types first (highest priority)
    if (damageType === 'Collision' || damageType === 'Crash') {
        const result = isSelfInflicted ? 'Crash' : 'Collision';
        logger.debug(MODULE_NAME, `Death type determined (collision): ${result}`);
        return result;
    }
    
    if (damageType === 'BleedOut') {
        logger.debug(MODULE_NAME, 'Death type determined (bleed): BleedOut');
        return 'BleedOut';
    }
    if (damageType === 'SuffocationDamage') {
        logger.debug(MODULE_NAME, 'Death type determined (suffocation): Suffocation');
        return 'Suffocation';
    }
    if (damageType === 'Combat') {
        // Combat damage should prioritize destruction level
        if (level >= 2) {
            logger.debug(MODULE_NAME, `Death type determined (combat level ${level}): Hard`);
            return 'Hard';
        }
        if (level === 1) {
            logger.debug(MODULE_NAME, 'Death type determined (combat level 1): Soft');
            return 'Soft';
        }
        // Level 0 combat damage
        logger.debug(MODULE_NAME, 'Death type determined (combat level 0): Combat');
        return 'Combat';
    }
    
    // Handle destruction levels (high priority)
    if (level === 1) {
        logger.debug(MODULE_NAME, 'Death type determined (level 1): Soft');
        return 'Soft';
    }
    if (level >= 2) {
        logger.debug(MODULE_NAME, `Death type determined (level ${level}): Hard`);
        return 'Hard';
    }
    
    // Handle environmental causes more intelligently
    if (caused_by === 'Environment') {
        // For environmental damage, try to infer from damage type
        if (damageType && damageType !== 'Unknown') {
            // Return the damage type as death type for environmental
            logger.debug(MODULE_NAME, `Environmental death with damage type: ${damageType} -> Unknown`);
            return 'Unknown'; // Keep as Unknown for now, but log for investigation
        }
        logger.debug(MODULE_NAME, 'Death type determined (environment): Unknown');
        return 'Unknown';
    }
    
    // Handle self-inflicted damage more intelligently
    if (isSelfInflicted) {
        // If there's vehicle destruction, it's likely a crash
        if (level > 0) {
            logger.debug(MODULE_NAME, `Death type determined (self-inflicted level ${level}): Crash`);
            return 'Crash';
        }
        // Otherwise, unknown self-inflicted damage
        logger.debug(MODULE_NAME, 'Death type determined (self-inflicted level 0): Unknown');
        return 'Unknown';
    }
    
    // Combat damage from external sources
    if (level === 0 && caused_by && caused_by !== 'unknown') {
        // Level 0 damage from external source - could be light combat
        logger.debug(MODULE_NAME, 'Death type determined (level 0 external): Combat');
        return 'Combat';
    }

    const result = 'Combat'; // Default assumption for external damage
    logger.debug(MODULE_NAME, `Death type determined: ${result}`);
    return result;
}


export function formatKillEventDescription(
    killers: string[],
    victims: string[],
    vehicleType: string,
    vehicleModel: string,
    deathType: KillEvent['deathType'],
    destructionLevel: number = 0
): string {
    const isVictimShipPlaceholder = victims.length === 1 && victims[0] === vehicleType; // Check if victim is placeholder
    const victimName = isVictimShipPlaceholder ? vehicleType.replace(/_/g, ' ') : (victims.join(' + ') || 'Unknown');
    const validKillers = killers.filter(k => k && k !== 'unknown' && k !== 'Environment');
    const killerName = validKillers.join(' + ') || (killers.includes('Environment') ? 'Environment' : 'Unknown');
    const craftName = vehicleModel !== 'Player' ? vehicleModel.replace(/_/g, ' ') : '';

    switch (deathType) {
        case 'Suffocation': return `${victimName} suffocated`;
        case 'BleedOut': return `${victimName} bled out`;
        case 'Crash': return `${victimName}${craftName ? ` (${craftName})` : ''} crashed`;
        case 'Collision':
            if (validKillers.length > 0) {
                return isVictimShipPlaceholder
                    ? `${killerName}'s vessel collided with ${victimName}`
                    : `${killerName} collided with ${victimName}${craftName ? ` (${craftName})` : ''}`;
            } else {
                return `A collision occurred involving ${victimName}${craftName ? ` (${craftName})` : ''}`; // Collision with unknown cause
            }
        case 'Soft':
            return isVictimShipPlaceholder
                ? `${killerName} disabled ${victimName}`
                : `${killerName} disabled ${victimName}${craftName ? `'s ${craftName}` : ''}`;
        case 'Hard':
        case 'Combat': // Treat Combat similar to Hard for description
             return isVictimShipPlaceholder
                 ? `${killerName} destroyed ${victimName}`
                 : `${killerName} destroyed ${victimName}${craftName ? `'s ${craftName}` : ''}`;
        default: // Unknown or other types
            if (killers.includes('Environment')) return `${victimName} succumbed to environmental factors`;
            return `${killerName} defeated ${victimName}`;
    }
}


// --- Accessors and Management ---

export async function getKillEvents(limit = MAX_KILL_EVENTS): Promise<KillEvent[]> {
    logger.debug(MODULE_NAME, `getKillEvents called with limit ${limit}`);
    
    // Ensure EventStore is initialized
    if (!eventStore) {
        logger.info(MODULE_NAME, 'EventStore not initialized when getting player events, initializing now...');
        try {
            eventStore = await getOrInitializeEventStore();
        } catch (error) {
            logger.error(MODULE_NAME, 'Failed to initialize EventStore for getKillEvents:', error);
            // Fallback to legacy array
            logger.debug(MODULE_NAME, `EventStore initialization failed, using legacy array with ${killEvents.length} events`);
            return killEvents.slice(0, Math.min(limit, killEvents.length));
        }
    }
    
    if (eventStore) {
        // Get events from EventStore with player filter
        const memoryEvents = eventStore.getMemoryEvents();
        const playerEvents = memoryEvents.filter(e => e.isPlayerInvolved);
        logger.debug(MODULE_NAME, `EventStore available, returning ${playerEvents.length} player events from ${memoryEvents.length} total`);
        return playerEvents.slice(0, Math.min(limit, playerEvents.length));
    }
    
    // Fallback to legacy array
    logger.debug(MODULE_NAME, `EventStore not available, using legacy array with ${killEvents.length} events`);
    return killEvents.slice(0, Math.min(limit, killEvents.length));
}

export async function getGlobalKillEvents(limit = MAX_KILL_EVENTS): Promise<KillEvent[]> {
    logger.debug(MODULE_NAME, `getGlobalKillEvents called with limit ${limit}`);
    
    // Ensure EventStore is initialized
    if (!eventStore) {
        logger.info(MODULE_NAME, 'EventStore not initialized when getting events, initializing now...');
        try {
            eventStore = await getOrInitializeEventStore();
        } catch (error) {
            logger.error(MODULE_NAME, 'Failed to initialize EventStore for getGlobalKillEvents:', error);
            // Fallback to legacy array
            logger.debug(MODULE_NAME, `EventStore initialization failed, using legacy array with ${globalKillEvents.length} events`);
            return globalKillEvents.slice(0, Math.min(limit, globalKillEvents.length));
        }
    }
    
    if (eventStore) {
        // Get events from EventStore
        const memoryEvents = eventStore.getMemoryEvents();
        logger.debug(MODULE_NAME, `EventStore available, returning ${memoryEvents.length} memory events`);
        return memoryEvents.slice(0, Math.min(limit, memoryEvents.length));
    }
    
    // Fallback to legacy array
    logger.debug(MODULE_NAME, `EventStore not available, using legacy array with ${globalKillEvents.length} events`);
    return globalKillEvents.slice(0, Math.min(limit, globalKillEvents.length));
}

// Clears all events (used for rescan/debug)
export async function clearEvents(): Promise<void> {
    if (eventStore) {
        await eventStore.clearAllEvents();
        logger.info(MODULE_NAME, "Cleared all events via EventStore.");
    } else {
        // Legacy behavior
        killEvents.length = 0;
        globalKillEvents.length = 0;
        logger.info(MODULE_NAME, "Cleared in-memory kill events (legacy).");
        // Notify renderer to clear its display as well
        const win = getMainWindow();
        win?.webContents.send('kill-feed-event', null); // Send null event to signal clear
    }
}

// New EventStore accessor functions
export function getCurrentEventStore(): EventStore | null {
    return eventStore || null;
}

export async function searchEvents(query: string, limit = 25, offset = 0) {
    try {
        // Ensure EventStore is initialized
        if (!eventStore) {
            logger.info(MODULE_NAME, 'EventStore not initialized when searching, initializing now...');
            eventStore = await getOrInitializeEventStore();
        }
        
        logger.debug(MODULE_NAME, `Searching for "${query}" (limit: ${limit}, offset: ${offset})`);
        const result = await eventStore.searchEvents(query, limit, offset);
        logger.debug(MODULE_NAME, `Search returned ${result.events.length} results (hasMore: ${result.hasMore})`);
        return result;
    } catch (error) {
        logger.error(MODULE_NAME, `Search failed for query "${query}":`, error);
        // Return empty results instead of throwing
        return { events: [], total: 0, hasMore: false };
    }
}

export async function loadMoreEvents(limit = 25, offset = 0) {
    try {
        // Ensure EventStore is initialized
        if (!eventStore) {
            logger.info(MODULE_NAME, 'EventStore not initialized when loading more, initializing now...');
            eventStore = await getOrInitializeEventStore();
        }
        
        return await eventStore.loadMoreEvents({ limit, offset });
    } catch (error) {
        logger.error(MODULE_NAME, 'Failed to load more events:', error);
        return { events: [], hasMore: false, totalLoaded: 0 };
    }
}

export function getEventStoreStats() {
    if (!eventStore) {
        return null;
    }
    return eventStore.getStats();
}