import { store, getLastLoggedInUser, setLastLoggedInUser, getFetchProfileData } from './config-manager.ts'; // Add .ts
import { showNotification } from './notification-manager.ts'; // Add .ts
import { getMainWindow } from './window-manager.ts'; // Add .ts
import { startNewSession } from './session-manager.ts'; // Add .ts
import { fetchRsiProfileData, defaultProfileData } from './rsi-scraper.ts'; // Add .ts
import { processKillEvent, addOrUpdateEvent, correlateDeathWithDestruction, formatKillEventDescription, determineDeathType, getKillEvents, getGlobalKillEvents, clearEvents } from './event-processor.ts'; // Import addOrUpdateEvent instead of addOrUpdateGlobalEvent
import { resolveEntityName, getEntityName, isNpcEntity } from './definitionsService.ts'; // Import entity resolution functions
import { KillEvent, PlayerDeath, GameEventType, EVENT_VISIBILITY_MAP, classifyMission } from '../../shared/types';
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
let currentGeid: string | null = null; // Local player's GEID from the login line (matches owner/killer ids in 4.10 <Vehicle Destroyed>)
// Title of a multi-line "Added notification "<title>" seen on the previous log line (party invite inviter). Survives across parse calls.
let previousNotificationTitle: string | null = null;
// Shop requests waiting for their RmShopFlowResponse. Module-level because log content arrives in chunks.
interface PendingShopRequest { ms: number; ts: string; playerId: string; action: 'buy' | 'rent'; shopName: string; item: string; quantity?: number; offering?: number; price: number; currency: string; }
const pendingShopRequests: PendingShopRequest[] = [];
const seenObjectiveProgress = new Set<string>(); // "<objectiveId>|<raw text>" already emitted
const missionCommsCache = new Map<string, { organization?: string; type?: string }>(); // missionId -> comms tags
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

// === DUAL-MODE DETECTION CONFIGURATION ===
const ENABLE_OLD_FORMAT = true;    // Keep old format detection
const ENABLE_NEW_FORMAT = true;    // Enable new format detection
const PREFERRED_FORMAT: 'old' | 'new' = 'old';  // Prioritize old when both present
const DEDUP_WINDOW_MS = 5000;      // 5-second deduplication window

// Detection priority (lower index = higher priority)
const DETECTION_PRIORITY = [
  'corpse_log_old',        // 1. OLD: <[ActorState] Corpse> (most reliable)
  'actor_state_dead_new',  // 2. NEW: <[ActorState] Dead> (has name)
  'corpse_utils_new',      // 3. NEW: CSCActorCorpseUtils (no name)
  'attachment_received',   // 4. NEW: AttachmentReceived (respawn)
];

// Deduplication cache
const recentDeaths = new Map<string, {method: string; timestamp: number}>();

// Detection metrics
let detectionStats = {
  old_corpse_log: 0,
  actor_state_dead_new: 0,
  corpse_utils_new: 0,
  attachment_received: 0,
  unknown_format: 0,
  duplicates_prevented: 0,
};
// === END DUAL-MODE DETECTION CONFIGURATION ===

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
// SUNSET: <Vehicle Destruction> not emitted since SC 4.4 (replaced by <Vehicle Destroyed>, see vehicleDestroyedRegex). Kept for old logs.
const vehicleDestructionRegex = /<(?<timestamp>\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)> \[Notice\] <Vehicle Destruction>.*?Vehicle '(?<vehicle>[^']+)' \[\d+\] in zone '(?<vehicle_zone>[^']+)' \[pos x: (?<pos_x>[-\d\.]+), y: (?<pos_y>[-\d\.]+), z: (?<pos_z>[-\d\.]+) .*? driven by '(?<driver>[^']+)' \[\d+\] advanced from destroy level (?<destroy_level_from>\d+) to (?<destroy_level_to>\d+) caused by '(?<caused_by>[^']+)' \[\d+\] with '(?<damage_type>[^']+)'/;
const cleanupPattern = /^(.+?)_\d+$/;
const versionPattern = /--system-trace-env-id='pub-sc-alpha-(?<gameversion>\d{3,4}-\d{7})'/;

// === NEW FORMAT PATTERNS (Star Citizen 4.4+) ===
// New ActorState Dead (player death in vehicle context - HAS player name)
const newActorStateDeadRegex =
  /<(?<timestamp>\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)>\s+\[Notice\]\s+<\[ActorState\] Dead>\s+\[ACTOR STATE\]\[CSCActorControlStateDead::PrePhysicsUpdate\]\s+Actor '(?<actor>[^']+)'\s+\[(?<actor_id>\d+)\]\s+ejected from zone '(?<from_zone>[^']+)'\s+\[(?<from_zone_id>\d+)\]\s+to zone '(?<to_zone>[^']+)'\s+\[(?<to_zone_id>\d+)\]\s+due to (?<reason>.+)\./;

// CSCActorCorpseUtils (definitive player death - NO player name, needs currentUsername)
const corpseUtilsRegex =
  /<(?<timestamp>\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)>\s+\[Notice\]\s+<Adding non kept item \[CSCActorCorpseUtils::PopulateItemPortForItemRecoveryEntitlement\]>\s+Item '(?<item_name>[^']+)\s+-\s+Class\((?<item_class>[^)]+)\).*?Port Name '(?<port_name>[^']+)',\s+Class GUID:\s+'(?<guid>[^']+)'(?:,\s+KeptId:\s+'(?<kept_id>\d+)')?/;

// AttachmentReceived (player respawn - HAS player name)
const attachmentReceivedRegex =
  /<(?<timestamp>\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)>\s+\[Notice\]\s+<AttachmentReceived>\s+Player\[(?<player_name>[^\]]+)\]\s+Attachment\[(?<item_full_name>[^,]+),\s+(?<item_class>[^,]+),\s+(?<item_id>\d+)\]\s+Status\[(?<status>\w+)\]\s+Port\[(?<port>[^\]]+)\]\s+Elapsed\[(?<elapsed>[\d.]+)\]/;

// FatalCollision (detailed collision data)
const fatalCollisionRegex =
  /<(?<timestamp>\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)>\s+\[Notice\]\s+<FatalCollision>\s+Fatal Collision occured for vehicle (?<vehicle>\S+)\s+\[Part: (?<part>[^,]+), Pos: x: (?<pos_x>[-\d.]+), y: (?<pos_y>[-\d.]+), z: (?<pos_z>[-\d.]+), Zone: (?<zone>[^,]+), PlayerPilot: (?<player_pilot>\d+)\].*?after hitting entity: (?<hit_entity>[^\[]+)\[Zone: (?<hit_zone>[^\s]+).*?\].*?Hit Pos: x: (?<hit_x>[-\d.]+), y: (?<hit_y>[-\d.]+), z: (?<hit_z>[-\d.]+), Distance: (?<distance>[-\d.]+), Relative Vel: x: (?<vel_x>[-\d.]+), y: (?<vel_y>[-\d.]+), z: (?<vel_z>[-\d.]+)/;

// New Vehicle Destroyed (context-sensitive "Killed by" field)
const newVehicleDestroyedRegex =
  /<(?<timestamp>\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)>\s+\[VEHICLE SPAWN\]\s+Vehicle Destroyed \((?<vehicle>[^)]+)\)\.\s+Killed by \((?<killer>[^)]+)\)\.\s+Reason: (?<reason>\w+)/;
// === END NEW FORMAT PATTERNS ===

// Extract timestamp from any log line: <2026-05-22T22:33:58.036Z>
const lineTimestampRegex = /^<(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)>/;
function extractLineTimestamp(line: string): string {
    const match = line.match(lineTimestampRegex);
    return match ? match[1] : new Date().toISOString();
}

// Clean unresolved CIG template variables like ~mission(TargetName)
function cleanMissionName(name: string): string {
    return name.replace(/~mission\([^)]+\)/g, '').replace(/\s{2,}/g, ' ').trim();
}

// === SC 4.8+ GAMEPLAY EVENT PATTERNS ===
// Mission/Contract notifications (parsed from SHUDEvent_OnNotification lines)
const missionAcceptedRegex = /Added notification "Contract Accepted:\s+(?<missionName>.+?):\s*"\s*\[(?<notifId>\d+)\].*?MissionId:\s*\[(?<missionId>[^\]]*)\](?:.*?ObjectiveId:\s*\[(?<objectiveId>[^\]]*)\])?/;
const missionCompleteRegex = /Added notification "Contract Complete:\s+(?<missionName>.+?):\s*"\s*\[(?<notifId>\d+)\].*?MissionId:\s*\[(?<missionId>[^\]]*)\](?:.*?ObjectiveId:\s*\[(?<objectiveId>[^\]]*)\])?/;
const missionFailedRegex = /Added notification "Contract Failed:\s+(?<missionName>.+?):\s*"\s*\[(?<notifId>\d+)\].*?MissionId:\s*\[(?<missionId>[^\]]*)\](?:.*?ObjectiveId:\s*\[(?<objectiveId>[^\]]*)\])?/;
const missionSharedRegex = /Added notification "Contract Shared:\s+(?<missionName>.+?):\s*"\s*\[(?<notifId>\d+)\].*?MissionId:\s*\[(?<missionId>[^\]]*)\](?:.*?ObjectiveId:\s*\[(?<objectiveId>[^\]]*)\])?/;
const missionObjectiveRegex = /Added notification "New Objective:\s+(?<objectiveText>[^:]+):\s*"\s*\[(?<notifId>\d+)\].*?MissionId:\s*\[(?<missionId>[^\]]*)\](?:.*?ObjectiveId:\s*\[(?<objectiveId>[^\]]*)\])?/;
// Title wraps onto the next line ("Objective Complete: <text>\n: " [n]"), so a closing quote on the same line is optional
const missionObjectiveCompleteRegex = /Added notification "Objective Complete:\s+(?<objectiveText>[^"\r\n]+?)\s*(?::\s*"|$)/;
const missionObjectiveWithdrawnRegex = /Added notification "Objective Withdrawn:\s+(?<objectiveText>[^:]+):\s*"/;

// Party events (from notification text — may span multiple lines so match partial)
// Party "connected" notifications span 2 lines; match the 2nd line with "to queue" to dedup
// Names may contain hyphens/spaces: anchor after the timestamp instead of using \w+
const partyMemberConnectedRegex = /^<[^>]+>\s(?<playerName>[^\s<>"][^<>\r\n]*?) connected\.: "\s*\[\d+\] to queue/;
// Party "left" notifications: match with "to queue" suffix to only catch first occurrence
const partyMemberLeftRegex = /^<[^>]+>\s(?<playerName>[^\s<>"][^<>\r\n]*?) has left the party\.: "\s*\[\d+\] to queue/;
const partyDisbandedRegex = /Party Disbanded/;
// Body line only; the inviter handle is on the previous "Added notification "<handle>" line (see previousNotificationTitle)
const partyInviteRegex = /^<[^>]+>\s+Party Invite Received: Accept Invitation\?: "\s*\[\d+\] to queue/;
const memberLeftNotifRegex = /Added notification "Member Left/;

// VOIP channel events
const voipChannelLeftRegex = /^<[^>]+>\s(?<playerName>[^\s<>"][^<>\r\n]*?) has left the channel '(?<channelName>[^']+)'\.: "\s*\[\d+\] to queue/;

// Location/jurisdiction changes (from notifications)
const jurisdictionEnteredRegex = /Added notification "Entered (?<jurisdiction>[^:]+):\s*"\s*\[(?<notifId>\d+)\]/;
const monitoredSpaceRegex = /Added notification "(?<action>Entered|Exited) Monitored Space:\s*"\s*\[(?<notifId>\d+)\]/;

// Quantum travel
const qtFuelRequestRegex = /Player Requested Fuel to Quantum Target.*?destination (?<destination>\S+)/;
const qtRouteSuccessRegex = /Successfully calculated route to (?<destination>\S+) fuel estimate (?<fuel>[\d.]+)/;
const qtStartLocationRegex = /Projected Start Location is (?<startLocation>.+?) for route to destination/;

// Mission lifecycle (lower-level server state — used for correlation, not primary display)
const missionEndedRegex = /<MissionEnded>.*?mission_id (?<missionId>\S+) - mission_state (?<state>\S+)/;
const missionPhaseMarkerRegex = /CLocalMissionPhaseMarker::CreateMarker.*?missionId \[(?<missionId>[^\]]+)\].*?generator name \[(?<generatorName>[^\]]+)\].*?contract \[(?<contractName>[^\]]+)\].*?contractDefinitionId\[(?<contractDefId>[^\]]+)\].*?objectiveId \[(?<objectiveId>[^\]]+)\]/;

// Hangar/services
const hangarRequestRegex = /Added notification "Hangar Request Completed/;
const refuelRequestRegex = /Added notification "Refuel Request Accepted/;

// Notification dedup — tracks which notification IDs we've already processed
const processedNotificationIds = new Set<string>();

// Mission lifecycle tracking — maps mission name → accept timestamp for duration calculation
const activeMissions = new Map<string, { acceptTime: string; category: string }>();

// Mission metadata cache — maps missionId to enriched data from CLocalMissionPhaseMarker
const missionMetadataCache = new Map<string, { generatorName: string; contractName: string; contractDefinitionId: string }>();
// === END SC 4.8+ GAMEPLAY EVENT PATTERNS ===

// === SC 4.10 PATTERNS (build 13165946+) ===
// Local player GEID from the login line: "... geid 204772006105 - accountId ... - name <handle> - state ..."
const loginGeidRegex = /<AccountLoginCharacterStatus_Character>.*?\bgeid\s+(?<geid>\d+)\s.*?name\s+(?<name>\S+)\s+-/;
// <Vehicle Destroyed> replaces <Vehicle Destruction> (dead since 4.4). Owner [0] / _PU_AI_ in class = NPC ship.
const vehicleDestroyedRegex = /<(?<ts>[^>]+)> \[Notice\] <Vehicle Destroyed> Vehicle '(?<vehicle>[^']+)' \[(?<vehicleId>\d+)\] class '(?<vehicleClass>[^']+)' \(owner player \[(?<ownerId>\d+)\], driver \[(?<driverId>\d+)\]\) destroyed: reason \[(?<reason>\w+)\] level \[(?<levelFrom>\d+)\] -> \[(?<levelTo>\d+)\] flags \[(?<flags>\d+)\] killer '(?<killer>[^']*)' \[(?<killerId>\d+)\] authority \[(?<authority>\d+)\]/;
// Shop: a request is only a purchase once the matching RmShopFlowResponse says result[Success]
const shopBuyRequestRegex = /<(?<ts>[^>]+)> \[Notice\] <CEntityComponentShop(?:UI|ping)Provider::Send(?:Standard[A-Za-z]*|Shop)BuyRequest> Sending SShopBuyRequest - playerId\[(?<playerId>\d+)\] shopId\[(?<shopId>\d+)\] shopName\[(?<shopName>[^\]]+)\] kioskId\[\d+\] client_price\[(?<price>[\d.]+)\] itemClassGUID\[[^\]]+\] itemName\[(?<item>[^\]]+)\] quantity\[(?<qty>\d+)\](?: currencyType\[(?<currency>\w+)\])?/;
const shopRentalRequestRegex = /<(?<ts>[^>]+)> \[Notice\] <CEntityComponentShop(?:UI|ping)Provider::SendRentalRequest> Sending SShopRentalRequest - playerId\[(?<playerId>\d+)\] shopId\[(?<shopId>\d+)\] shopName\[(?<shopName>[^\]]+)\] kioskId\[\d+\] client_price\[(?<price>[\d.]+)\] itemClassGUID\[[^\]]+\] itemName\[(?<item>[^\]]+)\] offering\[(?<offering>\d+)\](?: currencyType\[(?<currency>\w+)\])?/;
const shopFlowResponseRegex = /<(?<ts>[^>]+)> \[Notice\] <CEntityComponentShop(?:UI|ping)Provider::RmShopFlowResponse> (?:Received ShopFlowResponse|Shop Flow Response) - playerId\[(?<playerId>\d+)\].*?result\[(?<result>\w+)\](?: type\[(?<type>\w+)\])?/;
const SHOP_PAIRING_WINDOW_MS = 3000;
// Mission comms tags: +Missions.Organization.<org>,Missions.MissionType.<type>,Missions.CommsNotifications.<step>
const commsNotificationRegex = /<CommsNotifications> SendCommsNotification \+(?<tags>[^ ]+) - \[[^\]]+\] - Mission: \[(?<missionId>[^\]]+)\], Player: (?<player>[^\[]+)\[/;
// Objective progress (chatty: de-duplicated by id + text)
const objectiveProgressRegex = /<CMissionLogEntry::UpdateActiveObjective> Objective updated id=(?<objectiveId>[^,]+), flags=(?<flags>[^,]*), hidden=(?<hidden>\d).*?uiDisplay\[Priority=\d+\]\[Text=(?<text>[^\]]*)\]/;
const statusEffectRegex = /<(?<ts>[^>]+)> Logged a start of a status effect! nickname: (?<player>[^,]+), status effect: (?<effect>\w+)/;
const rewardEarnedRegex = /Added notification "You've Earned: (?<reward>[^\r\n"]+)/;
const emergencyServicesRegex = /Added notification "Standby, Local Emergency Services Are En Route/;
const zoneNoticeRegex = /Added notification "(?<action>Entering|Leaving) (?<zone>Armistice Zone|Private Property)/;
const qtSelectedRegex = /<Player Selected Quantum Target - Local>.*?\| (?<vehicle>[A-Za-z0-9_]+)\[\d+\]\|.*?selected point (?<destination>\S+) as their destination/;
const qtArrivedRegex = /<Quantum Drive Arrived - Arrived at Final Destination>.*?\| (?<vehicle>[A-Za-z0-9_]+)\[(?<vehicleId>\d+)\]\|/;
// Ship crew channel: own joins/leaves come from the "Added notification" line, others from the body line
const channelSelfRegex = /Added notification "You have (?<action>joined|left)(?: the)? channel '(?<channelName>[^']+)'/;
const channelOtherJoinedRegex = /^<[^>]+>\s(?<playerName>[^\s<>"][^<>\r\n]*?) has joined the channel '(?<channelName>[^']+)'\.: "\s*\[\d+\] to queue/;
// Multi-line notification titles: "Added notification "<title>" with no closing quote on the line (kept as previous-line state)
const notificationTitleOnlyRegex = /Added notification "(?<title>[^"\r\n]*?)\s*$/;
// === END SC 4.10 PATTERNS ===

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
// SUNSET (SC 4.4+): pattern no longer emitted by the game. Kept for old logs.
const corpseLogRegex = /<(?<timestamp>\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)>.*?<\[ActorState\] Corpse>.*?Player '(?<playerName>[^']+)'/;
// SUNSET (SC 4.4+): pattern no longer emitted by the game. Kept for old logs.
const killPatternRegex = /<(?<timestamp>\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)>.*?<Actor Death> CActor::Kill: '(?<Victim>[^']+)' \[\d+\] in zone '(?<Zone>[^']+)' killed by '(?<Killer>[^']+)' \[[^']+\] using '(?<Weapon>[^']+)' \[Class (?<Class>[^\]]+)\] with damage type '(?<DamageType>[^']+)'/;
const incapRegex = /Logged an incap.! nickname: (?<playerName>[^,]+), causes: \[(?<cause>[^\]]+)\]/;
// SUNSET (SC 4.4+): pattern no longer emitted by the game. Kept for old logs.
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

// === DUAL-MODE DETECTION HELPER FUNCTIONS ===

/**
 * Checks if a death event should be processed or is a duplicate
 * Returns true if should process, false if duplicate
 */
function shouldProcessDeath(
  playerName: string,
  timestamp: string,
  detectionMethod: string
): boolean {
  const timestampSeconds = Math.floor(new Date(timestamp).getTime() / 1000);
  const dedupKey = `${playerName.toLowerCase()}:${timestampSeconds}`;

  if (recentDeaths.has(dedupKey)) {
    const existing = recentDeaths.get(dedupKey)!;
    const currentPriority = DETECTION_PRIORITY.indexOf(detectionMethod);
    const existingPriority = DETECTION_PRIORITY.indexOf(existing.method);

    if (currentPriority < existingPriority) {
      logger.info(MODULE_NAME, `Upgrading death detection from ${existing.method} to ${detectionMethod} for ${playerName}`);
      recentDeaths.set(dedupKey, { method: detectionMethod, timestamp: Date.now() });
      return true;
    } else {
      logger.debug(MODULE_NAME, `Skipping duplicate death (${detectionMethod}) - already detected via ${existing.method}`);
      detectionStats.duplicates_prevented++;
      return false;
    }
  }

  recentDeaths.set(dedupKey, { method: detectionMethod, timestamp: Date.now() });

  // Clean up old entries
  const now = Date.now();
  for (const [key, value] of recentDeaths.entries()) {
    if (now - value.timestamp > DEDUP_WINDOW_MS) {
      recentDeaths.delete(key);
    }
  }

  return true;
}

/**
 * Log detection statistics
 */
function logDetectionStats() {
  logger.info(MODULE_NAME, '=== Death Detection Statistics ===');
  logger.info(MODULE_NAME, `Old Corpse Log: ${detectionStats.old_corpse_log}`);
  logger.info(MODULE_NAME, `New ActorState Dead: ${detectionStats.actor_state_dead_new}`);
  logger.info(MODULE_NAME, `New CorpseUtils: ${detectionStats.corpse_utils_new}`);
  logger.info(MODULE_NAME, `AttachmentReceived: ${detectionStats.attachment_received}`);
  logger.info(MODULE_NAME, `Unknown Format: ${detectionStats.unknown_format}`);
  logger.info(MODULE_NAME, `Duplicates Prevented: ${detectionStats.duplicates_prevented}`);

  if (detectionStats.old_corpse_log > detectionStats.corpse_utils_new * 2) {
    logger.warn(MODULE_NAME, 'Old format significantly higher than new - investigate!');
  }
}

// === END DUAL-MODE DETECTION HELPER FUNCTIONS ===


// --- SC 4.10 helpers ---

// "SCShop_Centermass_NewBabbage" -> "Centermass New Babbage"
function prettifyShopName(raw: string): string {
    return raw.replace(/^SCShop_/, '').replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/\s{2,}/g, ' ').trim();
}

// "RSI Galaxy : Handle" -> { shipName: "RSI Galaxy", shipOwner: "Handle" }
function parseChannelName(channel: string): { shipName?: string; shipOwner?: string } {
    const idx = channel.lastIndexOf(' : ');
    if (idx < 0) return {};
    return { shipName: channel.slice(0, idx).trim(), shipOwner: channel.slice(idx + 3).trim() };
}

// "Missions.Organization.Navy.Baramsco,Missions.MissionType.WaveAttack.SingleTarget,..." -> org/type
function parseCommsTags(tags: string): { organization?: string; type?: string } {
    const out: { organization?: string; type?: string } = {};
    for (const tag of tags.split(',')) {
        const t = tag.replace(/^\+/, '').replace(/^Missions\./, '');
        if (t.startsWith('Organization.')) out.organization = t.slice('Organization.'.length);
        else if (t.startsWith('MissionType.')) out.type = t.slice('MissionType.'.length);
    }
    return out;
}

function commsMeta(missionId: string | undefined): Partial<KillEvent> {
    const meta = missionId ? missionCommsCache.get(missionId) : undefined;
    return meta ? { missionOrganization: meta.organization, missionType: meta.type } : {};
}

// "Go to ~mission(Location)" / "Waves Defeated: %ls" -> cleaned objective text ('' when nothing useful)
function cleanObjectiveText(text: string): string {
    if (text.includes('UNINITIALIZED')) return '';
    return text.replace(/~mission\([^)]*\)/g, '').replace(/%ls/g, '').replace(/\s{2,}/g, ' ').replace(/[:\s]+$/, '').trim();
}

function isLocalPlayerId(id: string): boolean {
    return !currentGeid || id === currentGeid; // unknown GEID (login line not parsed yet): accept
}

/**
 * <Vehicle Destroyed> (SC 4.10): killer/victim rules mirror the server contract.
 * Only reason=Combat credits a killer; Collision -> Environment; SelfDestruct -> Self-Destruct.
 * Only events where the local player is the killer or the ship owner are emitted.
 */
async function handleVehicleDestroyed(g: Record<string, string>, silentMode: boolean): Promise<void> {
    const { ts, vehicle, vehicleId, vehicleClass, ownerId, reason, levelFrom, levelTo, killer, killerId } = g;
    const isNpcTarget = ownerId === '0' || vehicleClass.includes('_PU_AI_');
    const isOwnShip = !isNpcTarget && ((!!currentGeid && ownerId === currentGeid));
    const killerIsMe = reason === 'Combat' && ((!!currentGeid && killerId === currentGeid) || (!!currentUsername && killer === currentUsername));
    const isPlayerInvolved = isOwnShip || killerIsMe;
    if (!isPlayerInvolved) {
        logger.debug(MODULE_NAME, `Skipping Vehicle Destroyed - local player not involved (${vehicleClass}, reason ${reason}).`);
        return;
    }

    let killers: string[];
    let deathType: KillEvent['deathType'];
    if (reason === 'Combat') {
        killers = [killer && killer !== 'none' ? killer : 'Unknown'];
        deathType = 'Combat';
    } else if (reason === 'SelfDestruct') {
        killers = ['Self-Destruct'];
        deathType = 'Hard';
    } else {
        killers = ['Environment']; // Collision (and unknown reasons) never credit a player
        deathType = reason === 'Collision' ? 'Collision' : 'Hard';
    }
    const victims = isOwnShip ? [currentUsername || 'Unknown pilot'] : isNpcTarget ? [vehicleClass] : ['Unknown pilot'];
    const collisionWith = reason === 'Collision' && killerId !== ownerId && killerId !== '0' && killer && killer !== 'none' ? killer : undefined;

    const resolution = resolveEntityName(vehicleClass);
    const vehicleType = resolution.category === 'npc' ? 'NPC' : resolution.displayName;
    const locationData = processLocationDataEnhanced(undefined, undefined, 'vehicle_destroyed_4_10', ts);
    const level = parseInt(levelTo) || 2;

    logger.info(MODULE_NAME, 'Vehicle Destroyed (4.10):', { ship: vehicleClass }, `reason ${reason}`, isOwnShip ? '(own ship lost)' : '(kill)');

    const partialEvent: Partial<KillEvent> = {
        id: `vd410_${vehicleId}_${levelTo}`,
        timestamp: ts,
        killers,
        victims,
        deathType,
        vehicleType,
        vehicleModel: vehicleClass,
        vehicleId: vehicle,
        location: locationData.location,
        weapon: reason,
        damageType: reason,
        gameMode: stableGameMode,
        gameVersion: currentGameVersion,
        playerShip: currentPlayerShip,
        coordinates: locationData.coordinates,
        isPlayerInvolved: true,
        playerHandle: currentUsername || undefined,
        eventData: {
            detectionMethod: 'vehicle_destroyed_4_10',
            vehicleClass,
            vehicleId,
            reason,
            destroyLevelFrom: parseInt(levelFrom),
            destroyLevelTo: parseInt(levelTo),
            isNpcTarget,
            ownerGeid: ownerId,
            killerGeid: killerId,
            ...(collisionWith ? { collisionWith } : {}),
        },
    };
    await processKillEvent(partialEvent, silentMode, level);
}

// Builds + emits a self-only activity event (no killers/victims) in the same shape as the other 4.8+ events.
async function emitActivityEvent(
    eventType: GameEventType,
    id: string,
    timestamp: string,
    eventDescription: string,
    extra: Partial<KillEvent>,
    silentMode: boolean
): Promise<void> {
    const partialEvent: Partial<KillEvent> = {
        id,
        timestamp,
        killers: [],
        victims: [],
        deathType: 'Unknown',
        eventType,
        visibility: EVENT_VISIBILITY_MAP[eventType],
        gameMode: stableGameMode,
        gameVersion: currentGameVersion,
        playerShip: currentPlayerShip,
        eventDescription,
        isPlayerInvolved: true,
        playerHandle: currentUsername || undefined,
        ...extra,
    };
    await processKillEvent(partialEvent, silentMode, 0);
}

// --- Main Parsing Function ---

export async function parseLogContent(content: string, silentMode = false) {
    // Initialize zone system on first parse
    initializeZoneSystem();
    
    const lines = content.split('\n');
    const win = getMainWindow(); // Get window reference once

    for (const line of lines) {
        if (!line.trim()) continue; // Skip empty lines

        // Previous-line state for multi-line notifications (title line has no closing quote)
        const priorNotificationTitle = previousNotificationTitle;
        const titleMatch = line.match(notificationTitleOnlyRegex);
        previousNotificationTitle = titleMatch?.groups?.title ? titleMatch.groups.title : null;

        try { // Add try-catch around line processing
            // --- Login Detection ---
            const geidMatch = line.match(loginGeidRegex);
            if (geidMatch?.groups) currentGeid = geidMatch.groups.geid;
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

            // --- Vehicle Destroyed (SC 4.10) ---
            const vehicleDestroyedMatch = line.match(vehicleDestroyedRegex);
            if (vehicleDestroyedMatch?.groups) {
                await handleVehicleDestroyed(vehicleDestroyedMatch.groups, silentMode);
                continue;
            }

            // --- Vehicle Destruction (SUNSET: pre-4.4 format) ---
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
                        isPlayerInvolved: isPlayerInvolved,
                        playerHandle: currentUsername || undefined,
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

            // === NEW FORMAT: Vehicle Destroyed (SC 4.4+) ===
            if (ENABLE_NEW_FORMAT) {
                const newVehicleMatch = line.match(newVehicleDestroyedRegex);
                if (newVehicleMatch?.groups) {
                    const { timestamp, vehicle, killer, reason } = newVehicleMatch.groups;
                    const vehicleCleanupMatch = vehicle.match(cleanupPattern);
                    const vehicleBaseName = vehicleCleanupMatch?.[1] || vehicle;

                    logger.info(MODULE_NAME, 'NEW FORMAT Vehicle Destroyed:', {
                        vehicle: vehicleBaseName,
                        killer,
                        reason
                    });

                    // Context-sensitive "Killed by" field:
                    // - reason === "Collision" → killer = VICTIM (pilot who died)
                    // - reason === "Combat" → killer = ATTACKER (player who got kill)
                    // - reason === "Explosion" → killer = ATTACKER (who caused explosion)

                    let actualKiller: string;
                    let actualVictim: string;
                    let deathType: KillEvent['deathType'];

                    if (reason === 'Collision') {
                        actualVictim = killer; // Killer field is actually the victim
                        actualKiller = 'Environment'; // Environmental/self-inflicted
                        deathType = 'Collision';
                    } else if (reason === 'Combat') {
                        actualKiller = killer; // Killer field is correct
                        actualVictim = vehicleBaseName; // Vehicle/pilot is victim
                        deathType = 'Combat';
                    } else if (reason === 'Explosion') {
                        actualKiller = killer; // Killer field is correct
                        actualVictim = vehicleBaseName; // Vehicle/pilot is victim
                        deathType = 'Hard'; // Explosions are hard deaths
                    } else {
                        actualKiller = killer;
                        actualVictim = vehicleBaseName;
                        deathType = 'Unknown';
                    }

                    logger.debug(MODULE_NAME, `NEW FORMAT - Reason: ${reason}, ActualKiller: ${actualKiller}, ActualVictim: ${actualVictim}`);

                    // Check if player is involved
                    const isPlayerInvolved = actualKiller === currentUsername || actualVictim === currentUsername;

                    if (isPlayerInvolved) {
                        // Process location data
                        const locationData = processLocationDataEnhanced(
                            undefined, // No zone in new format
                            undefined, // No coordinates in new format
                            'new_vehicle_destroyed',
                            timestamp
                        );

                        // Resolve vehicle type
                        const vehicleResolution = resolveEntityName(vehicleBaseName);
                        let resolvedVehicleType: string;

                        if (vehicleResolution.category === 'npc') {
                            resolvedVehicleType = "NPC";
                        } else if (vehicleResolution.category === 'ship') {
                            resolvedVehicleType = vehicleResolution.displayName;
                        } else {
                            resolvedVehicleType = vehicleResolution.displayName;
                        }

                        const stableId = `v_kill_new_${vehicle}`.replace(/[^a-zA-Z0-9_]/g, '');
                        const partialEvent: Partial<KillEvent> = {
                            id: stableId,
                            timestamp: timestamp,
                            killers: actualKiller === 'Environment' ? [] : [actualKiller],
                            victims: [actualVictim],
                            deathType: deathType,
                            vehicleType: resolvedVehicleType,
                            vehicleModel: vehicleBaseName,
                            vehicleId: vehicle,
                            location: locationData.location,
                            weapon: reason, // Use reason as weapon/cause
                            damageType: reason,
                            gameMode: stableGameMode,
                            gameVersion: currentGameVersion,
                            playerShip: currentPlayerShip,
                            coordinates: locationData.coordinates,
                            isPlayerInvolved: isPlayerInvolved,
                            playerHandle: currentUsername || undefined,
                        };

                        logger.debug(MODULE_NAME, `Processing NEW FORMAT vehicle destruction - user involved: ${currentUsername}`);
                        await processKillEvent(partialEvent, silentMode, 2); // Treat as level 2 destruction
                    } else {
                        logger.debug(MODULE_NAME, `Skipping NEW FORMAT vehicle destruction - user not involved. ActualKiller: ${actualKiller}, ActualVictim: ${actualVictim}, current user: ${currentUsername || 'none'}`);
                    }

                    continue;
                }
            }

            // === DUAL-MODE PLAYER DEATH DETECTION ===
            let deathDetected = false;
            let detectionMethod: string | null = null;
            let victimName: string | null = null;
            let deathTimestamp: string | null = null;

            // 1. Try OLD FORMAT: Corpse Log (most reliable - has player name)
            if (ENABLE_OLD_FORMAT) {
                const corpseMatch = line.match(corpseLogRegex);
                if (corpseMatch?.groups) {
                    detectionMethod = 'corpse_log_old';
                    victimName = corpseMatch.groups.playerName;
                    deathTimestamp = corpseMatch.groups.timestamp;
                    deathDetected = true;

                    logger.info(MODULE_NAME, 'OLD FORMAT Corpse Log detected:', { victim: victimName });
                    detectionStats.old_corpse_log++;
                }
            }

            // 2. Try NEW FORMAT: ActorState Dead (has player name, vehicle context)
            if (!deathDetected && ENABLE_NEW_FORMAT) {
                const newActorDeadMatch = line.match(newActorStateDeadRegex);
                if (newActorDeadMatch?.groups) {
                    detectionMethod = 'actor_state_dead_new';
                    victimName = newActorDeadMatch.groups.actor;
                    deathTimestamp = newActorDeadMatch.groups.timestamp;
                    deathDetected = true;

                    logger.info(MODULE_NAME, 'NEW FORMAT ActorState Dead detected:', {
                        victim: victimName,
                        fromZone: newActorDeadMatch.groups.from_zone,
                        toZone: newActorDeadMatch.groups.to_zone
                    });
                    detectionStats.actor_state_dead_new++;
                }
            }

            // 3. Try NEW FORMAT: CSCActorCorpseUtils (NO player name - use currentUsername)
            if (!deathDetected && ENABLE_NEW_FORMAT) {
                const corpseUtilsMatch = line.match(corpseUtilsRegex);
                if (corpseUtilsMatch?.groups) {
                    // Only process first item (body) to avoid duplicates
                    if (corpseUtilsMatch.groups.item_class.includes('body_01')) {
                        detectionMethod = 'corpse_utils_new';
                        victimName = currentUsername; // Use current logged-in username
                        deathTimestamp = corpseUtilsMatch.groups.timestamp;
                        deathDetected = true;

                        logger.info(MODULE_NAME, 'NEW FORMAT CSCActorCorpseUtils detected, resolved to:', { victim: victimName });
                        detectionStats.corpse_utils_new++;
                    }
                }
            }

            // Process death event if detected
            if (deathDetected && victimName && deathTimestamp && detectionMethod) {
                // Check for duplicates
                if (!shouldProcessDeath(victimName, deathTimestamp, detectionMethod)) {
                    continue; // Skip duplicate
                }

                logger.info(MODULE_NAME, 'Player death detected:', { victim: victimName }, 'via', detectionMethod);
                const deathTimeMs = new Date(deathTimestamp).getTime();

                // Add to recent deaths for correlation
                recentPlayerDeaths.push({ timestamp: deathTimeMs, playerName: victimName, processed: false });

                // Clean up old entries (keep last 60 seconds)
                const cutoffTime = Date.now() - 60000;
                while (recentPlayerDeaths.length > 0 && recentPlayerDeaths[0].timestamp < cutoffTime) {
                    recentPlayerDeaths.shift();
                }

                // Attempt correlation
                await correlateDeathWithDestruction(deathTimestamp, victimName, silentMode);
                continue;
            }
            // === END DUAL-MODE PLAYER DEATH DETECTION ===

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
                        isPlayerInvolved: isPlayerInvolved,
                        playerHandle: currentUsername || undefined,
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
                    isPlayerInvolved: isPlayerInvolved,
                    playerHandle: currentUsername || undefined,
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

            // === SC 4.8+ GAMEPLAY EVENT DETECTION ===
            const lineTs = extractLineTimestamp(line);

            // --- Mission Phase Marker (metadata enrichment) ---
            const phaseMarkerMatch = line.match(missionPhaseMarkerRegex);
            if (phaseMarkerMatch?.groups) {
                const { missionId, generatorName, contractName, contractDefId } = phaseMarkerMatch.groups;
                if (missionId && missionId !== '00000000-0000-0000-0000-000000000000') {
                    missionMetadataCache.set(missionId, { generatorName, contractName, contractDefinitionId: contractDefId });
                    logger.debug(MODULE_NAME, `Mission metadata cached: ${missionId} → ${contractName} (${generatorName})`);
                }
                continue;
            }

            // --- Mission Contract Events (from HUD notifications) ---
            const missionAcceptMatch = line.match(missionAcceptedRegex);
            if (missionAcceptMatch?.groups) {
                const { missionName, notifId, missionId, objectiveId } = missionAcceptMatch.groups;
                if (!processedNotificationIds.has(notifId)) {
                    processedNotificationIds.add(notifId);
                    const cleaned = cleanMissionName(missionName);
                    const category = classifyMission(cleaned);
                    activeMissions.set(cleaned, { acceptTime: lineTs, category });
                    logger.info(MODULE_NAME, 'Mission accepted:', { mission: cleaned, category });
                    const locationData = processLocationDataEnhanced(undefined, undefined, 'mission_accepted');
                    const eventId = `mission_accept_${missionId || notifId}`;
                    const partialEvent: Partial<KillEvent> = {
                        id: eventId,
                        timestamp: lineTs,
                        killers: [],
                        victims: [],
                        deathType: 'Unknown',
                        eventType: 'mission_accepted' as GameEventType,
                        missionName: cleaned,
                        missionCategory: category,
                        missionId: missionId || undefined,
                        objectiveId: objectiveId || undefined,
                        ...commsMeta(missionId),
                        contractName: missionMetadataCache.get(missionId || '')?.contractName,
                        contractDefinitionId: missionMetadataCache.get(missionId || '')?.contractDefinitionId,
                        generatorName: missionMetadataCache.get(missionId || '')?.generatorName,
                        visibility: EVENT_VISIBILITY_MAP['mission_accepted'],
                        location: locationData.location,
                        gameMode: stableGameMode,
                        gameVersion: currentGameVersion,
                        playerShip: currentPlayerShip,
                        eventDescription: `Contract Accepted: ${cleaned}`,
                        isPlayerInvolved: true,
                        playerHandle: currentUsername || undefined,
                    };
                    await processKillEvent(partialEvent, silentMode, 0);
                }
                continue;
            }

            const missionCompleteMatch = line.match(missionCompleteRegex);
            if (missionCompleteMatch?.groups) {
                const { missionName, notifId, missionId, objectiveId } = missionCompleteMatch.groups;
                if (!processedNotificationIds.has(notifId)) {
                    processedNotificationIds.add(notifId);
                    const cleaned = cleanMissionName(missionName);
                    const active = activeMissions.get(cleaned);
                    let duration: number | undefined;
                    let category = classifyMission(cleaned);
                    if (active) {
                        duration = Math.round((new Date(lineTs).getTime() - new Date(active.acceptTime).getTime()) / 1000);
                        category = active.category as any || category;
                        activeMissions.delete(cleaned);
                    }
                    const durationStr = duration ? ` (${Math.floor(duration / 60)}m ${duration % 60}s)` : '';
                    logger.info(MODULE_NAME, 'Mission complete:', { mission: cleaned, duration, category });
                    const locationData = processLocationDataEnhanced(undefined, undefined, 'mission_complete');
                    const eventId = `mission_complete_${missionId || notifId}`;
                    const partialEvent: Partial<KillEvent> = {
                        id: eventId,
                        timestamp: lineTs,
                        killers: [],
                        victims: [],
                        deathType: 'Unknown',
                        eventType: 'mission_complete' as GameEventType,
                        missionName: cleaned,
                        missionCategory: category,
                        missionDuration: duration,
                        missionId: missionId || undefined,
                        objectiveId: objectiveId || undefined,
                        ...commsMeta(missionId),
                        contractName: missionMetadataCache.get(missionId || '')?.contractName,
                        contractDefinitionId: missionMetadataCache.get(missionId || '')?.contractDefinitionId,
                        generatorName: missionMetadataCache.get(missionId || '')?.generatorName,
                        visibility: EVENT_VISIBILITY_MAP['mission_complete'],
                        location: locationData.location,
                        gameMode: stableGameMode,
                        gameVersion: currentGameVersion,
                        playerShip: currentPlayerShip,
                        eventDescription: `Contract Complete: ${cleaned}${durationStr}`,
                        isPlayerInvolved: true,
                        playerHandle: currentUsername || undefined,
                    };
                    await processKillEvent(partialEvent, silentMode, 0);
                }
                continue;
            }

            const missionSharedMatch = line.match(missionSharedRegex);
            if (missionSharedMatch?.groups) {
                const { missionName, notifId, missionId, objectiveId } = missionSharedMatch.groups;
                if (!processedNotificationIds.has(notifId)) {
                    processedNotificationIds.add(notifId);
                    const cleaned = cleanMissionName(missionName);
                    logger.info(MODULE_NAME, 'Mission shared:', { mission: cleaned });
                    const eventId = `mission_shared_${missionId || notifId}`;
                    const partialEvent: Partial<KillEvent> = {
                        id: eventId,
                        timestamp: lineTs,
                        killers: [],
                        victims: [],
                        deathType: 'Unknown',
                        eventType: 'mission_shared' as GameEventType,
                        missionName: cleaned,
                        missionCategory: classifyMission(cleaned),
                        missionId: missionId || undefined,
                        objectiveId: objectiveId || undefined,
                        ...commsMeta(missionId),
                        contractName: missionMetadataCache.get(missionId || '')?.contractName,
                        contractDefinitionId: missionMetadataCache.get(missionId || '')?.contractDefinitionId,
                        generatorName: missionMetadataCache.get(missionId || '')?.generatorName,
                        visibility: EVENT_VISIBILITY_MAP['mission_shared'],
                        gameMode: stableGameMode,
                        gameVersion: currentGameVersion,
                        playerShip: currentPlayerShip,
                        eventDescription: `Contract Shared: ${cleaned}`,
                        isPlayerInvolved: true,
                        playerHandle: currentUsername || undefined,
                    };
                    await processKillEvent(partialEvent, silentMode, 0);
                }
                continue;
            }

            const missionFailedMatch = line.match(missionFailedRegex);
            if (missionFailedMatch?.groups) {
                const { missionName, notifId, missionId, objectiveId } = missionFailedMatch.groups;
                if (!processedNotificationIds.has(notifId)) {
                    processedNotificationIds.add(notifId);
                    const cleaned = cleanMissionName(missionName);
                    const active = activeMissions.get(cleaned);
                    let duration: number | undefined;
                    let category = classifyMission(cleaned);
                    if (active) {
                        duration = Math.round((new Date(lineTs).getTime() - new Date(active.acceptTime).getTime()) / 1000);
                        category = active.category as any || category;
                        activeMissions.delete(cleaned);
                    }
                    const durationStr = duration ? ` (${Math.floor(duration / 60)}m ${duration % 60}s)` : '';
                    logger.info(MODULE_NAME, 'Mission failed:', { mission: cleaned, duration, category });
                    const locationData = processLocationDataEnhanced(undefined, undefined, 'mission_failed');
                    const eventId = `mission_failed_${missionId || notifId}`;
                    const partialEvent: Partial<KillEvent> = {
                        id: eventId,
                        timestamp: lineTs,
                        killers: [],
                        victims: [],
                        deathType: 'Unknown',
                        eventType: 'mission_failed' as GameEventType,
                        missionName: cleaned,
                        missionCategory: category,
                        missionDuration: duration,
                        missionId: missionId || undefined,
                        objectiveId: objectiveId || undefined,
                        ...commsMeta(missionId),
                        contractName: missionMetadataCache.get(missionId || '')?.contractName,
                        contractDefinitionId: missionMetadataCache.get(missionId || '')?.contractDefinitionId,
                        generatorName: missionMetadataCache.get(missionId || '')?.generatorName,
                        visibility: EVENT_VISIBILITY_MAP['mission_failed'],
                        location: locationData.location,
                        gameMode: stableGameMode,
                        gameVersion: currentGameVersion,
                        playerShip: currentPlayerShip,
                        eventDescription: `Contract Failed: ${cleaned}${durationStr}`,
                        isPlayerInvolved: true,
                        playerHandle: currentUsername || undefined,
                    };
                    await processKillEvent(partialEvent, silentMode, 0);
                }
                continue;
            }

            // --- Mission Objective Events ---
            const objectiveMatch = line.match(missionObjectiveRegex);
            if (objectiveMatch?.groups) {
                const { objectiveText, notifId, missionId, objectiveId } = objectiveMatch.groups;
                if (!processedNotificationIds.has(`obj_${notifId}`)) {
                    processedNotificationIds.add(`obj_${notifId}`);
                    logger.info(MODULE_NAME, 'New objective:', { objective: objectiveText.trim() });
                    const eventId = `objective_new_${missionId || notifId}`;
                    const partialEvent: Partial<KillEvent> = {
                        id: eventId,
                        timestamp: lineTs,
                        killers: [],
                        victims: [],
                        deathType: 'Unknown',
                        eventType: 'objective_update' as GameEventType,
                        objectiveText: objectiveText.trim(),
                        missionId: missionId || undefined,
                        objectiveId: objectiveId || undefined,
                        visibility: EVENT_VISIBILITY_MAP['objective_update'],
                        gameMode: stableGameMode,
                        gameVersion: currentGameVersion,
                        playerShip: currentPlayerShip,
                        eventDescription: `New Objective: ${objectiveText.trim()}`,
                        isPlayerInvolved: true,
                        playerHandle: currentUsername || undefined,
                    };
                    await processKillEvent(partialEvent, silentMode, 0);
                }
                continue;
            }

            // === SC 4.10 ACTIVITY EVENTS ===
            // Mission comms tags (cached per missionId; attached to the mission events that follow)
            const commsMatch = line.match(commsNotificationRegex);
            if (commsMatch?.groups) {
                const { tags, missionId } = commsMatch.groups;
                const parsedTags = parseCommsTags(tags);
                if (parsedTags.organization || parsedTags.type) {
                    missionCommsCache.set(missionId, { organization: parsedTags.organization, type: parsedTags.type });
                }
                continue;
            }

            // Shop request: remember it until the matching RmShopFlowResponse arrives (may be in a later chunk)
            const shopReqMatch = line.match(shopBuyRequestRegex) || line.match(shopRentalRequestRegex);
            if (shopReqMatch?.groups) {
                const g = shopReqMatch.groups;
                const ms = Date.parse(g.ts);
                const cutoff = ms - 10000;
                for (let i = pendingShopRequests.length - 1; i >= 0; i--) {
                    if (pendingShopRequests[i].ms < cutoff) pendingShopRequests.splice(i, 1);
                }
                pendingShopRequests.push({
                    ms, ts: g.ts, playerId: g.playerId,
                    action: g.offering !== undefined ? 'rent' : 'buy',
                    shopName: g.shopName, item: g.item,
                    quantity: g.qty !== undefined ? parseInt(g.qty) : undefined,
                    offering: g.offering !== undefined ? parseInt(g.offering) : undefined,
                    price: parseFloat(g.price), currency: g.currency || 'UEC',
                });
                continue;
            }

            const shopRespMatch = line.match(shopFlowResponseRegex);
            if (shopRespMatch?.groups) {
                const { ts, playerId, result } = shopRespMatch.groups;
                const ms = Date.parse(ts);
                // Drop stale requests, then take the oldest pending request for this player (responses answer in order)
                for (let i = pendingShopRequests.length - 1; i >= 0; i--) {
                    if (ms - pendingShopRequests[i].ms > SHOP_PAIRING_WINDOW_MS) pendingShopRequests.splice(i, 1);
                }
                const idx = pendingShopRequests.findIndex(p => p.playerId === playerId && ms >= p.ms);
                if (idx >= 0) {
                    const req = pendingShopRequests.splice(idx, 1)[0];
                    if (result === 'Success' && isLocalPlayerId(req.playerId)) {
                        const shopDisplayName = prettifyShopName(req.shopName);
                        const verb = req.action === 'buy' ? 'Bought' : 'Rented';
                        const qty = req.action === 'buy' && (req.quantity ?? 1) > 1 ? ` x${req.quantity}` : '';
                        await emitActivityEvent('shop_transaction', `shop_${req.ts}_${req.playerId}_${req.item}`, req.ts,
                            `${verb} ${req.item}${qty} at ${shopDisplayName} for ${Math.round(req.price).toLocaleString('en-US')} ${req.currency}`,
                            {
                                eventData: {
                                    action: req.action, shopName: req.shopName, shopDisplayName, item: req.item,
                                    ...(req.action === 'buy' ? { quantity: req.quantity } : { offering: req.offering }),
                                    price: req.price, currency: req.currency, result: 'Success',
                                },
                            }, silentMode);
                    }
                }
                continue;
            }

            // Objective progress (de-duplicated by id + text)
            const objProgressMatch = line.match(objectiveProgressRegex);
            if (objProgressMatch?.groups) {
                const { objectiveId, text } = objProgressMatch.groups;
                const dedupKey = `${objectiveId}|${text}`;
                if (!seenObjectiveProgress.has(dedupKey)) {
                    seenObjectiveProgress.add(dedupKey);
                    const cleaned = cleanObjectiveText(text);
                    if (cleaned) {
                        await emitActivityEvent('objective_update', `objective_prog_${objectiveId}_${cleaned.replace(/[^a-zA-Z0-9]+/g, '_')}`, lineTs,
                            `Objective: ${cleaned}`,
                            { objectiveText: cleaned, objectiveId, eventData: { progress: true } }, silentMode);
                    }
                }
                continue;
            }

            // Objective complete (title wraps onto the next line, so no closing quote is required)
            const objCompleteMatch = line.match(missionObjectiveCompleteRegex);
            if (objCompleteMatch?.groups) {
                const objectiveText = objCompleteMatch.groups.objectiveText.trim();
                await emitActivityEvent('objective_update', `objective_complete_${lineTs}_${objectiveText.replace(/[^a-zA-Z0-9]+/g, '_')}`, lineTs,
                    `Objective Complete: ${objectiveText}`,
                    { objectiveText, eventData: { completed: true } }, silentMode);
                continue;
            }

            // Party invite: inviter is on the previous "Added notification" title line
            if (partyInviteRegex.test(line)) {
                const inviter = priorNotificationTitle;
                if (inviter) {
                    await emitActivityEvent('party_invite', `party_invite_${lineTs}_${inviter.replace(/[^a-zA-Z0-9]+/g, '_')}`, lineTs,
                        `Party invite from ${inviter}`, { partyMember: inviter }, silentMode);
                }
                continue;
            }

            // Own status effects (the line also names other nearby players: ignore those)
            const statusMatch = line.match(statusEffectRegex);
            if (statusMatch?.groups) {
                const { ts, player, effect } = statusMatch.groups;
                if (currentUsername && player.trim() === currentUsername) {
                    await emitActivityEvent('status_effect', `status_${ts}_${effect}`, ts, `Status effect: ${effect}`, { eventData: { effect } }, silentMode);
                }
                continue;
            }

            const rewardMatch = line.match(rewardEarnedRegex);
            if (rewardMatch?.groups) {
                const reward = rewardMatch.groups.reward.trim();
                await emitActivityEvent('reward_earned', `reward_${lineTs}_${reward.replace(/[^a-zA-Z0-9]+/g, '_')}`, lineTs,
                    `Earned: ${reward}`, { eventData: { reward } }, silentMode);
                continue;
            }

            if (emergencyServicesRegex.test(line)) {
                await emitActivityEvent('emergency_services', `emergency_${lineTs}`, lineTs, 'Local Emergency Services are en route',
                    { eventData: { message: 'Local Emergency Services Are En Route' } }, silentMode);
                continue;
            }

            const zoneMatch = line.match(zoneNoticeRegex);
            if (zoneMatch?.groups) {
                const { action, zone } = zoneMatch.groups;
                const enter = action === 'Entering';
                const zoneType = zone === 'Armistice Zone' ? 'armistice' : 'private_property';
                await emitActivityEvent('location_change', `zone_${zoneType}_${enter ? 'enter' : 'leave'}_${lineTs}`, lineTs,
                    `${enter ? 'Entered' : 'Left'} ${zone}`,
                    { destination: zone, eventData: { zoneType, action: enter ? 'enter' : 'leave' } }, silentMode);
                continue;
            }

            const qtSelectedMatch = line.match(qtSelectedRegex);
            if (qtSelectedMatch?.groups) {
                const { vehicle, destination } = qtSelectedMatch.groups;
                await emitActivityEvent('quantum_travel', `qt_selected_${lineTs}_${destination}`, lineTs,
                    `Quantum target selected: ${destination}`,
                    { destination, eventData: { phase: 'selected', vehicle } }, silentMode);
                continue;
            }

            const qtArrivedMatch = line.match(qtArrivedRegex);
            if (qtArrivedMatch?.groups) {
                const { vehicle, vehicleId } = qtArrivedMatch.groups;
                await emitActivityEvent('quantum_travel', `qt_arrived_${lineTs}_${vehicleId}`, lineTs,
                    'Quantum travel: arrived at final destination',
                    { eventData: { phase: 'arrived', vehicle, vehicleId } }, silentMode);
                continue;
            }

            // Ship crew channel: own join/leave, crew joins
            const channelSelfMatch = line.match(channelSelfRegex);
            if (channelSelfMatch?.groups) {
                const { action, channelName } = channelSelfMatch.groups;
                await emitActivityEvent('voip_channel', `voip_self_${action}_${lineTs}_${channelName.replace(/[^a-zA-Z0-9]+/g, '_')}`, lineTs,
                    `You ${action} VOIP channel "${channelName}"`,
                    { partyMember: currentUsername || undefined, channelName, eventData: { action, self: true, ...parseChannelName(channelName) } }, silentMode);
                continue;
            }
            const channelJoinMatch = line.match(channelOtherJoinedRegex);
            if (channelJoinMatch?.groups) {
                const { playerName, channelName } = channelJoinMatch.groups;
                await emitActivityEvent('voip_channel', `voip_joined_${lineTs}_${playerName.replace(/[^a-zA-Z0-9]+/g, '_')}`, lineTs,
                    `${playerName} joined VOIP channel "${channelName}"`,
                    { partyMember: playerName, channelName, eventData: { action: 'joined', self: false, ...parseChannelName(channelName) } }, silentMode);
                continue;
            }
            // === END SC 4.10 ACTIVITY EVENTS ===

            // --- Party Events ---
            const partyConnectMatch = line.match(partyMemberConnectedRegex);
            if (partyConnectMatch?.groups) {
                const { playerName } = partyConnectMatch.groups;
                logger.info(MODULE_NAME, 'Party member connected:', { player: playerName });
                const eventId = `party_join_${playerName}_${Date.now()}`;
                const partialEvent: Partial<KillEvent> = {
                    id: eventId,
                    timestamp: lineTs,
                    killers: [],
                    victims: [],
                    deathType: 'Unknown',
                    eventType: 'party_join' as GameEventType,
                    partyMember: playerName,
                    visibility: EVENT_VISIBILITY_MAP['party_join'],
                    gameMode: stableGameMode,
                    gameVersion: currentGameVersion,
                    playerShip: currentPlayerShip,
                    eventDescription: `${playerName} connected to party`,
                    isPlayerInvolved: true,
                    playerHandle: currentUsername || undefined,
                };
                await processKillEvent(partialEvent, silentMode, 0);
                continue;
            }

            const partyLeaveMatch = line.match(partyMemberLeftRegex);
            if (partyLeaveMatch?.groups) {
                const { playerName } = partyLeaveMatch.groups;
                logger.info(MODULE_NAME, 'Party member left:', { player: playerName });
                const eventId = `party_leave_${playerName}_${Date.now()}`;
                const partialEvent: Partial<KillEvent> = {
                    id: eventId,
                    timestamp: lineTs,
                    killers: [],
                    victims: [],
                    deathType: 'Unknown',
                    eventType: 'party_leave' as GameEventType,
                    partyMember: playerName,
                    visibility: EVENT_VISIBILITY_MAP['party_leave'],
                    gameMode: stableGameMode,
                    gameVersion: currentGameVersion,
                    playerShip: currentPlayerShip,
                    eventDescription: `${playerName} left the party`,
                    isPlayerInvolved: true,
                    playerHandle: currentUsername || undefined,
                };
                await processKillEvent(partialEvent, silentMode, 0);
                continue;
            }

            if (line.match(partyDisbandedRegex) && line.includes('Added notification')) {
                logger.info(MODULE_NAME, 'Party disbanded');
                const eventId = `party_disband_${Date.now()}`;
                const partialEvent: Partial<KillEvent> = {
                    id: eventId,
                    timestamp: lineTs,
                    killers: [],
                    victims: [],
                    deathType: 'Unknown',
                    eventType: 'party_disband' as GameEventType,
                    visibility: EVENT_VISIBILITY_MAP['party_disband'],
                    gameMode: stableGameMode,
                    gameVersion: currentGameVersion,
                    playerShip: currentPlayerShip,
                    eventDescription: 'Party disbanded',
                    isPlayerInvolved: true,
                    playerHandle: currentUsername || undefined,
                };
                await processKillEvent(partialEvent, silentMode, 0);
                continue;
            }

            // --- VOIP Channel Events ---
            const voipMatch = line.match(voipChannelLeftRegex);
            if (voipMatch?.groups) {
                const { playerName, channelName } = voipMatch.groups;
                logger.info(MODULE_NAME, 'VOIP channel event:', { player: playerName, channel: channelName });
                const eventId = `voip_left_${lineTs}_${playerName.replace(/[^a-zA-Z0-9]+/g, '_')}`;
                const partialEvent: Partial<KillEvent> = {
                    id: eventId,
                    timestamp: lineTs,
                    killers: [],
                    victims: [],
                    deathType: 'Unknown',
                    eventType: 'voip_channel' as GameEventType,
                    partyMember: playerName,
                    channelName: channelName,
                    eventData: { action: 'left', self: playerName === currentUsername, ...parseChannelName(channelName) },
                    visibility: EVENT_VISIBILITY_MAP['voip_channel'],
                    gameMode: stableGameMode,
                    gameVersion: currentGameVersion,
                    playerShip: currentPlayerShip,
                    eventDescription: `${playerName} left VOIP channel "${channelName}"`,
                    isPlayerInvolved: true,
                    playerHandle: currentUsername || undefined,
                };
                await processKillEvent(partialEvent, silentMode, 0);
                continue;
            }

            // --- Location/Jurisdiction Changes ---
            const jurisdictionMatch = line.match(jurisdictionEnteredRegex);
            if (jurisdictionMatch?.groups) {
                const { jurisdiction, notifId } = jurisdictionMatch.groups;
                if (!processedNotificationIds.has(`loc_${notifId}`)) {
                    processedNotificationIds.add(`loc_${notifId}`);
                    const locationName = jurisdiction.trim();
                    logger.info(MODULE_NAME, 'Jurisdiction entered:', { location: locationName });
                    const locationData = processLocationDataEnhanced(locationName, undefined, 'jurisdiction_change');
                    const eventId = `location_${notifId}`;
                    const partialEvent: Partial<KillEvent> = {
                        id: eventId,
                        timestamp: lineTs,
                        killers: [],
                        victims: [],
                        deathType: 'Unknown',
                        eventType: 'location_change' as GameEventType,
                        visibility: EVENT_VISIBILITY_MAP['location_change'],
                        location: locationData.location,
                        gameMode: stableGameMode,
                        gameVersion: currentGameVersion,
                        playerShip: currentPlayerShip,
                        eventDescription: `Entered ${locationName}`,
                        isPlayerInvolved: true,
                        playerHandle: currentUsername || undefined,
                    };
                    await processKillEvent(partialEvent, silentMode, 0);
                }
                continue;
            }

            // --- Quantum Travel ---
            const qtSuccessMatch = line.match(qtRouteSuccessRegex);
            if (qtSuccessMatch?.groups) {
                const { destination, fuel } = qtSuccessMatch.groups;
                logger.info(MODULE_NAME, 'QT route calculated:', { destination, fuel });
                const eventId = `qt_${destination}_${Date.now()}`;
                const partialEvent: Partial<KillEvent> = {
                    id: eventId,
                    timestamp: lineTs,
                    killers: [],
                    victims: [],
                    deathType: 'Unknown',
                    eventType: 'quantum_travel' as GameEventType,
                    destination: destination,
                    eventData: { phase: 'route' },
                    visibility: EVENT_VISIBILITY_MAP['quantum_travel'],
                    gameMode: stableGameMode,
                    gameVersion: currentGameVersion,
                    playerShip: currentPlayerShip,
                    eventDescription: `Quantum route to ${destination} (fuel: ${Math.round(parseFloat(fuel))})`,
                    isPlayerInvolved: true,
                    playerHandle: currentUsername || undefined,
                };
                await processKillEvent(partialEvent, silentMode, 0);
                continue;
            }

            // === END SC 4.8+ GAMEPLAY EVENT DETECTION ===

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

    // Log detection stats every ~100 parses (random sampling to avoid spam)
    if (Math.random() < 0.01) {
        logDetectionStats();
    }
}

// Function to reset parser state (e.g., on rescan)
export function resetParserState() {
    logger.info(MODULE_NAME, "Resetting parser state.");
    currentUsername = getLastLoggedInUser() || null; // Re-initialize from store
    currentPlayerShip = "Unknown";
    currentGeid = null;
    previousNotificationTitle = null;
    pendingShopRequests.length = 0;
    seenObjectiveProgress.clear();
    missionCommsCache.clear();
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

    // Reset dual-mode detection state
    recentDeaths.clear();
    processedNotificationIds.clear();
    activeMissions.clear();
    missionMetadataCache.clear();
    detectionStats = {
        old_corpse_log: 0,
        actor_state_dead_new: 0,
        corpse_utils_new: 0,
        attachment_received: 0,
        unknown_format: 0,
        duplicates_prevented: 0,
    };

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
/**
 * Named registry of the line patterns this parser depends on. Used by the Game.log diff tracker
 * (log-diff/) to report which patterns stop matching after a game patch. Read-only: matching here
 * has no side effects on parsing.
 */
export const PARSER_PATTERNS: Readonly<Record<string, RegExp>> = Object.freeze({
    login: loginRegex,
    legacyLogin: legacyLoginRegex,
    sessionStart: sessionStartRegex,
    puMode: puModeRegex,
    acMode: acModeRegex,
    frontendMode: frontendModeRegex,
    loadout: loadoutRegex,
    vehicleDestruction: vehicleDestructionRegex,
    gameVersion: versionPattern,
    actorStateDead: newActorStateDeadRegex,
    corpseUtils: corpseUtilsRegex,
    attachmentReceived: attachmentReceivedRegex,
    fatalCollision: fatalCollisionRegex,
    newVehicleDestroyed: newVehicleDestroyedRegex,
    missionAccepted: missionAcceptedRegex,
    missionComplete: missionCompleteRegex,
    missionFailed: missionFailedRegex,
    missionShared: missionSharedRegex,
    missionObjective: missionObjectiveRegex,
    missionObjectiveComplete: missionObjectiveCompleteRegex,
    missionObjectiveWithdrawn: missionObjectiveWithdrawnRegex,
    missionEnded: missionEndedRegex,
    missionPhaseMarker: missionPhaseMarkerRegex,
    partyMemberConnected: partyMemberConnectedRegex,
    partyMemberLeft: partyMemberLeftRegex,
    partyDisbanded: partyDisbandedRegex,
    partyInvite: partyInviteRegex,
    memberLeftNotif: memberLeftNotifRegex,
    voipChannelLeft: voipChannelLeftRegex,
    jurisdictionEntered: jurisdictionEnteredRegex,
    monitoredSpace: monitoredSpaceRegex,
    qtFuelRequest: qtFuelRequestRegex,
    qtRouteSuccess: qtRouteSuccessRegex,
    qtStartLocation: qtStartLocationRegex,
    hangarRequest: hangarRequestRegex,
    refuelRequest: refuelRequestRegex,
    corpseLog: corpseLogRegex,
    kill: killPatternRegex,
    incap: incapRegex,
    environmentDeath: environmentDeathRegex,
    systemQuit: systemQuitRegex,
    // SC 4.10
    loginGeid: loginGeidRegex,
    vehicleDestroyed: vehicleDestroyedRegex,
    shopBuyRequest: shopBuyRequestRegex,
    shopRentalRequest: shopRentalRequestRegex,
    shopFlowResponse: shopFlowResponseRegex,
    commsNotification: commsNotificationRegex,
    objectiveProgress: objectiveProgressRegex,
    statusEffect: statusEffectRegex,
    rewardEarned: rewardEarnedRegex,
    emergencyServices: emergencyServicesRegex,
    zoneNotice: zoneNoticeRegex,
    qtSelected: qtSelectedRegex,
    qtArrived: qtArrivedRegex,
    channelSelf: channelSelfRegex,
    channelOtherJoined: channelOtherJoinedRegex,
});

/**
 * Health of every PARSER_PATTERNS entry, keyed by the same names. status: 'active' (seen in the lastSeen build),
 * 'sunset' (the game no longer emits it; the code path is kept for old logs) or 'unverified' (not exercised in
 * recent logs). since: first game version the pattern applies to (active) or stopped being emitted (sunset).
 */
export type ParserPatternStatus = 'active' | 'sunset' | 'unverified';
export const PARSER_PATTERN_META: Record<string, { status: ParserPatternStatus; since?: string; lastSeen?: string; note?: string }> = {
    login: { status: 'active', lastSeen: '4.10.200' },
    legacyLogin: { status: 'active', lastSeen: '4.10.200', note: 'Legacy login line still present' },
    sessionStart: { status: 'unverified', note: '0 matches in 4.10.196 and 4.10.200 sample logs' },
    puMode: { status: 'active', lastSeen: '4.10.200' },
    acMode: { status: 'unverified', note: 'Arena Commander not tested on 4.10.200' },
    frontendMode: { status: 'active', lastSeen: '4.10.200' },
    loadout: { status: 'unverified', note: '0 matches in 4.10.196 and 4.10.200 sample logs' },
    vehicleDestruction: { status: 'sunset', since: '4.4', lastSeen: '4.3.x', note: '<Vehicle Destruction> replaced by <Vehicle Destroyed> (kept for old logs)' },
    gameVersion: { status: 'unverified', note: '0 matches in 4.10.196 and 4.10.200 sample logs' },
    actorStateDead: { status: 'active', lastSeen: '4.10.200' },
    corpseUtils: { status: 'active', lastSeen: '4.10.196', note: 'Only fires for non-kept (lost) gear; not exercised in 4.10.200 samples' },
    attachmentReceived: { status: 'active', lastSeen: '4.10.200' },
    fatalCollision: { status: 'active', lastSeen: '4.10.200' },
    newVehicleDestroyed: { status: 'unverified', note: '[VEHICLE SPAWN] Vehicle Destroyed was Arena Commander only (last seen 4.5.167); AC untested on 4.10' },
    missionAccepted: { status: 'active', lastSeen: '4.10.200' },
    missionComplete: { status: 'active', lastSeen: '4.10.200' },
    missionFailed: { status: 'active', lastSeen: '4.10.196' },
    missionShared: { status: 'active', lastSeen: '4.10.196' },
    missionObjective: { status: 'active', lastSeen: '4.10.200' },
    missionObjectiveComplete: { status: 'active', lastSeen: '4.10.200', note: 'Fixed for the title wrapping onto the next line' },
    missionObjectiveWithdrawn: { status: 'active', lastSeen: '4.10.196' },
    missionEnded: { status: 'active', lastSeen: '4.10.200' },
    missionPhaseMarker: { status: 'active', lastSeen: '4.10.200' },
    partyMemberConnected: { status: 'unverified', note: '0 matches in any 4.10 sample log; anchored after the timestamp' },
    partyMemberLeft: { status: 'active', lastSeen: '4.10.196', note: 'Anchored after the timestamp (hyphen/space names)' },
    partyDisbanded: { status: 'active', lastSeen: '4.10.200' },
    partyInvite: { status: 'active', lastSeen: '4.10.200', note: 'Body line only; inviter is on the previous Added notification line' },
    memberLeftNotif: { status: 'active', lastSeen: '4.10.200' },
    voipChannelLeft: { status: 'active', lastSeen: '4.10.200', note: 'Anchored after the timestamp (hyphen/space names)' },
    jurisdictionEntered: { status: 'active', lastSeen: '4.10.200' },
    monitoredSpace: { status: 'active', lastSeen: '4.10.200' },
    qtFuelRequest: { status: 'active', lastSeen: '4.10.200' },
    qtRouteSuccess: { status: 'active', lastSeen: '4.10.200' },
    qtStartLocation: { status: 'active', lastSeen: '4.10.200' },
    hangarRequest: { status: 'active', lastSeen: '4.10.200' },
    refuelRequest: { status: 'unverified', note: '0 matches in 4.10.196 and 4.10.200 sample logs' },
    corpseLog: { status: 'sunset', since: '4.4', lastSeen: '4.3.x', note: '<[ActorState] Corpse> replaced by <[ActorState] Dead> (kept for old logs)' },
    kill: { status: 'sunset', since: '4.4', lastSeen: '4.3.x', note: '<Actor Death> CActor::Kill no longer emitted: no FPS kill attribution since 4.4 (kept for old logs)' },
    incap: { status: 'unverified', note: 'Last seen 4.6; no incaps in any 4.10 log' },
    environmentDeath: { status: 'sunset', since: '4.4', lastSeen: '4.3.x', note: '<Actor Death> environment deaths no longer emitted (kept for old logs)' },
    systemQuit: { status: 'active', lastSeen: '4.10.200' },
    loginGeid: { status: 'active', lastSeen: '4.10.200', note: 'Local GEID for <Vehicle Destroyed> owner/killer matching' },
    vehicleDestroyed: { status: 'active', lastSeen: '4.10.200', since: '4.10.200', note: 'Replaces <Vehicle Destruction>; owner [0] or _PU_AI_ in class = NPC' },
    shopBuyRequest: { status: 'active', lastSeen: '4.10.200' },
    shopRentalRequest: { status: 'active', lastSeen: '4.10.200' },
    shopFlowResponse: { status: 'active', lastSeen: '4.10.200', note: 'Request counts only when paired with result[Success]' },
    commsNotification: { status: 'active', lastSeen: '4.10.200' },
    objectiveProgress: { status: 'active', lastSeen: '4.10.200', note: 'Chatty; de-duplicated by id + text' },
    statusEffect: { status: 'active', lastSeen: '4.10.200' },
    rewardEarned: { status: 'active', lastSeen: '4.10.200' },
    emergencyServices: { status: 'active', lastSeen: '4.10.200' },
    zoneNotice: { status: 'active', lastSeen: '4.10.200' },
    qtSelected: { status: 'active', lastSeen: '4.10.200' },
    qtArrived: { status: 'active', lastSeen: '4.10.200' },
    channelSelf: { status: 'active', lastSeen: '4.10.200' },
    channelOtherJoined: { status: 'active', lastSeen: '4.10.200' },
};
