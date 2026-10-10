import { describe, expect, it } from 'vitest';
import { PermissionManager } from '../../../src/ai/permissions/manager.js';

describe('round13 wrapper deny candidates', () => {
  for (const mode of ['auto', 'default'] as const) {
    it.each([
      'timeout --bogus rm -f x',
      'env -u rm -f x',
      'nice --weird rm -f x',
      'stdbuf -X rm -f x',
      'nohup rm -f x',
      'FOO=bar /usr/bin/timeout --bogus rm -f x',
      'timeout --bogus nohup rm -f x',
      'nice --weird rm -f "x y"',
    ])(`${mode} denies uncertain wrapper: %s`, async command => {
      const manager = new PermissionManager({
        mode, denyRules: ['bash(rm *)'],
        allowRules: mode === 'default' ? ['bash(*)'] : [],
      });
      expect(await manager.check('bash', { command })).toBe('deny');
    });
  }

  it('allows a known timeout payload', async () => {
    const manager = new PermissionManager({ mode: 'default', denyRules: ['bash(rm *)'], allowRules: ['bash(*)'] });
    expect(await manager.check('bash', { command: 'timeout 5 ls' })).toBe('allow');
  });

  it('does not use uncertain deny candidates to activate conservative allow checks', async () => {
    const manager = new PermissionManager({ mode: 'auto', allowRules: ['bash(git *)'] });
    expect(await manager.check('bash', {
      command: 'timeout --bogus git commit -m "$(cat msg.txt)"',
    })).toBe('allow');
  });

  it.each([
    'git commit -m "$(cat msg.txt)"',
    'echo hi > /tmp/x.txt',
    'git -c color.ui=always log -1',
  ])('keeps deny-only auto behaviour: %s', async command => {
    const manager = new PermissionManager({ mode: 'auto', denyRules: ['bash(rm *)'] });
    expect(await manager.check('bash', { command })).toBe('allow');
  });

  it.each(['echo \\{a,b\\}', "echo '{a,b}'", "ls '{src,tests}'", 'ls {src,tests}'])(
    'allows ordinary brace arguments: %s', async command => {
      const manager = new PermissionManager({ mode: 'default', allowRules: ['bash(*)'] });
      expect(await manager.check('bash', { command })).toBe('allow');
    },
  );
});
