<template>
  <Transition name="banner-slide">
    <div v-if="showBanner" class="update-banner" :class="bannerClass">
      <!-- Update Available State -->
      <div v-if="updateStore.state === 'available'" class="banner-content">
        <div class="banner-info">
          <el-icon class="banner-icon"><Download /></el-icon>
          <div class="banner-text">
            <span class="banner-title">Update Available</span>
            <span class="banner-subtitle">Version {{ updateStore.updateInfo?.version }} is ready to download</span>
          </div>
        </div>
        <el-button type="primary" @click="downloadUpdate" class="banner-action">
          Download Now
        </el-button>
      </div>

      <!-- Checking State -->
      <div v-else-if="updateStore.state === 'checking'" class="banner-content checking-content">
        <div class="banner-info full-width">
          <el-icon class="banner-icon spinning"><Loading /></el-icon>
          <span class="checking-text">Checking for updates...</span>
        </div>
      </div>

      <!-- Downloading State -->
      <div v-else-if="updateStore.state === 'downloading'" class="banner-content expanded">
        <div class="banner-info">
          <el-icon class="banner-icon"><Download /></el-icon>
          <div class="banner-text">
            <span class="banner-title">Downloading Update</span>
            <span class="banner-subtitle">Version {{ updateStore.updateInfo?.version }}</span>
          </div>
        </div>
        
        <!-- Progress Section -->
        <div class="progress-section">
          <el-progress
            :percentage="updateStore.downloadProgress"
            :stroke-width="8"
            color="#f97316"
            :show-text="false"
          />
          <div class="progress-info">
            <span class="progress-percent">{{ updateStore.downloadProgress.toFixed(1) }}%</span>
            <span class="progress-details">{{ updateStore.downloadedMB }}MB / {{ updateStore.totalMB }}MB • {{ updateStore.downloadSpeedKB }} KB/s</span>
          </div>
        </div>
      </div>

      <!-- Ready to Install State -->
      <div v-else-if="updateStore.state === 'ready'" class="banner-content">
        <div class="banner-info">
          <el-icon class="banner-icon success"><CircleCheck /></el-icon>
          <div class="banner-text">
            <span class="banner-title">Update Downloaded</span>
            <span class="banner-subtitle">Ready to install version {{ updateStore.updateInfo?.version }}</span>
          </div>
        </div>
        <el-button type="success" @click="installUpdate" class="banner-action install-btn">
          Install & Restart
        </el-button>
      </div>

      <!-- Error State -->
      <div v-else-if="updateStore.state === 'error'" class="banner-content">
        <div class="banner-info">
          <el-icon class="banner-icon error"><Warning /></el-icon>
          <div class="banner-text">
            <span class="banner-title">Update Failed</span>
            <span class="banner-subtitle">{{ updateStore.error || 'An error occurred while updating' }}</span>
          </div>
        </div>
        <div class="error-actions">
          <el-button @click="retryUpdate" type="primary" class="banner-action">
            Retry
          </el-button>
          <el-button @click="dismissBanner" class="banner-action" type="info" plain>
            Dismiss
          </el-button>
        </div>
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { Download, Loading, CircleCheck, Warning } from '@element-plus/icons-vue';
import { useUpdateStore } from '../stores/updateStore';

const updateStore = useUpdateStore();

const showBanner = computed(() => 
  (updateStore.isUpdateAvailable || updateStore.state === 'checking') && !updateStore.dismissed
);

const bannerClass = computed(() => ({
  'checking': updateStore.state === 'checking',
  'available': updateStore.state === 'available',
  'downloading': updateStore.state === 'downloading',
  'ready': updateStore.state === 'ready',
  'error': updateStore.state === 'error',
  'expanded': updateStore.state === 'downloading'
}));

function downloadUpdate() {
  updateStore.startDownload();
}

function installUpdate() {
  updateStore.installUpdate();
}

function dismissBanner() {
  updateStore.dismissNotification();
}

function retryUpdate() {
  updateStore.checkForUpdate();
}
</script>

<style scoped>
.update-banner {
  background: #171717;
  border: none;
  border-bottom: 1px solid #262626;
  margin: 0;
  overflow: hidden;
  transition: all 0.3s ease;
}

.update-banner.checking {
  background: #171717;
}

.banner-content {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  gap: 12px;
  transition: all 0.3s ease;
}

.banner-content.expanded {
  flex-direction: column;
  align-items: stretch;
  padding: 16px;
  gap: 12px;
}

.banner-info {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: 1;
}

.banner-info.full-width {
  justify-content: center;
  width: 100%;
}

.checking-content {
  justify-content: center;
}

.checking-text {
  font-size: 16px;
  font-weight: 500;
  color: #ffffff;
}

.banner-icon {
  font-size: 24px;
  flex-shrink: 0;
}

.banner-icon.spinning {
  animation: spin 1s linear infinite;
}

.banner-icon.success {
  color: #10b981;
}

.banner-icon.error {
  color: #ef4444;
}

@keyframes spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

.banner-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.banner-title {
  font-size: 16px;
  font-weight: 600;
  color: #ffffff;
  line-height: 1.2;
}

.banner-subtitle {
  font-size: 14px;
  color: #9ca3af;
  line-height: 1.2;
}

.banner-action {
  flex-shrink: 0;
  min-width: 120px;
}

.error-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}

.install-btn {
  animation: pulse-glow 2s infinite;
}

@keyframes pulse-glow {
  0% {
    box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.4);
  }
  70% {
    box-shadow: 0 0 0 6px rgba(16, 185, 129, 0);
  }
  100% {
    box-shadow: 0 0 0 0 rgba(16, 185, 129, 0);
  }
}

.progress-section {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.progress-info {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 13px;
}

.progress-percent {
  font-weight: 600;
  color: #6366f1;
}

.progress-details {
  color: #9ca3af;
}

/* Transition */
.banner-slide-enter-active,
.banner-slide-leave-active {
  transition: all 0.4s ease;
}

.banner-slide-enter-from {
  transform: translateY(-100%);
  opacity: 0;
}

.banner-slide-leave-to {
  transform: translateY(-100%);
  opacity: 0;
}

/* Element Plus Overrides */
:deep(.el-progress) {
  background-color: rgba(255, 255, 255, 0.1);
}

:deep(.el-progress-bar__outer) {
  background-color: rgba(255, 255, 255, 0.1);
  border-radius: 6px;
}

:deep(.el-progress-bar__inner) {
  border-radius: 6px;
}

:deep(.el-button) {
  border: none;
  font-weight: 500;
  padding: 8px 16px;
  border-radius: 6px;
}

:deep(.el-button--primary) {
  background-color: #f97316;
  color: white;
}

:deep(.el-button--primary:hover) {
  background-color: #ea580c;
}

:deep(.el-button--success) {
  background-color: #10b981;
  color: white;
}

:deep(.el-button--success:hover) {
  background-color: #059669;
}

:deep(.el-button--info.is-plain) {
  background-color: transparent;
  border: 1px solid #6b7280;
  color: #9ca3af;
}

:deep(.el-button--info.is-plain:hover) {
  background-color: rgba(107, 114, 128, 0.1);
  border-color: #9ca3af;
  color: #d1d5db;
}
</style>