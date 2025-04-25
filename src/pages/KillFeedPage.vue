<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import KillFeed from '../components/KillFeed.vue'

const pageTitle = ref<string>('Kill Feed')
</script>

<template>
  <div class="page-container">
    
    <main class="page-content">
      <KillFeed />
    </main>
  </div>
</template>

<style scoped>
.page-container {
  display: flex;
  flex-direction: column;
  height: 100vh; /* Use viewport height */
  width: 100%;
  margin: 0;
  padding: 0;
  overflow: hidden;
}

.page-header {
  padding: 15px 20px;
  background-color: #2a2d31;
  border-bottom: 1px solid #333;
}

.page-header h1 {
  margin: 0;
  color: #e74c3c;
  font-size: 1.6em;
  font-weight: 500;
}

.page-content {
  flex: 1;
  padding: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  min-height: 0; /* Critical for nested flex scrolling */
}
</style>