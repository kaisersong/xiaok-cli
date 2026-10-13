import { describe, expect, it } from 'vitest';
import { PermissionManager } from '../../../src/ai/permissions/manager.js';
import { PermissionPolicyEngine } from '../../../src/ai/permissions/policy-engine.js';

const wrappers = ['nohup', 'time', 'nice -n 5', 'timeout --signal TERM -k 2 5', 'stdbuf -i 0 -oL -e0', 'env -u HOME X=1', 'nohup timeout 5 nice -n 2'];
for (const mode of ['default', 'auto'] as const) {
  describe(`round11 ${mode}`, () => {
    const check = (command: string, allowRules = ['bash(*)'], denyRules: string[] = []) =>
      new PermissionManager({ mode, allowRules, denyRules }).check('bash', { command });
    it.each(['{git,echo} status', 'gi{t,x} status', 'cmd{1..3}', 'git push origin {main,other}', 'rm {a,b}', 'git push "`echo x`"', '(git push -f)', '{ git push -f; }', ...wrappers.map(w => `${w} git push "$X"`), ...wrappers.map(w => `${w} git push -f`)])('requires confirmation: %s', async command => {
      expect(await check(command)).toBe('prompt');
    });
    it.each(['[ -f package.json ] && npm test', '[[ -f a ]]', 'git status', 'git diff', 'git log', 'echo "{a,b}"', 'echo \\{a,b\\}'])('keeps literal/routine approval: %s', async command => {
      expect(await check(command)).toBe('allow');
    });
    it.each([...wrappers.map(w => `${w} rm -rf x`), '(rm -rf x)', '{ rm -rf x; }', '(nohup rm -rf x)'])('inner deny wins: %s', async command => {
      expect(await check(command, ['bash(*)', 'bash(nohup *)'], ['bash(rm *)'])).toBe('deny');
    });
    it('does not widen a narrow allow through a wrapper', async () => {
      const engine = new PermissionPolicyEngine({ globalAllow: ['bash(git *)'], globalDeny: [], projectAllow: [], projectDeny: [], sessionAllow: [], sessionDeny: [] });
      expect((await engine.evaluate('bash', { command: 'nohup git status' })).action).toBe('prompt');
      expect(await check('nohup git status', ['bash(nohup *)'])).toBe('allow');
    });
  });
}
it('policy engine itself rejects command brace expansion', async () => {
  const engine = new PermissionPolicyEngine({ globalAllow: ['bash(*)'], globalDeny: [], projectAllow: [], projectDeny: [], sessionAllow: [], sessionDeny: [] });
  expect((await engine.evaluate('bash', { command: '{git,echo} status' })).action).toBe('prompt');
});
