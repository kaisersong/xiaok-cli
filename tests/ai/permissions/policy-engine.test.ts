import { describe, expect, it } from 'vitest';
import { PermissionPolicyEngine } from '../../../src/ai/permissions/policy-engine.js';

describe('PermissionPolicyEngine', () => {
  it('prefers deny over allow and respects scope ordering', async () => {
    const engine = new PermissionPolicyEngine({
      globalAllow: ['bash:ls*'],
      globalDeny: ['bash:rm -rf*'],
      projectAllow: [],
      projectDeny: [],
      sessionAllow: [],
      sessionDeny: [],
    });

    await expect(engine.evaluate('bash', { command: 'rm -rf /tmp' })).resolves.toMatchObject({ action: 'deny' });
    await expect(engine.evaluate('bash', { command: 'ls -la' })).resolves.toMatchObject({ action: 'allow' });
  });
});
