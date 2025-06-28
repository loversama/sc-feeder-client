<script setup lang="ts">
import { defineProps, defineEmits, ref, onMounted, computed, watch } from 'vue'
import { ElAvatar, ElMenu, ElMenuItem, ElSubMenu } from 'element-plus'
import { User, Key, Switch } from '@element-plus/icons-vue'
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
  if (userState.value.isAuthenticated) {
    return userState.value.username
  }
  return userState.value.lastLoggedInUser || 'Guest'
})
const isAuthenticated = computed(() => userState.value.isAuthenticated)
const rsiHandle = computed(() => userState.value.rsiHandle)
const rsiMoniker = computed(() => userState.value.rsiMoniker)
const avatar = computed(() => userState.value.avatar)
const avatarText = computed(() => {
  if (!displayName.value) return 'G'
  return displayName.value.charAt(0).toUpperCase()
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

// Handlers
const handleCommand = async (command: string) => {
  try {
    if (command === 'logout') {
      await window.logMonitorApi?.authLogout?.()
      resetUser()
    } else if (command === 'login') {
      await window.logMonitorApi?.openWebContentWindow?.('profile')
    } else if (command === 'profile') {
      await window.logMonitorApi?.openWebContentWindow?.('profile')
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
                <span class="text-sm font-semibold text-theme-text-light leading-none mb-1">
                  {{ displayName }}
                </span>
                <span
                  class="text-[11px] font-medium tracking-widest uppercase leading-none"
                  :class="isAuthenticated ? 'text-[rgb(99,99,247)]' : 'text-[#737373]'"
                >
                  {{ isAuthenticated ? `@${rsiMoniker || rsiHandle || 'Unknown'}` : 'GUEST MODE' }}
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
          <el-menu-item index="1-3" @click="handleCommand('settings')" class="menu-item">
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