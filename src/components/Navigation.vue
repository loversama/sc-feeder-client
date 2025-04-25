<script setup lang="ts">
import { defineProps, defineEmits } from 'vue' // Removed ref import

const props = defineProps<{
  activePage: string
}>()

const emit = defineEmits<{
  (e: 'change-page', page: string): void
  // Removed profile/leaderboard emits
}>()

const changePage = (page: string) => {
  emit('change-page', page)
}

// Removed openSettingsWindow function
// Removed openProfile and openLeaderboard functions
// Removed local state refs (isSettingsActive, etc.)
</script>

<template>
  <nav class="nav-container p-2 bg-theme-bg-panel shadow"> <!-- Added styles -->
    <div class="nav-draggable cet-drag-region"> <!-- Keep drag region here -->
      <div class="app-title"> <!-- Title text container -->
        SC Kill Feed
        <!-- Removed settings icon -->
      </div>
    </div>
    <!-- Removed nav-buttons div and its content -->
    <div class="nav-buttons">
       <!-- Original commented out button example (optional to keep) -->
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
/* Restored original styles from before icon additions */
.app-title {
    font-size: 1.2em;
    font-weight: 600;
    color: #e74c3c;
    margin-left: 10px;
    /* Removed font-size: 30px !important; */
    /* Removed margin-top: 1cqmin; */
}

.app-title.cet-drag-region {
  height: 50px;
  width: 80%;
}

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

/* Removed settings icon styles */

.nav-container {
  display: flex;
  background-color: #121212;
  border-bottom: 1px solid #333;
  padding: 0 10px;
  /* Removed fixed height: 50px; Let padding and content determine height */
  align-items: center;
  /* Removed justify-content: space-between */
  user-select: none;
  margin: 0;
  width: 100%;
}

.nav-draggable {
  display: flex;
  width:80vw;
  height:50px;
}

/* Removed duplicate .app-title block */
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
  margin-right: 20px; /* Restored original */
  left: 20px;
  top: 50%;
  font-size: 1.1em;
}

/* Removed settings icon positioning styles */

/* Removed .nav-left */
/* Removed .icon-button styles */
/* Removed .icon-button.active styles */
</style>