<template>
  <div v-if="isLoading" class="p-4">Loading authentication token...</div>
  <div v-else-if="webAppUrl" class="iframe-container h-full">
    <iframe :src="webAppUrl" class="w-full h-full border-none" title="KillFeed Web App - Leaderboard"></iframe>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';

const accessToken = ref<string | null>(null);
const isLoading = ref(true);
const webAppBaseUrl = 'https://killfeed.sinfulshadows.com'; // Define base URL

onMounted(async () => {
  isLoading.value = true;
  let fetchedToken: string | null = null;

  try {
    // Attempt to fetch access token
    if (window.logMonitorApi && typeof window.logMonitorApi.authGetAccessToken === 'function') {
      fetchedToken = await window.logMonitorApi.authGetAccessToken();
      console.log('Attempted to fetch access token:', fetchedToken ? 'Token received' : 'No token');
    } else {
      console.error('logMonitorApi.authGetAccessToken is not available.');
    }
  } catch (error) {
    console.error('Error fetching access token, falling back to guest mode:', error);
    fetchedToken = null; // Ensure token is null on error
  }

  // Assign the potentially fetched token
  accessToken.value = fetchedToken;

  // Loading is complete after attempting token fetch
  isLoading.value = false;
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
  // If no token (or fetch failed), return the public leaderboard URL
  return `${webAppBaseUrl}/leaderboard`;
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