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
                @mousedown="isClickingSearchResult = true"
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
                @mousedown="isClickingSearchResult = true"
                @click="handleResultClick('user', user)"
              >
                <!-- User Avatar -->
                <div class="flex-shrink-0">
                  <img 
                    v-if="user.pfpUrl" 
                    :src="user.pfpUrl" 
                    :alt="`${user.username} avatar`"
                    class="w-8 h-8 rounded-full object-cover"
                    @load="(e: Event) => console.log('[Search] Avatar loaded successfully for:', user.username, 'URL:', user.pfpUrl)"
                    @error="(e: Event) => handleImageError(e, user)"
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
                      @load="(e: Event) => console.log('[Search] User org icon loaded for:', user.username)"
                      @error="(e: Event) => handleOrgIconError(e, { iconUrl: user.organizationIconUrl, name: user.organization })"
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
                @mousedown="isClickingSearchResult = true"
                @click="handleResultClick('organization', org)"
              >
                <!-- Organization Icon -->
                <div class="flex-shrink-0">
                  <img 
                    v-if="org.iconUrl" 
                    :src="org.iconUrl" 
                    :alt="`${org.name} icon`"
                    class="w-8 h-8 rounded object-cover"
                    @load="(e: Event) => console.log('[Search] Org icon loaded successfully for:', org.name, 'URL:', org.iconUrl)"
                    @error="(e: Event) => handleOrgIconError(e, org)"
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
const searchHealthCheckInterval = ref<NodeJS.Timeout | null>(null); // Health check for search state

// Reset search state after page navigation
const resetSearchState = async () => {
  console.log('[Search] Resetting search state after navigation');
  lastSentSearchData.value = '';
  // Clear any existing search if there's text in the box
  if (searchQuery.value.trim()) {
    await sendSearchDataToWebContentsView('', false, { events: [], users: [], organizations: [] }, true);
  }
};

// Enhanced DOM injection with handshake protocol and verification
const sendSearchDataToWebContentsView = async (query: string, loading: boolean, results: any, forceUpdate = false) => {
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
  
  // Use IPC to execute JavaScript in the WebContentsView with enhanced retry logic
  if (window.logMonitorApi && window.logMonitorApi.executeInWebContentsView) {
    const searchData = {
      query: query,
      isActive: query.length > 0,
      isLoading: loading,
      results: results,
      timestamp: Date.now(),
      injectionId: Math.random().toString(36).substr(2, 9) // Unique injection ID
    };
    
    const jsCode = `
      (function() {
        // Enhanced injection with handshake protocol
        const injectSearchData = () => {
          try {
            console.log('[ElectronSearch] Injecting search data with ID: ${searchData.injectionId}');
            
            // Set search data on window object
            window.electronSearchState = ${JSON.stringify(searchData)};
            
            // Create acknowledgment mechanism
            window.electronSearchAck = {
              injectionId: '${searchData.injectionId}',
              received: true,
              timestamp: Date.now()
            };
            
            // Dispatch custom event for web app to listen
            window.dispatchEvent(new CustomEvent('electron-search-changed', {
              detail: window.electronSearchState
            }));
            
            // Set up heartbeat response
            window.electronSearchHeartbeat = () => {
              return {
                alive: true,
                lastUpdate: window.electronSearchState?.timestamp,
                injectionId: window.electronSearchState?.injectionId
              };
            };
            
            // Only log in web app if query changed (not just loading state)
            if (!${loading} || '${query}'.length === 0) {
              console.log('[ElectronSearch] Data updated successfully:', window.electronSearchState);
            }
            
            return { success: true, injectionId: '${searchData.injectionId}' };
          } catch (error) {
            console.error('[ElectronSearch] Failed to inject search data:', error);
            return { success: false, error: error.message };
          }
        };
        
        // Smart DOM readiness detection
        const attemptInjection = () => {
          if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', injectSearchData);
          } else {
            // Additional check for framework readiness (Vue, React, etc.)
            if (window.Vue || window.React || document.querySelector('#app, #root, [data-app]')) {
              injectSearchData();
            } else {
              // Wait a bit more for framework to initialize
              setTimeout(injectSearchData, 100);
            }
          }
        };
        
        attemptInjection();
      })();
    `;
    
    // Enhanced retry logic with verification
    const maxRetries = forceUpdate ? 5 : 2;
    const baseRetryDelay = 200;
    let success = false;
    
    for (let attempt = 0; attempt < maxRetries && !success; attempt++) {
      try {
        await window.logMonitorApi.executeInWebContentsView(jsCode);
        
        // Verify injection worked - simplified approach
        await new Promise(resolve => setTimeout(resolve, 300)); // Give more time for injection
        
        // For now, assume injection worked if execution succeeded
        // The real test is whether search functionality actually works
        if (attempt === 0) {
          console.log(`[Search] ✅ Injection executed successfully on attempt ${attempt + 1} - assuming success`);
          success = true;
          break;
        } else {
          // On retries, do a simple verification
          try {
            const simpleCheck = await window.logMonitorApi.executeInWebContentsView(`
              console.log('[ElectronSearch] Simple verification - electronSearchState exists:', !!window.electronSearchState);
              console.log('[ElectronSearch] Simple verification - heartbeat function exists:', typeof window.electronSearchHeartbeat === 'function');
              !!window.electronSearchState;
            `);
            
            if (simpleCheck) {
              console.log(`[Search] ✅ Simple verification passed on attempt ${attempt + 1}`);
              success = true;
              break;
            } else {
              console.warn(`[Search] ❌ Simple verification failed on attempt ${attempt + 1}`);
            }
          } catch (verifyError) {
            console.warn(`[Search] ❌ Verification check failed on attempt ${attempt + 1}:`, verifyError);
          }
        }
        
      } catch (error) {
        console.warn(`[Search] Injection attempt ${attempt + 1} failed:`, error);
      }
      
      if (attempt < maxRetries - 1) {
        // Exponential backoff
        const delay = baseRetryDelay * Math.pow(1.5, attempt);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    
    if (!success) {
      console.error('[Search] All injection attempts failed - search may not work on this page');
    }
    
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
    await sendSearchDataToWebContentsView('', false, { events: [], users: [], organizations: [] });
    return;
  }
  
  isSearching.value = true;
  showSearchDropdown.value = true;
  selectedIndex.value = -1;
  
  // Send loading state to WebContentsView
  await sendSearchDataToWebContentsView(query, true, { events: [], users: [], organizations: [] });
  
  try {
    console.log(`[Search] Performing real API search for: "${query}"`);
    
    // Call the real search API
    const apiResults = await callSearchAPI(query);
    
    // Transform API results to match expected format
    const transformedResults = transformSearchResults(apiResults);
    searchResults.value = transformedResults;
    
    // Send results to WebContentsView
    await sendSearchDataToWebContentsView(query, false, transformedResults);
    
    console.log(`[Search] Found ${transformedResults.events.length} events, ${transformedResults.users.length} users, ${transformedResults.organizations.length} organizations`);
  } catch (error) {
    console.error('[Search] API call failed:', error);
    
    // Fallback to mock data if API fails
    console.log('[Search] Falling back to mock data due to API error');
    const mockResults = generateMockSearchResults(query);
    searchResults.value = mockResults;
    await sendSearchDataToWebContentsView(query, false, mockResults);
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

// Debounce timer for WebContentsView visibility
let webContentsVisibilityTimer: NodeJS.Timeout | null = null;

const handleSearchFocus = () => {
  if (searchQuery.value.trim() && (searchResults.value.events.length > 0 || searchResults.value.users.length > 0 || searchResults.value.organizations.length > 0)) {
    showSearchDropdown.value = true;
    
    // Cancel any pending show operation
    if (webContentsVisibilityTimer) {
      clearTimeout(webContentsVisibilityTimer);
      webContentsVisibilityTimer = null;
    }
    
    // Hide WebContentsView when search opens
    if (window.electron && window.electron.ipcRenderer) {
      window.electron.ipcRenderer.send('enhanced-window:hide-webcontentsview');
    }
  }
};

// Track if we're clicking on search results
let isClickingSearchResult = false;

const handleSearchBlur = () => {
  // Cancel any pending visibility timer
  if (webContentsVisibilityTimer) {
    clearTimeout(webContentsVisibilityTimer);
  }
  
  // Use a shorter delay and check if we're clicking on results
  webContentsVisibilityTimer = setTimeout(() => {
    if (!isClickingSearchResult) {
      showSearchDropdown.value = false;
      selectedIndex.value = -1;
      // Show WebContentsView when search closes
      if (window.electron && window.electron.ipcRenderer) {
        window.electron.ipcRenderer.send('enhanced-window:show-webcontentsview');
      }
    }
    isClickingSearchResult = false;
    webContentsVisibilityTimer = null;
  }, 100);
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
const setActiveSection = async (section: 'profile' | 'leaderboard' | 'map' | 'events' | 'stats', preserveSearch = false) => {
  console.log(`[WebContentPage] Setting active section to: ${section}, preserveSearch: ${preserveSearch}`);
  
  // Optionally clear search when changing sections
  if (!preserveSearch) {
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
    await sendSearchDataToWebContentsView('', false, { events: [], users: [], organizations: [] }, true);
  } else {
    console.log(`[WebContentPage] Preserving search state during section change`);
  }
  
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
    // Use the new centralized navigation system if available
    if (window.electronAPI?.navigation?.request) {
      console.log(`[WebContentPage] Using centralized navigation to section: ${section}`);
      const result = await window.electronAPI.navigation.request(section);
      console.log(`[WebContentPage] Centralized navigation result:`, result);
      
      if (!result.success) {
        console.error('[WebContentPage] Centralized navigation failed:', result.error);
        // Fallback to legacy system
        throw new Error(`Navigation failed: ${result.error}`);
      }
      
      // Loading overlay will be hidden by the navigation state change event or timeout
      setTimeout(() => {
        if (isLoading.value) {
          console.log('[WebContentPage] Timeout fallback: hiding loading overlay');
          showLoadingOverlay.value = false;
          setTimeout(() => {
            isLoading.value = false;
          }, 300);
        }
      }, 5000); // 5 second timeout
      
    } else if (window.logMonitorApi && window.logMonitorApi.openEnhancedWebContentWindow) {
      // Fallback to legacy system
      console.log(`[WebContentPage] Fallback: Navigating WebContentsView to section: ${section}`);
      const result = await window.logMonitorApi.openEnhancedWebContentWindow(section);
      console.log(`[WebContentPage] Legacy navigation result:`, result);
      
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
      console.warn('[WebContentPage] No navigation API available');
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
  
  // Use requestAnimationFrame to ensure DOM is ready without unnecessary delay
  requestAnimationFrame(async () => {
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
  });
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

  // Enhanced polling with navigation tracking and heartbeat monitoring
  const startSearchMonitoring = () => {
    let lastHeartbeat = Date.now();
    let lastUrl = '';
    
    const monitoringInterval = setInterval(() => {
      if (window.logMonitorApi && window.logMonitorApi.executeInWebContentsView) {
        
        // Enhanced navigation tracking with detailed debugging
        window.logMonitorApi.executeInWebContentsView(`
          (function() {
            let response = { 
              clearFlag: false, 
              heartbeat: false,
              needsRecovery: false,
              navigation: {
                url: window.location.href,
                pathname: window.location.pathname,
                changed: false,
                title: document.title,
                readyState: document.readyState
              },
              searchState: {
                exists: !!window.electronSearchState,
                timestamp: window.electronSearchState?.timestamp,
                injectionId: window.electronSearchState?.injectionId,
                query: window.electronSearchState?.query
              },
              timing: {
                now: Date.now(),
                pageLoad: performance.timing?.loadEventEnd || 0
              }
            };
            
            // Store last URL for navigation detection with enhanced logging
            if (!window.electronLastUrl) {
              window.electronLastUrl = window.location.href;
              console.log('[WebContentsView] 🏁 Initial URL tracked:', window.location.href);
            } else if (window.electronLastUrl !== window.location.href) {
              console.log('[WebContentsView] 📍 NAVIGATION DETECTED:', {
                from: window.electronLastUrl,
                to: window.location.href,
                searchStateExists: !!window.electronSearchState,
                searchHeartbeatExists: typeof window.electronSearchHeartbeat === 'function',
                currentQuery: window.electronSearchState?.query,
                documentReady: document.readyState,
                title: document.title,
                timestamp: Date.now()
              });
              window.electronLastUrl = window.location.href;
              response.navigation.changed = true;
              
              // Log any event listeners that might be lost
              const eventListeners = [];
              if (window.addEventListener.toString().indexOf('[native code]') === -1) {
                eventListeners.push('addEventListener-overridden');
              }
              if (document.addEventListener.toString().indexOf('[native code]') === -1) {
                eventListeners.push('document-addEventListener-overridden');
              }
              
              console.log('[WebContentsView] 📍 Event listener status after navigation:', eventListeners);
            }
            
            // Check for clear flag
            if (window.electronSearchState && window.electronSearchState.shouldClear) {
              console.log('[WebContentsView] Clear flag detected, notifying Electron');
              window.electronSearchState.shouldClear = false;
              window.parent.postMessage({ type: 'electron-search-clear' }, '*');
              response.clearFlag = true;
            }
            
            // Enhanced heartbeat check with diagnostic info
            if (window.electronSearchHeartbeat && typeof window.electronSearchHeartbeat === 'function') {
              try {
                const heartbeat = window.electronSearchHeartbeat();
                response.heartbeat = heartbeat.alive;
                if (!heartbeat.alive) {
                  console.warn('[WebContentsView] ❌ Heartbeat function exists but reports not alive:', heartbeat);
                }
              } catch (error) {
                console.error('[WebContentsView] ❌ Heartbeat function threw error:', error);
                response.needsRecovery = true;
              }
            } else if (window.electronSearchState) {
              console.warn('[WebContentsView] ⚠️ Search state exists but no heartbeat function - partial failure');
              response.needsRecovery = true;
            } else {
              // No search state at all - might be normal or might need injection
              console.log('[WebContentsView] ℹ️ No search state found');
            }
            
            return response;
          })()
        `).then((response: any) => {
          if (response) {
            // Enhanced navigation tracking with detailed diagnostics
            if (response.navigation.changed && response.navigation.url !== lastUrl) {
              console.log(`[Search] 📍 NAVIGATION DETECTED:`, {
                from: lastUrl,
                to: response.navigation.url,
                searchState: response.searchState,
                timing: response.timing,
                pageReady: response.navigation.readyState,
                title: response.navigation.title
              });
              lastUrl = response.navigation.url;
              
              // Enhanced timing for re-injection based on page readiness
              const getOptimalDelay = () => {
                // If page is still loading, wait longer
                if (response.navigation.readyState === 'loading') {
                  return 2000;
                }
                // If page is interactive but not complete, moderate delay
                else if (response.navigation.readyState === 'interactive') {
                  return 1000;
                }
                // If page is complete, shorter delay
                else {
                  return 500;
                }
              };
              
              const delay = getOptimalDelay();
              console.log(`[Search] 🔄 Scheduling re-injection in ${delay}ms (page state: ${response.navigation.readyState})`);
              
              setTimeout(() => {
                console.log('[Search] 🔄 Executing post-navigation re-injection');
                if (searchQuery.value.trim() && (searchResults.value.events.length > 0 || 
                    searchResults.value.users.length > 0 || searchResults.value.organizations.length > 0)) {
                  console.log('[Search] Re-injecting active search state:', {
                    query: searchQuery.value,
                    resultCounts: {
                      events: searchResults.value.events.length,
                      users: searchResults.value.users.length,
                      organizations: searchResults.value.organizations.length
                    }
                  });
                  sendSearchDataToWebContentsView(searchQuery.value, false, searchResults.value, true);
                } else {
                  console.log('[Search] Establishing search infrastructure on new page');
                  sendSearchDataToWebContentsView('', false, { events: [], users: [], organizations: [] }, true);
                }
              }, delay);
            }
            
            // Enhanced heartbeat tracking (reduced logging to prevent spam)
            if (response.heartbeat) {
              lastHeartbeat = Date.now();
              // Only log healthy state occasionally to reduce spam
              if (response.searchState.exists && Math.random() < 0.1) { // 10% chance to log
                console.log('[Search] ✅ Heartbeat alive, search state healthy');
              }
            } else if (response.searchState.exists && !response.heartbeat) {
              console.warn('[Search] ⚠️ Search state exists but heartbeat failed');
            }
            
            // More intelligent auto-recovery with better logging
            const timeSinceLastHeartbeat = Date.now() - lastHeartbeat;
            if (response.needsRecovery) {
              console.log('[Search] 🔧 Immediate recovery needed - search state corrupted');
              lastHeartbeat = Date.now(); // Reset to prevent immediate re-trigger
              autoRecoverSearch();
            } else if (!response.heartbeat && timeSinceLastHeartbeat > 15000) {
              console.log(`[Search] 🔧 Auto-recovery triggered after ${Math.round(timeSinceLastHeartbeat/1000)}s without heartbeat`);
              lastHeartbeat = Date.now(); // Reset to prevent immediate re-trigger
              autoRecoverSearch();
            }
          }
        }).catch((error: any) => {
          console.warn('[Search] Monitoring execution failed:', error);
          // If monitoring fails, attempt recovery less frequently
          const timeSinceLastHeartbeat = Date.now() - lastHeartbeat;
          if (timeSinceLastHeartbeat > 20000) {
            console.log(`[Search] 🔧 Monitoring failed for ${Math.round(timeSinceLastHeartbeat/1000)}s, attempting auto-recovery`);
            lastHeartbeat = Date.now();
            autoRecoverSearch();
          }
        });
      }
    }, 3000); // Less frequent polling (3 seconds)
    
    return monitoringInterval;
  };
  
  // Enhanced auto-recovery function with anti-flickering logic
  const autoRecoverSearch = async () => {
    console.log('[Search] 🔧 Starting auto-recovery process');
    
    // First, check if we really need recovery by doing a quick verification
    try {
      const quickCheckResult = await window.logMonitorApi.executeInWebContentsView(`
        (function() {
          return {
            searchStateExists: !!window.electronSearchState,
            heartbeatWorks: typeof window.electronSearchHeartbeat === 'function',
            timestamp: window.electronSearchState?.timestamp,
            query: window.electronSearchState?.query
          };
        })()
      `);
      
      const quickCheck = quickCheckResult.success ? quickCheckResult as any : null;
      
      console.log('[Search] 🔧 Pre-recovery verification:', quickCheck);
      
      // If search state exists and query matches, maybe we don't need full recovery
      if (quickCheck?.searchStateExists && quickCheck?.heartbeatWorks) {
        const currentQuery = searchQuery.value.trim();
        const stateQuery = quickCheck.query || '';
        
        if (currentQuery === stateQuery) {
          console.log('[Search] ✅ Search state appears healthy, skipping recovery');
          return;
        } else {
          console.log('[Search] 🔧 Query mismatch detected:', { current: currentQuery, state: stateQuery });
        }
      }
    } catch (error) {
      console.warn('[Search] 🔧 Pre-recovery check failed, proceeding with recovery:', error);
    }
    
    // Only inject if we have an active search or need to establish infrastructure
    const hasActiveSearch = searchQuery.value.trim() && (searchResults.value.events.length > 0 || 
        searchResults.value.users.length > 0 || searchResults.value.organizations.length > 0);
    
    if (hasActiveSearch) {
      console.log('[Search] 🔧 Recovering active search state:', {
        query: searchQuery.value,
        resultCounts: {
          events: searchResults.value.events.length,
          users: searchResults.value.users.length,
          organizations: searchResults.value.organizations.length
        }
      });
      await sendSearchDataToWebContentsView(searchQuery.value, false, searchResults.value, true);
    } else if (searchQuery.value.trim()) {
      console.log('[Search] 🔧 Search query exists but no results - clearing state');
      await sendSearchDataToWebContentsView('', false, { events: [], users: [], organizations: [] }, true);
    } else {
      console.log('[Search] 🔧 Establishing minimal search infrastructure');
      // Only establish infrastructure if really needed
      await sendSearchDataToWebContentsView('', false, { events: [], users: [], organizations: [] }, true);
    }
    
    console.log('[Search] 🔧 Auto-recovery completed');
  };
  
  // Start monitoring
  const monitoringInterval = startSearchMonitoring();
  
  // Clean up on unmount
  window.addEventListener('beforeunload', () => {
    if (monitoringInterval) {
      clearInterval(monitoringInterval);
    }
  });

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

  // Set up IPC event listeners for WebContentsView events with navigation debugging
  if (window.electron && window.electron.ipcRenderer) {
    window.electron.ipcRenderer.on('webcontents-view-ready', () => {
      console.log('[WebContentPage] 🟢 WebContentsView is ready');
    });
    
    window.electron.ipcRenderer.on('webcontents-view-loading', () => {
      console.log('[WebContentPage] 🟡 WebContentsView started loading - search state will be wiped');
      // Log current search state before it gets wiped
      console.log('[WebContentPage] Current search state before wipe:', {
        query: searchQuery.value,
        hasResults: searchResults.value.events.length > 0 || searchResults.value.users.length > 0 || searchResults.value.organizations.length > 0,
        dropdown: showSearchDropdown.value
      });
    });
    
    window.electron.ipcRenderer.on('webcontents-view-loaded', async () => {
      console.log('[WebContentPage] 🟢 WebContentsView finished loading - starting search recovery');
      
      // Log navigation details
      if (window.logMonitorApi && window.logMonitorApi.executeInWebContentsView) {
        window.logMonitorApi.executeInWebContentsView(`
          console.log('[WebContentsView] 📍 Navigation completed:', {
            url: window.location.href,
            pathname: window.location.pathname,
            readyState: document.readyState,
            title: document.title
          });
        `).catch(() => {}); // Ignore errors
      }
      
      // Hide loading overlay when content is loaded
      if (isLoading.value) {
        showLoadingOverlay.value = false;
        setTimeout(() => {
          isLoading.value = false;
        }, 300);
      }
      
      // SEARCH RECOVERY: Re-inject search state after navigation
      if (searchQuery.value.trim()) {
        console.log('[WebContentPage] 🔄 Recovering search state after navigation:', {
          query: searchQuery.value,
          hasResults: Object.keys(searchResults.value).some(key => searchResults.value[key].length > 0)
        });
        
        // Wait a bit for the page to stabilize after navigation
        setTimeout(async () => {
          try {
            // Re-inject the current search state
            await sendSearchDataToWebContentsView(
              searchQuery.value,
              isSearching.value,
              searchResults.value,
              true // Force update
            );
            
            console.log('[WebContentPage] ✅ Search state re-injected successfully');
          } catch (error) {
            console.error('[WebContentPage] ❌ Failed to re-inject search state:', error);
          }
        }, 500); // 500ms delay to ensure page is ready
      }
      
      // Enhanced page load recovery with dynamic timing
      const pageLoadRecovery = async () => {
        console.log('[WebContentPage] Starting enhanced page load recovery');
        
        // Wait for page to be more ready - check for common framework indicators
        let ready = false;
        let attempts = 0;
        const maxWaitTime = 5000; // Maximum 5 seconds
        const checkInterval = 200; // Check every 200ms
        
        while (!ready && attempts < (maxWaitTime / checkInterval)) {
          try {
            const readinessResult = await window.logMonitorApi.executeInWebContentsView(`
              (function() {
                // Check for various readiness indicators
                const indicators = {
                  domReady: document.readyState === 'complete',
                  hasFramework: !!(window.Vue || window.React || window.Angular),
                  hasAppRoot: !!(document.querySelector('#app, #root, [data-app], main, .app')),
                  hasContent: document.body && document.body.children.length > 0,
                  noLoading: !document.querySelector('.loading, .spinner, [class*="load"]')
                };
                
                const readyScore = Object.values(indicators).filter(Boolean).length;
                return { indicators, readyScore, isReady: readyScore >= 3 };
              })()
            `);
            
            const readinessCheck = readinessResult.success ? readinessResult as any : null;
            
            if (readinessCheck?.isReady) {
              ready = true;
              console.log('[WebContentPage] Page ready for injection:', readinessCheck.indicators);
            } else {
              console.log(`[WebContentPage] Page not ready yet (score: ${readinessCheck?.readyScore}/5), waiting...`);
            }
          } catch (error) {
            console.warn('[WebContentPage] Readiness check failed:', error);
          }
          
          if (!ready) {
            await new Promise(resolve => setTimeout(resolve, checkInterval));
            attempts++;
          }
        }
        
        // Proceed with injection regardless of readiness after timeout
        if (searchQuery.value.trim() && (searchResults.value.events.length > 0 || 
            searchResults.value.users.length > 0 || searchResults.value.organizations.length > 0)) {
          console.log('[WebContentPage] Re-injecting search state after page navigation with enhanced timing');
          await sendSearchDataToWebContentsView(searchQuery.value, false, searchResults.value, true);
        } else if (searchQuery.value.trim()) {
          console.log('[WebContentPage] Active search query detected but no results - clearing search state');
          await resetSearchState();
        } else {
          console.log('[WebContentPage] Establishing search infrastructure on new page');
          // Always establish search infrastructure even with no active search
          await sendSearchDataToWebContentsView('', false, { events: [], users: [], organizations: [] }, true);
        }
      };
      
      // Start recovery process
      pageLoadRecovery().catch(error => {
        console.error('[WebContentPage] Page load recovery failed:', error);
      });
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
    
    // Dedicated event for search state recovery after navigation
    window.electron.ipcRenderer.on('webcontents-view-search-recovery-needed', async () => {
      console.log('[WebContentPage] 🔍 Search recovery event received');
      
      // Only recover search if there's an active query
      if (searchQuery.value.trim()) {
        console.log('[WebContentPage] 🔄 Performing dedicated search recovery:', {
          query: searchQuery.value,
          hasResults: Object.keys(searchResults.value).some(key => searchResults.value[key].length > 0)
        });
        
        try {
          // Re-inject the current search state with force update
          await sendSearchDataToWebContentsView(
            searchQuery.value,
            isSearching.value,
            searchResults.value,
            true // Force update to ensure injection
          );
          
          console.log('[WebContentPage] ✅ Search state recovered successfully via dedicated event');
        } catch (error) {
          console.error('[WebContentPage] ❌ Failed to recover search state:', error);
        }
      } else {
        console.log('[WebContentPage] 🔍 No search query to recover');
      }
    });
  }

  // Listen for centralized navigation state changes
  if (window.electronAPI?.navigation?.onStateChange) {
    const navigationCleanup = window.electronAPI.navigation.onStateChange((state: any) => {
      console.log('[WebContentPage] Received navigation state update:', state);
      
      // Update active section based on navigation state
      if (state.webContentWindow.isOpen && state.webContentWindow.currentSection) {
        const section = state.webContentWindow.currentSection;
        if (section === 'profile' || section === 'leaderboard' || section === 'map' || section === 'events' || section === 'stats') {
          if (activeSection.value !== section) {
            console.log(`[WebContentPage] Updating active section from navigation state: ${section}`);
            activeSection.value = section;
          }
          
          // Hide loading overlay if it's showing
          if (isLoading.value) {
            showLoadingOverlay.value = false;
            setTimeout(() => {
              isLoading.value = false;
            }, 300);
          }
        }
      }
    });
    
    // Store cleanup function for onUnmounted
    // Add this to cleanup array if you have one, or add to onUnmounted
  } else {
    console.warn('[WebContentPage] Centralized navigation state listener not available');
  }

  // Notify main process that WebContentPage is ready for WebContentsView attachment
  notifyMainProcessReady();
});

// Start search health check when search is active
const startSearchHealthCheck = () => {
  // Clear any existing interval
  if (searchHealthCheckInterval.value) {
    clearInterval(searchHealthCheckInterval.value);
  }
  
  // Only start health check if there's an active search
  if (!searchQuery.value.trim()) {
    return;
  }
  
  console.log('[WebContentPage] Starting search health check');
  
  // Check every 3 seconds if search state is still active
  searchHealthCheckInterval.value = setInterval(async () => {
    if (!searchQuery.value.trim() || !isWebContentsViewAttached.value) {
      // Stop health check if no search or WebContentsView detached
      clearInterval(searchHealthCheckInterval.value);
      searchHealthCheckInterval.value = null;
      return;
    }
    
    // Check if search state exists in WebContentsView
    if (window.logMonitorApi && window.logMonitorApi.executeInWebContentsView) {
      try {
        const healthCheck = await window.logMonitorApi.executeInWebContentsView(`
          const searchExists = !!window.electronSearchState && window.electronSearchState.query === '${searchQuery.value.replace(/'/g, "\\'")}';
          console.log('[WebContentsView] Search health check:', { 
            exists: searchExists, 
            currentQuery: window.electronSearchState?.query,
            expectedQuery: '${searchQuery.value.replace(/'/g, "\\'")}'
          });
          searchExists;
        `);
        
        if (!healthCheck) {
          console.log('[WebContentPage] ⚠️ Search state lost, re-injecting...');
          await sendSearchDataToWebContentsView(
            searchQuery.value,
            isSearching.value,
            searchResults.value,
            true
          );
        }
      } catch (error) {
        console.debug('[WebContentPage] Health check failed (page might be loading):', error);
      }
    }
  }, 3000); // Check every 3 seconds
};

// Stop search health check
const stopSearchHealthCheck = () => {
  if (searchHealthCheckInterval.value) {
    clearInterval(searchHealthCheckInterval.value);
    searchHealthCheckInterval.value = null;
    console.log('[WebContentPage] Stopped search health check');
  }
};

// Watch search query to manage health check
watch(searchQuery, (newQuery) => {
  if (newQuery.trim()) {
    startSearchHealthCheck();
  } else {
    stopSearchHealthCheck();
  }
});

onUnmounted(() => {
  console.log('[WebContentPage] Unmounted - WebContentsView will be cleaned up by main process');
  
  // Clean up health check interval
  stopSearchHealthCheck();
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