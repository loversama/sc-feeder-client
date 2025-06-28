# Theming and Component Architecture

## Overview

The Log Monitor Client employs a sophisticated theming system that combines **Vue 3**, **Tailwind CSS v4**, and **Element Plus** to create a cohesive, dark-themed desktop application. This document explains how these technologies work together, how theming is implemented, and how components are structured throughout the application.

## Technology Stack Integration

### Vue 3 Setup

The application uses Vue 3 with the Composition API as its core framework:

```typescript
// src/main.ts
import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import store from './store'

const app = createApp(App)
app.use(router)
app.use(store)
app.mount('#app')
```

Key Vue 3 features utilized:
- **Composition API** with `<script setup>` syntax
- **Reactive references** using `ref()` and `reactive()`
- **Lifecycle hooks** like `onMounted()`
- **Component communication** via props and emits

### Tailwind CSS v4 Integration

Tailwind CSS v4 is integrated through the Vite plugin system:

```typescript
// vite.config.ts
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [
    vue(),
    tailwindcss(), // Tailwind v4 integration
    electron({...})
  ]
})
```

#### CSS Structure

The main stylesheet (`src/style.css`) imports Tailwind and defines the theme:

```css
@import "tailwindcss";

@theme {
  /* Base theme colors aligned with log-monitor-web */
  --color-theme-bg-dark: #171717; /* charcoal-900 */
  --color-theme-bg-panel: #262626; /* charcoal-800 */
  --color-theme-accent-blue: rgb(99, 99, 247); /* primary-500 */
  --color-theme-accent-blue-hover: rgb(77, 77, 234); /* primary-600 */
  --color-theme-accent-orange: #f0a070;
  --color-theme-text-light: #e5e7eb;
  --color-theme-text-white: #ffffff;
  --color-theme-border: #404040; /* charcoal-700 */
  --color-scrollbar-thumb: #525252; /* charcoal-600 */
  --color-scrollbar-thumb-hover: #737373; /* charcoal-500 */
}
```

#### Utility Class System

Custom utility classes are defined for consistent theming:

```css
@layer utilities {
  .bg-theme-bg-dark { background-color: var(--color-theme-bg-dark); }
  .bg-theme-bg-panel { background-color: var(--color-theme-bg-panel); }
  .text-theme-text-light { color: var(--color-theme-text-light); }
  .text-theme-text-white { color: var(--color-theme-text-white); }
  .border-theme-border { border-color: var(--color-theme-border); }
  
  /* Additional spacing, sizing, and layout utilities */
  .p-1 { padding: 0.25rem; }
  .flex { display: flex; }
  .h-full { height: 100%; }
  /* ... more utilities */
}
```

### Element Plus Integration

Element Plus is integrated for enhanced UI components:

```json
// package.json
"dependencies": {
  "@element-plus/icons-vue": "^2.3.1",
  "element-plus": "^2.9.8"
}
```

#### Component Registration

Element Plus components are imported as needed:

```vue
<script setup lang="ts">
import { ElMessage, ElNotification, ElButton, ElSwitch } from 'element-plus'
import { MoreFilled } from '@element-plus/icons-vue'
</script>
```

## Theming System Architecture

### CSS Custom Properties Strategy

The theming system relies on CSS custom properties (variables) for maximum flexibility:

#### Element Plus Theme Override

Element Plus components are themed using CSS variable overrides:

```css
:root {
  /* Element Plus Theme Overrides */
  --el-color-primary: var(--color-theme-accent-orange);
  --el-color-primary-light-3: #f4b08a;
  --el-bg-color: var(--color-theme-bg-panel);
  --el-bg-color-page: var(--color-theme-bg-dark);
  --el-text-color-primary: var(--color-theme-text-light);
  --el-border-color: var(--color-theme-border);
  --el-color-success: #67c23a;
  --el-color-warning: #e6a23c;
  --el-color-danger: #f56c6c;
}
```

### Component-Specific Theming

Individual components can override theme variables using `:deep()` selectors:

```vue
<style>
/* Component-specific Element Plus overrides */
:deep(.el-switch.is-checked .el-switch__core) {
  background-color: #f97316 !important;
  border-color: #f97316 !important;
}

:deep(.el-input__wrapper) {
  background-color: #111827 !important;
  border-color: #374151 !important;
  box-shadow: 0 0 0 1px #374151 inset !important;
}
</style>
```

## Component Architecture

### Page-Level Components

The application uses a hierarchical component structure:

```
src/pages/
├── KillFeedPage.vue      # Main kill feed interface
├── SettingsPage.vue      # Settings placeholder (opens separate window)
├── EventDetailsPage.vue  # Detailed event view
├── LeaderboardPage.vue   # Leaderboard interface
├── ProfilePage.vue       # User profile interface
└── WebContentPage.vue    # Web content container
```

### Reusable Components

Core components are organized in the `components/` directory:

```
src/components/
├── KillFeed.vue                    # Main kill feed display
├── SettingsWindow.vue             # Settings window content
├── WebContentApp.vue              # Web content wrapper
├── LoginPopup.vue                 # Authentication modal
├── Navigation.vue                 # Navigation bar
├── UpdateNotification.vue         # Update notifications
├── UpdateNotificationCompact.vue  # Compact update UI
└── UserAvatar.vue                 # User avatar display
```

### Settings Window Architecture

The `SettingsWindow.vue` component demonstrates advanced theming integration:

```vue
<template>
  <div class="flex h-screen bg-gray-900 text-gray-100 font-sans overflow-hidden">
    <!-- Sidebar Navigation -->
    <aside class="w-64 bg-gray-800 border-r border-gray-700 flex flex-col">
      <nav class="flex-1 p-4 space-y-2">
        <button
          v-for="category in categories"
          :key="category.id"
          @click="activeCategory = category.id"
          class="w-full flex items-center gap-3 px-4 py-3 text-left rounded-lg transition-all duration-200 group"
          :class="activeCategory === category.id 
            ? 'bg-orange-500/20 text-orange-400 border-l-4 border-orange-500' 
            : 'text-gray-300 hover:bg-gray-700/50 hover:text-white border-l-4 border-transparent'"
        >
          <!-- Category content -->
        </button>
      </nav>
    </aside>

    <!-- Main Content with Element Plus components -->
    <main class="flex-1 overflow-y-auto">
      <div class="bg-gray-800/50 rounded-lg p-6 border border-gray-700">
        <div class="flex items-center justify-between mb-2">
          <h4 class="text-lg font-semibold text-white">Setting Name</h4>
          <el-switch
            v-model="settingValue"
            @change="handleSettingChange"
          />
        </div>
      </div>
    </main>
  </div>
</template>
```

### Web Content Integration

The `WebContentApp.vue` component manages embedded web content:

```vue
<template>
  <div class="relative flex flex-col h-screen overflow-hidden bg-theme-bg-dark text-theme-text-light border border-theme-border">
    <!-- Header with navigation -->
    <header class="p-2 bg-[#171717] border-b border-[#262626] shadow-md shrink-0 h-[80px] flex items-center justify-between">
      <nav class="mt-2 flex items-center">
        <el-button
          :icon="MoreFilled"
          text
          class="ml-5 p-2 text-theme-text-light hover:bg-white/5 border border-white/10"
          title="More Options"
        />
        <router-link
          to="/profile"
          class="ml-[50px] p-2 rounded transition-colors duration-200"
          :class="{ 
            'text-[rgb(99,99,247)] bg-white/5': $route.path === '/profile',
            'hover:bg-white/5 hover:text-[rgb(77,77,234)]': $route.path !== '/profile' 
          }"
        >
          Profile
        </router-link>
      </nav>
    </header>

    <!-- Dynamic content area -->
    <main class="flex-1 overflow-auto">
      <router-view />
    </main>
  </div>
</template>
```

## Responsive Design and Layout

### Flexbox-Based Layouts

The application uses Flexbox extensively for responsive layouts:

```css
.flex { display: flex; }
.flex-1 { flex: 1 1 0%; }
.flex-col { flex-direction: column; }
.items-center { align-items: center; }
.justify-between { justify-content: space-between; }
```

### Scrolling and Overflow

Custom scrollbar styling maintains the dark theme:

```css
::-webkit-scrollbar {
  width: 10px;
  height: 10px;
}

::-webkit-scrollbar-track {
  background: var(--color-theme-bg-dark);
}

::-webkit-scrollbar-thumb {
  background-color: var(--color-scrollbar-thumb);
  border-radius: 5px;
  border: 2px solid var(--color-theme-bg-dark);
}

::-webkit-scrollbar-thumb:hover {
  background-color: var(--color-scrollbar-thumb-hover);
}
```

## State Management Integration

### Vuex Integration

Components interact with Vuex for global state:

```typescript
// stores/userStore.ts
import { defineStore } from 'pinia'

export const useUserStore = defineStore('user', {
  state: () => ({
    isAuthenticated: false,
    username: null,
    profile: null
  }),
  
  actions: {
    updateAuthStatus(status: boolean) {
      this.isAuthenticated = status
    }
  }
})
```

### Composables Pattern

Vue 3 composables encapsulate reusable logic:

```typescript
// composables/useUserState.ts
import { ref, computed } from 'vue'
import { useUserStore } from '@/stores/userStore'

export function useUserState() {
  const userStore = useUserStore()
  
  const isLoggedIn = computed(() => userStore.isAuthenticated)
  const currentUser = computed(() => userStore.username)
  
  return {
    isLoggedIn,
    currentUser
  }
}
```

## Multi-Window Architecture

### Window Types

The application manages multiple window types:

1. **Main Window** (`index.html`) - Primary kill feed interface
2. **Settings Window** (`settings.html`) - Configuration interface
3. **Event Details Window** (`event-details.html`) - Detailed event view
4. **Web Content Window** (`web-content.html`) - Embedded web interface
5. **Login Window** (`login.html`) - Authentication interface

### Shared Styling

All windows share the base theme through `src/style.css`:

```html
<!-- settings.html -->
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Settings</title>
  <link rel="stylesheet" href="./src/style.css">
</head>
<body>
  <div id="app"></div>
  <script type="module" src="/src/settings-main.ts"></script>
</body>
</html>
```

## Best Practices and Patterns

### Component Organization

1. **Single File Components** - Each component includes template, script, and styles
2. **Composition API** - Use `<script setup>` for cleaner, more maintainable code
3. **Props and Emits** - Clear component interfaces with TypeScript
4. **Scoped Styling** - Component-specific styles when needed

### Theming Guidelines

1. **CSS Variables** - Use custom properties for all theme values
2. **Consistent Naming** - Follow `--color-theme-purpose-variant` pattern
3. **Element Plus Integration** - Override variables, not component styles directly
4. **Responsive Design** - Use Tailwind utilities for consistent spacing and sizing

### Performance Considerations

1. **Lazy Loading** - Components loaded only when needed
2. **Efficient Re-rendering** - Use `ref()` and `computed()` appropriately
3. **CSS Optimization** - Tailwind purges unused styles in production
4. **Memory Management** - Proper cleanup in component lifecycle

## Custom Electron Titlebar Integration

### Overview

The application uses `custom-electron-titlebar` (v4.2.8) to provide a consistent, cross-platform titlebar experience that integrates seamlessly with the dark theme. This replaces the native OS titlebars with a customizable solution that maintains visual consistency across all application windows.

### Installation and Configuration

#### Package Dependency

```json
// package.json
"dependencies": {
  "custom-electron-titlebar": "^4.2.8"
}
```

#### Main Process Setup

The titlebar system is initialized in the main process before creating any windows:

```typescript
// electron/main.ts
import { setupTitlebar } from "custom-electron-titlebar/main";

// Setup the titlebar main process (call once at startup)
setupTitlebar();
```

#### Window Configuration

Each window must be configured with specific options to work with the custom titlebar:

```typescript
// electron/modules/window-manager.ts
const windowOptions: Electron.BrowserWindowConstructorOptions = {
  frame: false,                    // Remove native window frame
  titleBarStyle: 'hidden',         // Hide native titlebar
  titleBarOverlay: true,           // Optional: use original Windows controls
  webPreferences: {
    // ... other preferences
  }
  // ... other options
};

const window = new BrowserWindow(windowOptions);
```

#### Window Attachment

After creating each window, attach the custom titlebar:

```typescript
// electron/modules/window-manager.ts
import { attachTitlebarToWindow } from "custom-electron-titlebar/main";

// Attach custom titlebar to each window
attachTitlebarToWindow(window);
```

### Dark Theme Styling

The custom titlebar is styled to match the application's dark theme through CSS injection:

```typescript
// electron/modules/window-manager.ts
function injectTitlebarCSS(window: BrowserWindow): void {
    window.webContents.insertCSS(`
      /* Custom electron titlebar dark theme styling */
      .cet-titlebar {
        background-color: transparent !important;
        border-bottom: none !important;
      }
      
      /* Ensure window controls are dark themed */
      .cet-control-button {
        color: #ffffff !important;
        background-color: transparent !important;
      }
      
      .cet-control-button:hover {
        background-color: rgba(255, 255, 255, 0.1) !important;
      }
      
      .cet-control-button.cet-close:hover {
        background-color: #e81123 !important;
      }
      
      /* Hide title and icon since we want minimal titlebar */
      .cet-title, .cet-icon {
        display: none !important;
      }
      
      /* Ensure content doesn't have unnecessary spacing */
      #app, #login-app {
        height: 100vh !important;
        overflow: auto !important;
      }
    `).catch(err => logger.error(MODULE_NAME, "Failed to inject titlebar CSS:", err));
}
```

### Implementation Across Window Types

#### Main Window
```typescript
export function createMainWindow(): BrowserWindow {
  const mainWindow = new BrowserWindow(windowOptions);
  attachTitlebarToWindow(mainWindow);
  
  mainWindow.on('ready-to-show', () => {
    mainWindow?.show();
    if (mainWindow) {
      injectTitlebarCSS(mainWindow);
    }
  });
  
  return mainWindow;
}
```

#### Settings Window
```typescript
export function createSettingsWindow(): BrowserWindow | null {
  settingsWindow = new BrowserWindow(settingsWindowOptions);
  attachTitlebarToWindow(settingsWindow);
  
  settingsWindow.once('ready-to-show', () => {
    settingsWindow?.show();
    if (settingsWindow) {
      injectTitlebarCSS(settingsWindow);
    }
  });
  
  return settingsWindow;
}
```

#### Other Windows
All window types (Event Details, Web Content, Login) follow the same pattern:
1. Configure with `frame: false` and `titleBarStyle: 'hidden'`
2. Call `attachTitlebarToWindow(window)` after creation
3. Inject custom CSS on `ready-to-show` event

### Best Practices

#### Window Configuration
- Always set `frame: false` and `titleBarStyle: 'hidden'`
- Consider using `titleBarOverlay: true` for Windows native controls
- Ensure `autoHideMenuBar: true` to prevent menu conflicts

#### Styling Guidelines
- Inject CSS after the `ready-to-show` event fires
- Use `!important` declarations for reliable theming
- Test hover states for all control buttons
- Ensure color contrast meets accessibility standards

#### Menu Management
```typescript
// electron/main.ts
import { Menu } from 'electron';

// Disable application menu globally to prevent conflicts
Menu.setApplicationMenu(null);
```

### Troubleshooting

#### Common Issues
1. **Titlebar not appearing**: Ensure `setupTitlebar()` is called before creating windows
2. **Styling inconsistencies**: Verify CSS injection timing in `ready-to-show` event
3. **Menu conflicts**: Disable native menus with `Menu.setApplicationMenu(null)`
4. **Window controls not working**: Check that `attachTitlebarToWindow()` is called for each window

#### Platform Considerations
- **Windows**: Native controls can be preserved with `titleBarOverlay: true`
- **macOS**: Custom titlebar provides consistent behavior vs. native traffic lights
- **Linux**: Custom titlebar ensures consistent appearance across desktop environments

### Future Replication

To implement this titlebar setup in a new Electron application:

1. **Install dependency**: `npm install custom-electron-titlebar@^4.2.8`
2. **Main process setup**: Import and call `setupTitlebar()` at startup
3. **Window configuration**: Configure each window with frameless options
4. **Attach titlebar**: Call `attachTitlebarToWindow()` for each window
5. **Apply styling**: Inject custom CSS to match your theme
6. **Disable menus**: Remove native menus to prevent conflicts

This approach provides a professional, native-feeling titlebar experience while maintaining complete control over styling and behavior.

## Development Workflow

### Adding New Components

1. Create component in appropriate directory
2. Import required Element Plus components
3. Apply theme classes using Tailwind utilities
4. Override Element Plus styles using `:deep()` when necessary
5. Test in all relevant windows/contexts

### Modifying Themes

1. Update CSS variables in `src/style.css`
2. Test across all components and windows
3. Verify Element Plus component styling
4. Check responsive behavior
5. Validate accessibility compliance

This architecture provides a robust, maintainable foundation for the Log Monitor Client's user interface while ensuring visual consistency and excellent user experience across all application windows.