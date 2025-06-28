<script setup lang="ts">
import { ref } from 'vue'

const isLoading = ref<boolean>(false)
const statusMessage = ref<string>('')

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
    setTimeout(() => { statusMessage.value = ''; }, 5000);
  }
}

const handleResetEvents = async () => {
  isLoading.value = true;
  statusMessage.value = 'Resetting kill events...';
  try {
    const success = await window.logMonitorApi.resetEvents();
    statusMessage.value = success ? 'Kill events reset successfully.' : 'Failed to reset events.';
  } catch (error: any) {
    console.error('Error resetting events:', error);
    statusMessage.value = `Error resetting events: ${error.message}`;
  } finally {
    isLoading.value = false;
    setTimeout(() => { statusMessage.value = ''; }, 5000);
  }
}

const handleRescanLog = async () => {
  isLoading.value = true;
  statusMessage.value = 'Rescanning log file... This may take a moment.';
  try {
    const success = await window.logMonitorApi.rescanLog();
    if (!success) {
       statusMessage.value = 'Failed to initiate log rescan.';
       setTimeout(() => { statusMessage.value = ''; }, 5000);
    } else {
        statusMessage.value = 'Log rescan initiated...';
    }
  } catch (error: any) {
    console.error('Error rescanning log:', error);
    statusMessage.value = `Error rescanning log: ${error.message}`;
    setTimeout(() => { statusMessage.value = ''; }, 5000);
  } finally {
    // Loading managed by main process
  }
}

// --- Update Simulation Handlers ---
const handleSimulateUpdate = () => {
  window.logMonitorApi.debugSimulateUpdateAvailable();
  statusMessage.value = 'Update simulation started - check main window for update notification!';
  setTimeout(() => { statusMessage.value = ''; }, 3000);
}

const handleSimulateDownload = () => {
  window.logMonitorApi.debugSimulateUpdateDownload();
  statusMessage.value = 'Simulating update download in main window...';
  setTimeout(() => { statusMessage.value = ''; }, 3000);
}

const handleSimulateError = () => {
  window.logMonitorApi.debugSimulateUpdateError();
  statusMessage.value = 'Simulated an update error in main window';
  setTimeout(() => { statusMessage.value = ''; }, 3000);
}

const handleStopSimulation = () => {
  window.logMonitorApi.debugResetUpdateSimulation();
  statusMessage.value = 'Update simulation stopped and reset';
  setTimeout(() => { statusMessage.value = ''; }, 3000);
}

const handleSimulateInstall = () => {
  // Trigger download first, which will automatically complete
  window.logMonitorApi.debugSimulateUpdateDownload();
  statusMessage.value = 'Simulating download then install in main window...';
  setTimeout(() => { statusMessage.value = ''; }, 3000);
}

const handleCheckForUpdate = () => {
  window.logMonitorApi.debugSimulateUpdateChecking();
  statusMessage.value = 'Simulating update check in main window...';
  setTimeout(() => { statusMessage.value = ''; }, 3000);
}
</script>

<template>
  <div class="debug-container">
    <!-- Status Message -->
    <div 
      v-if="statusMessage" 
      class="status-message"
      :class="statusMessage.toLowerCase().includes('error') || statusMessage.toLowerCase().includes('failed')
        ? 'status-error'
        : 'status-info'"
    >
      {{ statusMessage }}
    </div>

    <!-- Log & Data Actions -->
    <div class="section">
      <h4 class="section-title">
        <div class="section-indicator"></div>
        Log & Data Actions
      </h4>
      
      <div class="button-grid button-grid-3">
        <el-button 
          @click="handleResetSessions" 
          :disabled="isLoading" 
          type="warning"
          class="debug-button"
        >
          <template #icon>
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path>
            </svg>
          </template>
          Reset Sessions
        </el-button>
        
        <el-button 
          @click="handleResetEvents" 
          :disabled="isLoading" 
          type="warning"
          class="debug-button"
        >
          <template #icon>
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
            </svg>
          </template>
          Reset Events
        </el-button>
        
        <el-button 
          @click="handleRescanLog" 
          :disabled="isLoading" 
          type="info"
          class="debug-button"
        >
          <template #icon>
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
            </svg>
          </template>
          Rescan Log File
        </el-button>
      </div>
      
      <p class="section-note">
        <strong>Rescan Log:</strong> Clears current events/sessions and re-reads the entire Game.log file. Use if data seems incorrect.
      </p>
    </div>

    <!-- Update Simulation -->
    <div class="section">
      <h4 class="section-title">
        <div class="section-indicator blue"></div>
        Update System Testing
      </h4>
      
      <div class="button-grid button-grid-3">
        <el-button 
          @click="handleCheckForUpdate" 
          type="info"
          class="debug-button"
        >
          <template #icon>
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path>
            </svg>
          </template>
          Check for Update
        </el-button>
        
        <el-button 
          @click="handleSimulateUpdate" 
          type="primary"
          class="debug-button"
        >
          <template #icon>
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path>
            </svg>
          </template>
          Simulate Update
        </el-button>
        
        <el-button 
          @click="handleSimulateDownload" 
          type="success"
          class="debug-button"
        >
          <template #icon>
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 19l3 3m0 0l3-3m-3 3V10"></path>
            </svg>
          </template>
          Simulate Download
        </el-button>
      </div>
      
      <div class="button-grid button-grid-3">
        <el-button 
          @click="handleSimulateInstall" 
          type="warning"
          class="debug-button"
        >
          <template #icon>
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"></path>
            </svg>
          </template>
          Simulate Install
        </el-button>
        
        <el-button 
          @click="handleSimulateError" 
          type="danger"
          class="debug-button"
        >
          <template #icon>
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
            </svg>
          </template>
          Simulate Error
        </el-button>
        
        <el-button 
          @click="handleStopSimulation" 
          type="info"
          class="debug-button"
        >
          <template #icon>
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
            </svg>
          </template>
          Stop & Reset
        </el-button>
      </div>
      
      <div class="guide-box">
        <h5 class="guide-title">Update Simulation Guide:</h5>
        <ul class="guide-list">
          <li><strong>1. Simulate Update:</strong> Shows "update available" notification</li>
          <li><strong>2. Start Download:</strong> Simulates download progress with realistic speed/size</li> 
          <li><strong>3. Simulate Error:</strong> Tests error handling and display</li>
          <li><strong>4. Stop & Reset:</strong> Clears all simulation state</li>
        </ul>
        <p class="guide-note">
          Watch the update notification in the top-right corner of the main window and the compact version in the events window!
        </p>
      </div>
      
      <div class="guide-box">
        <h5 class="guide-title">Simulation Status:</h5>
        <p class="guide-note">
          Update simulations now affect the main application window directly! Check the main window for the update notifications, progress bars, and buttons we built.
        </p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.debug-container {
  display: flex;
  flex-direction: column;
  gap: 2rem;
}

.status-message {
  padding: 1rem;
  border-radius: 0.5rem;
  font-size: 0.875rem;
  font-weight: 500;
  transition: all 0.3s ease;
  border: 1px solid;
}

.status-info {
  background-color: rgba(30, 58, 138, 0.3);
  color: rgb(96, 165, 250);
  border-color: rgba(59, 130, 246, 0.3);
}

.status-error {
  background-color: rgba(127, 29, 29, 0.3);
  color: rgb(248, 113, 113);
  border-color: rgba(239, 68, 68, 0.3);
}

.section {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.section-title {
  font-size: 1.125rem;
  font-weight: 600;
  color: white;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.section-indicator {
  width: 0.25rem;
  height: 1.5rem;
  background-color: rgb(249, 115, 22);
  border-radius: 9999px;
}

.section-indicator.blue {
  background-color: rgb(59, 130, 246);
}

.button-grid {
  display: grid;
  gap: 1rem;
  grid-template-columns: 1fr;
}

.button-grid-3 {
  grid-template-columns: repeat(3, 1fr);
}

.button-grid-4 {
  grid-template-columns: repeat(4, 1fr);
}

@media (max-width: 1024px) {
  .button-grid-3 {
    grid-template-columns: repeat(2, 1fr);
  }
  .button-grid-4 {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (max-width: 640px) {
  .button-grid-3,
  .button-grid-4 {
    grid-template-columns: 1fr;
  }
}

.section-note {
  font-size: 0.875rem;
  color: rgb(156, 163, 175);
  background-color: rgba(31, 41, 55, 0.5);
  padding: 0.75rem;
  border-radius: 0.25rem;
  border-left: 4px solid rgb(107, 114, 128);
}

.guide-box {
  background-color: rgba(30, 58, 138, 0.2);
  border: 1px solid rgba(59, 130, 246, 0.3);
  border-radius: 0.5rem;
  padding: 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.guide-title {
  font-weight: 600;
  color: rgb(147, 197, 253);
}

.guide-list {
  font-size: 0.875rem;
  color: rgb(191, 219, 254);
  margin-left: 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.guide-note {
  font-size: 0.75rem;
  color: rgb(147, 197, 253);
  margin-top: 0.5rem;
}

.state-display {
  background-color: rgba(31, 41, 55, 0.5);
  border-radius: 0.5rem;
  padding: 1rem;
}

.state-title {
  font-weight: 600;
  color: rgb(209, 213, 219);
  margin-bottom: 0.5rem;
}

.state-grid {
  font-size: 0.875rem;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.state-row {
  display: flex;
  justify-content: space-between;
}

.state-label {
  color: rgb(156, 163, 175);
}

.state-value {
  font-family: ui-monospace, monospace;
  color: white;
}

.state-checking {
  color: rgb(96, 165, 250) !important;
}

.state-available {
  color: rgb(251, 146, 60) !important;
}

.state-downloading {
  color: rgb(96, 165, 250) !important;
}

.state-ready {
  color: rgb(74, 222, 128) !important;
}

.state-error {
  color: rgb(248, 113, 113) !important;
  font-size: 0.75rem;
}

.state-idle {
  color: rgb(156, 163, 175) !important;
}

.debug-button {
  min-height: 44px;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  transition: all 0.2s ease;
}

.debug-button:hover {
  transform: scale(1.05);
}

.debug-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* Element Plus button overrides for dark theme */
:deep(.el-button) {
  border: none;
  font-weight: 500;
  font-size: 0.875rem;
}

:deep(.el-button--primary) {
  background-color: rgb(37, 99, 235);
  color: white;
}

:deep(.el-button--primary:hover) {
  background-color: rgb(59, 130, 246);
}

:deep(.el-button--success) {
  background-color: rgb(22, 163, 74);
  color: white;
}

:deep(.el-button--success:hover) {
  background-color: rgb(34, 197, 94);
}

:deep(.el-button--warning) {
  background-color: rgb(234, 88, 12);
  color: white;
}

:deep(.el-button--warning:hover) {
  background-color: rgb(249, 115, 22);
}

:deep(.el-button--danger) {
  background-color: rgb(220, 38, 38);
  color: white;
}

:deep(.el-button--danger:hover) {
  background-color: rgb(239, 68, 68);
}

:deep(.el-button--info) {
  background-color: rgb(75, 85, 99);
  color: white;
}

:deep(.el-button--info:hover) {
  background-color: rgb(107, 114, 128);
}

:deep(.el-button.is-disabled) {
  background-color: rgb(55, 65, 81);
  color: rgb(156, 163, 175);
  cursor: not-allowed;
}
</style>