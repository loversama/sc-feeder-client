import { ref, readonly, onMounted, onUnmounted } from 'vue'

interface UserState {
  username: string
  rsiHandle: string | null
  rsiMoniker: string | null
  avatar: string
  isAuthenticated: boolean
  lastLoggedInUser: string
}

// Create a reactive state
const state = ref<UserState>({
  username: '',
  rsiHandle: '',
  rsiMoniker: null,
  avatar: '',
  isAuthenticated: false,
  lastLoggedInUser: ''
})

export function useUserState() {

  // --- State ---
  const state = ref<UserState>({
    username: '',
    rsiHandle: '',
    rsiMoniker: null,
    avatar: '',
    isAuthenticated: false,
    lastLoggedInUser: ''
  })

  // --- Methods ---

  // Load initial state and sync with server profile if authenticated
  async function loadProfile() {
    try {
      // Get last logged in user (for guest mode display)
      if (window.logMonitorApi?.getLastLoggedInUser) {
        const lastUser = await window.logMonitorApi.getLastLoggedInUser()
        if (lastUser) {
          state.value.lastLoggedInUser = lastUser
          state.value.username = lastUser // Default to last logged in user
        }
      }

      // Check auth status
      if (window.logMonitorApi?.authGetStatus) {
        const status = await window.logMonitorApi.authGetStatus()
        state.value.isAuthenticated = status.isAuthenticated

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
    }
  }

  // Sync profile data from the server
  async function syncProfile() {
    try {
      if (window.logMonitorApi?.getProfile) {
        const profile = await window.logMonitorApi.getProfile()
        if (profile) {
          state.value.username = profile.username
          state.value.rsiHandle = profile.rsiHandle
          state.value.rsiMoniker = profile.rsiMoniker
          state.value.avatar = profile.avatar || ''
          state.value.isAuthenticated = true
        } else {
          // If profile data not found, use last known username
          state.value.username = state.value.lastLoggedInUser || 'User'
          state.value.rsiHandle = ''
          state.value.rsiMoniker = null
          state.value.avatar = ''
        }
      } else {
        console.warn('logMonitorApi.getProfile not available')
        state.value.username = state.value.lastLoggedInUser || 'User'
        state.value.rsiHandle = ''
        state.value.avatar = ''
      }
    } catch (error) {
      console.error('Failed to sync profile:', error)
      // On error, keep authenticated state but reset profile data
      state.value.username = state.value.lastLoggedInUser || 'User'
      state.value.rsiHandle = ''
      state.value.avatar = ''
    }
  }


  // Reset state to guest mode
  function reset() {
    state.value.username = state.value.lastLoggedInUser || 'User' // Default to 'User' if no last user
    state.value.rsiHandle = '' // No RSI handle in guest mode
    state.value.rsiMoniker = null // No RSI moniker in guest mode
    state.value.avatar = '' // No avatar in guest mode
    state.value.isAuthenticated = false
  }

  // Update auth status and trigger profile sync if authenticated
  async function updateAuthStatus() {
    try {
      const status = await window.logMonitorApi?.authGetStatus()
      if (status) {
        state.value.isAuthenticated = status.isAuthenticated
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
    }
  }

  // --- Event Listener Setup ---
  const handleAuthStatusChange = (event: any, status: { isAuthenticated: boolean; username: string | null; userId: string | null }) => {
    console.log('Received auth-status-changed event:', status)
    state.value.isAuthenticated = status.isAuthenticated
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
    state: readonly(state),
    loadProfile,
    reset,
    updateAuthStatus, // Keep this in case manual update is needed elsewhere
    syncProfile // Expose syncProfile for manual triggering if needed
  }
}