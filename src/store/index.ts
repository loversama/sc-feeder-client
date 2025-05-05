import { createStore, Store as VuexStore, ActionContext } from 'vuex'

export interface UserState {
  username: string
  rsiHandle: string
  avatar: string
  isAuthenticated: boolean
  lastLoggedInUser: string
}

interface Mutations {
  setUsername(state: UserState, username: string): void
  setRsiHandle(state: UserState, handle: string): void
  setAvatar(state: UserState, avatar: string): void
  setIsAuthenticated(state: UserState, isAuth: boolean): void
  setLastLoggedInUser(state: UserState, user: string): void
  reset(state: UserState): void
}

interface Actions {
  loadProfile(context: ActionContext<UserState, UserState>): Promise<void>
}

export type Store = VuexStore<UserState>

export default createStore<UserState>({
  state: {
    username: '',
    rsiHandle: '',
    avatar: '',
    isAuthenticated: false,
    lastLoggedInUser: ''
  },

  mutations: {
    setUsername(state: UserState, username: string) {
      state.username = username
    },
    setRsiHandle(state: UserState, handle: string) {
      state.rsiHandle = handle
    },
    setAvatar(state: UserState, avatar: string) {
      state.avatar = avatar
    },
    setIsAuthenticated(state: UserState, isAuth: boolean) {
      state.isAuthenticated = isAuth
    },
    setLastLoggedInUser(state: UserState, user: string) {
      state.lastLoggedInUser = user
    },
    reset(state: UserState) {
      state.username = state.lastLoggedInUser
      state.rsiHandle = ''
      state.avatar = ''
      state.isAuthenticated = false
    }
  },

  actions: {
    async loadProfile({ commit }: ActionContext<UserState, UserState>) {
      try {
        // First try to get the last logged in user
        if (window.logMonitorApi?.getLastLoggedInUser) {
          const lastUser = await window.logMonitorApi.getLastLoggedInUser()
          if (lastUser) {
            commit('setLastLoggedInUser', lastUser)
            commit('setUsername', lastUser)
          }
        }

        // Then check auth status
        if (window.logMonitorApi?.authGetStatus) {
          const status = await window.logMonitorApi.authGetStatus()
          commit('setIsAuthenticated', status.isAuthenticated)
          if (status.isAuthenticated && status.username) {
            commit('setUsername', status.username)
            commit('setRsiHandle', status.username.toLowerCase())
          }
        }
      } catch (error) {
        console.error('Failed to load user profile:', error)
      }
    }
  }
})