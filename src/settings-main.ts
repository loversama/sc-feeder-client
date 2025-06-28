import { createApp } from 'vue';
import { createPinia } from 'pinia';
import ElementPlus from 'element-plus';
import 'element-plus/dist/index.css';
import * as ElementPlusIconsVue from '@element-plus/icons-vue';
import './style.css'; // Import global styles
import SettingsWindow from './components/SettingsWindow.vue';

console.log('[settings-main.ts] Script executing...');
console.log('[settings-main.ts] Creating Vue app with SettingsWindow component...');

try {
  const app = createApp(SettingsWindow);
  const pinia = createPinia();
  
  // Register all Element Plus icons globally
  for (const [key, component] of Object.entries(ElementPlusIconsVue)) {
    app.component(key, component);
  }
  
  app.use(pinia).use(ElementPlus);
  
  console.log('[settings-main.ts] Mounting Vue app to #app...');
  app.mount('#app');
  console.log('[settings-main.ts] Settings Vue app mounted successfully.');
} catch (error) {
  console.error('[settings-main.ts] Error mounting Vue app:', error);
  // Fallback: Show basic HTML if Vue fails
  const settingsApp = document.getElementById('app');
  if (settingsApp) {
    settingsApp.innerHTML = `
      <div style="color: white; text-align: center; padding: 20px;">
        <h1>SC Kill Feed - Settings</h1>
        <p>Error loading settings interface: ${error}</p>
        <button onclick="window.close()">Close</button>
      </div>
    `;
  }
}