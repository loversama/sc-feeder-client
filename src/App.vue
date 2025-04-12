<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import Navigation from './components/Navigation.vue'
import KillFeedPage from './pages/KillFeedPage.vue'
import DebugPage from './pages/DebugPage.vue'
import SettingsPage from './pages/SettingsPage.vue'

// --- Window Control Methods ---
const minimizeWindow = () => {
  window.logMonitorApi.windowMinimize();
}
const toggleMaximizeWindow = () => {
  window.logMonitorApi.windowToggleMaximize();
}
const closeWindow = () => {
  window.logMonitorApi.windowClose();
}

// --- Page Navigation ---
const activePage = ref<string>('kill-feed') // Default page

onMounted(async () => {
  try {
    const lastPage = await window.logMonitorApi.getLastActivePage()
    if (lastPage) {
      activePage.value = lastPage
    }
  } catch (error) {
    console.error('Failed to get last active page:', error)
  }
})

const changePage = (page: string) => {
  activePage.value = page
  window.logMonitorApi.setLastActivePage(page)
    .catch(error => console.error('Failed to save active page preference:', error))
}

// Listener for page change requests from the main process (via tray menu)
const handlePageChange = (_event: Electron.IpcRendererEvent, page: unknown) => {
  if (page && typeof page === 'string') {
    changePage(page);
  }
};

onMounted(() => {
  try {
    window.ipcRenderer.on('change-page', handlePageChange);
    console.log('Page change listener added.');
  } catch (err) {
    console.error('Error setting up page change listener:', err);
  }
});

onUnmounted(() => {
  try {
    window.ipcRenderer.removeListener('change-page', handlePageChange);
    console.log('Page change listener removed.');
  } catch (err) {
    console.error('Error removing page change listener:', err);
  }
  try {
     window.logMonitorApi.removeAllListeners();
     console.log('Called removeAllListeners.');
  } catch (err) {
     console.error('Error calling removeAllListeners:', err);
  }
});
</script>

<template>
  <!-- Right Section (Window Controls) -->
  <div class="window-controls
   flex items-center space-x-1 flex-shrink-0">
    <button @click="minimizeWindow" title="Minimize">
      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line></svg>
    </button>
    <button @click="toggleMaximizeWindow" title="Maximize/Restore">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect></svg>
    </button>
    <button @click="closeWindow" title="Close" class="close-button">
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
    </button>
  </div>

  <div class="app-container bg-theme-bg-dark text-theme-text-light">

    <!-- Custom Title Bar -->
    <div class="title-bar flex items-center justify-between h-12 px-2 bg-theme-bg-panel border-b border-theme-border">
      <!-- Left Section (Logo/Title) -->
      <div class="flex items-center space-x-2 flex-shrink-0">
        <!-- Placeholder for Logo -->
        <div class="w-6 h-6 bg-theme-accent-blue rounded-sm"></div>
        <span class="font-semibold text-theme-text-white">1</span>
      </div>
    </div>
      <!-- Center Section (Navigation) -->
      <div class="flex-grow flex justify-center">
        <Navigation :activePage="activePage" @change-page="changePage" />
      </div>


 

    <!-- Page content -->
    <main class="content-container flex-1"> <!-- Removed overflow-auto and p-4 -->
      <KillFeedPage v-if="activePage === 'kill-feed'" />
      <DebugPage v-else-if="activePage === 'debug'" />
      <SettingsPage v-else-if="activePage === 'settings'" />
    </main>
  </div>
</template>

<style>
/* Make the title bar draggable */
.title-bar {
  -webkit-app-region: drag;
  user-select: none; /* Prevent text selection */
}

.window-controls {
  -webkit-app-region: no-drag; /* Prevent dragging on controls */
  display: flex;
  align-items: center;
  justify-content: flex-end;
  height: 100%;
  padding: 0 8px;

}

/* Make controls non-draggable */
.window-controls
 button,
.title-bar .flex-grow a /* Ensure nav links are clickable */ {
  -webkit-app-region: no-drag;
}

/* Basic styling for window controls */
.window-controls button {
  background: none;
  border: none;
  padding: 4px 8px;
  color: theme('colors.theme-text-light');
  border-radius: 4px;
  transition: background-color 0.2s ease;
}

.window-controls button:hover {
  background-color: rgba(255, 255, 255, 0.1);
}
.window-controls button.close-button:hover {
  background-color: theme('colors.red.600'); /* Use Tailwind red for close hover */
  color: theme('colors.theme-text-white');
}

/* Ensure app container fills the viewport */
.app-container {
  display: flex;
  flex-direction: column;
  height: 100vh;
  width: 100vw;
  overflow: hidden; /* Prevent body scrollbars */
}

/* Scrollbar styling */
::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}

::-webkit-scrollbar-track {
  background: theme('colors.theme-bg-dark');
}

::-webkit-scrollbar-thumb {
  background: theme('colors.theme-bg-panel');
  border-radius: 5px;
  border: 1px solid theme('colors.theme-border');
}

::-webkit-scrollbar-thumb:hover {
  background: theme('colors.theme-border');
}

/* Remove default body margin added by some browsers */
body {
  margin: 0;
}
</style>
