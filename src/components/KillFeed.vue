<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue'

// Using the interface from the main process instead
// Importing type only, no runtime dependency
import type { KillEvent } from '../../shared/types'; // Import from the new shared types file

const killEvents = ref<KillEvent[]>([]); // Player-involved events
const globalKillEvents = ref<KillEvent[]>([]); // All events including non-player ones
const feedMode = ref<'player' | 'global'>('player'); // Default to player view
const playSoundEffects = ref<boolean>(true); // Sound effects enabled by default
// Use a relative path that will work with Electron
const killSound = new Audio(); // Create an empty Audio object for now

// Function to open the event details window
const openEventDetails = async (event: KillEvent) => {
  console.log('%c KILLFEED CLICK HANDLER ACTIVATED', 'background: #222; color: #bada55; font-size: 16px; padding: 4px;');
  console.log('Click detected. Opening details for event:', event.id);
  
  // Verify that logMonitorApi and openEventDetailsWindow exist
  if (!window.logMonitorApi) {
    console.error('logMonitorApi is not available on window!');
    console.table(Object.keys(window));
    alert("Error: logMonitorApi is not available. Please check console.");
    return;
  }
  
  if (!window.logMonitorApi.openEventDetailsWindow) {
    console.error('openEventDetailsWindow method is not available on logMonitorApi!');
    console.table(Object.keys(window.logMonitorApi));
    alert("Error: openEventDetailsWindow method is not available. Please check console.");
    return;
  }
  
  // Build the minimal event object with just the necessary properties
  // This avoids passing reactive Vue objects that can't be properly serialized
  const minimalEvent: KillEvent = {
    id: String(event.id || ''),
    timestamp: String(event.timestamp || new Date().toISOString()),
    killers: Array.isArray(event.killers) ? [...event.killers] : [],
    victims: Array.isArray(event.victims) ? [...event.victims] : [],
    // Use the original death type if it's valid, otherwise default to "Unknown"
    deathType: (
      ['Soft', 'Hard', 'Combat', 'Collision', 'Crash', 'Unknown'].includes(event.deathType || '')
        ? event.deathType as KillEvent['deathType']
        : 'Unknown'
    ),
    vehicleType: String(event.vehicleType || 'Unknown'),
    vehicleModel: String(event.vehicleModel || 'Unknown'),
    location: String(event.location || ''),
    weapon: String(event.weapon || ''),
    damageType: String(event.damageType || ''),
    gameMode: (event.gameMode === 'PU' || event.gameMode === 'AC')
      ? event.gameMode
      : 'Unknown' as KillEvent['gameMode'],
    eventDescription: String(event.eventDescription || ''),
    isPlayerInvolved: Boolean(event.isPlayerInvolved),
    victimEnlisted: String(event.victimEnlisted || '-'),
    victimRsiRecord: String(event.victimRsiRecord || '-'),
    victimOrg: String(event.victimOrg || '-'),
    victimPfpUrl: String(event.victimPfpUrl || '')
  };
  
  console.log('Passing event data:', JSON.stringify(minimalEvent, null, 2));
  
  try {
    // Call the API method with a slight delay to ensure UI is responsive
    setTimeout(async () => {
      try {
        console.log('Calling openEventDetailsWindow...');
        const result = await window.logMonitorApi.openEventDetailsWindow(minimalEvent);
        console.log('Event details window opened successfully with result:', result);
      } catch (innerError: any) {
        console.error('Failed in delayed handler:', innerError);
        const errorMessage = innerError?.message || 'Unknown error';
        alert(`Error opening event details window: ${errorMessage}`);
      }
    }, 100);
  } catch (outerError: any) {
    console.error('Failed to set up event window opener:', outerError);
    const errorMessage = outerError?.message || 'Unknown error';
    alert(`Error setting up window open handler: ${errorMessage}`);
  }
};
const searchQuery = ref('');
const logStatus = ref<string>('Initializing...');
const currentPlayerShip = ref<string>('');
const killFeedListRef = ref<HTMLDivElement | null>(null); // Ref for the list container
const recentlyUpdatedIds = ref<Set<string>>(new Set()); // Track updated event IDs for animation
let cleanupFunctions: (() => void)[] = [];

// Get the current event source based on feed mode
const currentEvents = computed(() => {
  return feedMode.value === 'player' ? killEvents.value : globalKillEvents.value;
});

// Filter events based on search query and sort chronologically (newest at top)
const sortedFilteredEvents = computed(() => {
  return currentEvents.value
    .filter((event: KillEvent) => { // Add type annotation
      // Apply search filter
      if (!searchQuery.value.trim()) return true;
      
      const search = searchQuery.value.toLowerCase().trim();
      // Search across relevant fields
      const searchFields = [
        ...(event.killers || []),
        ...(event.victims || []),
        event.vehicleType,
        event.eventDescription,
        event.deathType, // Use deathType
        event.weapon,
        event.damageType,
        event.location,
        event.gameMode,
        event.victimOrg,
        event.victimRsiRecord
      ];
      
      return searchFields.some(field => field?.toLowerCase().includes(search));
    })
    // Sort newest first (reverse chronological)
    .sort((a: KillEvent, b: KillEvent) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()); // Add type annotations
});

// Format time from ISO string to appropriate format based on age
const formatTime = (isoTime: string): string => {
  if (!isoTime) return '';
  try {
    const date = new Date(isoTime);
    const now = new Date();
    
    // Format options - Use correct literal types
    const timeOptions: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false };
    
    // If timestamp is from today, show only time
    if (date.toDateString() === now.toDateString()) {
      return date.toLocaleTimeString([], timeOptions);
    }
    
    // If from the current year, show date and time
    if (date.getFullYear() === now.getFullYear()) {
      return date.toLocaleDateString([], { day: 'numeric', month: 'short' }) +
             ' ' + date.toLocaleTimeString([], timeOptions);
    }
    
    // If older than a year, include year
    return date.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' }) +
           ' ' + date.toLocaleTimeString([], timeOptions);
  } catch (e) {
    console.error("Error formatting time:", isoTime, e);
    return 'Invalid Time';
  }
};

// Functions to switch feed mode
const toggleFeedMode = async () => {
  // Toggle between player and global modes
  feedMode.value = feedMode.value === 'player' ? 'global' : 'player';
  
  // Store preference
  await window.logMonitorApi.setFeedMode(feedMode.value);
  
  // Reload events with new mode
  await loadKillEvents();
};

// Function to load the saved feed mode preference
const loadFeedModePreference = async () => {
  try {
    feedMode.value = await window.logMonitorApi.getFeedMode();
    console.log(`Loaded feed mode preference: ${feedMode.value}`);
  } catch (error) {
    console.error('Failed to load feed mode preference:', error);
    // Default to player mode if preference can't be loaded
    feedMode.value = 'player';
  }
};

// Function to load sound effects setting - simplified version
const loadSoundEffectsSetting = async () => {
  try {
    // Default to enabled
    playSoundEffects.value = true;
    console.log('Sound effects enabled (default setting)');
  } catch (error) {
    console.error('Error with sound effects settings:', error);
  }
};

// Load kill events based on the current feed mode
const loadKillEvents = async () => {
  try {
    // Load both event sets to ensure they're available for toggle
    const playerEvents = await window.logMonitorApi.getKillEvents(100);
    const globalEvents = await window.logMonitorApi.getGlobalKillEvents(100);
    
    // Update the ref arrays
    killEvents.value = playerEvents;
    globalKillEvents.value = globalEvents;
    
    console.log(`Loaded ${playerEvents.length} player events and ${globalEvents.length} global events`);
    
    // Scroll to top after initial load
    nextTick(() => {
      if (killFeedListRef.value) killFeedListRef.value.scrollTop = 0;
    });
  } catch (error) {
    console.error('Failed to load kill events:', error);
  }
};

// Get CSS class based on death type
const getEventClass = (deathType: KillEvent['deathType']): string => {
  switch (deathType) {
    case 'Combat': return 'combat-event';
    case 'Soft': return 'soft-death-event';
    case 'Hard': return 'hard-death-event';
    case 'Collision': return 'collision-event';
    case 'Crash': return 'crash-event';
    case 'BleedOut': return 'bleedout-event'; // Added
    case 'Suffocation': return 'suffocation-event'; // Added
    case 'Unknown':
    default: return 'unknown-event';
  }
};

// Get icon based on death type
const getEventIcon = (deathType: KillEvent['deathType']): string => {
   switch (deathType) {
    case 'Combat': return '⚔️'; // Cross swords
    case 'Soft': return '🔧'; // Wrench (disabled)
    case 'Hard': return '💥'; // Explosion
    case 'Collision': return '💥'; // Explosion
    case 'Crash': return '💔'; // Broken heart / Impact
    case 'BleedOut': return '🩸'; // Blood drop
    case 'Suffocation': return '💀'; // Skull
    case 'Unknown':
    default: return '❓'; // Question mark
  }
};

// Get separator based on death type
const getSeparator = (deathType: KillEvent['deathType']): string => {
  switch (deathType) {
    case 'Combat': return ' → ';
    case 'Soft': return ' 🔧 ';
    case 'Hard': return ' 💥 ';
    case 'Collision': return ' 💥 ';
    case 'Crash': return ' 💔 ';
    case 'BleedOut': return ' 🩸 ';
    case 'Suffocation': return ' 💀 ';
    case 'Unknown':
    default: return ' ? ';
  }
};

// Function to play sound effect for new kill events
const playKillSound = () => {
  if (playSoundEffects.value) {
    try {
      // Create a new Audio instance each time to avoid issues with replaying
      const sound = new Audio();
      
      // Try to load from assets folder if available
      // This path works in development; for production you might need to adjust
      sound.src = './assets/kill-sound.mp3';
      
      // Play with error handling
      sound.play().catch(err => {
        console.log('Non-critical: Sound play failed (possibly user has not interacted with page yet)');
        // Browsers require user interaction before playing audio
      });
    } catch (err) {
      console.error('Error with sound playback:', err);
      // Non-critical error, app continues
    }
  }
};

// Helper function to clean up ship names (similar to EventDetailsPage)
const cleanShipName = (name: string | undefined): string => {
  if (!name) return 'Unknown';
  // Basic cleanup: remove manufacturer prefix and replace underscores
  const parts = name.split('_');
  if (parts.length > 1) {
    // Attempt to remove common manufacturer prefixes if they exist
    const manufacturers = ["ORIG", "CRUS", "RSI", "AEGS", "VNCL", "DRAK", "ANVL", "BANU", "MISC", "CNOU", "XIAN", "GAMA", "TMBL", "ESPR", "KRIG", "GRIN", "XNAA", "MRAI"];
    if (manufacturers.includes(parts[0])) {
      return parts.slice(1).join(' ').replace(/_/g, ' ');
    }
  }
  // Fallback: just replace underscores if no prefix found or only one part
  return name.replace(/_/g, ' ');
};


onMounted(() => {
  // Load feed mode preference and sound settings, then load the events
  Promise.all([
    loadFeedModePreference(),
    loadSoundEffectsSetting()
  ]).then(() => loadKillEvents());
  
  // Listen for new/updated spacecraft events
  cleanupFunctions.push(
    // Explicitly type the incoming data
    window.logMonitorApi.onKillFeedEvent((_event, data: { event: KillEvent, source: 'player' | 'global' } | null) => {
      if (data === null) {
        // Handle signal to clear events
        console.log("Received signal to clear kill events.");
        killEvents.value = [];
        globalKillEvents.value = [];
        return;
      }

      // Declare variables needed outside the try block
      let killEvent: KillEvent | null = null;
      let wasNewEvent = false;

      try {
        // Ensure data has the expected structure { event, source }
        if (!data || typeof data !== 'object' || !('event' in data) || !('source' in data)) {
          console.error('Received invalid data structure in kill feed event handler:', data);
          return;
        }

        killEvent = data.event; // Assign here
        const source = data.source;

        // Validate the event object itself
        if (!killEvent || !killEvent.id || !killEvent.timestamp) {
          console.error('Received invalid kill event object:', killEvent);
          return;
        }

        console.log(`Received spacecraft event (${source}):`, killEvent);

        // Update current player's ship if included
        if (killEvent.playerShip) {
          currentPlayerShip.value = killEvent.playerShip;
        }

        // Find existing event by ID in global events
        const existingGlobalIndex = globalKillEvents.value.findIndex((ev: KillEvent) => ev.id === killEvent!.id); // Add type annotation

        if (existingGlobalIndex !== -1) {
          // Existing event found - REPLACE it
          console.log(`Received update for global event: ${killEvent.id}`);
          globalKillEvents.value.splice(existingGlobalIndex, 1, killEvent); // Replace
          // Trigger update animation
          const eventId = killEvent.id; // Capture ID locally
          recentlyUpdatedIds.value.add(eventId);
          setTimeout(() => recentlyUpdatedIds.value.delete(eventId), 1000); // Use local constant
        } else {
          // No existing event found - add as new event
          globalKillEvents.value.unshift(killEvent);
          console.log(`Added new global event: ${killEvent.id}`);
          wasNewEvent = true; // Mark as new
          
          // Play sound effect for new events
          playKillSound();
          
          // Keep global events array size in check
          if (globalKillEvents.value.length > 100) {
            globalKillEvents.value.pop(); // Use pop for oldest
          }
        }

        // Handle player events array similarly
        if (killEvent.isPlayerInvolved) {
          const existingPlayerIndex = killEvents.value.findIndex((ev: KillEvent) => ev.id === killEvent!.id); // Add type annotation
          if (existingPlayerIndex !== -1) {
            // Existing event found - REPLACE it
            console.log(`Received update for player event: ${killEvent.id}`);
            killEvents.value.splice(existingPlayerIndex, 1, killEvent); // Replace
            // Trigger update animation
            const eventId = killEvent.id; // Capture ID locally
            recentlyUpdatedIds.value.add(eventId);
            setTimeout(() => recentlyUpdatedIds.value.delete(eventId), 1000); // Use local constant
          } else {
            // No existing event found - add as new event
            killEvents.value.unshift(killEvent);
            console.log(`Added new player event: ${killEvent.id}`);
            // Keep player events array size in check
            if (killEvents.value.length > 100) {
              killEvents.value.pop(); // Use pop for oldest
            }
          }
        } else {
          // If the updated event NO LONGER involves the player, remove it from player list
          const existingPlayerIndex = killEvents.value.findIndex((ev: KillEvent) => ev.id === killEvent!.id); // Add type annotation
          if (existingPlayerIndex !== -1) {
            console.log(`Removing event ${killEvent.id} from player list as it no longer involves the player.`);
            killEvents.value.splice(existingPlayerIndex, 1);
          }
        }

        console.log(`Events count - Player: ${killEvents.value.length}, Global: ${globalKillEvents.value.length}`);

      } catch (error) {
        console.error('Error processing kill feed event:', error);
        // Don't return here, allow scrolling logic to run if killEvent was assigned
      }

      // Scroll to top based on current feed mode if new event was added
      // Check killEvent is not null before accessing its properties
      if (killEvent && wasNewEvent && ((feedMode.value === 'global') ||
          (feedMode.value === 'player' && killEvent.isPlayerInvolved))) {
        nextTick(() => {
          if (killFeedListRef.value) killFeedListRef.value.scrollTop = 0;
        });
      }
    })
  );
  
  // Listen for log status updates
  cleanupFunctions.push(
    window.logMonitorApi.onLogStatus((_event, status) => {
      logStatus.value = status;
      
      // Check for player ship updates in status messages
      if (status.includes('Current ship:')) {
        const shipMatch = status.match(/Current ship: ([A-Z0-9_]+)/i);
        if (shipMatch && shipMatch[1]) {
          currentPlayerShip.value = shipMatch[1];
        }
      }
    })
  );
  
  // No longer need the cleanup for the interval
});

onUnmounted(() => {
  // Clean up listeners
  cleanupFunctions.forEach(cleanup => cleanup());
});
</script>

<template>
  <div class="kill-feed-container">
    <!-- Controls bar -->
    <div class="controls-container">
      <!-- Mode Toggle -->
      <div class="mode-toggle">
        <span class="toggle-label" :class="{ active: feedMode === 'player' }">Player</span>
        <button
          class="toggle-button"
          :class="{ 'global-active': feedMode === 'global' }"
          @click="toggleFeedMode"
          title="Toggle between Player events and All events"
        >
          <span class="toggle-slider"></span>
        </button>
        <span class="toggle-label" :class="{ active: feedMode === 'global' }">Global</span>
      </div>
      
      <!-- Search input - takes remaining space -->
      <input
        v-model="searchQuery"
        placeholder="Search events (Player, Ship, Location, Weapon...)"
        class="search-input"
        type="text"
      >
    </div>
    
    <!-- Status bar -->
    <div class="status-bar">
      <!-- Stats section -->
      <div class="stats-section">
        <span class="stats-item view-mode-indicator">
          <span class="mode-badge" :class="{ 'global-mode': feedMode === 'global' }">
            {{ feedMode === 'player' ? 'Player Events' : 'All Events' }}
          </span>
          <span class="count-badge">
            {{ feedMode === 'player' ? killEvents.length : globalKillEvents.length }} events
          </span>
        </span>
        <span class="stats-item" v-if="currentPlayerShip">Ship: {{ currentPlayerShip }}</span>
      </div>
      
      <!-- Status indicator -->
      <div class="log-status">
        <div class="status-indicator" :class="{active: logStatus.includes('active') || logStatus.includes('Monitoring started')}"></div>
        <span>{{ logStatus }}</span>
      </div>
    </div>
    
    <!-- Event List Area -->
    <!-- Check for no events first (using currentEvents based on mode) -->
    <div v-if="!currentEvents.length" class="no-events">
      No kill events recorded yet
    </div>
    <!-- Then check for no matching search results -->
    <div v-else-if="!sortedFilteredEvents.length" class="no-events">
      No events match your search
    </div>
    <!-- Otherwise, render the list -->
    <!-- Apply flex/scroll properties to this wrapper div -->
    <div v-else class="kill-feed-scroll-area" ref="killFeedListRef"> <!-- Renamed class for clarity. This div now only handles flex sizing. -->
        <!-- Apply flex layout and gap to the transition-group's rendered div -->
        <transition-group name="feed-anim" tag="div" class="feed-items-container">
        <div
          v-for="event in sortedFilteredEvents"
          :key="event.id"
          class="kill-event-item clickable"
          :class="[
            getEventClass(event.deathType),
            { 'player-involved': event.isPlayerInvolved && feedMode === 'global' },
            { 'updated': recentlyUpdatedIds.has(event.id) } // Add class if ID is recently updated
          ]"
          @click="openEventDetails(event)"
          @mousedown="console.log('KillFeed: mousedown on event', event.id)"
          @mouseup="console.log('KillFeed: mouseup on event', event.id)"
        >
          <div class="event-header">
          <!-- <span class="event-icon">{{ getEventIcon(event.deathType) }}</span> -->
          <span class="event-icon-blank"></span>
          <span class="event-death-type">{{ event.deathType }} Death</span>
          <!-- Game Mode Pill -->
          <span v-if="event.gameMode && event.gameMode !== 'Unknown'" class="event-mode-pill">{{ event.gameMode }}</span>
          <!-- Player Involved Badge -->
          <span v-if="event.isPlayerInvolved && feedMode === 'global'" class="player-involved-badge">YOU</span>
          <span class="event-location" v-if="event.location">{{ event.location }}</span>
          <span class="event-time">{{ formatTime(event.timestamp) }}</span>
        </div>
        
        <div class="event-content">
          <div class="player-names">
            <!-- Special layout for environmental deaths or crashes -->
            <template v-if="event.killers[0] === 'Environment' || event.deathType === 'Crash'">
              <div class="victims">
                <template v-for="(victim, index) in event.victims" :key="victim">
                  <span class="victim">{{ victim }}</span>
                  <span v-if="index < event.victims.length - 1" class="operator"> + </span>
                </template>
              </div>
              <span class="separator">{{ getSeparator(event.deathType) }}</span>
              <!-- Show death type for environment/crash -->
              <div class="env-cause">
                <span>{{ event.deathType }}</span>
              </div>
            </template>
            <!-- Standard layout for events with distinct attackers -->
            <template v-else>
              <div class="attackers">
                <span v-for="(attacker, index) in event.killers" :key="attacker">
                  {{ attacker }}<span v-if="index < event.killers.length - 1"> + </span>
                </span>
              </div>
              <span class="separator">{{ getSeparator(event.deathType) }}</span>
              <div class="victims">
                <template v-for="(victim, index) in event.victims" :key="victim">
                  <!-- Display cleaned vehicle name if victim is a ship ID -->
                  <span class="victim">{{ victim.includes('_') ? cleanShipName(event.vehicleType || victim) : victim }}</span>
                  <span v-if="index < event.victims.length - 1" class="operator"> + </span>
                </template>
              </div>
            </template>
            <!-- Show vehicle info only if victim is NOT a ship ID and vehicleType exists -->
            <div class="vehicle-info" v-if="event.vehicleType && event.vehicleType !== 'Player' && !event.victims[0]?.includes('_')">
              ({{ cleanShipName(event.vehicleType) }})
            </div>
          </div>
          <!-- Optional: Display Weapon/Damage -->
           <div class="event-details" v-if="event.weapon && event.weapon !== 'unknown' && event.weapon !== 'Collision'">
             <span class="detail-label">Method:</span> {{ event.weapon }}
             <span v-if="event.damageType && event.damageType !== event.weapon">({{ event.damageType }})</span>
           </div>
           <!-- Optional: Display RSI Info -->
           <div class="event-details rsi-details" v-if="event.victimOrg || event.victimRsiRecord">
              <span v-if="event.victimOrg && event.victimOrg !== '-'">[ {{ event.victimOrg }} ]</span>
              <span v-if="event.victimRsiRecord && event.victimRsiRecord !== '-'">{{ event.victimRsiRecord }}</span>
           </div>
         </div>
       </div> <!-- End of v-for element -->
       </transition-group> <!-- Close transition-group here -->
     <!-- The v-else-if conditions are handled earlier, this closes the v-else div -->
   </div>
 </div> <!-- Close kill-feed-container -->
</template>

<style scoped>
.kill-feed-container {
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 100%;
  margin: 0;
  background-color: #1a1a1a;
  padding: 0;
  overflow: hidden;
  box-sizing: border-box;
}

/* Controls container */
.controls-container {
  display: flex; /* Use flexbox */
  padding: 12px 15px; /* Restore padding */
  background-color: #1a1a1a;
  border-bottom: 1px solid #333;
  flex-shrink: 0; /* Restore flex-shrink */
  gap: 15px; /* Space between items */
  align-items: center;
}

/* Mode Toggle Styles */
.mode-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0; /* Prevent the toggle from shrinking */
  padding-right: 8px;
}

.toggle-label {
  font-size: 0.85em;
  color: #999;
  transition: color 0.3s;
}

.toggle-label.active {
  color: #fff;
  font-weight: 600;
}

.toggle-button {
  position: relative;
  width: 42px;
  height: 20px;
  background-color: #333;
  border-radius: 12px;
  border: none;
  cursor: pointer;
  transition: background-color 0.3s;
  padding: 0;
}

.toggle-button.global-active {
  background-color: #2980b9; /* Blue for global mode */
}

.toggle-slider {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background-color: #e74c3c; /* Red for player mode */
  transition: transform 0.3s, background-color 0.3s;
}

.toggle-button.global-active .toggle-slider {
  transform: translateX(22px);
  background-color: #fff;
}

/* Search input takes available space */
.search-input {
  flex-grow: 1; /* Allow input to grow */
  padding: 8px 12px;
  background-color: #333;
  border: 1px solid #444;
  color: white;
  border-radius: 4px;
  font-size: 0.9em;
}
.search-input:focus {
  outline: none;
  border-color: #e74c3c;
  box-shadow: 0 0 0 1px rgba(231, 76, 60, 0.2);
}
.search-input::placeholder {
  color: #777;
}

/* Status bar */
.status-bar {
  display: flex;
  padding: 8px 15px; /* Restore padding */
  background-color: #222;
  border-bottom: 1px solid #333;
  justify-content: space-between;
  font-size: 0.8em; /* Smaller font */
  flex-shrink: 0; /* Restore flex-shrink */
  align-items: center;
}

.stats-section {
  display: flex;
  gap: 15px;
  align-items: center;
}

.stats-item {
  color: #aaa;
  display: flex;
  align-items: center;
  gap: 8px;
}

.view-mode-indicator {
  display: flex;
  align-items: center;
  gap: 8px;
}

.mode-badge {
  display: inline-block;
  padding: 2px 8px;
  background-color: #e74c3c; /* Red for player mode */
  color: white;
  border-radius: 12px;
  font-size: 0.8em;
  font-weight: bold;
}

.mode-badge.global-mode {
  background-color: #2980b9; /* Blue for global mode */
}

.count-badge {
  display: inline-block;
  padding: 2px 6px;
  background-color: #333;
  color: #ddd;
  border-radius: 10px;
  font-size: 0.75em;
}

.log-status {
  display: flex;
  align-items: center;
  color: #888;
}

.status-indicator {
  width: 8px; /* Smaller indicator */
  height: 8px;
  border-radius: 50%;
  background-color: #777;
  margin-right: 6px;
  transition: background-color 0.5s, box-shadow 0.5s;
}

.status-indicator.active {
  background-color: #4caf50; /* Green when active */
  box-shadow: 0 0 4px #4caf50;
}

/* Event List Area */
.no-events {
  color: #888;
  text-align: center;
  padding: 30px;
  font-style: italic;
  flex-grow: 1; /* Take remaining space */
}

.kill-feed-scroll-area {
  flex: 1;
  overflow-y: auto !important;
  overflow-x: hidden;
  min-height: 0;
  padding: 10px;
  box-sizing: border-box;
}

/* Scrollbar styling */
.kill-feed-scroll-area::-webkit-scrollbar {
  width: 8px;
}

.kill-feed-scroll-area::-webkit-scrollbar-track {
  background: #222;
}

/* Make scrollbar thumb rectangular */
.kill-feed-scroll-area::-webkit-scrollbar-thumb {
  background-color: #444;
  border-radius: 0;
}

/* Individual Event Item */
.kill-event-item {
  background-color: #222;
  border-left: 4px solid; /* Slightly thicker border */
  border-radius: 3px;
  padding: 10px 12px; /* Adjusted padding */
  font-size: 0.9em;
  transition: background-color 0.3s ease;
  line-height: 1.4;
  margin-bottom: 5px; /* Reduced spacing between items from 8px to 5px */
  position: relative; /* For positioning the player-involved indicator */
}

/* Style for player-involved events in global view */
.kill-event-item.player-involved {
  background-color: rgba(231, 76, 60, 0.15); /* Light red background */
  box-shadow: 0 0 3px rgba(231, 76, 60, 0.3);
}

.kill-event-item.player-involved:hover {
  background-color: rgba(231, 76, 60, 0.2); /* Slightly darker on hover */
}

/* Player involved badge */
.player-involved-badge {
  background-color: #e74c3c;
  color: white;
  padding: 1px 4px;
  border-radius: 4px;
  font-size: 0.7em;
  font-weight: bold;
  margin-left: 5px;
}

/* Event Type Styling */
.combat-event { border-left-color: #e74c3c; } /* Red */
.soft-death-event { border-left-color: #f39c12; } /* Orange */
.hard-death-event { border-left-color: #c0392b; } /* Darker Red */
.collision-event { border-left-color: #dbca34; } /* Yellow */
.crash-event { border-left-color: #9b59b6; } /* Purple */
.bleedout-event { border-left-color: #a94442; } /* Dark Red/Brown */
.suffocation-event { border-left-color: #31708f; } /* Dark Blue/Teal */
.unknown-event { border-left-color: #7f8c8d; } /* Gray */

.event-header {
  display: flex;
  align-items: center;
  margin-bottom: 6px; /* Increased spacing */
  flex-wrap: wrap; /* Allow wrapping */
  gap: 5px 8px; /* Row and column gap */
}

.event-icon {
  margin-right: 3px;
  font-size: 1.1em;
}

.event-icon-blank {
  margin-right: -3px;
  font-size: 1.1em;
}

.event-death-type {
  color: #bbb;
  font-weight: bold;
  font-size: 0.9em;
}

.event-mode-pill {
  background-color: #555;
  color: #eee;
  padding: 1px 6px;
  border-radius: 10px;
  font-size: 0.75em;
  font-weight: bold;
  text-transform: uppercase;
  white-space: nowrap;
}

.event-location {
  color: #88a;
  font-size: 0.85em;
  /* Removed max-width to allow wrapping */
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap; /* Keep location on one line if possible */
}

.event-time {
  margin-left: auto; /* Pushes time to the right */
  color: #888;
  font-size: 0.85em;
  white-space: nowrap;
  padding-left: 10px; /* Ensure space from other elements */
}

.event-content {
  padding-left: 5px; /* Restore original padding */
}

.player-names {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 5px;
  margin-bottom: 4px;
}

.attackers, .victims {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0 5px; /* Only horizontal gap */
}

.operator {
  color: #666;
  font-weight: normal;
}

.separator {
  color: #888;
  font-size: 1.1em;
}

.victim { color: #3498db; font-weight: bold; }
.attackers span { color: #e74c3c; font-weight: bold; } /* Style attackers */
.env-cause span { color: #9b59b6; font-weight: bold; } /* Style environmental causes */

.vehicle-info {
  color: #888;
  font-size: 0.85em;
  font-style: italic;
  margin-left: 5px; /* Space after names */
}

.event-details {
  font-size: 0.85em;
  color: #999;
  margin-top: 3px;
  text-align: left; /* Explicitly align left */
}
.detail-label {
  font-weight: bold;
  color: #aaa;
}
.rsi-details {
  display: flex;
  gap: 10px;
  color: #a8a; /* Different color for RSI info */
  text-align: left; /* Ensure RSI details are also left-aligned */
}

/* Container rendered by transition-group */
.feed-items-container {
  display: flex;
  flex-direction: column;
  gap: 5px; /* Reduced gap from 8px to 5px */
  padding-bottom: 100px; /* Increased padding from 20px to 100px to ensure all items are fully visible */
}

/* --- Transition Group Animations --- */
.feed-anim-move, /* Apply transition to moving elements */
.feed-anim-enter-active,
.feed-anim-leave-active {
  transition: all 0.5s ease;
}

.feed-anim-enter-from,
.feed-anim-leave-to {
  opacity: 0;
  transform: translateY(15px); /* Start slightly lower */
}

/* Ensure leaving items are taken out of layout flow so that moving animations can be calculated correctly. */
.feed-anim-leave-active {
  position: absolute;
  width: calc(100% - 20px); /* Match padding of list */
}

/* --- Update Blink/Highlight Animation --- */
.kill-event-item.updated {
  animation: highlight 1s ease-out;
}

@keyframes highlight {
  0% { background-color: rgba(255, 255, 0, 0.3); } /* Start yellow highlight */
  100% { background-color: inherit; } /* Fade back to original */
}

/* Clickable event styling */
.kill-event-item.clickable {
  cursor: pointer;
  transition: transform 0.1s ease-in-out, box-shadow 0.2s ease-in-out, background-color 0.3s ease;
}

.kill-event-item.clickable:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
  background-color: #2a2a2a;
}

.kill-event-item.clickable:active {
  transform: translateY(0);
}

</style>