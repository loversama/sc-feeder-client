<template>
  <div v-if="isLoading" class="p-4">Loading profile content...</div>
  <div v-else-if="profileUrl" class="iframe-container h-full">
    <iframe :src="profileUrl" class="w-full h-full border-none" title="My Profile"></iframe>
  </div>
  <div v-else class="p-4 text-red-500">
    Could not load profile. Username not found.
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';

const username = ref<string | null>(null);
const isLoading = ref(true);

onMounted(async () => {
  try {
    // Ensure the API function exists before calling
    if (window.logMonitorApi && typeof window.logMonitorApi.getLastLoggedInUser === 'function') {
      username.value = await window.logMonitorApi.getLastLoggedInUser();
      console.log('Fetched username:', username.value);
    } else {
      console.error('logMonitorApi.getLastLoggedInUser is not available.');
    }
  } catch (error) {
    console.error('Failed to get last logged in user:', error);
  } finally {
    isLoading.value = false;
  }
});

const profileUrl = computed(() => {
  if (username.value) {
    return `https://killfeed.sinfulshadows.com/user/${encodeURIComponent(username.value)}`;
  }
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