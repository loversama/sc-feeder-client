/**
 * Enhanced Zone History Manager
 * 
 * This module manages the player's location history with zone hierarchy tracking,
 * providing intelligent matching between secondary zones and primary zones using
 * historical context and zone relationship logic.
 */

import {
  ZoneHistoryEntry,
  ZoneResolution,
  PrimaryZone,
  SecondaryZone,
  SystemType,
  LocationServiceState,
  ZoneClassification
} from '../../shared/zone-types';
import { ZoneResolver } from './zone-resolver';
import * as logger from './logger';

const MODULE_NAME = 'ZoneHistoryManager';

/**
 * Configuration for zone history management
 */
interface ZoneHistoryConfig {
  maxHistorySize: number;          // Maximum number of zones to track
  minDwellTime: number;            // Minimum time to consider a zone visit valid (ms)
  zoneTransitionThreshold: number; // Distance/time threshold for detecting zone changes
  persistToStorage: boolean;       // Whether to persist history to local storage
  debugLogging: boolean;           // Enable detailed debug logging
}

const DEFAULT_CONFIG: ZoneHistoryConfig = {
  maxHistorySize: 10,
  minDwellTime: 30000,            // 30 seconds
  zoneTransitionThreshold: 10000,  // 10km or 10 seconds
  persistToStorage: true,
  debugLogging: false
};

/**
 * Zone transition event for tracking zone changes
 */
interface ZoneTransition {
  fromZone: ZoneHistoryEntry | null;
  toZone: ZoneHistoryEntry;
  transitionTime: number;
  distance?: number;
  wasSignificant: boolean;
}

/**
 * Enhanced zone history manager with intelligent zone tracking
 */
export class ZoneHistoryManager {
  private zoneHistory: ZoneHistoryEntry[] = [];
  private currentZone: ZoneResolution | null = null;
  private lastPrimaryZone: PrimaryZone | null = null;
  private currentSystem: SystemType = 'unknown';
  private config: ZoneHistoryConfig = DEFAULT_CONFIG;
  private lastTransition: ZoneTransition | null = null;
  
  // Statistics tracking
  private totalZoneChanges = 0;
  private sessionStartTime = new Date().toISOString();
  
  constructor(config?: Partial<ZoneHistoryConfig>) {
    if (config) {
      this.config = { ...DEFAULT_CONFIG, ...config };
    }
    
    // Load persisted history if enabled
    if (this.config.persistToStorage) {
      this.loadPersistedHistory();
    }
    
    logger.info(MODULE_NAME, `Zone history manager initialized with max history size: ${this.config.maxHistorySize}`);
  }
  
  /**
   * Add a zone to the history with full zone resolution and tracking
   */
  addZoneToHistory(
    zoneId: string,
    source: string,
    coordinates?: {x: number, y: number, z: number}
  ): ZoneResolution {
    const resolution = ZoneResolver.resolveZone(zoneId, coordinates);
    const timestamp = new Date().toISOString();
    
    // Check if this is actually a zone change
    const lastEntry = this.getLastHistoryEntry();
    if (lastEntry && lastEntry.zoneId === resolution.zone.id) {
      if (this.config.debugLogging) {
        logger.debug(MODULE_NAME, `Ignoring duplicate zone entry: ${resolution.zone.displayName}`);
      }
      return resolution;
    }
    
    // Calculate dwell time for previous zone
    if (lastEntry) {
      const dwellTime = new Date(timestamp).getTime() - new Date(lastEntry.timestamp).getTime();
      lastEntry.dwellTime = dwellTime;
      
      // Update event count (this would be incremented elsewhere when events occur)
      lastEntry.eventCount = lastEntry.eventCount || 0;
    }
    
    // Create history entry
    const historyEntry: ZoneHistoryEntry = {
      timestamp,
      zoneId: resolution.zone.id,
      zoneName: resolution.zone.displayName,
      classification: resolution.zone.classification,
      system: resolution.zone.system,
      source,
      coordinates,
      dwellTime: 0, // Will be calculated when leaving the zone
      eventCount: 0
    };
    
    // Create transition record
    const transition: ZoneTransition = {
      fromZone: lastEntry,
      toZone: historyEntry,
      transitionTime: lastEntry ? 
        new Date(timestamp).getTime() - new Date(lastEntry.timestamp).getTime() : 0,
      distance: this.calculateDistance(lastEntry?.coordinates, coordinates),
      wasSignificant: this.isSignificantTransition(lastEntry, historyEntry)
    };
    
    // Add to history
    this.zoneHistory.push(historyEntry);
    this.currentZone = resolution;
    this.lastTransition = transition;
    this.totalZoneChanges++;
    
    // Update system tracking
    if (resolution.zone.system !== 'unknown') {
      this.currentSystem = resolution.zone.system;
    }
    
    // Update primary zone tracking
    if (resolution.zone.classification === 'primary') {
      this.lastPrimaryZone = resolution.zone as PrimaryZone;
    }
    
    // Maintain history size limit
    this.trimHistory();
    
    // Persist if enabled
    if (this.config.persistToStorage) {
      this.persistHistory();
    }
    
    // Logging
    const transitionInfo = transition.fromZone ? 
      ` (from ${transition.fromZone.zoneName})` : ' (initial zone)';
    
    logger.info(MODULE_NAME, 
      `Zone transition: ${historyEntry.zoneName} (${historyEntry.classification}, ${historyEntry.system})${transitionInfo}`
    );
    
    if (this.config.debugLogging) {
      logger.debug(MODULE_NAME, `Zone history now contains ${this.zoneHistory.length} entries`);
    }
    
    return resolution;
  }
  
  /**
   * Get the last primary zone from history for secondary zone matching
   */
  getLastPrimaryZone(system?: SystemType): PrimaryZone | null {
    // First check if we have a cached last primary zone
    if (this.lastPrimaryZone) {
      if (!system || this.lastPrimaryZone.system === system) {
        return this.lastPrimaryZone;
      }
    }
    
    // Search history for last primary zone
    for (let i = this.zoneHistory.length - 1; i >= 0; i--) {
      const entry = this.zoneHistory[i];
      if (entry.classification === 'primary') {
        if (!system || entry.system === system) {
          // Resolve the full zone information
          const resolution = ZoneResolver.resolveZone(entry.zoneId);
          if (resolution.zone.classification === 'primary') {
            return resolution.zone as PrimaryZone;
          }
        }
      }
    }
    
    return null;
  }
  
  /**
   * Match a secondary zone to its primary zone using location history
   */
  matchSecondaryToPrimary(secondaryZone: SecondaryZone): PrimaryZone | null {
    // 1. Try direct association first
    if (secondaryZone.primaryZone) {
      const resolution = ZoneResolver.resolveZone(secondaryZone.primaryZone);
      if (resolution.zone.classification === 'primary') {
        logger.debug(MODULE_NAME, 
          `Direct match: ${secondaryZone.displayName} -> ${resolution.zone.displayName}`
        );
        return resolution.zone as PrimaryZone;
      }
    }
    
    // 2. Use location history to find last primary zone in same system
    const lastPrimary = this.getLastPrimaryZone(secondaryZone.system);
    if (lastPrimary) {
      logger.debug(MODULE_NAME, 
        `History match: ${secondaryZone.displayName} -> ${lastPrimary.displayName} (from history)`
      );
      return lastPrimary;
    }
    
    // 3. Try coordinate-based matching if coordinates are available
    if (secondaryZone.coordinates) {
      const nearbyPrimary = this.findNearbyPrimaryZone(secondaryZone.coordinates, secondaryZone.system);
      if (nearbyPrimary) {
        logger.debug(MODULE_NAME, 
          `Coordinate match: ${secondaryZone.displayName} -> ${nearbyPrimary.displayName} (nearby)`
        );
        return nearbyPrimary;
      }
    }
    
    // 4. Fallback to system-based matching
    const systemPrimary = this.getSystemPrimaryZone(secondaryZone.system);
    if (systemPrimary) {
      logger.debug(MODULE_NAME, 
        `System fallback: ${secondaryZone.displayName} -> ${systemPrimary.displayName} (system default)`
      );
      return systemPrimary;
    }
    
    logger.warn(MODULE_NAME, 
      `Could not match secondary zone ${secondaryZone.displayName} to any primary zone`
    );
    return null;
  }
  
  /**
   * Get current system based on zone history and current location
   */
  getCurrentSystem(): SystemType {
    // Use current zone system if available
    if (this.currentZone && this.currentZone.zone.system !== 'unknown') {
      return this.currentZone.zone.system;
    }
    
    // Use cached current system
    if (this.currentSystem !== 'unknown') {
      return this.currentSystem;
    }
    
    // Search history for last known system
    for (let i = this.zoneHistory.length - 1; i >= 0; i--) {
      const entry = this.zoneHistory[i];
      if (entry.system !== 'unknown') {
        return entry.system;
      }
    }
    
    return 'unknown';
  }
  
  /**
   * Get zone history with optional filtering
   */
  getHistory(filter?: {
    classification?: ZoneClassification;
    system?: SystemType;
    limit?: number;
  }): ZoneHistoryEntry[] {
    let history = [...this.zoneHistory];
    
    if (filter) {
      if (filter.classification) {
        history = history.filter(entry => entry.classification === filter.classification);
      }
      
      if (filter.system) {
        history = history.filter(entry => entry.system === filter.system);
      }
      
      if (filter.limit) {
        history = history.slice(-filter.limit);
      }
    }
    
    return history;
  }
  
  /**
   * Get current zone resolution
   */
  getCurrentZone(): ZoneResolution | null {
    return this.currentZone;
  }
  
  /**
   * Get comprehensive location service state
   */
  getLocationState(): LocationServiceState {
    return {
      currentZone: this.currentZone,
      zoneHistory: [...this.zoneHistory],
      lastPrimaryZone: this.lastPrimaryZone,
      currentSystem: this.currentSystem,
      historySize: this.zoneHistory.length,
      lastUpdate: this.zoneHistory.length > 0 ? 
        this.zoneHistory[this.zoneHistory.length - 1].timestamp : 
        this.sessionStartTime
    };
  }
  
  /**
   * Get zone statistics and analytics
   */
  getZoneStatistics(): {
    totalZoneChanges: number;
    sessionsStartTime: string;
    averageDwellTime: number;
    mostVisitedZones: Array<{zone: string, visits: number, totalTime: number}>;
    systemDistribution: Record<SystemType, number>;
    zoneTypeDistribution: Record<string, number>;
  } {
    const zoneVisits = new Map<string, {visits: number, totalTime: number}>();
    const systemCounts: Record<SystemType, number> = {stanton: 0, pyro: 0, unknown: 0};
    const typeCounts: Record<string, number> = {};
    let totalDwellTime = 0;
    let dwellTimeCount = 0;
    
    for (const entry of this.zoneHistory) {
      // Zone visits
      const existing = zoneVisits.get(entry.zoneName) || {visits: 0, totalTime: 0};
      existing.visits++;
      if (entry.dwellTime) {
        existing.totalTime += entry.dwellTime;
        totalDwellTime += entry.dwellTime;
        dwellTimeCount++;
      }
      zoneVisits.set(entry.zoneName, existing);
      
      // System distribution
      systemCounts[entry.system]++;
      
      // Type distribution
      typeCounts[entry.classification] = (typeCounts[entry.classification] || 0) + 1;
    }
    
    const mostVisited = Array.from(zoneVisits.entries())
      .map(([zone, stats]) => ({zone, ...stats}))
      .sort((a, b) => b.visits - a.visits)
      .slice(0, 10);
    
    return {
      totalZoneChanges: this.totalZoneChanges,
      sessionsStartTime: this.sessionStartTime,
      averageDwellTime: dwellTimeCount > 0 ? totalDwellTime / dwellTimeCount : 0,
      mostVisitedZones: mostVisited,
      systemDistribution: systemCounts,
      zoneTypeDistribution: typeCounts
    };
  }
  
  /**
   * Find nearby primary zones using coordinates
   */
  private findNearbyPrimaryZone(
    coordinates: {x: number, y: number, z: number},
    system: SystemType
  ): PrimaryZone | null {
    const proximityThreshold = 100000; // 100km
    
    for (let i = this.zoneHistory.length - 1; i >= 0; i--) {
      const entry = this.zoneHistory[i];
      if (entry.classification === 'primary' && 
          entry.system === system && 
          entry.coordinates) {
        
        const distance = this.calculateDistance(coordinates, entry.coordinates);
        if (distance && distance <= proximityThreshold) {
          const resolution = ZoneResolver.resolveZone(entry.zoneId);
          if (resolution.zone.classification === 'primary') {
            return resolution.zone as PrimaryZone;
          }
        }
      }
    }
    
    return null;
  }
  
  /**
   * Get a default primary zone for a system
   */
  private getSystemPrimaryZone(system: SystemType): PrimaryZone | null {
    const systemDefaults: Record<SystemType, string> = {
      'stanton': 'OOC_Stanton',
      'pyro': 'OOC_Pyro',
      'unknown': ''
    };
    
    const defaultZoneId = systemDefaults[system];
    if (defaultZoneId) {
      const resolution = ZoneResolver.resolveZone(defaultZoneId);
      if (resolution.zone.classification === 'primary') {
        return resolution.zone as PrimaryZone;
      }
    }
    
    return null;
  }
  
  /**
   * Calculate distance between two coordinate points
   */
  private calculateDistance(
    coord1?: {x: number, y: number, z: number},
    coord2?: {x: number, y: number, z: number}
  ): number | undefined {
    if (!coord1 || !coord2) return undefined;
    
    const dx = coord1.x - coord2.x;
    const dy = coord1.y - coord2.y;
    const dz = coord1.z - coord2.z;
    
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }
  
  /**
   * Determine if a zone transition is significant
   */
  private isSignificantTransition(
    fromEntry: ZoneHistoryEntry | null,
    toEntry: ZoneHistoryEntry
  ): boolean {
    if (!fromEntry) return true; // First zone is always significant
    
    // Different systems are always significant
    if (fromEntry.system !== toEntry.system) return true;
    
    // Different classifications are significant
    if (fromEntry.classification !== toEntry.classification) return true;
    
    // Primary zone changes are always significant
    if (toEntry.classification === 'primary') return true;
    
    return false;
  }
  
  /**
   * Trim history to maintain size limits
   */
  private trimHistory(): void {
    if (this.zoneHistory.length > this.config.maxHistorySize) {
      const removed = this.zoneHistory.splice(0, this.zoneHistory.length - this.config.maxHistorySize);
      
      if (this.config.debugLogging) {
        logger.debug(MODULE_NAME, `Trimmed ${removed.length} entries from zone history`);
      }
    }
  }
  
  /**
   * Get the last entry in history
   */
  private getLastHistoryEntry(): ZoneHistoryEntry | null {
    return this.zoneHistory.length > 0 ? this.zoneHistory[this.zoneHistory.length - 1] : null;
  }
  
  /**
   * Persist history to local storage
   */
  private persistHistory(): void {
    try {
      const data = {
        history: this.zoneHistory,
        currentSystem: this.currentSystem,
        lastPrimaryZone: this.lastPrimaryZone,
        sessionStartTime: this.sessionStartTime,
        totalZoneChanges: this.totalZoneChanges
      };
      
      // This would use electron's storage mechanism
      // For now, just log that we would persist
      if (this.config.debugLogging) {
        logger.debug(MODULE_NAME, 'Zone history persisted to storage');
      }
    } catch (error) {
      logger.error(MODULE_NAME, 'Failed to persist zone history:', error);
    }
  }
  
  /**
   * Load persisted history from local storage
   */
  private loadPersistedHistory(): void {
    try {
      // This would load from electron's storage mechanism
      // For now, just log that we would load
      if (this.config.debugLogging) {
        logger.debug(MODULE_NAME, 'Zone history loaded from storage');
      }
    } catch (error) {
      logger.warn(MODULE_NAME, 'Failed to load persisted zone history:', error);
    }
  }
  
  /**
   * Clear all history (useful for testing or reset)
   */
  clearHistory(): void {
    this.zoneHistory = [];
    this.currentZone = null;
    this.lastPrimaryZone = null;
    this.currentSystem = 'unknown';
    this.totalZoneChanges = 0;
    this.sessionStartTime = new Date().toISOString();
    
    logger.info(MODULE_NAME, 'Zone history cleared');
  }
  
  /**
   * Update configuration
   */
  updateConfig(newConfig: Partial<ZoneHistoryConfig>): void {
    this.config = { ...this.config, ...newConfig };
    logger.info(MODULE_NAME, 'Zone history configuration updated');
  }
}