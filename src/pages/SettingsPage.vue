<script setup lang="ts">
import { ref } from 'vue'

const pageTitle = ref<string>('Settings Placeholder')

// Function to open the actual settings window
const openSettings = () => {
  if (window.logMonitorApi) {
    window.logMonitorApi.openSettingsWindow();
  } else {
    console.error('logMonitorApi not available to open settings window.');
    alert('Error: Cannot open settings window.');
  }
}
</script>

<template>
  <div class="flex flex-col h-screen w-full overflow-hidden bg-theme-bg-dark text-theme-text-light">
    <!-- Mimic KillFeedPage structure: page-container -> page-content -->
    <main class="flex-1 overflow-auto flex flex-col items-center justify-center text-center p-4">
      <!-- Content is now centered within the main area -->
      <div class="p-10"> <!-- Added a wrapper for padding -->
        <h1 class="text-2xl font-semibold mb-6 text-theme-text-title">{{ pageTitle }}</h1>
        <p class="mb-5 text-theme-text-muted">Settings are now managed in a separate window.</p>
        <button @click="openSettings" class="bg-theme-accent hover:bg-theme-accent-hover text-white font-bold py-2 px-4 rounded transition duration-200 mb-4">
          Open Settings Window
        </button>
        <p class="text-sm text-theme-text-muted">(You can also open Settings from the tray menu)</p>
      </div>
    </main>
  </div>
</template>

<!-- Removed scoped styles, using Tailwind utilities now -->