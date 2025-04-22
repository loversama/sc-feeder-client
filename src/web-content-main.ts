import { createApp } from 'vue';
import './style.css'; // Import shared styles
import WebContentApp from './components/WebContentApp.vue'; // Import the root component (will be created next)
import router from './router/web-content-router'; // Import router instance

const app = createApp(WebContentApp);

app.use(router); // Use router

app.mount('#app');

console.log('Web Content Vue App Mounted');