// Dev-only: builds the Controls page with a fixture bridge for browser screenshots (no Electron, not shipped).
//   npx vite build --config scripts/controls-preview.vite.config.ts
import { defineConfig } from 'vite';
import path from 'node:path';
import vue from '@vitejs/plugin-vue';

const root = path.resolve(__dirname, '..');
export default defineConfig({
  root,
  base: './',
  plugins: [vue()],
  build: {
    outDir: path.join(root, 'test/telemetry/.out/controls-preview'),
    emptyOutDir: true,
    rollupOptions: { input: path.join(root, 'controls-preview.html') },
  },
});
