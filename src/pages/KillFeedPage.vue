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
  height: 100%;
  width: 100%;
  margin: 0;
  padding: 0;
  overflow: hidden;
}

.page-header {
  padding: 15px 20px;
  background-color: #1a1a1a;
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
  padding: 0; /* Remove padding to allow full-width components */
  overflow: hidden; /* Prevent nested scrollbars */
  display: flex; /* Add flex display */
  flex-direction: column; /* Stack children vertically */
}
</style>