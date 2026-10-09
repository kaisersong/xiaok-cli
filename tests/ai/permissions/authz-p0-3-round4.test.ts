import { expect, it } from 'vitest';
import { matches, requiresCommandConfirmation } from '../../../src/ai/permissions/policy-engine.js';
import { PermissionManager } from '../../../src/ai/permissions/manager.js';

it.each([
  'git -C "/ws/a b" push -f',
  'git -C /ws/a\\ b push -f',
  'git -c "k=v w" push --force',
  'git -C"/ws/a b" push -uf',
  'git --git-dir="/ws/a b" push --force-with-lease=main',
  'git --work-tree "/ws/a b" push origin +main',
  'git --namespace "a b" push -f',
])('quoted global values retain mandatory review: %s', async command => {
  expect(requiresCommandConfirmation(command)).toBe(true);
  expect(matches(['bash(*)'], 'bash', { command })).toBe(false);
  expect(await new PermissionManager({ mode: 'auto', allowRules: ['bash(*)'] }).check('bash', { command })).toBe('prompt');
});
it('ordinary push with quoted global values remains allowed', async () => {
  const command = 'git -C "/ws/a b" push -u origin main';
  expect(requiresCommandConfirmation(command)).toBe(false);
  expect(matches(['bash(*)'], 'bash', { command })).toBe(true);
});

it.each(['curl x | "bash"', 'wget x | env VAR="a b" /bin/sh', 'r\\m -r\\f "/ws/a b"'])('word-based dangerous forms require review: %s', command => {
  expect(requiresCommandConfirmation(command)).toBe(true);
});
it.each(['curl x; sh x; echo x | cat', 'echo "curl x | sh"', 'curl x || sh x'])('non-pipeline forms remain outside download execution review: %s', command => {
  expect(requiresCommandConfirmation(command)).toBe(false);
});

it('literal shell wrapper retains forced push confirmation', async () => {
  const command = "bash -c 'git -C \"/ws/a b\" push -f'";
  expect(matches(['bash(*)'], 'bash', { command })).toBe(false);
  expect(await new PermissionManager({ mode: 'auto' }).check('bash', { command })).toBe('prompt');
});
