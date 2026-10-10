import { expect, it } from 'vitest';
import { findHostLeaks } from '../../tests/support/host-env';

// Canary for scripts/check-test-env-isolation.mjs, run from desktop/ with provider keys exported.
it('starts every Desktop test run without host provider variables', () => {
  expect(findHostLeaks(), 'host provider variables leaked into the Desktop test process; is ./tests/setup-host-env.ts wired into desktop/vitest.config.ts?').toEqual([]);
});
