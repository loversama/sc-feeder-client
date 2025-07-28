import { createApp } from 'vue';
import ElementPlus from 'element-plus';
import 'element-plus/dist/index.css';
import * as ElementPlusIconsVue from '@element-plus/icons-vue';
import LoginPopup from './components/LoginPopup.vue';
import './style.css'; // Import global styles

try {
  const app = createApp(LoginPopup);
  
  // Register all Element Plus icons globally
  for (const [key, component] of Object.entries(ElementPlusIconsVue)) {
    app.component(key, component);
  }
  
  app.use(ElementPlus);
  
  app.mount('#login-app');
} catch (error) {
  console.error('[login.ts] Error mounting Vue app:', error);
  // Fallback: Show basic HTML if Vue fails
  const loginApp = document.getElementById('login-app');
  if (loginApp) {
    loginApp.innerHTML = `
      <div style="color: white; text-align: center; padding: 20px;">
        <h1>VOIDLOG.GG - Login</h1>
        <p>Error loading login interface: ${error}</p>
        <button onclick="window.close()">Close</button>
      </div>
    `;
  }
}