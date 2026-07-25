import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  base: './',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
  },
  build: {
    // Emitted into the Mastra app's public dir so the Mastra server serves the UI.
    outDir: path.resolve(__dirname, '../mastra/src/mastra/public/app'),
    emptyOutDir: true,
  },
});
