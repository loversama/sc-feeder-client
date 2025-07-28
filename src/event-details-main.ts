import { createApp } from 'vue'
import EventDetailsPage from './pages/EventDetailsPage.vue' // Use the new component

// Create and mount the Event Details Vue app
const app = createApp(EventDetailsPage)
app.mount('#app')

console.log('Event Details window Vue app mounted.')