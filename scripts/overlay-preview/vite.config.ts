import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

/** Static build of the party overlay preview (no Electron). Output dir from OVERLAY_PREVIEW_OUT. */
export default defineConfig({
  root: path.resolve(__dirname),
  base: './',
  plugins: [vue(), tailwindcss()],
  build: {
    outDir: process.env.OVERLAY_PREVIEW_OUT || path.resolve(__dirname, '.out'),
    emptyOutDir: true,
    rollupOptions: { input: { index: path.resolve(__dirname, 'index.html'), settings: path.resolve(__dirname, 'settings.html') } },
  },
});
