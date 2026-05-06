import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import { execSync } from 'child_process';

const pkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf-8')) as { version: string };

// Build number from git commit count
let buildNumber = 'local';
try {
  buildNumber = execSync('git rev-list --count HEAD', { encoding: 'utf-8', cwd: __dirname }).trim();
} catch {
  buildNumber = new Date().toISOString().slice(0, 10).replace(/-/g, '');
}

export default defineConfig({
  base: './',
  root: 'renderer',
  plugins: [react(), tailwindcss()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __APP_BUILD__: JSON.stringify(buildNumber),
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
