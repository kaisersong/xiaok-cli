import { describe, expect, it } from 'vitest';
import { PermissionManager } from '../../../src/ai/permissions/manager.js';

const executionForms = [
  'git rebase --ex id HEAD~1',
  'git archive --r=x HEAD',
  'git archive --re=x HEAD',
  'git fetch --up=x origin',
  'git -C repo fetch --upload-pack=x origin',
  'git fetch --upload=x origin',
  'git fetch --upload-p=x origin',
  'git push --receive=x origin',
  'git push --rec=x origin',
  'git archive --remo=x HEAD',
  'git send-pack --exe=x',
  'git rebase --exe=x HEAD~1',
  'git diff --ext-d',
  'git difftool --extc=x',
  'git fetch --upl x origin',
  'git archive --rem x HEAD',
  'git diff --ext',
  ...['fetch', 'ls-remote', 'clone', 'pull', 'archive'].flatMap(subcommand => [
    `git ${subcommand} --upload-pack=x origin`,
    `git ${subcommand} --upload-pack x origin`,
  ]),
  'git clone -u x origin',
  'git clone -ux origin',
  ...['push', 'send-pack'].flatMap(subcommand => [
    `git ${subcommand} --receive-pack=x origin`,
    `git ${subcommand} --receive-pack x origin`,
  ]),
  ...['send-pack', 'archive', 'am', 'status', 'rebase', 'push'].flatMap(subcommand => [
    `git ${subcommand} --exec=x HEAD`,
    `git ${subcommand} --exec x HEAD`,
  ]),
  ...['ext::sh', "'ext::sh x'", '"ext::sh x"'].flatMap(url => [
    `git clone ${url} x`,
    `git fetch ${url}`,
    `git pull ${url}`,
    `git ls-remote ${url}`,
    `git remote add origin ${url}`,
    `git push ${url} main`,
    `git submodule add ${url} x`,
  ]),
  'git archive --remote=x HEAD',
  'git archive --remote x HEAD',
  'git mergetool',
  'git difftool',
  'git difftool HEAD',
  'git difftool -x x',
  'git difftool --extcmd=x',
  'git mergetool --tool=x',
  'git push --repo="ext::sh x" main',
  'git archive --remote="ext::sh x" HEAD',
  'git -C /tmp fetch --upload-pack=x origin',
  'git clone origin --upload-pack x',
];

const plainForms = [
  'git fetch',
  'git fetch origin',
  'git fetch --upload-packs=x origin',
  'git diff --no-ext-diff',
  'git diff --stat',
  'git diff --exit-code',
  'git pull',
  'git clone https://example.invalid/r.git',
  'git ls-remote origin',
  'git archive HEAD',
  'git remote add origin https://example.invalid/r.git',
  // fetch/push -u have unrelated meanings; ls-remote has no -u alias.
  'git fetch -u origin',
  'git push -u origin main',
];

function check(mode: 'default' | 'auto', allowRules: string[], command: string) {
  return new PermissionManager({ mode, allowRules }).check('bash', { command });
}

for (const rule of ['bash(git *)', 'bash(*)']) {
  for (const mode of ['default', 'auto'] as const) {
    describe(`${mode} ${rule}`, () => {
      it.each(executionForms)('requires confirmation: %s', async command => {
        expect(await check(mode, [rule], command)).not.toBe('allow');
      });
    });
  }
  describe(`default ${rule} plain forms`, () => {
    it.each(plainForms)('allows %s', async command => {
      expect(await check('default', [rule], command)).toBe('allow');
    });
    it('conservatively prompts for ext:: in an author filter', async () => {
      // 当前 ext:: 检测保守覆盖选项值，即使 author 过滤本身不执行外部程序。
      expect(await check('default', [rule], 'git log --author=ext::x')).toBe('prompt');
    });
    it('preserves archive output target handling', async () => {
      expect(await check('default', [rule], 'git archive --format=zip HEAD -o out.zip')).toBe('prompt');
      expect(await check('default', [rule], 'git archive --format=zip HEAD --output=out.zip')).toBe('prompt');
    });
  });
}

describe('auto without rules preserves existing behavior', () => {
  it.each(executionForms)('allows %s', async command => {
    expect(await check('auto', [], command)).toBe('allow');
  });
});
