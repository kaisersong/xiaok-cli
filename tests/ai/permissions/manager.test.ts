import { describe, it, expect } from 'vitest';
import { PermissionManager } from '../../../src/ai/permissions/manager.js';

describe('PermissionManager', () => {
  it('denies write tools in plan mode', async () => {
    const pm = new PermissionManager({ mode: 'plan' });

    expect(await pm.check('write', { file_path: '/tmp/x' })).toBe('deny');
  });

  it('auto-allows matching bash rule', async () => {
    const pm = new PermissionManager({
      mode: 'default',
      allowRules: ['bash:git status*'],
    });

    expect(await pm.check('bash', { command: 'git status --short' })).toBe('allow');
  });

  it('matches persisted ui-style rules for remembered approvals', async () => {
    const pm = new PermissionManager({
      mode: 'default',
      allowRules: ['bash(git status *)', 'write(/tmp/project/*)'],
    });

    await expect(pm.check('bash', { command: 'git status --short' })).resolves.toBe('allow');
    await expect(pm.check('write', { file_path: '/tmp/project/src/index.ts' })).resolves.toBe('allow');
  });

  it('treats ui-style single-word bash rules as matching the bare command and command with args', async () => {
    const pm = new PermissionManager({
      mode: 'default',
      allowRules: ['bash(pwd *)'],
    });

    await expect(pm.check('bash', { command: 'pwd' })).resolves.toBe('allow');
    await expect(pm.check('bash', { command: 'pwd -L' })).resolves.toBe('allow');
  });

  it('supports session deny rules with higher priority than allow rules', async () => {
    const pm = new PermissionManager({
      mode: 'default',
      allowRules: ['bash:git status*'],
    });

    pm.addSessionDenyRule('bash:git status*');

    expect(await pm.check('bash', { command: 'git status --short' })).toBe('deny');
  });

  it('cycles permission modes in workflow order', () => {
    expect(PermissionManager.nextMode('default')).toBe('auto');
    expect(PermissionManager.nextMode('auto')).toBe('plan');
    expect(PermissionManager.nextMode('plan')).toBe('default');
  });
});
