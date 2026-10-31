import { defineConfig } from 'vitest/config';

/** Explicit integration lane: absent prerequisites fail; no fallback or qualification mock. */
export default defineConfig({
  esbuild: { jsx: 'automatic' },
  test: {
    environment: 'node', maxWorkers: 1, fileParallelism: false,
    include: ['tests/main/semantic-product-runtime.test.ts', 'tests/main/desktop-history-publication-basis.test.ts',
      'tests/main/desktop-compound-ancestor-followup.test.ts', 'tests/main/desktop-multi-agent-service.bdd.test.ts'],
    testNamePattern: /actual Desktop loop boundary|actual managed group semantic boundary|actual Desktop full-history publisher|uses exact drained descendant resources|uses the actual prepared Runtime and managed session|retains an actual product group owner/,
    globalSetup: ['./tests/qualified-recipe.global.ts'],
    setupFiles: ['./tests/setup-host-env.ts', './tests/qualified-recipe.setup.ts', './tests/setup.ts'],
    sequence: { setupFiles: 'list' },
  },
});
