import { describe, it, expect } from 'vitest';
import { PermissionManager } from '../../../src/ai/permissions/manager.js';
for (const mode of ['default', 'auto'] as const) {
  describe(`daily approval ${mode}`, () => {
    it.each(['git status', 'git diff', 'git log', 'git log --oneline -5', 'git show HEAD', 'git branch', 'git diff --stat', 'git commit -m "a; b"', 'git status 2>&1', 'git log > /dev/null'])('retains routine approval: %s', async command => {
      expect(await new PermissionManager({ mode, allowRules: ['bash(git *)'] }).check('bash', { command })).toBe('allow');
    });
  });
}
