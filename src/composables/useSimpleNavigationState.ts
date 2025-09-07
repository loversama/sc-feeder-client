import { ref, computed } from 'vue';
import { navigationEventBus } from '../utils/navigation-event-bus';
import type { NavigationSection } from './useNavigationState';

// Simple, direct navigation state management
// This is a simplified version to test if the complex logic is causing issues

const currentSection = ref<NavigationSection | null>(null);
const isNavigating = ref(false);

// Initialize from event bus
const busState = navigationEventBus.getState();
currentSection.value = busState.currentSection;

// Watch for changes from event bus
navigationEventBus.on('all', (event) => {
  if (event.type === 'navigate' || event.type === 'state-change') {
    if (event.section !== undefined) {
      console.log('[SimpleNav] Updating section from event:', event.section);
      currentSection.value = event.section;
    }
  }
});

export function useSimpleNavigationState() {
  // Computed active states
  const isProfileActive = computed(() => currentSection.value === 'profile');
  const isLeaderboardActive = computed(() => currentSection.value === 'leaderboard');
  const isMapActive = computed(() => currentSection.value === 'map');
  const isEventsActive = computed(() => currentSection.value === 'events');
  const isStatsActive = computed(() => currentSection.value === 'stats');
  
  // Simple navigation function
  async function navigateToSection(section: NavigationSection) {
    console.log('[SimpleNav] Navigate to:', section);
    
    // Update state immediately
    currentSection.value = section;
    
    // Emit event
    navigationEventBus.emit({
      type: 'navigate',
      section,
      isOpen: true,
      source: 'simple-nav'
    });
    
    // Call API if available
    if (window.logMonitorApi?.openEnhancedWebContentWindow) {
      try {
        isNavigating.value = true;
        const result = await window.logMonitorApi.openEnhancedWebContentWindow(section);
        console.log('[SimpleNav] API result:', result);
      } catch (error) {
        console.error('[SimpleNav] API error:', error);
      } finally {
        isNavigating.value = false;
      }
    }
  }
  
  return {
    currentSection,
    isNavigating,
    isProfileActive,
    isLeaderboardActive,
    isMapActive,
    isEventsActive,
    isStatsActive,
    navigateToSection
  };
}