<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick, watch } from 'vue';
import UserAvatar from './UserAvatar.vue'; // Import the new UserAvatar component
import UpdateBanner from './UpdateBanner.vue'; // Import the new UpdateBanner component
import type { IpcRendererEvent } from 'electron'; // Import IpcRendererEvent
import { Setting, Tickets, User, MapLocation } from '@element-plus/icons-vue'; // Import icons

// Using the interface from the main process instead
// Importing type only, no runtime dependency
import type { KillEvent } from '../../shared/types'; // Import from the new shared types file

// --- State Refs ---
const MAX_EVENTS_DISPLAY = 100; // Local constant for display limit
const allEvents = ref<KillEvent[]>([]); // Unified event array - server determines what user sees
const isAuthenticated = ref<boolean>(false); // Track auth status for UI display
const playSoundEffects = ref<boolean>(true); // Sound effects enabled by default
const isOffline = ref<boolean>(false); // Track offline mode setting
type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';
const connectionStatus = ref<ConnectionStatus>('disconnected'); // Track server connection status
const resourcePath = ref<string>(''); // To store the path provided by main process
const currentGameMode = ref<'PU' | 'AC' | 'Unknown'>('Unknown'); // Added for stable game mode
const searchQuery = ref<string>(''); // Explicitly type and initialize
const logStatus = ref<string>('Initializing...'); // Log file monitoring status
const currentPlayerShip = ref<string>('');
const killFeedListRef = ref<HTMLDivElement | null>(null); // Ref for the list container
const recentlyUpdatedIds = ref<Set<string>>(new Set()); // Track updated event IDs for animation

// New infinite scroll and search state
const isLoadingMore = ref<boolean>(false);
const hasMoreEvents = ref<boolean>(true);
const isSearching = ref<boolean>(false);
const searchResults = ref<KillEvent[]>([]);
const searchOffset = ref<number>(0);
const totalEventsLoaded = ref<number>(0);
const isUsingSearch = ref<boolean>(false);
const loadMoreTriggerDistance = 200; // Pixels from bottom to trigger load more

// Enhanced scroll state management
const scrollDetectionEnabled = ref<boolean>(false);
const lastScrollTime = ref<number>(0);
const scrollThrottleMs = 100; // Throttle scroll events to 100ms
const containerReady = ref<boolean>(false); // Track if container is properly sized

let cleanupFunctions: (() => void)[] = [];

// --- Icon Button Active State ---
const isSettingsActive = ref(false);
const isProfileActive = ref(false);
const isLeaderboardActive = ref(false);
const isMapActive = ref(false);
// Note: For external windows like Settings, true active state tracking
// would require IPC communication with the main process.

// --- Click Handlers ---
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

const openSettingsWindow = () => {
  try {
    if (isSettingsActive.value) {
      console.log('Settings button clicked while active: Closing window.');
      window.logMonitorApi.closeSettingsWindow();
    } else {
      console.log('Settings button clicked while inactive: Opening window.');
      window.logMonitorApi.openSettingsWindow();
    }
  } catch (error) {
    console.error("Failed to toggle settings window:", error);
  }
}

const openProfile = () => {
  try {
    if (isProfileActive.value) {
      console.log('Profile button clicked while active: Closing window.');
      window.logMonitorApi.closeWebContentWindow();
    } else {
      console.log('Profile button clicked while inactive: Opening window to profile.');
      window.logMonitorApi.openWebContentWindow('profile');
    }
  } catch (error) {
    console.error("Failed to toggle web content window for profile:", error);
  }
}

const openLeaderboard = () => {
  try {
    if (isLeaderboardActive.value) {
      console.log('Leaderboard button clicked while active: Closing window.');
      window.logMonitorApi.closeWebContentWindow();
    } else {
      console.log('Leaderboard button clicked while inactive: Opening window to leaderboard.');
      window.logMonitorApi.openWebContentWindow('leaderboard');
    }
  } catch (error) {
    console.error("Failed to toggle web content window for leaderboard:", error);
  }
}

const openMap = () => {
  try {
    if (isMapActive.value) {
      console.log('Map button clicked while active: Closing window.');
      window.logMonitorApi.closeWebContentWindow();
    } else {
      console.log('Map button clicked while inactive: Opening window to map.');
      window.logMonitorApi.openWebContentWindow('map');
    }
  } catch (error) {
    console.error("Failed to toggle web content window for map:", error);
  }
}

// --- Computed Properties ---

// Show all events in the kill feed
const currentEvents = computed(() => {
  // If we're using search mode, return search results
  if (isUsingSearch.value) {
    return searchResults.value;
  }

  // Show all events - the EventStore already provides the appropriate events
  // No filtering needed as the server/EventStore handles what should be displayed
  return allEvents.value;
});

// For backward compatibility, keep the same computed name but now it just returns currentEvents
// since searching is handled separately via the EventStore
const sortedFilteredEvents = computed(() => {
  // Events are already sorted by the EventStore (newest first)
  return currentEvents.value;
});

// --- BADGE COMPUTED PROPERTIES ---
const isMonitoringActive = computed(() => {
  const statusCheck = logStatus.value.toLowerCase().includes('active') || logStatus.value.toLowerCase().includes('monitoring started');

  // Check if there are any events and if the most recent event is within the last 60 seconds
  const hasRecentEvent = currentEvents.value.length > 0 &&
                         (new Date().getTime() - new Date(currentEvents.value[0].timestamp).getTime()) < 60000;

  return statusCheck || hasRecentEvent;
});

const monitoringBadge = computed(() => ({
  text: isMonitoringActive.value ? 'Monitoring' : 'Not Monitoring',
  class: isMonitoringActive.value
    ? 'inline-flex items-center rounded-md bg-green-50 px-2 py-1 text-xs font-medium text-green-700 ring-1 ring-green-600/20 ring-inset'
    : 'inline-flex items-center rounded-md bg-gray-50 px-2 py-1 text-xs font-medium text-gray-600 ring-1 ring-gray-500/10 ring-inset'
}));

const loginBadge = computed(() => {
  if (isOffline.value) {
    return {
      text: 'Offline',
      class: 'inline-flex items-center rounded-md bg-gray-50 px-2 py-1 text-xs font-medium text-gray-600 ring-1 ring-gray-500/10 ring-inset'
    };
  }
  // Use only isAuthenticated for "Logged In" status, regardless of connectionStatus
  if (isAuthenticated.value) {
    return {
      text: 'Logged In',
      class: 'inline-flex items-center rounded-md bg-green-50 px-2 py-1 text-xs font-medium text-green-700 ring-1 ring-green-600/20 ring-inset'
    };
  }
  return {
    text: 'Guest',
    class: 'inline-flex items-center rounded-md bg-yellow-50 px-2 py-1 text-xs font-medium text-yellow-800 ring-1 ring-yellow-600/20 ring-inset'
  };
});

const modeBadge = computed(() => {
  switch (currentGameMode.value) {
    case 'PU':
      return {
        text: 'PU',
        class: 'inline-flex items-center rounded-md bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700 ring-1 ring-blue-700/10 ring-inset'
      };
    case 'AC':
      return {
        text: 'AC',
        class: 'inline-flex items-center rounded-md bg-indigo-50 px-2 py-1 text-xs font-medium text-indigo-700 ring-1 ring-indigo-700/10 ring-inset'
      };
    default:
      return {
        text: '?',
        class: 'inline-flex items-center rounded-md bg-gray-50 px-2 py-1 text-xs font-medium text-gray-600 ring-1 ring-gray-500/10 ring-inset'
      };
  }
});

const feedModeBadge = computed(() => {
  // Server determines what events this client receives - client just displays them
  const hasServerEvents = allEvents.value.some(event => event.metadata?.source?.external);
  
  if (hasServerEvents) {
    return {
      text: 'Mixed Events',
      class: 'inline-flex items-center rounded-md bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700 ring-1 ring-blue-600/20 ring-inset'
    };
  }
  return {
    text: 'Local Events',
    class: 'inline-flex items-center rounded-md bg-gray-50 px-2 py-1 text-xs font-medium text-gray-600 ring-1 ring-gray-500/10 ring-inset'
  };
});

// Removed old statusIndicatorClass computed property

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

// Removed toggleFeedMode and loadFeedModePreference functions

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

// Enhanced kill events loading with proper scroll setup
const loadKillEvents = async () => {
  try {
    console.log('[KillFeed] 🚀 Starting initial event load...');
    
    // Load initial events from EventStore
    const serverEvents = await window.logMonitorApi.getGlobalKillEvents(25);

    // Update unified event array
    allEvents.value = serverEvents;

    // Check if there are more events available by trying to load one more batch
    // This determines if infinite scroll should be enabled
    const moreEventsCheck = await window.logMonitorApi.loadMoreEvents(1, serverEvents.length);
    hasMoreEvents.value = moreEventsCheck.hasMore || moreEventsCheck.events.length > 0;

    console.log(`[KillFeed] ✅ Initial load: ${serverEvents.length} events, hasMoreEvents: ${hasMoreEvents.value}`);

    // Scroll to top after initial load and setup scroll detection
    nextTick(() => {
      if (killFeedListRef.value) {
        killFeedListRef.value.scrollTop = 0;
        
        // Validate container and enable scroll detection after a short delay
        setTimeout(() => {
          const isValid = validateScrollContainer();
          if (isValid) {
            scrollDetectionEnabled.value = true;
            console.log('[KillFeed] 🚀 Scroll detection enabled after initial load');
          } else {
            console.log('[KillFeed] ⚠️ Container not ready for scroll detection yet');
            // Retry validation in 1 second
            setTimeout(() => {
              if (validateScrollContainer()) {
                scrollDetectionEnabled.value = true;
                console.log('[KillFeed] 🚀 Scroll detection enabled after retry');
              }
            }, 1000);
          }
          
          // Stats section removed - clean up completed
        }, 500); // 500ms delay to ensure DOM is fully updated
      }
    });
  } catch (error) {
    console.error('[KillFeed] ⚠️ Failed to load kill events:', error);
    hasMoreEvents.value = false; // Assume no more events on error
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
  if (playSoundEffects.value && resourcePath.value) { // Check if path is loaded
    try {
      const soundFilePath = `file://${resourcePath.value}/sounds/kill-event.m4a`; // Construct full file path
      console.debug(`Attempting to play sound: ${soundFilePath}`); // Use console.debug in renderer

      // Create a new Audio instance each time
      const sound = new Audio(soundFilePath);

      // Play with error handling
      sound.play().catch(err => {
        console.warn(`Sound play failed for ${soundFilePath}:`, err);
        // Common reasons: User hasn't interacted, file not found, format unsupported
      });
    } catch (err) {
      console.error(`Error initializing or playing sound from ${resourcePath.value}:`, err);
    }
  } else if (!resourcePath.value) {
      console.warn("Cannot play sound: Resource path not yet loaded.");
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


// Function to check authentication status
const checkAuthStatus = async () => {
  try {
    if (window.logMonitorApi?.authGetStatus) {
      const status = await window.logMonitorApi.authGetStatus();
      isAuthenticated.value = status.isAuthenticated;
      console.log(`[KillFeed] Auth status checked: ${isAuthenticated.value}`);
    } else {
      console.warn('[KillFeed] authGetStatus API not available.');
      isAuthenticated.value = false; // Assume not authenticated if API is missing
    }
  } catch (error) {
    console.error('[KillFeed] Error checking auth status:', error);
    isAuthenticated.value = false; // Assume not authenticated on error
  }
};


// Function to get initial offline mode status
const checkOfflineMode = async () => {
  try {
    if (window.logMonitorApi?.getApiSettings) {
      const settings = await window.logMonitorApi.getApiSettings();
      isOffline.value = settings.offlineMode;
      console.log(`[KillFeed] Offline mode status checked: ${isOffline.value}`);
    } else {
      console.warn('[KillFeed] getApiSettings API not available.');
      isOffline.value = false; // Assume online if API is missing
    }
  } catch (error) {
    console.error('[KillFeed] Error checking offline mode status:', error);
    isOffline.value = false; // Assume online on error
  }
};


// Function to get initial window states synchronously
const getInitialWindowStates = async () => {
  try {
    if (window.logMonitorApi?.getSettingsWindowStatus) {
      const settingsStatus = await window.logMonitorApi.getSettingsWindowStatus();
      console.log('[KillFeed] Initial settings status:', settingsStatus);
      isSettingsActive.value = settingsStatus.isOpen;
    } else {
      console.warn('[KillFeed] getSettingsWindowStatus API not available for initial check.');
    }

    if (window.logMonitorApi?.getWebContentWindowStatus) {
      const webContentStatus = await window.logMonitorApi.getWebContentWindowStatus();
      console.log('[KillFeed] Initial web content status:', webContentStatus);
      // Set based on initial status
      isProfileActive.value = webContentStatus.isOpen && webContentStatus.activeSection === 'profile';
      isLeaderboardActive.value = webContentStatus.isOpen && webContentStatus.activeSection === 'leaderboard';
      isMapActive.value = webContentStatus.isOpen && webContentStatus.activeSection === 'map';
       // Ensure all are false if closed initially
       if (!webContentStatus.isOpen) {
         isProfileActive.value = false;
         isLeaderboardActive.value = false;
         isMapActive.value = false;
       }
    } else {
      console.warn('[KillFeed] getWebContentWindowStatus API not available for initial check.');
    }
  } catch (error) {
    console.error('[KillFeed] Error getting initial window states:', error);
  }
};

// Search handling functions
const handleSearch = async (query: string) => {
  if (!query.trim()) {
    // Clear search mode
    isUsingSearch.value = false;
    searchResults.value = [];
    searchOffset.value = 0;
    console.log('[KillFeed] Search cleared');
    return;
  }

  try {
    isSearching.value = true;
    isUsingSearch.value = true;
    searchOffset.value = 0;

    console.log(`[KillFeed] Searching for: "${query}"`);
    
    // Use EventStore search functionality via IPC
    const results = await window.logMonitorApi.searchEvents(query, 25, 0);
    searchResults.value = results.events;
    hasMoreEvents.value = results.hasMore;
    
    console.log(`[KillFeed] Search returned ${results.events.length} results`);
  } catch (error) {
    console.error('[KillFeed] Search failed:', error);
    searchResults.value = [];
    hasMoreEvents.value = false;
  } finally {
    isSearching.value = false;
  }
};

// Watch for search query changes
let searchTimeout: NodeJS.Timeout | null = null;
const debouncedSearch = (query: string) => {
  if (searchTimeout) {
    clearTimeout(searchTimeout);
  }
  searchTimeout = setTimeout(() => {
    handleSearch(query);
  }, 300); // 300ms debounce
};

// Initialize search watcher (will be set up in onMounted)
let unwatchSearch: (() => void) | null = null;

// Scroll container validation function
const validateScrollContainer = () => {
  if (!killFeedListRef.value) {
    return false;
  }
  
  const container = killFeedListRef.value;
  const scrollHeight = container.scrollHeight;
  const clientHeight = container.clientHeight;
  const canScroll = scrollHeight > clientHeight;
  
  // Container is ready if it has content and can scroll, or if it can't scroll but has events to load
  const isReady = (canScroll || (hasMoreEvents.value && currentEvents.value.length > 0));
  containerReady.value = isReady;
  
  return isReady;
};

// Throttled scroll handler for infinite scroll
const handleScroll = (event: Event) => {
  const now = Date.now();
  
  // Throttle scroll events
  if (now - lastScrollTime.value < scrollThrottleMs) {
    return;
  }
  lastScrollTime.value = now;
  
  // Only process if scroll detection is enabled and container is ready
  if (!scrollDetectionEnabled.value || !containerReady.value) {
    return;
  }
  
  const container = event.target as HTMLElement;
  if (!container) {
    console.warn('[KillFeed] Scroll event target is not an HTMLElement');
    return;
  }
  
  const scrollTop = container.scrollTop;
  const scrollHeight = container.scrollHeight;
  const clientHeight = container.clientHeight;
  
  // Ensure we have valid dimensions
  if (scrollHeight <= 0 || clientHeight <= 0) {
    console.warn('[KillFeed] Invalid container dimensions:', { scrollHeight, clientHeight });
    return;
  }
  
  // Calculate distance from bottom
  const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
  
  // Calculate scroll percentage (how far down we are)
  const scrollPercentage = (scrollTop + clientHeight) / scrollHeight;
  
  // Adaptive trigger distance based on viewport height
  const baseTriggerDistance = Math.max(100, Math.min(300, clientHeight * 0.15));
  const adaptiveTriggerDistance = Math.max(baseTriggerDistance, 200);
  
  // Check if near bottom using both pixel distance and percentage
  const isNearBottom = distanceFromBottom <= adaptiveTriggerDistance || scrollPercentage >= 0.90;
  
  // Also check if scrollbar is at absolute bottom
  const isAtBottom = distanceFromBottom <= 5;
  
  // Special handling for absolute bottom
  if (isAtBottom && !isLoadingMore.value && hasMoreEvents.value) {
    console.log('[KillFeed] User scrolled to bottom - loading more events');
    loadMoreEvents();
    return;
  }
  
  // Trigger load more when near bottom
  if (isNearBottom && !isLoadingMore.value && hasMoreEvents.value) {
    console.log('[KillFeed] Near bottom - loading more events');
    loadMoreEvents();
  }
};

const loadMoreEvents = async () => {
  if (isLoadingMore.value || !hasMoreEvents.value) {
    return;
  }

  try {
    isLoadingMore.value = true;
    console.log('[KillFeed] 📥 Starting to load more events...');

    if (isUsingSearch.value && searchQuery.value.trim()) {
      // Load more search results
      const offset = searchResults.value.length;
      console.log(`[KillFeed] Loading more search results (offset: ${offset})`);
      const results = await window.logMonitorApi.searchEvents(searchQuery.value, 25, offset);
      
      searchResults.value = [...searchResults.value, ...results.events];
      hasMoreEvents.value = results.hasMore;
      console.log(`[KillFeed] Loaded ${results.events.length} more search results (hasMore: ${results.hasMore})`);
    } else {
      // Load more regular events via EventStore
      const offset = allEvents.value.length;
      console.log(`[KillFeed] Loading more regular events (current count: ${allEvents.value.length}, offset: ${offset})`);
      const results = await window.logMonitorApi.loadMoreEvents(25, offset);
      
      console.log(`[KillFeed] Received ${results.events.length} events from API (hasMore: ${results.hasMore})`);
      
      // Add new events to existing array (avoiding duplicates)
      const newEvents = results.events.filter(event => 
        !allEvents.value.some(existing => existing.id === event.id)
      );
      
      const beforeCount = allEvents.value.length;
      allEvents.value = [...allEvents.value, ...newEvents];
      hasMoreEvents.value = results.hasMore;
      
      console.log(`[KillFeed] 🚀 Added ${newEvents.length} new events (${beforeCount} -> ${allEvents.value.length}), hasMore: ${results.hasMore}`);
    }
    
    // Re-validate container after loading new events
    nextTick(() => {
      validateScrollContainer();
    });
    
  } catch (error) {
    console.error('[KillFeed] ⚠️ Failed to load more events:', error);
    // On error, disable hasMoreEvents temporarily and retry after delay
    hasMoreEvents.value = false;
    
    // Re-enable after 5 seconds to allow for retry
    setTimeout(() => {
      if (!hasMoreEvents.value) {
        console.log('[KillFeed] Re-enabling hasMoreEvents after error timeout');
        hasMoreEvents.value = true;
      }
    }, 5000);
  } finally {
    isLoadingMore.value = false;
    console.log('[KillFeed] ✅ Load more events completed, isLoadingMore reset to false');
  }
};

// Production implementation - no debug functions


onMounted(async () => { // Make onMounted async
  // Get initial states synchronously FIRST
  await getInitialWindowStates();

  // Then proceed with setting up listeners and loading data
  Promise.all([
    checkAuthStatus(),
    checkOfflineMode(), // Check offline mode
    // Fetch resource path
    (async () => {
        try {
            if (window.logMonitorApi?.getResourcePath) {
                resourcePath.value = await window.logMonitorApi.getResourcePath();
                console.log(`[KillFeed] Resource path loaded: ${resourcePath.value}`);
            } else {
                 console.warn('[KillFeed] getResourcePath API not available.');
            }
        } catch (error) {
             console.error('[KillFeed] Error getting resource path:', error);
        }
    })(),
    loadSoundEffectsSetting(),
    // Add listener for auth status changes
    (() => {
      if (window.logMonitorApi?.onAuthStatusChanged) {
        const cleanup = window.logMonitorApi.onAuthStatusChanged((_event, status) => {
          console.log('[KillFeed] Received auth status update:', status);
          isAuthenticated.value = status.isAuthenticated;
        });
        cleanupFunctions.push(cleanup);
      } else {
        console.warn('[KillFeed] onAuthStatusChanged API not available.');
      }
    })(),
    // Add listener for connection status changes
    (() => {
      if (window.logMonitorApi?.onConnectionStatusChanged) {
        const cleanup = window.logMonitorApi.onConnectionStatusChanged((_event, status) => {
          console.log('[KillFeed] Received connection status update:', status);
          connectionStatus.value = status;
        });
        cleanupFunctions.push(cleanup);
      } else {
        console.warn('[KillFeed] onConnectionStatusChanged API not available.');
      }
    })(),
    // Add listener for stable game mode updates
    (() => {
      if (window.logMonitorApi?.onGameModeUpdate) {
        const cleanup = window.logMonitorApi.onGameModeUpdate((_event: IpcRendererEvent, mode: 'PU' | 'AC' | 'Unknown') => {
          console.log('[KillFeed] Received game mode update:', mode);
          currentGameMode.value = mode;
        });
        cleanupFunctions.push(cleanup);
      } else {
         console.warn('[KillFeed] onGameModeUpdate API not available.');
      }
    })(),
    // Add listener for Settings window status
    (() => {
      if (window.logMonitorApi?.onSettingsWindowStatus) {
        const cleanup = window.logMonitorApi.onSettingsWindowStatus((_event, status: { isOpen: boolean }) => {
          console.log('[KillFeed] Received settings window status update:', status);
          isSettingsActive.value = status.isOpen;
        });
        cleanupFunctions.push(cleanup);
      } else {
        console.warn('[KillFeed] onSettingsWindowStatus API not available.');
      }
    })(),
    // Add listener for Web Content window status
    (() => {
      if (window.logMonitorApi?.onWebContentWindowStatus) {
        const cleanup = window.logMonitorApi.onWebContentWindowStatus((_event, status: { isOpen: boolean, activeSection: 'profile' | 'leaderboard' | 'stats' | 'map' | '/' | null }) => {
          console.log('[KillFeed] Received web content window status update:', status);
          isProfileActive.value = status.isOpen && status.activeSection === 'profile';
          isLeaderboardActive.value = status.isOpen && status.activeSection === 'leaderboard';
          isMapActive.value = status.isOpen && status.activeSection === 'map';
          // Add other active states here if needed for 'stats' or '/'
          // If web content window is closed, ensure all relevant states are inactive
          if (!status.isOpen) {
            isProfileActive.value = false;
            isLeaderboardActive.value = false;
            isMapActive.value = false;
            // Reset other active states too if they exist
          }
        });
        cleanupFunctions.push(cleanup);
      } else {
        console.warn('[KillFeed] onWebContentWindowStatus API not available.');
      }
    })()
 ]).then(() => loadKillEvents()); // Load events after checking auth, offline mode, and settings

 // Listen for events from local parsing and server filtering
 cleanupFunctions.push(
    window.logMonitorApi.onKillFeedEvent((_event, data: { event: KillEvent, source: 'server' | 'local' } | null) => {
      if (data === null) {
        // Handle signal to clear events
        console.log("Received signal to clear kill events.");
        allEvents.value = [];
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

        killEvent = data.event;
        const source = data.source;

        // Validate the event object itself
        if (!killEvent || !killEvent.id || !killEvent.timestamp) {
          console.error('Received invalid kill event object:', killEvent);
          return;
        }

        // Enhanced logging for server events
        if (source === 'server') {
          console.log('\n🟢 ═══════════════════════════════════════════════════════════════');
          console.log('📥 RENDERER: SERVER EVENT RECEIVED VIA IPC');
          console.log(`   Event ID: ${killEvent.id}`);
          console.log(`   Event Type: ${killEvent.deathType}`);
          console.log(`   Killers: ${killEvent.killers.join(', ')}`);
          console.log(`   Victims: ${killEvent.victims.join(', ')}`);
          console.log(`   Description: ${killEvent.eventDescription}`);
          console.log(`   Player Involved: ${killEvent.isPlayerInvolved}`);
          console.log(`   Metadata: ${JSON.stringify(killEvent.metadata)}`);
          console.log('🔄 Adding to unified event array...');
        } else {
          console.log(`Received ${source} event:`, killEvent);
        }

        // Update current player's ship if included
        if (killEvent.playerShip) {
          currentPlayerShip.value = killEvent.playerShip;
        }

        // Add event source metadata for visual indicators
        if (!killEvent.metadata) {
          killEvent.metadata = {};
        }
        // Determine source type for metadata
        const isServerSource = source === 'server';
        const isLocalSource = source === 'local';
        
        killEvent.metadata.source = {
          server: isServerSource,
          local: isLocalSource,
          external: isServerSource // Server/global events are external
        };

        // Find existing event by ID in unified event array
        const existingIndex = allEvents.value.findIndex((ev: KillEvent) => ev.id === killEvent!.id);

        if (existingIndex !== -1) {
          // Existing event found - REPLACE it (e.g., local event gets server verification)
          console.log(`Updated existing event: ${killEvent.id}`);
          const updatedEvents = [...allEvents.value];
          updatedEvents[existingIndex] = killEvent;
          allEvents.value = updatedEvents;
          
          // Trigger update animation
          const eventId = killEvent.id;
          recentlyUpdatedIds.value.add(eventId);
          setTimeout(() => recentlyUpdatedIds.value.delete(eventId), 1000);
        } else {
          // New event - add to unified array
          if (source === 'server') {
            console.log(`✅ RENDERER: Added new SERVER event: ${killEvent.id}`);
            console.log(`   Total events in array: ${allEvents.value.length + 1}`);
            console.log('═══════════════════════════════════════════════════════════════\n');
          } else {
            console.log(`Added new ${source} event: ${killEvent.id}`);
          }
          
          const newEvents = [killEvent, ...allEvents.value];
          allEvents.value = newEvents;
          wasNewEvent = true;

          // Play sound effect for new events
          playKillSound();
        }

        if (source !== 'server') {
          console.log(`Total events: ${allEvents.value.length}`);
        }

      } catch (error) {
        console.error('Error processing kill feed event:', error);
      }

      // Scroll to top for new events
      if (killEvent && wasNewEvent) {
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

  // Set up search watcher using Vue's reactivity
  unwatchSearch = watch(searchQuery, (newQuery) => {
    debouncedSearch(newQuery);
  });

  // Enhanced scroll event listener setup with main process logging - FIXED with proper timing
  const setupScrollListeners = () => {
    if (killFeedListRef.value) {
      // Add scroll listener for infinite scroll
      killFeedListRef.value.addEventListener('scroll', handleScroll, { passive: true });
      console.log('[KillFeed] Scroll listener attached for infinite scroll');
      
      // Set up resize observer to handle container changes
      const resizeObserver = new ResizeObserver(() => {
        validateScrollContainer();
      });
      resizeObserver.observe(killFeedListRef.value);
      
      // Store cleanup function for resize observer
      cleanupFunctions.push(() => {
        resizeObserver.disconnect();
      });
      
      // Auto-enable scroll detection if container becomes ready
      if (!scrollDetectionEnabled.value && validateScrollContainer()) {
        scrollDetectionEnabled.value = true;
        console.log('[KillFeed] Scroll detection enabled');
      }
      
      return true; // Success
    } else {
      console.error('[KillFeed] ⚠️ killFeedListRef.value is null, cannot add scroll listener');
      return false; // Failed
    }
  };
  
  // Try setting up scroll listeners with retry logic
  const trySetupWithRetries = (maxRetries = 5, delay = 100) => {
    let attempts = 0;
    const attemptSetup = () => {
      attempts++;
      
      if (setupScrollListeners()) {
        console.log('[KillFeed] ✅ Scroll listeners setup successful!');
        return;
      }
      
      if (attempts < maxRetries) {
        setTimeout(attemptSetup, delay * attempts); // Increasing delay
      } else {
        console.error('[KillFeed] ❌ Failed to setup scroll listeners after all retries');
      }
    };
    
    nextTick(attemptSetup);
  };
  
  // Start the retry process
  trySetupWithRetries();

  // No longer need the cleanup for the interval
});

onUnmounted(() => {
  // Clean up search watcher
  if (unwatchSearch) {
    unwatchSearch();
  }
  
  // Clean up scroll listener
  if (killFeedListRef.value) {
    killFeedListRef.value.removeEventListener('scroll', handleScroll);
  }
  
  // Clean up other listeners
  cleanupFunctions.forEach(cleanup => cleanup());
});

// Generate dynamic tooltip for server source indicator
const getServerSourceTooltip = (event: KillEvent): string => {
  const hasServer = event.metadata?.source?.server;
  const hasLocal = event.metadata?.source?.local;
  
  if (hasServer && hasLocal) {
    return "Server confirmed this local event";
  } else if (hasServer && !hasLocal) {
    return "Event from another client";
  } else {
    return "External event";
  }
};
</script>

<template>
  <div class="kill-feed-container">
    <!-- Update Banner Container with matching background -->
    <div class="update-banner-container">
      <UpdateBanner />
    </div>
    
    <!-- Controls bar -->
    <!-- Controls bar - Removed Mode Toggle, Search takes full width -->
    <div class="controls-container full-width-search">
      <input
        v-model="searchQuery"
        placeholder="Search events (Player, Ship, Location, Weapon...)"
        class="search-input"
        type="text"
      >
    </div>

    <!-- Status bar with Pips -->
    <div class="status-bar">
      <div class="status-badges-container">
        <span :class="feedModeBadge.class">{{ feedModeBadge.text }}</span>
        <span :class="loginBadge.class">{{ loginBadge.text }}</span>
        <span :class="monitoringBadge.class">{{ monitoringBadge.text }}</span>
        <span v-if="modeBadge.text !== '?'" :class="modeBadge.class">{{ modeBadge.text }}</span>
      </div>
      <!-- Right-aligned Icon Buttons (Order: Map, Leaderboard, Profile, Settings) -->
      <div class="status-icons-container">
        <div
          @click="openMap"
          class="status-icon-button"
          :class="{ active: isMapActive }"
          title="Map"
        >
          <el-icon><MapLocation /></el-icon>
        </div>
        <div
          @click="openLeaderboard"
          class="status-icon-button"
          :class="{ active: isLeaderboardActive }"
          title="Leaderboard"
        >
          <el-icon><Tickets /></el-icon>
        </div>
        <div
          @click="openProfile"
          class="status-icon-button"
          :class="{ active: isProfileActive }"
          title="Profile"
        >
          <el-icon><User /></el-icon>
        </div>
        <div
          @click="openSettingsWindow"
          class="status-icon-button"
          :class="{ active: isSettingsActive }"
          title="Settings"
        >
          <el-icon><Setting /></el-icon>
        </div>
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
    <div v-else class="kill-feed-scroll-area" 
         ref="killFeedListRef"
         tabindex="0"
         style="outline: none;">
        <!-- Apply flex layout and gap to the transition-group's rendered div -->
        <transition-group name="feed-anim" tag="div" class="feed-items-container">
        <div
          v-for="event in sortedFilteredEvents"
          :key="event.id"
          class="kill-event-item clickable"
          :class="[
          getEventClass(event.deathType),
          // Highlight player events when viewing global feed (if authenticated)
          { 'player-involved': event.isPlayerInvolved && isAuthenticated },
            { 'updated': recentlyUpdatedIds.has(event.id) } // Add class if ID is recently updated
          ]"
          @click="openEventDetails(event)"
          @mousedown="console.log('KillFeed: mousedown on event', event.id)"
          @mouseup="console.log('KillFeed: mouseup on event', event.id)"
        >
          <div class="event-header">
          <!-- <span class="event-icon">{{ getEventIcon(event.deathType) }}</span> -->
          <span class="event-icon-blank"></span>
          <span class="event-death-type">
            {{ event.deathType }} Death
            <!-- Display secondary death type if merged -->
            <span v-if="event.data?.secondaryDeathType" class="secondary-death-type">
              + {{ event.data?.secondaryDeathType }} <!-- Added optional chaining -->
            </span>
          </span>
          <!-- Game Mode Pill -->
          <span v-if="event.gameMode && event.gameMode !== 'Unknown'" class="event-mode-pill">{{ event.gameMode }}</span>
          <!-- Player Involved Badge -->
          <!-- Show 'OTHER' badge if event involves player and user is viewing global feed -->
          <span v-if="event.isPlayerInvolved && isAuthenticated" class="player-other-badge">OTHER</span>
          <span class="event-location" v-if="event.location">{{ event.location }}</span>
          <span class="event-time">{{ formatTime(event.timestamp) }}
            <!-- Server Source Indicator (subtle pip) - moved under time -->
            <span v-if="event.metadata?.source?.server || event.metadata?.source?.external" 
                  class="server-source-pip" 
                  :title="getServerSourceTooltip(event)">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zM6.838 12.434c.068 1.217.347 2.358.784 3.364l.952-.952c-.225-.627-.359-1.329-.41-2.102h-1.326zm1.326-1.668c.051-.773.185-1.475.41-2.102l-.952-.952c-.437 1.006-.716 2.147-.784 3.364h1.326zm1.979-4.515l.952.952c.627-.225 1.329-.359 2.102-.41V5.467c-1.217.068-2.358.347-3.364.784zm3.857.41c.773.051 1.475.185 2.102.41l.952-.952c-1.006-.437-2.147-.716-3.364-.784v1.326zm4.515 1.979l-.952.952c.225.627.359 1.329.41 2.102h1.326c-.068-1.217-.347-2.358-.784-3.364zm-.41 3.857c-.051.773-.185 1.475-.41 2.102l.952.952c.437-1.006.716-2.147.784-3.364h-1.326zm-1.979 4.515l-.952-.952c-.627.225-1.329.359-2.102.41v1.326c1.217-.068 2.358-.347 3.364-.784zm-3.857-.41c-.773-.051-1.475-.185-2.102-.41l-.952.952c1.006.437 2.147.716 3.364.784v-1.326zM12 8c-2.206 0-4 1.794-4 4s1.794 4 4 4 4-1.794 4-4-1.794-4-4-4z"/>
              </svg>
            </span>
          </span>
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
              <div class="attackers player-info">
                <span v-for="(attacker, index) in event.killers" :key="attacker" class="player-entry">
                  <UserAvatar :user-handle="attacker" :size="20" class="avatar" />
                  <span class="player-name">{{ attacker }}</span>
                  <span v-if="index < event.killers.length - 1" class="operator"> + </span>
                </span>
              </div>
              <span class="separator">{{ getSeparator(event.deathType) }}</span>
              <div class="victims player-info">
                <template v-for="(victim, index) in event.victims" :key="victim">
                  <span class="player-entry">
                    <UserAvatar :user-handle="victim" :size="20" class="avatar" />
                    <!-- Display cleaned vehicle name if victim is a ship ID, otherwise the victim name -->
                    <span class="player-name">{{ victim.includes('_') ? cleanShipName(event.vehicleType || victim) : victim }}</span>
                  </span>
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
       
       <!-- Loading indicator for infinite scroll -->
       <div v-if="isLoadingMore" class="loading-indicator">
         <div class="loading-spinner"></div>
         <span>Loading more events...</span>
       </div>
       
       <!-- Search status indicator -->
       <div v-if="isSearching" class="search-indicator">
         <div class="loading-spinner"></div>
         <span>Searching...</span>
       </div>
       
       <!-- End of events indicator -->
       <div v-if="!hasMoreEvents && currentEvents.length > 0 && !isLoadingMore" class="end-indicator">
         <span>{{ isUsingSearch ? 'No more search results' : 'All events loaded' }}</span>
       </div>
       
     <!-- The v-else-if conditions are handled earlier, this closes the v-else div -->
    </div>

    <!-- Stats section removed -->

  </div> <!-- Close kill-feed-container -->
</template>

<style scoped>
.status-badges-container {
  display: flex;
  gap: 8px;
  align-items: center;
}

/* Badge base style (for fallback if Tailwind is not present) */
.inline-flex {
  display: inline-flex;
  align-items: center;
}
.rounded-md { border-radius: 0.375rem; }
.px-2 { padding-left: 0.5rem; padding-right: 0.5rem; }
.py-1 { padding-top: 0.25rem; padding-bottom: 0.25rem; }
.text-xs { font-size: 0.75rem; line-height: 1rem; }
.font-medium { font-weight: 500; }
.ring-1 { box-shadow: 0 0 0 1px rgba(0,0,0,0.05); }
.ring-inset { box-shadow: inset 0 0 0 1px rgba(0,0,0,0.05); }

/* Color classes for badges (fallbacks for Tailwind) */
.bg-gray-50 { background-color: #f9fafb; }
.text-gray-600 { color: #4b5563; }
.ring-gray-500\/10 { box-shadow: 0 0 0 1px rgba(107,114,128,0.1); }
.bg-red-50 { background-color: #fef2f2; }
.text-red-700 { color: #b91c1c; }
.ring-red-600\/10 { box-shadow: 0 0 0 1px rgba(220,38,38,0.1); }
.bg-yellow-50 { background-color: #fffbeb; }
.text-yellow-800 { color: #92400e; }
.ring-yellow-600\/20 { box-shadow: 0 0 0 1px rgba(202,138,4,0.2); }
.bg-green-50 { background-color: #ecfdf5; }
.text-green-700 { color: #047857; }
.ring-green-600\/20 { box-shadow: 0 0 0 1px rgba(5,150,105,0.2); }
.bg-blue-50 { background-color: #eff6ff; }
.text-blue-700 { color: #1d4ed8; }
.ring-blue-700\/10 { box-shadow: 0 0 0 1px rgba(29,78,216,0.1); }
.bg-indigo-50 { background-color: #eef2ff; }
.text-indigo-700 { color: #4338ca; }
.ring-indigo-700\/10 { box-shadow: 0 0 0 1px rgba(67,56,202,0.1); }

/* --- DARK MODE BADGES --- */
@media (prefers-color-scheme: dark) {
  .bg-gray-50 { background-color: #23272e !important; }
  .text-gray-600 { color: #d1d5db !important; }
  .ring-gray-500\/10 { box-shadow: 0 0 0 1px rgba(156,163,175,0.2) !important; }
  .bg-red-50 { background-color: #4b1e1e !important; }
  .text-red-700 { color: #fca5a5 !important; }
  .ring-red-600\/10 { box-shadow: 0 0 0 1px rgba(252,165,165,0.25) !important; }
  .bg-yellow-50 { background-color: #4b3a1e !important; }
  .text-yellow-800 { color: #fde68a !important; }
  .ring-yellow-600\/20 { box-shadow: 0 0 0 1px rgba(253,224,71,0.25) !important; }
  .bg-green-50 { background-color: #1e3a2f !important; }
  .text-green-700 { color: #6ee7b7 !important; }
  .ring-green-600\/20 { box-shadow: 0 0 0 1px rgba(16,185,129,0.25) !important; }
  .bg-blue-50 { background-color: #1e293b !important; }
  .text-blue-700 { color: #93c5fd !important; }
  .ring-blue-700\/10 { box-shadow: 0 0 0 1px rgba(147,197,253,0.25) !important; }
  .bg-indigo-50 { background-color: #312e81 !important; }
  .text-indigo-700 { color: #c7d2fe !important; }
  .ring-indigo-700\/10 { box-shadow: 0 0 0 1px rgba(199,210,254,0.25) !important; }
}

.status-bar {
  display: flex;
  padding: 8px 15px;
  background-color: #171717;  /* charcoal-900 */
  border-bottom: 1px solid #262626;  /* charcoal-800 */
  justify-content: space-between;
  font-size: 0.8em;
  flex-shrink: 0;
  align-items: center;
}

/* Container for right-aligned icons */
.status-icons-container {
  display: flex;
  align-items: center;
  gap: 12px; /* Spacing between icons */
}

.status-icon-button {
  color: rgb(163, 163, 163);  /* charcoal-400 */
  font-size: 1.3em;
  cursor: pointer;
  transition: color 0.2s ease;
  display: flex;
  align-items: center;
}

.status-icon-button:hover {
  color: rgb(99, 99, 247);  /* primary-500 */
}

.status-icon-button.active {
  color: rgb(77, 77, 234);  /* primary-600 */
}
.kill-feed-container {
  display: flex;
  flex-direction: column;
  height: 100%; /* Use parent's full height */
  width: 100%;
  margin: 0;
  background-color: #1a1a1a;
  padding: 0;
  overflow: hidden;
  box-sizing: border-box;
  position: relative;
}

/* Ensure the Vue app root takes full height */
#app {
  height: 100vh;
  overflow: hidden;
}

.update-banner-container {
  background-color: #171717;
  flex-shrink: 0;
}

/* Controls container */
.controls-container {
  display: flex;
  padding: 12px 15px;
  background-color: #171717; /* charcoal-900 to match web content */
  border-bottom: 1px solid #262626; /* charcoal-800 to match web content */
  flex-shrink: 0;
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
  flex-grow: 1;
  padding: 8px 12px;
  background-color: #262626; /* charcoal-800 */
  border: 1px solid #404040; /* charcoal-700 */
  color: white;
  border-radius: 4px;
  font-size: 0.9em;
}
.search-input:focus {
  outline: none;
  border-color: rgb(99, 99, 247); /* primary-500 */
  box-shadow: 0 0 0 1px rgba(99, 99, 247, 0.2);
}
.search-input::placeholder {
  color: #777;
}

/* Ensure search input takes full width when toggle is removed */
.controls-container.full-width-search .search-input {
  width: 100%; /* Explicitly set width */
  flex-grow: 1; /* Keep flex-grow as well */
}

/* Status bar */
/* .status-bar styles moved up */

/* New Pip Styles */
.status-pips-container {
  display: flex;
  align-items: center;
  gap: 8px; /* Spacing between pips */
}

.status-pip {
  width: 20px; /* Adjust size as needed */
  height: 10px;
  border-radius: 3px; /* Rectangular pips */
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.7em;
  font-weight: bold;
  color: white;
  text-shadow: 1px 1px 1px rgba(0,0,0,0.5);
  line-height: 1; /* Ensure text fits vertically */
  overflow: hidden; /* Hide overflow text */
  white-space: nowrap; /* Prevent text wrapping */
}

.monitoring-pip { /* Only color, no text */
   width: 10px; /* Make monitoring pip smaller */
   border-radius: 50%; /* Make it round */
}

/* Pip Color States */
.status-green { background-color: #4caf50; }
.status-orange { background-color: #f39c12; }
.status-blue-pu { background-color: #3498db; }
.status-purple-ac { background-color: #9b59b6; }
.status-grey { background-color: #7f8c8d; }
.status-red { background-color: #e74c3c; } /* For errors if needed */


/* Stats section CSS removed */

/* Remove old log-status and status-indicator styles */
/*
.log-status { ... }
.status-indicator { ... }
.status-indicator.active { ... }
*/

/* Event List Area */
.no-events {
  color: #888;
  text-align: center;
  padding: 30px;
  font-style: italic;
  flex-grow: 1; /* Take remaining space */
}

.kill-feed-scroll-area {
  flex: 1 1 auto; /* Take remaining space in flex container */
  overflow-y: auto !important;
  overflow-x: hidden;
  min-height: 0;
  padding: 10px;
  box-sizing: border-box;
  position: relative;
  
  /* Enhanced scrolling behavior */
  scroll-behavior: smooth;
}

/* Visual indicators removed - clean production look */

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

/* Player other badge (for events involving other players) */
.player-other-badge {
  background-color: #3498db; /* Blue color */
  color: white;
  padding: 1px 4px;
  border-radius: 4px;
  font-size: 0.7em;
  font-weight: bold;
  margin-left: 5px;
}

/* Server source indicator (subtle pip) */
.server-source-pip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 12px;
  height: 12px;
  background-color: #f39c12; /* Yellow/orange color */
  color: white;
  border-radius: 50%;
  margin-left: 4px;
  font-size: 0.6em;
  opacity: 0.8;
  transition: all 0.3s ease;
  animation: subtle-pulse 0.6s ease-out;
  vertical-align: baseline; /* Align with text baseline */
}

.server-source-pip:hover {
  opacity: 1;
  transform: scale(1.1);
}

.server-source-pip svg {
  width: 6px;
  height: 6px;
}

/* Subtle animation when pip appears (server confirmation) */
@keyframes subtle-pulse {
  0% {
    opacity: 0;
    transform: scale(0.8);
  }
  50% {
    opacity: 1;
    transform: scale(1.1);
  }
  100% {
    opacity: 0.8;
    transform: scale(1);
  }
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

/* Styling for containers of attackers and victims to align avatar and name */
.player-info { /* This class is applied to .attackers and .victims divs in the template */
  display: flex;
  align-items: center;
  flex-wrap: nowrap;
  overflow: hidden;
}

.player-entry {
  display: flex;
  align-items: center;
}

.avatar {
  margin-right: 6px;
  flex-shrink: 0;
}

.player-name {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.attackers, .victims { /* These divs now have .player-info class */
  /* .player-info handles main flex properties. This rule can refine gaps or specific alignments for these containers. */
  display: flex; /* Explicitly ensure flex, though .player-info also has it */
  align-items: center;
  gap: 0 5px; /* For spacing between multiple player entries or operators */
}

.env-cause span {
  color: #9b59b6;
  font-weight: bold;
}

.attackers .player-name {
  color: #ff8a80; /* Reddish for attackers */
  font-weight: 500;
}

.victims .player-name {
  color: #80cbc4; /* Bluish-green for victims */
  font-weight: 500;
}

.operator {
  color: #666;
  font-weight: normal;
  margin: 0 4px; /* Added margin for operator spacing */
}

.separator {
  color: #888;
  font-size: 1.1em;
  margin: 0 8px; /* Added margin for separator spacing */
}

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

/* Loading and status indicators */
.loading-indicator,
.search-indicator,
.end-indicator {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  color: #a1a1aa;
  font-size: 0.9em;
  gap: 8px;
}

.loading-spinner {
  width: 16px;
  height: 16px;
  border: 2px solid #404040;
  border-top: 2px solid #6366f1;
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}

.end-indicator {
  opacity: 0.7;
  font-style: italic;
}

.search-indicator {
  background-color: rgba(99, 102, 241, 0.1);
  border-radius: 8px;
}

.loading-indicator {
  background-color: rgba(64, 64, 64, 0.1);
  border-radius: 8px;
}

/* All debug and stats section styles removed for clean production build */

</style>