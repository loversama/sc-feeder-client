import { defineConfig } from 'vite'
import path from 'node:path'
import electron from 'vite-plugin-electron/simple'
import electronEntries from 'vite-plugin-electron'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

// Preloads run sandboxed: they can only require('electron'), never another file. Each one is built
// on its own as a single self-contained CommonJS file (no shared or dynamic chunks); the packaged smoke
// test checks this. See CLAUDE.md "Packaging rules".
const PRELOADS: Record<string, string> = {
  preload: 'electron/preload.ts', // main window, settings, login, …
  'webview-preload': 'electron/webview-preload.ts',
  'webcontents-header-preload': 'electron/webcontents-header-preload.ts',
  'webcontents-view-preload': 'electron/webcontents-view-preload.ts',
  'overlay-preload': 'electron/overlay-preload.ts', // in-game telemetry overlay
  'party-overlay-preload': 'electron/party-overlay-preload.ts', // in-game party / org overlay
}

const preloadBuilds = Object.entries(PRELOADS).map(([name, file]) => ({
  onstart(args: { reload: () => void }) {
    args.reload()
  },
  vite: {
    build: {
      rollupOptions: {
        input: { [name]: path.join(__dirname, file) },
        output: {
          format: 'cjs' as const,
          inlineDynamicImports: true,
          entryFileNames: '[name].mjs',
          chunkFileNames: `${name}-[name].mjs`,
          assetFileNames: '[name].[ext]',
        },
      },
    },
  },
}))

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
              // Native modules ONLY (see CLAUDE.md "Packaging rules"): everything else is bundled into
              // dist-electron so a half-written node_modules can never break startup.
              // scripts/check-externals.mjs fails the build on any other bare import.
              external: ['better-sqlite3', 'bindings', 'node-gyp-build'],
            },
          },
        },
      },
      renderer: process.env.NODE_ENV === 'test'
        ? undefined
        : {},
    }),
    electronEntries(preloadBuilds),
  ],
  build: {
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'index.html'),
        eventDetails: path.resolve(__dirname, 'event-details.html'),
        settings: path.resolve(__dirname, 'settings.html'),
        webContent: path.resolve(__dirname, 'web-content.html'),
        login: path.resolve(__dirname, 'login.html'),
        overlay: path.resolve(__dirname, 'overlay.html'),
        partyOverlay: path.resolve(__dirname, 'party-overlay.html'),
        bodycamLive: path.resolve(__dirname, 'bodycam-live.html'),
      },
      output: {
        // Explicitly disable inlineDynamicImports for multiple inputs
        inlineDynamicImports: false,
      },
    },
  },
})
