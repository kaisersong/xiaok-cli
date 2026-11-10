import { defineConfig } from 'vitest/config'
import { resolve } from 'path'
import { readFileSync } from 'node:fs'
import { normalizePath } from 'vite'

const workflowJobTestEntry = normalizePath(resolve(__dirname, 'electron/kswarm-dynamic-workflow-script-tool.ts'))
const githubSessionTestEntry = normalizePath(resolve(__dirname, 'electron/dsh-github-source-session.ts'))
const servicesTestEntry = normalizePath(resolve(__dirname, 'electron/desktop-services.ts'))

export default defineConfig({
  // This alias exists only in the test loader; production source stays private.
  plugins: [{
    name: 'real-private-finalization-test-entry',
    enforce: 'pre',
    load(id) {
      const file = normalizePath(id.split('?')[0]!)
      const workerCore=normalizePath(resolve(__dirname,'electron/workflow-script-worker.ts'))
      if(file===workerCore)return readFileSync(workerCore,'utf8')+'\nexport {runWorkerCore as __runIsolatedWorkflowScript};\n'
      if (file === workflowJobTestEntry) return readFileSync(workflowJobTestEntry, 'utf8') + '\nexport {reserveOriginalScriptJob as __reserveOriginalScriptJob};\n'
      if (file === githubSessionTestEntry) return readFileSync(githubSessionTestEntry, 'utf8') + '\nexport {createSessionCore as __createIsolatedGithubSession};\n'
      if (file !== servicesTestEntry) return
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
    setupFiles: ['./tests/profile-account.setup.mjs', './tests/setup.ts', './tests/setup-host-env.ts', './tests/mock-system-credentials.ts'],
    sequence: { setupFiles: 'list' },
    server: {
      deps: {
        inline: [/electron/],
      },
    },
  },
})
