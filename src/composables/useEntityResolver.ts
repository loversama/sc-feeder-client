import { ref, computed } from 'vue';

// Types for resolved entity
export interface ResolvedEntity {
  displayName: string;
  isNpc: boolean;
  category: 'ship' | 'weapon' | 'object' | 'npc' | 'location' | 'unknown';
  matchMethod: 'server' | 'exact' | 'pattern' | 'fallback';
  originalId: string;
}

// Cache for resolved entities to avoid repeated API calls
const entityCache = new Map<string, ResolvedEntity>();
const definitionsVersion = ref<string | null>(null);

/**
 * Composable for entity resolution with caching and batch processing
 */
export function useEntityResolver() {
  const isLoading = ref(false);
  const error = ref<string | null>(null);

  /**
   * Clears the entity cache (useful when definitions are updated)
   */
  const clearCache = () => {
    entityCache.clear();
    definitionsVersion.value = null;
  };

  /**
   * Checks if definitions have been updated and clears cache if needed
   */
  const checkForUpdates = async () => {
    try {
      if (!window.logMonitorApi?.getDefinitionsVersion) return;
      
      const currentVersion = await window.logMonitorApi.getDefinitionsVersion();
      if (currentVersion && currentVersion !== definitionsVersion.value) {
        clearCache();
        definitionsVersion.value = currentVersion;
      }
    } catch (err) {
      console.warn('Failed to check definitions version:', err);
    }
  };

  /**
   * Resolves a single entity ID to human-readable information
   */
  const resolveEntity = async (entityId: string, serverEnriched?: any): Promise<ResolvedEntity> => {
    if (!entityId) {
      return {
        displayName: 'Unknown',
        isNpc: false,
        category: 'unknown',
        matchMethod: 'fallback',
        originalId: entityId || ''
      };
    }

    // Check cache first
    const cacheKey = `${entityId}:${JSON.stringify(serverEnriched)}`;
    if (entityCache.has(cacheKey)) {
      return entityCache.get(cacheKey)!;
    }

    try {
      isLoading.value = true;
      error.value = null;

      // Use server-enriched data if available
      if (serverEnriched?.friendlyName || serverEnriched?.friendly_name) {
        const resolved: ResolvedEntity = {
          displayName: serverEnriched.friendlyName || serverEnriched.friendly_name,
          isNpc: serverEnriched.isNpc || serverEnriched.is_npc || false,
          category: mapServerCategory(serverEnriched.category || serverEnriched.entity_category),
          matchMethod: 'server',
          originalId: entityId
        };
        entityCache.set(cacheKey, resolved);
        return resolved;
      }

      // Fall back to local resolution via IPC
      if (window.logMonitorApi?.resolveEntity) {
        const result = await window.logMonitorApi.resolveEntity(entityId, serverEnriched);
        const resolved: ResolvedEntity = {
          ...result,
          originalId: entityId
        };
        entityCache.set(cacheKey, resolved);
        return resolved;
      }

      // Final fallback to simple cleanup
      const resolved: ResolvedEntity = {
        displayName: cleanEntityName(entityId),
        isNpc: false,
        category: 'unknown',
        matchMethod: 'fallback',
        originalId: entityId
      };
      entityCache.set(cacheKey, resolved);
      return resolved;

    } catch (err) {
      error.value = `Failed to resolve entity: ${err}`;
      console.error('Entity resolution error:', err);
      
      // Return fallback result
      const fallback: ResolvedEntity = {
        displayName: cleanEntityName(entityId),
        isNpc: false,
        category: 'unknown',
        matchMethod: 'fallback',
        originalId: entityId
      };
      entityCache.set(cacheKey, fallback);
      return fallback;
    } finally {
      isLoading.value = false;
    }
  };

  /**
   * Resolves multiple entities in a batch for better performance
   */
  const resolveEntities = async (entityIds: string[]): Promise<ResolvedEntity[]> => {
    if (!entityIds.length) return [];

    try {
      isLoading.value = true;
      error.value = null;

      // Check cache for existing entities
      const uncachedIds: string[] = [];
      const results: ResolvedEntity[] = new Array(entityIds.length);

      for (let i = 0; i < entityIds.length; i++) {
        const id = entityIds[i];
        if (entityCache.has(id)) {
          results[i] = entityCache.get(id)!;
        } else {
          uncachedIds.push(id);
        }
      }

      // Batch resolve uncached entities
      if (uncachedIds.length > 0 && window.logMonitorApi?.resolveEntitiesBatch) {
        const batchResults = await window.logMonitorApi.resolveEntitiesBatch(uncachedIds);
        
        let uncachedIndex = 0;
        for (let i = 0; i < entityIds.length; i++) {
          if (!results[i]) {
            const resolved: ResolvedEntity = {
              ...batchResults[uncachedIndex],
              originalId: entityIds[i]
            };
            results[i] = resolved;
            entityCache.set(entityIds[i], resolved);
            uncachedIndex++;
          }
        }
      }

      return results;

    } catch (err) {
      error.value = `Failed to resolve entities: ${err}`;
      console.error('Batch entity resolution error:', err);
      
      // Return fallback results
      return entityIds.map(id => ({
        displayName: cleanEntityName(id),
        isNpc: false,
        category: 'unknown' as const,
        matchMethod: 'fallback' as const,
        originalId: id
      }));
    } finally {
      isLoading.value = false;
    }
  };

  /**
   * Checks if an entity is an NPC
   */
  const isNpcEntity = async (entityId: string): Promise<boolean> => {
    try {
      if (window.logMonitorApi?.isNpcEntity) {
        return await window.logMonitorApi.isNpcEntity(entityId);
      }
      return false;
    } catch (err) {
      console.error('NPC check error:', err);
      return false;
    }
  };

  /**
   * Filters out NPC entities from a list
   */
  const filterNpcs = async (entityIds: string[]): Promise<string[]> => {
    try {
      if (window.logMonitorApi?.filterNpcs) {
        return await window.logMonitorApi.filterNpcs(entityIds);
      }
      return entityIds;
    } catch (err) {
      console.error('NPC filter error:', err);
      return entityIds;
    }
  };

  /**
   * Gets definitions cache statistics
   */
  const getCacheStats = async () => {
    try {
      if (window.logMonitorApi?.getDefinitionsStats) {
        return await window.logMonitorApi.getDefinitionsStats();
      }
      return null;
    } catch (err) {
      console.error('Cache stats error:', err);
      return null;
    }
  };

  /**
   * Forces a refresh of definitions from the server
   */
  const forceRefresh = async (): Promise<boolean> => {
    try {
      if (window.logMonitorApi?.forceRefreshDefinitions) {
        const success = await window.logMonitorApi.forceRefreshDefinitions();
        if (success) {
          clearCache();
        }
        return success;
      }
      return false;
    } catch (err) {
      console.error('Force refresh error:', err);
      return false;
    }
  };

  // Initialize version check
  checkForUpdates();

  return {
    // State
    isLoading: computed(() => isLoading.value),
    error: computed(() => error.value),
    definitionsVersion: computed(() => definitionsVersion.value),
    
    // Methods
    resolveEntity,
    resolveEntities,
    isNpcEntity,
    filterNpcs,
    clearCache,
    getCacheStats,
    forceRefresh,
    checkForUpdates
  };
}

/**
 * Convenience composable for ship name resolution
 */
export function useShipResolver() {
  const { resolveEntity } = useEntityResolver();
  
  const resolveShipName = async (shipId: string, serverData?: any): Promise<string> => {
    const resolved = await resolveEntity(shipId, serverData);
    return resolved.displayName;
  };

  return { resolveShipName };
}

/**
 * Convenience composable for weapon name resolution
 */
export function useWeaponResolver() {
  const { resolveEntity } = useEntityResolver();
  
  const resolveWeaponName = async (weaponId: string, serverData?: any): Promise<string> => {
    const resolved = await resolveEntity(weaponId, serverData);
    return resolved.displayName;
  };

  return { resolveWeaponName };
}

// Utility functions

/**
 * Maps server category names to standard categories
 */
function mapServerCategory(serverCategory?: string): 'ship' | 'weapon' | 'object' | 'npc' | 'location' | 'unknown' {
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
 * Cleans entity names using hardcoded fallback logic
 */
function cleanEntityName(entityId: string): string {
  if (!entityId) return 'Unknown';
  
  // Remove ID suffixes
  let cleaned = entityId.replace(/^(.+?)_\d+$/, '$1');
  
  // Handle manufacturer prefixes for ships
  const parts = cleaned.split('_');
  if (parts.length > 1) {
    const manufacturers = [
      'ORIG', 'CRUS', 'RSI', 'AEGS', 'VNCL', 'DRAK', 'ANVL', 'BANU',
      'MISC', 'CNOU', 'XIAN', 'GAMA', 'TMBL', 'ESPR', 'KRIG', 'GRIN',
      'XNAA', 'MRAI'
    ];
    
    if (manufacturers.includes(parts[0])) {
      cleaned = parts.slice(1).join(' ');
    }
  }
  
  return cleaned.replace(/_/g, ' ');
}