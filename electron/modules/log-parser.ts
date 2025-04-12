import { store, getLastLoggedInUser, setLastLoggedInUser, getFetchProfileData } from './config-manager.ts'; // Add .ts
import { showNotification } from './notification-manager.ts'; // Add .ts
import { getMainWindow } from './window-manager.ts'; // Add .ts
import { startNewSession } from './session-manager.ts'; // Add .ts
import { fetchRsiProfileData, defaultProfileData } from './rsi-scraper.ts'; // Add .ts
import { processKillEvent, addOrUpdateEvent, correlateDeathWithDestruction, formatKillEventDescription, determineDeathType, getKillEvents, getGlobalKillEvents, clearEvents } from './event-processor.ts'; // Import addOrUpdateEvent instead of addOrUpdateGlobalEvent
import { KillEvent, PlayerDeath } from '../../shared/types';
import * as logger from './logger'; // Import the logger utility

const MODULE_NAME = 'LogParser'; // Define module name for logger

// --- Module State ---
// State variables specific to parsing context
let currentUsername: string | null = getLastLoggedInUser() || null; // Initialize from store
let currentPlayerShip: string = "Unknown";
let currentGameMode: 'PU' | 'AC' | 'Unknown' = "Unknown";
let currentGameVersion: string = "";
let currentLocation: string = ""; // Last known zone location

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
const puModeRegex = /<\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z> \[Notice\] <ContextEstablisherTaskFinished>.*?map="megamap".*?gamerules="SC_Default"/;
const acModeRegex = /ArenaCommanderFeature/;
const loadoutRegex = /\[InstancedInterior\] OnEntityLeaveZone - InstancedInterior \[(?<InstancedInterior>[^\]]+)\] \[\d+\] -> Entity \[(?<Entity>[^\]]+)\] \[\d+\] --.*?m_ownerGEID\[(?<OwnerGEID>[^\[]+)\]/;
const vehicleDestructionRegex = /<(?<timestamp>\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)> \[Notice\] <Vehicle Destruction>.*?Vehicle '(?<vehicle>[^']+)' \[\d+\] in zone '(?<vehicle_zone>[^']+)' \[pos x: (?<pos_x>[-\d\.]+), y: (?<pos_y>[-\d\.]+), z: (?<pos_z>[-\d\.]+) .*? driven by '(?<driver>[^']+)' \[\d+\] advanced from destroy level (?<destroy_level_from>\d+) to (?<destroy_level_to>\d+) caused by '(?<caused_by>[^']+)' \[\d+\] with '(?<damage_type>[^']+)'/;
const cleanupPattern = /^(.+?)_\d+$/;
const versionPattern = /--system-trace-env-id='pub-sc-alpha-(?<gameversion>\d{3,4}-\d{7})'/;
const corpseLogRegex = /<(?<timestamp>\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)>.*?<\[ActorState\] Corpse>.*?Player '(?<playerName>[^']+)'/;
const killPatternRegex = /<(?<timestamp>\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)>.*?<Actor Death> CActor::Kill: '(?<EnemyPilot>[^']+)' \[\d+\] in zone '(?<EnemyShip>[^']+)' killed by '(?<Player>[^']+)' \[[^']+\] using '(?<Weapon>[^']+)' \[Class (?<Class>[^\]]+)\] with damage type '(?<DamageType>[^']+)'/;
const incapRegex = /Logged an incap.! nickname: (?<playerName>[^,]+), causes: \[(?<cause>[^\]]+)\]/;
const environmentDeathRegex = /<(?<timestamp>\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)>.*?<Actor Death> CActor::Kill: '(?<playerName>[^']+)' .*? damage type '(?<damageType>BleedOut|SuffocationDamage)'/;

// --- Main Parsing Function ---

export async function parseLogContent(content: string, silentMode = false) {
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

            // --- Game Mode Detection ---
            if (line.match(puModeRegex)) {
                if (currentGameMode !== "PU") {
                    currentGameMode = "PU";
                    logger.info(MODULE_NAME, "Game Mode detected:", { status: 'Persistent Universe (PU)' });
                    win?.webContents.send('log-status', `Game Mode: Persistent Universe (PU)`);
                }
            } else if (line.match(acModeRegex) && !line.includes('SC_Default')) {
                if (currentGameMode !== "AC") {
                    currentGameMode = "AC";
                    logger.info(MODULE_NAME, "Game Mode detected:", { status: 'Arena Commander (AC)' });
                    win?.webContents.send('log-status', `Game Mode: Arena Commander (AC)`);
                }
            }

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
                currentLocation = vehicle_zone; // Update last known location

                if (destructionLevel >= 1) { // Process soft death (level 1) or hard death (level >= 2)
                    const deathType = determineDeathType(destructionLevel, damage_type, caused_by, driver);
                    const stableId = `v_kill_${vehicle}`.replace(/[^a-zA-Z0-9_]/g, '');
                    const initialKillers = (caused_by && caused_by !== 'unknown') ? [caused_by] : [];
                    const initialVictims = (driver && driver !== 'unknown') ? [driver] : [vehicleBaseName]; // Use vehicle name as placeholder if driver unknown
                    const isPlayerInvolved = initialKillers.includes(currentUsername || '') || initialVictims.includes(currentUsername || '');

                    const partialEvent: Partial<KillEvent> = {
                        id: stableId,
                        timestamp: timestamp,
                        killers: initialKillers,
                        victims: initialVictims,
                        deathType: deathType,
                        vehicleType: vehicleBaseName,
                        vehicleModel: vehicleBaseName,
                        vehicleId: vehicle,
                        location: vehicle_zone,
                        weapon: damage_type, // Use damage_type as initial weapon/cause
                        damageType: damage_type,
                        gameMode: currentGameMode,
                        gameVersion: currentGameVersion,
                        playerShip: currentPlayerShip,
                        coordinates: { x: parseFloat(pos_x || '0'), y: parseFloat(pos_y || '0'), z: parseFloat(pos_z || '0') },
                        isPlayerInvolved: isPlayerInvolved,
                    };

                    // Let event processor handle creation/update and RSI fetching
                    await processKillEvent(partialEvent, silentMode, destructionLevel);
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
                let { timestamp, EnemyPilot, EnemyShip, Player, Weapon, DamageType } = killMatch.groups;
                const enemyShipCleanup = EnemyShip.match(cleanupPattern);
                if (enemyShipCleanup?.[1]) EnemyShip = enemyShipCleanup[1];
                // Further cleanup (optional, based on original script logic)
                // EnemyShip = EnemyShip.replace(/_(PU|AI|CIV|MIL|PIR)$/, '').replace(/-00[1-9]$/, '');
                const weaponCleanup = Weapon.match(cleanupPattern);
                if (weaponCleanup?.[1]) Weapon = weaponCleanup[1];

                let deathType: KillEvent['deathType'] = 'Combat';
                if (DamageType === 'Crash') deathType = 'Crash';
                else if (DamageType === 'Collision') deathType = 'Collision';

                logger.info(MODULE_NAME, 'Detailed kill:', { attacker: Player }, '->', { victim: EnemyPilot }, '(in', { ship: EnemyShip }, ') with', { weapon: Weapon }, `(${DamageType})`);

                if (Player && EnemyPilot) {
                    const isPlayerInvolved = Player === currentUsername || EnemyPilot === currentUsername;
                    const stableId = `kill_${Player}_${EnemyPilot}_${EnemyShip}_${Weapon}`.replace(/[^a-zA-Z0-9_]/g, '');

                    const partialEvent: Partial<KillEvent> = {
                        id: stableId,
                        timestamp: timestamp,
                        killers: [Player],
                        victims: [EnemyPilot],
                        deathType: deathType,
                        vehicleType: EnemyShip.match(shipManufacturerPattern) ? EnemyShip : "Player",
                        vehicleId: EnemyShip, // Store original zone info as vehicleId for context
                        location: currentLocation, // Use last known location
                        weapon: Weapon,
                        damageType: DamageType,
                        gameMode: currentGameMode,
                        gameVersion: currentGameVersion,
                        playerShip: currentPlayerShip,
                        isPlayerInvolved: isPlayerInvolved,
                    };

                    // Let event processor handle creation/update and RSI fetching
                    await processKillEvent(partialEvent, silentMode, 2); // Assume combat kill is level 2
                }
                continue; // Kill line processed
            }

            // --- Environmental Death ---
            const envDeathMatch = line.match(environmentDeathRegex);
            if (envDeathMatch?.groups) {
                const { timestamp, playerName, damageType } = envDeathMatch.groups;
                logger.info(MODULE_NAME, 'Environmental death:', { victim: playerName }, 'died from', { weapon: damageType });

                let deathType: KillEvent['deathType'] = 'Unknown';
                if (damageType === 'BleedOut') deathType = 'BleedOut';
                if (damageType === 'SuffocationDamage') deathType = 'Suffocation';

                const isPlayerInvolved = playerName === currentUsername;
                const eventId = `env_death_${playerName}_${timestamp}`.replace(/[^a-zA-Z0-9_]/g, '');

                const partialEvent: Partial<KillEvent> = {
                    id: eventId,
                    timestamp: timestamp,
                    killers: ['Environment'],
                    victims: [playerName],
                    deathType: deathType,
                    vehicleType: 'Player', // Victim was on foot
                    location: currentLocation,
                    weapon: damageType,
                    damageType: damageType,
                    gameMode: currentGameMode,
                    gameVersion: currentGameVersion,
                    playerShip: currentPlayerShip,
                    isPlayerInvolved: isPlayerInvolved,
                };

                // Let event processor handle creation/update and RSI fetching
                await processKillEvent(partialEvent, silentMode, 2); // Treat as significant event
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
    currentGameMode = "Unknown";
    currentGameVersion = "";
    currentLocation = "";
    recentPlayerDeaths.length = 0; // Clear recent deaths
    // Event lists are cleared in event-processor
}

// Getter for current username (might be needed by other modules like window manager)
export function getCurrentUsername(): string | null {
    return currentUsername;
}