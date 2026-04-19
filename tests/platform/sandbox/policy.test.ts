import { describe, expect, it } from 'vitest';
import { createSandboxPolicy, extractSandboxAllowedPaths } from '../../../src/platform/sandbox/policy.js';

describe('sandbox policy', () => {
  it('allows paths inside the worktree root and denies external paths', () => {
    const policy = createSandboxPolicy({
      pathAllowlist: ['/repo/.worktrees'],
      pathDenylist: ['/repo/.worktrees/secret'],
    });

    expect(policy.checkPath('/repo/.worktrees/task-a/file.ts')).toMatchObject({ allowed: true });
    expect(policy.checkPath('/tmp/escape')).toMatchObject({ allowed: false });
    expect(policy.checkPath('/repo/.worktrees/secret/token.txt')).toMatchObject({ allowed: false });
  });

  it('filters env vars and blocks network when disabled', () => {
    const policy = createSandboxPolicy({
      allowedEnv: ['PATH', 'HOME'],
      network: 'deny',
    });

    expect(policy.filterEnv({ PATH: '/bin', SECRET: 'x' })).toEqual({ PATH: '/bin' });
    expect(policy.checkNetworkAccess()).toMatchObject({ allowed: false });
  });

  it('allows runtime expansion of path allowlist entries', () => {
    const policy = createSandboxPolicy({
      pathAllowlist: ['/repo'],
    });

    expect(policy.checkPath('/tmp/outside.txt')).toMatchObject({ allowed: false });

    policy.expandAllowedPaths(['/tmp/outside.txt']);

    expect(policy.checkPath('/tmp/outside.txt')).toMatchObject({ allowed: true });
  });

  it('matches expanded Windows directory prefixes for child paths', () => {
    const policy = createSandboxPolicy({
      pathAllowlist: ['D:\\projects\\xiaok-cli'],
    });

    policy.expandAllowedPaths(['C:\\Users\\song\\AppData\\Roaming\\npm\\node_modules\\@scope\\pkg\\docs']);

    expect(
      policy.checkPath('C:\\Users\\song\\AppData\\Roaming\\npm\\node_modules\\@scope\\pkg\\docs\\providers.md'),
    ).toMatchObject({ allowed: true });
  });

  it('extracts sandbox directory prefixes from persisted sandbox-expand rules', () => {
    expect(extractSandboxAllowedPaths([
      'sandbox-expand:read(C:\\Users\\song\\AppData\\Roaming\\npm\\node_modules\\@scope\\pkg\\docs/*)',
      'bash(cmd *)',
      'sandbox-expand:glob(/tmp/vendor/assets/*)',
    ])).toEqual([
      'C:\\Users\\song\\AppData\\Roaming\\npm\\node_modules\\@scope\\pkg\\docs',
      '/tmp/vendor/assets',
    ]);
  });
});
