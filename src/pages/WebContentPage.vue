<template>
  <div class="flex flex-col h-screen overflow-hidden bg-theme-bg-dark text-theme-text-light">
    <!-- Navigation Header -->
    <header class="p-2 bg-[#171717] border-b border-[#262626] shadow-md shrink-0 h-[80px] flex items-center justify-between">
      <nav class="mt-2 flex items-center flex-1">
        <!-- VOIDLOG.GG Logo -->
        <div class="flex items-center ml-4 mr-8">
          <img src="/voidlog-icon.ico" alt="VOIDLOG.GG" class="w-8 h-8 mr-3" />
          <h1 class="m-0 font-inter font-semibold text-[1.125rem] uppercase leading-none">
            <span class="text-white">VOIDLOG</span><span class="text-[rgba(99,102,241,0.8)]">.GG</span>
          </h1>
        </div>
        
        <!-- Navigation Links -->
        <div class="flex items-center space-x-6">
          <button
            @click="setActiveSection('profile')"
            class="px-3 py-2 rounded transition-colors duration-200"
            :class="{ 
              'text-[rgb(99,99,247)] bg-white/5': activeSection === 'profile',
              'hover:bg-white/5 hover:text-[rgb(77,77,234)] text-theme-text-light': activeSection !== 'profile' 
            }"
          >
            Profile
          </button>
          <button
            @click="setActiveSection('leaderboard')"
            class="px-3 py-2 rounded transition-colors duration-200"
            :class="{ 
              'text-[rgb(99,99,247)] bg-white/5': activeSection === 'leaderboard',
              'hover:bg-white/5 hover:text-[rgb(77,77,234)] text-theme-text-light': activeSection !== 'leaderboard' 
            }"
          >
            Leaderboard
          </button>
          <button
            @click="setActiveSection('map')"
            class="px-3 py-2 rounded transition-colors duration-200"
            :class="{ 
              'text-[rgb(99,99,247)] bg-white/5': activeSection === 'map',
              'hover:bg-white/5 hover:text-[rgb(77,77,234)] text-theme-text-light': activeSection !== 'map' 
            }"
          >
            Map
          </button>
          <button
            @click="setActiveSection('events')"
            class="px-3 py-2 rounded transition-colors duration-200"
            :class="{ 
              'text-[rgb(99,99,247)] bg-white/5': activeSection === 'events',
              'hover:bg-white/5 hover:text-[rgb(77,77,234)] text-theme-text-light': activeSection !== 'events' 
            }"
          >
            Events
          </button>
          <button
            @click="setActiveSection('stats')"
            class="px-3 py-2 rounded transition-colors duration-200"
            :class="{ 
              'text-[rgb(99,99,247)] bg-white/5': activeSection === 'stats',
              'hover:bg-white/5 hover:text-[rgb(77,77,234)] text-theme-text-light': activeSection !== 'stats' 
            }"
          >
            Stats
          </button>
        </div>
        
        <!-- Advanced Search Bar -->
        <div class="flex-1 ml-12 mr-6 relative">
          <div class="relative">
            <input
              ref="searchInput"
              v-model="searchQuery"
              placeholder="Search events, users, organizations..."
              class="w-full px-4 py-2 pr-10 bg-[#262626] border border-[#404040] text-white rounded-md text-sm focus:outline-none focus:border-[rgb(99,99,247)] focus:shadow-[0_0_0_1px_rgba(99,99,247,0.2)] placeholder-gray-400 transition-all duration-200"
              type="text"
              @input="handleSearchInput"
              @keydown="handleKeyNavigation"
              @focus="handleSearchFocus"
              @blur="handleSearchBlur"
            />
            <div class="absolute right-3 top-1/2 transform -translate-y-1/2">
              <div v-if="isSearching" class="animate-spin rounded-full h-4 w-4 border-b-2 border-[rgb(99,99,247)]"></div>
              <svg v-else class="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path>
              </svg>
            </div>
          </div>
          
          <!-- Search Dropdown -->
          <div 
            v-if="showSearchDropdown && (searchResults.events.length > 0 || searchResults.users.length > 0 || searchResults.organizations.length > 0 || isSearching)"
            class="absolute top-full left-0 right-0 mt-1 bg-[#2c2c2c] border border-[#404040] rounded-md shadow-lg z-50 max-h-96 overflow-hidden"
          >
            <div class="max-h-96 overflow-y-auto">
              <!-- Loading State -->
              <div v-if="isSearching" class="px-4 py-3 text-center text-gray-400">
                <div class="inline-block animate-spin rounded-full h-5 w-5 border-b-2 border-[rgb(99,99,247)] mr-2"></div>
                Searching...
              </div>
              
              <!-- Events Results -->
              <div v-if="searchResults.events.length > 0" class="border-b border-[#404040] last:border-b-0">
                <div class="px-4 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wide bg-[#1f1f1f]">
                  Events
                </div>
                <div 
                  v-for="(event, index) in searchResults.events.slice(0, 3)" 
                  :key="`event-${index}`"
                  class="px-4 py-3 hover:bg-[#333333] cursor-pointer transition-colors duration-150"
                  :class="{ 'bg-[#333333]': selectedIndex === getEventIndex(index) }"
                  @click="handleResultClick('event', event)"
                >
                  <div class="text-white text-sm font-medium">{{ formatEventTitle(event) }}</div>
                  <div class="text-gray-400 text-xs mt-1">{{ formatEventSubtitle(event) }}</div>
                </div>
                <div v-if="searchResults.events.length > 3" class="px-4 py-2 text-xs text-[rgb(99,99,247)] hover:bg-[#333333] cursor-pointer">
                  View all {{ searchResults.events.length }} events →
                </div>
              </div>
              
              <!-- Users Results -->
              <div v-if="searchResults.users.length > 0" class="border-b border-[#404040] last:border-b-0">
                <div class="px-4 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wide bg-[#1f1f1f]">
                  Users
                </div>
                <div 
                  v-for="(user, index) in searchResults.users.slice(0, 3)" 
                  :key="`user-${index}`"
                  class="px-4 py-3 hover:bg-[#333333] cursor-pointer transition-colors duration-150"
                  :class="{ 'bg-[#333333]': selectedIndex === getUserIndex(index) }"
                  @click="handleResultClick('user', user)"
                >
                  <div class="text-white text-sm font-medium">{{ user.username }}</div>
                  <div class="text-gray-400 text-xs mt-1">{{ user.organization || 'No organization' }}</div>
                </div>
                <div v-if="searchResults.users.length > 3" class="px-4 py-2 text-xs text-[rgb(99,99,247)] hover:bg-[#333333] cursor-pointer">
                  View all {{ searchResults.users.length }} users →
                </div>
              </div>
              
              <!-- Organizations Results -->
              <div v-if="searchResults.organizations.length > 0" class="border-b border-[#404040] last:border-b-0">
                <div class="px-4 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wide bg-[#1f1f1f]">
                  Organizations
                </div>
                <div 
                  v-for="(org, index) in searchResults.organizations.slice(0, 3)" 
                  :key="`org-${index}`"
                  class="px-4 py-3 hover:bg-[#333333] cursor-pointer transition-colors duration-150"
                  :class="{ 'bg-[#333333]': selectedIndex === getOrgIndex(index) }"
                  @click="handleResultClick('organization', org)"
                >
                  <div class="text-white text-sm font-medium">{{ org.name }}</div>
                  <div class="text-gray-400 text-xs mt-1">{{ org.memberCount || 0 }} members</div>
                </div>
                <div v-if="searchResults.organizations.length > 3" class="px-4 py-2 text-xs text-[rgb(99,99,247)] hover:bg-[#333333] cursor-pointer">
                  View all {{ searchResults.organizations.length }} organizations →
                </div>
              </div>
              
              <!-- No Results -->
              <div v-if="!isSearching && searchQuery.trim() && searchResults.events.length === 0 && searchResults.users.length === 0 && searchResults.organizations.length === 0" class="px-4 py-8 text-center text-gray-400">
                <div class="text-sm">No results found for "{{ searchQuery }}"</div>
                <div class="text-xs mt-1">Try searching for events, usernames, or organization names</div>
              </div>
            </div>
          </div>
        </div>
      </nav>
    </header>

    <!-- Main WebContentsView Content -->
    <div class="flex-1 overflow-hidden relative">
      <!-- WebContentsView will be attached here by the main process -->
      <div 
        id="webcontents-container"
        ref="webcontentsContainer"
        style="width: 100%; height: 100%;"
        class="bg-[#1a1a1a]"
      >
        <!-- Initial loading placeholder -->
        <div class="flex items-center justify-center h-full text-theme-text-light">
          <div class="text-center">
            <div class="mb-4 text-lg">Loading WebContentsView...</div>
            <div class="text-sm text-gray-400">Connecting with authentication...</div>
          </div>
        </div>
      </div>
      
      <!-- Loading overlay for section switches -->
      <div 
        v-if="isLoading"
        class="absolute inset-0 bg-[#1a1a1a] flex items-center justify-center z-50 transition-opacity duration-300"
        :class="{ 'opacity-0': !showLoadingOverlay, 'opacity-100': showLoadingOverlay }"
      >
        <div class="text-center text-theme-text-light">
          <div class="mb-4">
            <!-- Spinning loading icon -->
            <div class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-[rgb(99,99,247)]"></div>
          </div>
          <div class="text-lg mb-2">Loading {{ activeSection }}...</div>
          <div class="text-sm text-gray-400">Please wait...</div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed, watch } from 'vue';
import type { IpcRendererEvent } from 'electron';
import type { AuthData, UserProfile } from '../preload';

const webcontentsContainer = ref<HTMLDivElement | null>(null);
const activeSection = ref<'profile' | 'leaderboard' | 'map' | 'events' | 'stats'>('profile'); // Current active section

// State for authentication
const isAuthenticated = ref(false);
const currentUsername = ref<string | null>(null);

// Loading state management
const isLoading = ref(false);
const showLoadingOverlay = ref(false);
const isWebContentsViewAttached = ref(false);

// Search state management
const searchQuery = ref<string>('');
const isSearching = ref<boolean>(false);
const showSearchDropdown = ref<boolean>(false);
const searchInput = ref<HTMLInputElement | null>(null);
const selectedIndex = ref<number>(-1);
const searchTimeout = ref<NodeJS.Timeout | null>(null);

// Search results structure
const searchResults = ref<{
  events: any[];
  users: any[];
  organizations: any[];
}>({
  events: [],
  users: [],
  organizations: []
});

// Search functionality
const handleSearchInput = () => {
  if (searchTimeout.value) {
    clearTimeout(searchTimeout.value);
  }
  
  searchTimeout.value = setTimeout(() => {
    performSearch(searchQuery.value);
  }, 300); // 300ms debounce
};

const performSearch = async (query: string) => {
  if (!query.trim()) {
    searchResults.value = { events: [], users: [], organizations: [] };
    showSearchDropdown.value = false;
    return;
  }
  
  isSearching.value = true;
  showSearchDropdown.value = true;
  selectedIndex.value = -1;
  
  try {
    // For now, use mock data until proper API endpoints are available
    // This would eventually call the web app's search API through the WebContentsView
    await new Promise(resolve => setTimeout(resolve, 500)); // Simulate API delay
    
    // Mock search results based on query
    const mockResults = generateMockSearchResults(query);
    searchResults.value = mockResults;
    
    console.log(`[Search] Found ${mockResults.events.length} events, ${mockResults.users.length} users, ${mockResults.organizations.length} organizations`);
  } catch (error) {
    console.error('[Search] Failed:', error);
    searchResults.value = { events: [], users: [], organizations: [] };
  } finally {
    isSearching.value = false;
  }
};

// Generate mock search results (will be replaced with real API calls)
const generateMockSearchResults = (query: string) => {
  const mockEvents = [
    { id: 1, title: `Kill event involving ${query}`, subtitle: '2 minutes ago • Orison' },
    { id: 2, title: `${query} destroyed by missile`, subtitle: '5 minutes ago • Hurston' },
    { id: 3, title: `Combat between ${query} and others`, subtitle: '10 minutes ago • Crusader' }
  ];
  
  const mockUsers = [
    { id: 1, username: `${query}Player`, organization: 'Test Org' },
    { id: 2, username: `User${query}`, organization: 'Another Org' },
    { id: 3, username: `${query.toUpperCase()}`, organization: null }
  ];
  
  const mockOrganizations = [
    { id: 1, name: `${query} Corporation`, memberCount: 150 },
    { id: 2, name: `${query} Alliance`, memberCount: 75 },
    { id: 3, name: `Test ${query}`, memberCount: 25 }
  ];
  
  return {
    events: query.length > 2 ? mockEvents.slice(0, Math.min(5, mockEvents.length)) : [],
    users: query.length > 1 ? mockUsers.slice(0, Math.min(4, mockUsers.length)) : [],
    organizations: query.length > 2 ? mockOrganizations.slice(0, Math.min(3, mockOrganizations.length)) : []
  };
};

// Search dropdown navigation
const handleKeyNavigation = (event: KeyboardEvent) => {
  if (!showSearchDropdown.value) return;
  
  const totalResults = getTotalVisibleResults();
  
  switch (event.key) {
    case 'ArrowDown':
      event.preventDefault();
      selectedIndex.value = Math.min(selectedIndex.value + 1, totalResults - 1);
      break;
    case 'ArrowUp':
      event.preventDefault();
      selectedIndex.value = Math.max(selectedIndex.value - 1, -1);
      break;
    case 'Enter':
      event.preventDefault();
      if (selectedIndex.value >= 0) {
        executeSelectedResult();
      } else if (searchQuery.value.trim()) {
        // Default to events search
        setActiveSection('events');
        showSearchDropdown.value = false;
      }
      break;
    case 'Escape':
      event.preventDefault();
      showSearchDropdown.value = false;
      selectedIndex.value = -1;
      searchInput.value?.blur();
      break;
  }
};

const handleSearchFocus = () => {
  if (searchQuery.value.trim() && (searchResults.value.events.length > 0 || searchResults.value.users.length > 0 || searchResults.value.organizations.length > 0)) {
    showSearchDropdown.value = true;
  }
};

const handleSearchBlur = () => {
  // Delay hiding dropdown to allow clicks on results
  setTimeout(() => {
    showSearchDropdown.value = false;
    selectedIndex.value = -1;
  }, 150);
};

// Helper functions for search results
const getTotalVisibleResults = (): number => {
  return Math.min(3, searchResults.value.events.length) +
         Math.min(3, searchResults.value.users.length) +
         Math.min(3, searchResults.value.organizations.length);
};

const getEventIndex = (index: number): number => index;
const getUserIndex = (index: number): number => Math.min(3, searchResults.value.events.length) + index;
const getOrgIndex = (index: number): number => Math.min(3, searchResults.value.events.length) + Math.min(3, searchResults.value.users.length) + index;

const executeSelectedResult = () => {
  const eventCount = Math.min(3, searchResults.value.events.length);
  const userCount = Math.min(3, searchResults.value.users.length);
  
  if (selectedIndex.value < eventCount) {
    // Selected an event
    const event = searchResults.value.events[selectedIndex.value];
    handleResultClick('event', event);
  } else if (selectedIndex.value < eventCount + userCount) {
    // Selected a user
    const user = searchResults.value.users[selectedIndex.value - eventCount];
    handleResultClick('user', user);
  } else {
    // Selected an organization
    const org = searchResults.value.organizations[selectedIndex.value - eventCount - userCount];
    handleResultClick('organization', org);
  }
};

const handleResultClick = (type: 'event' | 'user' | 'organization', item: any) => {
  console.log(`[Search] Selected ${type}:`, item);
  
  switch (type) {
    case 'event':
      setActiveSection('events');
      // TODO: Navigate to specific event
      break;
    case 'user':
      setActiveSection('profile');
      // TODO: Navigate to user profile
      break;
    case 'organization':
      // TODO: Navigate to organization page
      console.log('Organization search not implemented yet');
      break;
  }
  
  showSearchDropdown.value = false;
  selectedIndex.value = -1;
  searchInput.value?.blur();
};

// Format functions for display
const formatEventTitle = (event: any): string => {
  return event.title || 'Unknown Event';
};

const formatEventSubtitle = (event: any): string => {
  return event.subtitle || 'No details available';
};

// Function to change active section with loading transitions
const setActiveSection = async (section: 'profile' | 'leaderboard' | 'map' | 'events' | 'stats') => {
  console.log(`[WebContentPage] Setting active section to: ${section}`);
  
  // Don't show loading if it's the same section or if WebContentsView isn't attached yet
  if (section === activeSection.value || !isWebContentsViewAttached.value) {
    activeSection.value = section;
    return;
  }
  
  // Show loading overlay with fade in
  isLoading.value = true;
  showLoadingOverlay.value = true;
  
  activeSection.value = section;
  
  try {
    // Notify main process to navigate the WebContentsView to the new section
    if (window.logMonitorApi && window.logMonitorApi.openEnhancedWebContentWindow) {
      console.log(`[WebContentPage] Navigating WebContentsView to section: ${section}`);
      const result = await window.logMonitorApi.openEnhancedWebContentWindow(section);
      console.log(`[WebContentPage] Navigation result:`, result);
      
      // Loading overlay will be hidden by the 'webcontents-view-loaded' event
      // Add a timeout fallback in case the event doesn't fire
      setTimeout(() => {
        if (isLoading.value) {
          console.log('[WebContentPage] Timeout fallback: hiding loading overlay');
          showLoadingOverlay.value = false;
          setTimeout(() => {
            isLoading.value = false;
          }, 300);
        }
      }, 5000); // 5 second timeout
    } else {
      console.warn('[WebContentPage] Enhanced API not available for navigation');
      // Hide loading immediately if API not available
      showLoadingOverlay.value = false;
      setTimeout(() => {
        isLoading.value = false;
      }, 300);
    }
  } catch (error) {
    console.error(`[WebContentPage] Failed to navigate WebContentsView to section ${section}:`, error);
    // Hide loading on error
    showLoadingOverlay.value = false;
    setTimeout(() => {
      isLoading.value = false;
    }, 300);
  }
};

// Watch for section changes to notify main process
watch(activeSection, (newSection) => {
  console.log(`[WebContentPage] Active section changed to: ${newSection}`);
  // The main process will handle the WebContentsView navigation
});

// Function to notify main process that WebContentPage is ready for WebContentsView
const notifyMainProcessReady = async () => {
  console.log('[WebContentPage] Notifying main process that WebContentPage is ready');
  
  // Use a longer delay to ensure window is fully ready
  setTimeout(async () => {
    try {
      console.log('[WebContentPage] Starting WebContentsView attachment process');
      console.log('[WebContentPage] Window title:', document.title);
      console.log('[WebContentPage] Active section:', activeSection.value);
      
      // Call the enhanced IPC handler to attach WebContentsView to THIS window
      if (window.logMonitorApi && window.logMonitorApi.openEnhancedWebContentWindow) {
        console.log('[WebContentPage] Requesting WebContentsView attachment for section:', activeSection.value);
        const result = await window.logMonitorApi.openEnhancedWebContentWindow(activeSection.value);
        console.log('[WebContentPage] WebContentsView attach result:', result);
        
        if (result.success) {
          console.log('[WebContentPage] WebContentsView attached successfully');
          // Hide the loading placeholder since WebContentsView is now attached
          const container = document.getElementById('webcontents-container');
          if (container) {
            // Clear the loading message
            container.innerHTML = '';
            console.log('[WebContentPage] Cleared loading message from container');
          }
          
          // Mark WebContentsView as attached to enable loading transitions
          isWebContentsViewAttached.value = true;
        } else {
          console.error('[WebContentPage] WebContentsView attachment failed:', result.error);
        }
      } else {
        console.warn('[WebContentPage] Enhanced API not available');
      }
    } catch (error) {
      console.error('[WebContentPage] Exception during WebContentsView attachment:', error);
    }
  }, 500); // Increased delay to ensure window is fully ready
};


// Function to update authentication status
const updateAuthStatus = async () => {
  try {
    if (window.logMonitorApi && window.logMonitorApi.authGetStatus) {
      const status = await window.logMonitorApi.authGetStatus();
      isAuthenticated.value = status.isAuthenticated;
      currentUsername.value = status.username;
      console.log(`[WebContentPage] Auth status updated: authenticated=${isAuthenticated.value}, username=${currentUsername.value}`);
    }
  } catch (error) {
    console.error('[WebContentPage] Failed to get auth status:', error);
    isAuthenticated.value = false;
    currentUsername.value = null;
  }
};

onMounted(async () => {
  console.log('[WebContentPage] Mounted.');

  // Get authentication status first
  await updateAuthStatus();

  // Get initial section from window status
  if (window.logMonitorApi && window.logMonitorApi.getWebContentWindowStatus) {
    try {
      const status = await window.logMonitorApi.getWebContentWindowStatus();
      if (status.isOpen && status.activeSection) {
        if (status.activeSection === 'profile' || status.activeSection === 'leaderboard' || status.activeSection === 'map' || status.activeSection === 'events' || status.activeSection === 'stats') {
          activeSection.value = status.activeSection;
          console.log(`[WebContentPage] Initial section set to: ${activeSection.value}`);
        }
      }
    } catch (error) {
      console.error('[WebContentPage] Failed to get initial window status:', error);
    }
  }

  // Listen for navigation requests from main process
  window.addEventListener('web-content-navigate', (event: any) => {
    const section = event.detail?.section;
    if (section === 'profile' || section === 'leaderboard' || section === 'map' || section === 'events' || section === 'stats') {
      console.log(`[WebContentPage] Received navigation request for: ${section}`);
      setActiveSection(section);
    }
  });

  // Listen for auth status changes
  if (window.logMonitorApi && window.logMonitorApi.onAuthStatusChanged) {
    window.logMonitorApi.onAuthStatusChanged((_event: IpcRendererEvent, status: any) => {
      console.log('[WebContentPage] Received auth-status-changed:', status);
      isAuthenticated.value = status.isAuthenticated;
      currentUsername.value = status.username;
    });
  }

  // Listen for WebContentsView events
  window.addEventListener('message', (event) => {
    if (event.source === window) {
      switch (event.data.type) {
        case 'webcontents-view-ready':
          console.log('[WebContentPage] WebContentsView is ready');
          break;
        case 'webcontents-view-loading':
          console.log('[WebContentPage] WebContentsView started loading');
          break;
        case 'webcontents-view-loaded':
          console.log('[WebContentPage] WebContentsView finished loading');
          // Hide loading overlay when content is loaded
          if (isLoading.value) {
            showLoadingOverlay.value = false;
            setTimeout(() => {
              isLoading.value = false;
            }, 300);
          }
          break;
        case 'webcontents-view-error':
          console.error('[WebContentPage] WebContentsView error:', event.data.error);
          // Hide loading overlay on error
          if (isLoading.value) {
            showLoadingOverlay.value = false;
            setTimeout(() => {
              isLoading.value = false;
            }, 300);
          }
          break;
      }
    }
  });

  // Set up IPC event listeners for WebContentsView events
  if (window.electron && window.electron.ipcRenderer) {
    window.electron.ipcRenderer.on('webcontents-view-ready', () => {
      console.log('[WebContentPage] WebContentsView is ready');
    });
    
    window.electron.ipcRenderer.on('webcontents-view-loading', () => {
      console.log('[WebContentPage] WebContentsView started loading');
    });
    
    window.electron.ipcRenderer.on('webcontents-view-loaded', () => {
      console.log('[WebContentPage] WebContentsView finished loading');
      // Hide loading overlay when content is loaded
      if (isLoading.value) {
        showLoadingOverlay.value = false;
        setTimeout(() => {
          isLoading.value = false;
        }, 300);
      }
    });
    
    window.electron.ipcRenderer.on('webcontents-view-error', (event, error) => {
      console.error('[WebContentPage] WebContentsView error:', error);
      // Hide loading overlay on error
      if (isLoading.value) {
        showLoadingOverlay.value = false;
        setTimeout(() => {
          isLoading.value = false;
        }, 300);
      }
    });
  }

  // Notify main process that WebContentPage is ready for WebContentsView attachment
  notifyMainProcessReady();
});

onUnmounted(() => {
  console.log('[WebContentPage] Unmounted - WebContentsView will be cleaned up by main process');
});

</script>

<style scoped>
/* Custom titlebar styles */
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
  z-index: 1 !important;
}

.cet-menubar {
  display: none !important;
}

.cet-icon {
  display: none !important;
}

/* Ensure webview takes full space */
webview {
  border: none;
  outline: none;
}

/* Navigation button states */
button {
  outline: none;
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;
}

button:focus {
  outline: 2px solid rgba(99, 99, 247, 0.5);
  outline-offset: 2px;
}
</style>