/**
 * Zone Resolver and Database System
 * 
 * This module provides comprehensive zone resolution, database management,
 * and zone hierarchy determination for the Star Citizen kill feed system.
 */

import {
  ZoneClassification,
  SystemType,
  PrimaryZone,
  SecondaryZone,
  ZoneResolution,
  ZoneDatabase,
  ZoneMatchingConfig
} from '../../shared/zone-types';
import { ZoneClassifier } from './zone-classifier';
import * as logger from './logger';

const MODULE_NAME = 'ZoneResolver';

/**
 * Default zone matching configuration
 */
const DEFAULT_MATCHING_CONFIG: ZoneMatchingConfig = {
  proximityRadius: 50000,        // 50km radius for coordinate matching
  timeWindowMs: 1800000,         // 30 minutes for location history matching
  confidenceThreshold: 0.6,      // Minimum confidence for accepting resolution
  preferExactMatches: true       // Prioritize exact matches over pattern matching
};

/**
 * Zone resolver class with database management and resolution logic
 */
export class ZoneResolver {
  private static zoneDatabase: ZoneDatabase = {
    zones: new Map(),
    lastUpdated: new Date().toISOString(),
    version: '1.0.0',
    source: 'local'
  };
  
  private static matchingConfig: ZoneMatchingConfig = DEFAULT_MATCHING_CONFIG;
  private static initialized = false;
  
  /**
   * Initialize the zone resolver with known zones and patterns
   */
  static initialize(): void {
    if (this.initialized) {
      logger.debug(MODULE_NAME, 'Zone resolver already initialized');
      return;
    }
    
    logger.info(MODULE_NAME, 'Initializing zone resolver with known zones...');
    
    this.initializeKnownZones();
    this.initialized = true;
    
    const zoneCount = this.zoneDatabase.zones.size;
    logger.success(MODULE_NAME, `Zone resolver initialized with ${zoneCount} known zones`);
  }
  
  /**
   * Resolve a zone ID to complete zone information
   */
  static resolveZone(zoneId: string, coordinates?: {x: number, y: number, z: number}): ZoneResolution {
    if (!this.initialized) {
      this.initialize();
    }
    
    if (!zoneId) {
      return this.createFallbackResolution('Unknown', 'No zone ID provided');
    }
    
    const cleanId = this.cleanZoneId(zoneId);
    const resolutionTime = new Date().toISOString();
    
    logger.debug(MODULE_NAME, `Resolving zone: '${zoneId}' (cleaned: '${cleanId}')`);
    
    // 1. Try exact match from database
    const exactMatch = this.zoneDatabase.zones.get(cleanId);
    if (exactMatch) {
      logger.debug(MODULE_NAME, `Found exact match for '${cleanId}'`);
      return {
        zone: exactMatch,
        confidence: 1.0,
        matchMethod: 'exact',
        fallbackUsed: false,
        resolutionTime
      };
    }
    
    // 2. Try pattern-based resolution
    const classification = ZoneClassifier.classifyZone(cleanId);
    const system = ZoneClassifier.determineSystem(cleanId);
    
    let resolution: ZoneResolution;
    
    if (classification === 'primary') {
      resolution = this.resolvePrimaryZone(cleanId, zoneId, system, coordinates);
    } else {
      resolution = this.resolveSecondaryZone(cleanId, zoneId, system, coordinates);
    }
    
    resolution.resolutionTime = resolutionTime;
    
    // Cache the resolved zone if confidence is high enough
    if (resolution.confidence >= this.matchingConfig.confidenceThreshold) {
      this.zoneDatabase.zones.set(cleanId, resolution.zone);
      logger.debug(MODULE_NAME, `Cached resolved zone '${cleanId}' with confidence ${resolution.confidence}`);
    }
    
    return resolution;
  }
  
  /**
   * Resolve a primary zone (system, planet, moon)
   */
  private static resolvePrimaryZone(
    cleanId: string,
    originalId: string,
    system: SystemType,
    coordinates?: {x: number, y: number, z: number}
  ): ZoneResolution {
    const displayName = ZoneClassifier.generateDisplayName(cleanId);
    const zoneType = ZoneClassifier.determinePrimaryType(cleanId);
    
    const zone: PrimaryZone = {
      id: cleanId,
      displayName,
      classification: 'primary',
      type: zoneType,
      system,
      coordinates,
      confidence: 0.8,
      parent: this.findParentZone(cleanId),
      children: this.findChildZones(cleanId),
      jurisdiction: this.determineJurisdiction(cleanId, system)
    };
    
    logger.debug(MODULE_NAME, `Resolved primary zone: ${displayName} (${zoneType}, ${system})`);
    
    return {
      zone,
      confidence: 0.8,
      matchMethod: 'pattern',
      fallbackUsed: false,
      resolutionTime: new Date().toISOString()
    };
  }
  
  /**
   * Resolve a secondary zone (outpost, station, POI)
   */
  private static resolveSecondaryZone(
    cleanId: string,
    originalId: string,
    system: SystemType,
    coordinates?: {x: number, y: number, z: number}
  ): ZoneResolution {
    const displayName = ZoneClassifier.generateDisplayName(cleanId);
    const zoneType = ZoneClassifier.determineSecondaryType(cleanId);
    const primaryZone = ZoneClassifier.derivePrimaryZone(cleanId);
    
    const zone: SecondaryZone = {
      id: cleanId,
      displayName,
      classification: 'secondary',
      type: zoneType,
      system,
      coordinates,
      confidence: 0.6,
      primaryZone,
      orbitingBody: this.deriveOrbitingBody(cleanId),
      purpose: this.determinePurpose(cleanId, zoneType)
    };
    
    logger.debug(MODULE_NAME, `Resolved secondary zone: ${displayName} (${zoneType}, primary: ${primaryZone})`);
    
    return {
      zone,
      confidence: 0.6,
      matchMethod: 'pattern',
      fallbackUsed: false,
      resolutionTime: new Date().toISOString()
    };
  }
  
  /**
   * Find parent zone for hierarchical relationships
   */
  private static findParentZone(zoneId: string): string | undefined {
    // Moons have planets as parents: OOC_Stanton_1a -> OOC_Stanton_1
    if (zoneId.match(/^OOC_(Stanton|Pyro)_\d+[a-z]$/i)) {
      return zoneId.replace(/[a-z]$/i, '');
    }
    
    // Planets have systems as parents: OOC_Stanton_1 -> OOC_Stanton
    if (zoneId.match(/^OOC_(Stanton|Pyro)_\d+$/i)) {
      return zoneId.replace(/_\d+$/, '');
    }
    
    return undefined;
  }
  
  /**
   * Find child zones for hierarchical relationships
   */
  private static findChildZones(zoneId: string): string[] {
    const children: string[] = [];
    
    // Systems have planets as children
    if (zoneId === 'OOC_Stanton') {
      children.push('OOC_Stanton_1', 'OOC_Stanton_2', 'OOC_Stanton_3', 'OOC_Stanton_4');
    }
    
    // Planets have moons as children  
    if (zoneId.match(/^OOC_Stanton_\d+$/)) {
      const planetNum = zoneId.match(/\d+$/)?.[0];
      if (planetNum) {
        // Add known moons (this could be expanded)
        children.push(`${zoneId}a`, `${zoneId}b`, `${zoneId}c`);
      }
    }
    
    return children;
  }
  
  /**
   * Determine the jurisdiction/controlling faction for a zone
   */
  private static determineJurisdiction(zoneId: string, system: SystemType): string | undefined {
    if (system === 'stanton') {
      if (zoneId.includes('_1')) return 'Hurston Dynamics';
      if (zoneId.includes('_2')) return 'Crusader Industries';
      if (zoneId.includes('_3')) return 'ArcCorp';
      if (zoneId.includes('_4')) return 'Microtech Corporation';
    }
    
    return 'UEE';
  }
  
  /**
   * Derive what celestial body a zone orbits
   */
  private static deriveOrbitingBody(zoneId: string): string | undefined {
    const primaryZone = ZoneClassifier.derivePrimaryZone(zoneId);
    if (primaryZone) {
      return ZoneClassifier.generateDisplayName(primaryZone);
    }
    return undefined;
  }
  
  /**
   * Determine the purpose/function of a zone
   */
  private static determinePurpose(zoneId: string, zoneType: string): string | undefined {
    if (zoneId.includes('mining')) return 'Mining Operations';
    if (zoneId.includes('research')) return 'Research Facility';
    if (zoneId.includes('security')) return 'Security Operations';
    if (zoneId.includes('medical')) return 'Medical Facility';
    if (zoneId.includes('commercial')) return 'Commercial Hub';
    if (zoneType === 'landing_zone') return 'Urban Center';
    if (zoneType === 'station') return 'Orbital Platform';
    
    return undefined;
  }
  
  /**
   * Search zones by name or pattern
   */
  static searchZones(query: string): Array<PrimaryZone | SecondaryZone> {
    const results: Array<PrimaryZone | SecondaryZone> = [];
    const searchTerm = query.toLowerCase();
    
    for (const zone of this.zoneDatabase.zones.values()) {
      if (
        zone.displayName.toLowerCase().includes(searchTerm) ||
        zone.id.toLowerCase().includes(searchTerm)
      ) {
        results.push(zone);
      }
    }
    
    return results.sort((a, b) => a.displayName.localeCompare(b.displayName));
  }
  
  /**
   * Get all zones of a specific type
   */
  static getZonesByType(classification: ZoneClassification, system?: SystemType): Array<PrimaryZone | SecondaryZone> {
    const results: Array<PrimaryZone | SecondaryZone> = [];
    
    for (const zone of this.zoneDatabase.zones.values()) {
      if (zone.classification === classification) {
        if (!system || zone.system === system) {
          results.push(zone);
        }
      }
    }
    
    return results.sort((a, b) => a.displayName.localeCompare(b.displayName));
  }
  
  /**
   * Update zone database with server-provided data
   */
  static updateZoneDatabase(serverZones: Array<PrimaryZone | SecondaryZone>, version: string): void {
    logger.info(MODULE_NAME, `Updating zone database with ${serverZones.length} zones from server`);
    
    for (const zone of serverZones) {
      this.zoneDatabase.zones.set(zone.id, zone);
    }
    
    this.zoneDatabase.lastUpdated = new Date().toISOString();
    this.zoneDatabase.version = version;
    this.zoneDatabase.source = 'server';
    
    logger.success(MODULE_NAME, `Zone database updated to version ${version}`);
  }
  
  /**
   * Get database statistics
   */
  static getDatabaseStats(): {
    totalZones: number;
    primaryZones: number;
    secondaryZones: number;
    bySystem: Record<SystemType, number>;
    lastUpdated: string;
    version: string;
    source: string;
  } {
    const stats = {
      totalZones: this.zoneDatabase.zones.size,
      primaryZones: 0,
      secondaryZones: 0,
      bySystem: { stanton: 0, pyro: 0, unknown: 0 } as Record<SystemType, number>,
      lastUpdated: this.zoneDatabase.lastUpdated,
      version: this.zoneDatabase.version,
      source: this.zoneDatabase.source
    };
    
    for (const zone of this.zoneDatabase.zones.values()) {
      if (zone.classification === 'primary') {
        stats.primaryZones++;
      } else {
        stats.secondaryZones++;
      }
      
      stats.bySystem[zone.system]++;
    }
    
    return stats;
  }
  
  /**
   * Create fallback resolution for unknown zones
   */
  private static createFallbackResolution(zoneName: string, reason: string): ZoneResolution {
    logger.warn(MODULE_NAME, `Creating fallback resolution for '${zoneName}': ${reason}`);
    
    const fallbackZone: SecondaryZone = {
      id: 'unknown',
      displayName: zoneName || 'Unknown Location',
      classification: 'secondary',
      type: 'poi',
      system: 'unknown',
      confidence: 0.0
    };
    
    return {
      zone: fallbackZone,
      confidence: 0.0,
      matchMethod: 'fallback',
      fallbackUsed: true,
      resolutionTime: new Date().toISOString()
    };
  }
  
  /**
   * Clean zone ID by removing suffixes
   */
  private static cleanZoneId(zoneId: string): string {
    if (!zoneId) return '';
    return zoneId.replace(/_\d+$/, '').trim();
  }
  
  /**
   * Initialize database with well-known zones
   */
  private static initializeKnownZones(): void {
    // Stanton System Zones
    const stantonZones: Array<PrimaryZone | SecondaryZone> = [
      // System
      {
        id: 'OOC_Stanton',
        displayName: 'Stanton System',
        classification: 'primary',
        type: 'system',
        system: 'stanton',
        confidence: 1.0,
        jurisdiction: 'UEE'
      },
      
      // Planets
      {
        id: 'OOC_Stanton_1',
        displayName: 'Hurston',
        classification: 'primary',
        type: 'planet',
        system: 'stanton',
        confidence: 1.0,
        parent: 'OOC_Stanton',
        jurisdiction: 'Hurston Dynamics'
      },
      {
        id: 'OOC_Stanton_2',
        displayName: 'Crusader',
        classification: 'primary',
        type: 'planet',
        system: 'stanton',
        confidence: 1.0,
        parent: 'OOC_Stanton',
        jurisdiction: 'Crusader Industries'
      },
      {
        id: 'OOC_Stanton_3',
        displayName: 'ArcCorp',
        classification: 'primary',
        type: 'planet',
        system: 'stanton',
        confidence: 1.0,
        parent: 'OOC_Stanton',
        jurisdiction: 'ArcCorp'
      },
      {
        id: 'OOC_Stanton_4',
        displayName: 'microTech',
        classification: 'primary',
        type: 'planet',
        system: 'stanton',
        confidence: 1.0,
        parent: 'OOC_Stanton',
        jurisdiction: 'Microtech Corporation'
      },
      
      // Moons
      {
        id: 'OOC_Stanton_1a',
        displayName: 'Lyria',
        classification: 'primary',
        type: 'moon',
        system: 'stanton',
        confidence: 1.0,
        parent: 'OOC_Stanton_1'
      },
      {
        id: 'OOC_Stanton_1b',
        displayName: 'Aberdeen',
        classification: 'primary',
        type: 'moon',
        system: 'stanton',
        confidence: 1.0,
        parent: 'OOC_Stanton_1'
      },
      
      // Major Stations
      {
        id: 'PortOlisar',
        displayName: 'Port Olisar',
        classification: 'secondary',
        type: 'station',
        system: 'stanton',
        confidence: 1.0,
        primaryZone: 'OOC_Stanton_2',
        orbitingBody: 'Crusader',
        purpose: 'Orbital Platform'
      },
      {
        id: 'GrimHex',
        displayName: 'GrimHEX',
        classification: 'secondary',
        type: 'station',
        system: 'stanton',
        confidence: 1.0,
        primaryZone: 'OOC_Stanton_2c',
        orbitingBody: 'Yela',
        purpose: 'Outlaw Base'
      },
      
      // Landing Zones
      {
        id: 'Lorville',
        displayName: 'Lorville',
        classification: 'secondary',
        type: 'landing_zone',
        system: 'stanton',
        confidence: 1.0,
        primaryZone: 'OOC_Stanton_1',
        orbitingBody: 'Hurston',
        purpose: 'Urban Center'
      },
      {
        id: 'Area18',
        displayName: 'Area18',
        classification: 'secondary',
        type: 'landing_zone',
        system: 'stanton',
        confidence: 1.0,
        primaryZone: 'OOC_Stanton_3',
        orbitingBody: 'ArcCorp',
        purpose: 'Urban Center'
      }
    ];
    
    // Add zones to database
    for (const zone of stantonZones) {
      this.zoneDatabase.zones.set(zone.id, zone);
    }
    
    logger.info(MODULE_NAME, `Initialized database with ${stantonZones.length} known zones`);
  }
  
  /**
   * Update matching configuration
   */
  static updateMatchingConfig(config: Partial<ZoneMatchingConfig>): void {
    this.matchingConfig = { ...this.matchingConfig, ...config };
    logger.info(MODULE_NAME, 'Zone matching configuration updated');
  }
  
  /**
   * Get current matching configuration
   */
  static getMatchingConfig(): ZoneMatchingConfig {
    return { ...this.matchingConfig };
  }
  
  /**
   * Export zone database for backup/analysis
   */
  static exportDatabase(): ZoneDatabase {
    return {
      zones: new Map(this.zoneDatabase.zones),
      lastUpdated: this.zoneDatabase.lastUpdated,
      version: this.zoneDatabase.version,
      source: this.zoneDatabase.source
    };
  }
}