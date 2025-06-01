import fetch from 'node-fetch';
import * as cheerio from 'cheerio';
import { store, getFetchProfileData, getProfileCache, setProfileCache } from './config-manager.ts'; // Added .ts
import { getDetailedUserAgent } from './app-lifecycle';
import { ProfileData } from '../../shared/types';
import * as logger from './logger'; // Import the logger utility

const MODULE_NAME = 'RSIScraper'; // Define module name for logger

// --- Constants ---

export const defaultProfileData: ProfileData = {
    // Victim defaults
    victimEnlisted: '-',
    victimRsiRecord: '-',
    victimOrg: '-',
    victimPfpUrl: "https://cdn.robertsspaceindustries.com/static/images/account/avatar_default_big.jpg",
    // Attacker defaults
    attackerEnlisted: '-',
    attackerRsiRecord: '-',
    attackerOrg: '-',
    attackerPfpUrl: "https://cdn.robertsspaceindustries.com/static/images/account/avatar_default_big.jpg"
};

// RSI Profile Scraping Patterns
const rsiJoinDatePattern = /<span class="label">Enlisted<\/span>\s*<strong class="value">([^<]+)<\/strong>/;
const rsiUeePattern = /<p class="entry citizen-record">\s*<span class="label">UEE Citizen Record<\/span>\s*<strong class="value">#?(n\/a|\d+)<\/strong>\s*<\/p>/;
// Note: Org and PFP scraping use Cheerio selectors below.

const CACHE_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// --- Helper Functions ---

// Scrapes a single profile URL
async function scrapeSingleProfile(username: string, isAttacker: boolean = false): Promise<ProfileData> {
    const profileUrl = `https://robertsspaceindustries.com/citizens/${username}`;
    // Start with defaults, ensuring all fields are present even if scraping fails
    const extractedData: ProfileData = isAttacker
        ? { attackerEnlisted: '-', attackerRsiRecord: '-', attackerOrg: '-', attackerOrgSid: '-', attackerOrgLogoUrl: '', attackerAffiliatedOrgs: [], attackerPfpUrl: defaultProfileData.attackerPfpUrl }
        : { victimEnlisted: '-', victimRsiRecord: '-', victimOrg: '-', victimOrgSid: '-', victimOrgLogoUrl: '', victimAffiliatedOrgs: [], victimPfpUrl: defaultProfileData.victimPfpUrl };

    try {
        logger.info(MODULE_NAME, `Scraping RSI profile for ${isAttacker ? 'attacker' : 'victim'}: ${username} at ${profileUrl}`);
        const response = await fetch(profileUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.212 Safari/537.36'
            },
            timeout: 15000 // 15 second timeout
        });

        if (!response.ok) {
            // Handle common errors like 404 (Not Found) or 5xx (Server Errors)
            logger.error(MODULE_NAME, `Failed to fetch RSI profile for ${username}: Status ${response.status}`);
            // Return defaults for the specific role (attacker/victim)
            return extractedData;
        }

        const html = await response.text();
        const $ = cheerio.load(html);

        // Extract Enlisted Date
        const joinDateMatch = html.match(rsiJoinDatePattern);
        if (joinDateMatch?.[1]) {
            const enlistedDate = joinDateMatch[1].replace(',', '').trim(); // Clean up
            if (isAttacker) extractedData.attackerEnlisted = enlistedDate;
            else extractedData.victimEnlisted = enlistedDate;
            // logger.debug(MODULE_NAME, `  - Enlisted: ${enlistedDate}`);
        }

        // Extract UEE Record
        const ueeMatch = html.match(rsiUeePattern);
        if (ueeMatch?.[1] && ueeMatch[1] !== 'n/a') {
            const record = `#${ueeMatch[1]}`;
            if (isAttacker) extractedData.attackerRsiRecord = record;
            else extractedData.victimRsiRecord = record;
            // logger.debug(MODULE_NAME, `  - UEE Record: ${record}`);
        }

        // Extract Organizations (Main and Affiliated)
        let mainOrgName = '-';
        let mainOrgSid = '-';
        let mainOrgLogoUrl = ''; // Default to empty string
        const affiliatedOrgs: string[] = [];

        // Find the main organization block first (usually the first one)
        // Selector targets the link within the 'info' block specifically
        const mainOrgLinkElement = $('.profile.overview .info > .value > a[href*="/orgs/"]').first();

        if (mainOrgLinkElement.length > 0) {
            const orgName = mainOrgLinkElement.text().trim();
            const orgHref = mainOrgLinkElement.attr('href');

            if (orgName) {
                mainOrgName = orgName;
                // logger.debug(MODULE_NAME, `  - Main Org Name: ${mainOrgName}`);
            }

            // Extract SID from href (e.g., /orgs/THESID)
            if (orgHref) {
                const sidMatch = orgHref.match(/\/orgs\/([^\/]+)/);
                if (sidMatch?.[1]) {
                    mainOrgSid = sidMatch[1];
                    // logger.debug(MODULE_NAME, `  - Main Org SID: ${mainOrgSid}`);
                }
            }

            // Find the logo image, often preceding the link or within a shared parent
            // This selector might need adjustment based on actual HTML structure
            const logoElement = mainOrgLinkElement.prev('img.logo'); // Check immediate sibling img.logo
            let logoSrc = logoElement.attr('src');

            if (!logoSrc) {
                 // Try finding img within the parent '.value' if not found as sibling
                 const logoInParent = mainOrgLinkElement.parent('.value').find('img.logo').first();
                 logoSrc = logoInParent.attr('src');
            }

            if (logoSrc) {
                 // Handle relative URLs
                 mainOrgLogoUrl = logoSrc.startsWith('/')
                     ? `https://robertsspaceindustries.com${logoSrc}`
                     : logoSrc;
                 // logger.debug(MODULE_NAME, `  - Main Org Logo: ${mainOrgLogoUrl}`);
            }
        }

        // Find affiliated organizations (often in a separate 'affiliation' block)
        $('.info.affiliation .value a[href*="/orgs/"]').each((index, element) => {
            const affiliatedOrgName = $(element).text().trim();
            // Add to list only if it's not the same as the main org and not empty
            if (affiliatedOrgName && affiliatedOrgName !== mainOrgName) {
                affiliatedOrgs.push(affiliatedOrgName);
            }
        });
        // logger.debug(MODULE_NAME, `  - Affiliated Orgs: ${affiliatedOrgs.join(', ')}`);

        // Assign to the correct fields based on role
        if (isAttacker) {
            extractedData.attackerOrg = mainOrgName;
            extractedData.attackerOrgSid = mainOrgSid;
            extractedData.attackerOrgLogoUrl = mainOrgLogoUrl;
            extractedData.attackerAffiliatedOrgs = affiliatedOrgs;
        } else {
            extractedData.victimOrg = mainOrgName;
            extractedData.victimOrgSid = mainOrgSid;
            extractedData.victimOrgLogoUrl = mainOrgLogoUrl;
            extractedData.victimAffiliatedOrgs = affiliatedOrgs;
        }

        // Extract Profile Picture (using Cheerio selector)
        const pfpElement = $('.profile-content .thumb img');
        if (pfpElement.length > 0) {
            const pfpSrc = pfpElement.first().attr('src'); // Use first() for safety
            let pfpUrl = isAttacker ? defaultProfileData.attackerPfpUrl : defaultProfileData.victimPfpUrl; // Default

            if (pfpSrc) {
                // Handle relative URLs starting with /media/
                pfpUrl = pfpSrc.startsWith('/media/')
                    ? `${pfpSrc}`
                    : pfpSrc; // Assume absolute URL otherwise
            }
            if (isAttacker) extractedData.attackerPfpUrl = pfpUrl;
            else extractedData.victimPfpUrl = pfpUrl;
            // logger.debug(MODULE_NAME, `  - PFP URL: ${pfpUrl}`);
        }

    } catch (error: any) {
        logger.error(MODULE_NAME, `Error scraping RSI profile for ${username}:`, error.message);
        // Return defaults on error
        return extractedData;
    }

    return extractedData;
}

// --- Public Functions ---

// Fetches profile data for multiple usernames, utilizing cache
export async function fetchRsiProfileData(
    usernames: string[],
    attackers: string[] = [] // List of usernames who are attackers in this context
): Promise<Record<string, ProfileData>> {
    const results: Record<string, ProfileData> = {};
    const profileCache = getProfileCache(); // Get current cache from config
    const fetchEnabled = getFetchProfileData();
    const cacheExpiryTime = Date.now() - CACHE_EXPIRY_MS;
    let cacheNeedsUpdate = false;

    // Deduplicate and filter invalid usernames
    const uniqueUsernames = [...new Set(usernames.filter(u => u && typeof u === 'string' && u.toLowerCase() !== 'unknown'))];
    const attackerSet = new Set(attackers.filter(a => a && typeof a === 'string' && a.toLowerCase() !== 'unknown'));

    for (const username of uniqueUsernames) {
        const cachedEntry = profileCache[username];
        const isAttacker = attackerSet.has(username);
        const role = isAttacker ? 'attacker' : 'victim';

        // 1. Check cache validity
        if (cachedEntry && cachedEntry.lastFetched > cacheExpiryTime) {
            logger.debug(MODULE_NAME, `Using cached profile data for ${role}: ${username}`);
            results[username] = cachedEntry.data;
            continue; // Move to next username
        }

        // 2. Check if fetching is enabled
        if (!fetchEnabled) {
            logger.info(MODULE_NAME, `Profile data fetching disabled. Using ${cachedEntry ? 'stale cached' : 'default'} data for ${role}: ${username}`);
            // Use stale cache if available, otherwise defaults
            results[username] = cachedEntry ? cachedEntry.data : (isAttacker ? { ...defaultProfileData } : { ...defaultProfileData });
            // Ensure defaults are correctly structured for the role if no cache exists
             if (!cachedEntry) {
                 results[username] = isAttacker
                     ? { attackerEnlisted: '-', attackerRsiRecord: '-', attackerOrg: '-', attackerOrgSid: '-', attackerOrgLogoUrl: '', attackerAffiliatedOrgs: [], attackerPfpUrl: defaultProfileData.attackerPfpUrl }
                     : { victimEnlisted: '-', victimRsiRecord: '-', victimOrg: '-', victimOrgSid: '-', victimOrgLogoUrl: '', victimAffiliatedOrgs: [], victimPfpUrl: defaultProfileData.victimPfpUrl };
             } else {
                 results[username] = cachedEntry.data; // Use stale data
             }
            continue; // Move to next username
        }

        // 3. Fetch needed: Cache miss, expired, or fetch enabled
        logger.info(MODULE_NAME, `Fetching fresh profile data for ${role}: ${username} (Cache ${cachedEntry ? 'expired' : 'miss'})`);
        try {
            const scrapedData = await scrapeSingleProfile(username, isAttacker);
            results[username] = scrapedData;
            // Update cache only if scraping was successful (or returned defaults)
            profileCache[username] = { data: scrapedData, lastFetched: Date.now() };
            cacheNeedsUpdate = true;
            logger.success(MODULE_NAME, `Successfully fetched and cached data for ${username}`);
        } catch (error: any) { // Catch errors from scrapeSingleProfile just in case
            logger.error(MODULE_NAME, `Failed to fetch profile for ${role} ${username}, using ${cachedEntry ? 'stale cached' : 'default'} data. Error: ${error.message}`);
            // Use stale cache if available, otherwise defaults
             if (cachedEntry) {
                 results[username] = cachedEntry.data;
             } else {
                 results[username] = isAttacker
                     ? { attackerEnlisted: '-', attackerRsiRecord: '-', attackerOrg: '-', attackerOrgSid: '-', attackerOrgLogoUrl: '', attackerAffiliatedOrgs: [], attackerPfpUrl: defaultProfileData.attackerPfpUrl }
                     : { victimEnlisted: '-', victimRsiRecord: '-', victimOrg: '-', victimOrgSid: '-', victimOrgLogoUrl: '', victimAffiliatedOrgs: [], victimPfpUrl: defaultProfileData.victimPfpUrl };
             }
        }
    }

    // Save updated cache back to store if changes were made
    if (cacheNeedsUpdate) {
        setProfileCache(profileCache); // Update store via config manager
        logger.info(MODULE_NAME, 'Profile cache updated in store.');
    }

    return results;
}

// Function to clear the profile cache (e.g., for debugging)
export function clearProfileCache(): void {
    setProfileCache({}); // Set cache to empty object in store
    logger.info(MODULE_NAME, 'Cleared profile cache.');
}