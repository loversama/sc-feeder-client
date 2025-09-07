<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick, watch, shallowRef, watchEffect } from 'vue';
import UpdateBanner from './UpdateBanner.vue'; // Import the new UpdateBanner component
import ConnectionBanner from './ConnectionBanner.vue'; // Import the connection status banner
import type { IpcRendererEvent } from 'electron'; // Import IpcRendererEvent
import { Setting, Tickets, User, MapLocation, Connection, Monitor, Filter, QuestionFilled } from '@element-plus/icons-vue'; // Import icons
import { useEntityResolver, type ResolvedEntity } from '../composables/useEntityResolver';
import { useNavigationState } from '../composables/useNavigationState';

// Using the interface from the main process instead
// Importing type only, no runtime dependency
import type { KillEvent, EventCategory } from '../../shared/types'; // Import from the new shared types file

// --- State Refs ---
const MAX_EVENTS_DISPLAY = 100; // Local constant for display limit
const allEvents = shallowRef<KillEvent[]>([]); // Unified event array - server determines what user sees (using shallowRef for performance)
const isAuthenticated = ref<boolean>(false); // Track auth status for UI display
const playSoundEffects = ref<boolean>(true); // Sound effects enabled by default
const isOffline = ref<boolean>(false); // Track offline mode setting
type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';
const connectionStatus = ref<ConnectionStatus>('connecting'); // Start with 'connecting' on app startup
const connectionAttempts = ref<number>(0); // Track connection attempts for progressive messaging
const nextReconnectDelay = ref<number>(0); // Track the actual reconnect delay from server
const connectionTimeout = ref<NodeJS.Timeout | null>(null); // Timeout to prevent stuck connection
const connectionStartTime = ref<number>(Date.now()); // Track when connection started
const resourcePath = ref<string>(''); // To store the path provided by main process
const currentGameMode = ref<'PU' | 'AC' | 'Unknown'>('Unknown'); // Added for stable game mode
const searchQuery = ref<string>(''); // Explicitly type and initialize
const logStatus = ref<string>('Initializing...'); // Log file monitoring status
const currentPlayerShip = ref<string>('');
const killFeedListRef = ref<HTMLDivElement | null>(null); // Ref for the list container
const recentlyUpdatedIds = ref<Set<string>>(new Set()); // Track updated event IDs for animation
const eventFilter = ref<'all' | 'local'>('all'); // Filter for showing all events or local only
const discoveredCategories = ref<Record<string, EventCategory>>({}); // Discovered event categories
const selectedCategories = ref<string[]>([]); // Selected category filters

// New infinite scroll and search state
const isLoadingMore = ref<boolean>(false);
const hasMoreEvents = ref<boolean>(true);
const isSearching = ref<boolean>(false);
const searchResults = shallowRef<KillEvent[]>([]);
const searchOffset = ref<number>(0);
const totalEventsLoaded = ref<number>(0);
const isUsingSearch = ref<boolean>(false);
const loadMoreTriggerDistance = 200; // Pixels from bottom to trigger load more

// Enhanced scroll state management
const scrollDetectionEnabled = ref<boolean>(false);
const lastScrollTime = ref<number>(0);
const scrollThrottleMs = 100; // Throttle scroll events to 100ms
const containerReady = ref<boolean>(false); // Track if container is properly sized

// Scroll-to-top button state
const showScrollToTop = ref<boolean>(false);
const SCROLL_TO_TOP_THRESHOLD = 4000; // Show button after ~50 events worth of scrolling

// Sliding window state management
const currentWindowOffset = ref<number>(0); // Tracks position in overall event stream
const MAX_UI_EVENTS = 250; // Maximum events in UI at once
const RESET_THRESHOLD = 200; // Events deep before triggering reset on scroll-to-top
const pendingUnload = ref<boolean>(false); // Track pending unload operations


let cleanupFunctions: (() => void)[] = [];

// --- Entity Resolution ---
const { resolveEntity, isLoading: isResolvingEntities } = useEntityResolver();

// --- Unified Navigation State ---
const navigationState = useNavigationState();
const {
  isProfileActive,
  isLeaderboardActive,
  isMapActive,
  isEventsActive,
  isStatsActive,
  navigateToSection,
  initializeListeners: initNavigationListeners
} = navigationState;

// Debug: Watch navigation state changes
watch([isProfileActive, isLeaderboardActive, isMapActive], ([profile, leaderboard, map]) => {
  console.log('[KillFeed] Navigation state changed:', {
    profile,
    leaderboard,
    map
  });
});

// --- Local Icon State ---
const isSettingsActive = ref(false);

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

const openProfile = async () => {
  console.log('[KillFeed] Profile button clicked');
  await navigateToSection('profile');
}

const openLeaderboard = async () => {
  console.log('[KillFeed] Leaderboard button clicked');
  await navigateToSection('leaderboard');
}

const openMap = async () => {
  console.log('[KillFeed] Map button clicked');
  await navigateToSection('map');
};

const openEvents = async () => {
  console.log('[KillFeed] Events button clicked');
  await navigateToSection('events');
};

const openStats = async () => {
  console.log('[KillFeed] Stats button clicked');
  await navigateToSection('stats');
};

// Generic function to open external website sections
const openExternalSection = async (section: string, customTitle?: string, customSize?: { width: number, height: number }) => {
  try {
    // Determine the correct URL based on environment
    const currentUrl = window.location.href;
    const isDev = currentUrl.includes('localhost') || currentUrl.includes('127.0.0.1');
    const baseUrl = isDev ? 'http://localhost:3001' : 'https://voidlog.gg';
    const websiteUrl = `${baseUrl}/${section}`;
    
    console.log(`Opening ${section}: ${websiteUrl} (dev mode: ${isDev})`);
    
    const result = await window.logMonitorApi.openExternalWebWindow(websiteUrl, {
      width: customSize?.width || 1400,
      height: customSize?.height || 900,
      title: customTitle || `VOIDLOG.GG - ${section.charAt(0).toUpperCase() + section.slice(1)}`,
      enableAuth: true
    });
    
    if (!result.success) {
      console.error(`Failed to open ${section} window:`, result.error);
      return false;
    } else {
      console.log(`${section} window opened successfully with ID:`, result.windowId);
      return true;
    }
  } catch (error) {
    console.error(`Failed to open ${section} window:`, error);
    return false;
  }
};

// --- Computed Properties ---

// Show all events in the kill feed
const currentEvents = computed(() => {
  let events: KillEvent[];
  
  // Determine which event source to use
  if (isUsingSearch.value) {
    events = searchResults.value;
  } else {
    events = allEvents.value;
  }

  // Apply event filter based on dropdown selection
  if (eventFilter.value === 'local') {
    // Hide server events, show only local events
    events = events.filter(event => !event.metadata?.source?.external && !event.metadata?.source?.server);
  }
  
  // Apply category filters if any are selected
  if (selectedCategories.value.length > 0) {
    events = events.filter(event => {
      // If event has no category, only show if "uncategorized" is selected
      if (!event.metadata?.category) {
        return selectedCategories.value.includes('uncategorized');
      }
      // Otherwise check if event's category is selected
      return selectedCategories.value.includes(event.metadata.category.id);
    });
  }
  
  return events;
});

// For backward compatibility, keep the same computed name but now it just returns currentEvents
// since searching is handled separately via the EventStore
const sortedFilteredEvents = computed(() => {
  // Events are already sorted by the EventStore (newest first)
  return currentEvents.value;
});

// Watch for filter changes and reload events to ensure pagination consistency
watch(eventFilter, async (newFilter, oldFilter) => {
  if (newFilter !== oldFilter) {
    console.log(`[KillFeed] Event filter changed from '${oldFilter}' to '${newFilter}' - reloading events`);
    
    // Save the filter preference
    if (window.logMonitorApi && window.logMonitorApi.setEventFilter) {
      try {
        const result = await window.logMonitorApi.setEventFilter(newFilter);
        if (result.success) {
          console.log(`[KillFeed] Event filter preference saved: ${newFilter}`);
        } else {
          console.error(`[KillFeed] Failed to save event filter preference:`, result.error);
        }
      } catch (error) {
        console.error(`[KillFeed] Error saving event filter preference:`, error);
      }
    }
    
    // Clear search if active to avoid confusion
    if (isUsingSearch.value) {
      searchQuery.value = '';
      searchResults.value = [];
      isUsingSearch.value = false;
    }
    
    // Reset state and reload events
    currentWindowOffset.value = 0;
    hasMoreEvents.value = true;
    
    try {
      await loadKillEvents();
      console.log(`[KillFeed] Successfully reloaded events for '${newFilter}' filter`);
    } catch (error) {
      console.error('[KillFeed] Failed to reload events after filter change:', error);
    }
  }
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

// Remove feedModeBadge - replaced with eventFilter dropdown

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

// Extract all entity IDs from events for batch processing
const extractEntityIds = (events: KillEvent[]): string[] => {
  const entityIds = new Set<string>();
  
  events.forEach(event => {
    // Add killers and victims
    event.killers?.forEach(id => entityIds.add(id));
    event.victims?.forEach(id => entityIds.add(id));
    
    // Add vehicles and weapons
    if (event.vehicleType) entityIds.add(event.vehicleType);
    if (event.vehicleModel) entityIds.add(event.vehicleModel);
    if (event.weapon) entityIds.add(event.weapon);
    
    // Add location for resolution using definitions.json
    if (event.location) entityIds.add(event.location);
  });
  
  return Array.from(entityIds).filter(id => id && id.trim());
};

// Eager resolution for event batches to minimize UI updates (unified approach)
const eagerResolveEventEntities = async (events: KillEvent[]): Promise<void> => {
  if (events.length === 0) return;
  
  console.log(`[Eager Resolution] Processing ${events.length} events...`);
  const startTime = performance.now();
  
  // Extract all unique entity IDs
  const entityIds = extractEntityIds(events);
  console.log(`[Eager Resolution] Found ${entityIds.length} unique entities to resolve`);
  
  // Unified batch resolve entities (includes both display names and NPC status)
  await resolveBatchEntities(entityIds);
  
  const endTime = performance.now();
  console.log(`[Eager Resolution] Completed in ${(endTime - startTime).toFixed(1)}ms`);
};

// Wait for definitions service to be ready (prevents race condition on app startup)
const waitForDefinitionsReady = async (): Promise<void> => {
  const maxWaitTime = 10000; // 10 seconds max wait
  const checkInterval = 100; // Check every 100ms
  let elapsed = 0;
  
  while (elapsed < maxWaitTime) {
    try {
      // Check if definitions service is ready by trying to get version
      if (window.logMonitorApi?.getDefinitionsVersion) {
        const version = await window.logMonitorApi.getDefinitionsVersion();
        if (version) {
          console.log(`[KillFeed] Definitions service ready (version: ${version})`);
          return;
        }
      }
    } catch (error) {
      // Service not ready yet, continue waiting
    }
    
    // Wait before checking again
    await new Promise(resolve => setTimeout(resolve, checkInterval));
    elapsed += checkInterval;
  }
  
  console.warn('[KillFeed] Definitions service not ready after 10 seconds, proceeding anyway');
};

// Enhanced kill events loading with eager resolution
const loadKillEvents = async () => {
  try {
    console.log('[KillFeed] 🚀 Starting initial event load...');
    
    // Load initial events from EventStore
    const serverEvents = await window.logMonitorApi.getGlobalKillEvents(25);
    console.log(`[KillFeed] Loaded ${serverEvents.length} events from server`);
    
    // Eager resolve all entities BEFORE displaying events
    if (serverEvents.length > 0) {
      await eagerResolveEventEntities(serverEvents);
    }
    
    // Update unified event array (this will trigger UI update with resolved entities)
    allEvents.value = serverEvents;
    console.log(`[KillFeed] Events displayed with pre-resolved entities`);
    
    // Double-check: if no entities were resolved (race condition fallback), force re-resolution
    const resolvedCount = Array.from(entityResolutionCache.value.values()).length;
    if (resolvedCount === 0 && serverEvents.length > 0) {
      console.warn('[KillFeed] No entities were resolved in eager resolution, retrying after 1 second...');
      setTimeout(async () => {
        console.log('[KillFeed] Retrying entity resolution for initial events...');
        await eagerResolveEventEntities(serverEvents);
      }, 1000);
    }

    // Check if there are more events available by trying to load one more batch
    // This determines if infinite scroll should be enabled
    const moreEventsCheck = await window.logMonitorApi.loadMoreEvents(1, serverEvents.length);
    hasMoreEvents.value = moreEventsCheck.hasMore || moreEventsCheck.events.length > 0;

    console.log(`[KillFeed] ✅ Initial load complete: ${serverEvents.length} events, hasMoreEvents: ${hasMoreEvents.value}`);

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
const playKillSound = async (killEvent?: KillEvent) => {
  // Get sound preferences
  let soundPrefs: any;
  try {
    if (window.logMonitorApi?.getSoundPreferences) {
      soundPrefs = await window.logMonitorApi.getSoundPreferences();
    }
  } catch (error) {
    console.error('Failed to get sound preferences:', error);
  }
  
  // Fall back to old system if no preferences
  if (!soundPrefs) {
    if (!playSoundEffects.value) return;
    soundPrefs = {
      enabled: playSoundEffects.value,
      eventSounds: {
        vehicleDestruction: { type: 'default', path: 'clean_pop', volume: 0.5 },
        crash: { type: 'default', path: 'kill-event-high', volume: 0.5 },
        playerKill: { type: 'default', path: 'metallic_din_1', volume: 0.5 },
        npcKill: { type: 'default', path: 'metallic_din_npc', volume: 0.3 },
        playerDeath: { type: 'default', path: 'kill-event-high', volume: 0.6 }
      }
    };
  }
  
  if (!soundPrefs.enabled) return;
  
  // Determine event type
  let eventType: keyof typeof soundPrefs.eventSounds = 'playerKill'; // default
  
  if (killEvent) {
    const currentUser = await window.logMonitorApi?.getLastLoggedInUser() || '';
    const isPlayerDeath = killEvent.victims?.includes(currentUser);
    const isPlayerKill = killEvent.killers?.includes(currentUser);
    
    // Check if NPC is involved
    let hasNpc = false;
    if (window.logMonitorApi?.filterNpcs) {
      const allEntities = [...(killEvent.killers || []), ...(killEvent.victims || [])];
      const npcs = await window.logMonitorApi.filterNpcs(allEntities);
      hasNpc = npcs.length > 0;
    }
    
    // Determine event type based on death type and involvement
    if (killEvent.deathType === 'Crash' || killEvent.damageType === 'Crash') {
      eventType = 'crash';
    } else if (isPlayerDeath) {
      eventType = 'playerDeath';
    } else if (killEvent.vehicleType && killEvent.vehicleType !== 'Player') {
      eventType = 'vehicleDestruction';
    } else if (hasNpc && isPlayerKill) {
      eventType = 'npcKill';
    } else if (isPlayerKill) {
      eventType = 'playerKill';
    } else if (killEvent.isPlayerInvolved) {
      // For assists or other player-involved events, use player kill sound
      eventType = 'playerKill';
    }
  }
  
  // Get sound configuration for this event type
  const soundConfig = soundPrefs.eventSounds[eventType];
  if (!soundConfig || soundConfig.type === 'none') return;
  
  try {
    let audioPlayed = false;
    
    if (soundConfig.type === 'custom' && soundConfig.path) {
      // Play custom sound
      try {
        const soundUrl = `file://${soundConfig.path}`;
        console.debug(`Playing custom sound: ${soundUrl}`);
        
        const audio = new Audio(soundUrl);
        audio.volume = soundConfig.volume || 0.5;
        
        // Test if the audio file exists by trying to load it
        await new Promise((resolve, reject) => {
          audio.addEventListener('canplaythrough', resolve, { once: true });
          audio.addEventListener('error', reject, { once: true });
          audio.load();
        });
        
        // Try to play the sound
        try {
          await audio.play();
          console.debug(`Sound played successfully: ${soundConfig.path}.${format}`);
          audioPlayed = true;
        } catch (playError) {
          console.error('Failed to play custom sound:', playError);
        }
      } catch (error) {
        console.error('Error loading custom sound:', error);
      }
    }
    
    // If custom sound failed or using default sound
    if (!audioPlayed && soundConfig.type === 'default') {
      // Try multiple sound formats in order of preference
      const soundFormats = ['mp3', 'm4a', 'wav'];
      
      for (const format of soundFormats) {
        if (audioPlayed) break;
        
        try {
          // Handle sound variations
          let soundPath = soundConfig.path;
          let volumeMultiplier = 1.0;
          
          // Map sound variations to the base sound file
          if (soundPath.endsWith('-low')) {
            soundPath = soundPath.replace('-low', '');
            volumeMultiplier = 0.5; // Reduce volume for subtle effect
          } else if (soundPath.endsWith('-high')) {
            soundPath = soundPath.replace('-high', '');
            volumeMultiplier = 1.5; // Increase volume for intense effect
          }
          
          const soundUrl = new URL(`/sounds/${soundPath}.${format}`, window.location.href).href;
          console.debug(`Attempting to play sound from: ${soundUrl}`);
          
          const audio = new Audio(soundUrl);
          audio.volume = Math.min(1.0, (soundConfig.volume || 0.5) * volumeMultiplier);
          
          // Test if the audio file exists by trying to load it
          await new Promise((resolve, reject) => {
            audio.addEventListener('canplaythrough', resolve, { once: true });
            audio.addEventListener('error', reject, { once: true });
            audio.load();
          });
          
          // Try to play the sound
          try {
            await audio.play();
            console.debug(`Sound played successfully: ${soundConfig.path}.${format}`);
            audioPlayed = true;
          } catch (playError) {
            // If play fails due to autoplay policy, try playing on next user interaction
            console.warn(`Sound play failed for ${format}:`, playError);
            
            // Common reasons:
            // 1. Autoplay blocked - user hasn't interacted with the page yet
            // 2. File not found - check if the sound file exists
            // 3. Format not supported
            
            // Try to play on next user interaction if autoplay was blocked
            if (playError.name === 'NotAllowedError') {
              const playOnInteraction = async () => {
                try {
                  await audio.play();
                  console.debug(`Sound played after user interaction: ${soundConfig.path}.${format}`);
                  document.removeEventListener('click', playOnInteraction);
                  document.removeEventListener('keydown', playOnInteraction);
                } catch (e) {
                  console.error(`Failed to play ${format} sound even after user interaction:`, e);
                }
              };
              
              document.addEventListener('click', playOnInteraction, { once: true });
              document.addEventListener('keydown', playOnInteraction, { once: true });
              audioPlayed = true; // Mark as handled even if delayed
            }
          }
        } catch (loadError) {
          console.debug(`Sound file not found or failed to load: ${soundPath}.${format}`);
          // Continue to next format
        }
      }
    }
    
    if (!audioPlayed) {
      console.error('No sound file could be played. Ensure sound files exist in /public/sounds/');
    }
  } catch (err) {
    console.error('Error initializing sound system:', err);
  }
};

// Enhanced entity resolution with persistent caching (includes NPC status)
const entityResolutionCache = ref<Map<string, ResolvedEntity>>(new Map());
const entityDisplayCache = ref<Map<string, string>>(new Map()); // Backward compatibility
const persistentCacheKey = 'sc-feeder-entity-cache';
const cacheVersion = 'v2'; // Increment to invalidate old caches

// Load persistent cache on startup
const loadPersistentCache = () => {
  try {
    const stored = localStorage.getItem(persistentCacheKey);
    if (stored) {
      const data = JSON.parse(stored);
      if (data.version === cacheVersion) {
        // Load new format (v2+) with full resolution data
        if (data.resolvedEntities) {
          console.log(`[Cache] Loading ${Object.keys(data.resolvedEntities).length} cached resolved entities from localStorage`);
          entityResolutionCache.value = new Map(Object.entries(data.resolvedEntities));
          // Also populate display cache for backward compatibility
          const displayEntries: [string, string][] = Object.entries(data.resolvedEntities).map(([id, entity]: [string, any]) => [id, entity.displayName]);
          entityDisplayCache.value = new Map(displayEntries);
          return true;
        }
        // Load old format (v1) with just display names
        if (data.entities) {
          console.log(`[Cache] Loading ${Object.keys(data.entities).length} cached display names from localStorage (legacy format)`);
          entityDisplayCache.value = new Map(Object.entries(data.entities));
          return true;
        }
      }
    }
  } catch (error) {
    console.warn('[Cache] Failed to load persistent cache:', error);
  }
  return false;
};

// Save cache to localStorage
const savePersistentCache = () => {
  try {
    const data = {
      version: cacheVersion,
      timestamp: Date.now(),
      resolvedEntities: Object.fromEntries(entityResolutionCache.value),
      entities: Object.fromEntries(entityDisplayCache.value) // Backward compatibility
    };
    localStorage.setItem(persistentCacheKey, JSON.stringify(data));
  } catch (error) {
    console.warn('[Cache] Failed to save persistent cache:', error);
  }
};

// Fallback cleanup function (synchronous, from original cleanShipName)
const cleanEntityNameFallback = (name: string | undefined): string => {
  if (!name) return 'Unknown';
  
  // First, remove numeric suffixes (like _123456789) - CRITICAL for NPCs
  let cleaned = name.replace(/^(.+?)_\d+$/, '$1');
  
  // Handle manufacturer prefixes for ships
  const parts = cleaned.split('_');
  if (parts.length > 1) {
    const manufacturers = ["ORIG", "CRUS", "RSI", "AEGS", "VNCL", "DRAK", "ANVL", "BANU", "MISC", "CNOU", "XIAN", "GAMA", "TMBL", "ESPR", "KRIG", "GRIN", "XNAA", "MRAI"];
    if (manufacturers.includes(parts[0])) {
      cleaned = parts.slice(1).join('_'); // Keep underscores for now
    }
  }
  
  // Convert all remaining underscores to spaces
  return cleaned.replace(/_/g, ' ');
};

// Synchronous function that returns immediate fallback, but triggers async resolution
const cleanShipName = (name: string | undefined): string => {
  if (!name) return 'Unknown';
  
  const cacheKey = name;
  
  // Return cached result if available
  if (entityDisplayCache.value.has(cacheKey)) {
    return entityDisplayCache.value.get(cacheKey)!;
  }
  
  // Start async resolution in background
  resolveEntityInBackground(name);
  
  // Return immediate fallback (this preserves the original behavior)
  return cleanEntityNameFallback(name);
};

// Batch resolution for multiple entities (used for eager loading) - returns full ResolvedEntity objects
const resolveBatchEntities = async (entityIds: string[]): Promise<Map<string, ResolvedEntity>> => {
  const results = new Map<string, ResolvedEntity>();
  const unknownEntities = entityIds.filter(id => !entityResolutionCache.value.has(id));
  
  if (unknownEntities.length === 0) {
    // Return cached entities
    entityIds.forEach(id => {
      const cached = entityResolutionCache.value.get(id);
      if (cached) {
        results.set(id, cached);
      }
    });
    return results;
  }
  
  console.log(`[Batch Resolution] Resolving ${unknownEntities.length} unknown entities...`);
  
  // Resolve all unknown entities in parallel
  const resolutionPromises = unknownEntities.map(async (entityId) => {
    try {
      const resolved = await resolveEntity(entityId);
      return { entityId, resolved };
    } catch (error) {
      console.warn(`Failed to resolve entity ${entityId}:`, error);
      // Return fallback resolved entity
      return {
        entityId,
        resolved: {
          displayName: cleanEntityNameFallback(entityId),
          isNpc: false,
          category: 'unknown' as const,
          matchMethod: 'fallback' as const,
          originalId: entityId
        }
      };
    }
  });
  
  const resolvedEntities = await Promise.all(resolutionPromises);
  
  // Update both caches with resolved entities
  const newResolutionCache = new Map(entityResolutionCache.value);
  const newDisplayCache = new Map(entityDisplayCache.value);
  
  resolvedEntities.forEach(({ entityId, resolved }) => {
    newResolutionCache.set(entityId, resolved);
    newDisplayCache.set(entityId, resolved.displayName); // Backward compatibility
    results.set(entityId, resolved);
  });
  
  entityResolutionCache.value = newResolutionCache;
  entityDisplayCache.value = newDisplayCache;
  
  // Save to persistent cache
  if (resolvedEntities.length > 0) {
    savePersistentCache();
  }
  
  console.log(`[Batch Resolution] Resolved ${resolvedEntities.length} entities with NPC status`);
  return results;
};

// Background resolution that updates the reactive cache (for individual entities)
const resolveEntityInBackground = async (entityId: string, serverEnriched?: any) => {
  const cacheKey = entityId;
  
  // Skip if already resolved
  if (entityResolutionCache.value.has(cacheKey)) {
    return;
  }
  
  
  try {
    const resolved = await resolveEntity(entityId, serverEnriched);
    
    
    // Update both caches
    const newResolutionCache = new Map(entityResolutionCache.value);
    const newDisplayCache = new Map(entityDisplayCache.value);
    
    newResolutionCache.set(cacheKey, resolved);
    newDisplayCache.set(cacheKey, resolved.displayName); // Backward compatibility
    
    entityResolutionCache.value = newResolutionCache;
    entityDisplayCache.value = newDisplayCache;
    
    // Save to persistent cache periodically
    if (Math.random() < 0.1) { // 10% chance to save (throttle saves)
      savePersistentCache();
    }
  } catch (error) {
    console.warn('Background entity resolution failed:', error);
    // Don't cache failures, just use the fallback
  }
};

// Helper to get the display name (either cached resolved or fallback)
const getEntityDisplayName = (entityId: string | undefined): string => {
  if (!entityId) {
    console.log(`[DISPLAY] Empty entityId -> 'Unknown'`);
    return 'Unknown';
  }
  
  // Check if we have a resolved entity with display name
  const resolvedEntity = entityResolutionCache.value.get(entityId);
  if (resolvedEntity) {
    console.log(`[DISPLAY] "${entityId}" -> "${resolvedEntity.displayName}" (from resolved entity cache)`);
    return resolvedEntity.displayName;
  }
  
  // Check display cache for pre-resolved names
  const cacheKey = entityId;
  if (entityDisplayCache.value.has(cacheKey)) {
    const cached = entityDisplayCache.value.get(cacheKey)!;
    console.log(`[DISPLAY] "${entityId}" -> "${cached}" (from displayCache)`);
    return cached;
  }
  
  const fallback = cleanEntityNameFallback(entityId);
  console.log(`[DISPLAY] "${entityId}" -> "${fallback}" (from cleanEntityNameFallback)`);
  return fallback;
};

// NPC detection cache for reactive updates
const npcStatusCache = ref<Map<string, boolean>>(new Map());
const npcCacheKey = 'sc-feeder-npc-cache';

// Load persistent NPC cache on startup
const loadPersistentNpcCache = () => {
  try {
    const stored = localStorage.getItem(npcCacheKey);
    if (stored) {
      const data = JSON.parse(stored);
      if (data.version === cacheVersion && data.npcs) {
        console.log(`[NPC Cache] Loading ${Object.keys(data.npcs).length} cached NPC statuses from localStorage`);
        npcStatusCache.value = new Map(Object.entries(data.npcs).map(([k, v]) => [k, Boolean(v)]));
        return true;
      }
    }
  } catch (error) {
    console.warn('[NPC Cache] Failed to load persistent NPC cache:', error);
  }
  return false;
};

// Save NPC cache to localStorage
const savePersistentNpcCache = () => {
  try {
    const data = {
      version: cacheVersion,
      timestamp: Date.now(),
      npcs: Object.fromEntries(npcStatusCache.value)
    };
    localStorage.setItem(npcCacheKey, JSON.stringify(data));
  } catch (error) {
    console.warn('[NPC Cache] Failed to save persistent NPC cache:', error);
  }
};

// Legacy NPC batch resolution - now replaced by unified entity resolution
// This function is kept for potential fallback use but should rarely be called
const resolveBatchNpcStatus = async (entityIds: string[]): Promise<Map<string, boolean>> => {
  console.warn('[NPC Batch] Using legacy NPC resolution - this should be rare with unified resolution');
  const results = new Map<string, boolean>();
  const unknownEntities = entityIds.filter(id => !npcStatusCache.value.has(id) && !entityResolutionCache.value.has(id));
  
  if (unknownEntities.length === 0) {
    return results; // All entities already cached
  }
  
  console.log(`[NPC Batch] Checking ${unknownEntities.length} unknown entities for NPC status...`);
  
  // Check all unknown entities in parallel
  if (window.logMonitorApi?.isNpcEntity) {
    const npcCheckPromises = unknownEntities.map(async (entityId) => {
      try {
        const isNpc = await window.logMonitorApi.isNpcEntity(entityId);
        return { entityId, isNpc };
      } catch (error) {
        console.warn(`Failed to check NPC status for ${entityId}:`, error);
        return { entityId, isNpc: false }; // Default to non-NPC on error
      }
    });
    
    const npcResults = await Promise.all(npcCheckPromises);
    
    // Update cache with results
    const newCache = new Map(npcStatusCache.value);
    npcResults.forEach(({ entityId, isNpc }) => {
      newCache.set(entityId, isNpc);
      results.set(entityId, isNpc);
    });
    
    npcStatusCache.value = newCache;
    
    // Save to persistent cache
    if (npcResults.length > 0) {
      savePersistentNpcCache();
    }
    
    const npcCount = npcResults.filter(r => r.isNpc).length;
    console.log(`[NPC Batch] Found ${npcCount} NPCs out of ${unknownEntities.length} checked entities`);
  }
  
  return results;
};

// Check if an entity is an NPC using resolved entity cache (unified approach)
const isEntityNpc = (entityId: string): boolean => {
  if (!entityId) return false;
  
  // CRITICAL: We need to check the ORIGINAL entity ID, not the cleaned display name
  // The template passes raw IDs from events, so this should work correctly
  
  // Check resolved entity cache first (most reliable)
  const resolvedEntity = entityResolutionCache.value.get(entityId);
  if (resolvedEntity) {
    console.log(`[NPC Check] ${entityId} -> ${resolvedEntity.isNpc ? 'NPC' : 'Player'} (from resolved cache, display: "${resolvedEntity.displayName}")`);
    return resolvedEntity.isNpc;
  }
  
  // Fallback to old NPC cache for backward compatibility
  if (npcStatusCache.value.has(entityId)) {
    const isNpc = npcStatusCache.value.get(entityId)!;
    console.log(`[NPC Check] ${entityId} -> ${isNpc ? 'NPC' : 'Player'} (from legacy NPC cache)`);
    return isNpc;
  }
  
  // If no cache hit, do immediate check using API (synchronous fallback)
  if (window.logMonitorApi?.isNpcEntity) {
    try {
      // For critical display, we need immediate results
      // This will use the backend definitionsService with proper patterns
      const result = window.logMonitorApi.isNpcEntity(entityId);
      if (result instanceof Promise) {
        // If it's async, start background resolution
        console.log(`[NPC Check] ${entityId} -> Starting async resolution...`);
        resolveEntityInBackground(entityId);
        return false; // Default to false while resolving
      } else {
        // Synchronous result available
        console.log(`[NPC Check] ${entityId} -> ${result ? 'NPC' : 'Player'} (from immediate API call)`);
        return result;
      }
    } catch (error) {
      console.warn(`[NPC Check] Error checking ${entityId}:`, error);
    }
  }
  
  // Start background resolution for unknown entities
  console.log(`[NPC Check] ${entityId} -> Unknown, starting background resolution...`);
  resolveEntityInBackground(entityId);
  
  // Return false by default (will update when background resolution completes)
  return false;
};

// Background NPC status check that updates the reactive cache (for individual entities)
const checkNpcStatusInBackground = async (entityId: string) => {
  try {
    if (window.logMonitorApi?.isNpcEntity) {
      const isNpc = await window.logMonitorApi.isNpcEntity(entityId);
      
      // Update the reactive cache
      const newCache = new Map(npcStatusCache.value);
      newCache.set(entityId, isNpc);
      npcStatusCache.value = newCache;
      
      // Save to persistent cache periodically
      if (Math.random() < 0.2) { // 20% chance to save (throttle saves)
        savePersistentNpcCache();
      }
    }
  } catch (error) {
    console.warn('NPC status check failed:', error);
  }
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

    // Initialize navigation listeners from unified state
    initNavigationListeners();
  } catch (error) {
    console.error('[KillFeed] Error getting initial window states:', error);
  }
};

// Search handling functions
const handleSearch = async (query: string) => {
  if (!query.trim()) {
    // Clear search mode and reset to normal event view
    isUsingSearch.value = false;
    searchResults.value = [];
    searchOffset.value = 0;
    // Note: Don't reset currentWindowOffset here - user might want to stay in their current position
    console.log('[KillFeed] Search cleared, returning to normal event view');
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

// Load discovered categories from config store
const loadDiscoveredCategories = async () => {
  if (window.logMonitorApi && window.logMonitorApi.getDiscoveredCategories) {
    try {
      const categories = await window.logMonitorApi.getDiscoveredCategories();
      discoveredCategories.value = categories;
      console.log(`[KillFeed] Loaded ${Object.keys(categories).length} discovered categories`);
    } catch (error) {
      console.error(`[KillFeed] Error loading discovered categories:`, error);
    }
  }
};

// Load selected category filters from config store
const loadSelectedCategories = async () => {
  if (window.logMonitorApi && window.logMonitorApi.getSelectedCategoryFilters) {
    try {
      const selected = await window.logMonitorApi.getSelectedCategoryFilters();
      selectedCategories.value = selected;
      console.log(`[KillFeed] Loaded ${selected.length} selected category filters`);
    } catch (error) {
      console.error(`[KillFeed] Error loading selected categories:`, error);
    }
  }
};

// Toggle a category filter
const toggleCategoryFilter = async (categoryId: string) => {
  if (window.logMonitorApi && window.logMonitorApi.toggleCategoryFilter) {
    try {
      await window.logMonitorApi.toggleCategoryFilter(categoryId);
      // Reload selected filters
      await loadSelectedCategories();
      // Reload events to apply new filter
      await loadInitialEvents();
    } catch (error) {
      console.error(`[KillFeed] Error toggling category filter:`, error);
    }
  }
};

// Clear all category filters
const clearCategoryFilters = async () => {
  if (window.logMonitorApi && window.logMonitorApi.setSelectedCategoryFilters) {
    try {
      await window.logMonitorApi.setSelectedCategoryFilters([]);
      selectedCategories.value = [];
      // Reload events
      await loadInitialEvents();
    } catch (error) {
      console.error(`[KillFeed] Error clearing category filters:`, error);
    }
  }
};

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
  
  // Update scroll-to-top button visibility
  showScrollToTop.value = scrollTop > SCROLL_TO_TOP_THRESHOLD;
  
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
      
      // Eager resolve entities for search results BEFORE adding to display
      if (results.events.length > 0) {
        await eagerResolveEventEntities(results.events);
      }
      
      searchResults.value = [...searchResults.value, ...results.events];
      
      // Schedule search results cleanup to prevent jitter
      scheduleSearchUnload();
      
      hasMoreEvents.value = results.hasMore;
      console.log(`[KillFeed] Loaded ${results.events.length} more search results (hasMore: ${results.hasMore})`);
    } else {
      // Load more regular events via EventStore
      // Calculate true offset in the overall event stream (window offset + current UI events)
      const trueOffset = currentWindowOffset.value + allEvents.value.length;
      console.log(`[KillFeed] Loading more regular events (UI: ${allEvents.value.length}, window offset: ${currentWindowOffset.value}, true offset: ${trueOffset})`);
      const results = await window.logMonitorApi.loadMoreEvents(25, trueOffset);
      
      console.log(`[KillFeed] Received ${results.events.length} events from API (hasMore: ${results.hasMore})`);
      
      // Add new events to existing array (avoiding duplicates) - BACK TO ORIGINAL FAST METHOD
      const newEventIds = new Set(allEvents.value.map(e => e.id));
      const uniqueNewEvents = results.events.filter(e => !newEventIds.has(e.id));
      
      // Eager resolve entities for new events BEFORE adding to display
      if (uniqueNewEvents.length > 0) {
        await eagerResolveEventEntities(uniqueNewEvents);
      }
      
      allEvents.value = [...allEvents.value, ...uniqueNewEvents];
      
      // Maintain sliding window of MAX_UI_EVENTS
      if (allEvents.value.length > MAX_UI_EVENTS) {
        const excessCount = allEvents.value.length - MAX_UI_EVENTS;
        allEvents.value = allEvents.value.slice(excessCount);
        currentWindowOffset.value += excessCount;
        console.log(`[KillFeed] 🪟 Sliding window: removed ${excessCount} oldest events, window now at offset ${currentWindowOffset.value}`);
      }
      
      hasMoreEvents.value = results.hasMore;
      
      console.log(`[KillFeed] 🚀 Added ${uniqueNewEvents.length} new events, offset: ${currentWindowOffset.value}, hasMore: ${results.hasMore}`);
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

// Batched unloading to prevent jitter during sliding window operations
const scheduleUnload = () => {
  if (pendingUnload.value) return; // Already scheduled
  
  pendingUnload.value = true;
  requestAnimationFrame(() => {
    if (allEvents.value.length > MAX_UI_EVENTS) {
      const excessCount = allEvents.value.length - MAX_UI_EVENTS;
      allEvents.value = allEvents.value.slice(excessCount);
      currentWindowOffset.value += excessCount;
      console.log(`[KillFeed] 🪟 Smooth unload: removed ${excessCount} oldest events, window now at offset ${currentWindowOffset.value}`);
    }
    pendingUnload.value = false;
  });
};

const scheduleSearchUnload = () => {
  requestAnimationFrame(() => {
    if (searchResults.value.length > MAX_UI_EVENTS) {
      const excessCount = searchResults.value.length - MAX_UI_EVENTS;
      searchResults.value = searchResults.value.slice(excessCount);
      console.log(`[KillFeed] 🪟 Smooth search unload: removed ${excessCount} oldest results, maintaining ${MAX_UI_EVENTS} window`);
    }
  });
};

// Smart scroll to top functionality
const scrollToTop = async () => {
  if (!killFeedListRef.value) return;
  
  // Check if we're deep in the event history
  if (currentWindowOffset.value > RESET_THRESHOLD) {
    console.log(`[KillFeed] 🔄 Deep in history (offset: ${currentWindowOffset.value}), resetting to recent events`);
    
    try {
      // Reset to recent events
      isLoadingMore.value = true;
      currentWindowOffset.value = 0;
      
      // Load fresh recent events (100 events to give good context)
      const results = await window.logMonitorApi.loadMoreEvents(100, 0);
      
      // Immediate update for reset (no delay needed)
      allEvents.value = results.events;
      hasMoreEvents.value = results.hasMore;
      
      // Jump to top immediately (no animation for reset)
      killFeedListRef.value.scrollTo({ top: 0, behavior: 'instant' });
      
      // Re-validate container after reset to ensure infinite scroll still works
      nextTick(() => {
        validateScrollContainer();
        if (!scrollDetectionEnabled.value) {
          scrollDetectionEnabled.value = true;
        }
      });
      
      console.log(`[KillFeed] ✅ Reset complete: loaded ${results.events.length} recent events, back to top`);
    } catch (error) {
      console.error('[KillFeed] ❌ Failed to reset to recent events:', error);
    } finally {
      isLoadingMore.value = false;
    }
  } else {
    // We're close to recent events, just smooth scroll to top
    console.log(`[KillFeed] 📜 Smooth scrolling to top (offset: ${currentWindowOffset.value})`);
    killFeedListRef.value.scrollTo({
      top: 0,
      behavior: 'smooth'
    });
  }
};

// Handle manual reconnection request from ConnectionBanner
const handleManualReconnect = () => {
  console.log('[KillFeed] Manual reconnect requested');
  // Clear any existing connection timeout
  if (connectionTimeout.value) {
    clearTimeout(connectionTimeout.value);
    connectionTimeout.value = null;
  }
  // Send reconnect request to main process
  if (window.logMonitorApi?.reconnectToServer) {
    window.logMonitorApi.reconnectToServer();
  }
};

// Handle stuck connection timeout
const handleConnectionTimeout = () => {
  console.warn('[KillFeed] Connection timeout - stuck in connecting state for over 10 seconds');
  
  // Check if we're still stuck in connecting state
  if (connectionStatus.value === 'connecting') {
    const timeSinceStart = Date.now() - connectionStartTime.value;
    console.log(`[KillFeed] Connection has been stuck for ${Math.round(timeSinceStart / 1000)}s`);
    
    // Force a status check or reconnection
    if (window.logMonitorApi?.checkConnectionStatus) {
      console.log('[KillFeed] Requesting connection status check');
      window.logMonitorApi.checkConnectionStatus();
    } else if (window.logMonitorApi?.reconnectToServer) {
      console.log('[KillFeed] Forcing reconnection due to timeout');
      // Change status to disconnected to show proper UI
      connectionStatus.value = 'disconnected';
      connectionAttempts.value = connectionAttempts.value + 1;
      // Trigger reconnection
      window.logMonitorApi.reconnectToServer();
    } else {
      // Fallback: just change status to error
      console.error('[KillFeed] No reconnection API available, marking as error');
      connectionStatus.value = 'error';
    }
  }
  
  connectionTimeout.value = null;
};

onMounted(async () => { // Make onMounted async
  // Get initial states synchronously FIRST
  await getInitialWindowStates();
  
  // Set initial connection timeout since app starts in 'connecting' state
  if (connectionStatus.value === 'connecting') {
    console.log('[KillFeed] Setting initial 10 second connection timeout');
    connectionStartTime.value = Date.now();
    connectionTimeout.value = setTimeout(handleConnectionTimeout, 10000);
  }
  
  // Load saved event filter preference
  if (window.logMonitorApi && window.logMonitorApi.getEventFilter) {
    try {
      const savedFilter = await window.logMonitorApi.getEventFilter();
      eventFilter.value = savedFilter;
      console.log(`[KillFeed] Loaded event filter preference: ${savedFilter}`);
    } catch (error) {
      console.error(`[KillFeed] Error loading event filter preference:`, error);
      // Keep default 'all' if error
    }
  }
  
  // Load discovered categories and selected filters
  await loadDiscoveredCategories();
  await loadSelectedCategories();
  
  // 🔍 DEBUG: Test navigation system availability
  console.log('🔍 NAVIGATION SYSTEM DEBUG:', {
    hasWindow: typeof window !== 'undefined',
    hasElectronAPI: !!window.electronAPI,
    hasNavigation: !!(window.electronAPI && window.electronAPI.navigation),
    hasNavigationRequest: !!(window.electronAPI && window.electronAPI.navigation && window.electronAPI.navigation.request),
    electronAPIKeys: window.electronAPI ? Object.keys(window.electronAPI) : 'undefined',
    navigationKeys: (window.electronAPI && window.electronAPI.navigation) ? Object.keys(window.electronAPI.navigation) : 'undefined'
  });

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
        const cleanup = window.logMonitorApi.onConnectionStatusChanged((_event, status, attempts?, delay?) => {
          console.log('[KillFeed] Received connection status update:', status, 'attempts:', attempts, 'delay:', delay);
          
          // Clear existing timeout if any
          if (connectionTimeout.value) {
            clearTimeout(connectionTimeout.value);
            connectionTimeout.value = null;
          }
          
          connectionStatus.value = status;
          if (attempts !== undefined) {
            connectionAttempts.value = attempts;
          }
          if (delay !== undefined) {
            nextReconnectDelay.value = delay;
          }
          
          // Set timeout if we're in connecting state
          if (status === 'connecting') {
            connectionStartTime.value = Date.now();
            console.log('[KillFeed] Starting 10 second connection timeout');
            connectionTimeout.value = setTimeout(handleConnectionTimeout, 10000);
          }
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
    // Navigation state is now managed by unified state management
    // Navigation state is now managed by unified state management
 ]).then(async () => {
    // Load persistent caches before loading events
    console.log('[KillFeed] Loading persistent caches...');
    loadPersistentCache();
    loadPersistentNpcCache();
    
    // Wait for definitions service to be ready before loading events
    console.log('[KillFeed] Waiting for definitions service to initialize...');
    await waitForDefinitionsReady();
    
    // Set up listener for definitions updates (from debug refresh buttons)
    if (window.logMonitorApi?.onIpcMessage) {
      const cleanup = window.logMonitorApi.onIpcMessage('definitions-updated', async () => {
        console.log('[KillFeed] Definitions updated, invalidating entity caches...');
        // Clear caches to force re-resolution with new definitions
        entityResolutionCache.value.clear();
        entityDisplayCache.value.clear();
        npcStatusCache.value.clear();
        
        // Re-resolve all visible entities
        if (allEvents.value.length > 0) {
          console.log('[KillFeed] Re-resolving entities with updated definitions...');
          await eagerResolveEventEntities(allEvents.value);
          console.log('[KillFeed] Entity re-resolution complete');
        }
      });
      cleanupFunctions.push(cleanup);
    }
    
    // Load events after checking auth, offline mode, caches, and definitions
    return loadKillEvents();
  });

 // Listen for events from local parsing and server filtering
 cleanupFunctions.push(
    window.logMonitorApi.onKillFeedEvent(async (_event, data: { event: KillEvent, source: 'server' | 'local' } | null) => {
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
          console.log(`   VehicleType: "${killEvent.vehicleType}"`);
          console.log(`   VehicleModel: "${killEvent.vehicleModel}"`);
          console.log(`   Description: ${killEvent.eventDescription}`);
          console.log(`   Player Involved: ${killEvent.isPlayerInvolved}`);
          console.log(`   Metadata: ${JSON.stringify(killEvent.metadata)}`);
          console.log('🔄 Adding to unified event array...');
        } else {
          console.log(`Received ${source} event - VehicleType: "${killEvent.vehicleType}", Killers: [${killEvent.killers.join(', ')}], Victims: [${killEvent.victims.join(', ')}]`);
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
          
          // Eager resolve entities for the updated event
          await eagerResolveEventEntities([killEvent]);
          
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
          
          // Eager resolve entities for the new event BEFORE adding to display
          await eagerResolveEventEntities([killEvent]);
          
          const newEvents = [killEvent, ...allEvents.value];
          allEvents.value = newEvents;
          wasNewEvent = true;

          // Play sound effect for new events
          playKillSound(killEvent);
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
  
  // Clean up connection timeout
  if (connectionTimeout.value) {
    clearTimeout(connectionTimeout.value);
    connectionTimeout.value = null;
  }
  
  // Clean up other listeners
  cleanupFunctions.forEach(cleanup => cleanup());
});

// Generate dynamic tooltip for server source indicator
const getServerSourceTooltip = (event: KillEvent): string => {
  const hasServer = event.metadata?.source?.server;
  const hasLocal = event.metadata?.source?.local;
  const hasExternal = event.metadata?.source?.external;
  const isPlayerInvolved = event.isPlayerInvolved && isAuthenticated.value;
  
  // Priority order for tooltip messages
  if (hasServer && hasLocal) {
    return "Server confirmed this local event";
  } else if (hasServer && !hasLocal) {
    return "Event from another client";
  } else if (hasExternal) {
    return "External event";
  } else if (isPlayerInvolved) {
    return "Player-involved event";
  } else {
    return "Event source";
  }
};
</script>

<template>
  <div class="kill-feed-container">
    <!-- Update Banner Container with matching background -->
    <div class="update-banner-container">
      <UpdateBanner />
    </div>
    
    <!-- Connection Status Banner -->
    <div class="connection-banner-container">
      <ConnectionBanner 
        :status="connectionStatus"
        :connection-attempts="connectionAttempts"
        :next-reconnect-delay="nextReconnectDelay"
        :hide-when-update-active="true"
        @reconnect="handleManualReconnect"
      />
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
        <!-- Event Filter Dropdown -->
        <el-select 
          v-model="eventFilter" 
          size="small"
          class="event-filter-select"
          placeholder="Filter events"
        >
          <el-option 
            label="All Events" 
            value="all"
          >
            <span style="display: flex; align-items: center; gap: 6px;">
              <el-icon size="14"><Connection /></el-icon>
              All Events
            </span>
          </el-option>
          <el-option 
            label="Local Events" 
            value="local"
          >
            <span style="display: flex; align-items: center; gap: 6px;">
              <el-icon size="14"><Monitor /></el-icon>
              Local Events
            </span>
          </el-option>
        </el-select>
        
        <!-- Category Filter Dropdown -->
        <el-popover 
          placement="bottom-start" 
          :width="300"
          trigger="click"
          v-if="Object.keys(discoveredCategories).length > 0"
        >
          <template #reference>
            <el-button 
              size="small" 
              class="category-filter-button"
              :type="selectedCategories.length > 0 ? 'primary' : 'default'"
            >
              <el-icon style="margin-right: 4px;"><Filter /></el-icon>
              Categories
              <span v-if="selectedCategories.length > 0" class="category-count">
                ({{ selectedCategories.length }})
              </span>
            </el-button>
          </template>
          
          <div class="category-filter-content">
            <div class="category-filter-header">
              <h4>Filter by Category</h4>
              <el-link 
                v-if="selectedCategories.length > 0"
                type="primary" 
                @click="clearCategoryFilters"
                :underline="false"
              >
                Clear All
              </el-link>
            </div>
            
            <div class="category-filter-list">
              <!-- Uncategorized option -->
              <div 
                class="category-filter-item"
                @click="toggleCategoryFilter('uncategorized')"
              >
                <el-checkbox 
                  :model-value="selectedCategories.includes('uncategorized')"
                  @click.stop
                >
                  <span class="category-name">
                    <el-icon style="margin-right: 4px;"><QuestionFilled /></el-icon>
                    Uncategorized
                  </span>
                </el-checkbox>
              </div>
              
              <!-- Discovered categories -->
              <div 
                v-for="category in Object.values(discoveredCategories)" 
                :key="category.id"
                class="category-filter-item"
                @click="toggleCategoryFilter(category.id)"
              >
                <el-checkbox 
                  :model-value="selectedCategories.includes(category.id)"
                  @click.stop
                >
                  <span class="category-name">
                    <span v-if="category.icon" class="category-icon">{{ category.icon }}</span>
                    {{ category.name }}
                    <span v-if="category.count" class="category-count-badge">{{ category.count }}</span>
                  </span>
                </el-checkbox>
              </div>
            </div>
          </div>
        </el-popover>
        
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
          <!-- Server Source Indicator (positioned at mid-height of event item) -->
          <div v-if="(event.metadata?.source?.server || event.metadata?.source?.external) || (event.isPlayerInvolved && isAuthenticated)" 
               class="server-source-pip-container">
            <span class="server-source-pip" 
                  :title="getServerSourceTooltip(event)">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zM6.838 12.434c.068 1.217.347 2.358.784 3.364l.952-.952c-.225-.627-.359-1.329-.41-2.102h-1.326zm1.326-1.668c.051-.773.185-1.475.41-2.102l-.952-.952c-.437 1.006-.716 2.147-.784 3.364h1.326zm1.979-4.515l.952.952c.627-.225 1.329-.359 2.102-.41V5.467c-1.217.068-2.358.347-3.364.784zm3.857.41c.773.051 1.475.185 2.102.41l.952-.952c-1.006-.437-2.147-.716-3.364-.784v1.326zm4.515 1.979l-.952.952c.225.627.359 1.329.41 2.102h1.326c-.068-1.217-.347-2.358-.784-3.364zm-.41 3.857c-.051.773-.185 1.475-.41 2.102l.952.952c.437-1.006.716-2.147.784-3.364h-1.326zm-1.979 4.515l-.952-.952c-.627.225-1.329.359-2.102.41v1.326c1.217-.068 2.358-.347 3.364-.784zm-3.857-.41c-.773-.051-1.475-.185-2.102-.41l-.952.952c1.006.437 2.147.716 3.364.784v-1.326zM12 8c-2.206 0-4 1.794-4 4s1.794 4 4 4 4-1.794 4-4-1.794-4-4-4z"/>
              </svg>
            </span>
          </div>
          
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
          <span v-if="event.gameMode && event.gameMode !== 'Unknown'" 
                class="event-mode-pill" 
                :class="{
                  'mode-pu': event.gameMode === 'PU',
                  'mode-ac': event.gameMode === 'AC'
                }">{{ event.gameMode }}</span>
          <span class="event-location" v-if="event.location">{{ getEntityDisplayName(event.location) }}</span>
          <!-- Temporary debug: Show raw location -->
          <div class="event-time-container">
            <span class="event-time">{{ formatTime(event.timestamp) }}</span>
          </div>
        </div>

        <div class="event-content">
          <div class="player-names">
            <!-- Special layout for environmental deaths or crashes -->
            <template v-if="event.killers[0] === 'Environment' || event.deathType === 'Crash'">
              <div class="victims">
                <template v-for="(victim, index) in event.victims" :key="victim">
                  <span class="victim">
                    {{ getEntityDisplayName(victim) }}
                  </span>
                  <span v-if="isEntityNpc(victim)" class="npc-pip">NPC</span>
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
                  <span class="player-name">
                    {{ getEntityDisplayName(attacker) }}
                  </span>
                  <span v-if="isEntityNpc(attacker)" class="npc-pip">NPC</span>
                  <span v-if="index < event.killers.length - 1" class="operator"> + </span>
                </span>
              </div>
              <span class="separator">{{ getSeparator(event.deathType) }}</span>
              <div class="victims player-info">
                <template v-for="(victim, index) in event.victims" :key="victim">
                  <span class="player-entry">
                    <!-- Display entity name directly for NPCs, use vehicle logic for ships -->
                    <span class="player-name">
                      {{ isEntityNpc(victim) ? getEntityDisplayName(victim) : (victim.includes('_') ? getEntityDisplayName(event.vehicleType || victim) : getEntityDisplayName(victim)) }}
                    </span>
                    <span v-if="isEntityNpc(victim)" class="npc-pip">NPC</span>
                  </span>
                  <span v-if="index < event.victims.length - 1" class="operator"> + </span>
                </template>
              </div>
            </template>
            <!-- Show vehicle info only if victim is NOT a ship ID and vehicleType exists and is NOT an NPC -->
            <div class="vehicle-info" v-if="event.vehicleType && event.vehicleType !== 'Player' && !event.victims[0]?.includes('_') && !isEntityNpc(event.vehicleType)">
              ({{ getEntityDisplayName(event.vehicleType) }})
            </div>
          </div>
          <!-- Optional: Display Weapon/Damage -->
           <div class="event-details" v-if="event.weapon && event.weapon !== 'unknown' && event.weapon !== 'Collision'">
             <span class="detail-label">Method:</span> {{ getEntityDisplayName(event.weapon) }}
             <span v-if="event.damageType && event.damageType !== event.weapon">({{ getEntityDisplayName(event.damageType) }})</span>
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

    <!-- Window Position Indicator (subtle debug info) -->
    <div v-if="currentWindowOffset > 0" class="window-position-indicator">
      Viewing events {{ currentWindowOffset + 1 }} - {{ currentWindowOffset + currentEvents.length }}
    </div>

    <!-- Scroll to Top Button -->
    <button 
      v-if="showScrollToTop"
      @click="scrollToTop"
      class="scroll-to-top-button"
      :class="{ 'deep-history': currentWindowOffset > RESET_THRESHOLD }"
      :title="currentWindowOffset > RESET_THRESHOLD ? 'Reset to recent events' : 'Scroll to top'"
      :aria-label="currentWindowOffset > RESET_THRESHOLD ? 'Reset to recent events' : 'Scroll to top'">
      {{ currentWindowOffset > RESET_THRESHOLD ? '⟲' : '↑' }}
    </button>

  </div> <!-- Close kill-feed-container -->
</template>

<style scoped>
.status-badges-container {
  display: flex;
  gap: 8px;
  align-items: center;
}

/* Event Filter Dropdown - Element Plus Select */
.event-filter-select {
  width: 110px;
}

/* Style the Element Plus select to match app theme */
.event-filter-select :deep(.el-input__wrapper) {
  background-color: rgba(26, 26, 26, 0.8);
  border-color: rgba(163, 163, 163, 0.2);
  box-shadow: none;
}

.event-filter-select :deep(.el-input__inner) {
  color: rgb(163, 163, 163);
  font-size: 0.75rem;
  font-weight: 500;
}

.event-filter-select :deep(.el-input__wrapper:hover) {
  border-color: rgba(99, 99, 247, 0.5);
}

.event-filter-select :deep(.el-input__wrapper.is-focus) {
  border-color: rgb(99, 99, 247);
}

.event-filter-select :deep(.el-select__caret) {
  color: rgb(163, 163, 163);
}

.event-filter-select :deep(.el-select__placeholder) {
  color: rgba(163, 163, 163, 0.6);
}

/* Category Filter Button */
.category-filter-button {
  background-color: rgba(26, 26, 26, 0.8) !important;
  border-color: rgba(163, 163, 163, 0.2) !important;
  color: rgb(163, 163, 163) !important;
  font-size: 0.75rem;
  font-weight: 500;
  height: 32px;
  padding: 0 12px;
}

.category-filter-button:hover {
  border-color: rgba(99, 99, 247, 0.5) !important;
  background-color: rgba(26, 26, 26, 0.9) !important;
}

.category-filter-button.el-button--primary {
  background-color: rgba(99, 99, 247, 0.15) !important;
  border-color: rgba(99, 99, 247, 0.5) !important;
  color: rgb(99, 99, 247) !important;
}

.category-filter-button .category-count {
  margin-left: 4px;
  font-weight: 600;
}

/* Fix Element Plus dropdown selected item background */
:global(.el-select-dropdown) {
  background-color: #1a1a1a !important;
  border: 1px solid rgba(163, 163, 163, 0.2) !important;
}

:global(.el-select-dropdown__item) {
  color: rgb(163, 163, 163) !important;
  background-color: transparent !important;
}

:global(.el-select-dropdown__item:hover) {
  background-color: rgba(99, 99, 247, 0.1) !important;
}

:global(.el-select-dropdown__item.selected) {
  color: rgb(99, 99, 247) !important;
  background-color: rgba(99, 99, 247, 0.15) !important;
  font-weight: 600;
}

:global(.el-select-dropdown__item.selected::after) {
  display: none; /* Remove the default checkmark if present */
}

/* Category Filter Popover Content */
.category-filter-content {
  background-color: #1a1a1a;
  color: rgb(163, 163, 163);
}

.category-filter-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
  padding-bottom: 8px;
  border-bottom: 1px solid rgba(163, 163, 163, 0.1);
}

.category-filter-header h4 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: rgb(163, 163, 163);
}

.category-filter-list {
  max-height: 300px;
  overflow-y: auto;
}

.category-filter-item {
  padding: 6px 8px;
  margin: 2px 0;
  border-radius: 4px;
  cursor: pointer;
  transition: background-color 0.2s;
}

.category-filter-item:hover {
  background-color: rgba(163, 163, 163, 0.1);
}

.category-filter-item .el-checkbox {
  width: 100%;
}

.category-filter-item .el-checkbox__label {
  width: 100%;
  color: rgb(163, 163, 163) !important;
}

.category-name {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
}

.category-icon {
  margin-right: 6px;
  font-size: 16px;
}

.category-count-badge {
  margin-left: auto;
  padding: 2px 6px;
  background-color: rgba(163, 163, 163, 0.2);
  border-radius: 10px;
  font-size: 11px;
  font-weight: 500;
}

/* Dark theme for dropdown menu matching app colors */
:global(.el-select-dropdown) {
  background-color: #1a1a1a !important;
  border-color: rgba(163, 163, 163, 0.2) !important;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5) !important;
}

/* Dark theme for popover */
:global(.el-popover.el-popper) {
  background-color: #1a1a1a !important;
  border-color: rgba(163, 163, 163, 0.2) !important;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5) !important;
}

:global(.el-popper__arrow::before) {
  background-color: #1a1a1a !important;
  border-color: rgba(163, 163, 163, 0.2) !important;
}

:global(.el-select-dropdown__item) {
  color: rgb(163, 163, 163) !important;
  font-size: 0.75rem !important;
  transition: all 0.2s ease !important;
}

:global(.el-select-dropdown__item:hover) {
  background-color: rgba(99, 99, 247, 0.15) !important;
  color: rgb(99, 99, 247) !important;
}

:global(.el-select-dropdown__item.selected) {
  color: rgb(77, 77, 234) !important;
  background-color: rgba(77, 77, 234, 0.1) !important;
  font-weight: 600 !important;
}

:global(.el-select-dropdown__item.selected:hover) {
  color: rgb(99, 99, 247) !important;
  background-color: rgba(99, 99, 247, 0.15) !important;
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
  color: rgb(99, 99, 247);  /* primary-500 */
  background-color: rgba(99, 99, 247, 0.1);
  border: 1px solid rgba(99, 99, 247, 0.3);
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

.connection-banner-container {
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
  min-height: 92px; /* Minimum height to match typical event item windows */
  display: flex;
  flex-direction: column;
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

/* Event time container - holds timestamp and world icon */
.event-time-container {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
  margin-left: auto; /* Pushes time container to the right */
  padding-left: 10px; /* Ensure space from other elements */
}

/* Server source indicator pip container - positioned at mid-height of event item */
.server-source-pip-container {
  position: absolute;
  top: 50%;
  right: 12px; /* Match the padding of the event item */
  transform: translateY(-50%); /* Center vertically */
  display: flex;
  justify-content: flex-end;
  z-index: 1; /* Ensure it appears above other content */
}

/* Server source indicator (world icon pip under timestamp) */
.server-source-pip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  background-color: rgba(243, 156, 18, 0.2); /* Semi-transparent orange background */
  color: #f39c12; /* Orange color for icon */
  border: 1px solid #f39c12;
  border-radius: 50%;
  font-size: 0.6em;
  opacity: 0.8;
  transition: all 0.3s ease;
  cursor: help;
}

.server-source-pip:hover {
  opacity: 1;
  background-color: rgba(243, 156, 18, 0.3);
  transform: scale(1.1);
}

.server-source-pip svg {
  width: 8px;
  height: 8px;
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
  padding: 1px 6px;
  border-radius: 3px;
  font-size: 0.75em;
  font-weight: bold;
  text-transform: uppercase;
  white-space: nowrap;
  border: 1px solid;
  letter-spacing: 0.5px;
  vertical-align: middle;
  transition: all 0.2s ease;
}

/* PU Mode - Green */
.event-mode-pill.mode-pu {
  background-color: rgba(34, 197, 94, 0.15);
  color: #22c55e;
  border-color: rgba(34, 197, 94, 0.3);
}

.event-mode-pill.mode-pu:hover {
  background-color: rgba(34, 197, 94, 0.25);
  border-color: rgba(34, 197, 94, 0.5);
}

/* AC Mode - Orange */
.event-mode-pill.mode-ac {
  background-color: rgba(245, 158, 11, 0.15);
  color: #F59E0B;
  border-color: rgba(245, 158, 11, 0.3);
}

.event-mode-pill.mode-ac:hover {
  background-color: rgba(245, 158, 11, 0.25);
  border-color: rgba(245, 158, 11, 0.5);
}

/* Fallback for unknown modes */
.event-mode-pill:not(.mode-pu):not(.mode-ac) {
  background-color: #555;
  color: #eee;
  border-color: #777;
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
  color: #888;
  font-size: 0.85em;
  white-space: nowrap;
}

.event-content {
  padding-left: 5px; /* Restore original padding */
  flex: 1; /* Allow content to expand within the flex container */
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

/* Scroll to Top Button */
.scroll-to-top-button {
  position: fixed;
  bottom: 20px;
  right: 20px;
  width: 48px;
  height: 48px;
  background-color: #2a2a2a;
  border: 2px solid #444;
  border-radius: 50%;
  color: #fff;
  font-size: 20px;
  font-weight: bold;
  cursor: pointer;
  transition: all 0.3s ease;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
}

.scroll-to-top-button:hover {
  background-color: #3a3a3a;
  border-color: #666;
  box-shadow: 0 6px 16px rgba(0, 0, 0, 0.4);
  transform: translateY(-2px);
}

.scroll-to-top-button:active {
  background-color: #1a1a1a;
  transform: translateY(0px);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
}

/* Deep history state - indicates reset instead of scroll */
.scroll-to-top-button.deep-history {
  background-color: #3a2a0a;
  border-color: #6a5a1a;
  color: #ffd700;
}

.scroll-to-top-button.deep-history:hover {
  background-color: #4a3a1a;
  border-color: #8a7a2a;
  box-shadow: 0 6px 16px rgba(255, 215, 0, 0.2);
}

/* Window Position Indicator */
.window-position-indicator {
  position: fixed;
  top: 50%;
  right: 10px;
  transform: translateY(-50%);
  background-color: rgba(42, 42, 42, 0.9);
  border: 1px solid #444;
  border-radius: 4px;
  padding: 4px 8px;
  font-size: 11px;
  color: #aaa;
  font-family: monospace;
  z-index: 999;
  pointer-events: none;
  opacity: 0.7;
  writing-mode: vertical-rl;
  text-orientation: mixed;
}

/* NPC Pip Styling - matches game mode pills but with dark grey theme */
.npc-pip {
  display: inline-block;
  padding: 1px 6px;
  border-radius: 3px;
  font-size: 0.75em;
  font-weight: bold;
  text-transform: uppercase;
  white-space: nowrap;
  border: 1px solid;
  letter-spacing: 0.5px;
  vertical-align: middle;
  transition: all 0.2s ease;
  margin-left: 6px;
  
  /* Dark grey color scheme */
  background-color: rgba(64, 64, 64, 0.2);
  color: #999;
  border-color: rgba(64, 64, 64, 0.4);
}

/* Hover effect for NPC pips */
.npc-pip:hover {
  background-color: rgba(64, 64, 64, 0.3);
  border-color: rgba(64, 64, 64, 0.6);
  color: #bbb;
}

</style>