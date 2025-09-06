<script setup lang="ts">
import { defineProps, defineEmits, ref, onMounted, computed, watch } from 'vue'
import { ElAvatar } from 'element-plus'
import { User, Key, Switch, MapLocation, Close, ArrowDown, Trophy } from '@element-plus/icons-vue'
import { useUserState } from '../composables/useUserState'

// Props and emits
const props = defineProps<{
  activePage: string
}>()

const emit = defineEmits<{
  (e: 'change-page', page: string): void
}>()

// State
const isMenuOpen = ref(false)
const { state: userState, reset: resetUser, updateAuthStatus } = useUserState()

// Computed values for template
const displayName = computed(() => {
  if (userState.value.isAuthLoading) {
    return userState.value.lastLoggedInUser || 'Loading...' // Show loading instead of Guest
  }
  if (userState.value.isAuthenticated) {
    return userState.value.username
  }
  return userState.value.lastLoggedInUser || 'Guest'
})
const isAuthenticated = computed(() => userState.value.isAuthenticated)
const isAuthLoading = computed(() => userState.value.isAuthLoading) // Add loading state
const rsiHandle = computed(() => userState.value.rsiHandle)
const rsiMoniker = computed(() => userState.value.rsiMoniker)
const avatar = computed(() => userState.value.avatar)
const avatarText = computed(() => {
  if (!displayName.value) return 'G'
  return displayName.value.charAt(0).toUpperCase()
})

// Role pip computation
const userRole = computed(() => {
  if (!isAuthenticated.value || !userState.value.roles?.length) return null
  
  // Check for special roles in priority order
  if (userState.value.roles.includes('admin')) return { text: 'ADMIN', color: 'red' }
  if (userState.value.roles.includes('vip')) return { text: 'VIP', color: 'orange' }
  if (userState.value.roles.includes('pro')) return { text: 'PRO', color: 'purple' }
  if (userState.value.roles.includes('supporter')) return { text: 'SUPPORTER', color: 'yellow' }
  
  // Don't show pip for 'user' or 'guest' roles
  return null
})

// Watch for debugging
watch(rsiMoniker, (newVal, oldVal) => {
  console.log(`Navigation.vue: rsiMoniker changed from ${oldVal} to ${newVal}`)
})
watch(rsiHandle, (newVal, oldVal) => {
  console.log(`Navigation.vue: rsiHandle changed from ${oldVal} to ${newVal}`)
})
watch(isAuthenticated, (newVal, oldVal) => {
  console.log(`Navigation.vue: isAuthenticated changed from ${oldVal} to ${newVal}`)
})

// Enhanced helper function to open external website with new architecture support
const openExternalSection = async (section: 'profile' | 'leaderboard' | 'map' | 'events' | 'stats' | '/', title?: string) => {
  try {
    // First try the new enhanced WebContentsView system for Steam-like embedded experience
    if (['profile', 'leaderboard', 'map'].includes(section) && window.logMonitorApi?.openEnhancedWebContentWindow) {
      try {
        console.log(`[Navigation] Attempting enhanced WebContentsView for ${section}`);
        const result = await window.logMonitorApi.openEnhancedWebContentWindow(section as 'profile' | 'leaderboard' | 'map');
        
        if (result?.success) {
          console.log(`[Navigation] Enhanced WebContentsView opened successfully for ${section}:`, result);
          return;
        } else {
          console.warn(`[Navigation] Enhanced WebContentsView failed for ${section}:`, result?.error);
        }
      } catch (error) {
        console.warn(`[Navigation] Enhanced WebContentsView error for ${section}:`, error);
      }
    }

    // Determine the correct URL based on environment for fallback external window
    const currentUrl = window.location.href;
    const isDev = currentUrl.includes('localhost') || currentUrl.includes('127.0.0.1');
    const baseUrl = isDev ? 'http://localhost:3001' : 'https://voidlog.gg';
    const websiteUrl = section === 'profile' ? baseUrl : `${baseUrl}/${section}`;
    
    // Fallback to external window for scenarios where WebContentsView isn't suitable
    try {
      console.log(`[Navigation] Falling back to external window for ${section}`);
      const result = await window.logMonitorApi?.openExternalWebWindow?.(websiteUrl, {
        width: section === 'map' ? 1600 : 1400,
        height: section === 'map' ? 1000 : 900,
        title: title || `VOIDLOG.GG - ${section.charAt(0).toUpperCase() + section.slice(1)}`,
        enableAuth: true
      });
      
      if (result?.success) {
        console.log(`[Navigation] External window opened successfully for ${section}`);
        return;
      } else {
        console.warn(`[Navigation] External window failed for ${section}:`, result?.error);
      }
    } catch (error) {
      console.warn(`[Navigation] External window error for ${section}:`, error);
    }

    // Check if legacy WebContentsView navigation is available
    if (window.logMonitorApi?.webContentNavigateToSection && ['profile', 'leaderboard', 'map'].includes(section)) {
      try {
        console.log(`[Navigation] Trying legacy WebContentsView navigation for ${section}`);
        const navResult = await window.logMonitorApi.webContentNavigateToSection(section as 'profile' | 'leaderboard' | 'map');
        if (navResult?.success) {
          console.log(`[Navigation] Legacy WebContentsView navigation successful for ${section}:`, navResult);
          return;
        } else {
          console.warn(`[Navigation] Legacy WebContentsView navigation failed for ${section}:`, navResult?.error);
        }
      } catch (error) {
        console.warn(`[Navigation] Legacy WebContentsView navigation error for ${section}:`, error);
      }
    }

    // Final fallback to legacy webview system
    try {
      console.log(`[Navigation] Final fallback to legacy webview for ${section}`);
      const result = await window.logMonitorApi?.openWebContentWindow?.(section);
      console.log(`[Navigation] Legacy webview fallback result for ${section}:`, result);
    } catch (fallbackError) {
      console.error(`[Navigation] All fallbacks failed for ${section}:`, fallbackError);
    }
  } catch (error) {
    console.error(`[Navigation] Failed to open ${section}:`, error);
  }
};

// Handlers
const handleCommand = async (command: string) => {
  try {
    closeMenu() // Close menu after any command
    
    if (command === 'logout') {
      await window.logMonitorApi?.authLogout?.()
      resetUser()
    } else if (command === 'login') {
      await window.logMonitorApi?.authShowLogin?.()
    } else if (command === 'profile') {
      await openExternalSection('profile', 'VOIDLOG.GG - Profile')
    } else if (command === 'leaderboard') {
      await openExternalSection('leaderboard', 'VOIDLOG.GG - Leaderboard')
    } else if (command === 'map') {
      await openExternalSection('map', 'VOIDLOG.GG - Star Citizen Map')
    } else if (command === 'settings') {
      await window.logMonitorApi?.openSettingsWindow?.()
    }
  } catch (error) {
    console.error('Error handling command:', error)
  }
}

const handleRegister = async () => {
  try {
    closeMenu()
    // Always use production URL for registration
    const registerUrl = 'https://voidlog.gg/register';
    
    // Open register page in default browser
    if (window.logMonitorApi?.openExternal) {
      await window.logMonitorApi.openExternal(registerUrl);
    } else {
      console.error('openExternal API not available');
    }
  } catch (error) {
    console.error('Error opening register page:', error)
  }
}

// Set up auth status listener and load initial state
onMounted(async () => {
  console.log('[Navigation] Component mounted, checking auth status...')
  await updateAuthStatus()
  console.log('[Navigation] Initial auth status loaded:', {
    isAuthenticated: userState.value.isAuthenticated,
    username: userState.value.username
  })
  
  // Listen for auth status changes
  if (window.logMonitorApi?.onAuthStatusChanged) {
    window.logMonitorApi.onAuthStatusChanged((event, status) => {
      console.log('[Navigation] Received auth-status-changed:', status)
      updateAuthStatus()
    })
  }
})

const changePage = (page: string) => {
  emit('change-page', page)
}

const toggleMenu = () => {
  isMenuOpen.value = !isMenuOpen.value
}

const closeMenu = () => {
  isMenuOpen.value = false
}
</script>

<template>
  <nav class="nav-container bg-theme-bg-panel shadow relative">
    <div class="nav-draggable cet-drag-region pl-2">
      <!-- Avatar Button -->
      <div 
        class="avatar-button"
        @click="toggleMenu"
      >
        <el-avatar
          :size="42"
          class="bg-gradient-to-br from-[rgb(99,99,247)] to-[rgb(77,77,234)] text-white font-semibold border-2 border-[#404040]"
          shape="square"
          :src="avatar"
        >
          {{ avatarText }}
        </el-avatar>
        <div class="flex flex-col gap-0.5 ml-3">
          <div class="flex items-center gap-2">
            <span class="text-sm font-semibold text-theme-text-light leading-none">
              {{ displayName }}
            </span>
            <!-- Role pip -->
            <span 
              v-if="userRole"
              class="px-1.5 py-0.5 text-[9px] font-bold tracking-wide uppercase rounded border leading-none"
              :class="{
                'text-red-400 border-red-400': userRole.color === 'red',
                'text-orange-400 border-orange-400': userRole.color === 'orange', 
                'text-purple-400 border-purple-400': userRole.color === 'purple',
                'text-yellow-400 border-yellow-400': userRole.color === 'yellow'
              }"
            >
              {{ userRole.text }}
            </span>
          </div>
          <span
            class="text-[11px] font-medium tracking-widest uppercase leading-none"
            :class="isAuthenticated ? 'text-[rgb(99,99,247)]' : (isAuthLoading ? 'text-[#999]' : 'text-[#737373]')"
          >
            {{ isAuthLoading ? 'LOADING...' : (isAuthenticated ? `@${rsiMoniker || rsiHandle || 'Unknown'}` : 'GUEST MODE') }}
          </span>
        </div>
        <!-- Chevron indicator -->
        <el-icon 
          :size="16" 
          class="ml-2 chevron-icon"
          :class="{ 'rotate-180': isMenuOpen }"
        >
          <ArrowDown />
        </el-icon>
      </div>
    </div>
    
    <!-- Full Page Slide-out Menu -->
    <Transition name="slide-menu">
      <div v-if="isMenuOpen" class="full-menu-overlay">
        <div class="menu-content">
          <!-- Menu Items -->
          <div class="menu-items-wrapper">
            <div class="menu-items">
              <button 
                @click="handleCommand('profile')" 
                class="menu-button"
              >
                <el-icon :size="24"><User /></el-icon>
                <span>Profile</span>
              </button>
              
              <button 
                @click="handleCommand('leaderboard')" 
                class="menu-button"
              >
                <el-icon :size="24"><Trophy /></el-icon>
                <span>Leaderboard</span>
              </button>
              
              <button 
                @click="handleCommand('map')" 
                class="menu-button"
              >
                <el-icon :size="24"><MapLocation /></el-icon>
                <span>Map</span>
              </button>
              
              <button 
                @click="handleCommand('settings')" 
                class="menu-button"
              >
                <el-icon :size="24"><Switch /></el-icon>
                <span>Settings</span>
              </button>
            </div>
          </div>
          
          <!-- Floating Footer with Action Buttons -->
          <div class="menu-footer">
            <div class="footer-buttons">
              <!-- Login/Register buttons when not authenticated -->
              <template v-if="!isAuthenticated">
                <button 
                  @click="handleCommand('login')"
                  class="action-button login-button"
                >
                  Login
                </button>
                <button 
                  @click="handleRegister"
                  class="action-button register-button"
                >
                  Register
                </button>
              </template>
              
              <!-- Logout button when authenticated -->
              <button 
                v-else
                @click="handleCommand('logout')"
                class="action-button logout-button"
              >
                Logout
              </button>
              
              <!-- Close button -->
              <button 
                @click="closeMenu"
                class="close-button-outline"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </nav>
</template>

<style>
/* Avatar and Container Styles */
.nav-container {
  display: flex;
  background-color: #171717;
  user-select: none;
  width: 100%;
  height: 80px;
  z-index: 1000;
  border-bottom: 1px solid #272727;
}

.nav-draggable {
  display: flex;
  width: 100%;
  height: 80px;
  align-items: center;
  position: relative;
}

.avatar-button {
  display: flex;
  align-items: center;
  padding: 0 15px 0 10px;
  height: 60px;
  cursor: pointer;
  transition: background-color 0.2s ease;
  margin-top: 10px;
  border-radius: 8px;
  width: fit-content;
  max-width: 70%;
}

.avatar-button:hover {
  background-color: rgba(255, 255, 255, 0.05);
}

:deep(.el-avatar) {
  font-size: 22px;
  transition: all 0.2s ease;
  border-radius: 10px !important;
}

:deep(.el-avatar:hover) {
  transform: scale(1.05);
}

.chevron-icon {
  color: #737373;
  transition: all 0.3s ease;
}

.avatar-button:hover .chevron-icon {
  color: var(--color-theme-text-light);
}

.cet-drag-region {
  top: 0;
  left: 0;
  display: block;
  position: absolute;
  width: 100%;
  height: 25px !important;
  z-index: -1;
  -webkit-app-region: drag;
}

/* Full Page Menu Overlay */
.full-menu-overlay {
  position: fixed;
  top: 81px; /* Just below nav bar border */
  left: 0;
  right: 0;
  bottom: 0;
  background-color: #0d0d0d;
  border-top: 1px solid #272727;
  z-index: 9999; /* High z-index to ensure it covers everything */
  overflow: hidden;
  transform-origin: top;
}

.menu-content {
  position: relative;
  height: 100%;
  display: flex;
  flex-direction: column;
}

.menu-items-wrapper {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 40px 20px 120px 20px; /* Extra bottom padding for footer */
  display: flex;
  justify-content: flex-start;
  padding-left: 10px;
}

.menu-items {
  display: flex;
  flex-direction: column;
  gap: 16px;
  width: 100%;
  max-width: 600px;
}

.menu-footer {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  padding: 24px;
  background: linear-gradient(to top, #0d0d0d 70%, transparent);
  display: flex;
  justify-content: center;
  pointer-events: none; /* Allow clicks to pass through gradient */
}

.footer-buttons {
  pointer-events: auto;
  display: flex;
  gap: 16px;
  align-items: center;
}

.close-button-outline {
  padding: 12px 32px;
  background: transparent;
  border: 1px solid rgba(255, 255, 255, 0.5);
  border-radius: 8px;
  color: rgba(255, 255, 255, 0.7);
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.close-button-outline:hover {
  background: rgba(255, 255, 255, 0.1);
  border-color: rgba(255, 255, 255, 0.8);
  color: white;
  transform: translateY(-2px);
}

.close-button-outline:active {
  transform: translateY(0);
}

.action-button {
  padding: 12px 32px;
  border: 1px solid;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.login-button {
  background: rgb(99, 99, 247);
  border-color: rgb(99, 99, 247);
  color: white;
}

.login-button:hover {
  background: rgb(77, 77, 234);
  border-color: rgb(77, 77, 234);
  transform: translateY(-2px);
}

.register-button {
  background: transparent;
  border-color: rgb(99, 99, 247);
  color: rgb(99, 99, 247);
}

.register-button:hover {
  background: rgb(99, 99, 247);
  color: white;
  transform: translateY(-2px);
}

.logout-button {
  background: transparent;
  border-color: #dc2626;
  color: #dc2626;
}

.logout-button:hover {
  background: #dc2626;
  color: white;
  transform: translateY(-2px);
}

.action-button:active {
  transform: translateY(0);
}

.menu-button {
  display: flex;
  align-items: center;
  gap: 20px;
  width: 100%;
  padding: 24px 32px 24px 20px;
  background-color: transparent;
  border: 1px solid transparent;
  border-radius: 12px;
  color: var(--color-theme-text-light);
  font-size: 18px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
  text-align: left;
}

.menu-button:hover {
  background-color: #1a1a1a;
  border-color: #262626;
  color: white;
  transform: translateX(8px);
}

.menu-button:active {
  transform: translateX(4px);
}

/* Slide animation */
.slide-menu-enter-active,
.slide-menu-leave-active {
  transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.3s ease;
}

.slide-menu-enter-from {
  transform: scaleY(0);
  opacity: 0;
}

.slide-menu-enter-to {
  transform: scaleY(1);
  opacity: 1;
}

.slide-menu-leave-from {
  transform: scaleY(1);
  opacity: 1;
}

.slide-menu-leave-to {
  transform: scaleY(0);
  opacity: 0;
}
</style>