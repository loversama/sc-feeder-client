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
        <div class="flex-[0.9] ml-12 mr-6 relative">
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
          
        </div>
      </nav>
    </header>

    <!-- Search Megamenu -->
    <div 
      v-if="showSearchDropdown && (searchResults.events.length > 0 || searchResults.users.length > 0 || searchResults.organizations.length > 0 || isSearching)"
      class="w-full bg-[#2c2c2c] border-b border-[#404040] shadow-lg z-[9999]"
    >
      <div class="container mx-auto px-6 py-6">
        <!-- Loading State -->
        <div v-if="isSearching" class="text-center text-gray-400 py-8">
          <div class="inline-block animate-spin rounded-full h-6 w-6 border-b-2 border-[rgb(99,99,247)] mr-3"></div>
          <span class="text-lg">Searching...</span>
        </div>
        
        <!-- Results Grid -->
        <div v-else class="grid grid-cols-1 md:grid-cols-3 gap-8">
          <!-- Events Column -->
          <div v-if="searchResults.events.length > 0" class="space-y-4">
            <h3 class="text-lg font-semibold text-white border-b border-[#404040] pb-2">
              Events ({{ searchResults.events.length }})
            </h3>
            <div class="space-y-3">
              <div 
                v-for="(event, index) in searchResults.events.slice(0, 5)" 
                :key="`event-${index}`"
                class="p-3 hover:bg-[#333333] cursor-pointer transition-colors duration-150 rounded-md"
                :class="{ 'bg-[#333333]': selectedIndex === getEventIndex(index) }"
                @click="handleResultClick('event', event)"
              >
                <div class="text-white text-sm font-medium">{{ formatEventTitle(event) }}</div>
                <div class="text-gray-400 text-xs mt-1">{{ formatEventSubtitle(event) }}</div>
              </div>
              <div v-if="searchResults.events.length > 5" class="pt-2">
                <button class="text-[rgb(99,99,247)] text-sm hover:text-[rgb(77,77,234)] transition-colors">
                  View all {{ searchResults.events.length }} events →
                </button>
              </div>
            </div>
          </div>
          
          <!-- Users Column -->
          <div v-if="searchResults.users.length > 0" class="space-y-4">
            <h3 class="text-lg font-semibold text-white border-b border-[#404040] pb-2">
              Users ({{ searchResults.users.length }})
            </h3>
            <div class="space-y-3">
              <div 
                v-for="(user, index) in searchResults.users.slice(0, 5)" 
                :key="`user-${index}`"
                class="p-3 hover:bg-[#333333] cursor-pointer transition-colors duration-150 rounded-md flex items-center space-x-3"
                :class="{ 'bg-[#333333]': selectedIndex === getUserIndex(index) }"
                @click="handleResultClick('user', user)"
              >
                <!-- User Avatar -->
                <div class="flex-shrink-0">
                  <img 
                    v-if="user.pfpUrl" 
                    :src="user.pfpUrl" 
                    :alt="`${user.username} avatar`"
                    class="w-8 h-8 rounded-full object-cover"
                    @load="(e) => console.log('[Search] Avatar loaded successfully for:', user.username, 'URL:', user.pfpUrl)"
                    @error="(e) => handleImageError(e, user)"
                  />
                  <div 
                    v-else 
                    class="w-8 h-8 rounded-full bg-[rgb(99,99,247)] flex items-center justify-center text-white text-xs font-bold"
                    @click="() => console.log('[Search] Fallback avatar for user:', user.username, 'pfpUrl was:', user.pfpUrl)"
                  >
                    {{ user.username.charAt(0).toUpperCase() }}
                  </div>
                </div>
                
                <!-- User Info -->
                <div class="flex-1 min-w-0">
                  <div class="text-white text-sm font-medium truncate">{{ user.username }}</div>
                  <div class="text-gray-400 text-xs mt-1 flex items-center space-x-1">
                    <!-- Organization Logo -->
                    <img 
                      v-if="user.organizationIconUrl" 
                      :src="user.organizationIconUrl" 
                      :alt="'Organization icon'"
                      class="w-3 h-3 rounded object-cover flex-shrink-0"
                      @load="(e) => console.log('[Search] User org icon loaded for:', user.username)"
                      @error="(e) => handleOrgIconError(e, { iconUrl: user.organizationIconUrl, name: user.organization })"
                    />
                    <div 
                      v-else-if="user.organization && user.organization !== 'No organization'" 
                      class="w-3 h-3 rounded bg-[rgb(99,99,247)] flex items-center justify-center text-white flex-shrink-0"
                      style="font-size: 6px; font-weight: bold;"
                    >
                      {{ getOrgInitials(user.organization) }}
                    </div>
                    
                    <!-- Organization Text -->
                    <span class="truncate">{{ user.organization || 'No organization' }}</span>
                  </div>
                </div>
              </div>
              <div v-if="searchResults.users.length > 5" class="pt-2">
                <button class="text-[rgb(99,99,247)] text-sm hover:text-[rgb(77,77,234)] transition-colors">
                  View all {{ searchResults.users.length }} users →
                </button>
              </div>
            </div>
          </div>
          
          <!-- Organizations Column -->
          <div v-if="searchResults.organizations.length > 0" class="space-y-4">
            <h3 class="text-lg font-semibold text-white border-b border-[#404040] pb-2">
              Organizations ({{ searchResults.organizations.length }})
            </h3>
            <div class="space-y-3">
              <div 
                v-for="(org, index) in searchResults.organizations.slice(0, 5)" 
                :key="`org-${index}`"
                class="p-3 hover:bg-[#333333] cursor-pointer transition-colors duration-150 rounded-md flex items-center space-x-3"
                :class="{ 'bg-[#333333]': selectedIndex === getOrgIndex(index) }"
                @click="handleResultClick('organization', org)"
              >
                <!-- Organization Icon -->
                <div class="flex-shrink-0">
                  <img 
                    v-if="org.iconUrl" 
                    :src="org.iconUrl" 
                    :alt="`${org.name} icon`"
                    class="w-8 h-8 rounded object-cover"
                    @load="(e) => console.log('[Search] Org icon loaded successfully for:', org.name, 'URL:', org.iconUrl)"
                    @error="(e) => handleOrgIconError(e, org)"
                  />
                  <div 
                    v-else 
                    class="w-8 h-8 rounded bg-[rgb(99,99,247)] flex items-center justify-center text-white text-xs font-bold"
                  >
                    {{ org.tag ? org.tag.substring(0, 2).toUpperCase() : org.name.charAt(0).toUpperCase() }}
                  </div>
                </div>
                
                <!-- Organization Info -->
                <div class="flex-1 min-w-0">
                  <div class="text-white text-sm font-medium truncate">{{ org.name }}</div>
                  <div class="text-gray-400 text-xs mt-1">
                    {{ org.memberCount || 0 }} members
                    <span v-if="org.sampleMembers && org.sampleMembers.length > 0" class="text-gray-500">
                      • {{ org.sampleMembers.slice(0, 2).join(', ') }}{{ org.sampleMembers.length > 2 ? '...' : '' }}
                    </span>
                  </div>
                </div>
              </div>
              <div v-if="searchResults.organizations.length > 5" class="pt-2">
                <button class="text-[rgb(99,99,247)] text-sm hover:text-[rgb(77,77,234)] transition-colors">
                  View all {{ searchResults.organizations.length }} organizations →
                </button>
              </div>
            </div>
          </div>
        </div>
        
        <!-- No Results -->
        <div v-if="!isSearching && searchQuery.trim() && searchResults.events.length === 0 && searchResults.users.length === 0 && searchResults.organizations.length === 0" class="text-center text-gray-400 py-12">
          <div class="text-lg mb-2">No results found for "{{ searchQuery }}"</div>
          <div class="text-sm">Try searching for events, usernames, or organization names</div>
        </div>
      </div>
    </div>

    <!-- Main WebContentsView Content -->
    <div class="flex-1 overflow-hidden relative">
      <!-- WebContentsView will be attached here by the main process -->
      <!-- TEMPORARY: Hide WebContentsView while search is open to test z-index issue -->
      <div 
        id="webcontents-container"
        ref="webcontentsContainer"
        style="width: 100%; height: 100%;"
        class="bg-[#1a1a1a]"
        :class="{ 'invisible': showSearchDropdown }"
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
const lastSentSearchData = ref<string>(''); // Track last sent data to prevent spam

// Reset search state after page navigation
const resetSearchState = () => {
  console.log('[Search] Resetting search state after navigation');
  lastSentSearchData.value = '';
  // Clear any existing search if there's text in the box
  if (searchQuery.value.trim()) {
    sendSearchDataToWebContentsView('', false, { events: [], users: [], organizations: [] }, true);
  }
};

// Function to send search data to WebContentsView via DOM injection
const sendSearchDataToWebContentsView = (query: string, loading: boolean, results: any, forceUpdate = false) => {
  // Create a hash of the current data to avoid sending duplicate data
  const currentDataHash = `${query}-${loading}-${JSON.stringify(results)}`;
  
  // Only send if data has actually changed (unless forcing update)
  if (!forceUpdate && currentDataHash === lastSentSearchData.value) {
    return; // Skip if data hasn't changed
  }
  
  lastSentSearchData.value = currentDataHash;
  
  // Only log if it's a significant change (not just loading state changes)
  if (!loading || query.length === 0) {
    console.log(`[Search] Sending to WebContentsView:`, { query, loading, results });
  }
  
  // Use IPC to execute JavaScript in the WebContentsView
  if (window.logMonitorApi && window.logMonitorApi.executeInWebContentsView) {
    const searchData = {
      query: query,
      isActive: query.length > 0,
      isLoading: loading,
      results: results,
      timestamp: Date.now()
    };
    
    const jsCode = `
      // Set search data on window object
      window.electronSearchState = ${JSON.stringify(searchData)};
      
      // Dispatch custom event for web app to listen
      window.dispatchEvent(new CustomEvent('electron-search-changed', {
        detail: window.electronSearchState
      }));
      
      // Only log in web app if query changed (not just loading state)
      if (!${loading} || '${query}'.length === 0) {
        console.log('[ElectronSearch] Data updated:', window.electronSearchState);
      }
    `;
    
    window.logMonitorApi.executeInWebContentsView(jsCode);
  } else {
    console.warn('[Search] executeInWebContentsView API not available');
  }
};

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
  
  // Reset search state if needed to ensure DOM bridge works
  if (lastSentSearchData.value && !searchQuery.value.trim()) {
    resetSearchState();
  }
  
  searchTimeout.value = setTimeout(() => {
    performSearch(searchQuery.value);
  }, 300); // 300ms debounce
};

const performSearch = async (query: string) => {
  if (!query.trim()) {
    searchResults.value = { events: [], users: [], organizations: [] };
    showSearchDropdown.value = false;
    // Send empty search to WebContentsView
    sendSearchDataToWebContentsView('', false, { events: [], users: [], organizations: [] });
    return;
  }
  
  isSearching.value = true;
  showSearchDropdown.value = true;
  selectedIndex.value = -1;
  
  // Send loading state to WebContentsView
  sendSearchDataToWebContentsView(query, true, { events: [], users: [], organizations: [] });
  
  try {
    console.log(`[Search] Performing real API search for: "${query}"`);
    
    // Call the real search API
    const apiResults = await callSearchAPI(query);
    
    // Transform API results to match expected format
    const transformedResults = transformSearchResults(apiResults);
    searchResults.value = transformedResults;
    
    // Send results to WebContentsView
    sendSearchDataToWebContentsView(query, false, transformedResults);
    
    console.log(`[Search] Found ${transformedResults.events.length} events, ${transformedResults.users.length} users, ${transformedResults.organizations.length} organizations`);
  } catch (error) {
    console.error('[Search] API call failed:', error);
    
    // Fallback to mock data if API fails
    console.log('[Search] Falling back to mock data due to API error');
    const mockResults = generateMockSearchResults(query);
    searchResults.value = mockResults;
    sendSearchDataToWebContentsView(query, false, mockResults);
  } finally {
    isSearching.value = false;
  }
};

// Real API search function using IPC proxy to bypass CORS
const callSearchAPI = async (query: string) => {
  console.log(`[Search] Calling search API via IPC proxy for query: "${query}"`);
  
  try {
    // Use IPC to call search API through main process (bypasses CORS)
    const response = await window.logMonitorApi.invoke('search-api:query', query);
    console.log('[Search] IPC API response:', response);
    
    if (!response.success) {
      throw new Error(response.error || 'Search API call failed');
    }
    
    return response.data;
  } catch (error) {
    console.error('[Search] IPC API call failed:', error);
    throw new Error(`Search API call failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
};

// Transform API results to match expected UI format
const transformSearchResults = (apiResults: any[]) => {
  const transformed: {
    events: any[];
    users: any[];
    organizations: any[];
  } = {
    events: [],
    users: [],
    organizations: []
  };
  
  if (!Array.isArray(apiResults)) {
    console.warn('[Search] API results is not an array:', apiResults);
    return transformed;
  }
  
  // Group results by type
  apiResults.forEach((item: any) => {
    try {
      const transformedItem = {
        id: item.value || item.id,
        title: item.label,
        subtitle: '', // Will be set based on type
        label: item.label,
        value: item.value,
        type: item.type
      };
      
      if (item.type === 'user' || item.type === 'player') {
        // User/Player result
        console.log('[Search] Processing user item:', {
          label: item.label,
          pfpUrl: item.pfpUrl,
          fullItem: item
        });
        
        transformed.users.push({
          ...transformedItem,
          username: item.label,
          organization: item.organizationName 
            ? `${item.organizationName} [${item.organizationSid || 'No tag'}]` 
            : 'No organization',
          pfpUrl: item.pfpUrl,
          organizationIconUrl: item.organizationIconUrl
        });
      } else if (item.type === 'event') {
        // Event result
        let subtitle = 'Event details';
        if (item.participants) {
          const attacker = item.participants.attacker || '?';
          const victim = item.participants.victim || '?';
          subtitle = `${attacker} vs ${victim}`;
        }
        
        transformed.events.push({
          ...transformedItem,
          subtitle: subtitle,
          participants: item.participants
        });
      } else if (item.type === 'organization') {
        // Organization result
        transformed.organizations.push({
          ...transformedItem,
          name: item.label,
          memberCount: item.memberCount || 0,
          iconUrl: item.iconUrl,
          tag: item.value,
          sampleMembers: item.sampleMembers || []
        });
      }
    } catch (error) {
      console.error('[Search] Error transforming result item:', item, error);
    }
  });
  
  console.log('[Search] Transformed results:', transformed);
  return transformed;
};

// Generate mock search results (fallback when API fails)
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
        // Navigate to dedicated search page with query parameters
        navigateToSearchPage(searchQuery.value.trim());
        showSearchDropdown.value = false;
      }
      break;
    case 'Escape':
      event.preventDefault();
      showSearchDropdown.value = false;
      selectedIndex.value = -1;
      searchInput.value?.blur();
      // Show WebContentsView when search closes
      if (window.electron && window.electron.ipcRenderer) {
        window.electron.ipcRenderer.send('enhanced-window:show-webcontentsview');
      }
      break;
  }
};

const handleSearchFocus = () => {
  if (searchQuery.value.trim() && (searchResults.value.events.length > 0 || searchResults.value.users.length > 0 || searchResults.value.organizations.length > 0)) {
    showSearchDropdown.value = true;
    // Hide WebContentsView when search opens
    if (window.electron && window.electron.ipcRenderer) {
      window.electron.ipcRenderer.send('enhanced-window:hide-webcontentsview');
    }
  }
};

const handleSearchBlur = () => {
  // Delay hiding dropdown to allow clicks on results
  setTimeout(() => {
    showSearchDropdown.value = false;
    selectedIndex.value = -1;
    // Show WebContentsView when search closes
    if (window.electron && window.electron.ipcRenderer) {
      window.electron.ipcRenderer.send('enhanced-window:show-webcontentsview');
    }
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
  console.log(`[Search] *** RESULT CLICKED *** Type: ${type}, Item:`, item);
  
  // Hide dropdown immediately and show WebContentsView
  showSearchDropdown.value = false;
  
  if (window.electron && window.electron.ipcRenderer) {
    window.electron.ipcRenderer.send('enhanced-window:show-webcontentsview');
  }
  
  // Navigate to appropriate section - setActiveSection will handle search clearing
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
};

// Navigate to dedicated search page with query parameters
const navigateToSearchPage = async (query: string) => {
  console.log(`[Search] Navigating to search page with query: "${query}"`);
  
  try {
    // Clear search state and hide dropdown
    showSearchDropdown.value = false;
    selectedIndex.value = -1;
    
    // Show WebContentsView
    if (window.electron && window.electron.ipcRenderer) {
      window.electron.ipcRenderer.send('enhanced-window:show-webcontentsview');
    }
    
    // Use the enhanced IPC to navigate to the search page with query parameters
    if (window.logMonitorApi && window.logMonitorApi.navigateToSearchPage) {
      const result = await window.logMonitorApi.navigateToSearchPage(query);
      console.log('[Search] Navigation to search page result:', result);
      
      if (result.success) {
        // Clear the search box after successful navigation
        searchQuery.value = '';
        searchResults.value = { events: [], users: [], organizations: [] };
        lastSentSearchData.value = '';
        
        if (searchInput.value) {
          searchInput.value.value = '';
        }
        
        // Don't send DOM bridge data to search page - let it handle its own state from URL parameters
        console.log('[Search] Successfully navigated to search page, letting page handle its own state');
      }
    } else {
      console.warn('[Search] navigateToSearchPage API not available, falling back to events section');
      // Fallback to events section if API not available
      setActiveSection('events');
    }
  } catch (error) {
    console.error('[Search] Failed to navigate to search page:', error);
    // Fallback to events section on error
    setActiveSection('events');
  }
};

// Format functions for display
const formatEventTitle = (event: any): string => {
  return event.title || 'Unknown Event';
};

const formatEventSubtitle = (event: any): string => {
  return event.subtitle || 'No details available';
};

// Handle avatar image loading errors
const handleImageError = (event: Event, user?: any) => {
  const img = event.target as HTMLImageElement;
  if (img) {
    console.error('[Search] Avatar image failed to load for user:', user?.username || 'unknown');
    console.error('[Search] Failed URL:', img.src);
    console.error('[Search] Original pfpUrl from API:', user?.pfpUrl);
    console.error('[Search] Error event:', event);
    // Hide the image and show the fallback instead
    img.style.display = 'none';
  }
};

// Handle organization icon loading errors
const handleOrgIconError = (event: Event, org?: any) => {
  const img = event.target as HTMLImageElement;
  if (img) {
    console.error('[Search] Organization icon failed to load for org:', org?.name || 'unknown');
    console.error('[Search] Failed URL:', img.src);
    console.error('[Search] Original iconUrl from API:', org?.iconUrl);
    console.error('[Search] Error event:', event);
    // Hide the image and show the fallback instead
    img.style.display = 'none';
  }
};

// Get organization initials from organization string
const getOrgInitials = (orgString: string): string => {
  if (!orgString || orgString === 'No organization') return '';
  
  // Extract SID from format "Organization Name (SID)" or just use first letters
  const sidMatch = orgString.match(/\[([A-Z0-9]+)\]|\(([A-Z0-9]+)\)/);
  if (sidMatch) {
    const sid = sidMatch[1] || sidMatch[2];
    return sid.substring(0, 2).toUpperCase();
  }
  
  // If no SID found, use first two letters of organization name
  const words = orgString.split(' ');
  if (words.length >= 2) {
    return (words[0].charAt(0) + words[1].charAt(0)).toUpperCase();
  }
  
  return orgString.substring(0, 2).toUpperCase();
};

// Function to change active section with loading transitions
const setActiveSection = async (section: 'profile' | 'leaderboard' | 'map' | 'events' | 'stats') => {
  console.log(`[WebContentPage] Setting active section to: ${section}`);
  
  // Clear search when changing sections
  console.log(`[WebContentPage] Clearing search before section change`);
  searchQuery.value = '';
  searchResults.value = { events: [], users: [], organizations: [] };
  showSearchDropdown.value = false;
  selectedIndex.value = -1;
  lastSentSearchData.value = '';
  
  if (searchInput.value) {
    searchInput.value.value = '';
  }
  
  // Send clear signal to WebContentsView
  sendSearchDataToWebContentsView('', false, { events: [], users: [], organizations: [] }, true);
  
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
        } else if (status.activeSection === '/') {
          activeSection.value = 'profile'; // Default to profile for root path
          console.log(`[WebContentPage] Initial section set to profile for root path`);
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

  // Poll for clear search requests from the web app
  setInterval(() => {
    // Check if the WebContentsView has set a clear flag
    if (window.logMonitorApi && window.logMonitorApi.executeInWebContentsView) {
      // Check for clear flag in the WebContentsView
      window.logMonitorApi.executeInWebContentsView(`
        if (window.electronSearchState && window.electronSearchState.shouldClear) {
          console.log('[WebContentsView] Clear flag detected, notifying Electron');
          window.electronSearchState.shouldClear = false; // Reset the flag
          window.parent.postMessage({ type: 'electron-search-clear' }, '*');
        }
      `);
    }
  }, 100);

  // Listen for clear messages from WebContentsView
  window.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'electron-search-clear') {
      console.log('[WebContentPage] Received search clear request from WebContentsView');
      
      // Clear the search input
      searchQuery.value = '';
      showSearchDropdown.value = false;
      selectedIndex.value = -1;
      
      // Clear search results
      searchResults.value = { events: [], users: [], organizations: [] };
      
      // Also blur the search input to remove focus
      if (searchInput.value) {
        searchInput.value.blur();
      }
      
      console.log('[WebContentPage] Search box cleared');
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
      
      // Only reset search state if we're not navigating to the search page
      // (which should preserve its query parameters and content)
      setTimeout(() => {
        // Don't reset if there's an active search query - it might be the search page
        if (!searchQuery.value.trim()) {
          resetSearchState();
        } else {
          console.log('[WebContentPage] Skipping search state reset - active search query detected');
        }
      }, 500); // Small delay to ensure page is fully loaded
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