import { store, getLastLoggedInUser, setLastLoggedInUser, getFetchProfileData } from './config-manager.ts'; // Add .ts
import { showNotification } from './notification-manager.ts'; // Add .ts
import { getMainWindow } from './window-manager.ts'; // Add .ts
import { startNewSession } from './session-manager.ts'; // Add .ts
import { fetchRsiProfileData, defaultProfileData } from './rsi-scraper.ts'; // Add .ts
import { processKillEvent, addOrUpdateEvent, correlateDeathWithDestruction, formatKillEventDescription, determineDeathType, getKillEvents, getGlobalKillEvents, clearEvents } from './event-processor.ts'; // Import addOrUpdateEvent instead of addOrUpdateGlobalEvent
import { resolveEntityName, getEntityName, isNpcEntity } from './definitionsService.ts'; // Import entity resolution functions
import { KillEvent, PlayerDeath } from '../../shared/types';
import * as logger from './logger'; // Import the logger utility

// Enhanced zone hierarchy imports
import { ZoneHistoryManager } from './zone-history-manager';
import { ZoneResolver } from './zone-resolver';
import { ZoneClassifier } from './zone-classifier';
import {
  ZoneResolution,
  EnhancedEventZoneInfo,
  EventZoneMetadata,
  LocationServiceState,
  ZoneHistoryEntry
} from '../../shared/zone-types';

const MODULE_NAME = 'LogParser'; // Define module name for logger

// --- Module State ---
// FILTERING NOTE: This module now filters client-generated events to only process those where
// the current user is involved (as killer or victim). Server-sent events bypass this filtering
// and are handled separately by the server-connection module.
// State variables specific to parsing context
let currentUsername: string | null = getLastLoggedInUser() || null; // Initialize from store
let currentPlayerShip: string = "Unknown";
let stableGameMode: 'PU' | 'AC' | 'Unknown' = "Unknown"; // The mode we report and use for events
let rawDetectedGameMode: 'PU' | 'AC' | 'Unknown' = "Unknown"; // Last mode seen directly in logs
let lastRawModeDetectionTime: number = 0;
let modeDebounceTimer: NodeJS.Timeout | null = null;
const MODE_DEBOUNCE_MS = 2000; // 2 seconds threshold - adjust as needed

let currentGameVersion: string = "";
let currentLocation: string = ""; // Legacy location tracking for backward compatibility
let locationHistory: Array<{timestamp: string, location: string, source: string}> = []; // Legacy history for debugging

// Enhanced zone management
let zoneHistoryManager: ZoneHistoryManager | null = null;
let isZoneSystemInitialized = false;

// Global event queue to correlate vehicle destruction with corpse logs (managed by event-processor now)
// const pendingDestructionEvents: PendingVehicleDestruction[] = []; // Moved
// const killEvents: KillEvent[] = []; // Moved
// const globalKillEvents: KillEvent[] = []; // Moved
const recentPlayerDeaths: PlayerDeath[] = []; // Track recent player deaths for correlation (internal to parser?) - Let's keep this here for now for correlation logic within parse
const MAX_KILL_EVENTS = 100; // Keep limit definition if needed by processor logic moved here, otherwise move to processor. Let's assume processor handles limits.

// --- Constants ---

// Ship manufacturer prefixes
const shipManufacturers = [
  "ORIG", "CRUS", "RSI", "AEGS", "VNCL", "DRAK", "ANVL", "BANU",
  "MISC", "CNOU", "XIAN", "GAMA", "TMBL", "ESPR", "KRIG", "GRIN",
  "XNAA", "MRAI"
];
const shipManufacturerPattern = `^(${shipManufacturers.join('|')})`;

// --- Regular Expressions ---
const loginRegex = /<AccountLoginCharacterStatus_Character>.*?name\s+(\S+)\s+-/;
const legacyLoginRegex = /<Legacy login response>.*?Handle\[([A-Za-z0-9_-]+)\]/;
const sessionStartRegex = /<(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)>.*?Starting new game session/i;
const puModeRegex = /Loading GameModeRecord='SC_Default'/; // Detects PU loading
const acModeRegex = /Loading GameModeRecord='EA_.*?'/; // Detects AC loading (any EA mode)
const frontendModeRegex = /Requesting game mode Frontend_Main\/SC_Frontend|Loading screen for Frontend_Main : SC_Frontend closed/; // Detects entering Frontend
const loadoutRegex = /\[InstancedInterior\] OnEntityLeaveZone - InstancedInterior \[(?<InstancedInterior>[^\]]+)\] \[\d+\] -> Entity \[(?<Entity>[^\]]+)\] \[\d+\] --.*?m_ownerGEID\[(?<OwnerGEID>[^\[]+)\]/;
const vehicleDestructionRegex = /<(?<timestamp>\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)> \[Notice\] <Vehicle Destruction>.*?Vehicle '(?<vehicle>[^']+)' \[\d+\] in zone '(?<vehicle_zone>[^']+)' \[pos x: (?<pos_x>[-\d\.]+), y: (?<pos_y>[-\d\.]+), z: (?<pos_z>[-\d\.]+) .*? driven by '(?<driver>[^']+)' \[\d+\] advanced from destroy level (?<destroy_level_from>\d+) to (?<destroy_level_to>\d+) caused by '(?<caused_by>[^']+)' \[\d+\] with '(?<damage_type>[^']+)'/;
const cleanupPattern = /^(.+?)_\d+$/;
const versionPattern = /--system-trace-env-id='pub-sc-alpha-(?<gameversion>\d{3,4}-\d{7})'/;

// Initialize enhanced zone system
function initializeZoneSystem(): void {
    if (!isZoneSystemInitialized) {
        try {
            ZoneResolver.initialize();
            zoneHistoryManager = new ZoneHistoryManager({
                maxHistorySize: 10,
                persistToStorage: true,
                debugLogging: false
            });
            isZoneSystemInitialized = true;
            logger.info(MODULE_NAME, 'Enhanced zone hierarchy system initialized');
        } catch (error) {
            logger.error(MODULE_NAME, 'Failed to initialize zone system:', error);
            // Fallback to legacy system
            zoneHistoryManager = null;
            isZoneSystemInitialized = false;
        }
    }
}

// Enhanced location processing with zone hierarchy
function processLocationDataEnhanced(
    rawLocation: string | undefined, 
    coordinates?: {x: number, y: number, z: number}, 
    source: string = 'unknown',
    timestamp?: string
): {
    location: string;
    coordinates?: {x: number, y: number, z: number};
    locationSource: 'event' | 'fallback' | 'unknown';
    zoneInfo?: EnhancedEventZoneInfo;
    zoneResolution?: ZoneResolution;
} {
    // Initialize zone system if needed
    initializeZoneSystem();
    
    let processedLocation: string;
    let locationSource: 'event' | 'fallback' | 'unknown';
    let zoneInfo: EnhancedEventZoneInfo | undefined;
    let zoneResolution: ZoneResolution | undefined;
    
    if (rawLocation && rawLocation.trim() !== '') {
        // Keep raw location without cleanup
        const cleanLocation = rawLocation;
        
        // Enhanced zone processing
        if (zoneHistoryManager && isZoneSystemInitialized) {
            try {
                zoneResolution = zoneHistoryManager.addZoneToHistory(cleanLocation, source, coordinates, timestamp);
                zoneInfo = createEnhancedZoneInfo(zoneResolution);
                processedLocation = zoneInfo.displayLocation;
                locationSource = 'event';
                
                logger.debug(MODULE_NAME, `Enhanced zone processed: ${processedLocation} (${zoneResolution.zone.classification}, ${zoneResolution.zone.system})`);
            } catch (error) {
                logger.warn(MODULE_NAME, `Zone processing failed, using legacy method:`, error);
                // Fallback to legacy processing
                processedLocation = cleanLocation;
                locationSource = 'event';
            }
        } else {
            // Legacy processing
            processedLocation = cleanLocation;
            locationSource = 'event';
        }
        
        // Update legacy tracking for backward compatibility
        if (processedLocation !== currentLocation) {
            currentLocation = processedLocation;
            locationHistory.push({
                timestamp: timestamp || new Date().toISOString(),
                location: processedLocation,
                source: source
            });
            // Keep only last 50 location changes for debugging
            if (locationHistory.length > 50) {
                locationHistory = locationHistory.slice(-50);
            }
        }
    } else {
        // Handle missing location data
        if (zoneHistoryManager && isZoneSystemInitialized) {
            const currentZone = zoneHistoryManager.getCurrentZone();
            if (currentZone) {
                processedLocation = currentZone.zone.displayName;
                locationSource = 'fallback';
                zoneInfo = createEnhancedZoneInfo(currentZone);
                zoneResolution = currentZone;
                logger.debug(MODULE_NAME, `Using current zone as fallback: ${processedLocation}`);
            } else {
                processedLocation = 'Unknown';
                locationSource = 'unknown';
                logger.warn(MODULE_NAME, `No zone data available for ${source} event`);
            }
        } else if (currentLocation && currentLocation !== '') {
            // Legacy fallback
            processedLocation = currentLocation;
            locationSource = 'fallback';
            logger.debug(MODULE_NAME, `Using legacy fallback location: ${processedLocation}`);
        } else {
            processedLocation = 'Unknown';
            locationSource = 'unknown';
            logger.warn(MODULE_NAME, `No location available for ${source} event`);
        }
    }
    
    return {
        location: processedLocation,
        coordinates: coordinates,
        locationSource: locationSource,
        zoneInfo: zoneInfo,
        zoneResolution: zoneResolution
    };
}

// Create enhanced zone information for events
function createEnhancedZoneInfo(zoneResolution: ZoneResolution): EnhancedEventZoneInfo {
    const zone = zoneResolution.zone;
    let primary = null;
    let secondary = null;
    
    if (zone.classification === 'primary') {
        primary = zone as any; // PrimaryZone
    } else {
        secondary = zone as any; // SecondaryZone
        // Try to get associated primary zone
        if (zoneHistoryManager) {
            primary = zoneHistoryManager.matchSecondaryToPrimary(secondary);
        }
    }
    
    // Build location hierarchy for breadcrumb display
    const hierarchy: string[] = [];
    if (zone.system !== 'unknown') {
        hierarchy.push(zone.system === 'stanton' ? 'Stanton System' : 
                      zone.system === 'pyro' ? 'Pyro System' : 
                      'Unknown System');
    }
    if (primary && primary.displayName !== zone.displayName) {
        hierarchy.push(primary.displayName);
    }
    hierarchy.push(zone.displayName);
    
    return {
        primary: primary,
        secondary: secondary,
        system: zone.system,
        displayLocation: zone.displayName,
        locationHierarchy: hierarchy,
        zoneTransition: false, // Would be determined by comparing with previous event
        derivedFromHistory: zoneResolution.matchMethod === 'derived'
    };
}

// Legacy location processing function for compatibility
function processLocationData(rawLocation: string | undefined, coordinates?: {x: number, y: number, z: number}, source: string = 'unknown', timestamp?: string): {
    location: string;
    coordinates?: {x: number, y: number, z: number};
    locationSource: 'event' | 'fallback' | 'unknown';
} {
    const result = processLocationDataEnhanced(rawLocation, coordinates, source, timestamp);
    return {
        location: result.location,
        coordinates: result.coordinates,
        locationSource: result.locationSource
    };
}
const corpseLogRegex = /<(?<timestamp>\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)>.*?<\[ActorState\] Corpse>.*?Player '(?<playerName>[^']+)'/;
const killPatternRegex = /<(?<timestamp>\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)>.*?<Actor Death> CActor::Kill: '(?<Victim>[^']+)' \[\d+\] in zone '(?<Zone>[^']+)' killed by '(?<Killer>[^']+)' \[[^']+\] using '(?<Weapon>[^']+)' \[Class (?<Class>[^\]]+)\] with damage type '(?<DamageType>[^']+)'/;
const incapRegex = /Logged an incap.! nickname: (?<playerName>[^,]+), causes: \[(?<cause>[^\]]+)\]/;
const environmentDeathRegex = /<(?<timestamp>\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)>.*?<Actor Death> CActor::Kill: '(?<playerName>[^']+)' .*? damage type '(?<damageType>BleedOut|SuffocationDamage)'/;
const systemQuitRegex = /<SystemQuit>|System Fast Shutdown/i;


// --- Helper Functions for Mode Detection ---

// Called when a potential mode is detected in a log line
function handleRawModeDetection(detectedMode: 'PU' | 'AC') {
    const now = Date.now();
    rawDetectedGameMode = detectedMode;
    lastRawModeDetectionTime = now;

    // Clear existing timer if any
    if (modeDebounceTimer) {
        clearTimeout(modeDebounceTimer);
        modeDebounceTimer = null;
    }

    // Start a new timer to update the stable mode if this detection remains consistent
    modeDebounceTimer = setTimeout(() => {
        // Check if the raw mode hasn't changed since the timer started
        // Add small buffer to account for potential timer inaccuracies
        if (rawDetectedGameMode === detectedMode && Date.now() - lastRawModeDetectionTime < MODE_DEBOUNCE_MS + 100) {
             updateStableGameMode(detectedMode);
        }
        modeDebounceTimer = null; // Timer finished
    }, MODE_DEBOUNCE_MS);
}

// Updates the stable mode and notifies the renderer
function updateStableGameMode(newStableMode: 'PU' | 'AC' | 'Unknown') {
    if (stableGameMode !== newStableMode) {
        stableGameMode = newStableMode;
        logger.info(MODULE_NAME, "Stable Game Mode updated:", { status: stableGameMode });
        const win = getMainWindow();
        win?.webContents.send('game-mode-update', stableGameMode); // Send dedicated IPC message
        // Optionally send a general log status update as well
        // win?.webContents.send('log-status', `Game Mode set to: ${stableGameMode}`);
    }
}


// --- Main Parsing Function ---

export async function parseLogContent(content: string, silentMode = false) {
    // Initialize zone system on first parse
    initializeZoneSystem();
    
    const lines = content.split('\n');
    const win = getMainWindow(); // Get window reference once

    for (const line of lines) {
        if (!line.trim()) continue; // Skip empty lines

        try { // Add try-catch around line processing
            // --- Login Detection ---
            const loginMatch = line.match(loginRegex) || line.match(legacyLoginRegex);
            if (loginMatch && loginMatch[1]) {
                const username = loginMatch[1];
                if (username !== currentUsername) {
                    logger.info(MODULE_NAME, 'Login detected for user:', { player: username });
                    currentUsername = username;
                    setLastLoggedInUser(username); // Update store
                    if (!silentMode) {
                        showNotification('Kill Feed', `Logged in as ${username}`);
                    }
                    win?.webContents.send('log-status', `Logged in as ${username}`);
                }
                continue; // Login line processed
            }

            // --- Game Mode Detection (Direct Update) ---
            if (line.match(puModeRegex)) { // Use new puModeRegex
                updateStableGameMode('PU'); // Update directly
            } else if (line.match(acModeRegex)) { // Use new acModeRegex
                updateStableGameMode('AC'); // Update directly
            } else if (line.match(frontendModeRegex)) { // Use new frontendModeRegex
                updateStableGameMode('Unknown'); // Treat Frontend as 'Unknown' for now
            } else if (line.match(systemQuitRegex)) {
                logger.info(MODULE_NAME, 'Game quit/shutdown detected.');
                updateStableGameMode('Unknown');
                currentLocation = "Unknown"; // Set location to Unknown
            }
            // Note: The debounce logic in handleRawModeDetection is now bypassed for these specific lines.
            // Consider removing handleRawModeDetection if no longer needed elsewhere.

            // --- Game Version Detection ---
            const versionMatch = line.match(versionPattern);
            if (versionMatch?.groups?.gameversion && versionMatch.groups.gameversion !== currentGameVersion) {
                currentGameVersion = versionMatch.groups.gameversion;
                logger.info(MODULE_NAME, 'Game version detected:', { id: currentGameVersion });
                win?.webContents.send('log-status', `Game version: ${currentGameVersion}`);
            }

            // --- Player Ship Tracking ---
            const loadoutMatch = line.match(loadoutRegex);
            if (loadoutMatch?.groups) {
                const { Entity, OwnerGEID } = loadoutMatch.groups;
                if (currentUsername && OwnerGEID === currentUsername && Entity.match(shipManufacturerPattern)) {
                    const cleanupMatch = Entity.match(cleanupPattern);
                    const shipName = cleanupMatch?.[1] || Entity;
                    if (shipName !== currentPlayerShip) {
                        currentPlayerShip = shipName;
                        logger.info(MODULE_NAME, 'Player ship detected:', { ship: currentPlayerShip });
                        win?.webContents.send('log-status', `Current ship: ${currentPlayerShip}`);
                    }
                }
            }

            // --- Session Start Detection ---
            const sessionMatch = line.match(sessionStartRegex);
            if (sessionMatch?.[1]) {
                const timestamp = sessionMatch[1];
                logger.info(MODULE_NAME, 'New game session detected at:', timestamp);
                // Session starting is now handled by log-watcher start/restart
                // startNewSession(); // Let log-watcher handle session start/end
                if (!silentMode) {
                    showNotification('Kill Feed', `New game session started at ${new Date(timestamp).toLocaleTimeString()}`);
                }
                continue; // Session line processed
            }

            // --- Vehicle Destruction ---
            const destructionMatch = line.match(vehicleDestructionRegex);
            if (destructionMatch?.groups) {
                const { timestamp, vehicle, vehicle_zone, pos_x, pos_y, pos_z, driver, destroy_level_from, destroy_level_to, caused_by, damage_type } = destructionMatch.groups;
                const vehicleCleanupMatch = vehicle.match(cleanupPattern);
                const vehicleBaseName = vehicleCleanupMatch?.[1] || vehicle;
                const destructionLevel = parseInt(destroy_level_to) || 0;

                logger.info(MODULE_NAME, 'Vehicle destruction:', { ship: vehicleBaseName }, 'in', { location: vehicle_zone }, 'by', { attacker: caused_by }, `(${damage_type}) Lvl ${destroy_level_from}->${destroy_level_to}`);
                
                // Process location data with enhanced zone hierarchy
                const locationData = processLocationDataEnhanced(
                    vehicle_zone, 
                    { x: parseFloat(pos_x || '0'), y: parseFloat(pos_y || '0'), z: parseFloat(pos_z || '0') },
                    'vehicle_destruction',
                    timestamp
                );

                if (destructionLevel >= 1) { // Process soft death (level 1) or hard death (level >= 2)
                    const deathType = determineDeathType(destructionLevel, damage_type, caused_by, driver);
                    const stableId = `v_kill_${vehicle}`.replace(/[^a-zA-Z0-9_]/g, '');
                    const initialKillers = (caused_by && caused_by !== 'unknown') ? [caused_by] : [];
                    const initialVictims = (driver && driver !== 'unknown') ? [driver] : [vehicleBaseName]; // Use vehicle name as placeholder if driver unknown
                    const isPlayerInvolved = initialKillers.includes(currentUsername || '') || initialVictims.includes(currentUsername || '');

                    // Apply consistent NPC-aware vehicleType resolution (same logic as combat deaths)
                    const vehicleResolution = resolveEntityName(vehicleBaseName);
                    let resolvedVehicleType: string;
                    
                    if (vehicleResolution.category === 'npc') {
                        resolvedVehicleType = "NPC"; // NPC entity (consistent with combat deaths)
                    } else if (vehicleResolution.category === 'ship') {
                        resolvedVehicleType = vehicleResolution.displayName; // Resolved ship name
                    } else {
                        // Unknown entity type - use resolved name
                        resolvedVehicleType = vehicleResolution.displayName;
                    }

                    const partialEvent: Partial<KillEvent> = {
                        id: stableId,
                        timestamp: timestamp,
                        killers: initialKillers,
                        victims: initialVictims,
                        deathType: deathType,
                        vehicleType: resolvedVehicleType,
                        vehicleModel: vehicleBaseName, // Keep original name for model reference
                        vehicleId: vehicle,
                        location: locationData.location,
                        weapon: damage_type, // Use damage_type as initial weapon/cause
                        damageType: damage_type,
                        gameMode: stableGameMode, // Use stable mode
                        gameVersion: currentGameVersion,
                        playerShip: currentPlayerShip,
                        coordinates: locationData.coordinates,
                        isPlayerInvolved: isPlayerInvolved
                    };

                    // Only process events where the current user is involved
                    if (isPlayerInvolved) {
                        logger.debug(MODULE_NAME, `Processing vehicle destruction event - user involved: ${currentUsername}`);
                        await processKillEvent(partialEvent, silentMode, destructionLevel);
                    } else {
                        logger.debug(MODULE_NAME, `Skipping vehicle destruction event - user not involved. Event killers: [${initialKillers.join(', ')}], victims: [${initialVictims.join(', ')}], current user: ${currentUsername || 'none'}`);
                    }
                }
                continue; // Destruction line processed
            }

            // --- Corpse Log (Player Death) ---
            const corpseMatch = line.match(corpseLogRegex);
            if (corpseMatch?.groups) {
                const { timestamp, playerName } = corpseMatch.groups;
                logger.info(MODULE_NAME, 'Player death detected:', { victim: playerName }, 'at', timestamp);
                const deathTimeMs = new Date(timestamp).getTime();

                // Add to recent deaths for correlation
                recentPlayerDeaths.push({ timestamp: deathTimeMs, playerName, processed: false });
                // Clean up old entries (keep last 60 seconds)
                const cutoffTime = Date.now() - 60000;
                while (recentPlayerDeaths.length > 0 && recentPlayerDeaths[0].timestamp < cutoffTime) {
                    recentPlayerDeaths.shift();
                }

                // Attempt correlation within the event processor
                await correlateDeathWithDestruction(timestamp, playerName, silentMode);
                continue; // Corpse log processed
            }

            // --- Detailed Kill (Actor Death) ---
            const killMatch = line.match(killPatternRegex);
            if (killMatch?.groups) {
                let { timestamp, Victim, Zone, Killer, Weapon, DamageType } = killMatch.groups;
                const zoneCleanup = Zone.match(cleanupPattern);
                if (zoneCleanup?.[1]) Zone = zoneCleanup[1];
                // Further cleanup (optional, based on original script logic)
                // Zone = Zone.replace(/_(PU|AI|CIV|MIL|PIR)$/, '').replace(/-00[1-9]$/, '');
                const weaponCleanup = Weapon.match(cleanupPattern);
                if (weaponCleanup?.[1]) Weapon = weaponCleanup[1];

                let deathType: KillEvent['deathType'] = 'Combat';
                if (DamageType === 'Crash') deathType = 'Crash';
                else if (DamageType === 'Collision') deathType = 'Collision';

                logger.info(MODULE_NAME, 'Detailed kill:', { attacker: Killer }, '->', { victim: Victim }, '(in zone', { zone: Zone }, ') with', { weapon: Weapon }, `(${DamageType})`);
                
                // Process location data with enhanced zone hierarchy (no coordinates from combat deaths)
                const locationData = processLocationDataEnhanced(Zone, undefined, 'combat_death', timestamp);
                logger.info(MODULE_NAME, 'DEBUG - Enhanced zone details:', { 
                    originalZone: killMatch.groups.Zone, 
                    cleanedZone: Zone, 
                    processedLocation: locationData.location, 
                    locationSource: locationData.locationSource,
                    zoneClassification: locationData.zoneResolution?.zone.classification,
                    zoneSystem: locationData.zoneResolution?.zone.system
                });

                if (Killer && Victim) {
                    const isPlayerInvolved = Killer === currentUsername || Victim === currentUsername;
                    const stableId = `kill_${Killer}_${Victim}_${Zone}_${Weapon}`.replace(/[^a-zA-Z0-9_]/g, '');

                    // Determine proper vehicle type based on victim entity type, not zone
                    let resolvedVehicleType: string;
                    const victimResolution = resolveEntityName(Victim);
                    const killerResolution = resolveEntityName(Killer);
                    
                    if (victimResolution.category === 'npc') {
                        resolvedVehicleType = "NPC"; // NPC entity (on foot/not in ship)
                    } else if (victimResolution.category === 'ship') {
                        resolvedVehicleType = victimResolution.displayName; // Resolved ship name
                    } else {
                        // Unknown entity type - use resolved name or entity name
                        resolvedVehicleType = victimResolution.displayName;
                    }
                    
                    // Get properly resolved entity names
                    const victimDisplayName = victimResolution.displayName;
                    const killerDisplayName = killerResolution.displayName;

                    const partialEvent: Partial<KillEvent> = {
                        id: stableId,
                        timestamp: timestamp,
                        killers: [Killer], // Keep original entity ID for NPC detection
                        victims: [Victim], // Keep original entity ID for NPC detection
                        deathType: deathType,
                        vehicleType: resolvedVehicleType,
                        vehicleId: undefined, // Zone belongs in location, not vehicle field
                        location: locationData.location, // Use processed location with fallback hierarchy
                        weapon: Weapon,
                        damageType: DamageType,
                        gameMode: stableGameMode, // Use stable mode
                        gameVersion: currentGameVersion,
                        playerShip: currentPlayerShip,
                        coordinates: locationData.coordinates, // Will be undefined for combat deaths
                        isPlayerInvolved: isPlayerInvolved
                    };

                    // Only process events where the current user is involved
                    if (isPlayerInvolved) {
                        // Skip Crash deaths when we already handle them as Vehicle Destruction events
                        // This prevents duplicate entries for the same incident
                        if (deathType === 'Crash') {
                            logger.debug(MODULE_NAME, `Skipping Crash death event - handled by Vehicle Destruction. Victim: ${Victim}, current user: ${currentUsername}`);
                        } else {
                            logger.debug(MODULE_NAME, `Processing combat death event - user involved: ${currentUsername}`);
                            logger.info(MODULE_NAME, 'DEBUG - partialEvent location:', { location: partialEvent.location, zone: Zone, vehicleId: partialEvent.vehicleId });
                            await processKillEvent(partialEvent, silentMode, 2); // Assume combat kill is level 2
                        }
                    } else {
                        logger.debug(MODULE_NAME, `Skipping combat death event - user not involved. Attacker: ${Killer}, victim: ${Victim}, current user: ${currentUsername || 'none'}`);
                    }
                }
                continue; // Kill line processed
            }

            // --- Environmental Death ---
            const envDeathMatch = line.match(environmentDeathRegex);
            if (envDeathMatch?.groups) {
                const { timestamp, playerName, damageType } = envDeathMatch.groups;
                logger.info(MODULE_NAME, 'Environmental death:', { victim: playerName }, 'died from', { weapon: damageType });

                // Use the improved death type determination logic
                const deathType = determineDeathType(
                    0, // Environmental deaths don't have destruction levels
                    damageType || 'Unknown',
                    'Environment',
                    null
                );

                const isPlayerInvolved = playerName === currentUsername;
                const eventId = `env_death_${playerName}_${timestamp}`.replace(/[^a-zA-Z0-9_]/g, '');

                // Determine proper vehicle type for environmental death
                const victimResolution = resolveEntityName(playerName);
                const resolvedVehicleType = victimResolution.category === 'npc' ? 'NPC' : 
                                          victimResolution.category === 'ship' ? victimResolution.displayName :
                                          'Player';

                // Get properly resolved victim name
                const victimDisplayName = victimResolution.displayName;
                
                // Process location data for environmental deaths with enhanced zone system
                const locationData = processLocationDataEnhanced(undefined, undefined, 'environmental_death', timestamp);

                const partialEvent: Partial<KillEvent> = {
                    id: eventId,
                    timestamp: timestamp,
                    killers: ['Environment'],
                    victims: [playerName], // Keep original entity ID for NPC detection
                    deathType: deathType,
                    vehicleType: resolvedVehicleType, // Properly resolved entity type
                    location: locationData.location, // Use processed location with fallback hierarchy
                    weapon: damageType,
                    damageType: damageType,
                    gameMode: stableGameMode, // Use stable mode
                    gameVersion: currentGameVersion,
                    playerShip: currentPlayerShip,
                    coordinates: locationData.coordinates, // Will be undefined for environmental deaths
                    isPlayerInvolved: isPlayerInvolved
                };

                // Only process events where the current user is involved
                if (isPlayerInvolved) {
                    logger.debug(MODULE_NAME, `Processing environmental death event - user involved: ${currentUsername}`);
                    await processKillEvent(partialEvent, silentMode, 2); // Treat as significant event
                } else {
                    logger.debug(MODULE_NAME, `Skipping environmental death event - user not involved. Victim: ${playerName}, current user: ${currentUsername || 'none'}`);
                }
                continue; // Env death line processed
            }

            // --- Incapacitation Log (Optional) ---
            const incapMatch = line.match(incapRegex);
            if (incapMatch?.groups) {
                const { playerName, cause } = incapMatch.groups;
                logger.info(MODULE_NAME, 'Incapacitation detected:', { victim: playerName }, ', Cause:', cause);
                // Store temporarily if needed for future correlation logic
            }

        } catch (error) {
             logger.error(MODULE_NAME, `Error processing line: "${line}"`, error);
             // Optionally send an error status to renderer
             // win?.webContents.send('log-status', `Error parsing line: ${error.message}`);
        }
    } // End line loop
}

// Function to reset parser state (e.g., on rescan)
export function resetParserState() {
    logger.info(MODULE_NAME, "Resetting parser state.");
    currentUsername = getLastLoggedInUser() || null; // Re-initialize from store
    currentPlayerShip = "Unknown";
    stableGameMode = "Unknown"; // Reset stable mode
    rawDetectedGameMode = "Unknown"; // Reset raw mode
    lastRawModeDetectionTime = 0;
    if (modeDebounceTimer) { // Clear any pending timer
        clearTimeout(modeDebounceTimer);
        modeDebounceTimer = null;
    }
    currentGameVersion = "";
    currentLocation = "";
    locationHistory.length = 0; // Clear location history
    recentPlayerDeaths.length = 0; // Clear recent deaths
    
    // Reset enhanced zone system
    if (zoneHistoryManager) {
        zoneHistoryManager.clearHistory();
    }
    isZoneSystemInitialized = false;
    zoneHistoryManager = null;
    
    // Event lists are cleared in event-processor
}

// Getter for current username (might be needed by other modules like window manager)
export function getCurrentUsername(): string | null {
    return currentUsername;
}

// Export functions for location data access
export function getCurrentLocation(): string {
    return currentLocation || 'Unknown';
}

export function getLocationHistory(): Array<{timestamp: string, location: string, source: string}> {
    return [...locationHistory]; // Return a copy to prevent external modification
}

// Export function to get detailed location state for debugging (legacy)
export function getLocationState(): {
    currentLocation: string;
    locationHistory: Array<{timestamp: string, location: string, source: string}>;
    historyCount: number;
} {
    return {
        currentLocation: currentLocation || 'Unknown',
        locationHistory: [...locationHistory],
        historyCount: locationHistory.length
    };
}

// Export function to get enhanced zone service state
export function getZoneServiceState(): LocationServiceState | null {
    if (!zoneHistoryManager || !isZoneSystemInitialized) {
        return null;
    }
    
    try {
        return zoneHistoryManager.getLocationState();
    } catch (error) {
        logger.error(MODULE_NAME, 'Error getting zone service state:', error);
        return null;
    }
}

// Export function to get zone statistics
export function getZoneStatistics() {
    if (!zoneHistoryManager || !isZoneSystemInitialized) {
        return null;
    }
    
    try {
        return zoneHistoryManager.getZoneStatistics();
    } catch (error) {
        logger.error(MODULE_NAME, 'Error getting zone statistics:', error);
        return null;
    }
}

// Export function to get current zone information
export function getCurrentZoneInfo(): ZoneResolution | null {
    if (!zoneHistoryManager || !isZoneSystemInitialized) {
        return null;
    }
    
    try {
        return zoneHistoryManager.getCurrentZone();
    } catch (error) {
        logger.error(MODULE_NAME, 'Error getting current zone:', error);
        return null;
    }
}

// Export function to get zone history with filtering
export function getZoneHistory(filter?: {
    classification?: 'primary' | 'secondary';
    system?: 'stanton' | 'pyro' | 'unknown';
    limit?: number;
}): ZoneHistoryEntry[] {
    if (!zoneHistoryManager || !isZoneSystemInitialized) {
        return [];
    }
    
    try {
        return zoneHistoryManager.getHistory(filter);
    } catch (error) {
        logger.error(MODULE_NAME, 'Error getting zone history:', error);
        return [];
    }
}

// Export function to manually add zone to history (for testing or external integration)
export function addZoneToHistory(
    zoneId: string, 
    source: string, 
    coordinates?: {x: number, y: number, z: number},
    timestamp?: string
): ZoneResolution | null {
    initializeZoneSystem();
    
    if (!zoneHistoryManager || !isZoneSystemInitialized) {
        logger.warn(MODULE_NAME, 'Zone system not available for manual zone addition');
        return null;
    }
    
    try {
        return zoneHistoryManager.addZoneToHistory(zoneId, source, coordinates, timestamp);
    } catch (error) {
        logger.error(MODULE_NAME, 'Error adding zone to history:', error);
        return null;
    }
}

// Export function to check if zone system is available
export function isZoneSystemAvailable(): boolean {
    return isZoneSystemInitialized && zoneHistoryManager !== null;
}

// Export function to clear zone history
export function clearZoneHistory(): void {
    // Clear legacy location history
    locationHistory = [];
    currentLocation = 'Unknown';
    
    // Clear enhanced zone history
    if (!zoneHistoryManager || !isZoneSystemInitialized) {
        logger.warn(MODULE_NAME, 'Zone system not available for clearing history');
        return;
    }
    
    try {
        zoneHistoryManager.clearHistory();
        logger.info(MODULE_NAME, 'Zone history cleared successfully');
    } catch (error) {
        logger.error(MODULE_NAME, 'Error clearing zone history:', error);
    }
}