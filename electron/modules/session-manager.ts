import fs from 'node:fs/promises';
import { store, getSessions, setSessions, getCurrentLogPath } from './config-manager';
import { SessionInfo } from '../../shared/types';
import * as logger from './logger'; // Import the logger utility

const MODULE_NAME = 'SessionManager'; // Define module name for logger

// --- Module State ---

let currentSessionInternal: {
    id: string;
    startTime: Date;
} | null = null;

const MAX_SESSIONS_TO_STORE = 100;

// --- Functions ---

export function startNewSession() {
    // End the current session if one exists unexpectedly
    if (currentSessionInternal) {
        logger.warn(MODULE_NAME, "Starting new session while another was active. Ending previous one.");
        // Note: We don't await endCurrentSession here to avoid potential async issues during rapid restarts
        endCurrentSession();
    }

    // Generate a GUID-like ID
    const sessionId = `session_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    const startTime = new Date();

    currentSessionInternal = {
        id: sessionId,
        startTime: startTime,
    };

    logger.info(MODULE_NAME, `Started new session tracking: ${sessionId} at ${startTime.toISOString()}`);
}

export async function endCurrentSession() {
    if (!currentSessionInternal) {
        // logger.debug(MODULE_NAME, "No active session to end.");
        return;
    }

    const sessionToEnd = { ...currentSessionInternal }; // Copy data before clearing
    currentSessionInternal = null; // Clear immediately to prevent race conditions

    const logPath = getCurrentLogPath();
    let logSize = 0;

    try {
        // Get the current log size only if a path is configured
        if (logPath) {
            const stats = await fs.stat(logPath);
            logSize = stats.size;
        } else {
            logger.warn(MODULE_NAME, "Cannot get log size: Log path not configured.");
        }
    } catch (error: any) {
        // Log error but continue ending the session
        if (error.code === 'ENOENT') {
             logger.warn(MODULE_NAME, `Log file not found at ${logPath} when ending session ${sessionToEnd.id}. Size set to 0.`);
        } else {
             logger.error(MODULE_NAME, `Error getting log file size for session ${sessionToEnd.id}:`, error.message);
        }
        logSize = 0; // Default to 0 on error
    }

    // Create the session info record
    const sessionInfo: SessionInfo = {
        id: sessionToEnd.id,
        startTime: sessionToEnd.startTime.toISOString(),
        endTime: new Date().toISOString(), // Use current time as end time
        logSize: logSize
    };

    // Get existing sessions from store
    const sessions: SessionInfo[] = getSessions() || [];

    // Add the new session to the beginning
    sessions.unshift(sessionInfo);

    // Keep only the last N sessions
    if (sessions.length > MAX_SESSIONS_TO_STORE) {
        sessions.splice(MAX_SESSIONS_TO_STORE);
    }

    // Save back to store
    setSessions(sessions);

    logger.info(MODULE_NAME, `Ended session ${sessionInfo.id}. Start: ${sessionInfo.startTime}, End: ${sessionInfo.endTime}, Size: ${logSize}. Total stored: ${sessions.length}`);
}

export function getCurrentSessionId(): string | null {
    return currentSessionInternal?.id || null;
}

// Function to retrieve session history (used by IPC handler)
export function getSessionHistory(limit = MAX_SESSIONS_TO_STORE): SessionInfo[] {
    const sessions = getSessions() || [];
    return sessions.slice(0, limit);
}

// Function to clear all stored sessions (used by IPC handler)
export function clearSessionHistory(): void {
    setSessions([]);
    logger.info(MODULE_NAME, "Cleared all stored session history.");
}