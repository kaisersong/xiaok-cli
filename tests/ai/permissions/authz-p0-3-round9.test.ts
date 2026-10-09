import { it, expect } from 'vitest';
import { PermissionManager } from '../../../src/ai/permissions/manager.js';
import { getCommandWriteTargets, matches } from '../../../src/ai/permissions/policy-engine.js';
it.each(['>', '>>', '>|', '&>', '&>>', '1>', '2>'])('requires review for file operator %s', async operator => {
  const command = `git status ${operator} result.txt`;
  expect(getCommandWriteTargets(command)).toEqual(['result.txt']);
  expect(matches(['bash(*)'], 'bash', { command })).toBe(false);
  expect(await new PermissionManager({ mode: 'default', cwd: '/fiction/work', allowRules: ['bash(*)'] }).check('bash', { command })).toBe('prompt');
  expect(await new PermissionManager({ mode: 'auto', cwd: '/fiction/work', allowRules: ['bash(*)'] }).check('bash', { command })).toBe('allow');
});
it.each(['../outside.txt', '/fiction/other.txt', '~/result.txt', '$DEST', '`destination`', 'C:/fiction/result.txt', '//server/share/result.txt'])('reviews unresolved or outside target %s', async target => {
  expect(await new PermissionManager({ mode: 'auto', cwd: '/fiction/work', allowRules: ['bash(*)'] }).check('bash', { command: `git log > ${target}` })).toBe('prompt');
});
it.each(['git push origin --delete branch', 'git push -d', 'git --config-env=core.pager=PAGER log', 'GIT_EDITOR=editor git status', 'git config core.hooksPath hooks', 'git config credential.helper helper', 'git diff --ext-diff', 'git filter-branch', 'git rebase --exec task HEAD', 'git difftool --extcmd task'])('retains mandatory review: %s', async command => {
  for (const mode of ['auto', 'default'] as const) expect(await new PermissionManager({ mode, allowRules: ['bash(*)'] }).check('bash', { command })).toBe('prompt');
});
it('preserves quoted text and fd copies', () => {
  expect(getCommandWriteTargets('git commit -m "x > text" 2>&1')).toEqual([]);
  expect(getCommandWriteTargets('git log --output "result file.txt"')).toEqual(['result file.txt']);
});
it('keeps master AUTO approval for Windows write targets without rules', async () => {
  const manager = new PermissionManager({ mode: 'auto', cwd: 'C:/Fiction/Work' });
  expect(await manager.check('bash', { command: 'git log > c:/fiction/work/result.txt' })).toBe('allow');
  expect(await manager.check('bash', { command: 'git log > C:/fiction/work-other/result.txt' })).toBe('allow');
});
it.each(['sh -c "git log > /fiction/outside.txt"', 'git log >result.txt>../outside.txt'])('retains destination review across literal shell forms: %s', async command => {
  expect(await new PermissionManager({ mode: 'auto', cwd: '/fiction/work', allowRules: ['bash(*)'] }).check('bash', { command })).toBe('prompt');
});

it.each(['kill -9 12345', 'chmod -R u+rw ./cache', 'chown -R fictional ./cache', 'find . -name x -exec rm {} \\;', 'python -c "print(1)"', 'eval "echo hi"'])('warn rules do not override mode behavior: %s', async command => {
  expect(matches(['bash(*)'], 'bash', { command })).toBe(false);
  for (const allowRules of [[], ['bash(*)']]) {
    expect(await new PermissionManager({ mode: 'default', allowRules }).check('bash', { command })).toBe('prompt');
    expect(await new PermissionManager({ mode: 'auto', allowRules }).check('bash', { command })).toBe('allow');
  }
});
it.each(['git reset --hard', 'git clean -fdx'])('auto data-loss review cannot be bypassed by rules: %s', async command => {
  expect(matches(['bash(*)'], 'bash', { command })).toBe(false);
  expect(await new PermissionManager({ mode: 'auto', allowRules: ['bash(*)'] }).check('bash', { command })).toBe('prompt');
});
