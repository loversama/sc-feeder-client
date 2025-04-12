<script setup lang="ts">
import { ref } from 'vue'

const isLoading = ref<boolean>(false) // For showing loading state during actions
const statusMessage = ref<string>('') // Status specific to these actions

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
    // Clear status after a delay
    setTimeout(() => { statusMessage.value = ''; }, 5000);
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
    // Clear status after a delay
    setTimeout(() => { statusMessage.value = ''; }, 5000);
  }
}

const handleRescanLog = async () => {
  isLoading.value = true;
  statusMessage.value = 'Rescanning log file... This may take a moment.';
  // logContent.value = '--- Rescanning Log File ---\n'; // Log display is separate now
  try {
    const success = await window.logMonitorApi.rescanLog();
    // Status message will be updated by main process via onLogStatus listener elsewhere
    if (!success) {
       statusMessage.value = 'Failed to initiate log rescan.';
       setTimeout(() => { statusMessage.value = ''; }, 5000); // Clear error status
    } else {
        // Let the main process status update handle success message
        statusMessage.value = 'Log rescan initiated...'; // Provide immediate feedback
        // Don't clear success message here, let the main process update it
    }
  } catch (error: any) {
    console.error('Error rescanning log:', error);
    statusMessage.value = `Error rescanning log: ${error.message}`;
    setTimeout(() => { statusMessage.value = ''; }, 5000); // Clear error status
  } finally {
    // isLoading is managed by main process status updates for rescan completion
    // We might need a way to signal loading completion if main process doesn't provide a clear end state
  }
}
</script>

<template>
  <section class="debug-actions-section">
    <h2>Debugging Actions</h2>
    <div v-if="statusMessage" class="action-status-message" :class="{ 'error': statusMessage.toLowerCase().includes('error') || statusMessage.toLowerCase().includes('failed') }">
      {{ statusMessage }}
    </div>
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
       Rescan Log clears current events/sessions and re-reads the entire Game.log file. Use if data seems incorrect.
     </p>
  </section>
</template>

<!-- Styles removed previously for testing, can be added back if needed -->