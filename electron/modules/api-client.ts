import fetch from 'node-fetch';
import { getApiUrl, getApiKey, getOfflineMode } from './config-manager.ts'; // Added .ts
import { KillEvent } from '../../shared/types';
import * as logger from './logger'; // Import the logger utility

const MODULE_NAME = 'ApiClient'; // Define module name for logger

// Define the expected structure of the API payload
interface ApiPayload {
    victim_ship: string;
    victim: string;
    enlisted: string;
    rsi: string; // Should be string, e.g., "-1" or number as string
    weapon: string;
    method: string;
    loadout_ship: string;
    game_version: string;
    gamemode: string;
    trackr_version: string;
    location: string;
}

// Define possible return types for logging status
export type LogMode = 'API' | 'Local' | 'Err-Local' | null;

// Sends kill data to the configured API endpoint
export async function sendKillToApi(killEvent: KillEvent): Promise<LogMode> {
    // Validate event data
    if (!killEvent || !killEvent.timestamp) {
        logger.error(MODULE_NAME, 'Invalid kill event passed - missing required properties');
        return null; // Indicate failure to process
    }

    const apiUrl = getApiUrl();
    const apiKey = getApiKey();
    const offlineMode = getOfflineMode();

    // Skip if in offline mode or API not configured
    if (offlineMode) {
        logger.info(MODULE_NAME, 'API submission skipped (Offline mode enabled).');
        return 'Local'; // Indicate local logging only
    }
    if (!apiUrl || !apiKey) {
        logger.info(MODULE_NAME, 'API submission skipped (API URL or Key not set).');
        return 'Local'; // Indicate local logging only
    }

    // Prepare data payload matching the expected structure
    const data: ApiPayload = {
        victim_ship: killEvent.vehicleType === 'Player' ? 'Player' : (killEvent.vehicleType || 'Unknown'),
        victim: killEvent.victims[0] || 'Unknown', // Assuming single victim for now
        enlisted: killEvent.victimEnlisted || '-',
        rsi: (killEvent.victimRsiRecord || '-').replace('#', ''), // Remove '#'
        weapon: killEvent.weapon || 'Unknown',
        method: killEvent.damageType || 'Unknown',
        loadout_ship: killEvent.playerShip || 'Unknown',
        game_version: killEvent.gameVersion || '',
        gamemode: killEvent.gameMode?.toLowerCase() || 'unknown',
        trackr_version: "2.06", // Hardcoded version from original script - consider making configurable
        location: killEvent.location || 'NONE'
    };
    // Ensure RSI record is '-1' if it was originally '-' or empty after removing '#'
    if (data.rsi === '-') data.rsi = '-1';


    // Ensure API URL ends correctly with /register-kill
    let finalApiUrl = apiUrl;
    if (!finalApiUrl.endsWith('/register-kill')) {
        finalApiUrl = finalApiUrl.endsWith('/') ? `${finalApiUrl}register-kill` : `${finalApiUrl}/register-kill`;
    }
    logger.info(MODULE_NAME, `Sending kill data to API: ${finalApiUrl}`);

    try {
        const response = await fetch(finalApiUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                'User-Agent': 'SC-KillFeeder-Client' // Identify our app
            },
            body: JSON.stringify(data),
            timeout: 20000 // 20 second timeout
        });

        if (!response.ok) {
            const errorBody = await response.text();
            logger.error(MODULE_NAME, `API Error: ${response.status} - ${errorBody}`);
            return 'Err-Local'; // Indicate API error, should log locally
        }

        logger.success(MODULE_NAME, `Kill data successfully sent to API for event ${killEvent.id}.`);
        return 'API'; // Indicate successful API submission

    } catch (error: any) {
        logger.error(MODULE_NAME, `Failed to send kill data to API for event ${killEvent.id}:`, error.message);
        return 'Err-Local'; // Indicate network/other error, should log locally
    }
}