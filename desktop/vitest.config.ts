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
    globalSetup: ['../tests/support/profile-account.global.mjs'],
    setupFiles: ['./tests/profile-account.setup.mjs', './tests/setup.ts'],
    sequence: { setupFiles: 'list' },
    server: {
      deps: {
        inline: [/electron/],
      },
    },
  },
})
