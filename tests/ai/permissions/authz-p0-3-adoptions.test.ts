import { it, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadSettings, mergeRules, adoptProjectRule, listPendingProjectRules, addAllowRule, addDenyRule } from '../../../src/ai/permissions/settings.js';
import { PermissionManager } from '../../../src/ai/permissions/manager.js';
it('project approvals are local and tied to exact rule text', async () => {
  const root = await mkdtemp(join(tmpdir(), 'p0-rules-'));
  const previous = process.env.XIAOK_CONFIG_DIR;
  process.env.XIAOK_CONFIG_DIR = join(root,'global');
  const repo = join(root,'ws');
  try {
    await mkdir(join(repo,'.xiaok'),{recursive:true});
    const file = join(repo,'.xiaok','settings.json');
    const save = (allow: string[]) => writeFile(file,JSON.stringify({permissions:{allow,deny:['bash(ls)']}}));
    await save(['bash(git *)','bash(ls)']);
    await addAllowRule('global','bash(echo *)',repo);
    expect(mergeRules(await loadSettings(repo)).allowRules).toEqual(['bash(echo *)']);
    expect(await listPendingProjectRules(repo)).toEqual(['bash(git *)','bash(ls)']);
    await addDenyRule('global','bash(git diff *)',repo);
    await adoptProjectRule(repo,'bash(git *)');
    expect(mergeRules(await loadSettings(repo)).allowRules).toContain('bash(git *)');
    expect(await listPendingProjectRules(repo)).toEqual(['bash(ls)']);
    expect(await new PermissionManager({mode:'default',...mergeRules(await loadSettings(repo))}).check('bash',{command:'git diff'})).toBe('deny');
    const rules = mergeRules(await loadSettings(repo));
    expect(await new PermissionManager({mode:'default',...rules}).check('bash',{command:'ls'})).toBe('deny');
    await save(['bash(git diff *)']);
    expect(mergeRules(await loadSettings(repo)).allowRules).not.toContain('bash(git diff *)');
    await expect(adoptProjectRule(repo,'bash(git *)')).rejects.toThrow();
    const record = join(root,'global','project-rule-adoptions.json');
    expect(await readFile(record,'utf8')).toContain(repo);
    if (process.platform !== 'win32') expect((await stat(record)).mode & 0o777).toBe(0o600);
    await addAllowRule('project','write(/ws/src/*)',repo);
    expect(mergeRules(await loadSettings(repo)).allowRules).toContain('write(/ws/src/*)');
    expect(await readFile(file,'utf8')).not.toContain('write');
  } finally {
    if (previous === undefined) delete process.env.XIAOK_CONFIG_DIR; else process.env.XIAOK_CONFIG_DIR = previous;
    await rm(root,{recursive:true,force:true});
  }
});

it.each(['bash(echo "x;y" *)', 'bash(echo \x1b[2J *)'])('invalid adoption records fail closed and rule hashes preserve exact text: %j', async (rule) => {
  const root = await mkdtemp(join(tmpdir(), 'p0-exact-'));
  const previous = process.env.XIAOK_CONFIG_DIR;
  process.env.XIAOK_CONFIG_DIR = join(root, 'global');
  const repo = join(root, 'ws');
  try {
    await mkdir(join(repo, '.xiaok'), {recursive:true});
    await mkdir(join(root, 'global'), {recursive:true});
    const file = join(repo, '.xiaok', 'settings.json');
    const record = join(root, 'global', 'project-rule-adoptions.json');
    const save = (text: string) => writeFile(file, JSON.stringify({permissions:{allow:[text]}}));
    await save(rule);
    for (const invalid of ['{', 'null', '[]', '{"adoptions":[],"localRules":{}}', '{"adoptions":{"x":[1]},"localRules":{}}']) {
      await writeFile(record, invalid);
      expect((await loadSettings(repo)).approvedProjectAllow).toEqual([]);
    }
    await adoptProjectRule(repo, rule);
    expect((await loadSettings(repo)).approvedProjectAllow).toEqual([rule]);
    expect((await loadSettings(repo)).approvedProjectAllow).toEqual([rule]);
    await save('bash(echo "x;z" *)');
    expect((await loadSettings(repo)).approvedProjectAllow).toEqual([]);
  } finally {
    if (previous === undefined) delete process.env.XIAOK_CONFIG_DIR; else process.env.XIAOK_CONFIG_DIR = previous;
    await rm(root, {recursive:true,force:true});
  }
});

it.skipIf(process.platform === 'win32')('realpath shares approval identity for a project alias', async () => {
  const { symlink } = await import('node:fs/promises');
  const root = await mkdtemp(join(tmpdir(), 'p0-alias-'));
  const previous = process.env.XIAOK_CONFIG_DIR;
  process.env.XIAOK_CONFIG_DIR = join(root, 'global');
  const repo = join(root, 'ws');
  const alias = join(root, 'alias');
  try {
    await mkdir(join(repo, '.xiaok'), {recursive:true});
    await writeFile(join(repo, '.xiaok', 'settings.json'), JSON.stringify({permissions:{allow:['bash(git *)']}}));
    await symlink(repo, alias, 'dir');
    await adoptProjectRule(alias, 'bash(git *)');
    expect((await loadSettings(repo)).approvedProjectAllow).toEqual(['bash(git *)']);
    expect((await loadSettings(alias)).approvedProjectAllow).toEqual(['bash(git *)']);
  } finally {
    if (previous === undefined) delete process.env.XIAOK_CONFIG_DIR; else process.env.XIAOK_CONFIG_DIR = previous;
    await rm(root, {recursive:true,force:true});
  }
});
