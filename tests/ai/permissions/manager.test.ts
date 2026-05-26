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

  it('matches remembered python rules for multi-line bash commands', async () => {
    const pm = new PermissionManager({
      mode: 'default',
      allowRules: ['bash(python3 *)'],
    });

    await expect(pm.check('bash', {
      command: 'python3 -c "\\nimport subprocess\\nprint(1)\\n"',
    })).resolves.toBe('allow');

    await expect(pm.check('bash', {
      command: "python3 - <<'PY'\nprint(1)\nPY",
    })).resolves.toBe('allow');
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

  it('denies read/write/edit on built-in sensitive paths', async () => {
    const pm = new PermissionManager({ mode: 'auto' });
    await expect(pm.check('read', { file_path: '/repo/.env' })).resolves.toBe('deny');
    await expect(pm.check('write', { file_path: '/repo/id_rsa' })).resolves.toBe('deny');
    await expect(pm.check('edit', { file_path: '/etc/server.pem' })).resolves.toBe('deny');
  });

  it('allows sensitive paths when user has explicit allow rule', async () => {
    const pm = new PermissionManager({
      mode: 'default',
      allowRules: ['read:/repo/.env'],
    });
    await expect(pm.check('read', { file_path: '/repo/.env' })).resolves.toBe('allow');
  });

  it('still allows benign neighbour files without rule', async () => {
    const pm = new PermissionManager({ mode: 'default' });
    await expect(pm.check('read', { file_path: '/repo/.env.example' })).resolves.toBe('allow');
  });

  it('prompts for screen automation shell fallback even in auto mode', async () => {
    const pm = new PermissionManager({ mode: 'auto' });
    await expect(pm.check('bash', { command: 'screencapture -x /tmp/current.png' })).resolves.toBe('prompt');
    await expect(pm.check('bash', { command: 'osascript -e \'tell application "System Events" to click menu item 1\'' })).resolves.toBe('prompt');
  });

  it('allows screen automation fallback only with an explicit remembered rule', async () => {
    const pm = new PermissionManager({
      mode: 'auto',
      allowRules: ['bash:screencapture -x /tmp/current.png'],
    });
    await expect(pm.check('bash', { command: 'screencapture -x /tmp/current.png' })).resolves.toBe('allow');
  });
});
