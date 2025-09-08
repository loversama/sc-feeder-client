import { ref, computed, watch } from 'vue';
import type { IpcRendererEvent } from 'electron';
import { navigationEventBus } from '../utils/navigation-event-bus';

export type NavigationSection = 'profile' | 'leaderboard' | 'map' | 'events' | 'stats' | 'profile-settings';

// Global state - OUTSIDE of the function to ensure singleton behavior
const currentSection = ref<NavigationSection | null>(null);
const isNavigating = ref(false);
const webContentWindowOpen = ref(false);
const lastNavigationTime = ref(0);
let isInitialized = false;

// Navigation throttle to prevent multiple rapid requests
const NAVIGATION_THROTTLE_MS = 200; // Reduced from 500ms for better responsiveness

// Sync with event bus state on module load
const busState = navigationEventBus.getState();
currentSection.value = busState.currentSection;
webContentWindowOpen.value = busState.isWindowOpen;

export function useNavigationState() {
  // Computed states for each section
  const isProfileActive = computed(() => currentSection.value === 'profile');
  const isLeaderboardActive = computed(() => currentSection.value === 'leaderboard');
  const isMapActive = computed(() => currentSection.value === 'map');
  const isEventsActive = computed(() => currentSection.value === 'events');
  const isStatsActive = computed(() => currentSection.value === 'stats');
  const isProfileSettingsActive = computed(() => currentSection.value === 'profile-settings');
  
  // Navigate to a section
  async function navigateToSection(section: NavigationSection, source: string = 'unknown') {
    console.log('[NavigationState] Navigate request:', section, 'from source:', source);
    
    // Throttle navigation to prevent rapid clicks
    const now = Date.now();
    const timeSinceLastNav = now - lastNavigationTime.value;
    
    // Don't throttle if navigating to a different section
    if (timeSinceLastNav < NAVIGATION_THROTTLE_MS && currentSection.value === section) {
      console.log('[NavigationState] Navigation throttled, too rapid for same section');
      return;
    }
    
    // Reset isNavigating if it's been stuck for too long (safety mechanism)
    if (isNavigating.value && timeSinceLastNav > 2000) {
      console.warn('[NavigationState] Resetting stuck navigation flag');
      isNavigating.value = false;
    }
    
    // Don't navigate if already navigating
    if (isNavigating.value) {
      console.log('[NavigationState] Already navigating, ignoring request');
      return;
    }
    
    // Save previous section
    const previousSection = currentSection.value;
    
    // If window is already open and on the same section, close it (toggle behavior) - but only from killfeed
    if (previousSection === section && webContentWindowOpen.value && source === 'killfeed') {
      console.log('[NavigationState] Same section clicked from killfeed, closing window:', section);
      
      // Close the window
      if (window.logMonitorApi?.closeWebContentWindow) {
        try {
          await window.logMonitorApi.closeWebContentWindow();
          // The window close handler will update the state
          return;
        } catch (error) {
          console.error('[NavigationState] Failed to close window:', error);
        }
      }
      return;
    }
    
    try {
      isNavigating.value = true;
      lastNavigationTime.value = now;
      
      // Check if we have a window open and just need to navigate it
      if (webContentWindowOpen.value && window.logMonitorApi?.webContentNavigateToSection) {
        console.log('[NavigationState] Window is open, navigating to section:', section);
        
        // Try the direct navigation first (for profile, leaderboard, map)
        if (['profile', 'leaderboard', 'map'].includes(section)) {
          const navResult = await window.logMonitorApi.webContentNavigateToSection(section as 'profile' | 'leaderboard' | 'map');
          if (navResult?.success) {
            console.log('[NavigationState] Direct navigation successful:', section);
            currentSection.value = section;
            webContentWindowOpen.value = true;
            
            // Emit navigation event
            navigationEventBus.emit({
              type: 'navigate',
              section,
              isOpen: true,
              source: source + '-direct'
            });
            
            // Reset navigation flag immediately after success
            isNavigating.value = false;
            return;
          }
        }
      }
      
      // Use the enhanced WebContentsView navigation (creates or navigates existing window)
      if (window.logMonitorApi?.openEnhancedWebContentWindow) {
        console.log('[NavigationState] Using enhanced navigation for:', section);
        
        const result = await window.logMonitorApi.openEnhancedWebContentWindow(section);
        
        if (result?.success) {
          currentSection.value = section;
          webContentWindowOpen.value = true;
          console.log('[NavigationState] Navigation successful:', section);
          
          // Emit navigation event
          navigationEventBus.emit({
            type: 'navigate',
            section,
            isOpen: true,
            source: source
          });
        } else {
          console.error('[NavigationState] Navigation failed:', result?.error);
          // Reset navigation flag on failure
          isNavigating.value = false;
        }
      } else {
        console.error('[NavigationState] Navigation API not available');
        // Reset navigation flag on API unavailable
        isNavigating.value = false;
      }
    } catch (error) {
      console.error('[NavigationState] Navigation error:', error);
    } finally {
      // Always reset navigation flag
      isNavigating.value = false;
      console.log('[NavigationState] Navigation flag reset');
    }
  }
  
  // Update state when window closes
  function onWindowClosed() {
    webContentWindowOpen.value = false;
    currentSection.value = null;
    
    // Emit window closed event
    navigationEventBus.emit({
      type: 'window-closed',
      source: 'useNavigationState'
    });
  }
  
  // Update state from external navigation (e.g., from WebContentPage)
  function updateCurrentSection(section: NavigationSection | null) {
    console.log('[NavigationState] External section update:', section);
    currentSection.value = section;
    
    if (section) {
      webContentWindowOpen.value = true;
    }
    
    // Emit state change event
    navigationEventBus.emit({
      type: 'state-change',
      section,
      isOpen: webContentWindowOpen.value,
      source: 'updateCurrentSection'
    });
  }
  
  // Initialize listeners
  function initializeListeners() {
    if (isInitialized) {
      console.log('[NavigationState] Already initialized, skipping');
      return;
    }
    
    isInitialized = true;
    console.log('[NavigationState] Initializing listeners');
    
    // Listen to event bus for state changes from other components
    const cleanup1 = navigationEventBus.on('navigate', (event) => {
      console.log('[NavigationState] Received navigate event:', event);
      if (event.section !== undefined && event.source !== 'useNavigationState') {
        currentSection.value = event.section;
        if (event.isOpen !== undefined) {
          webContentWindowOpen.value = event.isOpen;
        }
      }
    });
    
    const cleanup2 = navigationEventBus.on('state-change', (event) => {
      console.log('[NavigationState] Received state-change event:', event);
      if (event.source !== 'updateCurrentSection') {
        if (event.section !== undefined) {
          currentSection.value = event.section;
        }
        if (event.isOpen !== undefined) {
          webContentWindowOpen.value = event.isOpen;
        }
      }
    });
    
    const cleanup3 = navigationEventBus.on('window-closed', (event) => {
      console.log('[NavigationState] Received window-closed event:', event);
      if (event.source !== 'useNavigationState') {
        webContentWindowOpen.value = false;
        currentSection.value = null;
      }
    });
    
    // Store cleanup functions
    (window as any).__navigationStateCleanups = [cleanup1, cleanup2, cleanup3];
    
    // Check initial state
    if (window.logMonitorApi?.getWebContentWindowStatus) {
      window.logMonitorApi.getWebContentWindowStatus().then(status => {
        console.log('[NavigationState] Initial window status:', status);
        if (status.isOpen && status.activeSection) {
          webContentWindowOpen.value = true;
          // Map '/' to 'profile'
          if (status.activeSection === '/') {
            currentSection.value = 'profile';
            console.log('[NavigationState] Set initial section to profile (from /)');
          } else if (['profile', 'leaderboard', 'map', 'events', 'stats', 'profile-settings'].includes(status.activeSection)) {
            currentSection.value = status.activeSection as NavigationSection;
            console.log('[NavigationState] Set initial section to:', status.activeSection);
          }
        } else {
          console.log('[NavigationState] Window not open or no active section');
        }
      }).catch(error => {
        console.error('[NavigationState] Failed to get initial status:', error);
      });
    }
    
    // Listen for web content window status changes
    if (window.logMonitorApi?.onWebContentWindowStatus) {
      const cleanup = window.logMonitorApi.onWebContentWindowStatus((event: IpcRendererEvent, status: any) => {
        console.log('[NavigationState] Window status changed:', status);
        
        if (status.isOpen) {
          webContentWindowOpen.value = true;
          if (status.activeSection) {
            // Map '/' to 'profile'
            if (status.activeSection === '/') {
              currentSection.value = 'profile';
            } else if (['profile', 'leaderboard', 'map', 'events', 'stats', 'profile-settings'].includes(status.activeSection)) {
              currentSection.value = status.activeSection as NavigationSection;
            }
          }
        } else {
          onWindowClosed();
        }
      });
      
      // Store cleanup function for later
      (window as any).__navigationStateCleanup = cleanup;
    }
    
    // Listen for navigation updates from WebContentPage
    window.addEventListener('navigation-state-update', (event: any) => {
      const section = event.detail?.section;
      if (section) {
        updateCurrentSection(section as NavigationSection);
      }
    });
  }
  
  return {
    // State
    currentSection: computed(() => currentSection.value), // Return as readonly computed
    isNavigating,
    webContentWindowOpen,
    
    // Computed states
    isProfileActive,
    isLeaderboardActive,
    isMapActive,
    isEventsActive,
    isStatsActive,
    isProfileSettingsActive,
    
    // Methods
    navigateToSection,
    onWindowClosed,
    updateCurrentSection,
    initializeListeners
  };
}

// Watch for state changes and sync with event bus
watch([currentSection, webContentWindowOpen], ([section, isOpen]) => {
  // This ensures any direct ref modifications also update the event bus
  const busState = navigationEventBus.getState();
  if (busState.currentSection !== section || busState.isWindowOpen !== isOpen) {
    navigationEventBus.emit({
      type: 'state-change',
      section,
      isOpen,
      source: 'ref-watch'
    });
  }
});

// Expose navigation state globally for debugging
if (typeof window !== 'undefined') {
  (window as any).__navigationState = {
    currentSection,
    isNavigating,
    webContentWindowOpen,
    isProfileActive: computed(() => currentSection.value === 'profile'),
    isLeaderboardActive: computed(() => currentSection.value === 'leaderboard'),
    isMapActive: computed(() => currentSection.value === 'map'),
    isEventsActive: computed(() => currentSection.value === 'events'),
    isStatsActive: computed(() => currentSection.value === 'stats')
  };
}