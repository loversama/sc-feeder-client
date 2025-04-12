<script setup lang="ts">
import { ref, onMounted, onUnmounted, nextTick } from 'vue'

const pageTitle = ref<string>('Debug')
const logContent = ref<string>('')
const statusMessage = ref<string>('')
const logDisplayRef = ref<HTMLTextAreaElement | null>(null)
const currentPath = ref<string>('Loading...')
const isLoading = ref<boolean>(false) // For showing loading state during actions

let cleanupFunctions: (() => void)[] = []

// Function to scroll the textarea to the bottom
const scrollToBottom = () => {
  nextTick(() => {
    if (logDisplayRef.value) {
      logDisplayRef.value.scrollTop = logDisplayRef.value.scrollHeight
    }
  })
}

// Fetches the initial path from main process
const updateLogPath = async () => {
  try {
    currentPath.value = await window.logMonitorApi.getLogPath()
  } catch (error) {
    console.error('Failed to get log path:', error)
    statusMessage.value = 'Error: Could not fetch initial log path.'
  }
}

// --- Debug Action Handlers ---
const handleResetSessions = async () => {
  isLoading.value = true;
  statusMessage.value = 'Resetting sessions...';
  try {
    const success = await window.logMonitorApi.resetSessions();
    statusMessage.value = success ? 'Sessions reset successfully.' : 'Failed to reset sessions.';
  } catch (error: any) {
    console.error('Error resetting sessions:', error);
    statusMessage.value = `Error resetting sessions: ${error.message}`;
  } finally {
    isLoading.value = false;
  }
}

const handleResetEvents = async () => {
  isLoading.value = true;
  statusMessage.value = 'Resetting kill events...';
  try {
    const success = await window.logMonitorApi.resetEvents();
    statusMessage.value = success ? 'Kill events reset successfully.' : 'Failed to reset events.';
    // Note: UI update for kill feed happens via main process sending null event
  } catch (error: any) {
    console.error('Error resetting events:', error);
    statusMessage.value = `Error resetting events: ${error.message}`;
  } finally {
    isLoading.value = false;
  }
}

const handleRescanLog = async () => {
  isLoading.value = true;
  statusMessage.value = 'Rescanning log file... This may take a moment.';
  logContent.value = '--- Rescanning Log File ---\n'; // Clear current display immediately
  try {
    const success = await window.logMonitorApi.rescanLog();
    // Status message will be updated by main process via onLogStatus
    if (!success) {
       statusMessage.value = 'Failed to initiate log rescan.';
    }
  } catch (error: any) {
    console.error('Error rescanning log:', error);
    statusMessage.value = `Error rescanning log: ${error.message}`;
  } finally {
    isLoading.value = false; // Main process will send completion status
  }
}
// ---------------------------


onMounted(() => {
  // Get initial path
  updateLogPath()

  // Setup listeners and store cleanup functions
  cleanupFunctions.push(
    window.logMonitorApi.onLogUpdate((_event, content) => {
      logContent.value += content
      scrollToBottom() // Scroll down when new content arrives
    })
  )

  cleanupFunctions.push(
    window.logMonitorApi.onLogReset(() => {
      // Clear log content when main process signals a reset (e.g., during rescan or truncation)
      logContent.value = '--- Log file reset detected ---\n'
      statusMessage.value = 'Log file reset or truncated.'
      scrollToBottom()
    })
  )

  cleanupFunctions.push(
    window.logMonitorApi.onLogStatus((_event, status) => {
      statusMessage.value = status
    })
  )

  cleanupFunctions.push(
    window.logMonitorApi.onLogPathUpdated((_event, newPath) => {
      currentPath.value = newPath
      logContent.value = '' // Clear logs when path changes
      statusMessage.value = `Monitoring new path: ${newPath}`
    })
  )
  
  // Initial load might involve getting full log content if desired,
  // but currently relies on main process sending initial content via log-update
  // after startWatchingLogFile -> readNewLogContent.
  // The "Rescan Log" button now provides the explicit way to reload everything.
})

onUnmounted(() => {
  // Clean up all listeners when the component is destroyed
  console.log('Cleaning up listeners...')
  cleanupFunctions.forEach(cleanup => cleanup())
})
</script>

<template>
  <div class="page-container">
    <header class="page-header">
      <h1>{{ pageTitle }}</h1>
    </header>
    
    <main class="page-content">
      <p class="current-path">Currently monitoring: <code>{{ currentPath }}</code></p>
      
      <div class="status-area">
        <strong>Status:</strong> {{ statusMessage || 'Waiting for logs...' }}
        <span v-if="isLoading" class="loading-indicator"> (Working...)</span>
      </div>

      <!-- Debug Actions Section -->
      <section class="debug-actions">
        <h2>Actions</h2>
        <div class="action-buttons">
          <button @click="handleResetSessions" :disabled="isLoading" class="action-button reset-button">
            Reset Sessions
          </button>
          <button @click="handleResetEvents" :disabled="isLoading" class="action-button reset-button">
            Reset Events
          </button>
          <button @click="handleRescanLog" :disabled="isLoading" class="action-button rescan-button">
            Rescan Log File
          </button>
        </div>
         <p class="action-hint">
           Rescan Log clears current events/sessions and re-reads the entire Game.log file.
         </p>
      </section>
      
      <div class="log-display">
        <label for="logOutput">Log Output:</label>
        <textarea id="logOutput" ref="logDisplayRef" readonly v-model="logContent"></textarea>
      </div>
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
  background-color: #1e1e1e;
  color: #ddd;
}

.page-header {
  padding: 15px 20px;
  background-color: #1a1a1a;
  border-bottom: 1px solid #333;
}

.page-header h1 {
  margin: 0;
  color: #3498db; /* Blue title for Debug */
  font-size: 1.6em;
  font-weight: 500;
}

.page-content {
  flex: 1;
  padding: 15px; /* Slightly reduced padding */
  display: flex;
  flex-direction: column;
  overflow: hidden; /* Prevent scrollbars on the entire page */
}

.current-path {
  font-size: 0.9em;
  color: #aaa;
  margin-bottom: 10px;
  word-break: break-all; /* Break long paths */
}

.current-path code {
  background-color: #333;
  padding: 2px 5px;
  border-radius: 3px;
}

.status-area {
  margin-bottom: 15px;
  padding: 10px 15px;
  background-color: #2a2a2a;
  border: 1px solid #444;
  border-radius: 4px;
  color: #bbb;
  min-height: 1.5em; /* Ensure it has some height even when empty */
  font-size: 0.9em;
}

.loading-indicator {
  font-style: italic;
  color: #888;
}

.debug-actions {
  margin-bottom: 15px;
  padding: 15px;
  background-color: #252526;
  border: 1px solid #333;
  border-radius: 6px;
}

.debug-actions h2 {
  margin-top: 0;
  margin-bottom: 15px;
  font-size: 1.2em;
  color: #ccc;
  border-bottom: 1px solid #444;
  padding-bottom: 8px;
  font-weight: 400;
}

.action-buttons {
  display: flex;
  gap: 10px; /* Spacing between buttons */
  flex-wrap: wrap;
}

.action-button {
  color: white;
  border: none;
  border-radius: 4px;
  padding: 8px 16px;
  cursor: pointer;
  transition: background-color 0.2s, opacity 0.2s;
  font-size: 0.9em;
}
.action-button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.reset-button {
  background-color: #e74c3c; /* Red for reset actions */
}
.reset-button:hover:not(:disabled) {
  background-color: #c0392b;
}

.rescan-button {
   background-color: #f39c12; /* Orange for rescan */
}
.rescan-button:hover:not(:disabled) {
  background-color: #e67e22;
}

.action-hint {
  font-size: 0.85em;
  color: #888;
  margin-top: 10px;
  margin-bottom: 0;
}


.log-display {
  flex-grow: 1;
  display: flex;
  flex-direction: column;
  min-height: 200px; /* Ensure it takes up space */
  overflow: hidden; /* Prevent scrollbars on the container */
  margin-top: 10px; /* Add some space above log */
}

.log-display label {
  margin-bottom: 8px;
  font-weight: bold;
  color: #bbb;
}

.log-display textarea {
  flex-grow: 1;
  width: 100%;
  box-sizing: border-box;
  border: 1px solid #555;
  background-color: #1e1e1e;
  color: #d4d4d4;
  font-family: monospace;
  font-size: 0.9em;
  padding: 10px;
  resize: none;
  white-space: pre;
  overflow-wrap: normal;
  overflow-x: auto; /* Only horizontal scroll */
  overflow-y: scroll; /* Vertical scroll always */
}

/* Style scrollbars for webkit browsers */
textarea::-webkit-scrollbar {
  width: 10px;
  height: 10px;
}

textarea::-webkit-scrollbar-track {
  background: #333;
}

textarea::-webkit-scrollbar-thumb {
  background: #666;
  border-radius: 5px;
}

textarea::-webkit-scrollbar-thumb:hover {
  background: #888;
}
</style>