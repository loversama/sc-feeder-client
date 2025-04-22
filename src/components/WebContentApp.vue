<script setup lang="ts">
import { RouterLink, RouterView } from 'vue-router';
import { ref, onMounted } from 'vue';

const headerRef = ref<HTMLElement | null>(null);
const headerHeight = ref(0);

onMounted(() => {
  if (headerRef.value) {
    headerHeight.value = headerRef.value.offsetHeight;
  }
});
</script>

<template>
  <div class="relative flex flex-col h-screen overflow-hidden bg-theme-bg-dark text-theme-text-light border border-theme-border">
    <!-- Fixed Header -->
    <header ref="headerRef" class="fixed top-0 left-0 right-0 z-10 p-2 bg-theme-bg-panel shadow">
      <!-- <h1 class="text-lg font-semibold">Web Content Window</h1> -->
      <!-- Tab Navigation -->
      <nav class="mt-2">
        <router-link
          to="/profile"
          class="mr-4 p-2 rounded transition-colors duration-200"
          :class="{ 'text-theme-accent-blue bg-white/5': $route.path === '/profile', 'hover:bg-white/5': $route.path !== '/profile' }"
        >
          Profile
        </router-link>
        <router-link
          to="/leaderboard"
          class="p-2 rounded transition-colors duration-200"
          :class="{ 'text-theme-accent-blue bg-white/5': $route.path === '/leaderboard', 'hover:bg-white/5': $route.path !== '/leaderboard' }"
        >
          Leaderboard
        </router-link>
      </nav>
    </header>

    <!-- Main Content Area (takes remaining space) -->
    <main
      class="flex-1"
      :style="{ paddingTop: `${headerHeight}px` }"
    >
      <router-view />
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
    margin-top: -25px !important;
}
</style>