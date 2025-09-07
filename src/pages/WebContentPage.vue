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
            @click="navigateToSection('profile')"
            class="navigation-button px-3 py-2 rounded transition-colors duration-200"
            :class="{ 
              'text-[rgb(99,99,247)] bg-white/5': isProfileActive,
              'hover:bg-white/5 hover:text-[rgb(77,77,234)] text-theme-text-light': !isProfileActive 
            }"
          >
            Profile
          </button>
          <button
            @click="navigateToSection('leaderboard')"
            class="navigation-button px-3 py-2 rounded transition-colors duration-200"
            :class="{ 
              'text-[rgb(99,99,247)] bg-white/5': isLeaderboardActive,
              'hover:bg-white/5 hover:text-[rgb(77,77,234)] text-theme-text-light': !isLeaderboardActive 
            }"
          >
            Leaderboard
          </button>
          <button
            @click="navigateToSection('map')"
            class="navigation-button px-3 py-2 rounded transition-colors duration-200"
            :class="{ 
              'text-[rgb(99,99,247)] bg-white/5': isMapActive,
              'hover:bg-white/5 hover:text-[rgb(77,77,234)] text-theme-text-light': !isMapActive 
            }"
          >
            Map
          </button>
          <button
            @click="navigateToSection('events')"
            class="navigation-button px-3 py-2 rounded transition-colors duration-200"
            :class="{ 
              'text-[rgb(99,99,247)] bg-white/5': isEventsActive,
              'hover:bg-white/5 hover:text-[rgb(77,77,234)] text-theme-text-light': !isEventsActive 
            }"
          >
            Events
          </button>
          <button
            @click="navigateToSection('stats')"
            class="navigation-button px-3 py-2 rounded transition-colors duration-200"
            :class="{ 
              'text-[rgb(99,99,247)] bg-white/5': isStatsActive,
              'hover:bg-white/5 hover:text-[rgb(77,77,234)] text-theme-text-light': !isStatsActive 
            }"
          >
            Stats
          </button>
        </div>
        
        <!-- Advanced Search Bar with Settings Button -->
        <div class="flex-[0.9] ml-12 mr-6 flex items-center gap-2">
          <div class="relative flex-1 search-container">
            <input
              ref="searchInput"
              v-model="searchQuery"
              placeholder="Search events, users, organizations..."
              class="w-full px-4 py-2 pr-10 bg-[#262626] border border-[#404040] text-white rounded-md text-sm focus:outline-none focus:border-[rgb(99,99,247)] placeholder-gray-400 transition-all duration-200"
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
          
          <!-- Website Settings Button (Spanner) - Only show when authenticated -->
          <button
            v-if="isAuthenticated"
            @click="navigateToSection('profile-settings')"
            class="h-[38px] w-[38px] flex items-center justify-center bg-transparent rounded-md transition-all duration-200 text-gray-400 hover:text-white focus:outline-none"
            :class="{ 'text-[rgb(99,99,247)]': isProfileSettingsActive }"
            :style="isProfileSettingsActive ? { border: '1px solid rgb(99,99,247)' } : { border: '1px solid #4a4a4a' }"
            title="Website Settings"
          >
            <svg class="w-4 h-4 fill-current" viewBox="0 0 20 20">
              <!-- Spanner/Wrench icon -->
              <path fill-rule="evenodd" d="M19 5.5a4.5 4.5 0 01-4.791 4.49c-.873-.055-1.808.128-2.368.8l-6.024 7.23a2.724 2.724 0 11-3.837-3.837l7.23-6.024c.672-.56.855-1.495.8-2.368a4.5 4.5 0 015.873-4.575c.324.105.39.51.15.752L13.34 4.66a.455.455 0 00-.11.494 3.01 3.01 0 001.617 1.617c.17.07.363.02.493-.111l2.692-2.692c.241-.241.647-.174.752.15.14.435.216.9.216 1.382zM4.139 15.861a.706.706 0 00.03 1.036.933.933 0 001.151-.114.706.706 0 00-.115-1.091.933.933 0 00-1.066.17z" clip-rule="evenodd"></path>
            </svg>
          </button>
        </div>
      </nav>
    </header>

    <!-- Main WebContentsView Content -->
    <div class="flex-1 overflow-hidden relative">
      <!-- Search Overlay (replaces WebContentsView) -->
      <Transition name="search-overlay">
        <div 
          v-if="showSearchDropdown"
          class="absolute inset-0 bg-[#1a1a1a] overflow-y-auto"
          @mousedown="isClickingSearchResult = true"
          data-search-overlay
        >
          <!-- Search Results Container -->
          <div class="h-full flex flex-col p-6">
            <!-- Tab Navigation -->
            <div class="border-b border-[#404040] mb-6">
              <div class="flex justify-center -mb-px">
                <button 
                  @click="filterType = 'all'; searchInput?.focus()"
                  @mousedown.prevent="isClickingSearchResult = true"
                  @keydown.arrow-right="focusNextTab"
                  @keydown.arrow-left="focusPrevTab"
                  :class="{ 
                    'border-b-2 border-[rgb(99,99,247)] text-white': filterType === 'all', 
                    'border-b-2 border-transparent text-gray-400 hover:text-white': filterType !== 'all' 
                  }"
                  class="px-6 py-3 font-medium transition-all duration-200 focus:outline-none relative"
                  ref="allTab"
                  tabindex="0"
                >
                  <span class="flex items-center">
                    All
                    <span v-if="totalResultsCount > 0" class="ml-2 text-sm opacity-75">
                      ({{ totalResultsCount }})
                    </span>
                    <span class="ml-auto text-xs opacity-50 font-mono">1</span>
                  </span>
                </button>
                <button 
                  @click="filterType = 'events'; searchInput?.focus()"
                  @mousedown.prevent="isClickingSearchResult = true"
                  @keydown.arrow-right="focusNextTab"
                  @keydown.arrow-left="focusPrevTab"
                  :class="{ 
                    'border-b-2 border-[rgb(99,99,247)] text-white': filterType === 'events', 
                    'border-b-2 border-transparent text-gray-400 hover:text-white': filterType !== 'events' 
                  }"
                  class="px-6 py-3 font-medium transition-all duration-200 focus:outline-none relative"
                  ref="eventsTab"
                  tabindex="0"
                >
                  <span class="flex items-center">
                    Events
                    <span v-if="searchResults.events.length > 0" class="ml-2 text-sm opacity-75">
                      ({{ searchResults.events.length }})
                    </span>
                    <span class="ml-auto text-xs opacity-50 font-mono">2</span>
                  </span>
                </button>
                <button 
                  @click="filterType = 'users'; searchInput?.focus()"
                  @mousedown.prevent="isClickingSearchResult = true"
                  @keydown.arrow-right="focusNextTab"
                  @keydown.arrow-left="focusPrevTab"
                  :class="{ 
                    'border-b-2 border-[rgb(99,99,247)] text-white': filterType === 'users', 
                    'border-b-2 border-transparent text-gray-400 hover:text-white': filterType !== 'users' 
                  }"
                  class="px-6 py-3 font-medium transition-all duration-200 focus:outline-none relative"
                  ref="usersTab"
                  tabindex="0"
                >
                  <span class="flex items-center">
                    Users
                    <span v-if="searchResults.users.length > 0" class="ml-2 text-sm opacity-75">
                      ({{ searchResults.users.length }})
                    </span>
                    <span class="ml-auto text-xs opacity-50 font-mono">3</span>
                  </span>
                </button>
                <button 
                  @click="filterType = 'organizations'; searchInput?.focus()"
                  @mousedown.prevent="isClickingSearchResult = true"
                  @keydown.arrow-right="focusNextTab"
                  @keydown.arrow-left="focusPrevTab"
                  :class="{ 
                    'border-b-2 border-[rgb(99,99,247)] text-white': filterType === 'organizations', 
                    'border-b-2 border-transparent text-gray-400 hover:text-white': filterType !== 'organizations' 
                  }"
                  class="px-6 py-3 font-medium transition-all duration-200 focus:outline-none relative"
                  ref="organizationsTab"
                  tabindex="0"
                >
                  <span class="flex items-center">
                    Organizations
                    <span v-if="searchResults.organizations.length > 0" class="ml-2 text-sm opacity-75">
                      ({{ searchResults.organizations.length }})
                    </span>
                    <span class="ml-auto text-xs opacity-50 font-mono">4</span>
                  </span>
                </button>
              </div>
            </div>
            
            <!-- Results Container -->
            <div class="flex-1">
              <!-- Loading State -->
              <div v-if="isSearching" class="text-center text-gray-400 py-16">
                <div class="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-[rgb(99,99,247)] mb-4"></div>
                <div class="text-xl">Searching...</div>
              </div>
        
              <!-- Results Grid -->
              <div v-else-if="hasResults" class="space-y-6">
                <!-- Events Section -->
                <div v-if="(filterType === 'all' || filterType === 'events') && searchResults.events.length > 0" class="bg-[#262626] rounded-xl p-6">
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
                
                <!-- Users Section -->
                <div v-if="(filterType === 'all' || filterType === 'users') && searchResults.users.length > 0" class="bg-[#262626] rounded-xl p-6">
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
                
                <!-- Organizations Section -->
                <div v-if="(filterType === 'all' || filterType === 'organizations') && searchResults.organizations.length > 0" class="bg-[#262626] rounded-xl p-6">
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
            <div v-if="!isSearching && searchQuery.trim() && !hasResults" class="text-center text-gray-400 py-16">
              <svg class="w-24 h-24 mx-auto mb-4 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
              </svg>
              <div class="text-2xl mb-2">No results found for "{{ searchQuery }}"</div>
              <div class="text-lg text-gray-500">Try searching for events, usernames, or organization names</div>
            </div>
            
              <!-- Empty State -->
              <div v-if="!isSearching && !searchQuery.trim()" class="text-center text-gray-400 py-16">
                <div class="text-2xl mb-4">Start typing to search</div>
                <div class="text-lg text-gray-500">Search across events, users, and organizations</div>
              </div>
            </div>
            
            <!-- Keyboard Shortcuts Help -->
            <div v-if="showSearchDropdown && hasResults" class="mt-auto pt-4 border-t border-[#404040] text-center">
              <div class="text-xs text-gray-500 pb-4">
                <span class="inline-flex items-center gap-6 flex-wrap justify-center">
                  <span><kbd class="px-2 py-0.5 bg-[#333333] rounded text-gray-400 font-mono text-xs">1-4</kbd> Switch tabs</span>
                  <span><kbd class="px-2 py-0.5 bg-[#333333] rounded text-gray-400 font-mono text-xs">↑↓</kbd> Navigate</span>
                  <span><kbd class="px-2 py-0.5 bg-[#333333] rounded text-gray-400 font-mono text-xs">Enter</kbd> Select</span>
                  <span><kbd class="px-2 py-0.5 bg-[#333333] rounded text-gray-400 font-mono text-xs">Esc</kbd> Close</span>
                </span>
              </div>
            </div>
          </div>
        </div>
      </Transition>
      
      <!-- WebContentsView will be attached here by the main process -->
      <div 
        id="webcontents-container"
        ref="webcontentsContainer"
        style="width: 100%; height: 100%;"
        class="bg-[#1a1a1a]"
        :class="{ 'invisible': !isWebContentsViewVisible }"
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
          <div class="text-sm text-gray-400 mb-4">{{ loadingMessage }}</div>
          
          <!-- Progress bar -->
          <div class="w-64 mx-auto">
            <div class="bg-gray-700 rounded-full h-1.5 overflow-hidden">
              <div 
                class="bg-[rgb(99,99,247)] h-full rounded-full transition-all duration-500 ease-out"
                :style="{ width: `${loadingProgress}%` }"
              ></div>
            </div>
          </div>
          
          <!-- Fast loading indicator -->
          <div v-if="loadingProgress > 0" class="text-xs text-gray-500 mt-2">
            {{ Math.round(loadingProgress) }}%
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed, watch, nextTick } from 'vue';
import type { IpcRendererEvent } from 'electron';
import type { AuthData, UserProfile } from '../preload';
import { useNavigationState } from '../composables/useNavigationState';

// Declare window.ipcRenderer
declare global {
  interface Window {
    ipcRenderer?: {
      send: (channel: string, ...args: any[]) => void;
      on: (channel: string, listener: (event: IpcRendererEvent, ...args: any[]) => void) => void;
    };
  }
}

const webcontentsContainer = ref<HTMLDivElement | null>(null);

// Use unified navigation state
const {
  currentSection,
  isNavigating,
  isProfileActive,
  isLeaderboardActive,
  isMapActive,
  isEventsActive,
  isStatsActive,
  isProfileSettingsActive,
  navigateToSection,
  updateCurrentSection,
  initializeListeners: initNavigationListeners
} = useNavigationState();

// Computed property for backward compatibility
const activeSection = computed(() => currentSection.value || 'profile');

// State for authentication
const isAuthenticated = ref(false);
const currentUsername = ref<string | null>(null);

// Loading state management
const isLoading = ref(false);
const showLoadingOverlay = ref(false);
const isWebContentsViewAttached = ref(false);
const isWebContentsViewVisible = ref(true);
const loadingProgress = ref(0);
const loadingMessage = ref('Connecting with authentication...');

// Search state management
const searchQuery = ref<string>('');
const isSearching = ref<boolean>(false);
const showSearchDropdown = ref<boolean>(false);
const searchInput = ref<HTMLInputElement | null>(null);
const selectedIndex = ref<number>(-1);
const searchTimeout = ref<NodeJS.Timeout | null>(null);
const lastSentSearchData = ref<string>(''); // Track last sent data to prevent spam
const searchHealthCheckInterval = ref<NodeJS.Timeout | null>(null); // Health check for search state
const filterType = ref<'all' | 'events' | 'users' | 'organizations'>('all');

// Tab references for keyboard navigation
const allTab = ref<HTMLButtonElement | null>(null);
const eventsTab = ref<HTMLButtonElement | null>(null);
const usersTab = ref<HTMLButtonElement | null>(null);
const organizationsTab = ref<HTMLButtonElement | null>(null);

// Reset search state after page navigation
const resetSearchState = async () => {
  console.log('[Search] Resetting search state after navigation');
  lastSentSearchData.value = '';
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

// Computed properties
const hasResults = computed(() => {
  return searchResults.value.events.length > 0 || 
         searchResults.value.users.length > 0 || 
         searchResults.value.organizations.length > 0;
});

const totalResultsCount = computed(() => {
  return searchResults.value.events.length + 
         searchResults.value.users.length + 
         searchResults.value.organizations.length;
});

// Search functionality
const handleSearchInput = () => {
  if (searchTimeout.value) {
    clearTimeout(searchTimeout.value);
  }
  
  // Auto-show search overlay and hide WebContentsView at 3 characters
  if (searchQuery.value.length >= 3) {
    if (!showSearchDropdown.value || isWebContentsViewVisible.value) {
      showSearchDropdown.value = true;
      isWebContentsViewVisible.value = false;
      
      // Hide WebContentsView
      if (window.ipcRenderer) {
        window.ipcRenderer.send('enhanced-window:hide-webcontentsview');
      }
    }
  }
  
  // Hide overlay if search is cleared or below 3 characters
  if (searchQuery.value.trim().length < 3 && showSearchDropdown.value) {
    console.log('[Search] Query below 3 chars, hiding overlay and showing WebContentsView');
    showSearchDropdown.value = false;
    searchResults.value = { events: [], users: [], organizations: [] };
    selectedIndex.value = -1;
    
    // Show WebContentsView again
    if (!isWebContentsViewVisible.value) {
      isWebContentsViewVisible.value = true;
      if (window.ipcRenderer) {
        window.ipcRenderer.send('enhanced-window:show-webcontentsview');
      }
    }
    
    // Clear any pending search
    if (searchTimeout.value) {
      clearTimeout(searchTimeout.value);
    }
    return;
  }
  
  searchTimeout.value = setTimeout(() => {
    if (searchQuery.value.length >= 3) {
      performSearch(searchQuery.value);
    }
  }, 300); // 300ms debounce
};

const performSearch = async (query: string) => {
  console.log('[Search Debug] performSearch called with query:', query);
  
  if (!query.trim()) {
    console.log('[Search Debug] Empty query, clearing results');
    searchResults.value = { events: [], users: [], organizations: [] };
    showSearchDropdown.value = false;
    return;
  }
  
  console.log('[Search Debug] Starting search');
  isSearching.value = true;
  showSearchDropdown.value = true;
  selectedIndex.value = -1;
  
  try {
    console.log(`[Search] Performing real API search for: "${query}"`);
    
    // Call the real search API
    const apiResults = await callSearchAPI(query);
    
    // Transform API results to match expected format
    const transformedResults = transformSearchResults(apiResults);
    searchResults.value = transformedResults;
    
    console.log(`[Search] Found ${transformedResults.events.length} events, ${transformedResults.users.length} users, ${transformedResults.organizations.length} organizations`);
  } catch (error) {
    console.error('[Search] API call failed:', error);
    
    // Fallback to mock data if API fails
    console.log('[Search] Falling back to mock data due to API error');
    const mockResults = generateMockSearchResults(query);
    searchResults.value = mockResults;
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
  
  // Number key shortcuts for tabs (1-4)
  if (event.key >= '1' && event.key <= '4' && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
    event.preventDefault();
    const tabIndex = parseInt(event.key) - 1;
    const tabTypes: ('all' | 'events' | 'users' | 'organizations')[] = ['all', 'events', 'users', 'organizations'];
    if (tabIndex < tabTypes.length) {
      filterType.value = tabTypes[tabIndex];
      // Reset selection when switching tabs
      selectedIndex.value = -1;
      // Focus the corresponding tab
      const tabs = [allTab.value, eventsTab.value, usersTab.value, organizationsTab.value];
      nextTick(() => {
        tabs[tabIndex]?.focus();
      });
    }
    return;
  }
  
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
      if (showSearchDropdown.value) {
        closeSearch();
      }
      break;
  }
};

// Debounce timer for WebContentsView visibility
let webContentsVisibilityTimer: NodeJS.Timeout | null = null;

const handleSearchFocus = () => {
  console.log('[Search Debug] handleSearchFocus called, query:', searchQuery.value);
  
  // Check if we have 3+ characters when focusing
  if (searchQuery.value.length >= 3) {
    // Show search dropdown and hide WebContentsView
    showSearchDropdown.value = true;
    isWebContentsViewVisible.value = false;
    
    // Hide WebContentsView
    if (window.ipcRenderer) {
      window.ipcRenderer.send('enhanced-window:hide-webcontentsview');
    }
    
    // Cancel any pending show operation
    if (webContentsVisibilityTimer) {
      clearTimeout(webContentsVisibilityTimer);
      webContentsVisibilityTimer = null;
    }
    
    // Trigger immediate search
    performSearch(searchQuery.value);
  }
};

// Track if we're clicking on search results
let isClickingSearchResult = false;

const handleSearchBlur = (event: FocusEvent) => {
  // Cancel any pending visibility timer
  if (webContentsVisibilityTimer) {
    clearTimeout(webContentsVisibilityTimer);
  }
  
  // Use a longer delay to allow for tab clicks and focus changes
  webContentsVisibilityTimer = setTimeout(() => {
    // Check if the focus is still within the search area (including tabs)
    const activeElement = document.activeElement;
    const isSearchInput = activeElement === searchInput.value;
    const isTab = [allTab.value, eventsTab.value, usersTab.value, organizationsTab.value].includes(activeElement as HTMLButtonElement);
    const isWithinSearchOverlay = activeElement?.closest('[data-search-overlay]');
    
    if (!isClickingSearchResult && !isSearchInput && !isTab && !isWithinSearchOverlay) {
      console.log('[Search] Blur detected outside search area, closing dropdown');
      showSearchDropdown.value = false;
      selectedIndex.value = -1;
      
      // When search dropdown is hidden on blur, always show WebContentsView
      if (!showSearchDropdown.value && !isWebContentsViewVisible.value) {
        console.log('[Search] Blur hiding dropdown, showing WebContentsView');
        isWebContentsViewVisible.value = true;
        
        // Send IPC to show WebContentsView
        if (window.ipcRenderer) {
          window.ipcRenderer.send('enhanced-window:show-webcontentsview');
        }
      }
    }
    isClickingSearchResult = false;
    webContentsVisibilityTimer = null;
  }, 200); // Increased delay to handle focus transitions
};

// Test function to force show dropdown
const testSearch = () => {
  console.log('[Search Test] Forcing dropdown to show');
  showSearchDropdown.value = true;
  
  // Hide WebContentsView
  if (window.ipcRenderer) {
    window.ipcRenderer.send('enhanced-window:hide-webcontentsview');
  }
  
  // Add some test results
  searchResults.value = {
    events: [
      { id: '1', title: 'Test Event 1', type: 'kill', timestamp: Date.now() },
      { id: '2', title: 'Test Event 2', type: 'death', timestamp: Date.now() }
    ],
    users: [
      { id: '1', username: 'TestUser1', pfpUrl: null },
      { id: '2', username: 'TestUser2', pfpUrl: null }
    ],
    organizations: []
  };
};

// Close search overlay
const closeSearch = () => {
  console.log('[Search] Closing search overlay');
  showSearchDropdown.value = false;
  searchQuery.value = '';
  searchResults.value = { events: [], users: [], organizations: [] };
  selectedIndex.value = -1;
  isWebContentsViewVisible.value = true;
  
  // Show WebContentsView
  if (window.ipcRenderer) {
    window.ipcRenderer.send('enhanced-window:show-webcontentsview');
  }
  
  // Focus back to main search input
  nextTick(() => {
    searchInput.value?.focus();
  });
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

const handleResultClick = async (type: 'event' | 'user' | 'organization', item: any) => {
  console.log(`[Search] *** RESULT CLICKED *** Type: ${type}, Item:`, item);
  
  // Hide dropdown and clear search immediately
  showSearchDropdown.value = false;
  searchQuery.value = '';
  searchResults.value = { events: [], users: [], organizations: [] };
  selectedIndex.value = -1;
  
  // Ensure WebContentsView is visible
  if (!isWebContentsViewVisible.value) {
    isWebContentsViewVisible.value = true;
    if (window.ipcRenderer) {
      window.ipcRenderer.send('enhanced-window:show-webcontentsview');
    }
  }
  
  // Navigate to the specific URL based on type
  try {
    let navigationUrl = '';
    
    switch (type) {
      case 'event':
        // Navigate to event detail page
        if (item.id || item.value) {
          navigationUrl = `/event/${item.id || item.value}`;
        } else {
          navigationUrl = '/events';
        }
        break;
        
      case 'user':
        // Navigate to user profile page
        if (item.username || item.value) {
          navigationUrl = `/user/${item.username || item.value}`;
        } else {
          navigationUrl = '/profile';
        }
        break;
        
      case 'organization':
        // Navigate to organization page
        if (item.tag || item.value) {
          navigationUrl = `/orgs/${item.tag || item.value}`;
        } else {
          navigationUrl = '/orgs';
        }
        break;
    }
    
    console.log(`[Search] Navigating WebContentsView to: ${navigationUrl}`);
    
    // First, try to detect what section this navigation belongs to
    let targetSection: 'profile' | 'leaderboard' | 'map' | 'events' | 'stats' | 'profile-settings' | null = null;
    
    if (navigationUrl.includes('/user/') || navigationUrl === '/profile') {
      targetSection = 'profile';
    } else if (navigationUrl.includes('/event/') || navigationUrl === '/events') {
      targetSection = 'events';
    } else if (navigationUrl.includes('/orgs/') || navigationUrl === '/orgs') {
      // Organizations might map to a different section or stay in current
      targetSection = null; // Keep current section
    }
    
    // If we can map to a known section, use fast navigation
    if (targetSection && window.logMonitorApi?.webContentNavigateToSection) {
      console.log(`[Search] Using fast navigation to section: ${targetSection}`);
      const result = await window.logMonitorApi.webContentNavigateToSection(targetSection as 'profile' | 'leaderboard' | 'map');
      
      if (result?.success) {
        // Also update local navigation state
        setActiveSection(targetSection, true); // Preserve search during navigation
        
        // Then use IPC to navigate to the specific URL within that section
        if (window.ipcRenderer) {
          window.ipcRenderer.send('enhanced-window:navigate-to-url', navigationUrl);
        }
      }
    } else if (window.ipcRenderer && navigationUrl) {
      // Fallback: Send navigation request to main process
      window.ipcRenderer.send('enhanced-window:navigate-to-url', navigationUrl);
      console.log('[Search] Sent navigation request to main process');
    }
    
    // Clear search input
    searchQuery.value = '';
    showSearchDropdown.value = false;
    selectedIndex.value = -1;
    searchResults.value = { events: [], users: [], organizations: [] };
    
    // Blur the search input
    if (searchInput.value) {
      searchInput.value.blur();
    }
  } catch (error) {
    console.error('[Search] Failed to navigate to result:', error);
  }
};

// Navigate to dedicated search page with query parameters
const navigateToSearchPage = async (query: string) => {
  console.log(`[Search] Navigating to search page with query: "${query}"`);
  
  try {
    // Clear search state and hide dropdown
    showSearchDropdown.value = false;
    selectedIndex.value = -1;
    
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

// Tab keyboard navigation
const focusNextTab = (event: KeyboardEvent) => {
  event.preventDefault();
  const tabs = [allTab.value, eventsTab.value, usersTab.value, organizationsTab.value];
  const currentIndex = tabs.findIndex(tab => tab === event.target);
  const nextIndex = (currentIndex + 1) % tabs.length;
  tabs[nextIndex]?.focus();
  tabs[nextIndex]?.click();
  // Keep the dropdown open
  isClickingSearchResult = true;
};

const focusPrevTab = (event: KeyboardEvent) => {
  event.preventDefault();
  const tabs = [allTab.value, eventsTab.value, usersTab.value, organizationsTab.value];
  const currentIndex = tabs.findIndex(tab => tab === event.target);
  const prevIndex = currentIndex === 0 ? tabs.length - 1 : currentIndex - 1;
  tabs[prevIndex]?.focus();
  tabs[prevIndex]?.click();
  // Keep the dropdown open
  isClickingSearchResult = true;
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
// Track if navigation is in progress to prevent rapid clicks
let navigationInProgress = false;
let navigationAbortController: AbortController | null = null;

const setActiveSection = async (section: 'profile' | 'leaderboard' | 'map' | 'events' | 'stats' | 'profile-settings', preserveSearch = false) => {
  console.log(`[WebContentPage] Setting active section to: ${section}, preserveSearch: ${preserveSearch}`);
  
  // Prevent rapid navigation using unified state
  if (isNavigating.value) {
    console.warn(`[WebContentPage] Navigation already in progress, ignoring request for ${section}`);
    return;
  }
  
  try {
    // Optionally clear search when changing sections
    if (!preserveSearch) {
      console.log(`[WebContentPage] Clearing search before section change`);
      searchQuery.value = '';
      searchResults.value = { events: [], users: [], organizations: [] };
      showSearchDropdown.value = false;
      selectedIndex.value = -1;
      lastSentSearchData.value = '';
      
      // Clear the clicking flag to ensure dropdown closes
      isClickingSearchResult = false;
      
      // Cancel any pending blur timers
      if (webContentsVisibilityTimer) {
        clearTimeout(webContentsVisibilityTimer);
        webContentsVisibilityTimer = null;
      }
      
      if (searchInput.value) {
        searchInput.value.value = '';
        searchInput.value.blur(); // Blur the search input
      }
    } else {
      console.log(`[WebContentPage] Preserving search state during section change`);
    }
    
    // IMPORTANT: Always ensure WebContentsView is visible when navigating
    if (!isWebContentsViewVisible.value || showSearchDropdown.value) {
      console.log(`[WebContentPage] Ensuring WebContentsView is visible`);
      isWebContentsViewVisible.value = true;
      showSearchDropdown.value = false; // Force close dropdown
      
      // Send IPC to show WebContentsView
      if (window.ipcRenderer) {
        window.ipcRenderer.send('enhanced-window:show-webcontentsview');
      }
    }
    
    // Don't show loading if it's the same section or if WebContentsView isn't attached yet
    if (section === currentSection.value || !isWebContentsViewAttached.value) {
      return;
    }
    
    // Show loading overlay with fade in
    isLoading.value = true;
    showLoadingOverlay.value = true;
    loadingProgress.value = 0;
    loadingMessage.value = 'Initializing navigation...';
    
    // Simulate initial progress
    setTimeout(() => {
      if (isLoading.value) {
        loadingProgress.value = 20;
        loadingMessage.value = 'Connecting to server...';
      }
    }, 100);
    
    // Use unified navigation state
    await navigateToSection(section);
    
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
    
  } catch (error) {
    console.error(`[WebContentPage] Failed to navigate WebContentsView to section ${section}:`, error);
    // Hide loading on error
    showLoadingOverlay.value = false;
    setTimeout(() => {
      isLoading.value = false;
    }, 300);
  }
};

// Report navigation changes back to unified state when user navigates directly in WebContentsView
const reportNavigationChange = (section: 'profile' | 'leaderboard' | 'map' | 'events' | 'stats' | 'profile-settings') => {
  console.log(`[WebContentPage] Reporting navigation change to unified state: ${section}`);
  updateCurrentSection(section);
  
  // Also dispatch event for other components
  window.dispatchEvent(new CustomEvent('navigation-state-update', {
    detail: { section }
  }));
};

// Function to notify main process that WebContentPage is ready for WebContentsView
const notifyMainProcessReady = async () => {
  console.log('[WebContentPage] Notifying main process that WebContentPage is ready');
  
  // Use requestAnimationFrame to ensure DOM is ready without unnecessary delay
  requestAnimationFrame(async () => {
    try {
      console.log('[WebContentPage] Starting WebContentsView attachment process');
      console.log('[WebContentPage] Window title:', document.title);
      console.log('[WebContentPage] Current section:', currentSection.value || 'profile');
      
      // Call the enhanced IPC handler to attach WebContentsView to THIS window
      if (window.logMonitorApi && window.logMonitorApi.openEnhancedWebContentWindow) {
        console.log('[WebContentPage] Requesting WebContentsView attachment for section:', currentSection.value || 'profile');
        
        // Update progress
        loadingProgress.value = 30;
        loadingMessage.value = 'Attaching WebContentsView...';
        
        const result = await window.logMonitorApi.openEnhancedWebContentWindow(currentSection.value || 'profile');
        console.log('[WebContentPage] WebContentsView attach result:', result);
        
        if (result.success) {
          console.log('[WebContentPage] WebContentsView attached successfully');
          
          // Update progress
          loadingProgress.value = 50;
          loadingMessage.value = 'Loading authentication...';
          
          // Hide the loading placeholder since WebContentsView is now attached
          const container = document.getElementById('webcontents-container');
          if (container) {
            // Clear the loading message
            container.innerHTML = '';
            console.log('[WebContentPage] Cleared loading message from container');
          }
          
          // Mark WebContentsView as attached to enable loading transitions
          isWebContentsViewAttached.value = true;
          
          // Ensure WebContentsView is visible after attachment
          if (!isWebContentsViewVisible.value) {
            console.log('[WebContentPage] WebContentsView was hidden, showing it now');
            isWebContentsViewVisible.value = true;
            if (window.ipcRenderer) {
              window.ipcRenderer.send('enhanced-window:show-webcontentsview');
            }
          }
          
          // Simulate final loading steps
          setTimeout(() => {
            if (loadingProgress.value < 100) {
              loadingProgress.value = 80;
              loadingMessage.value = 'Rendering page...';
            }
          }, 500);
        } else {
          console.error('[WebContentPage] WebContentsView attachment failed:', result.error);
          loadingProgress.value = 0;
          loadingMessage.value = 'Failed to load content';
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

  // Ensure WebContentsView is visible on mount
  isWebContentsViewVisible.value = true;
  showSearchDropdown.value = false;
  searchQuery.value = '';
  console.log('[WebContentPage] Reset initial state: visibility=true, search=false, query=empty');
  
  // Show initial loading state
  if (!isWebContentsViewAttached.value) {
    loadingProgress.value = 10;
    loadingMessage.value = 'Initializing WebContentsView...';
  }
  
  // Add global click handler to close search when clicking outside
  const handleDocumentClick = (event: MouseEvent) => {
    if (showSearchDropdown.value) {
      const target = event.target as HTMLElement;
      const isSearchArea = target.closest('[data-search-overlay]') || 
                          target.closest('.search-container') ||
                          target === searchInput.value;
      
      if (!isSearchArea) {
        console.log('[Search] Clicked outside search area, closing dropdown');
        closeSearch();
      }
    }
  };
  
  document.addEventListener('click', handleDocumentClick);
  
  // Store cleanup function
  onUnmounted(() => {
    document.removeEventListener('click', handleDocumentClick);
  });

  // Get authentication status first
  await updateAuthStatus();

  // Initialize navigation listeners from unified state
  initNavigationListeners();
  
  // Get initial section from window status and sync with unified state
  if (window.logMonitorApi && window.logMonitorApi.getWebContentWindowStatus) {
    try {
      const status = await window.logMonitorApi.getWebContentWindowStatus();
      if (status.isOpen && status.activeSection) {
        if (status.activeSection === 'profile' || status.activeSection === 'leaderboard' || status.activeSection === 'map' || status.activeSection === 'events' || status.activeSection === 'stats' || status.activeSection === 'profile-settings') {
          updateCurrentSection(status.activeSection);
          console.log(`[WebContentPage] Initial section synced to unified state: ${status.activeSection}`);
        } else if (status.activeSection === '/') {
          updateCurrentSection('profile'); // Default to profile for root path
          console.log(`[WebContentPage] Initial section set to profile for root path`);
        }
      }
    } catch (error) {
      console.error('[WebContentPage] Failed to get initial window status:', error);
    }
  }

  // Notify main process that WebContentPage is ready and attach WebContentsView
  await notifyMainProcessReady();
  
  // Expose setActiveSection globally for fast navigation
  (window as any).setActiveSection = setActiveSection;
  console.log('[WebContentPage] Exposed setActiveSection globally for fast navigation');

  // Listen for navigation requests from main process
  window.addEventListener('web-content-navigate', (event: any) => {
    const section = event.detail?.section;
    if (section === 'profile' || section === 'leaderboard' || section === 'map' || section === 'events' || section === 'stats' || section === 'profile-settings') {
      console.log(`[WebContentPage] Received navigation request for: ${section}`);
      setActiveSection(section);
    }
  });

  // Listen for navigation requests from main process (IPC)
  if (window.logMonitorApi && window.logMonitorApi.onNavigateToSection) {
    window.logMonitorApi.onNavigateToSection((_event: IpcRendererEvent, section: string) => {
      console.log('[WebContentPage] Received navigate-to-section IPC event:', section);
      if (section === 'profile' || section === 'leaderboard' || section === 'map' || 
          section === 'events' || section === 'stats' || section === 'profile-settings') {
        setActiveSection(section as 'profile' | 'leaderboard' | 'map' | 'events' | 'stats' | 'profile-settings');
        // Also report to unified navigation state
        reportNavigationChange(section as 'profile' | 'leaderboard' | 'map' | 'events' | 'stats' | 'profile-settings');
      }
    });
  }

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
        case 'webcontents-view-navigated':
          // Report navigation change to unified state when user navigates directly in WebContentsView
          const navSection = event.data.section;
          if (navSection && navSection !== currentSection.value) {
            console.log('[WebContentPage] WebContentsView navigated to:', navSection);
            reportNavigationChange(navSection);
          }
          break;
      }
    }
  });
});

onUnmounted(() => {
  console.log('[WebContentPage] Unmounted - WebContentsView will be cleaned up by main process');
});

</script>

<style scoped>
/* Search overlay transition */
.search-overlay-enter-active,
.search-overlay-leave-active {
  transition: all 0.3s ease;
}

.search-overlay-enter-from,
.search-overlay-leave-to {
  opacity: 0;
}

.search-overlay-enter-to,
.search-overlay-leave-from {
  opacity: 1;
}

/* Result hover effects */
.result-item {
  transition: all 0.2s ease;
}

.result-item:hover {
  transform: translateX(4px);
}

/* Remove default browser focus outline on all interactive elements */
button:focus {
  outline: none !important;
}

button:focus-visible {
  outline: none !important;
}

/* Remove focus outline from navigation buttons specifically */
.navigation-button:focus {
  outline: none !important;
  box-shadow: none !important;
}

/* Remove any webkit focus styles */
button::-moz-focus-inner {
  border: 0;
}

/* Settings button specific - remove all focus effects */
button[title="Website Settings"]:focus {
  outline: none !important;
  box-shadow: none !important;
}
</style>

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