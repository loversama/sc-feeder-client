<template>
  <Transition name="banner-slide">
    <div v-if="shouldShowBanner" class="connection-banner" :class="bannerClass">
      <!-- Connecting State -->
      <div v-if="status === 'connecting'" class="banner-content">
        <div class="banner-info">
          <el-icon class="banner-icon spinning"><Loading /></el-icon>
          <div class="banner-text">
            <span class="banner-title">{{ connectingTitle }}</span>
            <span class="banner-subtitle">{{ reconnectMessage }}</span>
          </div>
        </div>
      </div>

      <!-- Disconnected State -->
      <div v-else-if="status === 'disconnected'" class="banner-content">
        <div class="banner-info">
          <el-icon v-if="connectionAttempts === 0" class="banner-icon spinning"><Loading /></el-icon>
          <el-icon v-else class="banner-icon error"><Connection /></el-icon>
          <div class="banner-text">
            <span class="banner-title">{{ connectionAttempts === 0 ? 'Connecting to Server' : disconnectedTitle }}</span>
            <span class="banner-subtitle">{{ connectionAttempts === 0 ? 'Please wait...' : nextAttemptMessage }}</span>
          </div>
        </div>
        <el-button 
          v-if="connectionAttempts > 0"
          @click="reconnectNow" 
          type="primary" 
          plain 
          class="banner-action"
        >
          Reconnect Now
        </el-button>
      </div>

      <!-- Error State -->
      <div v-else-if="status === 'error'" class="banner-content">
        <div class="banner-info">
          <el-icon class="banner-icon error"><Warning /></el-icon>
          <div class="banner-text">
            <span class="banner-title">Connection Error</span>
            <span class="banner-subtitle">Unable to connect to server</span>
          </div>
        </div>
        <el-button @click="reconnectNow" type="primary" plain class="banner-action">
          Try Again
        </el-button>
      </div>

      <!-- Connected State (Temporary Success Message) -->
      <div v-else-if="status === 'connected' && showSuccessMessage" class="banner-content success-content">
        <div class="banner-info">
          <el-icon class="banner-icon success"><CircleCheck /></el-icon>
          <div class="banner-text">
            <span class="banner-title">Connected</span>
            <span class="banner-subtitle">Successfully connected to server</span>
          </div>
        </div>
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { Loading, Connection, Warning, CircleCheck } from '@element-plus/icons-vue';

type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

const props = defineProps<{
  status: ConnectionStatus;
  hideWhenUpdateActive?: boolean;
}>();

const emit = defineEmits<{
  reconnect: [];
}>();

// State
const showSuccessMessage = ref(false);
const reconnectAttempt = ref(0);
const nextReconnectTime = ref(0);
const countdownInterval = ref<NodeJS.Timeout | null>(null);
const connectionAttempts = ref(0); // Track total connection attempts

// Progressive reconnection delays: 3s, 5s, 10s, 15s, then 15-30s randomly
const getReconnectDelay = (attempt: number): number => {
  const progressiveDelays = [3000, 5000, 10000, 15000];
  if (attempt < progressiveDelays.length) {
    return progressiveDelays[attempt];
  }
  // After 4 attempts, use random delay between 15-30 seconds
  return Math.floor(Math.random() * 15000) + 15000; // 15000-30000ms
};

// Computed
const shouldShowBanner = computed(() => {
  // Don't show if update banner is active and hideWhenUpdateActive is true
  if (props.hideWhenUpdateActive && document.querySelector('.update-banner')) {
    return false;
  }
  
  // Show for error states
  if (props.status === 'disconnected' || props.status === 'connecting' || props.status === 'error') {
    return true;
  }
  
  // Show success message temporarily
  if (props.status === 'connected' && showSuccessMessage.value) {
    return true;
  }
  
  return false;
});

const bannerClass = computed(() => ({
  'connecting': props.status === 'connecting',
  'disconnected': props.status === 'disconnected',
  'error': props.status === 'error',
  'connected': props.status === 'connected',
  'success': props.status === 'connected' && showSuccessMessage.value
}));

const connectingTitle = computed(() => {
  if (connectionAttempts.value === 0) {
    return 'Connecting to Server';
  }
  return 'Reconnecting to Server';
});

const disconnectedTitle = computed(() => {
  // Show "Connection Lost" only after 5 failed attempts
  if (connectionAttempts.value >= 5) {
    return 'Connection Lost';
  }
  return 'Reconnecting to Server';
});

const reconnectMessage = computed(() => {
  if (connectionAttempts.value === 0) {
    return 'Please wait...';
  } else if (connectionAttempts.value === 1) {
    return 'First connection attempt...';
  }
  return `Attempt ${connectionAttempts.value}`;
});

const nextAttemptMessage = computed(() => {
  if (nextReconnectTime.value > 0) {
    const seconds = Math.ceil(nextReconnectTime.value / 1000);
    if (connectionAttempts.value >= 5) {
      return `Retrying in ${seconds}s...`;
    }
    return `Next attempt in ${seconds}s...`;
  }
  return 'Will attempt to reconnect shortly';
});

// Methods
function reconnectNow() {
  emit('reconnect');
}

function startCountdown(delayMs: number) {
  nextReconnectTime.value = delayMs;
  
  if (countdownInterval.value) {
    clearInterval(countdownInterval.value);
  }
  
  countdownInterval.value = setInterval(() => {
    nextReconnectTime.value = Math.max(0, nextReconnectTime.value - 100);
    if (nextReconnectTime.value === 0 && countdownInterval.value) {
      clearInterval(countdownInterval.value);
      countdownInterval.value = null;
    }
  }, 100);
}

// Watchers
watch(() => props.status, (newStatus, oldStatus) => {
  // Handle successful connection
  if (newStatus === 'connected' && (oldStatus === 'connecting' || oldStatus === 'disconnected')) {
    showSuccessMessage.value = true;
    connectionAttempts.value = 0; // Reset connection attempts on successful connection
    reconnectAttempt.value = 0;
    nextReconnectTime.value = 0;
    
    // Hide success message after 3 seconds
    setTimeout(() => {
      showSuccessMessage.value = false;
    }, 3000);
  }
  
  // Handle disconnection - start countdown
  if (newStatus === 'disconnected') {
    const delay = getReconnectDelay(reconnectAttempt.value);
    startCountdown(delay);
  }
  
  // Handle reconnection attempt
  if (newStatus === 'connecting') {
    if (!oldStatus) {
      // Initial connection on app startup
      connectionAttempts.value = 0;
      reconnectAttempt.value = 0;
    } else if (oldStatus === 'disconnected') {
      // Reconnection after disconnect
      reconnectAttempt.value++;
      connectionAttempts.value++;
    }
  }
  
  // Clear countdown when connecting or connected
  if (newStatus === 'connecting' || newStatus === 'connected') {
    if (countdownInterval.value) {
      clearInterval(countdownInterval.value);
      countdownInterval.value = null;
    }
  }
});

// Cleanup
onUnmounted(() => {
  if (countdownInterval.value) {
    clearInterval(countdownInterval.value);
  }
});
</script>

<style scoped>
.connection-banner {
  background: #171717;
  border: none;
  border-bottom: 1px solid #262626;
  margin: 0;
  overflow: hidden;
  transition: all 0.3s ease;
}

.connection-banner.connecting {
  background: #171717;
  border-bottom-color: #ea580c;
}

.connection-banner.disconnected,
.connection-banner.error {
  background: #171717;
  border-bottom-color: #dc2626;
}

.connection-banner.success {
  background: #171717;
  border-bottom-color: #10b981;
}

.banner-content {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  gap: 12px;
  transition: all 0.3s ease;
}

.banner-content.success-content {
  justify-content: center;
}

.banner-info {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: 1;
}

.banner-icon {
  font-size: 24px;
  flex-shrink: 0;
}

.banner-icon.spinning {
  color: #ea580c;
  animation: spin 1s linear infinite;
}

.banner-icon.success {
  color: #10b981;
}

.banner-icon.error {
  color: #dc2626;
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

/* Success state animation */
.connection-banner.success .banner-icon {
  animation: success-pulse 0.5s ease-out;
}

@keyframes success-pulse {
  0% {
    transform: scale(0.8);
    opacity: 0;
  }
  50% {
    transform: scale(1.2);
  }
  100% {
    transform: scale(1);
    opacity: 1;
  }
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
:deep(.el-button) {
  border: none;
  font-weight: 500;
  padding: 8px 16px;
  border-radius: 6px;
}

:deep(.el-button--primary.is-plain) {
  background-color: transparent;
  border: 1px solid #ea580c;
  color: #ea580c;
}

:deep(.el-button--primary.is-plain:hover) {
  background-color: rgba(234, 88, 12, 0.1);
  border-color: #f97316;
  color: #f97316;
}
</style>