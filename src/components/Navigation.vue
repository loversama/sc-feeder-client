<script setup lang="ts">
import { defineProps, defineEmits, ref, onMounted, computed, watch } from 'vue'
import { ElAvatar, ElMenu, ElMenuItem, ElSubMenu } from 'element-plus'
import { User, Key, Switch, MapLocation } from '@element-plus/icons-vue'
import { useUserState } from '../composables/useUserState'

// Props and emits
const props = defineProps<{
  activePage: string
}>()

const emit = defineEmits<{
  (e: 'change-page', page: string): void
}>()

// State
const activeIndex = ref('1')
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
    if (command === 'logout') {
      await window.logMonitorApi?.authLogout?.()
      resetUser()
    } else if (command === 'login') {
      await openExternalSection('profile', 'VOIDLOG.GG - Login')
    } else if (command === 'profile') {
      await openExternalSection('profile', 'VOIDLOG.GG - Profile')
    } else if (command === 'map') {
      await openExternalSection('map', 'VOIDLOG.GG - Star Citizen Map')
    } else if (command === 'settings') {
      await window.logMonitorApi?.openSettingsWindow?.()
    }
  } catch (error) {
    console.error('Error handling command:', error)
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
</script>

<template>
  <nav class="nav-container bg-theme-bg-panel shadow">
    <div class="nav-draggable cet-drag-region pl-5">
      <el-menu
        :default-active="activeIndex"
        mode="horizontal"
        :ellipsis="false"
        class="custom-menu"
      >
        <el-sub-menu index="1" class="w-[60%]">
          <template #title>
            <div class="flex items-center gap-4">
              <el-avatar
                :size="42"
                class="bg-gradient-to-br from-[rgb(99,99,247)] to-[rgb(77,77,234)] text-white font-semibold border-2 border-[#404040]"
                shape="square"
                :src="avatar"
              >
                {{ avatarText }}
              </el-avatar>
              <div class="flex flex-col gap-0.5 ml-1.5">
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
            </div>
          </template>
          <el-menu-item index="1-1" @click="handleCommand(isAuthenticated ? 'logout' : 'login')" class="menu-item">
            <el-icon><Key /></el-icon>
            <span>{{ isAuthenticated ? 'Logout' : 'Login' }}</span>
          </el-menu-item>
          <el-menu-item index="1-2" @click="handleCommand('profile')" class="menu-item">
            <el-icon><User /></el-icon>
            <span>Profile</span>
          </el-menu-item>
          <el-menu-item index="1-3" @click="handleCommand('map')" class="menu-item">
            <el-icon><MapLocation /></el-icon>
            <span>Map</span>
          </el-menu-item>
          <el-menu-item index="1-4" @click="handleCommand('settings')" class="menu-item">
            <el-icon><Switch /></el-icon>
            <span>Settings</span>
          </el-menu-item>
        </el-sub-menu>
      </el-menu>
    </div>
  </nav>
</template>

<style>
/* Element Plus Menu Overrides */
.custom-menu {
  --el-menu-bg-color: transparent !important;
  --el-menu-border-color: transparent !important;
  --el-menu-text-color: var(--color-theme-text-light) !important;
  --el-menu-hover-bg-color: #262626 !important;
  --el-menu-hover-text-color: white !important;
  --el-menu-active-color: rgb(99, 99, 247) !important;
  --el-menu-border-color: transparent !important;
  height: 80px !important;
  border: none !important;
  border-bottom: 0 !important;
}

.custom-menu :deep(.el-menu-item) {
  border-bottom: 0 !important;
}

.el-menu--popup {
  background-color: #171717 !important;
  border: 1px solid #262626 !important;
  padding: 8px !important;
  border-radius: 8px !important;
}

.menu-item.el-menu-item {
  height: 40px !important;
  line-height: 40px !important;
  color: var(--color-theme-text-light) !important;
  margin: 2px 0 !important;
  border-radius: 4px !important;
  font-size: 14px !important;
}

.menu-item.el-menu-item:hover {
  background-color: #262626 !important;
  color: white !important;
}

.menu-item .el-icon {
  margin-right: 12px !important;
  font-size: 18px !important;
}

.el-sub-menu__title {
  height: 80px !important;
  line-height: 80px !important;
  padding: 0 !important;
}

/* Avatar and Container Styles */
.nav-container {
  display: flex;
  background-color: #171717;
  user-select: none;
  width: 100%;
  height: 80px;
}

.nav-draggable {
  display: flex;
  width: 100%;
  height: 80px;
  align-items: center;
}

:deep(.el-avatar) {
  font-size: 22px;
  transition: all 0.2s ease;
  border-radius: 10px !important;
}

:deep(.el-avatar:hover) {
  transform: scale(1.05);
}

:deep(.el-menu-item .el-icon) {
  color: var(--color-theme-text-light) !important;
}

:deep(.el-menu-item:hover .el-icon) {
  color: white !important;
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
</style>