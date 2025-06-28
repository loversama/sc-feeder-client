import { defineStore } from 'pinia';
import { ref, computed } from 'vue';

export interface UpdateInfo {
  version: string;
  releaseDate?: string;
  releaseNotes?: string;
}

export type UpdateState = 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'error';

export const useUpdateStore = defineStore('update', () => {
  // State
  const state = ref<UpdateState>('idle');
  const updateInfo = ref<UpdateInfo | null>(null);
  const downloadProgress = ref(0);
  const downloadSpeed = ref(0); // bytes per second
  const bytesDownloaded = ref(0);
  const totalBytes = ref(0);
  const error = ref<string | null>(null);
  const dismissed = ref(false); // User dismissed the notification

  // Computed
  const isUpdateAvailable = computed(() => state.value === 'available' || state.value === 'downloading' || state.value === 'ready' || state.value === 'error');
  const canDownload = computed(() => state.value === 'available');
  const canInstall = computed(() => state.value === 'ready');
  const isDownloading = computed(() => state.value === 'downloading');
  const downloadSpeedKB = computed(() => Math.round(downloadSpeed.value / 1024));
  const downloadedMB = computed(() => (bytesDownloaded.value / (1024 * 1024)).toFixed(1));
  const totalMB = computed(() => (totalBytes.value / (1024 * 1024)).toFixed(1));

  // Actions
  function checkForUpdate() {
    state.value = 'checking';
    error.value = null;
    dismissed.value = false;
    // Main process will handle the actual check
    window.logMonitorApi.checkForUpdate();
  }

  function startDownload() {
    if (state.value === 'available') {
      state.value = 'downloading';
      window.logMonitorApi.downloadUpdate();
    }
  }

  function installUpdate() {
    if (state.value === 'ready') {
      window.logMonitorApi.installUpdate();
    }
  }

  function dismissNotification() {
    dismissed.value = true;
  }

  function setUpdateAvailable(info: UpdateInfo) {
    state.value = 'available';
    updateInfo.value = info;
    error.value = null;
    dismissed.value = false;
  }

  function setUpdateNotAvailable() {
    state.value = 'idle';
    updateInfo.value = null;
    error.value = null;
  }

  function setDownloadProgress(progress: number, speed: number, transferred: number, total: number) {
    state.value = 'downloading';
    downloadProgress.value = progress;
    downloadSpeed.value = speed;
    bytesDownloaded.value = transferred;
    totalBytes.value = total;
  }

  function setUpdateReady(info: UpdateInfo) {
    state.value = 'ready';
    updateInfo.value = info;
    downloadProgress.value = 100;
    error.value = null;
    dismissed.value = false;
  }

  function setError(errorMessage: string) {
    state.value = 'error';
    error.value = errorMessage;
    dismissed.value = false;
  }

  function reset() {
    state.value = 'idle';
    updateInfo.value = null;
    downloadProgress.value = 0;
    downloadSpeed.value = 0;
    bytesDownloaded.value = 0;
    totalBytes.value = 0;
    error.value = null;
    dismissed.value = false;
  }

  // Simulation functionality for testing
  let simulationInterval: NodeJS.Timeout | null = null;

  function simulateUpdate() {
    reset();
    
    // Step 1: Simulate checking for update
    state.value = 'checking';
    
    setTimeout(() => {
      // Step 2: Simulate update available
      setUpdateAvailable({
        version: '2.1.0',
        releaseDate: new Date().toISOString(),
        releaseNotes: 'This is a simulated update for testing the UI.'
      });
    }, 1000);
  }

  function simulateDownload() {
    if (state.value !== 'available') return;
    
    state.value = 'downloading';
    downloadProgress.value = 0;
    
    const totalSize = 50 * 1024 * 1024; // 50MB
    totalBytes.value = totalSize;
    
    simulationInterval = setInterval(() => {
      if (downloadProgress.value >= 100) {
        clearInterval(simulationInterval!);
        simulationInterval = null;
        
        // Simulate download completed
        setUpdateReady({
          version: '2.1.0',
          releaseDate: new Date().toISOString(),
          releaseNotes: 'This is a simulated update for testing the UI.'
        });
        return;
      }
      
      // Simulate download progress
      downloadProgress.value += Math.random() * 5; // Random progress increment
      if (downloadProgress.value > 100) downloadProgress.value = 100;
      
      // Simulate variable download speed (500KB/s to 2MB/s)
      downloadSpeed.value = 500000 + Math.random() * 1500000;
      bytesDownloaded.value = (totalSize * downloadProgress.value) / 100;
    }, 200);
  }

  function simulateInstall() {
    if (state.value !== 'ready') return;
    
    // In a real scenario, this would restart the app
    // For simulation, we'll just reset after a delay
    setTimeout(() => {
      reset();
    }, 1000);
  }

  function simulateError() {
    setError('Simulated update error for testing purposes');
  }

  function stopSimulation() {
    if (simulationInterval) {
      clearInterval(simulationInterval);
      simulationInterval = null;
    }
    reset();
  }

  // Listen to IPC events
  window.logMonitorApi.onUpdateChecking(() => {
    state.value = 'checking';
  });

  window.logMonitorApi.onUpdateAvailable((event, info: UpdateInfo) => {
    setUpdateAvailable(info);
  });

  window.logMonitorApi.onUpdateNotAvailable(() => {
    setUpdateNotAvailable();
  });

  window.logMonitorApi.onUpdateDownloadProgress((event, progress: number, speed: number, transferred: number, total: number) => {
    setDownloadProgress(progress, speed, transferred, total);
  });

  window.logMonitorApi.onUpdateDownloaded((event, info: UpdateInfo) => {
    setUpdateReady(info);
  });

  window.logMonitorApi.onUpdateError((event, errorMessage: string) => {
    setError(errorMessage);
  });

  return {
    // State
    state,
    updateInfo,
    downloadProgress,
    downloadSpeed,
    downloadSpeedKB,
    bytesDownloaded,
    totalBytes,
    downloadedMB,
    totalMB,
    error,
    dismissed,
    
    // Computed
    isUpdateAvailable,
    canDownload,
    canInstall,
    isDownloading,
    
    // Actions
    checkForUpdate,
    startDownload,
    installUpdate,
    dismissNotification,
    reset,
    
    // Simulation actions
    simulateUpdate,
    simulateDownload,
    simulateInstall,
    simulateError,
    stopSimulation
  };
});