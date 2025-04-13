import fs from 'node:fs/promises';
import path from 'node:path';
import { getCsvLogPath } from './config-manager.ts'; // Added .ts
import { KillEvent } from '../../shared/types';
// import { LogMode } from './api-client.ts'; // Removed API client dependency
import { getMainWindow } from './window-manager.ts'; // Added .ts
import * as logger from './logger'; // Import the logger utility

const MODULE_NAME = 'CsvLogger'; // Define module name for logger

// --- Module State ---
let killTallyInternal = 0; // Internal tally, updated by loading function

// --- Constants ---
const CSV_HEADERS = [
    "KillTime", "EnemyPilot", "EnemyShip", "Enlisted", "RecordNumber",
    "OrgAffiliation", "Player", "Weapon", "Ship", "Method", "Mode", // Removed "Logged" header
    "GameVersion", "TrackRver", "Logged", "PFP"
];
const TRACKR_VERSION = "2.06"; // Hardcoded from original script

// --- Helper Functions ---

// Escapes a string for CSV, removing commas and handling quotes if needed (simple version)
function escapeCsvValue(value: string | number | undefined | null): string {
    if (value === undefined || value === null) {
        return '';
    }
    let str = String(value);
    // Simple approach: remove commas, consistent with original script
    str = str.replace(/,/g, '');
    // Proper CSV escaping (if needed later):
    // if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    //     str = `"${str.replace(/"/g, '""')}"`;
    // }
    return str;
}

// --- Public Functions ---

// Logs a single kill event to the configured CSV file
export async function logKillToCsv(killEvent: KillEvent) { // Removed logMode parameter
    // Validate parameters
    if (!killEvent || !killEvent.timestamp) {
        logger.error(MODULE_NAME, 'Invalid kill event passed - missing required properties');
        return;
    }
    // logMode logic removed

    const csvPath = getCsvLogPath();
    if (!csvPath) {
        logger.error(MODULE_NAME, 'CSV Log Path not configured. Skipping CSV logging.');
        return;
    }

    // Ensure directory exists (optional, but good practice)
    try {
        await fs.mkdir(path.dirname(csvPath), { recursive: true });
    } catch (mkdirError: any) {
        // Ignore EEXIST error (directory already exists), log others
        if (mkdirError.code !== 'EEXIST') {
             logger.error(MODULE_NAME, `Error creating directory for CSV log ${path.dirname(csvPath)}:`, mkdirError.message);
             // Decide whether to proceed or return
             // return;
        }
    }


    // Prepare data object matching CSV structure
    const killData = {
        KillTime: new Date(killEvent.timestamp).toUTCString().replace('GMT', 'UTC'), // Format similar to script
        EnemyPilot: killEvent.victims[0] || 'Unknown',
        EnemyShip: killEvent.vehicleType === 'Player' ? 'Player' : (killEvent.vehicleType || 'Unknown'),
        Enlisted: killEvent.victimEnlisted || '-',
        RecordNumber: killEvent.victimRsiRecord || '-',
        OrgAffiliation: killEvent.victimOrg || '-',
        Player: killEvent.killers.filter(k => k !== 'Environment')[0] || 'Unknown', // First non-env killer
        Weapon: killEvent.weapon || 'Unknown',
        Ship: killEvent.playerShip || 'Unknown',
        Method: killEvent.damageType || 'Unknown',
        Mode: killEvent.gameMode || 'Unknown',
        GameVersion: killEvent.gameVersion || '',
        TrackRver: TRACKR_VERSION,
        // Logged: logMode, // Removed Logged status
        PFP: killEvent.victimPfpUrl || ''
    };

    // Convert object to CSV string row
    const csvRow = CSV_HEADERS.map(header => escapeCsvValue((killData as any)[header])).join(',');

    try {
        // Check if file exists to determine if header is needed
        let fileExists = false;
        try {
            await fs.access(csvPath);
            fileExists = true;
        } catch {
            // File doesn't exist
        }

        if (!fileExists) {
            // Write header + first row
            await fs.writeFile(csvPath, CSV_HEADERS.join(',') + '\n' + csvRow + '\n', 'utf-8');
            logger.success(MODULE_NAME, `Created CSV log file and logged event: ${csvPath}`);
        } else {
            // Append row
            await fs.appendFile(csvPath, csvRow + '\n', 'utf-8');
            // logger.debug(MODULE_NAME, `Appended kill event to CSV: ${csvPath}`); // Can be noisy
        }
    } catch (error: any) {
        logger.error(MODULE_NAME, `Error writing to CSV log file ${csvPath}:`, error.message);
    }
}

// Loads the kill tally for the current month from the CSV file
export async function loadHistoricKillTally(): Promise<number> {
    const csvPath = getCsvLogPath();
    let currentMonthTally = 0;
    const currentMonth = new Date().getUTCMonth(); // Use UTC month
    const currentYear = new Date().getUTCFullYear(); // Use UTC year
    const win = getMainWindow();

    if (!csvPath) {
        logger.warn(MODULE_NAME, "Cannot load tally: CSV path not configured.");
        win?.webContents.send('log-status', `Kill Tally (Current Month): 0 (CSV path not set)`);
        killTallyInternal = 0;
        return 0;
    }

    try {
        await fs.access(csvPath); // Check if file exists
        logger.info(MODULE_NAME, `Reading historic kills from: ${csvPath}`);
        const csvContent = await fs.readFile(csvPath, 'utf-8');
        const lines = csvContent.split('\n').slice(1); // Skip header row

        // Find the index of the KillTime column (more robust than assuming first column)
        const headerLine = csvContent.substring(0, csvContent.indexOf('\n')).trim();
        const headers = headerLine.split(',');
        const killTimeIndex = headers.indexOf('KillTime');

        if (killTimeIndex === -1) {
             logger.error(MODULE_NAME, "Could not find 'KillTime' header in CSV. Cannot calculate tally.");
             win?.webContents.send('log-status', `Kill Tally (Current Month): Error (Bad CSV Header)`);
             killTallyInternal = 0;
             return 0;
        }


        for (const line of lines) {
            if (!line.trim()) continue; // Skip empty lines
            const values = line.split(','); // Simple split

            if (values.length > killTimeIndex) {
                const killTimeString = values[killTimeIndex];
                if (!killTimeString) continue;

                try {
                    // Attempt to parse the date string (e.g., "Sun, 31 Mar 2024 21:22:07 UTC")
                    const killDate = new Date(killTimeString);
                    if (!isNaN(killDate.getTime())) { // Check if date is valid
                        if (killDate.getUTCFullYear() === currentYear && killDate.getUTCMonth() === currentMonth) {
                            currentMonthTally++;
                        }
                    } else {
                        logger.warn(MODULE_NAME, `Could not parse date from CSV row: ${killTimeString}`);
                    }
                } catch (dateError: any) {
                    logger.warn(MODULE_NAME, `Error parsing date "${killTimeString}" from CSV:`, dateError.message);
                }
            } else {
                 logger.warn(MODULE_NAME, `Malformed CSV line skipped: ${line}`);
            }
        }

        killTallyInternal = currentMonthTally;
        logger.info(MODULE_NAME, `Historic Kill Tally (Current Month): ${killTallyInternal}`);
        win?.webContents.send('log-status', `Loaded historic kill tally (Current Month): ${killTallyInternal}`);

    } catch (error: any) {
        if (error.code === 'ENOENT') {
            logger.info(MODULE_NAME, `CSV log file not found at ${csvPath}. Starting tally at 0.`);
            killTallyInternal = 0; // Ensure tally is 0 if file doesn't exist
        } else {
            logger.error(MODULE_NAME, `Error reading historic kill tally from ${csvPath}:`, error.message);
            killTallyInternal = 0; // Reset tally on other errors
        }
        win?.webContents.send('log-status', `Kill Tally (Current Month): ${killTallyInternal}`);
    }
    return killTallyInternal;
}

// Getter for the internally tracked tally (if needed elsewhere)
export function getCurrentKillTally(): number {
    return killTallyInternal;
}