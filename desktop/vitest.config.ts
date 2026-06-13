import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  esbuild: {
    jsx: 'automatic',
  },
  resolve: {
    alias: {
      '@xiaok/shared/desktop': resolve(__dirname, 'renderer/src/shared/desktop.ts'),
      '@xiaok/shared': resolve(__dirname, 'renderer/src/shared/index.ts'),
    },
  },
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    setupFiles: ['./tests/setup.ts'],
    server: {
      deps: {
        inline: [/electron/],
      },
    },
  },
})
