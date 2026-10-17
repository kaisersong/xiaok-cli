import { stripHostLeaks } from './host-env.js';

// Vitest `setupFiles` entry shared by every config (default, sandbox,
// skill-release, desktop). It runs inside each test worker before the test file
// is loaded, so both in-process reads and spawned children see a clean env.
// Set XIAOK_TEST_ENV_STRICT=1 to fail instead of silently stripping.
const removed = stripHostLeaks();
if (removed.length > 0 && process.env.XIAOK_TEST_ENV_STRICT === '1') {
  throw new Error(`test_env_leak: host variables present at test start: ${removed.join(', ')}`);
}
