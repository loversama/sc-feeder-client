<template>
  <div v-if="isLoading" class="p-4">Loading authentication token...</div>
  <div v-else-if="webAppUrl" class="iframe-container h-full">
    <iframe :src="webAppUrl" class="w-full h-full border-none" title="KillFeed Web App - Leaderboard"></iframe>
  </div>
  <div v-else class="p-4 text-red-500">
    Could not load web application. Authentication token not available. Please log in via Settings.
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';

const accessToken = ref<string | null>(null);
const isLoading = ref(true);
const webAppBaseUrl = 'https://killfeed.sinfulshadows.com'; // Define base URL

onMounted(async () => {
  isLoading.value = true; // Ensure loading state is true initially
  try {
    // Ensure the API function exists before calling
    if (window.logMonitorApi && typeof window.logMonitorApi.authGetAccessToken === 'function') {
      accessToken.value = await window.logMonitorApi.authGetAccessToken();
      console.log('Fetched access token:', accessToken.value ? 'Token received' : 'No token');
    } else {
      console.error('logMonitorApi.authGetAccessToken is not available.');
      accessToken.value = null; // Ensure token is null if API is missing
    }
  } catch (error) {
    console.error('Failed to get access token:', error);
    accessToken.value = null; // Ensure token is null on error
  } finally {
    isLoading.value = false;
  }
});

// Computed property for the final iframe URL
const webAppUrl = computed(() => {
  if (accessToken.value) {
    // Construct the client-init URL with the token
    const initUrl = new URL('/auth/client-init', webAppBaseUrl);
    initUrl.searchParams.set('token', accessToken.value);
    // Append the original target path (leaderboard) as a hash or query param if needed by the web app
    // For now, just redirecting to client-init which should handle session and redirect
    // If the web app needs to know the target, adjust here:
    // initUrl.hash = '#leaderboard'; // Example if using hash routing on web app side
    return initUrl.toString();
  }
  // Return null if no token, the template will show an error message
  return null;
});
</script>

<style scoped>
.iframe-container {
  /* Container takes full height from parent */
}
.iframe-container iframe {
  display: block; /* Remove potential extra space below iframe */
}
</style>