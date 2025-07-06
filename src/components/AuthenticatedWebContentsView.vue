<template>
  <div class="authenticated-webcontent-container">
    <div class="header">
      <h3>Authenticated Web Content</h3>
      <div class="controls">
        <el-button-group>
          <el-button 
            @click="openAuthenticatedWindow('profile')"
            :disabled="isLoading"
            type="primary"
            size="small"
          >
            Profile
          </el-button>
          <el-button 
            @click="openAuthenticatedWindow('leaderboard')"
            :disabled="isLoading"
            type="primary"
            size="small"
          >
            Leaderboard
          </el-button>
          <el-button 
            @click="openAuthenticatedWindow('map')"
            :disabled="isLoading"
            type="primary"
            size="small"
          >
            Map
          </el-button>
        </el-button-group>
        
        <el-button 
          @click="closeAuthenticatedWindow"
          :disabled="isLoading"
          type="danger"
          size="small"
          style="margin-left: 10px;"
        >
          Close
        </el-button>
      </div>
    </div>
    
    <div class="status" v-if="status">
      <el-tag :type="status.isOpen ? 'success' : 'info'" size="small">
        {{ status.isOpen ? 'Open' : 'Closed' }}
      </el-tag>
      
      <el-tag v-if="status.activeSection" type="primary" size="small">
        {{ status.activeSection }}
      </el-tag>
      
      <el-tag v-if="status.windowType" type="warning" size="small">
        {{ status.windowType }}
      </el-tag>
    </div>
    
    <div class="description">
      <p>
        This demonstrates the new authenticated WebContentsView implementation.
        It uses proper session partitioning, cookie-based authentication, and
        automatic token refresh to eliminate 401 errors.
      </p>
      
      <el-alert 
        v-if="authStatus?.isAuthenticated"
        type="success" 
        size="small"
        show-icon
        :closable="false"
      >
        <template #title>
          Authenticated as {{ authStatus.username }}
        </template>
        WebContentsView will use your authentication tokens automatically.
      </el-alert>
      
      <el-alert 
        v-else
        type="warning" 
        size="small"
        show-icon
        :closable="false"
      >
        <template #title>
          Not Authenticated
        </template>
        WebContentsView will work in guest mode. Login for full functionality.
      </el-alert>
    </div>
    
    <div v-if="error" class="error">
      <el-alert type="error" size="small" show-icon>
        {{ error }}
      </el-alert>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import type { IpcRendererEvent } from 'electron';

const isLoading = ref(false);
const error = ref<string | null>(null);
const status = ref<{
  isOpen: boolean;
  activeSection: string | null;
  windowType?: string;
} | null>(null);

const authStatus = ref<{
  isAuthenticated: boolean;
  username: string | null;
} | null>(null);

// Get current authentication status
const updateAuthStatus = async () => {
  try {
    if (window.logMonitorApi?.authGetStatus) {
      const status = await window.logMonitorApi.authGetStatus();
      authStatus.value = status;
    }
  } catch (err) {
    console.error('Failed to get auth status:', err);
  }
};

// Get current window status
const updateWindowStatus = async () => {
  try {
    if (window.logMonitorApi?.getWebContentWindowStatus) {
      const windowStatus = await window.logMonitorApi.getWebContentWindowStatus();
      status.value = windowStatus;
    }
  } catch (err) {
    console.error('Failed to get window status:', err);
    status.value = { isOpen: false, activeSection: null };
  }
};

// Open authenticated web content window
const openAuthenticatedWindow = async (section: 'profile' | 'leaderboard' | 'map') => {
  if (isLoading.value) return;
  
  isLoading.value = true;
  error.value = null;
  
  try {
    if (window.logMonitorApi?.openAuthenticatedWebContentWindow) {
      const result = await window.logMonitorApi.openAuthenticatedWebContentWindow(section);
      
      if (result.success) {
        console.log(`Successfully opened authenticated WebContentsView for ${section}`);
        await updateWindowStatus();
      } else {
        error.value = result.error || 'Failed to open authenticated window';
        console.error('Failed to open authenticated window:', result.error);
      }
    } else {
      error.value = 'Authenticated WebContentsView API not available';
      console.error('openAuthenticatedWebContentWindow API not available');
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Unknown error occurred';
    console.error('Error opening authenticated window:', err);
  } finally {
    isLoading.value = false;
  }
};

// Close authenticated web content window
const closeAuthenticatedWindow = async () => {
  if (isLoading.value) return;
  
  isLoading.value = true;
  error.value = null;
  
  try {
    if (window.logMonitorApi?.closeAuthenticatedWebContentWindow) {
      const result = await window.logMonitorApi.closeAuthenticatedWebContentWindow();
      
      if (result.success) {
        console.log('Successfully closed authenticated WebContentsView');
        await updateWindowStatus();
      } else {
        error.value = result.error || 'Failed to close authenticated window';
        console.error('Failed to close authenticated window:', result.error);
      }
    } else {
      error.value = 'Authenticated WebContentsView close API not available';
      console.error('closeAuthenticatedWebContentWindow API not available');
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Unknown error occurred';
    console.error('Error closing authenticated window:', err);
  } finally {
    isLoading.value = false;
  }
};

// Listen for window status changes
const handleWindowStatusChange = (event: IpcRendererEvent, newStatus: any) => {
  console.log('Received window status change:', newStatus);
  if (newStatus.windowType === 'webcontents-view') {
    status.value = newStatus;
  }
};

// Listen for auth status changes
const handleAuthStatusChange = (event: IpcRendererEvent, newAuthStatus: any) => {
  console.log('Received auth status change:', newAuthStatus);
  authStatus.value = newAuthStatus;
};

onMounted(async () => {
  // Get initial status
  await Promise.all([
    updateAuthStatus(),
    updateWindowStatus()
  ]);
  
  // Listen for status changes
  if (window.logMonitorApi?.onWebContentWindowStatusChanged) {
    window.logMonitorApi.onWebContentWindowStatusChanged(handleWindowStatusChange);
  }
  
  if (window.logMonitorApi?.onAuthStatusChanged) {
    window.logMonitorApi.onAuthStatusChanged(handleAuthStatusChange);
  }
});

onUnmounted(() => {
  // Clean up listeners if needed
  // Note: The actual cleanup depends on how the API is implemented
});
</script>

<style scoped>
.authenticated-webcontent-container {
  padding: 16px;
  background: #f8f9fa;
  border-radius: 8px;
  margin: 16px 0;
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.header h3 {
  margin: 0;
  color: #2c3e50;
  font-size: 16px;
  font-weight: 600;
}

.controls {
  display: flex;
  align-items: center;
  gap: 8px;
}

.status {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}

.description {
  margin-bottom: 12px;
}

.description p {
  margin: 0 0 12px 0;
  color: #6c757d;
  font-size: 14px;
  line-height: 1.5;
}

.error {
  margin-top: 12px;
}

/* Button group styling */
:deep(.el-button-group .el-button) {
  margin: 0;
  border-radius: 0;
}

:deep(.el-button-group .el-button:first-child) {
  border-top-left-radius: 4px;
  border-bottom-left-radius: 4px;
}

:deep(.el-button-group .el-button:last-child) {
  border-top-right-radius: 4px;
  border-bottom-right-radius: 4px;
}

/* Alert styling */
:deep(.el-alert) {
  margin-bottom: 8px;
}

:deep(.el-alert:last-child) {
  margin-bottom: 0;
}
</style>