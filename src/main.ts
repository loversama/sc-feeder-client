import { createApp } from 'vue'
import { createPinia } from 'pinia'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import * as ElementPlusIconsVue from '@element-plus/icons-vue' // Import all icons
import './style.css'
import App from './App.vue'

const app = createApp(App) // Create app instance
const pinia = createPinia()

// Register all Element Plus icons globally
for (const [key, component] of Object.entries(ElementPlusIconsVue)) {
  app.component(key, component)
}

app
  .use(pinia)
  .use(ElementPlus)
  .mount('#app')
  .$nextTick(() => {
  // Use contextBridge
  window.ipcRenderer.on('main-process-message', (_event, message) => {
    console.log(message)
  })
  
  // Initialize update store to ensure IPC listeners are set up
  // This ensures the store is created and IPC listeners are registered
  if (window.logMonitorApi) {
    import('./stores/updateStore').then(({ useUpdateStore }) => {
      const updateStore = useUpdateStore()
      console.log('Update store initialized')
    })
  }
})
