import { defineConfig } from 'vitest/config'
import { resolve } from 'path'
import { readFileSync } from 'node:fs'
import { normalizePath } from 'vite'

const servicesTestEntry = normalizePath(resolve(__dirname, 'electron/desktop-services.ts'))

export default defineConfig({
  // This alias exists only in the test loader; production source stays private.
  plugins: [{
    name: 'real-private-finalization-test-entry',
    enforce: 'pre',
    load(id) {
      if (normalizePath(id.split('?')[0]!) !== servicesTestEntry) return
      return readFileSync(servicesTestEntry, 'utf8') + '\nexport {streamDesktopToolLoopFinalization as __testFinalization};\n'
    },
  }],
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
