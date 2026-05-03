import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'path';

export default defineConfig({
  base: './',
  root: 'renderer',
  plugins: [react(), tailwindcss()],
  build: {
    outDir: '../dist/renderer',
    emptyOutDir: true,
    rollupOptions: {
      treeshake: false,
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'renderer/src'),
      '@arkloop/shared': resolve(__dirname, 'renderer/src/shared'),
    },
  },
  optimizeDeps: {
    include: ['react-router-dom'],
  },
});
