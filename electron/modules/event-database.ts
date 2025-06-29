import Database from 'better-sqlite3';
import { app } from 'electron';
import path from 'path';
import fs from 'fs';
import type { KillEvent } from '../../shared/types';
import * as logger from './logger';

const MODULE_NAME = 'EventDatabase';

// Database schema version for migrations
const DB_VERSION = 1;

// Interface for database operations
export interface EventQuery {
  limit?: number;
  offset?: number;
  playerOnly?: boolean;
  searchQuery?: string;
  startDate?: Date;
  endDate?: Date;
  source?: 'local' | 'server' | 'merged' | 'both';
}

export interface EventSearchResult {
  events: KillEvent[];
  total: number;
  hasMore: boolean;
}

// Interface for raw database row
interface EventRow {
  id: string;
  timestamp: number;
  event_data: string;
  is_player_involved: number;
  source: string;
  created_at: number;
  fingerprint: string;
}

/**
 * EventDatabase handles persistent storage of events using SQLite with full-text search.
 * Supports up to 1000 local events with automatic cleanup.
 */
export class EventDatabase {
  private db: Database.Database;
  private dbPath: string;
  private isInitialized = false;

  // Prepared statements for performance
  private insertEventStmt!: Database.Statement;
  private updateEventStmt!: Database.Statement;
  private getEventByIdStmt!: Database.Statement;
  private getEventsStmt!: Database.Statement;
  private getPlayerEventsStmt!: Database.Statement;
  private searchEventsStmt!: Database.Statement;
  private deleteOldEventsStmt!: Database.Statement;
  private getEventCountStmt!: Database.Statement;
  private deleteEventByIdStmt!: Database.Statement;

  private readonly MAX_LOCAL_EVENTS = 1000;

  constructor() {
    // Create database in app's userData directory
    const userDataPath = app.getPath('userData');
    const dbDir = path.join(userDataPath, 'data');
    
    // Ensure directory exists
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }

    this.dbPath = path.join(dbDir, 'events.db');
    logger.path(MODULE_NAME, 'SQLite Database Location', this.dbPath);

    // Initialize database connection
    this.db = new Database(this.dbPath);
    logger.database(MODULE_NAME, 'SQLite database connection established');
    this.db.pragma('journal_mode = WAL'); // Enable WAL mode for better performance
    this.db.pragma('synchronous = NORMAL'); // Balance between safety and speed
    this.db.pragma('cache_size = 10000'); // Increase cache size
    this.db.pragma('temp_store = MEMORY'); // Store temporary tables in memory
  }

  /**
   * Initialize database with schema and prepared statements
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    try {
      logger.database(MODULE_NAME, 'Initializing SQLite database with FTS5 search capabilities...');

      // Check and perform migrations if needed
      logger.debug(MODULE_NAME, 'Starting database migration check...');
      await this.checkAndMigrate();
      logger.debug(MODULE_NAME, 'Database migration check completed');

      // Create schema if not exists
      logger.debug(MODULE_NAME, 'Creating/verifying database schema...');
      this.createSchema();
      logger.database(MODULE_NAME, 'Database schema created/verified successfully');

      // Prepare statements for better performance
      logger.debug(MODULE_NAME, 'Preparing SQL statements...');
      this.prepareStatements();
      logger.debug(MODULE_NAME, 'SQL statements prepared successfully');

      // Perform maintenance
      logger.debug(MODULE_NAME, 'Performing database maintenance...');
      this.performMaintenance();
      logger.debug(MODULE_NAME, 'Database maintenance completed');

      this.isInitialized = true;
      logger.success(MODULE_NAME, 'EventDatabase initialized successfully with FTS5 search');
    } catch (error) {
      logger.error(MODULE_NAME, 'Failed to initialize database:', error);
      logger.error(MODULE_NAME, 'Error details:', {
        message: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        dbPath: this.dbPath
      });
      throw error;
    }
  }

  /**
   * Create database schema with indexes and FTS
   */
  private createSchema(): void {
    logger.debug(MODULE_NAME, 'Creating database schema...');

    // Main events table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        timestamp INTEGER NOT NULL,
        event_data TEXT NOT NULL,
        is_player_involved INTEGER NOT NULL,
        source TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        fingerprint TEXT NOT NULL
      );
    `);

    // Create indexes for performance
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_events_player ON events(is_player_involved, timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_events_source ON events(source, timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_events_fingerprint ON events(fingerprint);
      CREATE INDEX IF NOT EXISTS idx_events_created_at ON events(created_at DESC);
    `);

    // Full-text search virtual table
    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS events_fts USING fts5(
        id UNINDEXED,
        content,
        content=events,
        content_rowid=rowid
      );
    `);

    // Triggers to keep FTS table in sync
    this.db.exec(`
      CREATE TRIGGER IF NOT EXISTS events_fts_insert AFTER INSERT ON events
      BEGIN
        INSERT INTO events_fts(rowid, content) VALUES (new.rowid, 
          new.event_data || ' ' || 
          CASE WHEN json_extract(new.event_data, '$.killers') IS NOT NULL 
               THEN json_extract(new.event_data, '$.killers') 
               ELSE '' END || ' ' ||
          CASE WHEN json_extract(new.event_data, '$.victims') IS NOT NULL 
               THEN json_extract(new.event_data, '$.victims') 
               ELSE '' END || ' ' ||
          CASE WHEN json_extract(new.event_data, '$.eventDescription') IS NOT NULL 
               THEN json_extract(new.event_data, '$.eventDescription') 
               ELSE '' END || ' ' ||
          CASE WHEN json_extract(new.event_data, '$.location') IS NOT NULL 
               THEN json_extract(new.event_data, '$.location') 
               ELSE '' END || ' ' ||
          CASE WHEN json_extract(new.event_data, '$.weapon') IS NOT NULL 
               THEN json_extract(new.event_data, '$.weapon') 
               ELSE '' END
        );
      END;
    `);

    this.db.exec(`
      CREATE TRIGGER IF NOT EXISTS events_fts_delete AFTER DELETE ON events
      BEGIN
        DELETE FROM events_fts WHERE rowid = old.rowid;
      END;
    `);

    this.db.exec(`
      CREATE TRIGGER IF NOT EXISTS events_fts_update AFTER UPDATE ON events
      BEGIN
        UPDATE events_fts SET content = 
          new.event_data || ' ' || 
          CASE WHEN json_extract(new.event_data, '$.killers') IS NOT NULL 
               THEN json_extract(new.event_data, '$.killers') 
               ELSE '' END || ' ' ||
          CASE WHEN json_extract(new.event_data, '$.victims') IS NOT NULL 
               THEN json_extract(new.event_data, '$.victims') 
               ELSE '' END || ' ' ||
          CASE WHEN json_extract(new.event_data, '$.eventDescription') IS NOT NULL 
               THEN json_extract(new.event_data, '$.eventDescription') 
               ELSE '' END || ' ' ||
          CASE WHEN json_extract(new.event_data, '$.location') IS NOT NULL 
               THEN json_extract(new.event_data, '$.location') 
               ELSE '' END || ' ' ||
          CASE WHEN json_extract(new.event_data, '$.weapon') IS NOT NULL 
               THEN json_extract(new.event_data, '$.weapon') 
               ELSE '' END
        WHERE rowid = new.rowid;
      END;
    `);

    // Version table for migrations
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS db_version (
        version INTEGER PRIMARY KEY,
        applied_at INTEGER NOT NULL
      );
    `);

    logger.debug(MODULE_NAME, 'Schema created successfully');
  }

  /**
   * Prepare SQL statements for better performance
   */
  private prepareStatements(): void {
    logger.debug(MODULE_NAME, 'Preparing SQL statements...');

    this.insertEventStmt = this.db.prepare(`
      INSERT OR REPLACE INTO events (id, timestamp, event_data, is_player_involved, source, created_at, fingerprint)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    this.updateEventStmt = this.db.prepare(`
      UPDATE events 
      SET event_data = ?, is_player_involved = ?, source = ?, fingerprint = ?
      WHERE id = ?
    `);

    this.getEventByIdStmt = this.db.prepare(`
      SELECT * FROM events WHERE id = ?
    `);

    this.getEventsStmt = this.db.prepare(`
      SELECT * FROM events 
      ORDER BY timestamp DESC 
      LIMIT ? OFFSET ?
    `);

    this.getPlayerEventsStmt = this.db.prepare(`
      SELECT * FROM events 
      WHERE is_player_involved = 1 
      ORDER BY timestamp DESC 
      LIMIT ? OFFSET ?
    `);

    this.searchEventsStmt = this.db.prepare(`
      SELECT events.* FROM events
      JOIN events_fts ON events.rowid = events_fts.rowid
      WHERE events_fts MATCH ?
      ORDER BY timestamp DESC
      LIMIT ? OFFSET ?
    `);

    this.deleteOldEventsStmt = this.db.prepare(`
      DELETE FROM events 
      WHERE rowid NOT IN (
        SELECT rowid FROM events 
        ORDER BY timestamp DESC 
        LIMIT ?
      )
    `);

    this.getEventCountStmt = this.db.prepare(`
      SELECT COUNT(*) as count FROM events
    `);

    this.deleteEventByIdStmt = this.db.prepare(`
      DELETE FROM events WHERE id = ?
    `);

    logger.debug(MODULE_NAME, 'SQL statements prepared successfully');
  }

  /**
   * Check database version and perform migrations if needed
   */
  private async checkAndMigrate(): Promise<void> {
    try {
      // Check current version
      const versionResult = this.db.prepare('SELECT version FROM db_version ORDER BY version DESC LIMIT 1').get() as { version: number } | undefined;
      const currentVersion = versionResult?.version || 0;

      if (currentVersion < DB_VERSION) {
        logger.info(MODULE_NAME, `Migrating database from version ${currentVersion} to ${DB_VERSION}`);
        
        // Perform migrations here if needed in the future
        // For now, we're at version 1 so no migrations needed
        
        // Update version
        this.db.prepare('INSERT OR REPLACE INTO db_version (version, applied_at) VALUES (?, ?)').run(DB_VERSION, Date.now());
        
        logger.info(MODULE_NAME, 'Database migration completed');
      }
    } catch (error) {
      logger.warn(MODULE_NAME, 'Version check failed, assuming new database:', error);
    }
  }

  /**
   * Perform database maintenance (vacuum, analyze, cleanup)
   */
  private performMaintenance(): void {
    try {
      // Clean up old events beyond max limit
      const count = this.getEventCount();
      if (count > this.MAX_LOCAL_EVENTS) {
        const deleted = this.deleteOldEventsStmt.run(this.MAX_LOCAL_EVENTS);
        logger.info(MODULE_NAME, `Cleaned up ${deleted.changes} old events (keeping ${this.MAX_LOCAL_EVENTS})`);
      }

      // Rebuild FTS index for better search performance
      this.db.exec('INSERT INTO events_fts(events_fts) VALUES("rebuild");');
      
      logger.debug(MODULE_NAME, 'Database maintenance completed');
    } catch (error) {
      logger.warn(MODULE_NAME, 'Database maintenance failed:', error);
    }
  }

  /**
   * Insert or update an event in the database
   */
  insertEvent(event: KillEvent, source: 'local' | 'server' | 'merged' | 'both' = 'local'): boolean {
    if (!this.isInitialized) {
      throw new Error('Database not initialized');
    }

    try {
      const now = Date.now();
      const timestamp = new Date(event.timestamp).getTime();
      const eventData = JSON.stringify(event);
      const isPlayerInvolved = event.isPlayerInvolved ? 1 : 0;
      
      // Create fingerprint for duplicate detection
      const fingerprint = this.createEventFingerprint(event);

      const result = this.insertEventStmt.run(
        event.id,
        timestamp,
        eventData,
        isPlayerInvolved,
        source,
        now,
        fingerprint
      );

      if (result.changes > 0) {
        logger.debug(MODULE_NAME, `Inserted event: ${event.id} (source: ${source})`);
        
        // Check if we need to clean up old events
        const count = this.getEventCount();
        if (count > this.MAX_LOCAL_EVENTS) {
          const deleted = this.deleteOldEventsStmt.run(this.MAX_LOCAL_EVENTS);
          logger.debug(MODULE_NAME, `Auto-cleanup: removed ${deleted.changes} old events`);
        }
        
        return true;
      }
      return false;
    } catch (error) {
      logger.error(MODULE_NAME, `Failed to insert event ${event.id}:`, error);
      return false;
    }
  }

  /**
   * Get an event by ID
   */
  getEventById(id: string): KillEvent | null {
    if (!this.isInitialized) {
      throw new Error('Database not initialized');
    }

    try {
      const row = this.getEventByIdStmt.get(id) as EventRow | undefined;
      if (row) {
        return this.parseEventRow(row);
      }
      return null;
    } catch (error) {
      logger.error(MODULE_NAME, `Failed to get event ${id}:`, error);
      return null;
    }
  }

  /**
   * Get events with pagination and filtering
   */
  getEvents(query: EventQuery = {}): EventSearchResult {
    if (!this.isInitialized) {
      throw new Error('Database not initialized');
    }

    try {
      const {
        limit = 25,
        offset = 0,
        playerOnly = false,
        searchQuery,
        startDate,
        endDate
      } = query;

      let rows: EventRow[] = [];
      let totalCount = 0;

      if (searchQuery) {
        // Full-text search
        const searchTerm = this.prepareSearchQuery(searchQuery);
        rows = this.searchEventsStmt.all(searchTerm, limit, offset) as EventRow[];
        
        // Get total count for search (approximate)
        const countResult = this.db.prepare(`
          SELECT COUNT(*) as count FROM events
          JOIN events_fts ON events.rowid = events_fts.rowid
          WHERE events_fts MATCH ?
        `).get(searchTerm) as { count: number };
        totalCount = countResult.count;
      } else if (playerOnly) {
        // Player-involved events only
        rows = this.getPlayerEventsStmt.all(limit, offset) as EventRow[];
        
        const countResult = this.db.prepare('SELECT COUNT(*) as count FROM events WHERE is_player_involved = 1').get() as { count: number };
        totalCount = countResult.count;
      } else {
        // All events
        rows = this.getEventsStmt.all(limit, offset) as EventRow[];
        totalCount = this.getEventCount();
      }

      const events = rows.map(row => this.parseEventRow(row));
      const hasMore = (offset + events.length) < totalCount;

      return {
        events,
        total: totalCount,
        hasMore
      };
    } catch (error) {
      logger.error(MODULE_NAME, 'Failed to get events:', error);
      return {
        events: [],
        total: 0,
        hasMore: false
      };
    }
  }

  /**
   * Search events using full-text search
   */
  searchEvents(searchQuery: string, limit = 25, offset = 0): EventSearchResult {
    return this.getEvents({ searchQuery, limit, offset });
  }

  /**
   * Get total event count
   */
  getEventCount(): number {
    if (!this.isInitialized) {
      return 0;
    }

    try {
      const result = this.getEventCountStmt.get() as { count: number };
      return result.count;
    } catch (error) {
      logger.error(MODULE_NAME, 'Failed to get event count:', error);
      return 0;
    }
  }

  /**
   * Delete an event by ID
   */
  deleteEvent(id: string): boolean {
    if (!this.isInitialized) {
      throw new Error('Database not initialized');
    }

    try {
      const result = this.deleteEventByIdStmt.run(id);
      if (result.changes > 0) {
        logger.debug(MODULE_NAME, `Deleted event: ${id}`);
        return true;
      }
      return false;
    } catch (error) {
      logger.error(MODULE_NAME, `Failed to delete event ${id}:`, error);
      return false;
    }
  }

  /**
   * Check if an event with the same fingerprint exists
   */
  findSimilarEvent(event: KillEvent): KillEvent | null {
    if (!this.isInitialized) {
      return null;
    }

    try {
      const fingerprint = this.createEventFingerprint(event);
      const timestamp = new Date(event.timestamp).getTime();
      
      // Look for events with same fingerprint within 10 second window
      const timeWindow = 10000; // 10 seconds
      const row = this.db.prepare(`
        SELECT * FROM events 
        WHERE fingerprint = ? 
        AND ABS(timestamp - ?) <= ?
        ORDER BY timestamp DESC 
        LIMIT 1
      `).get(fingerprint, timestamp, timeWindow) as EventRow | undefined;

      if (row) {
        return this.parseEventRow(row);
      }
      return null;
    } catch (error) {
      logger.error(MODULE_NAME, 'Failed to find similar event:', error);
      return null;
    }
  }

  /**
   * Get database statistics
   */
  getStats(): { totalEvents: number; playerEvents: number; sources: Record<string, number>; oldestEvent: Date | null; newestEvent: Date | null } {
    if (!this.isInitialized) {
      return {
        totalEvents: 0,
        playerEvents: 0,
        sources: {},
        oldestEvent: null,
        newestEvent: null
      };
    }

    try {
      const totalEvents = this.getEventCount();
      
      const playerResult = this.db.prepare('SELECT COUNT(*) as count FROM events WHERE is_player_involved = 1').get() as { count: number };
      const playerEvents = playerResult.count;

      const sourcesResult = this.db.prepare('SELECT source, COUNT(*) as count FROM events GROUP BY source').all() as { source: string; count: number }[];
      const sources: Record<string, number> = {};
      sourcesResult.forEach(row => {
        sources[row.source] = row.count;
      });

      const timestampResult = this.db.prepare('SELECT MIN(timestamp) as oldest, MAX(timestamp) as newest FROM events').get() as { oldest: number | null; newest: number | null };
      
      return {
        totalEvents,
        playerEvents,
        sources,
        oldestEvent: timestampResult.oldest ? new Date(timestampResult.oldest) : null,
        newestEvent: timestampResult.newest ? new Date(timestampResult.newest) : null
      };
    } catch (error) {
      logger.error(MODULE_NAME, 'Failed to get database stats:', error);
      return {
        totalEvents: 0,
        playerEvents: 0,
        sources: {},
        oldestEvent: null,
        newestEvent: null
      };
    }
  }

  /**
   * Clear all events from database
   */
  clearAllEvents(): boolean {
    if (!this.isInitialized) {
      throw new Error('Database not initialized');
    }

    try {
      this.db.exec('DELETE FROM events');
      this.db.exec('DELETE FROM events_fts');
      logger.info(MODULE_NAME, 'Cleared all events from database');
      return true;
    } catch (error) {
      logger.error(MODULE_NAME, 'Failed to clear events:', error);
      return false;
    }
  }

  /**
   * Close database connection
   */
  close(): void {
    if (this.db) {
      try {
        this.db.close();
        logger.info(MODULE_NAME, 'Database connection closed');
      } catch (error) {
        logger.error(MODULE_NAME, 'Failed to close database:', error);
      }
    }
  }

  /**
   * Create a content-based fingerprint for duplicate detection
   */
  private createEventFingerprint(event: KillEvent): string {
    const sortedKillers = [...(event.killers || [])].sort().join('|');
    const sortedVictims = [...(event.victims || [])].sort().join('|');
    const timestampMinute = Math.floor(new Date(event.timestamp).getTime() / 60000);
    const location = event.location || 'unknown';
    const vehicle = event.vehicleModel || event.vehicleType || 'unknown';
    
    return `${sortedKillers}:${sortedVictims}:${timestampMinute}:${location}:${vehicle}:${event.deathType}`;
  }

  /**
   * Prepare search query for FTS
   */
  private prepareSearchQuery(query: string): string {
    // Escape special FTS characters and add wildcards
    const escaped = query.replace(/[:"*]/g, '');
    const terms = escaped.split(/\s+/).filter(term => term.length > 0);
    
    if (terms.length === 0) {
      return '""'; // Empty search
    }
    
    // Add wildcards for partial matching
    return terms.map(term => `"${term}"*`).join(' OR ');
  }

  /**
   * Parse database row into KillEvent
   */
  private parseEventRow(row: EventRow): KillEvent {
    try {
      const event = JSON.parse(row.event_data) as KillEvent;
      
      // Ensure metadata exists and add database info
      if (!event.metadata) {
        event.metadata = {};
      }
      if (!event.metadata.source) {
        event.metadata.source = {
          server: row.source === 'server',
          local: row.source === 'local',
          external: row.source === 'server'
        };
      }
      
      return event;
    } catch (error) {
      logger.error(MODULE_NAME, `Failed to parse event data for ${row.id}:`, error);
      throw error;
    }
  }
}

// Singleton instance
let eventDatabase: EventDatabase | null = null;

/**
 * Get the singleton EventDatabase instance
 */
export function getEventDatabase(): EventDatabase {
  if (!eventDatabase) {
    eventDatabase = new EventDatabase();
  }
  return eventDatabase;
}

/**
 * Initialize the event database
 */
export async function initializeEventDatabase(): Promise<EventDatabase> {
  const db = getEventDatabase();
  await db.initialize();
  return db;
}