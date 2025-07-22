import { ref, readonly, onMounted, onUnmounted } from 'vue'

interface UserState {
  username: string
  rsiHandle: string | null
  rsiMoniker: string | null
  avatar: string
  isAuthenticated: boolean
  lastLoggedInUser: string
  roles: string[]
  isAuthLoading: boolean // Add loading state for race condition fix
}

// Create a SINGLE reactive state (fix for dual state bug)
const globalState = ref<UserState>({
  username: '',
  rsiHandle: '',
  rsiMoniker: null,
  avatar: '',
  isAuthenticated: false,
  lastLoggedInUser: '',
  roles: [],
  isAuthLoading: true // Start as loading
})

export function useUserState() {
  // Use the global state instead of creating a new one

  // --- Methods ---

  // Load initial state and sync with server profile if authenticated
  async function loadProfile() {
    try {
      globalState.value.isAuthLoading = true // Set loading state
      
      // Get last logged in user (for guest mode display)
      if (window.logMonitorApi?.getLastLoggedInUser) {
        const lastUser = await window.logMonitorApi.getLastLoggedInUser()
        if (lastUser) {
          globalState.value.lastLoggedInUser = lastUser
          globalState.value.username = lastUser // Default to last logged in user
        }
      }

      // Check auth status
      if (window.logMonitorApi?.authGetStatus) {
        const status = await window.logMonitorApi.authGetStatus()
        globalState.value.isAuthenticated = status.isAuthenticated

        if (status.isAuthenticated && status.username) {
          // If authenticated, fetch full profile from server
          await syncProfile() // Sync profile for the authenticated user
        } else {
          // If not authenticated, reset to guest state
          reset()
        }
      }
    } catch (error) {
      console.error('Failed to load user profile:', error)
      reset() // Ensure state is reset on error
    } finally {
      globalState.value.isAuthLoading = false // Clear loading state
    }
  }

  // Sync profile data from the server
  async function syncProfile() {
    try {
      if (window.logMonitorApi?.getProfile) {
        const profile = await window.logMonitorApi.getProfile()
        if (profile) {
          globalState.value.username = profile.username
          globalState.value.rsiHandle = profile.rsiHandle
          globalState.value.rsiMoniker = profile.rsiMoniker
          globalState.value.avatar = profile.avatar || ''
          globalState.value.roles = profile.roles || ['user']
          globalState.value.isAuthenticated = true
          console.log(`[useUserState] Profile synced for ${profile.username} with roles: [${profile.roles?.join(', ')}]`)
        } else {
          // If profile data not found, use last known username
          globalState.value.username = globalState.value.lastLoggedInUser || 'User'
          globalState.value.rsiHandle = ''
          globalState.value.rsiMoniker = null
          globalState.value.avatar = ''
          globalState.value.roles = []
        }
      } else {
        console.warn('logMonitorApi.getProfile not available')
        globalState.value.username = globalState.value.lastLoggedInUser || 'User'
        globalState.value.rsiHandle = ''
        globalState.value.avatar = ''
        globalState.value.roles = []
      }
    } catch (error) {
      console.error('Failed to sync profile:', error)
      // On error, keep authenticated state but reset profile data
      globalState.value.username = globalState.value.lastLoggedInUser || 'User'
      globalState.value.rsiHandle = ''
      globalState.value.avatar = ''
      globalState.value.roles = []
    }
  }


  // Reset state to guest mode
  function reset() {
    globalState.value.username = globalState.value.lastLoggedInUser || 'Guest' // Standardize to 'Guest'
    globalState.value.rsiHandle = '' // No RSI handle in guest mode
    globalState.value.rsiMoniker = null // No RSI moniker in guest mode
    globalState.value.avatar = '' // No avatar in guest mode
    globalState.value.roles = [] // No roles in guest mode
    globalState.value.isAuthenticated = false
  }

  // Update auth status and trigger profile sync if authenticated
  async function updateAuthStatus() {
    try {
      globalState.value.isAuthLoading = true
      const status = await window.logMonitorApi?.authGetStatus()
      if (status) {
        globalState.value.isAuthenticated = status.isAuthenticated
        if (status.isAuthenticated && status.username) {
          // If authenticated, sync profile data
          await syncProfile()
        } else {
          // If not authenticated, reset to guest state
          reset()
        }
      } else {
         reset() // Reset if status cannot be retrieved
      }
    } catch (error) {
      console.error('Failed to update auth status:', error)
      reset() // Reset on error
    } finally {
      globalState.value.isAuthLoading = false
    }
  }

  // --- Event Listener Setup ---
  const handleAuthStatusChange = (event: any, status: { isAuthenticated: boolean; username: string | null; userId: string | null }) => {
    console.log('Received auth-status-changed event:', status)
    globalState.value.isAuthenticated = status.isAuthenticated
    if (status.isAuthenticated) {
      // If authenticated, sync profile data
      syncProfile()
    } else {
      // If not authenticated, reset to guest state
      reset()
    }
  }

  onMounted(() => {
    // Load initial profile when component mounts
    loadProfile()

    // Listen for auth status changes from the main process
    if (window.logMonitorApi?.onAuthStatusChanged) {
      window.logMonitorApi.onAuthStatusChanged(handleAuthStatusChange)
      console.log('Auth status change listener registered.')
    } else {
      console.warn('window.logMonitorApi.onAuthStatusChanged not available.')
    }
  })

  onUnmounted(() => {
    // Clean up listener when component unmounts
    // Assuming the API provides a way to remove the listener, e.g., removeAuthStatusChangedListener
    // If not, this might lead to memory leaks if the composable is used in components that are frequently mounted/unmounted.
    // For now, we'll assume the API handles this or it's a top-level composable.
    // Example cleanup (needs corresponding API method):
    // if (window.logMonitorApi?.removeAuthStatusChangedListener) {
    //   window.logMonitorApi.removeAuthStatusChangedListener(handleAuthStatusChange);
    //   console.log('Auth status change listener removed.');
    // }
  })

  // --- Return ---
  // Return readonly state and methods
  return {
    state: readonly(globalState),
    loadProfile,
    reset,
    updateAuthStatus, // Keep this in case manual update is needed elsewhere
    syncProfile // Expose syncProfile for manual triggering if needed
  }
}