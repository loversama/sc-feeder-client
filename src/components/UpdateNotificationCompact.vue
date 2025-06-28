<template>
  <Transition name="update-compact-slide">
    <div v-if="showNotification" class="update-compact" :class="notificationClass" @click="handleClick">
      <el-icon :size="18" class="status-icon">
        <component :is="statusIcon" />
      </el-icon>
      <span class="update-text">{{ statusText }}</span>
      <div v-if="isDownloading" class="progress-bar">
        <div class="progress-fill" :style="{ width: `${downloadProgress}%` }"></div>
      </div>
      <button v-if="showAction" @click.stop="handleAction" class="action-btn">
        {{ actionText }}
      </button>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { Loading, Download, CircleCheck, Warning } from '@element-plus/icons-vue';
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

const statusText = computed(() => {
  switch (updateStore.state) {
    case 'checking': return 'Checking...';
    case 'available': return `Update ${updateStore.updateInfo?.version}`;
    case 'downloading': return `${updateStore.downloadProgress.toFixed(0)}%`;
    case 'ready': return 'Ready to install';
    case 'error': return 'Update failed';
    default: return '';
  }
});

const showAction = computed(() => 
  updateStore.state === 'available' || updateStore.state === 'ready'
);

const actionText = computed(() => {
  if (updateStore.state === 'available') return 'Download';
  if (updateStore.state === 'ready') return 'Install';
  return '';
});

const { downloadProgress, isDownloading } = updateStore;

function handleClick() {
  if (updateStore.state === 'error') {
    updateStore.dismissNotification();
  }
}

function handleAction() {
  if (updateStore.state === 'available') {
    updateStore.startDownload();
  } else if (updateStore.state === 'ready') {
    updateStore.installUpdate();
  }
}
</script>

<style scoped>
.update-compact {
  background-color: #1e1e1e;
  border: 1px solid #333;
  height: 36px;
  display: flex;
  align-items: center;
  padding: 0 12px;
  gap: 8px;
  cursor: pointer;
  transition: all 0.2s ease;
  position: relative;
  overflow: hidden;
}

.update-compact:hover {
  background-color: #252525;
  border-color: #444;
}

.update-compact.available {
  border-color: #6363f7;
}

.update-compact.downloading {
  cursor: default;
}

.update-compact.ready {
  border-color: #67c23a;
  animation: pulse 2s infinite;
}

.update-compact.error {
  border-color: #f56c6c;
}

@keyframes pulse {
  0% {
    box-shadow: 0 0 0 0 rgba(103, 194, 58, 0.4);
  }
  70% {
    box-shadow: 0 0 0 6px rgba(103, 194, 58, 0);
  }
  100% {
    box-shadow: 0 0 0 0 rgba(103, 194, 58, 0);
  }
}

.status-icon {
  color: #999;
  flex-shrink: 0;
}

.update-compact.available .status-icon {
  color: #6363f7;
}

.update-compact.ready .status-icon {
  color: #67c23a;
}

.update-compact.error .status-icon {
  color: #f56c6c;
}

.update-compact.checking .status-icon {
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

.update-text {
  flex: 1;
  font-size: 13px;
  color: #ddd;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.progress-bar {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 2px;
  background-color: rgba(255, 255, 255, 0.1);
}

.progress-fill {
  height: 100%;
  background-color: #6363f7;
  transition: width 0.3s ease;
}

.action-btn {
  background-color: #6363f7;
  color: white;
  border: none;
  padding: 4px 12px;
  border-radius: 4px;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.2s;
  flex-shrink: 0;
}

.action-btn:hover {
  background-color: #5252e0;
}

.update-compact.ready .action-btn {
  background-color: #67c23a;
}

.update-compact.ready .action-btn:hover {
  background-color: #5daf34;
}

/* Transition */
.update-compact-slide-enter-active,
.update-compact-slide-leave-active {
  transition: all 0.3s ease;
}

.update-compact-slide-enter-from {
  transform: translateY(-100%);
  opacity: 0;
}

.update-compact-slide-leave-to {
  transform: translateY(-100%);
  opacity: 0;
}
</style>