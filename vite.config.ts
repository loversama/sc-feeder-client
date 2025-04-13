import { defineConfig } from 'vite'
import path from 'node:path'
import electron from 'vite-plugin-electron/simple'
import vue from '@vitejs/plugin-vue'
import tailwindcss from 'tailwindcss' // Import the core tailwindcss plugin
import autoprefixer from 'autoprefixer'

// https://vitejs.dev/config/
export default defineConfig({
  // css.postcss configuration removed as it's handled by postcss.config.cjs
  plugins: [
    vue(),
    // Note: @tailwindcss/vite plugin is removed as we configure PostCSS manually
    electron({
      main: {
        // Shortcut of `build.lib.entry`.
        entry: 'electron/main.ts',
      },
      preload: {
        // Shortcut of `build.rollupOptions.input`.
        // Preload scripts may contain Web assets, so use the `build.rollupOptions.input` instead `build.lib.entry`.
        input: path.join(__dirname, 'electron/preload.ts'),
      },
      // Ployfill the Electron and Node.js API for Renderer process.
      // If you want use Node.js in Renderer process, the `nodeIntegration` needs to be enabled in the Main process.
      // See 👉 https://github.com/electron-vite/vite-plugin-electron-renderer
      renderer: process.env.NODE_ENV === 'test'
        // https://github.com/electron-vite/vite-plugin-electron-renderer/issues/78#issuecomment-2053600808
        ? undefined
        : {},
    }),
  ],
  build: {
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'index.html'),
        eventDetails: path.resolve(__dirname, 'event-details.html'), // Keep this if event-details also uses Vue/TS entry point
        settings: path.resolve(__dirname, 'settings.html'), // Add settings entry point back
      },
    },
  },
})
