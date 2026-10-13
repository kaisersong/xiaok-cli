import { describe, it, expect } from 'vitest';
import { PermissionManager } from '../../../src/ai/permissions/manager.js';
const cases: string[] = [
 'git reset --hard','git clean -fdx','git push origin :main',
 'git -c core.pager=sh log','git -c alias.x=!sh x','git --exec-path=/tmp status',
 'git status > ~/.bashrc','git status >> ~/.ssh/authorized_keys','git log --output=/tmp/x','git diff --output=/home/u/.bashrc',
 'git config alias.s "!sh"','git config --global core.sshCommand "sh"','git submodule foreach id','git rebase -x id HEAD~1','git bisect run id','git difftool -x id',
];
for (const mode of ['default','auto'] as const) {
  describe(`probe via PermissionManager mode=${mode} rule=bash(git *)`, () => {
    it.each(cases)('%j', async (command) => {
      const d = await new PermissionManager({ mode, allowRules: ['bash(git *)'] }).check('bash', { command });
      expect(d).not.toBe('allow');
    });
  });
}
