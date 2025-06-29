import { EventStore, getEventStore, initializeEventStore } from './event-store';
import * as logger from './logger';

const MODULE_NAME = 'EventStoreManager';

// Track initialization state
let initializationPromise: Promise<EventStore> | null = null;
let initializedStore: EventStore | null = null;

/**
 * Get or initialize the EventStore with proper singleton management
 */
export async function getOrInitializeEventStore(): Promise<EventStore> {
    // If already initialized, return the store
    if (initializedStore) {
        return initializedStore;
    }

    // If initialization is in progress, wait for it
    if (initializationPromise) {
        logger.debug(MODULE_NAME, 'EventStore initialization already in progress, waiting...');
        return initializationPromise;
    }

    // Start initialization
    logger.info(MODULE_NAME, 'Starting EventStore initialization...');
    initializationPromise = initializeEventStore()
        .then((store) => {
            initializedStore = store;
            logger.success(MODULE_NAME, 'EventStore initialization completed successfully');
            return store;
        })
        .catch((error) => {
            logger.error(MODULE_NAME, 'EventStore initialization failed:', error);
            initializationPromise = null; // Reset so it can be retried
            throw error;
        });

    return initializationPromise;
}

/**
 * Get the initialized EventStore or null if not initialized
 */
export function getInitializedEventStore(): EventStore | null {
    return initializedStore;
}

/**
 * Reset the EventStore (for testing or reinitialization)
 */
export function resetEventStore(): void {
    if (initializedStore) {
        initializedStore.close();
    }
    initializedStore = null;
    initializationPromise = null;
}