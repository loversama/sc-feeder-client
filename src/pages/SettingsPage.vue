<script setup lang="ts">
import { ref } from 'vue'

const pageTitle = ref<string>('Settings Placeholder')

// Function to open the actual settings window
const openSettings = () => {
  if (window.logMonitorApi) {
    window.logMonitorApi.openSettingsWindow();
  } else {
    console.error('logMonitorApi not available to open settings window.');
    alert('Error: Cannot open settings window.');
  }
}
</script>

<template>
  <div class="page-container placeholder-container">
    <header class="page-header">
      <h1>{{ pageTitle }}</h1>
    </header>
    <main class="page-content">
      <p>Settings are now managed in a separate window.</p>
      <button @click="openSettings" class="action-button">Open Settings Window</button>
      <p>(You can also open Settings from the tray menu)</p>
    </main>
  </div>
</template>

<style scoped>
.placeholder-container {
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 100%;
  align-items: center; /* Center content */
  justify-content: center; /* Center content */
  text-align: center;
  background-color: #1e1e1e;
  color: #ddd;
}

.page-header {
  padding: 15px 20px;
  background-color: #1a1a1a;
  border-bottom: 1px solid #333;
  width: 100%; /* Make header full width */
  box-sizing: border-box; /* Include padding in width */
  text-align: left; /* Align header text left */
}

.page-header h1 {
  margin: 0;
  color: #2ecc71;
  font-size: 1.6em;
  font-weight: 500;
}

.page-content {
  padding: 40px;
}

.page-content p {
  margin-bottom: 20px;
  color: #bbb;
}

.action-button {
  background-color: #3498db;
  color: white;
  border: none;
  border-radius: 4px;
  padding: 10px 20px;
  cursor: pointer;
  transition: background-color 0.2s;
  font-size: 1em;
  margin-bottom: 15px;
}

.action-button:hover {
  background-color: #2980b9;
}
</style>