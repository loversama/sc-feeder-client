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

const openSettingsWindow = () => {
  try {
    window.logMonitorApi.openSettingsWindow();
  } catch (error) {
    console.error("Failed to open settings window:", error);
  }
}
</script>

<template>
  <nav class="nav-container">
    <div class="nav-draggable cet-drag-region"> <!-- Keep drag region here -->
      <div class="app-title"> <!-- Title text container -->
        SC Kill Feed
        <span class="settings-icon" @click.stop="openSettingsWindow" title="Open Settings">
          ⚙️
        </span>
      </div>
    </div>
    <div class="nav-buttons">
      <!-- <button 
        @click="changePage('kill-feed')" 
        class="nav-button"
        :class="{ active: activePage === 'kill-feed' }"
      >
        <div class="icon">⚔️</div>
        <span>Kill Feed</span>
      </button>
       -->
      
    </div>
  </nav>
</template>

<style scoped>

.app-title {
    font-size: 1.2em;
    font-weight: 600;
    color: #e74c3c;
    margin-left: 10px;
    font-size: 30px !important;
    margin-top: 1cqmin; 
}

.app-title.cet-drag-region {
  height: 50px;
  width: 80%;
}

/* Removed old .settings-icon styles */

.cet-drag-region {
    top: 0;
    left: 0;
    display: block;
    position: absolute;
    width: 100%; /* Restore */
    height: 25px; /* Restore */
    z-index: -1; /* Restore */
    -webkit-app-region: drag;
}

/* Style for Unicode cog icon */
.settings-icon {
  margin-left: 10px; /* Space between title and icon */
  font-size: 0.8em; /* Adjust size relative to title */
  color: white; /* White color */
  cursor: pointer;
  transition: color 0.2s ease;
  -webkit-app-region: no-drag; /* Make icon clickable */
  vertical-align: middle; /* Align icon better with text */
}

.settings-icon:hover {
  color: #ccc; /* Lighter grey on hover */
}

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

.nav-draggable {
  display: flex;
  width:80vw;
  height:50px;
  /* Reverted: Ensure no -webkit-app-region: drag here */
}

/* Restore duplicate .app-title block */
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
  margin-right: 20px;
  left: 20px;
  top: 50%;
  font-size: 1.1em;
}

span.settings-icon {
    position: absolute;
    bottom: 1px;
    left: 167px;
    color: white !important;
}
</style>