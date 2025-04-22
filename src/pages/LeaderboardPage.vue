<template>
  <div class="iframe-container h-full">
    <iframe src="https://killfeed.sinfulshadows.com/leaderboard" class="w-full h-full border-none" title="Leaderboard"></iframe>
  </div>
</template>

<script setup lang="ts">
// No script logic needed
</script>

<style scoped>
.iframe-container {
  /* Container takes full height from parent */
}
.iframe-container iframe {
  display: block; /* Remove potential extra space below iframe */
}
</style>