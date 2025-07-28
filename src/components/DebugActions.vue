<script setup lang="ts">
import { ref } from 'vue'

const isLoading = ref<boolean>(false)
const statusMessage = ref<string>('')
const activeTab = ref<string>('system') // Default to system tab

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

// --- Definitions Refresh Handlers ---
const handleRefreshDefinitions = async () => {
  isLoading.value = true;
  statusMessage.value = 'Force refreshing definitions from server...';
  try {
    const success = await window.logMonitorApi.forceRefreshDefinitions();
    if (success) {
      statusMessage.value = 'Definitions refreshed successfully! Kill feed entities will update with new names.';
    } else {
      statusMessage.value = 'Failed to refresh definitions from server.';
    }
  } catch (error: any) {
    console.error('Error refreshing definitions:', error);
    statusMessage.value = `Error refreshing definitions: ${error.message}`;
  } finally {
    isLoading.value = false;
    setTimeout(() => { statusMessage.value = ''; }, 8000);
  }
}

const handleRefreshNpcList = async () => {
  isLoading.value = true;
  statusMessage.value = 'Force refreshing NPC ignore list from server...';
  try {
    const success = await window.logMonitorApi.forceRefreshNpcList();
    if (success) {
      statusMessage.value = 'NPC ignore list refreshed successfully! Kill feed NPC tags will update.';
    } else {
      statusMessage.value = 'Failed to refresh NPC ignore list from server.';
    }
  } catch (error: any) {
    console.error('Error refreshing NPC list:', error);
    statusMessage.value = `Error refreshing NPC list: ${error.message}`;
  } finally {
    isLoading.value = false;
    setTimeout(() => { statusMessage.value = ''; }, 8000);
  }
}

const handleRefreshBoth = async () => {
  isLoading.value = true;
  statusMessage.value = 'Force refreshing definitions and NPC ignore list...';
  try {
    const [defSuccess, npcSuccess] = await Promise.all([
      window.logMonitorApi.forceRefreshDefinitions(),
      window.logMonitorApi.forceRefreshNpcList()
    ]);
    
    if (defSuccess && npcSuccess) {
      statusMessage.value = 'Both definitions and NPC list refreshed successfully! Kill feed will update.';
    } else if (defSuccess) {
      statusMessage.value = 'Definitions refreshed successfully, but NPC list failed.';
    } else if (npcSuccess) {
      statusMessage.value = 'NPC list refreshed successfully, but definitions failed.';
    } else {
      statusMessage.value = 'Failed to refresh both definitions and NPC list.';
    }
  } catch (error: any) {
    console.error('Error refreshing both:', error);
    statusMessage.value = `Error refreshing: ${error.message}`;
  } finally {
    isLoading.value = false;
    setTimeout(() => { statusMessage.value = ''; }, 8000);
  }
}

// --- Startup System Diagnostics ---
const diagnosticResults = ref<any>(null);
const startupDiagnosticResults = ref<any>(null);
const isRunningDiagnostic = ref<boolean>(false);

const handleStartupDiagnostic = async () => {
  isRunningDiagnostic.value = true;
  statusMessage.value = 'Running comprehensive startup diagnostics...';
  try {
    const result = await window.logMonitorApi.invoke('startup-diagnose');
    startupDiagnosticResults.value = result;
    
    if (result.errors.length === 0 && result.warnings.length === 0) {
      statusMessage.value = '✅ Startup system diagnostics: ALL PASSED';
    } else {
      statusMessage.value = `⚠️ Startup diagnostics: ${result.errors.length} errors, ${result.warnings.length} warnings found`;
    }
  } catch (error: any) {
    console.error('Error running startup diagnostics:', error);
    statusMessage.value = `❌ Startup diagnostic failed: ${error.message}`;
  } finally {
    isRunningDiagnostic.value = false;
    setTimeout(() => { statusMessage.value = ''; }, 8000);
  }
}

const handleStartupTest = async () => {
  isRunningDiagnostic.value = true;
  statusMessage.value = 'Running comprehensive startup functionality test...';
  try {
    const result = await window.logMonitorApi.invoke('startup-test');
    
    if (result.success) {
      statusMessage.value = '✅ Startup functionality test completed successfully';
    } else {
      statusMessage.value = `❌ Startup test failed: ${result.error}`;
    }
  } catch (error: any) {
    console.error('Error running startup test:', error);
    statusMessage.value = `❌ Startup test failed: ${error.message}`;
  } finally {
    isRunningDiagnostic.value = false;
    setTimeout(() => { statusMessage.value = ''; }, 8000);
  }
}

const handleGetStartupStatus = async () => {
  isRunningDiagnostic.value = true;
  statusMessage.value = 'Getting real-time startup status...';
  try {
    const status = await window.logMonitorApi.invoke('get-startup-status');
    
    console.log('Startup Status:', status);
    
    if (status.inSync) {
      statusMessage.value = `✅ Startup status: Configured (${status.configStored}), OS Registered (${status.osRegistered}) - IN SYNC`;
    } else {
      statusMessage.value = `⚠️ Startup status: Config (${status.configStored}) ≠ OS (${status.osRegistered}) - OUT OF SYNC`;
    }
  } catch (error: any) {
    console.error('Error getting startup status:', error);
    statusMessage.value = `❌ Failed to get startup status: ${error.message}`;
  } finally {
    isRunningDiagnostic.value = false;
    setTimeout(() => { statusMessage.value = ''; }, 5000);
  }
}

// --- Auto-Update System Diagnostics ---
const handleAutoUpdateDiagnostic = async () => {
  isRunningDiagnostic.value = true;
  statusMessage.value = 'Running comprehensive auto-update diagnostics...';
  try {
    const result = await window.logMonitorApi.invoke('autoupdate-diagnose');
    diagnosticResults.value = result;
    
    if (result.criticalIssues.length === 0 && result.errors.length === 0) {
      statusMessage.value = '✅ Auto-update diagnostics: ALL PASSED';
    } else {
      statusMessage.value = `⚠️ Auto-update diagnostics: ${result.criticalIssues.length} critical, ${result.errors.length} errors, ${result.warnings.length} warnings`;
    }
  } catch (error: any) {
    console.error('Error running auto-update diagnostics:', error);
    statusMessage.value = `❌ Auto-update diagnostic failed: ${error.message}`;
  } finally {
    isRunningDiagnostic.value = false;
    setTimeout(() => { statusMessage.value = ''; }, 8000);
  }
}

const handleAutoUpdateTest = async () => {
  isRunningDiagnostic.value = true;
  statusMessage.value = 'Running comprehensive auto-update workflow test...';
  try {
    const result = await window.logMonitorApi.invoke('autoupdate-test');
    
    if (result.success) {
      statusMessage.value = '✅ Auto-update workflow test completed successfully - Check logs for detailed results';
    } else {
      statusMessage.value = `❌ Auto-update test failed: ${result.error}`;
    }
  } catch (error: any) {
    console.error('Error running auto-update test:', error);
    statusMessage.value = `❌ Auto-update test failed: ${error.message}`;
  } finally {
    isRunningDiagnostic.value = false;
    setTimeout(() => { statusMessage.value = ''; }, 8000);
  }
}

const handleApplyAutoUpdateFixes = async () => {
  isRunningDiagnostic.value = true;
  statusMessage.value = 'Applying automated auto-update fixes...';
  try {
    const result = await window.logMonitorApi.invoke('autoupdate-fix');
    
    if (result.success) {
      statusMessage.value = `✅ Auto-update fixes applied: ${result.applied.length} fixes successful`;
      if (result.applied.length > 0) {
        console.log('Applied fixes:', result.applied);
      }
    } else {
      statusMessage.value = `⚠️ Auto-update fixes: ${result.applied.length} applied, ${result.failed.length} failed`;
      if (result.failed.length > 0) {
        console.error('Failed fixes:', result.failed);
      }
    }
  } catch (error: any) {
    console.error('Error applying auto-update fixes:', error);
    statusMessage.value = `❌ Auto-update fix failed: ${error.message}`;
  } finally {
    isRunningDiagnostic.value = false;
    setTimeout(() => { statusMessage.value = ''; }, 8000);
  }
}

const handleRunAllDiagnostics = async () => {
  isRunningDiagnostic.value = true;
  statusMessage.value = 'Running ALL system diagnostics (startup + auto-update)...';
  try {
    // Run both diagnostics in parallel
    const [startupResult, updateResult] = await Promise.all([
      window.logMonitorApi.invoke('startup-diagnose'),
      window.logMonitorApi.invoke('autoupdate-diagnose')
    ]);
    
    startupDiagnosticResults.value = startupResult;
    diagnosticResults.value = updateResult;
    
    const totalIssues = startupResult.errors.length + startupResult.warnings.length + 
                       updateResult.criticalIssues.length + updateResult.errors.length + updateResult.warnings.length;
    
    if (totalIssues === 0) {
      statusMessage.value = '✅ ALL DIAGNOSTICS PASSED: Startup ✅ Auto-Update ✅';
    } else {
      statusMessage.value = `⚠️ System diagnostics completed with ${totalIssues} total issues found`;
    }
    
    console.log('Startup Diagnostic Results:', startupResult);
    console.log('Auto-Update Diagnostic Results:', updateResult);
    
  } catch (error: any) {
    console.error('Error running all diagnostics:', error);
    statusMessage.value = `❌ Comprehensive diagnostic failed: ${error.message}`;
  } finally {
    isRunningDiagnostic.value = false;
    setTimeout(() => { statusMessage.value = ''; }, 10000);
  }
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

    <!-- Tab Navigation -->
    <div class="tab-navigation">
      <div class="tab-buttons">
        <button 
          @click="activeTab = 'system'"
          :class="['tab-button', { 'tab-active': activeTab === 'system' }]"
        >
          🔧 System Tests
        </button>
        <button 
          @click="activeTab = 'data'"
          :class="['tab-button', { 'tab-active': activeTab === 'data' }]"
        >
          📊 Data Actions
        </button>
        <button 
          @click="activeTab = 'updates'"
          :class="['tab-button', { 'tab-active': activeTab === 'updates' }]"
        >
          🔄 Update Testing
        </button>
        <button 
          @click="activeTab = 'advanced'"
          :class="['tab-button', { 'tab-active': activeTab === 'advanced' }]"
        >
          ⚙️ Advanced
        </button>
      </div>
    </div>

    <!-- Tab Content -->
    <div class="tab-content">

      <!-- System Tests Tab -->
      <div v-if="activeTab === 'system'" class="tab-panel">
        <!-- Comprehensive System Test -->
        <div class="section">
          <h4 class="section-title">
            <div class="section-indicator gold"></div>
            Production Readiness Check
          </h4>
          
          <div class="button-grid button-grid-1">
            <el-button 
              @click="handleRunAllDiagnostics" 
              :disabled="isRunningDiagnostic" 
              type="primary"
              class="debug-button mega-button"
              size="large"
            >
              <template #icon>
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                </svg>
              </template>
              🚀 RUN ALL DIAGNOSTICS (Startup + Auto-Update)
            </el-button>
          </div>
          
          <div class="guide-box mega-guide">
            <h5 class="guide-title">🎯 Before Production Deployment:</h5>
            <p class="guide-note">
              This comprehensive test verifies both startup and auto-update systems are ready for production.
              Results appear below and are logged to console for detailed analysis.
            </p>
            <div class="status-indicators">
              <div class="status-indicator" v-if="isRunningDiagnostic">
                <span class="status-spinner">⏳</span>
                <span>Running comprehensive diagnostics...</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Startup System Diagnostics -->
        <div class="section">
          <h4 class="section-title">
            <div class="section-indicator purple"></div>
            Startup System
          </h4>
          
          <div class="button-grid button-grid-3">
            <el-button 
              @click="handleStartupDiagnostic" 
              :disabled="isRunningDiagnostic" 
              type="primary"
              class="debug-button"
            >
              <template #icon>
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"></path>
                </svg>
              </template>
              Diagnose
            </el-button>
            
            <el-button 
              @click="handleStartupTest" 
              :disabled="isRunningDiagnostic" 
              type="success"
              class="debug-button"
            >
              <template #icon>
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"></path>
                </svg>
              </template>
              Test
            </el-button>
            
            <el-button 
              @click="handleGetStartupStatus" 
              :disabled="isRunningDiagnostic" 
              type="info"
              class="debug-button"
            >
              <template #icon>
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                </svg>
              </template>
              Status
            </el-button>
          </div>

          <!-- Startup Diagnostic Results Display -->
          <div v-if="startupDiagnosticResults" class="diagnostic-results">
            <h5 class="results-title">🔧 Startup Results:</h5>
            
            <div class="results-grid">
              <div class="result-section" :class="startupDiagnosticResults.isConfigured ? 'result-success' : 'result-error'">
                <span class="result-label">Configuration:</span>
                <span class="result-value">{{ startupDiagnosticResults.isConfigured ? '✅ Configured' : '❌ Not Configured' }}</span>
              </div>
              
              <div class="result-section" :class="startupDiagnosticResults.osRegistered ? 'result-success' : 'result-error'">
                <span class="result-label">OS Registration:</span>
                <span class="result-value">{{ startupDiagnosticResults.osRegistered ? '✅ Registered' : '❌ Not Registered' }}</span>
              </div>
              
              <div class="result-section" :class="startupDiagnosticResults.pathExists ? 'result-success' : 'result-error'">
                <span class="result-label">Path Valid:</span>
                <span class="result-value">{{ startupDiagnosticResults.pathExists ? '✅ Valid' : '❌ Invalid' }}</span>
              </div>
            </div>
            
            <div v-if="startupDiagnosticResults.errors.length > 0" class="result-errors">
              <h6 class="error-title">❌ Errors:</h6>
              <ul class="error-list">
                <li v-for="error in startupDiagnosticResults.errors.slice(0, 3)" :key="error" class="error-item">{{ error }}</li>
              </ul>
            </div>
            
            <div v-if="startupDiagnosticResults.warnings.length > 0" class="result-warnings">
              <h6 class="warning-title">⚠️ Warnings:</h6>
              <ul class="warning-list">
                <li v-for="warning in startupDiagnosticResults.warnings.slice(0, 2)" :key="warning" class="warning-item">{{ warning }}</li>
              </ul>
            </div>
          </div>
        </div>

        <!-- Auto-Update System Diagnostics -->
        <div class="section">
          <h4 class="section-title">
            <div class="section-indicator cyan"></div>
            Auto-Update System
          </h4>
          
          <div class="button-grid button-grid-3">
            <el-button 
              @click="handleAutoUpdateDiagnostic" 
              :disabled="isRunningDiagnostic" 
              type="primary"
              class="debug-button"
            >
              <template #icon>
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"></path>
                </svg>
              </template>
              Diagnose
            </el-button>
            
            <el-button 
              @click="handleAutoUpdateTest" 
              :disabled="isRunningDiagnostic" 
              type="success"
              class="debug-button"
            >
              <template #icon>
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.828 14.828a4 4 0 01-5.656 0M9 10h1.586a1 1 0 01.707.293l2.414 2.414a1 1 0 00.707.293H15M9 10V9a2 2 0 012-2h2a2 2 0 012 2v1M9 10H5a2 2 0 00-2 2v6a2 2 0 002 2h14a2 2 0 002-2v-6a2 2 0 00-2-2h-4"></path>
                </svg>
              </template>
              Test
            </el-button>
            
            <el-button 
              @click="handleApplyAutoUpdateFixes" 
              :disabled="isRunningDiagnostic" 
              type="warning"
              class="debug-button"
            >
              <template #icon>
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 100 4m0-4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 100 4m0-4v2m0-6V4"></path>
                </svg>
              </template>
              Apply Fixes
            </el-button>
          </div>

          <!-- Auto-Update Diagnostic Results Display -->
          <div v-if="diagnosticResults" class="diagnostic-results">
            <h5 class="results-title">🔄 Auto-Update Results:</h5>
            
            <div class="results-grid">
              <div class="result-section" :class="diagnosticResults.updateSystemHealth.canCheckUpdates ? 'result-success' : 'result-error'">
                <span class="result-label">Update Checks:</span>
                <span class="result-value">{{ diagnosticResults.updateSystemHealth.canCheckUpdates ? '✅ Working' : '❌ Failed' }}</span>
              </div>
              
              <div class="result-section" :class="diagnosticResults.buildConfiguration.installer === 'unknown' ? 'result-warning' : 'result-success'">
                <span class="result-label">Installer:</span>
                <span class="result-value">{{ diagnosticResults.buildConfiguration.installer.toUpperCase() }}</span>
              </div>
              
              <div class="result-section" :class="diagnosticResults.startupCompatibility.pathMismatch ? 'result-error' : 'result-success'">
                <span class="result-label">Startup Compat:</span>
                <span class="result-value">{{ diagnosticResults.startupCompatibility.pathMismatch ? '❌ Mismatch' : '✅ Compatible' }}</span>
              </div>
            </div>
            
            <div v-if="diagnosticResults.criticalIssues.length > 0" class="result-critical">
              <h6 class="critical-title">🚨 Critical Issues:</h6>
              <ul class="critical-list">
                <li v-for="issue in diagnosticResults.criticalIssues.slice(0, 2)" :key="issue" class="critical-item">{{ issue }}</li>
              </ul>
            </div>
          </div>
        </div>
      </div>

      <!-- Data Actions Tab -->
      <div v-if="activeTab === 'data'" class="tab-panel">
        <!-- Log & Data Actions -->
        <div class="section">
          <h4 class="section-title">
            <div class="section-indicator orange"></div>
            Log & Data Management
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
              Clear Event Cache
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
          
          <div class="guide-box">
            <h5 class="guide-title">Data Management Tools:</h5>
            <ul class="guide-list">
              <li><strong>Reset Sessions:</strong> Clears all user session data</li>
              <li><strong>Clear Event Cache:</strong> Fixes location display issues</li>
              <li><strong>Rescan Log:</strong> Re-reads entire Game.log file</li>
            </ul>
          </div>
        </div>

        <!-- Definitions Refresh -->
        <div class="section">
          <h4 class="section-title">
            <div class="section-indicator green"></div>
            Entity Data Refresh
          </h4>
          
          <div class="button-grid button-grid-3">
            <el-button 
              @click="handleRefreshDefinitions" 
              :disabled="isLoading" 
              type="success"
              class="debug-button"
            >
              <template #icon>
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path>
                </svg>
              </template>
              Refresh Definitions
            </el-button>
            
            <el-button 
              @click="handleRefreshNpcList" 
              :disabled="isLoading" 
              type="success"
              class="debug-button"
            >
              <template #icon>
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                </svg>
              </template>
              Refresh NPC List
            </el-button>
            
            <el-button 
              @click="handleRefreshBoth" 
              :disabled="isLoading" 
              type="success"
              class="debug-button"
            >
              <template #icon>
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path>
                </svg>
              </template>
              Refresh Both
            </el-button>
          </div>
          
          <div class="guide-box">
            <h5 class="guide-title">Entity Resolution Refresh:</h5>
            <p class="guide-note">
              Downloads latest entity mappings and NPC patterns from server. 
              Bypasses cache and forces fresh data download for improved kill feed accuracy.
            </p>
          </div>
        </div>
      </div>

      <!-- Update Testing Tab -->
      <div v-if="activeTab === 'updates'" class="tab-panel">
        <!-- Update System Simulation -->
        <div class="section">
          <h4 class="section-title">
            <div class="section-indicator blue"></div>
            Update System Simulation
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
              <li><strong>1. Check for Update:</strong> Simulates checking for updates</li>
              <li><strong>2. Simulate Update:</strong> Shows "update available" notification</li>
              <li><strong>3. Simulate Download:</strong> Shows download progress with realistic speed/size</li> 
              <li><strong>4. Simulate Install:</strong> Triggers download then install simulation</li>
              <li><strong>5. Simulate Error:</strong> Tests error handling and display</li>
              <li><strong>6. Stop & Reset:</strong> Clears all simulation state</li>
            </ul>
            <p class="guide-note">
              Watch the update notifications in the main window's top-right corner and the events window for real-time feedback!
            </p>
          </div>
        </div>
      </div>

      <!-- Advanced Tab -->
      <div v-if="activeTab === 'advanced'" class="tab-panel">
        <!-- Development Tools -->
        <div class="section">
          <h4 class="section-title">
            <div class="section-indicator red"></div>
            Development & Debug Tools
          </h4>
          
          <div class="guide-box warning-guide">
            <h5 class="guide-title">⚠️ Advanced Debug Features</h5>
            <p class="guide-note">
              These tools are designed for development and advanced debugging. 
              Use with caution in production environments.
            </p>
          </div>
          
          <!-- Reserved for future advanced features -->
          <div class="placeholder-section">
            <h5 class="placeholder-title">🚧 Coming Soon</h5>
            <p class="placeholder-text">
              Advanced debugging features, performance monitoring, and developer tools will be added here.
            </p>
            <ul class="placeholder-list">
              <li>Log level configuration</li>
              <li>Performance profiling</li>
              <li>Memory usage monitoring</li>
              <li>Network diagnostics</li>
              <li>Configuration editor</li>
            </ul>
          </div>
        </div>
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

.section-indicator.green {
  background-color: rgb(34, 197, 94);
}

.section-indicator.purple {
  background-color: rgb(147, 51, 234);
}

.section-indicator.cyan {
  background-color: rgb(6, 182, 212);
}

.section-indicator.gold {
  background-color: rgb(245, 158, 11);
}

.section-indicator.red {
  background-color: rgb(239, 68, 68);
}

.section-indicator.orange {
  background-color: rgb(249, 115, 22);
}

.button-grid {
  display: grid;
  gap: 1rem;
  grid-template-columns: 1fr;
}

.button-grid-3 {
  grid-template-columns: repeat(3, 1fr);
}

.button-grid-1 {
  grid-template-columns: 1fr;
}

@media (max-width: 1024px) {
  .button-grid-3 {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (max-width: 640px) {
  .button-grid-3 {
    grid-template-columns: 1fr;
  }
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

/* Diagnostic Results Styling */
.diagnostic-results {
  background-color: rgba(31, 41, 55, 0.6);
  border: 1px solid rgba(75, 85, 99, 0.5);
  border-radius: 0.75rem;
  padding: 1.5rem;
  margin-top: 1rem;
}

.results-title {
  font-size: 1rem;
  font-weight: 600;
  color: rgb(209, 213, 219);
  margin-bottom: 1rem;
}

.results-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 1rem;
  margin-bottom: 1rem;
}

.result-section {
  background-color: rgba(17, 24, 39, 0.6);
  border-radius: 0.5rem;
  padding: 0.75rem;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  border: 1px solid rgba(75, 85, 99, 0.3);
}

.result-section.result-success {
  border-color: rgba(34, 197, 94, 0.4);
  background-color: rgba(34, 197, 94, 0.1);
}

.result-section.result-error {
  border-color: rgba(239, 68, 68, 0.4);
  background-color: rgba(239, 68, 68, 0.1);
}

.result-section.result-warning {
  border-color: rgba(245, 158, 11, 0.4);
  background-color: rgba(245, 158, 11, 0.1);
}

.result-label {
  font-size: 0.75rem;
  font-weight: 500;
  color: rgb(156, 163, 175);
  text-transform: uppercase;
  letter-spacing: 0.025em;
}

.result-value {
  font-size: 0.875rem;
  font-weight: 600;
  color: rgb(243, 244, 246);
  font-family: ui-monospace, monospace;
}

.result-errors, .result-warnings, .result-critical {
  margin-top: 1rem;
  padding: 1rem;
  border-radius: 0.5rem;
}

.result-critical {
  background-color: rgba(127, 29, 29, 0.3);
  border: 1px solid rgba(239, 68, 68, 0.3);
}

.result-errors {
  background-color: rgba(127, 29, 29, 0.2);
  border: 1px solid rgba(239, 68, 68, 0.2);
}

.result-warnings {
  background-color: rgba(146, 64, 14, 0.2);
  border: 1px solid rgba(245, 158, 11, 0.2);
}

.critical-title, .error-title, .warning-title {
  font-size: 0.875rem;
  font-weight: 600;
  margin-bottom: 0.5rem;
}

.critical-title {
  color: rgb(248, 113, 113);
}

.error-title {
  color: rgb(248, 113, 113);
}

.warning-title {
  color: rgb(251, 146, 60);
}

.critical-list, .error-list, .warning-list {
  font-size: 0.75rem;
  margin-left: 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.critical-item {
  color: rgb(252, 165, 165);
}

.error-item {
  color: rgb(252, 165, 165);
}

.warning-item {
  color: rgb(253, 186, 116);
}

/* Mega Button Styling */
.mega-button {
  min-height: 60px !important;
  font-size: 1rem !important;
  font-weight: 700 !important;
  background: linear-gradient(135deg, rgb(37, 99, 235) 0%, rgb(147, 51, 234) 100%) !important;
  border: none !important;
  transition: all 0.3s ease !important;
}

.mega-button:hover {
  transform: scale(1.02) !important;
  background: linear-gradient(135deg, rgb(59, 130, 246) 0%, rgb(168, 85, 247) 100%) !important;
}

.mega-guide {
  background: linear-gradient(135deg, rgba(37, 99, 235, 0.1) 0%, rgba(147, 51, 234, 0.1) 100%);
  border-color: rgba(99, 102, 241, 0.3);
}

.status-indicators {
  margin-top: 1rem;
}

.status-indicator {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.875rem;
  color: rgb(96, 165, 250);
}

.status-spinner {
  animation: spin 2s linear infinite;
}

@keyframes spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

/* Tab Navigation Styling */
.tab-navigation {
  border-bottom: 1px solid rgba(75, 85, 99, 0.3);
  margin-bottom: 2rem;
}

.tab-buttons {
  display: flex;
  gap: 1rem;
  margin-bottom: -1px;
  flex-wrap: wrap;
}

.tab-button {
  background: none;
  border: none;
  padding: 0.75rem 1.5rem;
  font-size: 0.875rem;
  font-weight: 500;
  color: rgb(156, 163, 175);
  cursor: pointer;
  border-bottom: 2px solid transparent;
  transition: all 0.3s ease;
  white-space: nowrap;
}

.tab-button:hover {
  color: rgb(209, 213, 219);
  background-color: rgba(55, 65, 81, 0.5);
  border-radius: 0.5rem 0.5rem 0 0;
}

.tab-button.tab-active {
  color: rgb(96, 165, 250);
  border-bottom-color: rgb(96, 165, 250);
  background-color: rgba(30, 58, 138, 0.2);
  border-radius: 0.5rem 0.5rem 0 0;
}

.tab-panel {
  display: flex;
  flex-direction: column;
  gap: 2rem;
}

/* Warning Guide Box */
.warning-guide {
  background-color: rgba(146, 64, 14, 0.2);
  border-color: rgba(245, 158, 11, 0.3);
}

.warning-guide .guide-title {
  color: rgb(251, 146, 60);
}

.warning-guide .guide-note {
  color: rgb(253, 186, 116);
}

/* Placeholder Section */
.placeholder-section {
  background-color: rgba(55, 65, 81, 0.3);
  border: 1px dashed rgba(107, 114, 128, 0.5);
  border-radius: 0.75rem;
  padding: 2rem;
  text-align: center;
}

.placeholder-title {
  font-size: 1.125rem;
  font-weight: 600;
  color: rgb(156, 163, 175);
  margin-bottom: 1rem;
}

.placeholder-text {
  font-size: 0.875rem;
  color: rgb(107, 114, 128);
  margin-bottom: 1.5rem;
}

.placeholder-list {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  font-size: 0.75rem;
  color: rgb(75, 85, 99);
  text-align: left;
  max-width: 300px;
  margin: 0 auto;
}

.placeholder-list li::before {
  content: '• ';
  color: rgb(107, 114, 128);
}

/* Responsive tab navigation */
@media (max-width: 768px) {
  .tab-buttons {
    justify-content: center;
  }
  
  .tab-button {
    flex: 1;
    min-width: 120px;
    font-size: 0.75rem;
    padding: 0.5rem 1rem;
  }
}
</style>