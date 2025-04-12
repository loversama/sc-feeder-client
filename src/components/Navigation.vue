<script setup lang="ts">
import { defineProps, defineEmits } from 'vue'

const props = defineProps<{
  activePage: string
}>()

const emit = defineEmits<{
  (e: 'change-page', page: string): void
}>()

const changePage = (page: string) => {
  emit('change-page', page)
}
</script>

<template>
  <nav class="nav-container">
    <div class="app-title">SC Kill Feed</div>
    
    <div class="nav-buttons">
      <button 
        @click="changePage('kill-feed')" 
        class="nav-button"
        :class="{ active: activePage === 'kill-feed' }"
      >
        <div class="icon">⚔️</div>
        <span>Kill Feed</span>
      </button>
      
      
    </div>
  </nav>
</template>

<style scoped>
.nav-container {
  display: flex;
  background-color: #121212;
  border-bottom: 1px solid #333;
  padding: 0 10px;
  height: 50px;
  align-items: center;
  justify-content: space-between;
  user-select: none;
  margin: 0;
  width: 100%;
}

.app-title {
  font-size: 1.2em;
  font-weight: 600;
  color: #e74c3c;
  margin-left: 10px;
}

.nav-buttons {
  display: flex;
  height: 100%;
}

.nav-button {
  display: flex;
  align-items: center;
  background: none;
  border: none;
  color: #999;
  padding: 0 15px;
  height: 100%;
  cursor: pointer;
  font-size: 0.9em;
  transition: all 0.2s ease;
  position: relative;
}

.nav-button::after {
  content: '';
  position: absolute;
  bottom: 0;
  left: 0;
  width: 100%;
  height: 3px;
  background-color: transparent;
  transition: background-color 0.2s ease;
}

.nav-button.active {
  color: #ffffff;
}

.nav-button.active::after {
  background-color: #e74c3c;
}

.nav-button:hover {
  background-color: #1a1a1a;
}

.icon {
  margin-right: 8px;
  font-size: 1.1em;
}
</style>