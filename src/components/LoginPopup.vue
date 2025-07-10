<template>
  <div class="login-popup-container">
    <div class="logo-section">
      <img src="/voidlog-icon-colour.png" alt="VOIDLOG.GG Logo" class="logo" />
      <div class="brand-container">
        <h1><span class="brand-white">VOIDLOG</span><span class="brand-purple">.GG</span></h1>
        <div class="alpha-badge">
          <span class="alpha-tag">Alpha</span>
        </div>
      </div>
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
        <p class="register-info">
          Don't have an account? <a href="#" @click.prevent="openRegisterPage" class="register-link">Register</a>
        </p>
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
import { ref, reactive, watch } from 'vue'

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
      // Login successful - trigger main window creation and close login window
      await window.logMonitorApi.authLoginSuccess()
      await window.logMonitorApi.authCloseLoginWindow()
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

const openRegisterPage = () => {
  // Use the exposed API to open the registration page in the default browser
  if (window.logMonitorApi && window.logMonitorApi.openExternal) {
    window.logMonitorApi.openExternal('https://voidlog.gg/register')
  } else {
    // Fallback: try to open in current window (not recommended but better than nothing)
    window.open('https://voidlog.gg/register', '_blank')
  }
}

// Watch for login form visibility and resize window accordingly
watch(showLoginForm, async (newValue) => {
  try {
    if (newValue) {
      // Login form is showing - resize to taller height (original + 300px)
      await window.logMonitorApi?.authResizeLoginWindow(800)
    } else {
      // Back to initial view - resize to original height
      await window.logMonitorApi?.authResizeLoginWindow(500)
    }
  } catch (error) {
    console.error('Failed to resize login window:', error)
  }
})
</script>

<style scoped>
.login-popup-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  background-color: #2c2c2c;
  color: #f0f0f0;
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  padding: 40px 20px;
  box-sizing: border-box;
  transition: all 0.3s ease;
}

.logo-section {
  text-align: center;
  margin-bottom: 40px;
  display: flex;
  flex-direction: column;
  align-items: center;
  transition: all 0.3s ease;
}

.logo {
  width: 140px;
  height: 140px;
  margin-bottom: 15px;
  display: block;
  margin-left: auto;
  margin-right: auto;
}

h1 {
  font-size: 1.125rem;
  margin: 0;
  font-weight: 600;
  text-transform: uppercase;
}

.brand-white {
  color: #ffffff;
}

.brand-purple {
  color: rgba(99, 102, 241, 0.8);
}

.brand-container {
  display: flex;
  align-items: center;
  gap: 12px;
}

.alpha-badge {
  display: flex;
  align-items: center;
}

.alpha-tag {
  background: linear-gradient(135deg, rgba(99, 102, 241, 0.2) 0%, rgba(139, 92, 246, 0.2) 100%);
  border: 1px solid rgba(99, 102, 241, 0.3);
  color: rgba(99, 102, 241, 0.9);
  font-weight: 600;
  letter-spacing: 0.025em;
  font-size: 0.75rem;
  padding: 4px 8px;
  border-radius: 4px;
}

h2 {
  font-size: 1.5em;
  margin-bottom: 20px;
  color: #f0f0f0;
}

.initial-options-section {
  display: flex;
  flex-direction: column;
  width: 100%;
  max-width: 320px;
}

.login-form-section {
  display: flex;
  flex-direction: column;
  width: 100%;
  max-width: 400px;
  background-color: #3a3a3a;
  padding: 30px;
  border-radius: 10px;
  box-shadow: 0 4px 15px rgba(0, 0, 0, 0.3);
  margin-top: 20px;
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
  border-color: rgba(99, 102, 241, 0.8);
  box-shadow: 0 0 0 2px rgba(99, 102, 241, 0.3);
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
  background-color: rgba(99, 102, 241, 0.8); /* Purple-blue accent color */
  color: white;
}

.btn-primary:hover:not(:disabled) {
  background-color: rgba(79, 82, 221, 0.9); /* Darker purple-blue on hover */
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

.register-info {
  font-size: 0.9em;
  color: #ccc;
  text-align: center;
  margin-top: 10px;
  margin-bottom: 15px;
}

.register-link {
  color: rgba(99, 102, 241, 0.8);
  text-decoration: none;
  font-weight: 600;
  transition: color 0.2s ease;
}

.register-link:hover {
  color: rgba(99, 102, 241, 1);
  text-decoration: underline;
}

/* Adjustments when login form is visible */
.login-popup-container:has(.login-form-section) .logo-section {
  margin-bottom: 20px;
}

.login-popup-container:has(.login-form-section) .logo {
  width: 100px;
  height: 100px;
}

.login-popup-container:has(.login-form-section) h1 {
  font-size: 1.5em;
}

/* Fallback for browsers that don't support :has() */
@media (max-height: 700px) {
  .logo {
    width: 100px !important;
    height: 100px !important;
  }
  
  .logo-section {
    margin-bottom: 20px !important;
  }
  
  h1 {
    font-size: 1.5em !important;
  }
  
  .login-popup-container {
    padding: 20px;
  }
  
  .login-form-section {
    padding: 20px;
    margin-top: 10px;
  }
}
</style>