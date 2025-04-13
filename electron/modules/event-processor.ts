import { KillEvent, ProfileData } from '../../shared/types';
import { store, getFeedMode, getLastLoggedInUser } from './config-manager'; // Import necessary config functions
import { fetchRsiProfileData, defaultProfileData } from './rsi-scraper';
import { showNotification } from './notification-manager';
// import { sendKillToApi, LogMode } from './api-client.ts'; // Removed API client dependency
import { logKillToCsv } from './csv-logger.ts'; // Add .ts
import { getMainWindow } from './window-manager';
import { getCurrentUsername } from './log-parser.ts'; // To check involvement - Added .ts
import * as logger from './logger'; // Import the logger utility

const MODULE_NAME = 'EventProcessor'; // Define module name for logger

// --- Module State ---

const killEvents: KillEvent[] = []; // Player-involved events
const globalKillEvents: KillEvent[] = []; // All events
const MAX_KILL_EVENTS = 100; // Maximum number of kill events to store per array

// --- Helper Functions ---

// Helper to add/update an event in the global list and optionally the player list
export function addOrUpdateEvent(event: KillEvent): { isNew: boolean, wasPlayerInvolved: boolean } { // Added export
    const win = getMainWindow();
    const currentUsername = getCurrentUsername(); // Get current player username

    // Recalculate player involvement based on the latest data
    event.isPlayerInvolved = event.killers.includes(currentUsername || '') || event.victims.includes(currentUsername || '');

    let isNew = true;
    let wasPlayerInvolved = false; // Track previous involvement state

    // --- Global Events Update ---
    const existingGlobalIndex = globalKillEvents.findIndex(ev => ev.id === event.id);
    if (existingGlobalIndex !== -1) {
        isNew = false;
        // Preserve original player involvement status before update
        wasPlayerInvolved = globalKillEvents[existingGlobalIndex].isPlayerInvolved;
        // Replace existing event with the updated one
        globalKillEvents[existingGlobalIndex] = event;
        logger.debug(MODULE_NAME, 'Updated global event:', { id: event.id });
    } else {
        globalKillEvents.unshift(event); // Add new event to the top
        // Limit array size
        if (globalKillEvents.length > MAX_KILL_EVENTS) {
            globalKillEvents.pop();
        }
        logger.debug(MODULE_NAME, 'Added new global event:', { id: event.id });
    }

    // --- Player Events Update ---
    const existingPlayerIndex = killEvents.findIndex(ev => ev.id === event.id);

    if (event.isPlayerInvolved) {
        if (existingPlayerIndex !== -1) {
            // Already in player list, update it
            killEvents[existingPlayerIndex] = event;
            logger.debug(MODULE_NAME, 'Updated player event:', { id: event.id });
        } else {
            // New player-involved event, add to top
            killEvents.unshift(event);
            if (killEvents.length > MAX_KILL_EVENTS) {
                killEvents.pop();
            }
            logger.debug(MODULE_NAME, 'Added new player event:', { id: event.id });
        }
    } else {
        // Event does NOT involve player
        if (existingPlayerIndex !== -1) {
            // Was previously in player list, remove it
            killEvents.splice(existingPlayerIndex, 1);
            logger.debug(MODULE_NAME, 'Removed event', { id: event.id }, 'from player events (no longer involved).');
        }
        // If it wasn't in the player list and doesn't involve player, do nothing here.
    }

    // Send update to renderer
    win?.webContents.send('kill-feed-event', {
        event: event,
        source: event.isPlayerInvolved ? 'player' : 'global'
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

    // 3. Format Description
    fullEvent.eventDescription = formatKillEventDescription(
        fullEvent.killers,
        fullEvent.victims,
        fullEvent.vehicleType || 'Unknown',
        fullEvent.vehicleModel || 'Unknown',
        fullEvent.deathType,
        destructionLevel // Pass destruction level for context
    );

    // 4. Add/Update Event in Lists & Send to Renderer
    const { isNew } = addOrUpdateEvent(fullEvent); // This also sends 'kill-feed-event' IPC

    // 5. Trigger Side Effects (Notifications, API, CSV)
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
    targetEvent.victims = [playerName]; // Replace placeholder with actual player name

    logger.info(MODULE_NAME, 'Updated victim in event', { id: targetEvent.id }, 'from', { ship: originalVictimPlaceholder }, 'to', { victim: playerName });

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


    // Update description based on new victim info
    const destructionLevel = ['Hard', 'Combat', 'Collision', 'Crash'].includes(targetEvent.deathType) ? 2 : (targetEvent.deathType === 'Soft' ? 1 : 0);
    targetEvent.eventDescription = formatKillEventDescription(
        targetEvent.killers,
        targetEvent.victims, // Now contains player name
        targetEvent.vehicleType || 'Unknown Vehicle',
        targetEvent.vehicleModel || 'Unknown Model',
        targetEvent.deathType,
        destructionLevel
    );

    // Update player involvement flag & add/remove from player list if necessary
    const { wasPlayerInvolved } = addOrUpdateEvent(targetEvent); // This handles list management and renderer update

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

    if (damageType === 'Collision' || damageType === 'Crash') {
        return isSelfInflicted ? 'Crash' : 'Collision';
    }
    if (level === 1) return 'Soft';
    if (level >= 2) return 'Hard';

    // Fallback if level is 0 or damage type isn't collision/crash
    // If caused by environment or self, maybe 'Unknown'? Otherwise 'Combat'.
    if (caused_by === 'Environment') return 'Unknown'; // Or specific environmental type if known
    if (isSelfInflicted) return 'Unknown'; // Or 'Crash' if appropriate? Needs context.

    return 'Combat'; // Default assumption for external damage
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

export function getKillEvents(limit = MAX_KILL_EVENTS): KillEvent[] {
    return killEvents.slice(0, Math.min(limit, killEvents.length));
}

export function getGlobalKillEvents(limit = MAX_KILL_EVENTS): KillEvent[] {
    return globalKillEvents.slice(0, Math.min(limit, globalKillEvents.length));
}

// Clears all in-memory events (used for rescan/debug)
export function clearEvents(): void {
    killEvents.length = 0;
    globalKillEvents.length = 0;
    logger.info(MODULE_NAME, "Cleared in-memory kill events.");
    // Notify renderer to clear its display as well
    const win = getMainWindow();
    win?.webContents.send('kill-feed-event', null); // Send null event to signal clear
}