<script setup lang="ts">
console.log('[SettingsWindow.vue] <script setup> executing...');
import { ref, onMounted } from 'vue';
import { ElMessage, ElNotification } from 'element-plus';
import DebugActions from './DebugActions.vue';
import { useUserState } from '../composables/useUserState';

// State for the active category
const activeCategory = ref<string>('general');

// Define categories for the sidebar
const categories = ref([
  { id: 'general', name: 'General', icon: 'settings' },
  { id: 'killfeed', name: 'Kill Feed', icon: 'crosshairs' },
  { id: 'notifications', name: 'Notifications', icon: 'bell' },
  { id: 'data_api', name: 'Data & API', icon: 'database' },
  { id: 'account', name: 'Account', icon: 'user' },
  { id: 'debug', name: 'Debug', icon: 'bug' },
  { id: 'about', name: 'About', icon: 'info' },
]);

// Existing state variables
const currentPath = ref<string>('Loading...');
const lastLoggedInUser = ref<string>('None');
const showNotifications = ref<boolean>(true);
const playSoundEffects = ref<boolean>(true);
const statusMessage = ref<string>('');
const offlineMode = ref<boolean>(false);
const csvLogPath = ref<string>('');
const fetchProfileData = ref<boolean>(true);
const launchOnStartup = ref<boolean>(true);
const version = ref<string>('Loading...');
const isGuestMode = ref<boolean>(false);

// Theme and Language State
const themeSelection = ref<string>('dark');
const languageSelection = ref<string>('en');

// Account State
const loginIdentifier = ref<string>('');
const loginPassword = ref<string>('');
const loginError = ref<string>('');
const loginLoading = ref<boolean>(false);
const authStatus = ref<'loading' | 'authenticated' | 'unauthenticated'>('loading');
const loggedInUsername = ref<string | null>(null);

// User state for debugging
const { state: userState } = useUserState();

// Icon mapping
const getIcon = (iconName: string) => {
  const icons = {
    settings: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z',
    crosshairs: 'M12 1v2m0 16v2m11-9h-2M4 12H2m15.364-6.364l-1.414 1.414M6.05 6.05L4.636 4.636m12.728 12.728l-1.414-1.414M6.05 17.95l-1.414 1.414M16 8a4 4 0 11-8 0 4 4 0 018 0z',
    bell: 'M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9',
    database: 'M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4',
    user: 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z',
    bug: 'M12 2l3.09 6.26L22 9l-5.09 0.74L12 16l-4.91-6.26L2 9l6.91-0.74L12 2z',
    info: 'M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z'
  };
  return icons[iconName as keyof typeof icons] || icons.settings;
};

// Fetch the current log path
const updateLogPath = async () => {
  try {
    if (window.logMonitorApi?.getLogPath) {
        currentPath.value = await window.logMonitorApi.getLogPath();
    } else {
        throw new Error('logMonitorApi.getLogPath not available');
    }
  } catch (error) {
    console.error('Failed to get log path:', error)
    statusMessage.value = 'Error: Could not fetch log path.'
  }
}

// Function to handle directory selection for Game.log
const handleSelectLogDirectory = async () => {
  setStatus('Opening directory selection...');
  if (!window.logMonitorApi?.selectLogDirectory) {
      setStatus('Error: Cannot open directory dialog.');
      return;
  }
  try {
    const selectedPath = await window.logMonitorApi.selectLogDirectory()
    if (selectedPath) {
      currentPath.value = selectedPath
      setStatus(`Log Directory updated.`);
    } else {
      setStatus('Selection cancelled.');
    }
  } catch (error) {
    console.error('Error selecting log directory:', error)
    setStatus('Error opening directory dialog.');
  }
}

// Load settings on component mount
onMounted(async () => {
  updateLogPath()

  // Load the last logged in user
  try {
    if (window.logMonitorApi?.getLastLoggedInUser) {
        const user = await window.logMonitorApi.getLastLoggedInUser();
        if (user) {
            lastLoggedInUser.value = user;
        }
    }
  } catch (error) {
    console.error('Failed to get last logged in user:', error)
  }

  // Load notification preferences
  try {
    if (window.logMonitorApi?.getNotificationSettings) {
        showNotifications.value = await window.logMonitorApi.getNotificationSettings();
    }
  } catch (error) {
    console.error('Failed to get notification settings:', error)
  }

  // Load profile data settings
  try {
     if (window.logMonitorApi?.getFetchProfileData) {
        fetchProfileData.value = await window.logMonitorApi.getFetchProfileData();
        console.log('Loaded fetch profile data setting:', fetchProfileData.value);
     } else { fetchProfileData.value = true; }
  } catch (error) {
    console.error('Failed to get profile data settings:', error)
    fetchProfileData.value = true
  }

  // Load sound effects settings
  try {
    if (window.logMonitorApi?.getSoundEffects) {
        playSoundEffects.value = await window.logMonitorApi.getSoundEffects();
        console.log('Loaded sound effects setting:', playSoundEffects.value);
    } else { playSoundEffects.value = true; }
  } catch (error) {
    console.error('Failed to get sound effects settings:', error)
    playSoundEffects.value = true
  }

  // Load API Settings
  try {
    if (window.logMonitorApi?.getApiSettings) {
        const apiSettings = await window.logMonitorApi.getApiSettings();
        offlineMode.value = apiSettings.offlineMode;
    }
  } catch (error) {
    console.error('Failed to get API settings:', error)
    setStatus('Error loading API settings.');
  }

  // Load CSV Log Path
  try {
    if (window.logMonitorApi?.getCsvLogPath) {
        csvLogPath.value = await window.logMonitorApi.getCsvLogPath();
    }
  } catch (error) {
    console.error('Failed to get CSV log path:', error)
    setStatus('Error loading CSV log path.');
  }

  // Update auth status when component mounts
  await updateAuthStatus();

  // Load launch on startup setting
  try {
    if (window.logMonitorApi?.getLaunchOnStartup) {
      launchOnStartup.value = await window.logMonitorApi.getLaunchOnStartup();
    } else {
      launchOnStartup.value = true;
    }
  } catch (error) {
    console.error('Failed to get launch on startup setting:', error);
    launchOnStartup.value = true;
  }

  // Load application version
  try {
    if (window.logMonitorApi?.getAppVersion) {
        version.value = await window.logMonitorApi.getAppVersion();
    }
  } catch (error) {
    console.error('Failed to get app version:', error);
    version.value = 'Error loading version';
  }

  // Load guest mode status
  try {
    if (window.logMonitorApi?.getGuestModeStatus) {
      isGuestMode.value = await window.logMonitorApi.getGuestModeStatus();
    }
  } catch (error) {
    console.error('Failed to get guest mode status:', error);
  }
});

// Account Methods
const handleLogin = async () => {
    loginLoading.value = true;
    loginError.value = '';
    if (!window.logMonitorApi?.authLogin) {
        loginError.value = 'API bridge (authLogin) not available.';
        setStatus('Login error: API bridge missing.');
        loginLoading.value = false;
        return;
    }
    try {
        setStatus('Login attempt...');
        const result = await window.logMonitorApi.authLogin(loginIdentifier.value, loginPassword.value);
        if (result.success) {
           await updateAuthStatus();
           setStatus('Login successful!');
           loginPassword.value = '';
        } else {
           loginError.value = result.error || 'Login failed.';
           setStatus('Login failed.');
        }

    } catch (err: any) {
        console.error('Login IPC error:', err);
        loginError.value = err.message || 'An error occurred.';
        setStatus('Login error.');
    } finally {
        loginLoading.value = false;
    }
};

const handleLogout = async () => {
     if (!window.logMonitorApi?.authLogout) {
        setStatus('Logout error: API bridge missing.');
        return;
     }
     try {
        setStatus('Logging out...');
        const success = await window.logMonitorApi.authLogout();
        if (success) {
           await updateAuthStatus();
           loginIdentifier.value = '';
           loginPassword.value = '';
           loginError.value = '';
           setStatus('Logged out.');
        } else {
           setStatus('Logout failed.');
        }
     } catch (err: any) {
         console.error('Logout IPC error:', err);
         setStatus('Logout error.');
     }
};

// Function to get current auth status from main process
const updateAuthStatus = async () => {
    authStatus.value = 'loading';
    if (!window.logMonitorApi?.authGetStatus) {
        authStatus.value = 'unauthenticated';
        loggedInUsername.value = null;
        console.error('Cannot get auth status: API bridge missing.');
        return;
    }
    try {
        const status = await window.logMonitorApi.authGetStatus();
        loggedInUsername.value = status.username;
        authStatus.value = status.isAuthenticated ? 'authenticated' : 'unauthenticated';
    } catch (err) {
        console.error('Error getting auth status:', err);
        authStatus.value = 'unauthenticated';
        loggedInUsername.value = null;
    }
};

// Toggle notifications setting
const toggleNotifications = async () => {
  if (!window.logMonitorApi?.setNotificationSettings) return;
  try {
    showNotifications.value = await window.logMonitorApi.setNotificationSettings(!showNotifications.value)
    setStatus(`Notifications ${showNotifications.value ? 'enabled' : 'disabled'}`)
  } catch (error) {
    console.error('Failed to update notification settings:', error)
    setStatus('Error updating notification settings')
  }
}

// Save API Settings
const saveApiSettings = async () => {
  if (!window.logMonitorApi?.setApiSettings) return;
  try {
    const success = await window.logMonitorApi.setApiSettings({
      offlineMode: offlineMode.value
    })
    setStatus(success ? 'API settings saved.' : 'Failed to save API settings.')
  } catch (error) {
    console.error('Error saving API settings:', error)
    setStatus('Error saving API settings.')
  }
}

// Save CSV Log Path
const saveCsvPath = async () => {
  if (!window.logMonitorApi?.setCsvLogPath) return;
  try {
    const success = await window.logMonitorApi.setCsvLogPath(csvLogPath.value)
    setStatus(success ? 'CSV log path saved.' : 'Failed to save CSV path.')
  } catch (error) {
    console.error('Error saving CSV log path:', error)
    setStatus('Error saving CSV log path.')
  }
}

// Toggle fetch profile data setting
const toggleFetchProfileData = async () => {
  if (!window.logMonitorApi?.setFetchProfileData) return;
  try {
    fetchProfileData.value = !fetchProfileData.value;
    const success = await window.logMonitorApi.setFetchProfileData(fetchProfileData.value);
    setStatus(success ? `Profile data fetching ${fetchProfileData.value ? 'enabled' : 'disabled'}` : 'Failed to update profile data setting');
  } catch (error) {
    console.error('Failed to update profile data setting:', error);
    setStatus('Error updating profile data setting');
  }
}

// Toggle sound effects setting
const toggleSoundEffects = async () => {
  if (!window.logMonitorApi?.setSoundEffects) return;
  try {
    playSoundEffects.value = !playSoundEffects.value;
    const success = await window.logMonitorApi.setSoundEffects(playSoundEffects.value);
    setStatus(success ? `Sound effects ${playSoundEffects.value ? 'enabled' : 'disabled'}` : 'Failed to update sound effects setting');
  } catch (error) {
    console.error('Failed to update sound effects setting:', error);
    setStatus('Error updating sound effects setting');
  }
}

// Helper to set status message and clear after delay
const setStatus = (msg: string, duration = 3000) => {
  ElNotification({
    title: 'Status',
    message: msg,
    type: 'info',
    duration: duration,
    position: 'bottom-right'
  });
  
  statusMessage.value = msg;
  setTimeout(() => {
    if (statusMessage.value === msg) {
      statusMessage.value = '';
    }
  }, duration);
};

// Toggle launch on startup setting
const toggleLaunchOnStartup = async () => {
  if (!window.logMonitorApi?.setLaunchOnStartup) return;
  try {
    const result = await window.logMonitorApi.setLaunchOnStartup(launchOnStartup.value);
    launchOnStartup.value = !!result;
    setStatus(`Launch on startup ${launchOnStartup.value ? 'enabled' : 'disabled'}`);
  } catch (error) {
    console.error('Failed to update launch on startup setting:', error);
    setStatus('Error updating launch on startup setting');
  }
};
</script>

<template>
  <div class="flex h-screen bg-theme-bg-dark text-theme-text-light font-sans overflow-hidden">
    <!-- Sidebar Navigation -->
    <aside class="w-64 bg-theme-bg-panel border-r border-theme-border flex flex-col">
      <div class="p-6 border-b border-theme-border">
        <h2 class="text-xs font-bold text-gray-400 uppercase tracking-wider">Settings</h2>
      </div>
      
      <nav class="flex-1 p-4 space-y-2">
        <button
          v-for="category in categories"
          :key="category.id"
          @click="activeCategory = category.id"
          class="w-full flex items-center gap-3 px-4 py-3 text-left rounded-lg transition-all duration-200 group"
          :class="activeCategory === category.id 
            ? 'bg-[rgb(99,99,247)]/20 text-[rgb(99,99,247)] border-l-4 border-[rgb(99,99,247)]' 
            : 'text-theme-text-light hover:bg-white/5 hover:text-theme-text-white border-l-4 border-transparent'"
        >
          <svg class="w-5 h-5 transition-colors duration-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" :d="getIcon(category.icon)"></path>
          </svg>
          <span class="font-medium">{{ category.name }}</span>
        </button>
      </nav>
    </aside>

    <!-- Main Content -->
    <main class="flex-1 overflow-y-auto">
      <div class="p-8 max-w-4xl">
        <!-- Status Message -->
        <div 
          v-if="statusMessage" 
          class="mb-6 p-4 bg-[rgb(99,99,247)]/20 border border-[rgb(99,99,247)]/30 rounded-lg text-[rgb(99,99,247)] text-sm"
        >
          {{ statusMessage }}
        </div>

        <!-- General Settings -->
        <section v-if="activeCategory === 'general'" class="space-y-6">
          <div class="mb-8">
            <h3 class="text-2xl font-bold text-theme-text-white mb-2">General Settings</h3>
            <p class="text-gray-400">Configure basic application preferences</p>
          </div>

          <div class="space-y-6">
            <!-- Log File Location -->
            <div class="bg-theme-bg-panel/80 rounded-lg p-6 border border-theme-border">
              <h4 class="text-lg font-semibold text-theme-text-white mb-4">Log File Location</h4>
              <div class="flex items-center gap-4">
                <code class="flex-1 bg-theme-bg-dark px-4 py-3 rounded border border-theme-border font-mono text-sm text-theme-text-light overflow-hidden">
                  {{ currentPath }}
                </code>
                <el-button @click="handleSelectLogDirectory" type="primary" class="px-6">
                  Change
                </el-button>
              </div>
            </div>

            <!-- Theme -->
            <div class="bg-theme-bg-panel/80 rounded-lg p-6 border border-theme-border">
              <h4 class="text-lg font-semibold text-theme-text-white mb-4">Theme</h4>
              <el-radio-group v-model="themeSelection" class="flex gap-4">
                <el-radio value="dark" class="text-theme-text-white">Dark Theme</el-radio>
                <el-radio value="light" disabled class="text-gray-500">Light Theme (Coming Soon)</el-radio>
              </el-radio-group>
            </div>

            <!-- Launch on Startup -->
            <div class="bg-theme-bg-panel/80 rounded-lg p-6 border border-theme-border">
              <div class="flex items-center justify-between mb-2">
                <h4 class="text-lg font-semibold text-theme-text-white">Launch on Startup</h4>
                <el-switch
                  v-model="launchOnStartup"
                  @change="toggleLaunchOnStartup"
                />
              </div>
              <p class="text-gray-400 text-sm">Launch the application automatically when you log in. Will start minimized to tray.</p>
            </div>

            <!-- Last Logged In User -->
            <div class="bg-theme-bg-panel/80 rounded-lg p-6 border border-theme-border">
              <h4 class="text-lg font-semibold text-theme-text-white mb-2">Last Logged In User</h4>
              <p class="text-theme-text-light">{{ lastLoggedInUser || 'None Detected' }}</p>
            </div>
          </div>
        </section>

        <!-- Kill Feed Settings -->
        <section v-if="activeCategory === 'killfeed'" class="space-y-6">
          <div class="mb-8">
            <h3 class="text-2xl font-bold text-theme-text-white mb-2">Kill Feed Settings</h3>
            <p class="text-gray-400">Configure how kill events are processed and displayed</p>
          </div>

          <div class="space-y-6">
            <!-- Fetch Profile Data -->
            <div class="bg-theme-bg-panel/80 rounded-lg p-6 border border-theme-border">
              <div class="flex items-center justify-between mb-2">
                <h4 class="text-lg font-semibold text-theme-text-white">Fetch Profile Data</h4>
                <el-switch
                  v-model="fetchProfileData"
                  @change="toggleFetchProfileData"
                />
              </div>
              <p class="text-gray-400 text-sm">Retrieves player enlistment dates, organization, etc., from the RSI website. Requires internet connection.</p>
            </div>

            <!-- Play Sound Effects -->
            <div class="bg-theme-bg-panel/80 rounded-lg p-6 border border-theme-border">
              <div class="flex items-center justify-between mb-2">
                <h4 class="text-lg font-semibold text-theme-text-white">Play Event Sounds</h4>
                <el-switch
                  v-model="playSoundEffects"
                  @change="toggleSoundEffects"
                />
              </div>
              <p class="text-gray-400 text-sm">Plays a sound effect when a new event appears in the kill feed.</p>
            </div>
          </div>
        </section>

        <!-- Notifications Settings -->
        <section v-if="activeCategory === 'notifications'" class="space-y-6">
          <div class="mb-8">
            <h3 class="text-2xl font-bold text-theme-text-white mb-2">Notifications</h3>
            <p class="text-gray-400">Configure desktop notification preferences</p>
          </div>

          <div class="bg-theme-bg-panel/80 rounded-lg p-6 border border-theme-border">
            <div class="flex items-center justify-between mb-2">
              <h4 class="text-lg font-semibold text-theme-text-white">Show Kill Notifications</h4>
              <el-switch
                v-model="showNotifications"
                @change="toggleNotifications"
              />
            </div>
            <p class="text-gray-400 text-sm">Display system notifications for kills/deaths involving your player character.</p>
          </div>
        </section>

        <!-- Data & API Settings -->
        <section v-if="activeCategory === 'data_api'" class="space-y-6">
          <div class="mb-8">
            <h3 class="text-2xl font-bold text-theme-text-white mb-2">Data & API</h3>
            <p class="text-gray-400">Configure data storage and API connectivity</p>
          </div>

          <div class="space-y-6">
            <!-- Offline Mode -->
            <div class="bg-theme-bg-panel/80 rounded-lg p-6 border border-theme-border">
              <div class="flex items-center justify-between mb-2">
                <h4 class="text-lg font-semibold text-theme-text-white">Offline Mode</h4>
                <el-switch
                  v-model="offlineMode"
                  @change="saveApiSettings"
                />
              </div>
              <p class="text-gray-400 text-sm">Disables authentication and connection to the backend server.</p>
            </div>

            <!-- CSV Log Path -->
            <div class="bg-theme-bg-panel/80 rounded-lg p-6 border border-theme-border">
              <h4 class="text-lg font-semibold text-theme-text-white mb-4">CSV Export Path</h4>
              <div class="space-y-4">
                <el-input
                  v-model="csvLogPath"
                  placeholder="Path for Kill-Log.csv"
                  class="w-full"
                />
                <el-button @click="saveCsvPath" type="primary" class="px-6">
                  Save CSV Path
                </el-button>
              </div>
            </div>
          </div>
        </section>

        <!-- Account Settings -->
        <section v-if="activeCategory === 'account'" class="space-y-6">
          <div class="mb-8">
            <h3 class="text-2xl font-bold text-theme-text-white mb-2">Account</h3>
            <p class="text-gray-400">Manage your account and authentication</p>
          </div>

          <div v-if="authStatus === 'loading'" class="bg-theme-bg-panel/80 rounded-lg p-8 border border-theme-border text-center">
            <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-[rgb(99,99,247)] mx-auto mb-4"></div>
            <p class="text-gray-400">Loading account status...</p>
          </div>

          <!-- Logged In View -->
          <div v-else-if="authStatus === 'authenticated'" class="space-y-6">
            <div class="bg-green-900/20 border border-green-500/30 rounded-lg p-6">
              <h4 class="text-lg font-semibold text-green-400 mb-2">Authenticated</h4>
              <p class="text-green-300">Logged in as: <strong>{{ loggedInUsername || 'Unknown' }}</strong></p>
            </div>

            <div class="bg-theme-bg-panel/80 rounded-lg p-6 border border-theme-border">
              <div class="flex items-center justify-between mb-2">
                <h4 class="text-lg font-semibold text-theme-text-white">Guest Mode Status</h4>
                <el-tag :type="isGuestMode ? 'warning' : 'success'">
                  {{ isGuestMode ? 'Active' : 'Inactive' }}
                </el-tag>
              </div>
              <p class="text-gray-400 text-sm">Shows whether the application is currently running in guest mode.</p>
            </div>

            <!-- User State Debug Section -->
            <div class="bg-theme-bg-panel/80 rounded-lg p-6 border border-theme-border">
              <h4 class="text-lg font-semibold text-theme-text-white mb-4">User State Debug</h4>
              <div class="space-y-3 text-sm font-mono">
                <div class="grid grid-cols-1 gap-2">
                  <div class="flex">
                    <span class="text-gray-400 w-32">Username:</span>
                    <span class="text-theme-text-light">{{ userState.username || 'null' }}</span>
                  </div>
                  <div class="flex">
                    <span class="text-gray-400 w-32">RSI Handle:</span>
                    <span class="text-theme-text-light">{{ userState.rsiHandle || 'null' }}</span>
                  </div>
                  <div class="flex">
                    <span class="text-gray-400 w-32">RSI Moniker:</span>
                    <span class="text-theme-text-light">{{ userState.rsiMoniker || 'null' }}</span>
                  </div>
                  <div class="flex">
                    <span class="text-gray-400 w-32">Authenticated:</span>
                    <span class="text-theme-text-light">{{ userState.isAuthenticated }}</span>
                  </div>
                  <div class="flex">
                    <span class="text-gray-400 w-32">Roles:</span>
                    <span class="text-theme-text-light">{{ userState.roles?.join(', ') || 'none' }}</span>
                  </div>
                  <div class="flex flex-col">
                    <span class="text-gray-400 w-32 mb-1">Avatar URL:</span>
                    <div class="pl-4">
                      <div class="break-all text-xs text-theme-text-light bg-theme-bg-dark p-2 rounded border">
                        {{ userState.avatar || 'null' }}
                      </div>
                      <div v-if="userState.avatar" class="mt-2">
                        <span class="text-gray-400 text-xs">Avatar Preview:</span>
                        <div class="mt-1">
                          <img 
                            :src="userState.avatar" 
                            alt="Avatar" 
                            class="w-12 h-12 rounded border-2 border-theme-border"
                            @error="(e) => { 
                              console.error('Settings avatar preview FAILED to load:', userState.avatar); 
                              console.error('Error event:', e);
                              console.error('Image element:', e.target);
                            }"
                            @load="() => console.log('Settings avatar preview loaded successfully:', userState.avatar)"
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <el-button @click="handleLogout" type="danger" class="px-6">
              Logout
            </el-button>
          </div>

          <!-- Logged Out View -->
          <div v-else class="space-y-6">
            <div class="bg-theme-bg-panel/80 rounded-lg p-6 border border-theme-border">
              <p class="text-gray-400 mb-6">Log in to sync settings and potentially link activity across devices (feature pending).</p>
              
              <div class="space-y-4">
                <div>
                  <label class="block text-sm font-medium text-theme-text-light mb-2">Username or Email</label>
                  <el-input
                    v-model="loginIdentifier"
                    placeholder="your_handle / user@email.com"
                    :disabled="loginLoading"
                  />
                </div>
                
                <div>
                  <label class="block text-sm font-medium text-theme-text-light mb-2">Password</label>
                  <el-input
                    v-model="loginPassword"
                    type="password"
                    placeholder="********"
                    :disabled="loginLoading"
                    show-password
                  />
                </div>
                
                <p v-if="loginError" class="text-red-400 text-sm">{{ loginError }}</p>
                
                <el-button 
                  @click="handleLogin" 
                  type="primary" 
                  :loading="loginLoading"
                  class="px-6"
                >
                  {{ loginLoading ? 'Logging in...' : 'Login' }}
                </el-button>
              </div>
            </div>
          </div>
        </section>

        <!-- Debug Section -->
        <section v-if="activeCategory === 'debug'" class="space-y-6">
          <div class="mb-8">
            <h3 class="text-2xl font-bold text-theme-text-white mb-2">Debug Actions</h3>
            <p class="text-gray-400">Development and testing utilities</p>
          </div>

          <DebugActions />
        </section>

        <!-- About Section -->
        <section v-if="activeCategory === 'about'" class="space-y-6">
          <div class="mb-8">
            <h3 class="text-2xl font-bold text-theme-text-white mb-2">About</h3>
            <p class="text-gray-400">Application information and version details</p>
          </div>

          <div class="bg-theme-bg-panel/80 rounded-lg p-6 border border-theme-border">
            <h4 class="text-lg font-semibold text-theme-text-white mb-2">Application Version</h4>
            <p class="text-theme-text-light font-mono">{{ version }}</p>
          </div>
        </section>
      </div>
    </main>
  </div>
</template>

<style>
/* Element Plus overrides to match application theme */
:deep(.el-switch.is-checked .el-switch__core) {
  background-color: rgb(99, 99, 247) !important;
  border-color: rgb(99, 99, 247) !important;
}

:deep(.el-switch__core) {
  background-color: var(--color-theme-border) !important;
  border-color: var(--color-theme-border) !important;
}

:deep(.el-radio__input.is-checked .el-radio__inner) {
  background-color: rgb(99, 99, 247) !important;
  border-color: rgb(99, 99, 247) !important;
}

:deep(.el-radio__inner) {
  background-color: transparent !important;
  border-color: var(--color-theme-border) !important;
}

:deep(.el-radio__label) {
  color: currentColor !important;
}

:deep(.el-input__wrapper) {
  background-color: var(--color-theme-bg-dark) !important;
  border-color: var(--color-theme-border) !important;
  box-shadow: 0 0 0 1px var(--color-theme-border) inset !important;
}

:deep(.el-input.is-focus .el-input__wrapper) {
  border-color: rgb(99, 99, 247) !important;
  box-shadow: 0 0 0 1px rgb(99, 99, 247) inset !important;
}

:deep(.el-input__inner) {
  color: var(--color-theme-text-light) !important;
}

:deep(.el-input__inner::placeholder) {
  color: #6b7280 !important;
}

:deep(.el-button--primary) {
  background-color: rgb(99, 99, 247) !important;
  border-color: rgb(99, 99, 247) !important;
}

:deep(.el-button--primary:hover) {
  background-color: rgb(77, 77, 234) !important;
  border-color: rgb(77, 77, 234) !important;
}

:deep(.el-button--danger) {
  background-color: #dc2626 !important;
  border-color: #dc2626 !important;
}

:deep(.el-button--danger:hover) {
  background-color: #b91c1c !important;
  border-color: #b91c1c !important;
}

:deep(.el-tag--warning) {
  background-color: rgba(251, 191, 36, 0.2) !important;
  color: #fbbf24 !important;
  border-color: rgba(251, 191, 36, 0.3) !important;
}

:deep(.el-tag--success) {
  background-color: rgba(34, 197, 94, 0.2) !important;
  color: #22c55e !important;
  border-color: rgba(34, 197, 94, 0.3) !important;
}

/* Hide default Element Plus notification styles that conflict */
:deep(.el-notification) {
  background-color: var(--color-theme-bg-panel) !important;
  border-color: var(--color-theme-border) !important;
  color: var(--color-theme-text-light) !important;
}

:deep(.el-notification .el-notification__title) {
  color: var(--color-theme-text-white) !important;
}

:deep(.el-notification .el-notification__content) {
  color: var(--color-theme-text-light) !important;
}
</style>