import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'path';
import { readFileSync } from 'fs';

const pkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf-8')) as { version: string };

export default defineConfig({
  base: './',
  root: 'renderer',
  plugins: [react(), tailwindcss()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
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
      '@xiaok/shared': resolve(__dirname, 'renderer/src/shared'),
    },
  },
  optimizeDeps: {
    include: ['react-router-dom'],
  },
});
