import { createApp } from 'vue';
console.log('[settings-main.ts] Script executing...'); // Add early log
import SettingsWindow from './components/SettingsWindow.vue'

// Create and mount the Settings Vue app
console.log('[settings-main.ts] Importing SettingsWindow component...');
const app = createApp(SettingsWindow);
console.log('[settings-main.ts] Mounting Vue app to #app...');
app.mount('#app');

console.log('Settings window Vue app mounted.')