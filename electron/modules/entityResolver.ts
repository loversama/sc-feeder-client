import * as logger from './logger';
import { resolveEntityName, isNpcEntity, getDefinitions } from './definitionsService';

/**
 * Resolved entity information
 */
export interface ResolvedEntity {
  displayName: string;
  isNpc: boolean;
  category: 'ship' | 'weapon' | 'object' | 'npc' | 'location' | 'unknown';
  matchMethod: 'server' | 'exact' | 'pattern' | 'fallback';
  originalId: string;
}

/**
 * Entity resolver that handles the full resolution pipeline:
 * 1. Server-enriched data (if available)
 * 2. Local definitions lookup
 * 3. Pattern matching
 * 4. Fallback cleaning
 */
export class EntityResolver {
  /**
   * Resolves a single entity ID to human-readable information.
   */
  static resolveEntity(entityId: string, serverEnriched?: any): ResolvedEntity {
    if (!entityId) {
      return {
        displayName: 'Unknown',
        isNpc: false,
        category: 'unknown',
        matchMethod: 'fallback',
        originalId: entityId || ''
      };
    }

    // 1. Use server-enriched data if available
    if (serverEnriched?.friendlyName || serverEnriched?.friendly_name) {
      const friendlyName = serverEnriched.friendlyName || serverEnriched.friendly_name;
      return {
        displayName: friendlyName,
        isNpc: serverEnriched.isNpc || serverEnriched.is_npc || false,
        category: this.mapServerCategory(serverEnriched.category || serverEnriched.entity_category),
        matchMethod: 'server',
        originalId: entityId
      };
    }

    // 2. Use local resolution
    const localResolution = resolveEntityName(entityId);
    return {
      ...localResolution,
      originalId: entityId
    };
  }

  /**
   * Resolves multiple entities in batch.
   */
  static resolveEntities(entityIds: string[], serverEnrichedData?: Record<string, any>): ResolvedEntity[] {
    return entityIds.map(id => {
      const enriched = serverEnrichedData?.[id];
      return this.resolveEntity(id, enriched);
    });
  }

  /**
   * Filters out NPC entities from a list of resolved entities.
   */
  static filterNpcs(entities: ResolvedEntity[]): ResolvedEntity[] {
    return entities.filter(entity => !entity.isNpc);
  }

  /**
   * Groups entities by category.
   */
  static groupByCategory(entities: ResolvedEntity[]): Record<string, ResolvedEntity[]> {
    const groups: Record<string, ResolvedEntity[]> = {};
    
    for (const entity of entities) {
      if (!groups[entity.category]) {
        groups[entity.category] = [];
      }
      groups[entity.category].push(entity);
    }
    
    return groups;
  }

  /**
   * Gets resolution statistics for monitoring.
   */
  static getResolutionStats(entities: ResolvedEntity[]): {
    total: number;
    byMethod: Record<string, number>;
    byCategory: Record<string, number>;
    npcCount: number;
  } {
    const stats = {
      total: entities.length,
      byMethod: {} as Record<string, number>,
      byCategory: {} as Record<string, number>,
      npcCount: 0
    };

    for (const entity of entities) {
      // Count by method
      stats.byMethod[entity.matchMethod] = (stats.byMethod[entity.matchMethod] || 0) + 1;
      
      // Count by category
      stats.byCategory[entity.category] = (stats.byCategory[entity.category] || 0) + 1;
      
      // Count NPCs
      if (entity.isNpc) {
        stats.npcCount++;
      }
    }

    return stats;
  }

  /**
   * Maps server category names to standard categories.
   */
  private static mapServerCategory(serverCategory?: string): 'ship' | 'weapon' | 'object' | 'npc' | 'location' | 'unknown' {
    if (!serverCategory) return 'unknown';
    
    const normalized = serverCategory.toLowerCase();
    
    if (normalized.includes('ship') || normalized.includes('vehicle')) return 'ship';
    if (normalized.includes('weapon') || normalized.includes('gun')) return 'weapon';
    if (normalized.includes('object') || normalized.includes('debris')) return 'object';
    if (normalized.includes('npc') || normalized.includes('ai')) return 'npc';
    if (normalized.includes('location') || normalized.includes('zone')) return 'location';
    
    return 'unknown';
  }

  /**
   * Validates entity resolution quality.
   */
  static validateResolution(entity: ResolvedEntity): {
    isValid: boolean;
    issues: string[];
    confidence: number;
  } {
    const issues: string[] = [];
    let confidence = 1.0;

    // Check if resolution was successful
    if (entity.displayName === entity.originalId) {
      issues.push('No name transformation applied');
      confidence -= 0.3;
    }

    // Check match method quality
    switch (entity.matchMethod) {
      case 'server':
        confidence = 1.0;
        break;
      case 'exact':
        confidence = 0.9;
        break;
      case 'pattern':
        confidence = 0.7;
        break;
      case 'fallback':
        confidence = 0.5;
        issues.push('Using fallback resolution');
        break;
    }

    // Check for common issues
    if (entity.displayName.includes('_')) {
      issues.push('Display name contains underscores');
      confidence -= 0.1;
    }

    if (entity.displayName.length < 3) {
      issues.push('Display name is very short');
      confidence -= 0.1;
    }

    return {
      isValid: issues.length === 0,
      issues,
      confidence: Math.max(0, confidence)
    };
  }
}

/**
 * Convenience functions for common use cases
 */

/**
 * Resolves a ship name from various possible formats.
 */
export function resolveShipName(shipId: string, serverData?: any): string {
  const resolved = EntityResolver.resolveEntity(shipId, serverData);
  return resolved.displayName;
}

/**
 * Resolves a weapon name from various possible formats.
 */
export function resolveWeaponName(weaponId: string, serverData?: any): string {
  const resolved = EntityResolver.resolveEntity(weaponId, serverData);
  return resolved.displayName;
}

/**
 * Checks if an entity should be filtered as NPC.
 */
export function shouldFilterAsNpc(entityId: string): boolean {
  return isNpcEntity(entityId);
}

/**
 * Resolves player names with NPC filtering.
 */
export function resolvePlayerNames(names: string[]): string[] {
  return names.filter(name => !shouldFilterAsNpc(name));
}

/**
 * Logs resolution statistics for debugging.
 */
export function logResolutionStats(entities: ResolvedEntity[], context: string = 'Unknown'): void {
  const stats = EntityResolver.getResolutionStats(entities);
  
  logger.info('EntityResolver', 
    `Resolution stats for ${context}: ${stats.total} entities, ` +
    `${stats.npcCount} NPCs, Methods: ${JSON.stringify(stats.byMethod)}`
  );
}