import { EventEmitter } from 'events';
import type { KillEvent } from '../../shared/types';
import { getEventDatabase, type EventDatabase, type EventQuery, type EventSearchResult } from './event-database';
import { getMainWindow } from './window-manager';
import { getCurrentUsername } from './log-parser';
import * as logger from './logger';

const MODULE_NAME = 'EventStore';

// Events emitted by the store
export interface EventStoreEvents {
  'events-updated': (events: KillEvent[]) => void;
  'event-added': (event: KillEvent) => void;
  'event-updated': (event: KillEvent) => void;
  'search-results': (results: EventSearchResult) => void;
  'stats-updated': (stats: EventStoreStats) => void;
}

export interface EventStoreStats {
  memoryEvents: number;
  databaseEvents: number;
  playerEvents: number;
  sources: Record<string, number>;
  oldestEvent: Date | null;
  newestEvent: Date | null;
}

export interface LoadMoreResult {
  events: KillEvent[];
  hasMore: boolean;
  totalLoaded: number;
}

/**
 * EventStore manages a multi-tier event storage system:
 * - Memory Cache: 25-50 most recent events for instant access
 * - Local Database: Up to 1000 events persisted locally
 * - Server API: Unlimited events from server (future implementation)
 */
export class EventStore extends EventEmitter {
  private database: EventDatabase;
  private memoryCache: KillEvent[] = [];
  private isInitialized = false;
  private readonly MAX_MEMORY_EVENTS = 25;
  
  // Pagination state
  private currentOffset = 0;
  private lastQuery: EventQuery = {};
  private isLoadingMore = false;
  
  // Deduplication tracking
  private recentEventIds = new Set<string>();
  private readonly MAX_RECENT_IDS = 100;

  constructor() {
    super();
    this.database = getEventDatabase();
  }

  /**
   * Initialize the event store
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    try {
      logger.info(MODULE_NAME, 'Initializing EventStore...');

      // Initialize database
      logger.debug(MODULE_NAME, 'Initializing EventDatabase...');
      await this.database.initialize();
      logger.debug(MODULE_NAME, 'EventDatabase initialized successfully');

      // Load initial events into memory cache
      logger.debug(MODULE_NAME, 'Loading initial events into memory cache...');
      await this.loadInitialEvents();
      logger.debug(MODULE_NAME, `Loaded ${this.memoryCache.length} events into memory cache`);

      this.isInitialized = true;
      logger.info(MODULE_NAME, 'EventStore initialized successfully');

      // Emit initial events to UI
      this.emit('events-updated', this.memoryCache);
      this.emitStats();
    } catch (error) {
      logger.error(MODULE_NAME, 'Failed to initialize EventStore:', error);
      logger.error(MODULE_NAME, 'Error details:', {
        message: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        isInitialized: this.isInitialized,
        databaseInitialized: this.database ? 'instance exists' : 'no instance'
      });
      throw error;
    }
  }

  /**
   * Add a new event to the store with intelligent deduplication
   */
  async addEvent(event: KillEvent, source: 'local' | 'server' | 'merged' = 'local'): Promise<{ isNew: boolean; event: KillEvent }> {
    if (!this.isInitialized) {
      throw new Error('EventStore not initialized');
    }

    try {
      logger.debug(MODULE_NAME, `Adding event: ${event.id} (source: ${source})`);

      // Check for exact ID match in memory first
      let existingIndex = this.memoryCache.findIndex(e => e.id === event.id);
      let targetEvent = event;
      let isNew = true;

      if (existingIndex !== -1) {
        // Exact ID match in memory
        isNew = false;
        const existingEvent = this.memoryCache[existingIndex];
        targetEvent = this.mergeEvents(existingEvent, event);
        this.memoryCache[existingIndex] = targetEvent;
        logger.debug(MODULE_NAME, `Updated existing event in memory: ${event.id}`);
      } else {
        // Check for content-based duplicates in database
        const similarEvent = this.database.findSimilarEvent(event);
        
        if (similarEvent) {
          // Content-based duplicate found
          isNew = false;
          targetEvent = this.mergeEvents(similarEvent, event);
          logger.info(MODULE_NAME, `Merged similar event: ${event.id} with ${similarEvent.id}`);
          
          // Update memory cache if the similar event is in it
          existingIndex = this.memoryCache.findIndex(e => e.id === similarEvent.id);
          if (existingIndex !== -1) {
            this.memoryCache[existingIndex] = targetEvent;
          } else {
            // Add merged event to memory cache
            this.addToMemoryCache(targetEvent);
          }
        } else {
          // Truly new event
          this.addToMemoryCache(targetEvent);
          logger.debug(MODULE_NAME, `Added new event to memory: ${event.id}`);
        }
      }

      // Recalculate player involvement
      const currentUsername = getCurrentUsername();
      targetEvent.isPlayerInvolved = targetEvent.killers.includes(currentUsername || '') || 
                                    targetEvent.victims.includes(currentUsername || '');

      // Save to database
      this.database.insertEvent(targetEvent, source);

      // Track recent IDs for fast duplicate detection
      this.recentEventIds.add(targetEvent.id);
      if (this.recentEventIds.size > this.MAX_RECENT_IDS) {
        // Keep only recent IDs (simple FIFO cleanup)
        const idsArray = Array.from(this.recentEventIds);
        this.recentEventIds.clear();
        idsArray.slice(-this.MAX_RECENT_IDS).forEach(id => this.recentEventIds.add(id));
      }

      // Emit events
      if (isNew) {
        this.emit('event-added', targetEvent);
      } else {
        this.emit('event-updated', targetEvent);
      }
      this.emit('events-updated', this.memoryCache);
      this.emitStats();

      // Send to renderer
      this.sendEventToRenderer(targetEvent, source);

      return { isNew, event: targetEvent };
    } catch (error) {
      logger.error(MODULE_NAME, `Failed to add event ${event.id}:`, error);
      return { isNew: true, event };
    }
  }

  /**
   * Get events with pagination support
   */
  async getEvents(query: EventQuery = {}): Promise<EventSearchResult> {
    if (!this.isInitialized) {
      throw new Error('EventStore not initialized');
    }

    try {
      const { limit = 25, offset = 0 } = query;

      // If requesting from the beginning and no special filters, use memory cache
      if (offset === 0 && !query.searchQuery && !query.playerOnly && !query.startDate && !query.endDate) {
        const events = this.memoryCache.slice(0, limit);
        const hasMore = this.memoryCache.length > limit || this.database.getEventCount() > this.memoryCache.length;
        
        return {
          events,
          total: this.database.getEventCount(),
          hasMore
        };
      }

      // Use database for filtered queries or pagination beyond memory cache
      return this.database.getEvents(query);
    } catch (error) {
      logger.error(MODULE_NAME, 'Failed to get events:', error);
      return { events: [], total: 0, hasMore: false };
    }
  }

  /**
   * Load more events for infinite scroll
   */
  async loadMoreEvents(query: EventQuery = {}): Promise<LoadMoreResult> {
    if (!this.isInitialized || this.isLoadingMore) {
      return { events: [], hasMore: false, totalLoaded: this.memoryCache.length };
    }

    try {
      this.isLoadingMore = true;
      logger.debug(MODULE_NAME, 'Loading more events...');

      // Calculate offset based on current memory cache and query
      const baseOffset = this.memoryCache.length;
      const offset = query.offset ? query.offset + baseOffset : baseOffset;
      
      const loadQuery: EventQuery = {
        ...query,
        offset,
        limit: query.limit || 25
      };

      const result = await this.database.getEvents(loadQuery);
      
      // Add to memory cache if loading recent events
      if (!query.searchQuery && !query.playerOnly && !query.startDate && !query.endDate) {
        result.events.forEach(event => {
          if (!this.memoryCache.find(e => e.id === event.id)) {
            this.memoryCache.push(event);
          }
        });
        
        // Trim memory cache if it gets too large
        if (this.memoryCache.length > this.MAX_MEMORY_EVENTS * 2) {
          this.memoryCache = this.memoryCache.slice(0, this.MAX_MEMORY_EVENTS);
        }
      }

      this.emit('events-updated', this.memoryCache);

      return {
        events: result.events,
        hasMore: result.hasMore,
        totalLoaded: this.memoryCache.length + result.events.length
      };
    } catch (error) {
      logger.error(MODULE_NAME, 'Failed to load more events:', error);
      return { events: [], hasMore: false, totalLoaded: this.memoryCache.length };
    } finally {
      this.isLoadingMore = false;
    }
  }

  /**
   * Search events using full-text search
   */
  async searchEvents(searchQuery: string, limit = 25, offset = 0): Promise<EventSearchResult> {
    if (!this.isInitialized) {
      throw new Error('EventStore not initialized');
    }

    try {
      logger.debug(MODULE_NAME, `Searching events: "${searchQuery}"`);
      
      const result = await this.database.searchEvents(searchQuery, limit, offset);
      
      this.emit('search-results', result);
      
      return result;
    } catch (error) {
      logger.error(MODULE_NAME, 'Failed to search events:', error);
      return { events: [], total: 0, hasMore: false };
    }
  }

  /**
   * Get an event by ID
   */
  getEventById(id: string): KillEvent | null {
    if (!this.isInitialized) {
      return null;
    }

    // Check memory cache first
    const memoryEvent = this.memoryCache.find(e => e.id === id);
    if (memoryEvent) {
      return memoryEvent;
    }

    // Fall back to database
    return this.database.getEventById(id);
  }

  /**
   * Get current memory cache events (for immediate UI access)
   */
  getMemoryEvents(): KillEvent[] {
    return [...this.memoryCache];
  }

  /**
   * Get store statistics
   */
  getStats(): EventStoreStats {
    if (!this.isInitialized) {
      return {
        memoryEvents: 0,
        databaseEvents: 0,
        playerEvents: 0,
        sources: {},
        oldestEvent: null,
        newestEvent: null
      };
    }

    const dbStats = this.database.getStats();
    
    return {
      memoryEvents: this.memoryCache.length,
      databaseEvents: dbStats.totalEvents,
      playerEvents: dbStats.playerEvents,
      sources: dbStats.sources,
      oldestEvent: dbStats.oldestEvent,
      newestEvent: dbStats.newestEvent
    };
  }

  /**
   * Clear all events from store and database
   */
  async clearAllEvents(): Promise<void> {
    if (!this.isInitialized) {
      throw new Error('EventStore not initialized');
    }

    try {
      logger.info(MODULE_NAME, 'Clearing all events...');
      
      // Clear memory cache
      this.memoryCache = [];
      this.recentEventIds.clear();
      this.currentOffset = 0;
      
      // Clear database
      this.database.clearAllEvents();
      
      // Emit updates
      this.emit('events-updated', this.memoryCache);
      this.emitStats();
      
      // Send to renderer
      const win = getMainWindow();
      win?.webContents.send('kill-feed-event', null);
      
      logger.info(MODULE_NAME, 'All events cleared');
    } catch (error) {
      logger.error(MODULE_NAME, 'Failed to clear events:', error);
      throw error;
    }
  }

  /**
   * Close the event store
   */
  close(): void {
    if (this.database) {
      this.database.close();
    }
    this.removeAllListeners();
    logger.info(MODULE_NAME, 'EventStore closed');
  }

  /**
   * Load initial events from database into memory cache
   */
  private async loadInitialEvents(): Promise<void> {
    try {
      const result = await this.database.getEvents({ limit: this.MAX_MEMORY_EVENTS });
      this.memoryCache = result.events;
      
      // Populate recent IDs for duplicate detection
      this.recentEventIds.clear();
      this.memoryCache.forEach(event => this.recentEventIds.add(event.id));
      
      logger.info(MODULE_NAME, `Loaded ${this.memoryCache.length} events into memory cache`);
    } catch (error) {
      logger.error(MODULE_NAME, 'Failed to load initial events:', error);
      this.memoryCache = [];
    }
  }

  /**
   * Add event to memory cache with size management
   */
  private addToMemoryCache(event: KillEvent): void {
    // Add to beginning (most recent first)
    this.memoryCache.unshift(event);
    
    // Trim if exceeds max size
    if (this.memoryCache.length > this.MAX_MEMORY_EVENTS) {
      this.memoryCache = this.memoryCache.slice(0, this.MAX_MEMORY_EVENTS);
    }
  }

  /**
   * Intelligently merge two similar events
   */
  private mergeEvents(existingEvent: KillEvent, newEvent: KillEvent): KillEvent {
    logger.debug(MODULE_NAME, `Merging events: ${existingEvent.id} + ${newEvent.id}`);

    // Determine priority: server > local with more data > older
    const existingHasServerSource = existingEvent.metadata?.source?.server;
    const newHasServerSource = newEvent.metadata?.source?.server;
    
    let primaryEvent: KillEvent;
    let secondaryEvent: KillEvent;
    
    if (newHasServerSource && !existingHasServerSource) {
      primaryEvent = newEvent;
      secondaryEvent = existingEvent;
    } else if (existingHasServerSource && !newHasServerSource) {
      primaryEvent = existingEvent;
      secondaryEvent = newEvent;
    } else {
      // Same source type, prefer more complete data
      const existingCompleteness = this.calculateEventCompleteness(existingEvent);
      const newCompleteness = this.calculateEventCompleteness(newEvent);
      
      if (newCompleteness > existingCompleteness) {
        primaryEvent = newEvent;
        secondaryEvent = existingEvent;
      } else {
        primaryEvent = existingEvent;
        secondaryEvent = newEvent;
      }
    }

    // Create merged event
    const mergedEvent: KillEvent = {
      ...primaryEvent,
      
      // Merge participant lists (deduplicate)
      killers: [...new Set([...primaryEvent.killers, ...secondaryEvent.killers])],
      victims: [...new Set([...primaryEvent.victims, ...secondaryEvent.victims])],
      
      // Take most specific values
      vehicleType: primaryEvent.vehicleType || secondaryEvent.vehicleType,
      vehicleModel: primaryEvent.vehicleModel || secondaryEvent.vehicleModel,
      location: primaryEvent.location || secondaryEvent.location,
      weapon: primaryEvent.weapon || secondaryEvent.weapon,
      
      // Merge metadata
      metadata: {
        ...primaryEvent.metadata,
        source: {
          server: (primaryEvent.metadata?.source?.server || secondaryEvent.metadata?.source?.server) || false,
          local: (primaryEvent.metadata?.source?.local || secondaryEvent.metadata?.source?.local) || false,
          external: (primaryEvent.metadata?.source?.external || secondaryEvent.metadata?.source?.external) || false,
        },
        mergedFrom: [
          ...(primaryEvent.metadata?.mergedFrom || []),
          ...(secondaryEvent.metadata?.mergedFrom || []),
          secondaryEvent.id
        ].filter((id, index, arr) => arr.indexOf(id) === index)
      }
    };

    return mergedEvent;
  }

  /**
   * Calculate event completeness score for merge prioritization
   */
  private calculateEventCompleteness(event: KillEvent): number {
    let score = 0;
    
    if (event.id) score += 1;
    if (event.timestamp) score += 1;
    if (event.killers?.length) score += 1;
    if (event.victims?.length) score += 1;
    if (event.location) score += 2;
    if (event.weapon) score += 2;
    if (event.vehicleModel && event.vehicleModel !== 'Player') score += 2;
    if (event.coordinates) score += 2;
    if (event.victimRsiRecord && event.victimRsiRecord !== '-') score += 3;
    if (event.attackerRsiRecord && event.attackerRsiRecord !== '-') score += 3;
    
    return score;
  }

  /**
   * Send event to renderer via IPC
   */
  private sendEventToRenderer(event: KillEvent, source: 'local' | 'server' | 'merged'): void {
    const win = getMainWindow();
    if (win) {
      win.webContents.send('kill-feed-event', {
        event,
        source
      });
    }
  }

  /**
   * Emit store statistics
   */
  private emitStats(): void {
    const stats = this.getStats();
    this.emit('stats-updated', stats);
  }
}

// Singleton instance
let eventStore: EventStore | null = null;

/**
 * Get the singleton EventStore instance
 */
export function getEventStore(): EventStore {
  if (!eventStore) {
    eventStore = new EventStore();
  }
  return eventStore;
}

/**
 * Initialize the event store
 */
export async function initializeEventStore(): Promise<EventStore> {
  const store = getEventStore();
  await store.initialize();
  return store;
}