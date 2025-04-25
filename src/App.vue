<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import Navigation from './components/Navigation.vue'
import KillFeedPage from './pages/KillFeedPage.vue'

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
    let lastPage = await window.logMonitorApi.getLastActivePage()
    // Default to kill-feed if the last page was the removed settings page
    if (lastPage === 'settings') {
      lastPage = 'kill-feed';
      window.logMonitorApi.setLastActivePage('kill-feed'); // Update stored preference
    }
    if (lastPage) {
      activePage.value = lastPage
    }
  } catch (error) {
    console.error('Failed to get last active page:', error)
  }
})

const changePage = (page: string) => {
  // Prevent changing to the removed settings page
  if (page === 'settings') {
    console.warn("Attempted to navigate to removed 'settings' page. Ignoring.");
    return;
  }
  activePage.value = page
  window.logMonitorApi.setLastActivePage(page)
    .catch(error => console.error('Failed to save active page preference:', error))
}

// Listener for page change requests from the main process (via tray menu)
const handlePageChange = (_event: Electron.IpcRendererEvent, page: unknown) => {
  // Prevent changing to the removed settings page via IPC
  if (page && typeof page === 'string' && page !== 'settings') {
    changePage(page);
  } else if (page === 'settings') {
     console.warn("Received request to change to removed 'settings' page via IPC. Ignoring.");
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
  <div class="flex flex-col h-screen w-screen overflow-hidden bg-theme-bg-dark text-theme-text-light">
    <!-- Center Section (Navigation) -->
    <div class="flex-grow flex justify-center">
      <Navigation :activePage="activePage" @change-page="changePage" />
    </div>

    <!-- Page content -->
    <main class="flex-1">
      <KillFeedPage v-if="activePage === 'kill-feed'" />
    </main>
  </div>
</template>

<style>
/* Make the title bar draggable */
.nav-container {
  height: 65px !important;
}

.app-title.cet-drag-region {
  top: 15px;
  left: 8px;
  margin-bottom: 20px;
  height: 75px;
}

.cet-container {
  position: relative !important;
  top: 0 !important;
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

.title-bar {
  -webkit-app-region: drag;
  user-select: none;
}

.window-controls {
  -webkit-app-region: no-drag;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  height: 100%;
  padding: 0 0.5rem;
}

.window-controls button,
.title-bar .flex-grow a {
  -webkit-app-region: no-drag;
}

.window-controls button {
  background: transparent;
  border: none;
  border-radius: 0.25rem;
  padding: 0.25rem 0.5rem;
  color: var(--color-theme-text-light);
  transition: background-color 0.2s ease;
}

.window-controls button:hover {
  background-color: rgba(255, 255, 255, 0.1);
}

.window-controls button.close-button:hover {
  background-color: rgb(220, 38, 38);
  color: var(--color-theme-text-white);
}

::-webkit-scrollbar {
  width: 0.5rem;
  height: 0.5rem;
}

::-webkit-scrollbar-track {
  background-color: var(--color-theme-bg-dark);
}

::-webkit-scrollbar-thumb {
  background-color: var(--color-theme-bg-panel);
  border-radius: 0.25rem;
  border: 1px solid var(--color-theme-border);
}

::-webkit-scrollbar-thumb:hover {
  background-color: var(--color-theme-border);
}

body {
  margin: 0;
}
</style>
