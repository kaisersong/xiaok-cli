import { describe, expect, it } from 'vitest';
import { createSandboxPolicy } from '../../../src/platform/sandbox/policy.js';
import { createSandboxEnforcer } from '../../../src/platform/sandbox/enforcer.js';

describe('sandbox enforcer', () => {
  it('returns explainable denials for path and network violations', () => {
    const enforcer = createSandboxEnforcer(createSandboxPolicy({
      pathAllowlist: ['/repo'],
      network: 'deny',
    }));

    expect(enforcer.enforceFile('/tmp/file.ts')).toEqual({
      allowed: false,
      reason: 'path is outside allowlist',
    });
    expect(enforcer.enforceNetwork()).toEqual({
      allowed: false,
      reason: 'network access disabled by sandbox policy',
    });
  });
});
