import { createApp } from 'vue';
import { createPinia } from 'pinia';
import ElementPlus from 'element-plus'; // Import Element Plus
import 'element-plus/dist/index.css'; // Import Element Plus CSS
import * as ElementPlusIconsVue from '@element-plus/icons-vue'; // Import all icons
import './style.css'; // Import shared styles
import WebContentApp from './components/WebContentApp.vue'; // Import the root component
import router from './router/web-content-router'; // Import router instance
import type { IpcRendererEvent } from 'electron'; // Import type

const app = createApp(WebContentApp);
const pinia = createPinia();

// Register all Element Plus icons globally
for (const [key, component] of Object.entries(ElementPlusIconsVue)) {
  app.component(key, component);
}

app.use(pinia); // Use Pinia
app.use(router); // Use router
app.use(ElementPlus); // Use Element Plus

// Wait for the router to be ready before mounting
router.isReady().then(() => {
  // Check for initial navigation hash
  const hash = window.location.hash;
  console.log('Initial hash:', hash); // Log the hash for debugging
  if (hash && hash.startsWith('#')) {
    const section = hash.substring(1); // Remove '#'
    // Basic validation for expected sections
    if (section === 'profile' || section === 'leaderboard') {
      const path = '/' + section; // Prepend '/' for router path
      console.log('Navigating to initial section from hash:', path);
      router.push(path); // Navigate the router
    }
  }
  app.mount('#app');
  console.log('Web Content Vue App Mounted with Element Plus');
});

// --- IPC Listener for Navigation ---
if (window.ipcRenderer) {
  window.ipcRenderer.on('navigate-to-section', (_event: IpcRendererEvent, newSection: 'profile' | 'leaderboard') => {
    console.log(`[Web Content] Received navigate-to-section request: ${newSection}`);
    if (newSection === 'profile' || newSection === 'leaderboard') {
      const path = '/' + newSection;
      // Check if already on the target path to avoid redundant navigation
      if (router.currentRoute.value.path !== path) {
        console.log(`[Web Content] Navigating router to: ${path}`);
        router.push(path).catch(err => {
          console.error(`[Web Content] Router navigation failed:`, err);
        });
      } else {
        console.log(`[Web Content] Already on path ${path}, no navigation needed.`);
      }
    } else {
      console.warn(`[Web Content] Received invalid section for navigation: ${newSection}`);
    }
  });
} else {
  console.error('[Web Content] ipcRenderer is not available on window object!');
}