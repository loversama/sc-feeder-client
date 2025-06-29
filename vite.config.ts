import { defineConfig } from 'vite'
import path from 'node:path'
import electron from 'vite-plugin-electron/simple'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    vue({
      template: {
        compilerOptions: {
          // Treat 'webview' as a custom element
          isCustomElement: (tag) => tag === 'webview',
        },
      },
    }),
    tailwindcss(),
    electron({
      main: {
        entry: 'electron/main.ts',
        vite: {
          build: {
            rollupOptions: {
              external: ['better-sqlite3', 'bindings', 'node-gyp-build'],
            },
          },
        },
      },
      preload: {
        // Preload scripts for different windows
        input: {
          // Preload for main window, settings, etc.
          preload: path.join(__dirname, 'electron/preload.ts'),
          // Preload specifically for the webview
          'webview-preload': path.join(__dirname, 'electron/webview-preload.ts'),
        },
        vite: {
          build: {
            rollupOptions: {
              output: {
                inlineDynamicImports: false,
              },
            },
          },
        },
      },
      renderer: process.env.NODE_ENV === 'test'
        ? undefined
        : {},
    }),
  ],
  build: {
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'index.html'),
        eventDetails: path.resolve(__dirname, 'event-details.html'),
        settings: path.resolve(__dirname, 'settings.html'),
        webContent: path.resolve(__dirname, 'web-content.html'),
        login: path.resolve(__dirname, 'login.html'),
      },
      output: {
        // Explicitly disable inlineDynamicImports for multiple inputs
        inlineDynamicImports: false,
      },
    },
  },
})
