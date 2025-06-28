<template>
  <Transition name="update-slide">
    <div v-if="showNotification" class="update-notification" :class="notificationClass">
      <div class="update-content">
        <div class="update-header">
          <el-icon :size="20" class="status-icon">
            <component :is="statusIcon" />
          </el-icon>
          <span class="update-message">{{ statusMessage }}</span>
          <button v-if="canDismiss" @click="dismiss" class="dismiss-btn">
            <el-icon :size="16">
              <Close />
            </el-icon>
          </button>
        </div>
        
        <div v-if="isDownloading" class="progress-section">
          <el-progress
            :percentage="downloadProgress"
            :stroke-width="6"
            :color="progressColor"
            :show-text="false"
          />
          <div class="download-info">
            <span>{{ downloadedMB }}MB / {{ totalMB }}MB</span>
            <span>{{ downloadSpeedKB }} KB/s</span>
          </div>
        </div>
        
        <div v-if="showActions" class="update-actions">
          <el-button
            v-if="canDownload"
            type="primary"
            size="small"
            @click="downloadUpdate"
            :loading="isDownloading"
          >
            Download Update
          </el-button>
          <el-button
            v-if="canInstall"
            type="success"
            size="small"
            @click="installUpdate"
          >
            Install & Restart
          </el-button>
        </div>
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { Loading, Download, CircleCheck, Warning, Close } from '@element-plus/icons-vue';
import { useUpdateStore } from '../stores/updateStore';

const updateStore = useUpdateStore();

const showNotification = computed(() => 
  updateStore.isUpdateAvailable && !updateStore.dismissed
);

const notificationClass = computed(() => ({
  'checking': updateStore.state === 'checking',
  'available': updateStore.state === 'available',
  'downloading': updateStore.state === 'downloading',
  'ready': updateStore.state === 'ready',
  'error': updateStore.state === 'error'
}));

const statusIcon = computed(() => {
  switch (updateStore.state) {
    case 'checking': return Loading;
    case 'available': return Download;
    case 'downloading': return Download;
    case 'ready': return CircleCheck;
    case 'error': return Warning;
    default: return Download;
  }
});

const statusMessage = computed(() => {
  switch (updateStore.state) {
    case 'checking': return 'Checking for updates...';
    case 'available': return `Version ${updateStore.updateInfo?.version} available`;
    case 'downloading': return 'Downloading update...';
    case 'ready': return 'Update ready to install';
    case 'error': return updateStore.error || 'Update failed';
    default: return '';
  }
});

const canDismiss = computed(() => 
  updateStore.state !== 'downloading' && updateStore.state !== 'checking'
);

const showActions = computed(() => 
  updateStore.state === 'available' || updateStore.state === 'ready'
);

const progressColor = '#6363f7';

const {
  downloadProgress,
  downloadSpeedKB,
  downloadedMB,
  totalMB,
  canDownload,
  canInstall,
  isDownloading
} = updateStore;

function downloadUpdate() {
  updateStore.startDownload();
}

function installUpdate() {
  updateStore.installUpdate();
}

function dismiss() {
  updateStore.dismissNotification();
}
</script>

<style scoped>
.update-notification {
  background-color: #1a1a1a;
  border: 1px solid #333;
  border-radius: 8px;
  padding: 12px 16px;
  margin: 8px;
  box-shadow: 0 4px 6px rgba(0, 0, 0, 0.3);
}

.update-notification.downloading {
  border-color: #6363f7;
}

.update-notification.ready {
  border-color: #67c23a;
}

.update-notification.error {
  border-color: #f56c6c;
}

.update-content {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.update-header {
  display: flex;
  align-items: center;
  gap: 8px;
}

.status-icon {
  color: #6363f7;
  flex-shrink: 0;
}

.update-notification.ready .status-icon {
  color: #67c23a;
}

.update-notification.error .status-icon {
  color: #f56c6c;
}

.update-notification.checking .status-icon {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

.update-message {
  flex: 1;
  font-size: 14px;
  font-weight: 500;
}

.dismiss-btn {
  background: none;
  border: none;
  color: #999;
  cursor: pointer;
  padding: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  transition: background-color 0.2s;
}

.dismiss-btn:hover {
  background-color: rgba(255, 255, 255, 0.1);
  color: #fff;
}

.progress-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.download-info {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: #999;
}

.update-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}

/* Transition */
.update-slide-enter-active,
.update-slide-leave-active {
  transition: all 0.3s ease;
}

.update-slide-enter-from {
  transform: translateY(-100%);
  opacity: 0;
}

.update-slide-leave-to {
  transform: translateY(-100%);
  opacity: 0;
}

/* Dark theme adjustments for Element Plus */
:deep(.el-progress) {
  background-color: rgba(255, 255, 255, 0.1);
}

:deep(.el-progress-bar__outer) {
  background-color: rgba(255, 255, 255, 0.1);
}

:deep(.el-button--small) {
  padding: 5px 11px;
  font-size: 12px;
}
</style>