/**
 * Enhanced Zone Hierarchy Types for Star Citizen Kill Feed System
 * 
 * This module defines the comprehensive zone classification system that tracks
 * primary zones (systems, planets, moons) and secondary zones (outposts, stations)
 * with proper system classification and location history.
 */

// Core zone classification types
export type ZoneClassification = 'primary' | 'secondary';
export type SystemType = 'stanton' | 'pyro' | 'unknown';
export type PrimaryZoneType = 'system' | 'planet' | 'moon' | 'jump_point' | 'asteroid_field';
export type SecondaryZoneType = 'outpost' | 'station' | 'landing_zone' | 'poi' | 'asteroid' | 'derelict' | 'ship';

/**
 * Base zone information interface
 */
export interface ZoneInfo {
  id: string;                      // Original zone ID from logs (e.g., "OOC_Stanton_1_Aberdeen")
  displayName: string;             // Human-readable name (e.g., "Aberdeen")
  classification: ZoneClassification;
  system: SystemType;
  coordinates?: {x: number, y: number, z: number};
  confidence: number;              // 0-1 confidence in zone classification
}

/**
 * Primary zone interface for major celestial bodies and systems
 */
export interface PrimaryZone extends ZoneInfo {
  classification: 'primary';
  type: PrimaryZoneType;
  parent?: string;                 // Parent zone ID (e.g., "OOC_Stanton" for planets)
  children?: string[];             // Child zone IDs (moons, major stations)
  jurisdiction?: string;           // Controlling faction/government
}

/**
 * Secondary zone interface for locations within or around primary zones
 */
export interface SecondaryZone extends ZoneInfo {
  classification: 'secondary';
  type: SecondaryZoneType;
  primaryZone?: string;            // Associated primary zone ID
  orbitingBody?: string;           // What this zone orbits/is attached to
  purpose?: string;                // Mining, research, commercial, etc.
}

/**
 * Enhanced location history entry with zone classification
 */
export interface ZoneHistoryEntry {
  timestamp: string;               // ISO timestamp when zone was entered
  zoneId: string;                  // Original zone ID from logs
  zoneName: string;                // Display name
  classification: ZoneClassification;
  system: SystemType;
  source: string;                  // Source of location data ('vehicle_destruction', 'combat_death', etc.)
  coordinates?: {x: number, y: number, z: number};
  dwellTime?: number;              // Time spent in zone (calculated on exit)
  eventCount?: number;             // Number of events that occurred in this zone
}

/**
 * Zone resolution result with confidence and method tracking
 */
export interface ZoneResolution {
  zone: PrimaryZone | SecondaryZone;
  confidence: number;              // 0-1 confidence in classification
  matchMethod: 'exact' | 'pattern' | 'fallback' | 'derived' | 'server_enriched';
  fallbackUsed: boolean;
  resolutionTime: string;          // When this resolution was performed
}

/**
 * Enhanced event interface with zone hierarchy information
 */
export interface EnhancedEventZoneInfo {
  primary: PrimaryZone | null;     // Primary zone (planet, moon, system)
  secondary: SecondaryZone | null; // Secondary zone (outpost, station, POI)
  system: SystemType;              // System classification
  displayLocation: string;        // Formatted location for display
  locationHierarchy: string[];     // Breadcrumb hierarchy ['Stanton System', 'Hurston', 'Aberdeen']
  zoneTransition: boolean;         // Whether this event involved a zone change
  derivedFromHistory: boolean;     // Whether zone info came from location history matching
}

/**
 * Zone classification configuration
 */
export interface ZoneClassificationConfig {
  maxHistorySize: number;          // Maximum number of zones to track in history
  primaryZonePatterns: RegExp[];   // Patterns for identifying primary zones
  secondaryZonePatterns: RegExp[]; // Patterns for identifying secondary zones
  systemPatterns: Record<SystemType, RegExp[]>; // Patterns for system identification
  fallbackTimeout: number;        // How long to keep using fallback zone data (ms)
}

/**
 * Zone matching configuration for secondary → primary resolution
 */
export interface ZoneMatchingConfig {
  proximityRadius: number;         // Distance threshold for coordinate-based matching
  timeWindowMs: number;            // Time window for location history matching
  confidenceThreshold: number;    // Minimum confidence for zone resolution
  preferExactMatches: boolean;     // Whether to prioritize exact matches over patterns
}

/**
 * Location service state interface
 */
export interface LocationServiceState {
  currentZone: ZoneResolution | null;
  zoneHistory: ZoneHistoryEntry[];
  lastPrimaryZone: PrimaryZone | null;
  currentSystem: SystemType;
  historySize: number;
  lastUpdate: string;
}

/**
 * Zone database entry for known zones
 */
export interface ZoneDatabase {
  zones: Map<string, PrimaryZone | SecondaryZone>;
  lastUpdated: string;
  version: string;
  source: 'server' | 'local' | 'hybrid';
}

/**
 * Event zone metadata for enhanced events
 */
export interface EventZoneMetadata {
  zoneInfo?: EnhancedEventZoneInfo;
  locationResolution?: ZoneResolution;
  historicalContext?: {
    previousZone?: ZoneHistoryEntry;
    timeInZone?: number;
    zoneEventCount?: number;
  };
}