// Shared type definitions used across main process modules and potentially renderer

// Type definition for cached profile data
export interface ProfileData {
  // Victim fields
  victimEnlisted?: string;
  victimRsiRecord?: string;
  victimOrg?: string;         // Main org name
  victimOrgSid?: string;      // Main org SID (handle)
  victimOrgLogoUrl?: string;  // Main org logo URL
  victimAffiliatedOrgs?: string[]; // Affiliated org names (consider adding SID/Logo later if needed)
  victimPfpUrl?: string;
  
  // Attacker fields (mirroring victim fields)
  attackerEnlisted?: string;
  attackerRsiRecord?: string;
  attackerOrg?: string;         // Main org name
  attackerOrgSid?: string;      // Main org SID (handle)
  attackerOrgLogoUrl?: string;  // Main org logo URL
  attackerAffiliatedOrgs?: string[]; // Affiliated org names (consider adding SID/Logo later if needed)
  attackerPfpUrl?: string;
}

// Session info type
export interface SessionInfo {
  id: string;        // A unique ID for the session
  startTime: string; // ISO timestamp for when the session started
  endTime: string;   // ISO timestamp for when the session ended (or null if ongoing)
  logSize: number;   // Size of log in bytes when session ended
}

// Type definition for our store
export interface StoreSchema {
  logFilePath: string;
  sessions: SessionInfo[];
  lastLoggedInUser: string;
  showNotifications: boolean;
  lastActivePage: string;
  // Phase 2 Settings
  // apiUrl: string; // Removed
  // apiKey: string; // Removed
  offlineMode: boolean;
  csvLogPath: string;
  // Profile data fetching setting
  fetchProfileData: boolean;
  // Profile data cache
  profileCache: Record<string, { data: ProfileData, lastFetched: number }>;
  // Sound effects setting
  playSoundEffects: boolean;
  // Feed mode preference ('player' or 'global')
  feedMode?: 'player' | 'global'; // Added optional feedMode
  guestModePreference: boolean;
  hasShownInitialLogin: boolean;
  // Event filter preference
  eventFilter?: string; // Was added in config-manager.ts
  // Discovered event categories
  discoveredCategories?: Record<string, EventCategory>; // Key is category ID
  // Selected category filters
  selectedCategoryFilters?: string[]; // Array of selected category IDs
}

// Defines the structure for a processed kill/destruction event
export interface KillEvent {
  id: string;                 // Unique identifier (e.g., timestamp + random)
  timestamp: string;          // ISO timestamp string when the event occurred
  killers: string[];          // Names of players/entities who caused the kill/destruction
  victims: string[];          // Names of players/entities who were killed/destroyed
  deathType: 'Soft' | 'Hard' | 'Combat' | 'Collision' | 'Crash' | 'BleedOut' | 'Suffocation' | 'Unknown'; // Added new death types
  vehicleType?: string;       // Type of vehicle involved (e.g., "AEGS_Gladius", "Player")
  vehicleModel?: string;      // Model name if different from type (often same for ships)
  vehicleId?: string;         // Specific ID of the vehicle (if available, e.g., "AEGS_Gladius_12345")
  location?: string;          // Zone location where event occurred (e.g., "OOC_Stanton_1b_Aberdeen")
  weapon?: string;            // Weapon used (if available, e.g., "KLWE_LaserCannon_S3", "Collision")
  damageType?: string;        // Type of damage reported in log (e.g., "Energy", "Ballistic", "Collision", "Crash")
  gameMode?: 'PU' | 'AC' | 'Unknown'; // Game mode: Persistent Universe or Arena Commander
  gameVersion?: string;       // Game client version (e.g., "3230-9187810")
  coordinates?: {             // Position coordinates where event occurred
    x: number;
    y: number;
    z: number;
  };
  playerShip?: string;        // Current player's ship at time of event (e.g., "AEGS_Avenger_Titan")
  eventDescription: string;   // Formatted description of the event for display
  // Optional fields from RSI lookup for victim
  victimEnlisted?: string;    // Victim's enlistment date (e.g., "Jan 15, 2018")
  victimRsiRecord?: string;   // Victim's UEE Citizen Record number (e.g., "#123456" or "-")
  victimOrg?: string;         // Victim's primary organization affiliation
  victimPfpUrl?: string;      // URL to the victim's profile picture
  
  // Optional fields from RSI lookup for attacker
  attackerEnlisted?: string;  // Attacker's enlistment date
  attackerRsiRecord?: string; // Attacker's UEE Citizen Record number
  attackerOrg?: string;       // Attacker's primary organization affiliation
  attackerPfpUrl?: string;    // URL to the attacker's profile picture
  
  isPlayerInvolved: boolean;  // Indicates whether the current player is involved in this event

  // Added for event details window
  playerName?: string; // Current player's name for comparison
  // Optional field for additional/merged data from server
  data?: Record<string, any>;
  // Event source metadata for secure role-based filtering and duplicate tracking
  metadata?: {
    source?: {
      server: boolean;   // Event came from server
      local: boolean;    // Event came from local parsing
      external: boolean; // Event has been received from external source (server)
    };
    mergedFrom?: string[]; // Array of event IDs that were merged into this event
    // Location processing metadata for debugging
    locationSource?: 'event' | 'fallback' | 'unknown'; // How location was determined
    originalZone?: string; // Original zone string from log before cleanup
    cleanedZone?: string; // Zone string after cleanup patterns
    fallbackUsed?: boolean; // Whether fallback location was used
    // Dynamic event category from server
    category?: {
      id: string;        // Unique category identifier (e.g., "org_event", "proximity_event")
      name: string;      // Display name for the category
      icon?: string;     // Icon identifier or emoji for the category
      color?: string;    // Optional color for the category (hex or CSS color)
      priority?: number; // Optional priority for sorting categories
    };
  };
}

// Interface for tracking discovered event categories
export interface EventCategory {
  id: string;        // Unique category identifier
  name: string;      // Display name
  icon?: string;     // Icon identifier or emoji
  color?: string;    // Optional color
  priority?: number; // Optional priority for sorting
  count?: number;    // Number of events in this category
  firstSeen?: string; // ISO timestamp when first discovered
  lastSeen?: string;  // ISO timestamp when last seen
}

// Interface for tracking pending vehicle destruction events (used internally by parser/processor)
export interface PendingVehicleDestruction {
  timestamp: string;
  vehicleType: string;
  vehicleModel: string;
  vehicleId: string;          // Added vehicle ID for unique tracking
  zoneLocation?: string;      // Zone where the vehicle was destroyed
  destroyers: string[];       // Multiple attackers can be involved
  victims: string[];          // Multiple victims can be involved
  cause: string;
  processed: boolean;
  destructionLevel: number;   // Track destroy level progression
  lastUpdate: number;         // Timestamp of last update for timeouts
  coordinates?: {             // Position coordinates where event occurred
    x: number;
    y: number;
    z: number;
  };
  weapon?: string;            // Weapon used if available
  damageType?: string;        // Type of damage
  gameMode?: string;          // PU or AC
}

// Interface for tracking player deaths from corpse logs (used internally by parser/processor)
export interface PlayerDeath {
  timestamp: number;
  playerName: string;
  processed: boolean;
}