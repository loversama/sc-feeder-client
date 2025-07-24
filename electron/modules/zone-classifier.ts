/**
 * Zone Classification and Resolution System
 * 
 * This module handles the classification of Star Citizen zones into primary/secondary
 * categories and provides resolution logic for zone hierarchy determination.
 */

import {
  ZoneClassification,
  SystemType,
  PrimaryZoneType,
  SecondaryZoneType,
  PrimaryZone,
  SecondaryZone,
  ZoneResolution,
  ZoneClassificationConfig
} from '../../shared/zone-types';
import * as logger from './logger';

const MODULE_NAME = 'ZoneClassifier';

/**
 * Zone classification configuration with Star Citizen specific patterns
 */
const DEFAULT_CONFIG: ZoneClassificationConfig = {
  maxHistorySize: 10,
  fallbackTimeout: 300000, // 5 minutes
  confidenceThreshold: 0.6,
  
  // Primary zone patterns - systems, planets, moons, major bodies
  primaryZonePatterns: [
    /^OOC_Stanton$/i,                    // Stanton system
    /^OOC_Stanton_(\d+)$/i,              // Stanton planets (1=Hurston, 2=Crusader, 3=ArcCorp, 4=microTech)
    /^OOC_Stanton_(\d+)([a-z])$/i,       // Stanton moons (1a=Lyria, 1b=Aberdeen, etc.)
    /^OOC_Pyro$/i,                       // Pyro system
    /^OOC_Pyro_(\d+)$/i,                 // Pyro planets
    /^OOC_Pyro_(\d+)([a-z])$/i,          // Pyro moons
    /^JP_/i,                             // Jump points
    /^Quantum_/i,                        // Quantum travel beacons
    /^(Hurston|Crusader|ArcCorp|microTech)$/i, // Direct planet names
  ],
  
  // Secondary zone patterns - outposts, stations, POIs, landing zones
  secondaryZonePatterns: [
    /^OOC_Stanton_\d+[a-z]?_(.+)$/i,     // Locations on Stanton bodies
    /^OOC_Pyro_\d+[a-z]?_(.+)$/i,        // Locations on Pyro bodies
    /^(GrimHex|PortOlisar|PortTressler|Orison|NewBabbage|Area18|Lorville)$/i, // Major landing zones/stations
    /^(.+)_(Outpost|Station|Mining|Research|Security|Medical)$/i, // Typed facilities
    /^(CRU-L[1-5]|HUR-L[1-5]|ARC-L[1-5]|MIC-L[1-5])$/i, // Lagrange stations
    /^(Everus_Harbor|Baijini_Point|Tressler|Seraphim|Sentinel)$/i, // Named stations
    /^(.+)_(Admin|Industrial|Residential|Commercial)$/i, // Zone districts
    /^R&R_/i,                            // Rest & Relax stations
    /^SPK$/i,                            // Security Post Kareah
    /^(Kareah|Covalex|Comm_Array)$/i,    // Specific POIs
  ],
  
  // System identification patterns
  systemPatterns: {
    stanton: [
      /stanton/i,
      /hurston/i,
      /crusader/i,
      /arccorp/i,
      /microtech/i,
      /orison/i,
      /lorville/i,
      /area18/i,
      /newbabbage/i
    ],
    pyro: [
      /pyro/i,
      /ruin_station/i
    ],
    unknown: []
  }
};

/**
 * Zone classification utility class
 */
export class ZoneClassifier {
  private static config: ZoneClassificationConfig = DEFAULT_CONFIG;
  
  /**
   * Classify a zone ID as primary or secondary
   */
  static classifyZone(zoneId: string): ZoneClassification {
    const cleanId = this.cleanZoneId(zoneId);
    
    // Check primary patterns first (more specific)
    for (const pattern of this.config.primaryZonePatterns) {
      if (pattern.test(cleanId)) {
        logger.debug(MODULE_NAME, `Classified '${cleanId}' as PRIMARY zone`);
        return 'primary';
      }
    }
    
    // Check secondary patterns
    for (const pattern of this.config.secondaryZonePatterns) {
      if (pattern.test(cleanId)) {
        logger.debug(MODULE_NAME, `Classified '${cleanId}' as SECONDARY zone`);
        return 'secondary';
      }
    }
    
    // Default to secondary for unrecognized patterns
    logger.debug(MODULE_NAME, `No pattern match for '${cleanId}', defaulting to SECONDARY`);
    return 'secondary';
  }
  
  /**
   * Determine which star system a zone belongs to
   */
  static determineSystem(zoneId: string): SystemType {
    const cleanId = this.cleanZoneId(zoneId);
    
    // Check each system's patterns
    for (const [system, patterns] of Object.entries(this.config.systemPatterns) as [SystemType, RegExp[]][]) {
      for (const pattern of patterns) {
        if (pattern.test(cleanId)) {
          logger.debug(MODULE_NAME, `Identified system '${system}' for zone '${cleanId}'`);
          return system;
        }
      }
    }
    
    logger.debug(MODULE_NAME, `Could not determine system for zone '${cleanId}', using 'unknown'`);
    return 'unknown';
  }
  
  /**
   * Determine the type of primary zone
   */
  static determinePrimaryType(zoneId: string): PrimaryZoneType {
    const cleanId = this.cleanZoneId(zoneId);
    
    // System level
    if (/^OOC_(Stanton|Pyro)$/i.test(cleanId)) {
      return 'system';
    }
    
    // Jump points
    if (/^JP_/i.test(cleanId)) {
      return 'jump_point';
    }
    
    // Planets (numbered zones like OOC_Stanton_1)
    if (/^OOC_(Stanton|Pyro)_\d+$/i.test(cleanId)) {
      return 'planet';
    }
    
    // Moons (lettered zones like OOC_Stanton_1a)
    if (/^OOC_(Stanton|Pyro)_\d+[a-z]$/i.test(cleanId)) {
      return 'moon';
    }
    
    // Asteroid fields
    if (/asteroid/i.test(cleanId)) {
      return 'asteroid_field';
    }
    
    // Default to system
    return 'system';
  }
  
  /**
   * Determine the type of secondary zone
   */
  static determineSecondaryType(zoneId: string): SecondaryZoneType {
    const cleanId = this.cleanZoneId(zoneId);
    
    // Stations (major orbital platforms)
    if (/^(GrimHex|PortOlisar|PortTressler|CRU-L\d|HUR-L\d|ARC-L\d|MIC-L\d|Everus_Harbor|Baijini_Point)$/i.test(cleanId)) {
      return 'station';
    }
    
    // Landing zones (major planetary cities)
    if (/^(Orison|NewBabbage|Area18|Lorville)$/i.test(cleanId)) {
      return 'landing_zone';
    }
    
    // Outposts (smaller facilities)
    if (/outpost|mining|research|security|medical/i.test(cleanId)) {
      return 'outpost';
    }
    
    // Rest & Relax stations
    if (/^R&R_/i.test(cleanId)) {
      return 'station';
    }
    
    // Derelicts and wrecks
    if (/derelict|wreck|abandoned/i.test(cleanId)) {
      return 'derelict';
    }
    
    // Asteroids
    if (/asteroid/i.test(cleanId)) {
      return 'asteroid';
    }
    
    // Ships (dynamic zones)
    if (/ship|vessel|craft/i.test(cleanId)) {
      return 'ship';
    }
    
    // Default to POI
    return 'poi';
  }
  
  /**
   * Generate human-readable display name from zone ID
   */
  static generateDisplayName(zoneId: string): string {
    const cleanId = this.cleanZoneId(zoneId);
    
    // Handle known Stanton planets
    const stantonPlanets: Record<string, string> = {
      'OOC_Stanton_1': 'Hurston',
      'OOC_Stanton_2': 'Crusader', 
      'OOC_Stanton_3': 'ArcCorp',
      'OOC_Stanton_4': 'microTech'
    };
    
    if (stantonPlanets[cleanId]) {
      return stantonPlanets[cleanId];
    }
    
    // Handle Stanton moons
    if (cleanId.match(/^OOC_Stanton_(\d+)([a-z])$/i)) {
      const match = cleanId.match(/^OOC_Stanton_(\d+)([a-z])$/i);
      const planetNum = match?.[1];
      const moonLetter = match?.[2]?.toUpperCase();
      
      // Known moon names
      const moonNames: Record<string, string> = {
        '1a': 'Lyria',
        '1b': 'Aberdeen',
        '1c': 'Ita',
        '2a': 'Cellin',
        '2b': 'Daymar',
        '2c': 'Yela',
        '3a': 'Wala',
        '3b': 'Lyria',
        '4a': 'Calliope',
        '4b': 'Clio',
        '4c': 'Euterpe'
      };
      
      const moonKey = `${planetNum}${moonLetter?.toLowerCase()}`;
      if (moonNames[moonKey]) {
        return moonNames[moonKey];
      }
      
      return `${stantonPlanets[`OOC_Stanton_${planetNum}`] || `Planet ${planetNum}`} ${moonLetter}`;
    }
    
    // Handle specific locations
    const knownLocations: Record<string, string> = {
      'GrimHex': 'GrimHEX',
      'PortOlisar': 'Port Olisar',
      'PortTressler': 'Port Tressler',
      'Orison': 'Orison Landing Zone',
      'NewBabbage': 'New Babbage',
      'Area18': 'Area18',
      'Lorville': 'Lorville',
      'SPK': 'Security Post Kareah'
    };
    
    if (knownLocations[cleanId]) {
      return knownLocations[cleanId];
    }
    
    // Generic cleanup for unknown zones
    return cleanId
      .replace(/^OOC_/, '')
      .replace(/_/g, ' ')
      .replace(/\b\w/g, l => l.toUpperCase())
      .trim();
  }
  
  /**
   * Find the primary zone that a secondary zone belongs to
   */
  static derivePrimaryZone(secondaryZoneId: string): string | undefined {
    const cleanId = this.cleanZoneId(secondaryZoneId);
    
    // Extract primary zone from secondary zone patterns
    
    // Stanton body locations: OOC_Stanton_1_Aberdeen -> OOC_Stanton_1
    const stantonMatch = cleanId.match(/^(OOC_Stanton_\d+[a-z]?)_/i);
    if (stantonMatch) {
      return stantonMatch[1];
    }
    
    // Pyro body locations: OOC_Pyro_1_SomeLocation -> OOC_Pyro_1
    const pyroMatch = cleanId.match(/^(OOC_Pyro_\d+[a-z]?)_/i);
    if (pyroMatch) {
      return pyroMatch[1];
    }
    
    // Known station -> planet associations
    const stationAssociations: Record<string, string> = {
      'PortOlisar': 'OOC_Stanton_2',    // Crusader
      'PortTressler': 'OOC_Stanton_4',  // microTech  
      'Everus_Harbor': 'OOC_Stanton_1', // Hurston
      'Baijini_Point': 'OOC_Stanton_3', // ArcCorp
      'GrimHex': 'OOC_Stanton_1c',      // Yela (Crusader moon)
    };
    
    if (stationAssociations[cleanId]) {
      return stationAssociations[cleanId];
    }
    
    return undefined;
  }
  
  /**
   * Clean zone ID by removing numeric suffixes and normalizing
   */
  private static cleanZoneId(zoneId: string): string {
    if (!zoneId) return '';
    
    // Remove numeric suffixes like _123, _001
    return zoneId.replace(/_\d+$/, '').trim();
  }
  
  /**
   * Update classification configuration
   */
  static updateConfig(newConfig: Partial<ZoneClassificationConfig>): void {
    this.config = { ...this.config, ...newConfig };
    logger.info(MODULE_NAME, 'Zone classification configuration updated');
  }
  
  /**
   * Get current configuration
   */
  static getConfig(): ZoneClassificationConfig {
    return { ...this.config };
  }
}