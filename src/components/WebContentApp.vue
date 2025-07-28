<script setup lang="ts">
import { RouterLink, RouterView } from 'vue-router';
// Removed ref, onMounted
import { MoreFilled } from '@element-plus/icons-vue'; // Import the icon
import UpdateNotificationCompact from './UpdateNotificationCompact.vue';

// Removed headerRef and headerHeight logic
</script>

<template>
  <div class="relative flex flex-col h-screen overflow-hidden bg-theme-bg-dark text-theme-text-light border border-theme-border">
    <!-- Non-Fixed Header -->
    <header class="p-2 bg-[#171717] border-b border-[#262626] shadow-md shrink-0 h-[80px] flex items-center justify-between">
      <!-- Tab Navigation -->
      <nav class="mt-2 flex items-center">
        <!-- More Options Button -->
        <el-button
          ref="ref3"
          :icon="MoreFilled"
          text
          class="ml-5 p-2 text-theme-text-light hover:bg-white/5 border border-white/10"
          title="More Options"
        />
        <!-- Navigation Links -->
        <router-link
          to="/profile"
          class="ml-[50px] p-2 rounded transition-colors duration-200"
          :class="{ 'text-[rgb(99,99,247)] bg-white/5': $route.path === '/profile', 'hover:bg-white/5 hover:text-[rgb(77,77,234)]': $route.path !== '/profile' }"
        >
          Profile
        </router-link>
        <router-link
          to="/leaderboard"
          class="ml-4 p-2 rounded transition-colors duration-200"
          :class="{ 'text-[rgb(99,99,247)] bg-white/5': $route.path === '/leaderboard', 'hover:bg-white/5 hover:text-[rgb(77,77,234)]': $route.path !== '/leaderboard' }"
        >
          Leaderboard
        </router-link>
      </nav>
      <!-- Update Notification -->
      <div class="pr-4">
        <UpdateNotificationCompact />
      </div>
    </header>

    <!-- Main Content Area (takes remaining space) -->
    <main
      class="flex-1 overflow-auto"
    >
      <router-view /> <!-- The page component should handle its own height (h-full) -->
    </main>
  </div>
</template>

<style>
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
  /* padding-bottom: 80px; */
  z-index: 1 !important;

}
    

.cet-menubar {
    display: none !important;
}

.cet-icon {
    display: none !important;
}

.title-bar {
  -webkit-app-region: drag;
  user-select: none; /* Prevent text selection */
}

main.flex-1 {
    padding: 0px !important;
    /* margin-top: -25px !important; */ /* Removed negative margin */
}
</style>