import { expect, it } from 'vitest';
import { findHostLeaks } from './host-env.js';

// Canary: run by scripts/check-test-env-isolation.mjs with provider keys
// exported. It fails loudly if a vitest config is not wired to setup-host-env.
it('starts every test run without host provider variables', () => {
  expect(findHostLeaks(), 'host provider variables leaked into the test process; is setup-host-env wired into this vitest config?').toEqual([]);
});
