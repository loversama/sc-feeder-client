<template>
  <div v-if="isLoading" class="p-4">Loading authentication token...</div>
  <div v-else-if="webAppUrl" class="iframe-container h-full">
    <iframe :src="webAppUrl" class="w-full h-full border-none" title="KillFeed Web App - Profile"></iframe>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';

const accessToken = ref<string | null>(null);
const lastUsername = ref<string | null>(null); // Add ref for username
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

  // Always try to get username if we might need it for guest mode (either no token or fetch failed)
  if (!accessToken.value) {
    try {
      if (window.logMonitorApi && typeof window.logMonitorApi.getLastLoggedInUser === 'function') {
        lastUsername.value = await window.logMonitorApi.getLastLoggedInUser();
        console.log('Fetched last username for guest mode:', lastUsername.value);
      } else {
        console.error('logMonitorApi.getLastLoggedInUser is not available.');
        lastUsername.value = null;
      }
    } catch (userError) {
       console.error('Error fetching last username for guest mode:', userError);
       lastUsername.value = null;
    }
  }

  // Loading is complete after attempting token and potentially username fetch
  isLoading.value = false;
});

// Computed property for the final iframe URL
const webAppUrl = computed(() => {
  if (accessToken.value) {
    // Construct the client-init URL with the token
    const initUrl = new URL('/auth/client-init', webAppBaseUrl);
    initUrl.searchParams.set('token', accessToken.value);
    // Append the original target path (profile) as a hash or query param if needed by the web app
    // For now, just redirecting to client-init which should handle session and redirect
    // If the web app needs to know the target, adjust here:
    // initUrl.hash = '#profile'; // Example if using hash routing on web app side
    return initUrl.toString();
  }
  // If no token (guest user), construct the user profile URL
  if (lastUsername.value) {
    return `${webAppBaseUrl}/user/${lastUsername.value}`;
  } else {
    // Fallback if username couldn't be fetched (or handle this case differently?)
    // Maybe return a generic page or an error indicator? For now, return base URL.
    console.warn('No last username available for guest profile view.');
    // Returning null will prevent the iframe from loading until username is available or handled
    return null; // Or return a specific fallback URL like `${webAppBaseUrl}/`
  }
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