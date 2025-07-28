import { createApp } from 'vue';
import { createPinia } from 'pinia';
import ElementPlus from 'element-plus';
import 'element-plus/dist/index.css';
import * as ElementPlusIconsVue from '@element-plus/icons-vue';
import './style.css';
import WebContentPage from './pages/WebContentPage.vue'; // Use WebContentPage directly
import type { IpcRendererEvent } from 'electron';

const app = createApp(WebContentPage);
const pinia = createPinia();

// Register all Element Plus icons globally
for (const [key, component] of Object.entries(ElementPlusIconsVue)) {
  app.component(key, component);
}

app.use(pinia);
app.use(ElementPlus);

// Mount the app directly without router complexity
app.mount('#app');
console.log('Web Content App Mounted with WebContentPage directly');

// --- IPC Listener for Navigation ---
if (window.ipcRenderer) {
  window.ipcRenderer.on('navigate-to-section', (_event: IpcRendererEvent, newSection: 'profile' | 'leaderboard') => {
    console.log(`[Web Content] Received navigate-to-section request: ${newSection}`);
    // The WebContentPage component will handle this through its internal navigation
    // Dispatch a custom event that WebContentPage can listen for
    window.dispatchEvent(new CustomEvent('web-content-navigate', { 
      detail: { section: newSection } 
    }));
  });
} else {
  console.error('[Web Content] ipcRenderer is not available on window object!');
}