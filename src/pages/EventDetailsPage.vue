<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
// Use the globally defined KillEvent from vite-env.d.ts
// No direct import needed if using global declaration

// Define the type locally for clarity if needed, ensuring it matches vite-env.d.ts
interface KillEvent {
  id: string;
  timestamp: string;
  killers: string[];
  victims: string[];
  deathType: 'Soft' | 'Hard' | 'Combat' | 'Collision' | 'Crash' | 'BleedOut' | 'Suffocation' | 'Unknown';
  vehicleType?: string;
  vehicleModel?: string;
  vehicleId?: string;
  location?: string;
  weapon?: string;
  damageType?: string;
  gameMode?: 'PU' | 'AC' | 'Unknown';
  gameVersion?: string;
  coordinates?: { x: number; y: number; z: number; };
  playerShip?: string;
  eventDescription: string;
  victimEnlisted?: string;
  victimRsiRecord?: string;
  victimOrg?: string;         // Main org name
  victimOrgSid?: string;      // Main org SID (handle)
  victimOrgLogoUrl?: string;  // Main org logo URL
  victimAffiliatedOrgs?: string[]; // Affiliated org names
  victimPfpUrl?: string;
  attackerEnlisted?: string;
  attackerRsiRecord?: string;
  attackerOrg?: string;         // Main org name
  attackerOrgSid?: string;      // Main org SID (handle)
  attackerOrgLogoUrl?: string;  // Main org logo URL
  attackerAffiliatedOrgs?: string[]; // Affiliated org names
  attackerPfpUrl?: string;
  attackerShip?: string; // Added attacker ship
  isPlayerInvolved: boolean;
  playerName?: string; // Added player name (passed from main)
}


const eventData = ref<KillEvent | null>(null);
const isLoading = ref(true);
const errorMessage = ref<string | null>(null);

// --- Helper Functions (Copied from event-details.html script) ---

const getDeathTypeClass = (deathType: KillEvent['deathType'] | undefined): string => {
  switch (deathType?.toLowerCase()) {
    case 'combat': return 'combat-badge';
    case 'collision': return 'collision-badge';
    case 'crash': return 'crash-badge';
    case 'hard': return 'hard-badge';
    case 'soft': return 'soft-badge';
    case 'bleedout': return 'bleedout-badge';
    case 'suffocation': return 'suffocation-badge';
    default: return 'combat-badge'; // Default
  }
};

const formatTimestamp = (timestamp: string | undefined): string => {
  if (!timestamp) return 'Unknown Time';
  const date = new Date(timestamp);
  return date.toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
};

const getHeroBannerImage = (event: KillEvent | null): string => {
    // Define the single default banner image
    const defaultBanner = 'https://cdn.sinfulshadows.com/default.jpg';

    if (!event) {
        return defaultBanner;
    }

    // Use CDN image if vehicleType is present and not 'Player'
    if (event.vehicleType && event.vehicleType !== 'Player') {
        // Construct the CDN URL. Using .png as requested.
        // Consider adding .toLowerCase() if vehicleType casing might be inconsistent:
        // const vehicleImageUrl = `https://cdn.sinfulshadows.com/${event.vehicleType.toLowerCase()}.png`;
        const vehicleImageUrl = `https://cdn.sinfulshadows.com/${event.vehicleType.toLowerCase()}.jpg`;
        return vehicleImageUrl;
    }

    // Otherwise, return the default banner
    return defaultBanner;
};


const cleanShipName = (name: string | undefined): string => {
  if (!name) return 'Unknown';
  if (name.includes('_')) {
    const parts = name.split('_');
    if (parts.length >= 2) {
      return parts.slice(1).join(' ').replace(/([a-z])([A-Z])/g, '$1 $2');
    }
  }
  return name;
};

const getHeroTitle = (event: KillEvent | null): string => {
  if (!event) return 'Event Details';
  const isEnvironmental = event.killers && event.killers[0] === 'Environment';
  const isCollision = event.deathType === 'Collision' || event.deathType === 'Crash';
  if (isEnvironmental) return 'Environmental Hazard';
  if (isCollision) return 'Collision Event';
  return 'Combat Engagement';
};

// --- Computed Properties ---
const isCrashEvent = computed(() => eventData.value?.deathType === 'Crash');
const isEnvironmentalEvent = computed(() => eventData.value?.killers?.[0] === 'Environment');
// Attacker exists if not environment, not crash, and killer is known
const hasAttacker = computed(() =>
    !isCrashEvent.value &&
    !isEnvironmentalEvent.value &&
    eventData.value?.killers &&
    eventData.value.killers.length > 0 &&
    eventData.value.killers[0] !== 'unknown'
);
// Victim exists if victims array is not empty and first victim is known
const hasVictim = computed(() =>
    eventData.value?.victims &&
    eventData.value.victims.length > 0 &&
    eventData.value.victims[0] !== 'unknown'
);
const isPlayerAttacker = computed(() => eventData.value?.isPlayerInvolved && eventData.value.killers?.includes(eventData.value.playerName || ''));
const isPlayerVictim = computed(() => eventData.value?.isPlayerInvolved && eventData.value.victims?.includes(eventData.value.playerName || ''));
// Show VS only if there's a distinct attacker and victim (not crash or environment)
const showVs = computed(() => hasAttacker.value && hasVictim.value);

// --- Methods ---
const closeWindow = () => {
  if (window.logMonitorApi && window.logMonitorApi.closeCurrentWindow) {
    window.logMonitorApi.closeCurrentWindow().catch(err => console.error('Error closing window:', err));
  } else {
    window.close(); // Fallback
  }
};

// --- Lifecycle Hook ---
onMounted(async () => {
  console.log('EventDetailsPage mounted');
  try {
    if (!window.logMonitorApi || !window.logMonitorApi.getPassedEventData) {
      throw new Error('logMonitorApi or getPassedEventData not available');
    }
    const data = await window.logMonitorApi.getPassedEventData();
    if (!data) {
      throw new Error('No event data received');
    }
    eventData.value = data;
    console.log('Event data loaded:', eventData.value);
    // Update title dynamically
    document.title = `${eventData.value.deathType} Event - ${eventData.value.killers?.[0] || 'Unknown'} vs ${eventData.value.victims?.[0] || 'Unknown'}`;
  } catch (error: any) {
    console.error('Error loading event data:', error);
    errorMessage.value = error.message || 'Failed to load event data.';
  } finally {
    isLoading.value = false;
  }
});
</script>

<template>
  <div v-if="isLoading" class="fallback">Loading event details...</div>
  <div v-else-if="errorMessage" class="fallback error">
    <h2>Error Displaying Event Details</h2>
    <p>{{ errorMessage }}</p>
    <button @click="closeWindow" class="action-button">Close Window</button>
  </div>
  <div v-else-if="eventData" class="event-details-container">
     <div class="hero-banner">
        <div class="hero-image" :style="{ backgroundImage: `url('${getHeroBannerImage(eventData)}')` }"></div>
        <div class="hero-content-alignment">
            <div :class="['event-type-badge', getDeathTypeClass(eventData.deathType)]">
            {{ eventData.deathType || 'Unknown' }} Death Event
            </div>
        </div>
        <div class="hero-title">
            {{ getHeroTitle(eventData) }}
            <div class="event-title">{{ eventData.eventDescription }}</div>
        </div>
        <div class="hero-overlay"></div>
    </div>

    <!-- Use 'showVs' computed property for single-player class -->
    <div :class="['players-container', { 'single-player': !showVs }]">
        <!-- Show VS only if showVs is true -->
        <div v-if="showVs" class="vs-container">VS</div>

        <!-- Attacker Card (Show if hasAttacker is true) -->
        <div v-if="hasAttacker" class="player-card-wrapper attacker-wrapper">
             <!-- Environmental card logic remains the same, but outer v-if handles attacker presence -->
             <div v-if="isEnvironmentalEvent" class="player-card environment-card">
                 <div class="player-header environment-header">Environmental Cause</div>
                 <div class="player-content environment-content">
                     <div class="player-info">
                         <div class="player-name">{{ eventData.deathType }}</div>
                         <div class="player-detail">Source: Environment</div>
                         <div class="player-detail">Damage Type: {{ eventData.damageType || 'N/A' }}</div>
                         <div v-if="eventData.weapon" class="player-detail">Cause: {{ eventData.weapon }}</div>
                     </div>
                 </div>
             </div>
             <div v-else class="player-card">
                 <div class="player-header attacker-header">
                     Attacker <span v-if="isPlayerAttacker" class="tag attacker-tag">YOU</span>
                 </div>
                 <div class="player-content">
                     <img class="player-avatar attacker-avatar" :src="eventData.attackerPfpUrl || 'https://robertsspaceindustries.com/rsi/static/images/account/avatar_default_big.jpg'" alt="Attacker">
                     <div class="player-info">
                         <div class="player-name">{{ eventData.killers?.[0] || 'Unknown Attacker' }}</div>
                         <!-- Org Badge -->
                         <div v-if="eventData.attackerOrg && eventData.attackerOrg !== '-'" class="org-badge">
                             <img v-if="eventData.attackerOrgLogoUrl" :src="eventData.attackerOrgLogoUrl" alt="Org Logo" class="org-logo" title="Organization Logo">
                             <span class="org-name">{{ eventData.attackerOrg }}</span>
                             <span v-if="eventData.attackerOrgSid && eventData.attackerOrgSid !== '-'" class="org-sid">[{{ eventData.attackerOrgSid }}]</span>
                         </div>
                         <!-- End Org Badge -->
                         <div class="player-detail">Ship: {{ eventData.attackerShip || eventData.playerShip || 'Unknown' }}</div>
                         <div class="player-detail">Weapon: {{ eventData.weapon || 'Unknown' }}</div>
                         <div class="player-detail">Damage Type: {{ eventData.damageType || 'Unknown' }}</div>
                         <div v-if="eventData.attackerEnlisted && eventData.attackerEnlisted !== '-'" class="player-detail">Enlisted: {{ eventData.attackerEnlisted }}</div>
                         <div v-if="eventData.attackerRsiRecord && eventData.attackerRsiRecord !== '-'" class="player-detail">Record: {{ eventData.attackerRsiRecord }}</div>
                     </div>
                 </div>
             </div>
        </div>

        <!-- Victim Card -->
         <div v-if="hasVictim" class="player-card-wrapper victim-wrapper">
             <div class="player-card">
                 <div class="player-header victim-header">
                     Victim <!-- Always use Victim -->
                     <span v-if="isPlayerVictim" class="tag victim-tag">YOU</span>
                     <a v-if="eventData.victims?.[0] && !eventData.victims[0].includes('_')" :href="`https://robertsspaceindustries.com/citizens/${eventData.victims?.[0]}`" target="_blank" class="profile-link" title="View RSI Profile">↗️</a>
                 </div>
                 <div class="player-content">
                      <img v-if="eventData.victimPfpUrl && !eventData.victims[0].includes('_')" class="player-avatar victim-avatar" :src="eventData.victimPfpUrl" alt="Victim">
                      <div v-else class="ship-icon">{{ eventData.vehicleType ? cleanShipName(eventData.vehicleType).charAt(0) : '?' }}</div>
                     <div class="player-info">
                         <div class="player-name">
                             {{ eventData.victims[0].includes('_') ? cleanShipName(eventData.vehicleType || eventData.victims[0]) : eventData.victims[0] }}
                         </div>
                         <!-- Org Badge -->
                         <div v-if="eventData.victimOrg && eventData.victimOrg !== '-' && !eventData.victims[0].includes('_')" class="org-badge">
                             <img v-if="eventData.victimOrgLogoUrl" :src="eventData.victimOrgLogoUrl" alt="Org Logo" class="org-logo" title="Organization Logo">
                             <span class="org-name">{{ eventData.victimOrg }}</span>
                             <span v-if="eventData.victimOrgSid && eventData.victimOrgSid !== '-'" class="org-sid">[{{ eventData.victimOrgSid }}]</span>
                         </div>
                         <!-- End Org Badge -->
                         <div v-if="eventData.vehicleType && !eventData.victims[0].includes('_')" class="player-detail">Ship: {{ cleanShipName(eventData.vehicleType) }}</div>
                         <div v-if="eventData.victims[0].includes('_')" class="player-detail">ID: {{ eventData.victims[0] }}</div>
                         <template v-else>
                            <div class="player-detail">Enlisted: {{ eventData.victimEnlisted || 'Unknown' }}</div>
                         </template>
                     </div>
                 </div>
             </div>
         </div>
    </div>

    <div class="event-information">
        <!-- Event Details Section -->
        <div class="section">
            <div class="section-header">Event Details</div>
            <div class="section-content">
                <div class="detail-card"><div class="detail-title">Timestamp</div><div class="detail-value">{{ formatTimestamp(eventData.timestamp) }}</div></div>
                <div class="detail-card"><div class="detail-title">Location</div><div class="detail-value">{{ eventData.location || 'Unknown' }}</div></div>
                <div class="detail-card"><div class="detail-title">Game Mode</div><div class="detail-value">{{ eventData.gameMode || 'Unknown' }}</div></div>
            </div>
        </div>

        <!-- Vehicle Info Section -->
         <div class="section" v-if="eventData.vehicleType && eventData.vehicleType !== 'Player'">
            <div class="section-header">Vehicle Information</div>
            <div class="section-content">
                <div class="detail-card"><div class="detail-title">Vehicle Type</div><div class="detail-value">{{ eventData.vehicleType || 'Unknown' }}</div></div>
                <div class="detail-card"><div class="detail-title">Model</div><div class="detail-value">{{ eventData.vehicleModel || 'Unknown' }}</div></div>
            </div>
        </div>

        <!-- Attacker Details Section (Show only if hasAttacker) -->
        <div class="section" v-if="hasAttacker">
             <div class="section-header">
                 Attacker Details
                 <a :href="`https://robertsspaceindustries.com/citizens/${eventData.killers?.[0]}`" target="_blank" class="profile-link" title="View RSI Profile">↗️</a>
             </div>
             <div class="section-content">
                 <div class="detail-card"><div class="detail-title">RSI Handle</div><div class="detail-value">{{ eventData.killers?.[0] || 'Unknown' }}</div></div>
                 <div class="detail-card"><div class="detail-title">Enlisted Date</div><div class="detail-value">{{ eventData.attackerEnlisted || 'Unknown' }}</div></div>
                 <div class="detail-card"><div class="detail-title">Citizen Record</div><div class="detail-value">{{ eventData.attackerRsiRecord || 'Unknown' }}</div></div>
                 <div class="detail-card"><div class="detail-title">Organization</div><div class="detail-value">{{ eventData.attackerOrg && eventData.attackerOrg !== '-' ? `${eventData.attackerOrg} [${eventData.attackerOrgSid || 'N/A'}]` : 'None' }}</div></div>
                 <!-- Optionally add affiliated orgs here -->
                 <div v-if="eventData.attackerAffiliatedOrgs && eventData.attackerAffiliatedOrgs.length > 0" class="detail-card full-width"><div class="detail-title">Affiliated Orgs</div><div class="detail-value">{{ eventData.attackerAffiliatedOrgs.join(', ') }}</div></div>
             </div>
         </div>
         <!-- Environmental Cause Section (Show only if isEnvironmentalEvent) -->
         <div class="section" v-else-if="isEnvironmentalEvent">
             <div class="section-header">Environmental Cause</div>
             <div class="section-content">
                 <div class="detail-card"><div class="detail-title">Type</div><div class="detail-value">{{ eventData.deathType || 'Unknown' }}</div></div>
                 <div class="detail-card"><div class="detail-title">Source</div><div class="detail-value">Environment</div></div>
                 <div class="detail-card"><div class="detail-title">Damage Type</div><div class="detail-value">{{ eventData.damageType || 'Unknown' }}</div></div>
             </div>
         </div>

        <!-- Victim Details Section (Show only if hasVictim) -->
        <div class="section" v-if="hasVictim">
            <div class="section-header">
                Victim Details
                 <a v-if="eventData.victims?.[0] && !eventData.victims[0].includes('_')" :href="`https://robertsspaceindustries.com/citizens/${eventData.victims?.[0]}`" target="_blank" class="profile-link" title="View RSI Profile">↗️</a>
             </div>
             <div class="section-content">
                 <div class="detail-card"><div class="detail-title">RSI Handle</div><div class="detail-value">{{ eventData.victims?.[0] || 'Unknown' }}</div></div>
                 <div class="detail-card"><div class="detail-title">Enlisted Date</div><div class="detail-value">{{ eventData.victimEnlisted || 'Unknown' }}</div></div>
                 <div class="detail-card"><div class="detail-title">Citizen Record</div><div class="detail-value">{{ eventData.victimRsiRecord || 'Unknown' }}</div></div>
                 <div class="detail-card"><div class="detail-title">Organization</div><div class="detail-value">{{ eventData.victimOrg && eventData.victimOrg !== '-' ? `${eventData.victimOrg} [${eventData.victimOrgSid || 'N/A'}]` : 'None' }}</div></div>
                 <!-- Optionally add affiliated orgs here -->
                 <div v-if="eventData.victimAffiliatedOrgs && eventData.victimAffiliatedOrgs.length > 0" class="detail-card full-width"><div class="detail-title">Affiliated Orgs</div><div class="detail-value">{{ eventData.victimAffiliatedOrgs.join(', ') }}</div></div>
             </div>
         </div>

        <div class="event-description">
            "{{ eventData.eventDescription || 'No description available' }}"
        </div>

        <button @click="closeWindow" class="action-button">Close Window</button>

        <div class="meta-info">
            Event ID: {{ eventData.id || 'Unknown' }} | {{ eventData.gameMode || 'Unknown' }} Mode
        </div>
    </div>
  </div>
</template>

<style>

.cet-title.cet-title-center {
display: none !important;
}

.cet-container {
  position: relative !important;
  top: 0px !important;
  bottom: 0;
  overflow: auto;
  z-index: 1;
  }

.cet-drag-region {
  /* padding-bottom: 80px; */
  z-index: 1 !important;

}
    

.cet-menubar {
    display: none !important;
}

.cet-icon {
    display: none !important;
}

.title-bar {
  -webkit-app-region: drag;
  user-select: none; /* Prevent text selection */
}

/* Styles copied from event-details.html <style> tag */
.event-details-container { /* Renamed root element */
  width: 100%;
  height: 100vh; /* Use height instead of min-height */
  background-color: #0a0d12;
  color: #e0e0e0;
  overflow-x: hidden;
  overflow-y: auto; /* This should now work */
  display: flex; /* Use flexbox to manage layout */
  flex-direction: column; /* Stack elements vertically */
}
.hero-banner {
  flex-shrink: 0; /* Prevent hero banner from shrinking */
  width: 100%; height: 350px;
  background: linear-gradient(rgba(0, 0, 0, 0.4), rgba(0, 0, 0, 0.7));
  background-size: cover; background-position: center 30%;
  position: relative; display: flex; flex-direction: column;
  justify-content: center; /* Center vertically instead of flex-end */
  align-items: center; overflow: hidden;
  padding-bottom: 60px; /* Add padding to push title up from absolute bottom */
}
.hero-image {
  position: absolute; top: 0; left: 0; width: 100%; height: 100%;
  background-size: cover; background-position: center 30%; z-index: 0;
}
.hero-content-alignment {
  position: absolute; top: 0; left: 0; right: 0; bottom: 0;
  max-width: 1200px; margin: 0 auto; padding: 0 20px; pointer-events: none;
}
.hero-overlay {
  position: absolute; bottom: 0; left: 0; right: 0; height: 120px;
  background: linear-gradient(to top, rgba(10, 13, 18, 1), rgba(10, 13, 18, 0));
}
.hero-title {
  font-size: 32px; font-weight: 700; text-transform: uppercase;
  text-shadow: 0 0 15px rgba(0, 0, 0, 0.9), 0 0 5px rgba(0, 0, 0, 0.9);
  margin-bottom: 0; /* Remove bottom margin as padding handles spacing */
  position: relative; /* Ensure z-index works */
  color: #fff; text-align: center; z-index: 1; letter-spacing: 1px;
}
.event-title {
  font-size: 1.2em; opacity: 0.95; margin-top: 5px; text-transform: none;
  font-weight: 400; text-shadow: 0 0 10px rgba(0, 0, 0, 0.8), 0 0 5px rgba(0, 0, 0, 0.9);
}
.event-type-badge {
  position: absolute; top: 15px; left: 10px; padding: 5px 10px; font-size: 14px;
  font-weight: 600; text-transform: uppercase; color: white; border-radius: 3px;
  z-index: 2; pointer-events: auto;
}
.combat-badge { background-color: #e74c3c; }
.collision-badge { background-color: #f39c12; }
.crash-badge { background-color: #8e44ad; }
.hard-badge { background-color: #c0392b; }
.soft-badge { background-color: #d35400; }
.bleedout-badge { background-color: #a94442; }
.suffocation-badge { background-color: #31708f; }
.players-container {
  width: 100%; display: flex; justify-content: space-between; padding: 0 20px;
  margin-top: -30px; position: relative; z-index: 2; max-width: 1200px;
  margin-left: auto; margin-right: auto; gap: 0;
  flex-shrink: 0; /* Prevent player cards from shrinking */
}
.players-container.single-player { justify-content: center; }
.players-container.single-player .player-card-wrapper { width: 75%; max-width: 600px; }
@media (max-width: 700px) {
  .players-container { flex-direction: column; margin-top: -20px; }
  .players-container.single-player .player-card-wrapper { width: 100%; }
}
.player-card-wrapper { width: 50%; position: relative; display: flex; }
.player-card-wrapper.attacker-wrapper { justify-content: flex-end; padding-right: 35px; }
.player-card-wrapper.victim-wrapper { justify-content: flex-start; padding-left: 35px; }
@media (max-width: 700px) {
  .player-card-wrapper { width: 100%; margin-bottom: 25px; }
  .player-card-wrapper.attacker-wrapper { padding-right: 0; }
  .player-card-wrapper.victim-wrapper { padding-left: 0; margin-top: 25px; }
}
.player-card {
  width: 100%; background: #151c24; border-radius: 5px;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.4); overflow: hidden;
  border: 1px solid #1f2935; position: relative;
}
.player-header {
  padding: 15px; background: linear-gradient(to right, #2c3e50, #1a252f);
  color: white; text-transform: uppercase; font-weight: 600;
  display: flex; justify-content: space-between; align-items: center;
}
.attacker-header { background: linear-gradient(to right, #c0392b, #e74c3c); }
.victim-header { background: linear-gradient(to right, #2980b9, #3498db); }
.player-content { padding: 15px; display: flex; gap: 15px; }
.player-avatar {
  width: 80px; height: 80px; border-radius: 3px; object-fit: cover; border: 2px solid #2c3e50;
}
.ship-icon {
  width: 80px; height: 80px; border-radius: 3px; display: flex; align-items: center;
  justify-content: center; background-color: #2c3e50; color: white; font-size: 2rem;
  font-weight: bold; border: 2px solid #3498db;
}
.attacker-avatar { border-color: #e74c3c; }
.victim-avatar { border-color: #3498db; }
.environment-card { border-color: #7f8c8d; }
.environment-header { background: linear-gradient(to right, #7f8c8d, #95a5a6); }
.environment-content { /* Specific styles if needed */ }
.player-info { flex: 1; }
.player-name { font-size: 1.3em; font-weight: 600; margin-bottom: 5px; }
.player-detail { font-size: 0.9em; opacity: 0.8; margin-bottom: 4px; }
.event-information { margin-top: 20px; padding: 20px; max-width: 1200px; margin-left: auto; margin-right: auto; }
.section { background: #151c24; margin-bottom: 20px; border-radius: 5px; overflow: hidden; border: 1px solid #1f2935; }
.section-header {
  background: #1f2935; color: white; padding: 12px 15px; font-weight: 600;
  font-size: 1.1em; display: flex; justify-content: space-between; align-items: center;
}
.profile-link { color: #aaa; text-decoration: none; font-size: 0.9em; transition: color 0.2s; }
.profile-link:hover { color: #3498db; }
.section-content { padding: 15px; display: flex; gap: 20px; flex-wrap: wrap; }
.detail-card { background: #1a232e; border-radius: 3px; padding: 15px; flex: 1; min-width: 200px; }
.detail-title { color: #3498db; margin-bottom: 10px; font-weight: 600; font-size: 0.9em; text-transform: uppercase; }
.detail-value { font-family: 'Share Tech Mono', monospace; font-size: 1.1em; }
.event-description { font-size: 1.4em; padding: 20px; text-align: center; font-style: italic; line-height: 1.5; opacity: 0.9; }
.vs-container {
  position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%);
  width: 70px; height: 70px; background: #0a0d12; border-radius: 50%;
  display: flex; align-items: center; justify-content: center; font-size: 1.4em;
  font-weight: 700; color: #fff; box-shadow: 0 0 0 5px rgba(255, 255, 255, 0.1), 0 4px 10px rgba(0, 0, 0, 0.5);
  z-index: 20; border: 2px solid #1f2935;
}
@media (max-width: 700px) {
  .vs-container { top: auto; bottom: -35px; left: 50%; }
}

/* Ensure event information area can grow and potentially scroll */
.event-information {
  flex-grow: 1; /* Allow this section to take up remaining space */
  /* overflow-y: auto; */ /* Let the main container handle scrolling */
  min-height: 0; /* Important for flex children scrolling */
}

.action-button {
  display: block; width: 200px; margin: 30px auto; padding: 12px 0; background: #3498db;
  color: white; text-align: center; border-radius: 3px; border: none; font-family: 'Exo', sans-serif;
  font-weight: 600; font-size: 1em; cursor: pointer; text-transform: uppercase; transition: background 0.2s;
}
.action-button:hover { background: #2980b9; }
.meta-info { text-align: center; opacity: 0.6; font-size: 0.9em; padding: 0 20px 40px; }
.tag { display: inline-block; margin-left: 5px; padding: 2px 6px; border-radius: 3px; font-size: 0.8em; background: #2c3e50; color: white; }
.attacker-tag { background: #c0392b; }
.victim-tag { background: #2980b9; }
.fallback { display: flex; flex-direction: column; justify-content: center; align-items: center; min-height: 100vh; text-align: center; padding: 20px; font-size: 16px; }
.org-badge { display: flex; align-items: center; gap: 5px; margin-top: 3px; margin-bottom: 5px; }
.org-logo { height: 18px; width: auto; vertical-align: middle; border-radius: 2px; background-color: rgba(255,255,255,0.1); /* Slight background for visibility */ object-fit: contain; /* Prevent stretching */ }
.org-name { font-size: 0.9em; font-weight: 500; } /* Org name style */
.org-sid { font-size: 0.8em; opacity: 0.7; margin-left: 4px; } /* Faded SID style */
.detail-card.full-width { min-width: calc(100% - 0px); /* Adjust based on gap */ flex-basis: 100%; } /* Allow affiliated orgs card to take full width */
.fallback.error h2 { color: #e74c3c; }
</style>