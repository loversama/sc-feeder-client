<template>
  <div class="login-popup-container">
    <div class="logo-section">
      <img src="/voidlog-icon-colour.png" alt="SC Kill Feed Logo" class="logo" />
      <h1>SC Kill Feed</h1>
    </div>

    <div v-if="showLoginForm" class="login-form-section">
      <h2>Login</h2>
      <form @submit.prevent="handleLogin">
        <div class="input-group">
          <label for="identifier">Username or Email</label>
          <input type="text" id="identifier" v-model="loginForm.identifier" :disabled="isLoading" />
        </div>
        <div class="input-group">
          <label for="password">Password</label>
          <input type="password" id="password" v-model="loginForm.password" :disabled="isLoading" />
        </div>
        <p v-if="error" class="error-message">{{ error }}</p>
        <button type="submit" :disabled="isLoading" class="btn-primary">
          {{ isLoading ? 'Logging in...' : 'Login' }}
        </button>
        <button type="button" @click="goBack" :disabled="isLoading" class="btn-secondary">
          Back
        </button>
      </form>
    </div>

    <div v-else class="initial-options-section">
      <button @click="showLogin" :disabled="isLoading" class="btn-primary">
        Login
      </button>
      <button @click="continueAsGuest" :disabled="isLoading" class="btn-secondary">
        Continue as Guest
      </button>
      <p class="guest-info">
        You can log in later from the application settings.
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive } from 'vue'

// State management
const isLoading = ref(false)
const error = ref<string>('')
const showLoginForm = ref(false)

// Form data
const loginForm = reactive({
  identifier: '',
  password: ''
})

// Methods
const handleLogin = async () => {
  if (!loginForm.identifier || !loginForm.password) {
    error.value = 'Please enter both username/email and password'
    return
  }

  isLoading.value = true
  error.value = ''

  try {
    const result = await window.logMonitorApi.authLogin(loginForm.identifier, loginForm.password)
    
    if (result.success) {
      await window.logMonitorApi.authLoginSuccess()
    } else {
      error.value = result.error || 'Login failed. Please check your credentials.'
    }
  } catch (err) {
    error.value = 'Network error. Please check your connection and try again.'
    console.error('Login error:', err)
  } finally {
    isLoading.value = false
  }
}

const continueAsGuest = async () => {
  try {
    isLoading.value = true
    await window.logMonitorApi.authContinueAsGuest()
  } catch (err) {
    console.error('Guest mode error:', err)
    // Fallback: close window
    await window.logMonitorApi.authCloseLoginWindow()
  } finally {
    isLoading.value = false
  }
}

const showLogin = () => {
  showLoginForm.value = true
  error.value = ''
}

const goBack = () => {
  showLoginForm.value = false
  error.value = ''
  loginForm.identifier = ''
  loginForm.password = ''
}
</script>

<style scoped>
.login-popup-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100vh;
  background-color: #2c2c2c;
  color: #f0f0f0;
  font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
  padding: 20px;
  box-sizing: border-box;
}

.logo-section {
  text-align: center;
  margin-bottom: 30px;
}

.logo {
  width: 100px;
  height: 100px;
  margin-bottom: 10px;
}

h1 {
  font-size: 2em;
  margin: 0;
  color: #00bfff; /* A bright blue for the title */
}

h2 {
  font-size: 1.5em;
  margin-bottom: 20px;
  color: #f0f0f0;
}

.initial-options-section,
.login-form-section {
  display: flex;
  flex-direction: column;
  width: 100%;
  max-width: 300px;
}

.input-group {
  margin-bottom: 15px;
}

.input-group label {
  display: block;
  margin-bottom: 5px;
  font-size: 0.9em;
}

.input-group input[type="text"],
.input-group input[type="password"] {
  width: 100%;
  padding: 10px;
  border: 1px solid #555;
  border-radius: 5px;
  background-color: #3c3c3c;
  color: #f0f0f0;
  box-sizing: border-box;
}

.input-group input[type="text"]:focus,
.input-group input[type="password"]:focus {
  outline: none;
  border-color: #00bfff;
  box-shadow: 0 0 0 2px rgba(0, 191, 255, 0.5);
}

.btn-primary,
.btn-secondary {
  width: 100%;
  padding: 12px;
  border: none;
  border-radius: 5px;
  cursor: pointer;
  font-size: 1em;
  margin-bottom: 10px;
  transition: background-color 0.2s ease;
}

.btn-primary {
  background-color: #00bfff; /* Bright blue */
  color: white;
}

.btn-primary:hover:not(:disabled) {
  background-color: #009acd; /* Darker blue on hover */
}

.btn-secondary {
  background-color: #555; /* Darker grey */
  color: white;
}

.btn-secondary:hover:not(:disabled) {
  background-color: #666; /* Lighter grey on hover */
}

.btn-primary:disabled,
.btn-secondary:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.error-message {
  color: #ff6b6b; /* Red for errors */
  font-size: 0.9em;
  margin-top: -5px;
  margin-bottom: 15px;
  text-align: center;
}

.guest-info {
  font-size: 0.8em;
  color: #aaa;
  text-align: center;
  margin-top: 10px;
}
</style>