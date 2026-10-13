import { expect, it } from 'vitest';
import { PermissionManager } from '../../../src/ai/permissions/manager.js';
import { requiresCommandConfirmation } from '../../../src/ai/permissions/policy-engine.js';

const reviewCommands = [
  'git push --force${IFS}origin main', 'git push -f$X origin main',
  'rm -rf${IFS}/ws/tmp/x', 'rm -r$X -f /ws/tmp/x',
  '`echo rm` -rf /ws/tmp/x', '/usr/bin/gi[t] push -f origin main',
];
it.each(reviewCommands)('broad rules retain mandatory review: %s', async command => {
  expect(requiresCommandConfirmation(command)).toBe(true);
  expect(requiresCommandConfirmation(`bash -c '${command}'`)).toBe(true);
  for (const mode of ['default', 'auto'] as const) {
    for (const rule of ['bash(*)', 'bash(git *)', 'bash(rm *)']) {
      expect(await new PermissionManager({ mode, allowRules: [rule] }).check('bash', { command })).not.toBe('allow');
      expect(await new PermissionManager({ mode, allowRules: [rule], denyRules: ['bash(*)'] }).check('bash', { command })).toBe('deny');
    }
  }
});
const dailyCommands = [
  ['git status', 'bash(git *)'], ['git diff', 'bash(git *)'], ['ls', 'bash(ls *)'],
  ['echo ${HOME}', 'bash(echo *)'], ['git log --format=%h', 'bash(git *)'],
  ['git commit -m "a; b"', 'bash(git *)'], ['ls *.ts', 'bash(ls *)'],
];
it.each(dailyCommands)('daily commands retain matching approval: %s', async (command, rule) => {
  expect(requiresCommandConfirmation(command)).toBe(false);
  for (const mode of ['default', 'auto'] as const) {
    for (const allowRule of [rule, 'bash(*)']) {
      expect(await new PermissionManager({ mode, allowRules: [allowRule] }).check('bash', { command })).toBe('allow');
    }
  }
});
it.each([...reviewCommands, ...dailyCommands.map(([command]) => command)])(
  'default mode without rules prompts: %s', async command => {
    expect(await new PermissionManager({ mode: 'default' }).check('bash', { command })).toBe('prompt');
  },
);
