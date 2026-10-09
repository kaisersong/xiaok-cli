import { describe, it, expect } from 'vitest';
import { PermissionManager } from '../../../src/ai/permissions/manager.js';
const chk = (mode: any, rules: string[], command: string, deny: string[] = []) => new PermissionManager({ mode, allowRules: rules, denyRules: deny }).check('bash', { command });
const must = [
 'git reset --hard HEAD~1','git clean -xdf','git clean -f','git push origin :main','git push origin --delete main','git push --mirror','git branch -D main','git checkout -- .','git restore .','git stash drop','git reflog expire --expire=now --all','git gc --prune=now',
 'git status 1> ~/.bashrc','git status &> /tmp/x','git status >| /tmp/x','git status 2>/home/u/.bashrc','git log >/tmp/x','git log --output /tmp/x','git diff --output=/tmp/x',
 'git -c core.pager=sh log','git -ccore.pager=sh log','git --config-env=core.pager=X log','git -C /tmp -c alias.x=!id x','git config alias.s "!id"','git config --global core.editor id','git config core.hooksPath /tmp/h','git rebase --exec id HEAD~1','git rebase -i --exec=id HEAD~1','git submodule foreach id','git bisect run id','git difftool --extcmd=id','git mergetool','git filter-branch --tree-filter id','git commit --amend --no-verify -m x','git am --exec x',
 'git clone ext::sh x','git fetch --upload-pack=id origin','git ls-remote --upload-pack=id origin','git archive --remote=x HEAD',
 'git {reset,--hard}','FOO=1 git reset --hard','env git reset --hard','command git reset --hard','sudo git status','nohup git reset --hard','xargs git reset --hard','git status | xargs rm','git status; rm -rf x',
 '/usr/bin/git reset --hard','"git" reset --hard',"'git' clean -fd",'\\git reset --hard','git\treset\t--hard','git   reset   --hard','GIT reset --hard',
];
const ok = ['git status','git diff','git diff --stat HEAD~1','git log --oneline -10','git log -p','git show HEAD','git branch','git branch -a','git add .','git commit -m "feat: x"','git fetch','git pull','git push','git push origin main','git checkout -b feat','git stash','git remote -v','git tag','git blame a.ts','git status --porcelain'];
for (const mode of ['default','auto'] as const) for (const rules of [['bash(git *)'],['bash(*)']]) {
  describe(`${mode} ${rules[0]}`, () => {
    it.each(must)('不放行 %j', async c => { expect(await chk(mode, rules, c)).not.toBe('allow'); });
    it.each(ok)('放行 %j', async c => { expect(await chk(mode, rules, c)).toBe('allow'); });
  });
}
describe('deny 规则穿透包装', () => {
  it.each(['rm -rf x','env rm x','timeout 5 rm x','nice -n 5 rm x','command rm x','nohup rm x','sh -c "rm x"','bash -lc "rm x"','xargs rm','find . -exec rm {} \\;','time rm x','stdbuf -o0 rm x','/bin/rm x','busybox rm x'])('%j 被 bash(rm *) 拒绝', async c => {
    expect(await chk('default', ['bash(*)'], c, ['bash(rm *)'])).toBe('deny');
  });
});
