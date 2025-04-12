<script setup lang="ts">
console.log('[SettingsWindow.vue] <script setup> executing...'); // Add early log
import { ref, onMounted } from 'vue';

// State for the active category
const activeCategory = ref<string>('general'); // Default to 'general'

// Define categories for the sidebar
const categories = ref([
  { id: 'general', name: 'GENERAL' },
  { id: 'killfeed', name: 'KILL FEED' },
  { id: 'notifications', name: 'NOTIFICATIONS' },
  { id: 'data_api', name: 'DATA & API' },
  { id: 'account', name: 'ACCOUNT' }, // Add Account category
  { id: 'about', name: 'ABOUT' },
]);

// Existing state variables
const currentPath = ref<string>('Loading...');
const lastLoggedInUser = ref<string>('None');
const showNotifications = ref<boolean>(true);
const playSoundEffects = ref<boolean>(true);
const statusMessage = ref<string>('');
const apiUrl = ref<string>('');
const apiKey = ref<string>('');
const offlineMode = ref<boolean>(false);
const csvLogPath = ref<string>('');
const fetchProfileData = ref<boolean>(true);

// --- Account State ---
const loginIdentifier = ref<string>('');
const loginPassword = ref<string>('');
const loginError = ref<string>('');
const loginLoading = ref<boolean>(false);
const authStatus = ref<'loading' | 'authenticated' | 'unauthenticated'>('loading');
const loggedInUsername = ref<string | null>(null);

// Fetch the current log path
const updateLogPath = async () => {
  try {
    // Use specific API if available, otherwise handle error
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
  setStatus('Opening directory selection...'); // Use setStatus
  if (!window.logMonitorApi?.selectLogDirectory) {
      setStatus('Error: Cannot open directory dialog.');
      return;
  }
  try {
    const selectedPath = await window.logMonitorApi.selectLogDirectory()
    if (selectedPath) {
      currentPath.value = selectedPath
      setStatus(`Log Directory updated.`); // Use setStatus
    } else {
      setStatus('Selection cancelled.'); // Use setStatus
    }
  } catch (error) {
    console.error('Error selecting log directory:', error)
    setStatus('Error opening directory dialog.'); // Use setStatus
  }
}

// Load settings on component mount
onMounted(async () => {
  updateLogPath()

  // Load the last logged in user (assuming this is still relevant or needs update)
  try {
    if (window.logMonitorApi?.getLastLoggedInUser) {
        const user = await window.logMonitorApi.getLastLoggedInUser();
        if (user) {
            lastLoggedInUser.value = user; // Keep this for display?
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
     } else { fetchProfileData.value = true; } // Default
  } catch (error) {
    console.error('Failed to get profile data settings:', error)
    fetchProfileData.value = true // Default
  }

  // Load sound effects settings
  try {
    if (window.logMonitorApi?.getSoundEffects) {
        playSoundEffects.value = await window.logMonitorApi.getSoundEffects();
        console.log('Loaded sound effects setting:', playSoundEffects.value);
    } else { playSoundEffects.value = true; } // Default
  } catch (error) {
    console.error('Failed to get sound effects settings:', error)
    playSoundEffects.value = true // Default
  }

  // Load API Settings
  try {
    if (window.logMonitorApi?.getApiSettings) {
        const apiSettings = await window.logMonitorApi.getApiSettings();
        apiUrl.value = apiSettings.apiUrl;
        apiKey.value = apiSettings.apiKey;
        offlineMode.value = apiSettings.offlineMode;
    }
  } catch (error) {
    console.error('Failed to get API settings:', error)
    setStatus('Error loading API settings.'); // Use setStatus
  }

  // Load CSV Log Path
  try {
    if (window.logMonitorApi?.getCsvLogPath) {
        csvLogPath.value = await window.logMonitorApi.getCsvLogPath();
    }
  } catch (error) {
    console.error('Failed to get CSV log path:', error)
    setStatus('Error loading CSV log path.'); // Use setStatus
  }

  // Update auth status when component mounts
  await updateAuthStatus();
});

// --- Account Methods ---
const handleLogin = async () => {
    loginLoading.value = true;
    loginError.value = '';
    if (!window.logMonitorApi?.authLogin) { // Check for specific function
        loginError.value = 'API bridge (authLogin) not available.';
        setStatus('Login error: API bridge missing.');
        loginLoading.value = false;
        return;
    }
    try {
        setStatus('Login attempt...');
        const result = await window.logMonitorApi.authLogin(loginIdentifier.value, loginPassword.value); // Use specific function
        if (result.success) {
           await updateAuthStatus(); // Refresh status after login
           setStatus('Login successful!');
           loginPassword.value = ''; // Clear password field on success
           // Don't pre-fill identifier after successful login
           // loginIdentifier.value = loggedInUsername.value || '';
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
     if (!window.logMonitorApi?.authLogout) { // Check for specific function
        setStatus('Logout error: API bridge missing.');
        return;
     }
     try {
        setStatus('Logging out...');
        const success = await window.logMonitorApi.authLogout(); // Use specific function
        if (success) { // Assuming logout returns boolean or throws error
           await updateAuthStatus(); // Refresh status
           loginIdentifier.value = ''; // Clear login form
           loginPassword.value = '';
           loginError.value = '';
           setStatus('Logged out.');
        } else {
           setStatus('Logout failed.'); // Or handle specific errors if returned
        }
     } catch (err: any) {
         console.error('Logout IPC error:', err);
         setStatus('Logout error.');
     }
};

// Function to get current auth status from main process
const updateAuthStatus = async () => {
    authStatus.value = 'loading';
    if (!window.logMonitorApi?.authGetStatus) { // Check for specific function
        authStatus.value = 'unauthenticated';
        loggedInUsername.value = null;
        console.error('Cannot get auth status: API bridge missing.');
        return;
    }
    try {
        const status = await window.logMonitorApi.authGetStatus(); // Use specific function
        loggedInUsername.value = status.username;
        authStatus.value = status.isAuthenticated ? 'authenticated' : 'unauthenticated';
    } catch (err) {
        console.error('Error getting auth status:', err);
        authStatus.value = 'unauthenticated'; // Assume logged out on error
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
    // Update offlineMode based on checkbox before saving
    const success = await window.logMonitorApi.setApiSettings({
      apiUrl: apiUrl.value,
      apiKey: apiKey.value,
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
  statusMessage.value = msg;
  setTimeout(() => {
    if (statusMessage.value === msg) { // Clear only if it hasn't been overwritten
      statusMessage.value = '';
    }
  }, duration);
};

</script>

<template>
  <div class="settings-container">
    <!-- Sidebar Navigation -->
    <aside class="settings-sidebar">
      <h2 class="sidebar-title">SETTINGS</h2>
      <nav class="sidebar-nav">
        <ul>
          <li
            v-for="category in categories"
            :key="category.id"
            :class="{ active: activeCategory === category.id }"
            @click="activeCategory = category.id"
          >
            {{ category.name }}
          </li>
        </ul>
      </nav>
    </aside>

    <!-- Main Settings Content -->
    <main class="settings-content">
      <!-- General Settings -->
      <section v-if="activeCategory === 'general'">
        <h3 class="content-title">GENERAL</h3>

        <!-- Log File Location -->
        <div class="setting-item">
          <label class="setting-name">Log File Location</label>
          <div class="setting-control file-path-control">
            <code class="file-path">{{ currentPath }}</code>
            <button @click="handleSelectLogDirectory" class="action-button">Change</button>
          </div>
        </div>

        <!-- Theme (Example - Not functional yet) -->
        <div class="setting-item">
          <label class="setting-name">Theme</label>
          <div class="setting-control radio-group">
            <label><input type="radio" name="theme" value="dark" checked> Dark</label>
            <label><input type="radio" name="theme" value="light" disabled> Light</label>
          </div>
        </div>

        <!-- Language (Example - Not functional yet) -->
        <div class="setting-item">
          <label class="setting-name">Language</label>
          <div class="setting-control select-control">
            <span>English</span>
            <span class="arrow">›</span>
          </div>
        </div>

        <!-- Last Logged In User -->
        <div class="setting-item">
          <label class="setting-name">Last Logged In User</label>
          <div class="setting-control">
            <span>{{ lastLoggedInUser || 'None Detected' }}</span>
          </div>
        </div>
      </section>

      <!-- Kill Feed Settings -->
      <section v-if="activeCategory === 'killfeed'">
        <h3 class="content-title">KILL FEED</h3>

        <!-- Fetch Profile Data -->
        <div class="setting-item">
          <label class="setting-name">Fetch Profile Data</label>
          <div class="setting-control">
            <label class="switch">
              <input type="checkbox" v-model="fetchProfileData" @change="toggleFetchProfileData">
              <span class="slider round"></span>
            </label>
          </div>
        </div>
        <div class="setting-description">
          Retrieves player enlistment dates, organization, etc., from the RSI website. Requires internet connection.
        </div>

        <!-- Play Sound Effects -->
        <div class="setting-item">
          <label class="setting-name">Play Event Sounds</label>
          <div class="setting-control">
            <label class="switch">
              <input type="checkbox" v-model="playSoundEffects" @change="toggleSoundEffects">
              <span class="slider round"></span>
            </label>
          </div>
        </div>
        <div class="setting-description">
          Plays a sound effect when a new event appears in the kill feed.
        </div>
      </section>

      <!-- Notifications Settings -->
      <section v-if="activeCategory === 'notifications'">
        <h3 class="content-title">NOTIFICATIONS</h3>

        <!-- Show Kill Notifications -->
        <div class="setting-item">
          <label class="setting-name">Show Kill Notifications</label>
          <div class="setting-control">
            <label class="switch">
              <input type="checkbox" v-model="showNotifications" @change="toggleNotifications">
              <span class="slider round"></span>
            </label>
          </div>
        </div>
        <div class="setting-description">
          Display system notifications for kills/deaths involving your player character.
        </div>
      </section>

      <!-- Data & API Settings -->
      <section v-if="activeCategory === 'data_api'">
        <h3 class="content-title">DATA & API</h3>

        <!-- API URL -->
        <div class="setting-item">
          <label class="setting-name" for="apiUrl">API URL</label>
          <div class="setting-control">
            <input type="text" id="apiUrl" v-model="apiUrl" class="text-input" placeholder="Optional: API endpoint URL">
          </div>
        </div>

        <!-- API Key -->
        <div class="setting-item">
          <label class="setting-name" for="apiKey">API Key</label>
          <div class="setting-control">
            <input type="password" id="apiKey" v-model="apiKey" class="text-input" placeholder="Optional: API key">
          </div>
        </div>

        <!-- Offline Mode -->
        <div class="setting-item">
          <label class="setting-name">Offline Mode</label>
          <div class="setting-control">
            <label class="switch">
              <input type="checkbox" v-model="offlineMode" @change="saveApiSettings"> <!-- Save on change -->
              <span class="slider round"></span>
            </label>
          </div>
        </div>
        <div class="setting-description">
          Disables sending any data to the API URL specified above.
        </div>

        <!-- Save API Button -->
        <div class="setting-item action-item">
          <button @click="saveApiSettings" class="action-button">Save API Settings</button>
        </div>

        <!-- CSV Log Path -->
        <div class="setting-item">
          <label class="setting-name" for="csvPath">CSV Log Path</label>
          <div class="setting-control">
            <input type="text" id="csvPath" v-model="csvLogPath" class="text-input" placeholder="Path for Kill-Log.csv">
          </div>
        </div>

        <!-- Save CSV Button -->
        <div class="setting-item action-item">
          <button @click="saveCsvPath" class="action-button">Save CSV Path</button>
        </div>

        <!-- Delete Data (Example - Not functional yet) -->
        <div class="setting-item action-item">
          <label class="setting-name">Delete All Data</label>
          <div class="setting-control">
            <button class="action-button danger-button" disabled>Delete</button>
          </div>
        </div>
      </section>

      <!-- About Section -->
      <section v-if="activeCategory === 'about'">
        <h3 class="content-title">ABOUT</h3>
        <div class="about-content">
          <p><strong>SC KillFeeder</strong></p>
          <p>Version: 1.0.2 (Placeholder)</p>
          <p>Developed by: [Your Name/Alias]</p>
          <p>This application monitors your Star Citizen Game.log file to provide a real-time feed of combat and other significant events.</p>
        </div>
      </section>

      <!-- Account Settings -->
      <section v-if="activeCategory === 'account'">
          <h3 class="content-title">ACCOUNT</h3>

          <div v-if="authStatus === 'loading'" class="loading-state">Loading account status...</div>

          <!-- Logged In View -->
          <div v-else-if="authStatus === 'authenticated'">
              <div class="setting-item">
                  <label class="setting-name">Status</label>
                  <div class="setting-control">
                      <span>Logged in as: <strong>{{ loggedInUsername || 'Unknown' }}</strong></span>
                  </div>
              </div>
              <div class="setting-item action-item">
                  <button @click="handleLogout" class="action-button danger-button">Logout</button>
              </div>
          </div>

          <!-- Logged Out View -->
          <div v-else>
              <p class="setting-description">Log in to sync settings and potentially link activity across devices (feature pending).</p>
              <div class="setting-item">
                  <label class="setting-name" for="loginIdentifier">Username or Email</label>
                  <div class="setting-control">
                      <input type="text" id="loginIdentifier" v-model="loginIdentifier" class="text-input" placeholder="your_handle / user@email.com" :disabled="loginLoading">
                  </div>
              </div>
              <div class="setting-item">
                  <label class="setting-name" for="loginPassword">Password</label>
                  <div class="setting-control">
                      <input type="password" id="loginPassword" v-model="loginPassword" class="text-input" placeholder="********" :disabled="loginLoading">
                  </div>
              </div>
               <p v-if="loginError" class="error-message">{{ loginError }}</p>
              <div class="setting-item action-item">
                  <button @click="handleLogin" class="action-button" :disabled="loginLoading">
                      {{ loginLoading ? 'Logging in...' : 'Login' }}
                  </button>
                  <!-- TODO: Add Register link/button? -->
              </div>
          </div>
      </section>

      <!-- Status Message Area -->
      <div class="status-message" v-if="statusMessage">
        {{ statusMessage }}
      </div>
    </main>
  </div>
</template>

<!-- <style scoped> block removed for testing -->