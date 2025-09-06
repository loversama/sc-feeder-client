import { ref, computed } from 'vue';
import type { IpcRendererEvent } from 'electron';

export type NavigationSection = 'profile' | 'leaderboard' | 'map' | 'events' | 'stats' | 'profile-settings';

// Global state
const currentSection = ref<NavigationSection | null>(null);
const isNavigating = ref(false);
const webContentWindowOpen = ref(false);
const lastNavigationTime = ref(0);

// Navigation throttle to prevent multiple rapid requests
const NAVIGATION_THROTTLE_MS = 500;

export function useNavigationState() {
  // Computed states for each section
  const isProfileActive = computed(() => currentSection.value === 'profile');
  const isLeaderboardActive = computed(() => currentSection.value === 'leaderboard');
  const isMapActive = computed(() => currentSection.value === 'map');
  const isEventsActive = computed(() => currentSection.value === 'events');
  const isStatsActive = computed(() => currentSection.value === 'stats');
  const isProfileSettingsActive = computed(() => currentSection.value === 'profile-settings');
  
  // Navigate to a section
  async function navigateToSection(section: NavigationSection) {
    console.log('[NavigationState] Navigate request:', section);
    
    // Throttle navigation to prevent rapid clicks
    const now = Date.now();
    if (now - lastNavigationTime.value < NAVIGATION_THROTTLE_MS) {
      console.log('[NavigationState] Navigation throttled, too rapid');
      return;
    }
    
    // Don't navigate if already navigating
    if (isNavigating.value) {
      console.log('[NavigationState] Already navigating, ignoring request');
      return;
    }
    
    // Don't navigate if already on the same section
    if (currentSection.value === section && webContentWindowOpen.value) {
      console.log('[NavigationState] Already on section:', section);
      return;
    }
    
    try {
      isNavigating.value = true;
      lastNavigationTime.value = now;
      
      // Use the enhanced WebContentsView navigation
      if (window.logMonitorApi?.openEnhancedWebContentWindow) {
        console.log('[NavigationState] Using enhanced navigation for:', section);
        
        const result = await window.logMonitorApi.openEnhancedWebContentWindow(section);
        
        if (result?.success) {
          currentSection.value = section;
          webContentWindowOpen.value = true;
          console.log('[NavigationState] Navigation successful:', section);
        } else {
          console.error('[NavigationState] Navigation failed:', result?.error);
        }
      } else {
        console.error('[NavigationState] Navigation API not available');
      }
    } catch (error) {
      console.error('[NavigationState] Navigation error:', error);
    } finally {
      isNavigating.value = false;
    }
  }
  
  // Update state when window closes
  function onWindowClosed() {
    webContentWindowOpen.value = false;
    currentSection.value = null;
  }
  
  // Update state from external navigation (e.g., from WebContentPage)
  function updateCurrentSection(section: NavigationSection | null) {
    console.log('[NavigationState] External section update:', section);
    currentSection.value = section;
    
    if (section) {
      webContentWindowOpen.value = true;
    }
  }
  
  // Initialize listeners
  function initializeListeners() {
    // Listen for web content window status changes
    if (window.logMonitorApi?.onWebContentWindowStatusChanged) {
      window.logMonitorApi.onWebContentWindowStatusChanged((event: IpcRendererEvent, status: any) => {
        console.log('[NavigationState] Window status changed:', status);
        
        if (status.isOpen) {
          webContentWindowOpen.value = true;
          if (status.activeSection) {
            currentSection.value = status.activeSection as NavigationSection;
          }
        } else {
          onWindowClosed();
        }
      });
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
    currentSection,
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