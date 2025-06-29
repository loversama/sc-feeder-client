import fetch from 'node-fetch';
import fs from 'fs/promises';
import path from 'path';
import { app } from 'electron';
import * as logger from './logger'; // Import all logger functions
import { getDetailedUserAgent } from './app-lifecycle';

const DEFINITIONS_API_URL = '/api/definitions'; // Placeholder, confirm actual server URL
const LOCAL_DEFINITIONS_PATH = path.join(app.getPath('userData'), 'local-definitions.json');
const ONE_WEEK_IN_MS = 7 * 24 * 60 * 60 * 1000;

interface EntityDefinition {
  id: string;
  name: string;
  // Add other relevant fields if necessary
}

interface LocalDefinitionsFile {
  lastUpdated: string;
  definitions: EntityDefinition[];
}

let definitions: EntityDefinition[] = [];
let definitionsMap: Map<string, EntityDefinition> = new Map();
let lastSuccessfulUpdateTimestamp: Date | null = null;

/**
 * Updates the internal map for quick definition lookups.
 */
function updateDefinitionsMap(): void {
  definitionsMap.clear();
  for (const def of definitions) {
    definitionsMap.set(def.id, def);
  }
  logger.success('DefinitionsService', `Definitions map updated with ${definitionsMap.size} entries`);
}

/**
 * Fetches entity definitions from the server.
 * @param serverBaseUrl The base URL of the log monitor server.
 * @returns A promise that resolves to an array of entity definitions.
 */
async function fetchDefinitions(serverBaseUrl: string): Promise<EntityDefinition[] | null> {
  const url = `${serverBaseUrl}${DEFINITIONS_API_URL}`;
  logger.startup('DefinitionsService', `Downloading latest definitions from server: ${url}`);
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': getDetailedUserAgent() },
    });
    if (!response.ok) {
      logger.error(`[DefinitionsService] Error fetching definitions: ${response.status} ${response.statusText}`);
      //   throw new Error(`Failed to fetch definitions: ${response.status}`);
      return null;
    }
    const data = await response.json();
    if (!Array.isArray(data)) {
      logger.error('DefinitionsService', 'Fetched definitions data is not an array.');
      return null;
    }
    logger.success('DefinitionsService', `Successfully downloaded ${data.length} definitions from server`);
    return data as EntityDefinition[];
  } catch (error) {
    logger.error('[DefinitionsService] Network or parsing error fetching definitions:', error);
    // throw error;
    return null;
  }
}

/**
 * Saves the fetched definitions to local storage with a timestamp.
 * @param defsToSave The definitions to save.
 */
async function saveDefinitions(defsToSave: EntityDefinition[]): Promise<void> {
  logger.path('DefinitionsService', `Saving ${defsToSave.length} definitions to`, LOCAL_DEFINITIONS_PATH);
  const fileContent: LocalDefinitionsFile = {
    lastUpdated: new Date().toISOString(),
    definitions: defsToSave,
  };
  try {
    await fs.mkdir(path.dirname(LOCAL_DEFINITIONS_PATH), { recursive: true });
    await fs.writeFile(LOCAL_DEFINITIONS_PATH, JSON.stringify(fileContent, null, 2));
    lastSuccessfulUpdateTimestamp = new Date(fileContent.lastUpdated);
    logger.success('DefinitionsService', `Definitions saved locally (Last updated: ${fileContent.lastUpdated})`);
  } catch (error) {
    logger.error('[DefinitionsService] Error saving definitions to local storage:', error);
    // We don't rethrow here as a save failure shouldn't crash the app if definitions are in memory
  }
}

/**
 * Loads definitions from local storage.
 * @returns A promise that resolves to LocalDefinitionsFile or null if not found/error.
 */
async function loadDefinitions(): Promise<LocalDefinitionsFile | null> {
  logger.path('DefinitionsService', 'Loading cached definitions from', LOCAL_DEFINITIONS_PATH);
  try {
    const data = await fs.readFile(LOCAL_DEFINITIONS_PATH, 'utf-8');
    const loadedFile = JSON.parse(data) as LocalDefinitionsFile;
    if (!loadedFile || typeof loadedFile.lastUpdated !== 'string' || !Array.isArray(loadedFile.definitions)) {
        logger.warn('[DefinitionsService] Local definitions file is malformed.');
        // Attempt to delete malformed file to allow fresh fetch and save
        try {
            await fs.unlink(LOCAL_DEFINITIONS_PATH);
            logger.info('[DefinitionsService] Deleted malformed local definitions file.');
        } catch (deleteError) {
            logger.error('[DefinitionsService] Error deleting malformed local definitions file:', deleteError);
        }
        return null;
    }
    logger.success('DefinitionsService', `Successfully loaded ${loadedFile.definitions.length} cached definitions (Last updated: ${loadedFile.lastUpdated})`);
    return loadedFile;
  } catch (error) {
    // @ts-ignore
    if (error.code === 'ENOENT') {
      logger.warn('DefinitionsService', 'Local definitions file not found - will attempt to download from server');
      return null;
    }
    logger.error('[DefinitionsService] Error loading definitions from local storage:', error);
    return null; // Return null on other errors too, to allow fallback
  }
}

/**
 * Core logic to update definitions: fetches from server and saves locally.
 * @param serverBaseUrl The base URL of the log monitor server.
 * @returns True if update was successful, false otherwise.
 */
async function updateAndSaveDefinitions(serverBaseUrl: string): Promise<boolean> {
  logger.info('[DefinitionsService] Attempting to update definitions from server...');
  const fetchedDefs = await fetchDefinitions(serverBaseUrl);
  if (fetchedDefs) {
    definitions = fetchedDefs;
    updateDefinitionsMap(); // Update map after fetching
    await saveDefinitions(fetchedDefs); // saveDefinitions updates lastSuccessfulUpdateTimestamp
    logger.info('[DefinitionsService] Definitions updated from server and saved locally.');
    return true;
  } else {
    logger.warn('[DefinitionsService] Failed to fetch definitions from server during update attempt.');
    return false;
  }
}


/**
 * Initializes the definitions service.
 * Always attempts to fetch fresh definitions on launch.
 * Falls back to local cache if fetch fails.
 * Implements a weekly update check.
 * @param serverBaseUrl The base URL of the log monitor server.
 */
export async function initializeDefinitions(serverBaseUrl: string): Promise<void> {
  logger.startup('DefinitionsService', 'Initializing entity definitions system...');

  let definitionsLoadedLocally = false;

  // 1. Attempt to fetch fresh definitions on launch
  logger.startup('DefinitionsService', 'Attempting to fetch latest definitions from server...');
  const initialFetchedDefs = await fetchDefinitions(serverBaseUrl);

  if (initialFetchedDefs) {
    definitions = initialFetchedDefs;
    // saveDefinitions also calls updateDefinitionsMap indirectly if we modify saveDefinitions to call it
    // but it's safer to call it explicitly after definitions array is set.
    // However, saveDefinitions is called right after, and it updates lastSuccessfulUpdateTimestamp.
    // Let's ensure updateDefinitionsMap is called after definitions array is confirmed.
    await saveDefinitions(initialFetchedDefs); // This also sets lastSuccessfulUpdateTimestamp
    // saveDefinitions doesn't currently call updateDefinitionsMap, so we call it here.
    // Or, more consistently, call it after definitions array is assigned.
    updateDefinitionsMap();
    logger.info('[DefinitionsService] Definitions initialized from server and saved locally.');
  } else {
    logger.warn('[DefinitionsService] Initial fetch failed. Attempting to load from local cache...');
    const localData = await loadDefinitions();
    if (localData) {
      definitions = localData.definitions;
      updateDefinitionsMap(); // Update map after loading from cache
      lastSuccessfulUpdateTimestamp = new Date(localData.lastUpdated);
      definitionsLoadedLocally = true;
      logger.info(`[DefinitionsService] Definitions initialized from local cache. Last updated: ${localData.lastUpdated}`);
    } else {
      logger.error('[DefinitionsService] Failed to load definitions from local cache. Operating with no definitions.');
      definitions = []; // Ensure definitions is an empty array if all fails
      updateDefinitionsMap(); // Reflect empty definitions in map
      lastSuccessfulUpdateTimestamp = null;
    }
  }

  // 2. Check for weekly update if definitions were loaded from cache or if a timestamp exists
  if (lastSuccessfulUpdateTimestamp) {
    const now = new Date();
    const timeSinceLastUpdate = now.getTime() - lastSuccessfulUpdateTimestamp.getTime();

    if (timeSinceLastUpdate > ONE_WEEK_IN_MS) {
      logger.info(`[DefinitionsService] Last update was on ${lastSuccessfulUpdateTimestamp.toISOString()}, more than a week ago. Attempting background update.`);
      // Perform update in background, don't block initialization.
      // If this fails, we'll stick with what we have (either from initial fetch or local cache).
      updateAndSaveDefinitions(serverBaseUrl).then(updated => {
        if (updated) {
          logger.info('[DefinitionsService] Background weekly update successful.');
        } else {
          logger.warn('[DefinitionsService] Background weekly update failed. Continuing with current definitions.');
        }
      });
    } else {
      logger.info(`[DefinitionsService] Last update was on ${lastSuccessfulUpdateTimestamp.toISOString()}, within the last week. No background update needed now.`);
    }
  } else if (definitionsLoadedLocally) {
    // This case handles if local definitions were loaded but had no valid timestamp (e.g. old format or corruption)
    logger.warn('[DefinitionsService] Definitions loaded from local cache, but no valid last update timestamp found. Attempting background update to ensure freshness.');
    updateAndSaveDefinitions(serverBaseUrl).then(updated => {
        if (updated) {
          logger.info('[DefinitionsService] Background update (due to missing timestamp) successful.');
        } else {
          logger.warn('[DefinitionsService] Background update (due to missing timestamp) failed. Continuing with current definitions.');
        }
      });
  }

  // Note: A more robust periodic check while the app is running could be added here
  // using setInterval, but the request focuses on launch + weekly check.
  // For example:
  // setInterval(() => {
  //   logger.info('[DefinitionsService] Performing periodic weekly check...');
  //   if (lastSuccessfulUpdateTimestamp) {
  //     const now = new Date();
  //     if (now.getTime() - lastSuccessfulUpdateTimestamp.getTime() > ONE_WEEK_IN_MS) {
  //       updateAndSaveDefinitions(serverBaseUrl);
  //     }
  //   } else { // If no timestamp, try to update
  //      updateAndSaveDefinitions(serverBaseUrl);
  //   }
  // }, ONE_WEEK_IN_MS); // Check once a week
}

/**
 * Gets the currently loaded definitions.
 * @returns An array of entity definitions.
 */
export function getDefinitions(): EntityDefinition[] {
  return definitions;
}

/**
 * Gets a specific entity definition by its ID.
 * @param entityId The ID of the entity to look up.
 * @returns The entity definition if found, otherwise undefined.
 */
export function getDefinitionById(entityId: string): EntityDefinition | undefined {
  return definitionsMap.get(entityId);
}

/**
 * Gets the readable name of an entity by its ID.
 * @param entityId The ID of the entity.
 * @returns The readable name if found, otherwise the original ID.
 */
export function getEntityName(entityId: string): string {
    const definition = definitionsMap.get(entityId);
    return definition ? definition.name : entityId;
}


// Example of how to get the server base URL, this might come from a config file or settings
// For now, this is a placeholder.
// import { getServerConfig } from './server-config'; // Assuming a module to get server config
// (async () => {
//   const config = await getServerConfig();
//   if (config && config.serverAddress && config.serverPort) {
//     const baseUrl = `http://${config.serverAddress}:${config.serverPort}`;
//     await initializeDefinitions(baseUrl);
//   } else {
//     logger.error('[DefinitionsService] Server configuration not found. Cannot initialize definitions.');
//   }
// })();