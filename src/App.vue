<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import Navigation from './components/Navigation.vue'
import KillFeedPage from './pages/KillFeedPage.vue'
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



  <div class="app-container bg-theme-bg-dark text-theme-text-light">

      <!-- Center Section (Navigation) -->
      <div class="flex-grow flex justify-center top-nav">
        <Navigation :activePage="activePage" @change-page="changePage" />
      </div>


 

    <!-- Page content -->
    <main class="content-container flex-1"> <!-- Removed overflow-auto and p-4 -->
      <KillFeedPage v-if="activePage === 'kill-feed'" />
      <!-- <DebugPage v-else-if="activePage === 'debug'" /> --> <!-- Removed - Moved to Settings -->
      <SettingsPage v-else-if="activePage === 'settings'" />
    </main>
  </div>
</template>

<style>
/* Make the title bar draggable */

.nav-container {

    height: 75px !important;

}

.app-title.cet-drag-region {
  top: 15px;
  left:8px;
  margin-bottom:20px;
  height:75px;
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
