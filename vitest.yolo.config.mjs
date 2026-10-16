import sandbox from './vitest.sandbox.config.mjs';

// Registry-factory tests mock subprocess ownership; exercise this wiring gate
// explicitly without changing the broader sandbox suite's historical excludes.
export default {
  ...sandbox,
  test: { ...sandbox.test, include: ['.test-dist/tests/platform/runtime/registry-factory.test.js'], exclude: [] },
};
