import { defineStore } from 'pinia'

export interface UserProfile {
  username: string
  rsiHandle: string
  avatar: string
  isAuthenticated: boolean
  lastLoggedInUser: string
}

export const useUserStore = defineStore('user', {
  state: () => ({
    username: '',
    rsiHandle: '',
    avatar: '',
    isAuthenticated: false,
    lastLoggedInUser: ''
  } as UserProfile),

  actions: {
    async loadProfile() {
      try {
        // First try to get the last logged in user
        if (window.logMonitorApi?.getLastLoggedInUser) {
          const lastUser = await window.logMonitorApi.getLastLoggedInUser()
          if (lastUser) {
            this.lastLoggedInUser = lastUser
            this.username = lastUser
          }
        }

        // Then check auth status
        if (window.logMonitorApi?.authGetStatus) {
          const status = await window.logMonitorApi.authGetStatus()
          this.isAuthenticated = status.isAuthenticated
          if (status.isAuthenticated && status.username) {
            this.username = status.username
            // When authenticated, sync with server profile
            await this.syncProfile()
          }
        }
      } catch (error) {
        console.error('Failed to load user profile:', error)
      }
    },

    async syncProfile() {
      try {
        // Call the API endpoint to get full profile data
        const profile = await window.logMonitorApi?.getProfile()
        if (profile) {
          this.username = profile.username
          this.rsiHandle = profile.rsiHandle
          this.avatar = profile.avatar
        }
      } catch (error) {
        console.error('Failed to sync profile:', error)
      }
    },

    reset() {
      this.username = this.lastLoggedInUser
      this.rsiHandle = ''
      this.avatar = ''
      this.isAuthenticated = false
    }
  }
})