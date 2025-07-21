import fetch from 'node-fetch';
import fs from 'fs/promises';
import path from 'path';
import { app } from 'electron';
import * as logger from './logger'; // Import all logger functions
import { getDetailedUserAgent } from './app-lifecycle';

const DEFINITIONS_API_URL = '/api/definitions';
const DEFINITIONS_VERSION_API_URL = '/api/definitions/version';
const LOCAL_DEFINITIONS_PATH = path.join(app.getPath('userData'), 'local-definitions.json');
const SYNC_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const ONE_WEEK_IN_MS = 7 * 24 * 60 * 60 * 1000;

interface DefinitionsData {
  ships?: Record<string, string>;
  weapons?: Record<string, string>;
  objects?: Record<string, string> & { _patterns?: Array<{ regex: string; template: string; }> };
  npcs?: Record<string, string>;
  locations?: Record<string, any>;
  npcNamePatterns?: Array<{ regex: string; template: string; }>;
}

interface ServerDefinitionsResponse {
  version: string;
  timestamp: number;
  data: DefinitionsData;
}

interface ServerVersionResponse {
  version: string;
  timestamp: number;
  entityCounts: Record<string, number>;
}

interface CachedDefinitions {
  version: string;
  timestamp: number;
  lastUpdated: string;
  definitions: DefinitionsData;
  npcIgnoreList?: {
    exactMatches: string[];
    regexPatterns: string[];
  };
  metadata: {
    entityCounts: Record<string, number>;
    patternStats: { compiled: number; failed: number; };
  };
}

interface CompiledPattern {
  regex: RegExp;
  template: string;
  category: string;
  specificity: number;
}

let cachedDefinitions: CachedDefinitions | null = null;
let definitionsMap: Map<string, string> = new Map();
let npcPatternsCompiled: CompiledPattern[] = [];
let objectPatternsCompiled: CompiledPattern[] = [];
let npcIgnorePatterns: RegExp[] = [];
let lastSuccessfulUpdateTimestamp: Date | null = null;
let syncIntervalId: NodeJS.Timeout | null = null;

/**
 * Updates the internal maps and compiled patterns for quick lookups.
 */
function updateDefinitionsCache(): void {
  try {
    if (!cachedDefinitions) {
      definitionsMap.clear();
      npcPatternsCompiled = [];
      objectPatternsCompiled = [];
      npcIgnorePatterns = [];
      logger.info('DefinitionsService', 'Cache cleared - no definitions available');
      return;
    }

    const { definitions, npcIgnoreList } = cachedDefinitions;
    definitionsMap.clear();

    // Build flat lookup map for exact matches
    try {
      for (const [category, items] of Object.entries(definitions)) {
        if (category === 'npcNamePatterns' || !items || typeof items !== 'object') continue;
        
        for (const [key, value] of Object.entries(items)) {
          if (key !== '_patterns') {
            if (typeof value === 'string') {
              // Direct string mapping (ships, weapons, objects, npcs)
              definitionsMap.set(key, value);
            } else if (value && typeof value === 'object' && (value as any).friendlyName) {
              // Location object with friendlyName property
              definitionsMap.set(key, (value as any).friendlyName);
            }
          }
        }
      }
    } catch (error) {
      logger.error('DefinitionsService', 'Error building exact match cache:', error);
    }

    // Compile NPC name patterns
    try {
      npcPatternsCompiled = compilePatterns(
        definitions.npcNamePatterns || [],
        'npc'
      ).sort((a, b) => b.specificity - a.specificity);
    } catch (error) {
      logger.error('DefinitionsService', 'Error compiling NPC patterns:', error);
      npcPatternsCompiled = [];
    }

    // Compile object patterns
    try {
      const objectPatterns = definitions.objects?._patterns;
      if (Array.isArray(objectPatterns)) {
        objectPatternsCompiled = compilePatterns(
          objectPatterns,
          'object'
        ).sort((a, b) => b.specificity - a.specificity);
      } else if (objectPatterns && typeof objectPatterns === 'object') {
        // Handle the case where _patterns is an object with regex keys
        const patternsArray = Object.entries(objectPatterns).map(([regex, template]) => ({
          regex,
          template: String(template)
        }));
        objectPatternsCompiled = compilePatterns(
          patternsArray,
          'object'
        ).sort((a, b) => b.specificity - a.specificity);
      } else {
        objectPatternsCompiled = [];
      }
    } catch (error) {
      logger.error('DefinitionsService', 'Error compiling object patterns:', error);
      objectPatternsCompiled = [];
    }

    // Compile NPC ignore patterns
    try {
      if (npcIgnoreList) {
        npcIgnorePatterns = [];
        for (const pattern of npcIgnoreList.regexPatterns || []) {
          try {
            npcIgnorePatterns.push(new RegExp(pattern));
          } catch (error) {
            logger.warn('DefinitionsService', `Invalid NPC ignore pattern: ${pattern}`);
          }
        }
      }
    } catch (error) {
      logger.error('DefinitionsService', 'Error compiling NPC ignore patterns:', error);
      npcIgnorePatterns = [];
    }

    logger.success('DefinitionsService', 
      `Definitions cache updated: ${definitionsMap.size} exact matches, ` +
      `${npcPatternsCompiled.length} NPC patterns, ${objectPatternsCompiled.length} object patterns`
    );
  } catch (error) {
    logger.error('DefinitionsService', 'Critical error updating definitions cache:', error);
    // Reset to safe state
    definitionsMap.clear();
    npcPatternsCompiled = [];
    objectPatternsCompiled = [];
    npcIgnorePatterns = [];
    throw error; // Re-throw to be caught by caller
  }
}

/**
 * Compiles regex patterns with error handling and specificity calculation.
 */
function compilePatterns(
  patterns: Array<{ regex: string; template: string; }>,
  category: string
): CompiledPattern[] {
  const compiled: CompiledPattern[] = [];
  
  for (const pattern of patterns) {
    try {
      const regex = new RegExp(pattern.regex);
      const specificity = calculatePatternSpecificity(pattern.regex);
      compiled.push({
        regex,
        template: pattern.template,
        category,
        specificity
      });
    } catch (error) {
      logger.warn('DefinitionsService', `Invalid ${category} pattern: ${pattern.regex}`);
    }
  }
  
  return compiled;
}

/**
 * Calculates pattern specificity for sorting (higher = more specific).
 */
function calculatePatternSpecificity(pattern: string): number {
  let specificity = 0;
  
  // Count literal characters (higher specificity)
  specificity += (pattern.match(/[a-zA-Z0-9_]/g) || []).length;
  
  // Penalize wildcards (lower specificity)
  specificity -= (pattern.match(/[.*+?]/g) || []).length * 2;
  
  // Bonus for anchors
  if (pattern.startsWith('^')) specificity += 5;
  if (pattern.endsWith('$')) specificity += 5;
  
  return specificity;
}

/**
 * Fetches version information from the server.
 */
async function fetchVersionInfo(serverBaseUrl: string): Promise<ServerVersionResponse | null> {
  const url = `${serverBaseUrl}${DEFINITIONS_VERSION_API_URL}`;
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': getDetailedUserAgent() },
    });
    if (!response.ok) {
      return null;
    }
    return await response.json() as ServerVersionResponse;
  } catch (error) {
    logger.warn('DefinitionsService', 'Failed to fetch version info:', error);
    return null;
  }
}

/**
 * Fetches entity definitions from the server with ETag support.
 */
async function fetchDefinitions(
  serverBaseUrl: string, 
  currentETag?: string
): Promise<ServerDefinitionsResponse | 'not-modified' | null> {
  const url = `${serverBaseUrl}${DEFINITIONS_API_URL}`;
  logger.startup('DefinitionsService', `Fetching definitions from server: ${url}`);
  
  try {
    const headers: Record<string, string> = {
      'User-Agent': getDetailedUserAgent(),
    };
    
    if (currentETag) {
      headers['If-None-Match'] = currentETag;
    }
    
    const response = await fetch(url, { headers });
    
    if (response.status === 304) {
      logger.info('DefinitionsService', 'Definitions not modified (304)');
      return 'not-modified';
    }
    
    if (!response.ok) {
      logger.error(`[DefinitionsService] Error fetching definitions: ${response.status} ${response.statusText}`);
      return null;
    }
    
    const data = await response.json() as ServerDefinitionsResponse;
    
    if (!data.data || typeof data.data !== 'object') {
      logger.error('DefinitionsService', 'Invalid definitions response format');
      return null;
    }
    
    logger.success('DefinitionsService', `Successfully downloaded definitions (version: ${data.version})`);
    return data;
  } catch (error) {
    logger.error('[DefinitionsService] Network or parsing error fetching definitions:', error);
    return null;
  }
}

/**
 * Fetches NPC ignore list from the server.
 */
async function fetchNpcIgnoreList(serverBaseUrl: string): Promise<any> {
  const url = `${serverBaseUrl}/api/npc-ignore-list`;
  
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': getDetailedUserAgent() },
    });
    
    if (!response.ok) {
      logger.warn(`[DefinitionsService] Failed to fetch NPC ignore list: ${response.status}, using defaults`);
      return getDefaultNpcIgnoreList();
    }
    
    const data = await response.json();
    logger.info('[DefinitionsService] Successfully fetched NPC ignore list from server');
    return data;
  } catch (error) {
    logger.warn('[DefinitionsService] Error fetching NPC ignore list, using defaults:', error);
    return getDefaultNpcIgnoreList();
  }
}

/**
 * Default NPC ignore list as fallback.
 */
function getDefaultNpcIgnoreList(): any {
  return {
    exactMatches: [
      'Security', 'SecurityGuard', 'Civilian', 'UEESecurity', 'Pirate',
      'NineTails', 'Security Backup', 'Stanton Security', 'Crusader Security',
      'Microtech Security', 'Hurston Security', 'Arccorp Security', 'Bounty Hunter'
    ],
    regexPatterns: [
      '^PU_Human', '^NPC_', '_NPC$', '^Security_.*', '^Guard_.*',
      '^Civilian_.*', '^Pirate_.*', '^BountyTarget_.*', '^[A-Za-z]+Security$',
      '^[A-Za-z]+Guard$', '^[A-Za-z]+Police$', '^PU_Pilots', '^AIModule_',
      '^Kopion_', '^vlk_juvenile_sentry_', '^Orbital_Sentry_'
    ]
  };
}

/**
 * Saves the fetched definitions to local storage with enhanced metadata.
 */
async function saveDefinitions(serverResponse: ServerDefinitionsResponse, serverBaseUrl?: string): Promise<void> {
  logger.path('DefinitionsService', `Saving definitions to`, LOCAL_DEFINITIONS_PATH);
  
  // Only fetch NPC ignore list if serverBaseUrl is provided
  let npcIgnoreList;
  if (serverBaseUrl) {
    npcIgnoreList = await fetchNpcIgnoreList(serverBaseUrl);
  } else if (cachedDefinitions?.npcIgnoreList) {
    // Use existing NPC ignore list if no server URL provided
    npcIgnoreList = cachedDefinitions.npcIgnoreList;
  } else {
    // Fallback to default
    npcIgnoreList = getDefaultNpcIgnoreList();
  }
  
  const entityCounts = calculateEntityCounts(serverResponse.data);
  
  const fileContent: CachedDefinitions = {
    version: serverResponse.version,
    timestamp: serverResponse.timestamp,
    lastUpdated: new Date().toISOString(),
    definitions: serverResponse.data,
    npcIgnoreList,
    metadata: {
      entityCounts,
      patternStats: {
        compiled: 0, // Will be updated by updateDefinitionsCache
        failed: 0
      }
    }
  };
  
  try {
    await fs.mkdir(path.dirname(LOCAL_DEFINITIONS_PATH), { recursive: true });
    await fs.writeFile(LOCAL_DEFINITIONS_PATH, JSON.stringify(fileContent, null, 2));
    lastSuccessfulUpdateTimestamp = new Date(fileContent.lastUpdated);
    logger.success('DefinitionsService', `Definitions saved locally (Version: ${serverResponse.version})`);
  } catch (error) {
    logger.error('[DefinitionsService] Error saving definitions to local storage:', error);
  }
}

/**
 * Calculates entity counts by category.
 */
function calculateEntityCounts(definitions: DefinitionsData): Record<string, number> {
  const counts: Record<string, number> = {};
  
  for (const [category, items] of Object.entries(definitions)) {
    if (typeof items === 'object' && items !== null) {
      if (category === 'npcNamePatterns') {
        counts[category] = Array.isArray(items) ? items.length : 0;
      } else if (category === 'objects' && items._patterns) {
        const directCount = Object.keys(items).filter(key => key !== '_patterns').length;
        const patternCount = Array.isArray(items._patterns) ? items._patterns.length : 0;
        counts[category] = directCount + patternCount;
      } else {
        counts[category] = Object.keys(items).length;
      }
    }
  }
  
  return counts;
}

/**
 * Loads definitions from local storage.
 */
async function loadCachedDefinitions(): Promise<CachedDefinitions | null> {
  logger.path('DefinitionsService', 'Loading cached definitions from', LOCAL_DEFINITIONS_PATH);
  try {
    const data = await fs.readFile(LOCAL_DEFINITIONS_PATH, 'utf-8');
    const loadedFile = JSON.parse(data) as CachedDefinitions;
    
    if (!loadedFile || !loadedFile.definitions || typeof loadedFile.definitions !== 'object') {
      logger.warn('[DefinitionsService] Local definitions file is malformed.');
      try {
        await fs.unlink(LOCAL_DEFINITIONS_PATH);
        logger.info('[DefinitionsService] Deleted malformed local definitions file.');
      } catch (deleteError) {
        logger.error('[DefinitionsService] Error deleting malformed local definitions file:', deleteError);
      }
      return null;
    }
    
    // Migrate old format if needed
    if (!loadedFile.version) {
      logger.info('[DefinitionsService] Migrating old definitions format');
      return null; // Force re-fetch to get new format
    }
    
    const entityCount = Object.keys(loadedFile.definitions).reduce((count, category) => {
      const items = (loadedFile.definitions as any)[category];
      return count + (typeof items === 'object' && items !== null ? Object.keys(items).length : 0);
    }, 0);
    
    logger.success('DefinitionsService', 
      `Successfully loaded cached definitions (Version: ${loadedFile.version}, ` +
      `${entityCount} total entities, Last updated: ${loadedFile.lastUpdated})`
    );
    return loadedFile;
  } catch (error) {
    // @ts-ignore
    if (error.code === 'ENOENT') {
      logger.warn('DefinitionsService', 'Local definitions file not found - will attempt to download from server');
      return null;
    }
    logger.error('[DefinitionsService] Error loading definitions from local storage:', error);
    return null;
  }
}

/**
 * Core logic to update definitions: fetches from server and saves locally.
 */
async function updateAndSaveDefinitions(serverBaseUrl: string): Promise<boolean> {
  try {
    logger.info('[DefinitionsService] Attempting to update definitions from server...');
    
    const currentETag = cachedDefinitions?.version;
    const fetchResult = await fetchDefinitions(serverBaseUrl, currentETag);
    
    if (fetchResult === 'not-modified') {
      logger.info('[DefinitionsService] Definitions are up to date (not modified)');
      return true;
    }
    
    if (fetchResult && typeof fetchResult === 'object') {
      try {
        logger.info('[DefinitionsService] Processing fetched definitions...');
        
        // Fetch NPC ignore list
        let npcIgnoreList;
        try {
          npcIgnoreList = await fetchNpcIgnoreList(serverBaseUrl);
          logger.info('[DefinitionsService] NPC ignore list fetched successfully');
        } catch (error) {
          logger.warn('[DefinitionsService] Failed to fetch NPC ignore list, using defaults:', error);
          npcIgnoreList = getDefaultNpcIgnoreList();
        }
        
        // Calculate entity counts
        let entityCounts;
        try {
          entityCounts = calculateEntityCounts(fetchResult.data);
          logger.info('[DefinitionsService] Entity counts calculated successfully');
        } catch (error) {
          logger.warn('[DefinitionsService] Failed to calculate entity counts:', error);
          entityCounts = {};
        }
        
        // Create cached definitions object
        cachedDefinitions = {
          version: fetchResult.version,
          timestamp: fetchResult.timestamp,
          lastUpdated: new Date().toISOString(),
          definitions: fetchResult.data,
          npcIgnoreList,
          metadata: {
            entityCounts,
            patternStats: { compiled: 0, failed: 0 }
          }
        };
        
        logger.info('[DefinitionsService] Cached definitions object created successfully');
        
        // Update definitions cache (compile patterns, etc.)
        try {
          updateDefinitionsCache();
          logger.info('[DefinitionsService] Definitions cache updated successfully');
        } catch (error) {
          logger.error('[DefinitionsService] Failed to update definitions cache:', error);
          throw error;
        }
        
        // Save definitions to file
        try {
          await saveDefinitions(fetchResult, serverBaseUrl);
          logger.info('[DefinitionsService] Definitions saved to file successfully');
        } catch (error) {
          logger.warn('[DefinitionsService] Failed to save definitions to file (will continue):', error);
          // Don't fail the whole update if file save fails
        }
        
        logger.info('[DefinitionsService] Definitions updated from server and saved locally.');
        return true;
      } catch (error) {
        logger.error('[DefinitionsService] Error processing fetched definitions:', error);
        return false;
      }
    } else {
      logger.warn('[DefinitionsService] Failed to fetch definitions from server during update attempt.');
      return false;
    }
  } catch (error) {
    logger.error('[DefinitionsService] Critical error in updateAndSaveDefinitions:', error);
    return false;
  }
}


/**
 * Updates NPC ignore list independently from definitions.
 */
async function updateNpcIgnoreList(serverBaseUrl: string): Promise<boolean> {
  try {
    logger.info('[DefinitionsService] Fetching NPC ignore list from server...');
    const npcIgnoreList = await fetchNpcIgnoreList(serverBaseUrl);
    
    if (cachedDefinitions) {
      // Update existing cached definitions with new NPC ignore list
      cachedDefinitions.npcIgnoreList = npcIgnoreList;
      
      // Update the cache (recompile patterns)
      updateDefinitionsCache();
      
      // Save updated cache to file
      const mockServerResponse = {
        version: cachedDefinitions.version,
        timestamp: cachedDefinitions.timestamp,
        data: cachedDefinitions.definitions
      };
      await saveDefinitions(mockServerResponse);
      
      logger.info('[DefinitionsService] NPC ignore list updated successfully');
      return true;
    } else {
      logger.warn('[DefinitionsService] No cached definitions to update with NPC ignore list');
      return false;
    }
  } catch (error) {
    logger.error('[DefinitionsService] Error updating NPC ignore list:', error);
    return false;
  }
}

/**
 * Starts periodic sync process.
 */
function startPeriodicSync(serverBaseUrl: string): void {
  if (syncIntervalId) {
    clearInterval(syncIntervalId);
  }
  
  syncIntervalId = setInterval(async () => {
    logger.info('[DefinitionsService] Performing periodic sync check...');
    
    // Quick version check first
    const versionInfo = await fetchVersionInfo(serverBaseUrl);
    if (versionInfo && cachedDefinitions && versionInfo.version !== cachedDefinitions.version) {
      logger.info('[DefinitionsService] New version detected, updating definitions...');
      await updateAndSaveDefinitions(serverBaseUrl);
    }
    
    // Also periodically update NPC ignore list
    try {
      logger.info('[DefinitionsService] Periodic NPC ignore list sync...');
      await updateNpcIgnoreList(serverBaseUrl);
    } catch (error) {
      logger.warn('[DefinitionsService] Error during periodic NPC ignore list sync:', error);
    }
  }, SYNC_INTERVAL_MS);
  
  logger.info(`[DefinitionsService] Periodic sync started (${SYNC_INTERVAL_MS / 1000}s interval)`);
}

/**
 * Stops periodic sync process.
 */
export function stopPeriodicSync(): void {
  if (syncIntervalId) {
    clearInterval(syncIntervalId);
    syncIntervalId = null;
    logger.info('[DefinitionsService] Periodic sync stopped');
  }
}

/**
 * Initializes the definitions service with enhanced caching and periodic sync.
 */
export async function initializeDefinitions(serverBaseUrl: string): Promise<void> {
  try {
    logger.startup('DefinitionsService', 'Initializing enhanced entity definitions system...');

    let definitionsLoadedLocally = false;

    // 1. Try to load from cache first
    try {
      logger.startup('DefinitionsService', 'Loading cached definitions...');
      cachedDefinitions = await loadCachedDefinitions();
      
      if (cachedDefinitions) {
        updateDefinitionsCache();
        lastSuccessfulUpdateTimestamp = new Date(cachedDefinitions.lastUpdated);
        definitionsLoadedLocally = true;
        logger.info(`[DefinitionsService] Loaded cached definitions (Version: ${cachedDefinitions.version})`);
      }
    } catch (error) {
      logger.error('[DefinitionsService] Error loading cached definitions:', error);
      cachedDefinitions = null;
    }

    // 2. Attempt to fetch fresh definitions from server
    try {
      logger.startup('DefinitionsService', 'Checking for updated definitions from server...');
      const updateSuccess = await updateAndSaveDefinitions(serverBaseUrl);
      
      if (updateSuccess && !definitionsLoadedLocally) {
        logger.info('[DefinitionsService] Definitions initialized from server.');
      } else if (!updateSuccess && !definitionsLoadedLocally) {
        logger.error('[DefinitionsService] Failed to load definitions from both server and cache. Operating with no definitions.');
        cachedDefinitions = null;
        updateDefinitionsCache();
        lastSuccessfulUpdateTimestamp = null;
      }
    } catch (error) {
      logger.error('[DefinitionsService] Error updating definitions from server:', error);
      if (!definitionsLoadedLocally) {
        logger.warn('[DefinitionsService] No cached definitions available, operating without definitions.');
      }
    }

    // 3. Independently fetch NPC ignore list (separate from definitions)
    try {
      logger.startup('DefinitionsService', 'Fetching NPC ignore list independently...');
      const npcUpdateSuccess = await updateNpcIgnoreList(serverBaseUrl);
      if (npcUpdateSuccess) {
        logger.info('[DefinitionsService] NPC ignore list updated independently.');
      } else {
        logger.warn('[DefinitionsService] Failed to update NPC ignore list independently.');
      }
    } catch (error) {
      logger.error('[DefinitionsService] Error updating NPC ignore list independently:', error);
    }

    // 4. Start periodic sync
    try {
      startPeriodicSync(serverBaseUrl);
    } catch (error) {
      logger.error('[DefinitionsService] Error starting periodic sync:', error);
      // Don't fail initialization if sync startup fails
    }
    
    logger.success('DefinitionsService', 'Entity definitions system initialized successfully');
  } catch (error) {
    logger.error('[DefinitionsService] Critical error during initialization:', error);
    throw error; // Re-throw to be caught by main.ts
  }
}

/**
 * Gets the currently loaded definitions.
 */
export function getDefinitions(): DefinitionsData | null {
  return cachedDefinitions?.definitions || null;
}

/**
 * Gets the current definitions version.
 */
export function getDefinitionsVersion(): string | null {
  return cachedDefinitions?.version || null;
}

/**
 * Gets a specific entity definition by its ID.
 */
export function getDefinitionById(entityId: string): string | undefined {
  return definitionsMap.get(entityId);
}

/**
 * Checks if an entity is an NPC based on ignore patterns.
 */
export function isNpcEntity(entityId: string): boolean {
  if (!cachedDefinitions?.npcIgnoreList) {
    logger.warn('DefinitionsService', `NPC check failed: no cached definitions for ${entityId}`);
    return false;
  }
  
  // Log the entity being checked for debugging
  logger.debug('DefinitionsService', `Checking NPC status for: "${entityId}"`);
  
  // Check exact matches
  if (cachedDefinitions.npcIgnoreList.exactMatches?.includes(entityId)) {
    logger.info('DefinitionsService', `${entityId} -> NPC (exact match)`);
    return true;
  }
  
  // Check regex patterns
  for (const pattern of npcIgnorePatterns) {
    if (pattern.test(entityId)) {
      logger.info('DefinitionsService', `${entityId} -> NPC (pattern: ${pattern.source})`);
      return true;
    }
  }
  
  logger.debug('DefinitionsService', `${entityId} -> Player (no match found)`);
  return false;
}

/**
 * Resolves an entity ID to a human-readable name using the full resolution pipeline.
 */
export function resolveEntityName(entityId: string): {
  displayName: string;
  isNpc: boolean;
  category: 'ship' | 'weapon' | 'object' | 'npc' | 'location' | 'unknown';
  matchMethod: 'exact' | 'pattern' | 'fallback';
} {
  if (!entityId) {
    return {
      displayName: 'Unknown',
      isNpc: false,
      category: 'unknown',
      matchMethod: 'fallback'
    };
  }
  
  const isNpc = isNpcEntity(entityId);
  
  // 1. Check exact matches
  const exactMatch = definitionsMap.get(entityId);
  if (exactMatch) {
    return {
      displayName: exactMatch,
      isNpc,
      category: determineEntityCategory(entityId),
      matchMethod: 'exact'
    };
  }
  
  // 2. Check NPC patterns
  for (const pattern of npcPatternsCompiled) {
    const match = entityId.match(pattern.regex);
    if (match) {
      return {
        displayName: pattern.template,
        isNpc: true,
        category: 'npc',
        matchMethod: 'pattern'
      };
    }
  }
  
  // 3. Check object patterns
  for (const pattern of objectPatternsCompiled) {
    const match = entityId.match(pattern.regex);
    if (match) {
      return {
        displayName: pattern.template,
        isNpc,
        category: 'object',
        matchMethod: 'pattern'
      };
    }
  }
  
  // 4. Fallback to cleaned name
  return {
    displayName: cleanEntityName(entityId),
    isNpc,
    category: 'unknown',
    matchMethod: 'fallback'
  };
}

/**
 * Determines entity category based on ID patterns and definitions structure.
 */
function determineEntityCategory(entityId: string): 'ship' | 'weapon' | 'object' | 'npc' | 'location' | 'unknown' {
  if (!cachedDefinitions) return 'unknown';
  
  const { definitions } = cachedDefinitions;
  
  if (definitions.ships?.[entityId]) return 'ship';
  if (definitions.weapons?.[entityId]) return 'weapon';
  if (definitions.objects?.[entityId]) return 'object';
  if (definitions.npcs?.[entityId]) return 'npc';
  if (definitions.locations?.[entityId]) return 'location';
  
  return 'unknown';
}

/**
 * Cleans entity names using hardcoded fallback logic.
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

/**
 * Legacy function for backward compatibility.
 */
export function getEntityName(entityId: string): string {
  return resolveEntityName(entityId).displayName;
}


/**
 * Forces a refresh of definitions from the server.
 */
export async function forceRefreshDefinitions(serverBaseUrl: string): Promise<boolean> {
  logger.info('[DefinitionsService] Force refreshing definitions from server...');
  
  // Clear current ETag to force full fetch
  const success = await updateAndSaveDefinitions(serverBaseUrl);
  
  if (success) {
    logger.success('[DefinitionsService] Force refresh completed successfully');
    // Notify main window that definitions were updated
    const { getMainWindow } = await import('./window-manager');
    getMainWindow()?.webContents.send('definitions-updated');
  } else {
    logger.error('[DefinitionsService] Force refresh failed');
  }
  
  return success;
}

/**
 * Forces a refresh of NPC ignore list from the server.
 */
export async function forceRefreshNpcList(serverBaseUrl: string): Promise<boolean> {
  logger.info('[DefinitionsService] Force refreshing NPC ignore list from server...');
  
  const success = await updateNpcIgnoreList(serverBaseUrl);
  
  if (success) {
    logger.success('[DefinitionsService] NPC ignore list force refresh completed successfully');
    // Notify main window that NPC list was updated
    const { getMainWindow } = await import('./window-manager');
    getMainWindow()?.webContents.send('definitions-updated');
  } else {
    logger.error('[DefinitionsService] NPC ignore list force refresh failed');
  }
  
  return success;
}

/**
 * Gets cache statistics for debugging/monitoring.
 */
export function getCacheStats(): {
  version: string | null;
  timestamp: number | null;
  lastUpdated: string | null;
  entityCounts: Record<string, number>;
  patternStats: { compiled: number; failed: number; };
  isLoaded: boolean;
} {
  if (!cachedDefinitions) {
    return {
      version: null,
      timestamp: null,
      lastUpdated: null,
      entityCounts: {},
      patternStats: { compiled: 0, failed: 0 },
      isLoaded: false
    };
  }
  
  return {
    version: cachedDefinitions.version,
    timestamp: cachedDefinitions.timestamp,
    lastUpdated: cachedDefinitions.lastUpdated,
    entityCounts: cachedDefinitions.metadata.entityCounts,
    patternStats: {
      compiled: npcPatternsCompiled.length + objectPatternsCompiled.length,
      failed: 0 // Could track this during compilation
    },
    isLoaded: true
  };
}