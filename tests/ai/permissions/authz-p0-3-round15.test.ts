import { it, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PermissionManager } from '../../../src/ai/permissions/manager.js';
import { getCommandWriteTargets, requiresCommandConfirmation, exceedsCommandInspectionBudget } from '../../../src/ai/permissions/policy-engine.js';
import { addAllowRule, adoptProjectRule, loadSettings } from '../../../src/ai/permissions/settings.js';
import { buildPermissionPromptOptions } from '../../../src/ui/permission-prompt.js';
const forms = [
  'archive -o X HEAD', 'archive -oX HEAD', 'archive --output X HEAD', 'archive --output=X HEAD',
  'format-patch -o X HEAD', 'format-patch -oX HEAD', 'format-patch --output-directory X HEAD', 'format-patch --output-directory=X HEAD', 'format-patch --output=X HEAD',
  'bundle create --quiet X HEAD', 'fast-export --export-marks=X HEAD', 'fast-export --export-marks X HEAD',
  ...['diff','log','show','diff-tree','diff-index','diff-files','range-diff','rev-list','whatchanged','stash show'].flatMap(c => [`${c} --output=X`, `${c} --output X`]),
];
it.each(forms)('Git output: %s', async form => {
  expect(getCommandWriteTargets(`git ${form}`)).toContain('X');
  for (const mode of ['default','auto'] as const) {
    const manager = new PermissionManager({mode,cwd:'/workspace/project',allowRules:['bash(git *)']});
    expect(await manager.check('bash',{command:`git ${form.replace('X','/outside/result')}`})).toBe('prompt');
    if (mode === 'default') expect(await manager.check('bash',{command:`git ${form}`})).toBe('prompt');
  }
});
it.each(['git log -o','git status','git log --oneline','git diff'])('daily command %s', async command => {
  expect(getCommandWriteTargets(command)).toEqual([]);
  for (const mode of ['default','auto'] as const) expect(await new PermissionManager({mode,allowRules:['bash(git *)']}).check('bash',{command})).toBe('allow');
});
it('Git -C accumulates and global options locate the subcommand', async () => {
  expect(getCommandWriteTargets('git --git-dir=.git -C sub -C nested archive -oa.zip HEAD')).toEqual(['sub/nested/a.zip']);
  expect(getCommandWriteTargets('git -c user.name=x -Csub archive -o a.zip HEAD')).toEqual(['sub/a.zip']);
  expect(getCommandWriteTargets('git -C sub -C /outside archive -oa.zip HEAD')).toEqual(['/outside/a.zip']);
  expect(getCommandWriteTargets('git -C "$DIR" archive -o a.zip HEAD')).toEqual(['$unresolved']);
  expect(getCommandWriteTargets('git archive --out=x HEAD')).toEqual([]);
  expect(getCommandWriteTargets('git diff --out=x')).toEqual([]);
  for (const mode of ['default','auto'] as const) expect(await new PermissionManager({mode,cwd:'/workspace/project',allowRules:['bash(git *)']}).check('bash',{command:'git -C ../outside archive -oa.zip HEAD'})).toBe('prompt');
});
it('workdir is the resolution base, workspace remains the boundary', async () => {
  for (const mode of ['default','auto'] as const) {
    const manager = new PermissionManager({mode,cwd:'/workspace/project',allowRules:['bash(git *)']});
    for (const workdir of ['/outside', '../outside', 42, null]) expect(await manager.check('bash',{command:'git status > out',workdir})).toBe('prompt');
    for (const input of [{command:'git status > out'},{command:'git status > out',workdir:'sub'}]) expect(await manager.check('bash',input)).toBe(mode === 'auto' ? 'allow' : 'prompt');
    expect(await manager.check('bash',{command:'git status > /workspace/project/out',workdir:'/outside'})).toBe('prompt');
  }
  expect(await new PermissionManager({mode:'auto',cwd:'/workspace/project'}).check('bash',{command:'git status > out',workdir:'/outside'})).toBe('allow');
});
it.each([16,20,64])('wrapper budget %i', async count => {
  const command = 'env --unknown '.repeat(count) + 'ls';
  for (const mode of ['default','auto'] as const) {
    const start = performance.now();
    expect(await new PermissionManager({mode,allowRules:['bash(env *)']}).check('bash',{command})).toBe('prompt');
    expect(performance.now()-start).toBeLessThan(200);
  }
  expect(() => getCommandWriteTargets(command)).not.toThrow();
});
// Budget design: charge recursive inspection calls, never command words. Keep
// the 2000-call and depth bounds against uncertain-wrapper fan-out; review both
// ordinary long payloads and dangerous commands inside realistic wrappers.
it('long ordinary commands do not exhaust the inspection budget', async () => {
  const body = Array.from({ length: 600 }, () => 'one two three four five six seven eight').join('\n');
  const args = Array.from({ length: 3000 }, (_, index) => `arg${index}`).join(' ');
  const manager = new PermissionManager({ mode: 'auto', allowRules: [] });
  for (const command of [
    `cat > notes.md <<'EOF'\n${body}\nEOF`,
    `git commit -m "$(cat <<'EOF'\n${body}\nEOF\n)"`,
    `ls ${args}`,
  ]) expect(await manager.check('bash', { command })).toBe('allow');
  expect(await new PermissionManager({ mode: 'default', allowRules: ['bash(npm *)'] })
    .check('bash', { command: `npm test -- ${args}` })).toBe('allow');
});
it('realistic nested wrappers retain confirmation semantics', async () => {
  const commands = [
    `env A=1 nice -n 5 timeout 10 sh -c "bash -c 'git status'"`,
    'env A=1 sh -c "git push --force"',
  ];
  for (const command of commands) {
    expect(exceedsCommandInspectionBudget(command)).toBe(false);
    for (const mode of ['default', 'auto'] as const) {
      expect(await new PermissionManager({ mode, allowRules: ['bash(env *)'] })
        .check('bash', { command })).toBe(requiresCommandConfirmation(command) ? 'prompt' : 'allow');
    }
  }
  expect(requiresCommandConfirmation(commands[1])).toBe(true);
});
it('write prompts cannot persist permission; npm test still can', () => {
  expect(buildPermissionPromptOptions('bash(git *)','bash',{command:'git status > out.txt'}).map(o=>o.choice.action)).toEqual(['allow_once','deny']);
  expect(buildPermissionPromptOptions('bash(npm *)','bash',{command:'npm test'}).map(o=>o.choice.action)).toContain('allow_project');
});
it('adoption corruption preserves other projects and backs up invalid JSON atomically', async () => {
  const root = await mkdtemp(join(tmpdir(),'round15-'));
  const previous = process.env.XIAOK_CONFIG_DIR;
  process.env.XIAOK_CONFIG_DIR = join(root,'config');
  try {
    const repo = join(root,'repo');
    await mkdir(join(repo,'.xiaok'),{recursive:true});
    await writeFile(join(repo,'.xiaok','settings.json'),JSON.stringify({permissions:{allow:['bash(git *)']}}));
    await adoptProjectRule(repo,'bash(git *)');
    const file = join(root,'config','project-rule-adoptions.json');
    const state = JSON.parse(await readFile(file,'utf8'));
    state.adoptions.bad = 42;
    state.adoptions[repo].push(42);
    state.localRules['__proto__'] = ['bash(*)'];
    state.localRules['constructor'] = ['bash(*)'];
    state.localRules.other = ['bash(ls)',42];
    await writeFile(file,JSON.stringify(state));
    await addAllowRule('project','bash(npm *)',join(root,'another'));
    expect((await loadSettings(repo)).approvedProjectAllow).toContain('bash(git *)');
    expect(Object.hasOwn(JSON.parse(await readFile(file,'utf8')).localRules, 'constructor')).toBe(false);
    expect(JSON.parse(await readFile(file,'utf8')).localRules.other).toEqual(['bash(ls)']);
    await writeFile(file,'{broken');
    await expect(addAllowRule('project','bash(ls)',repo)).resolves.toBeUndefined();
    expect(await readFile(`${file}.bak`,'utf8')).toBe('{broken');
    expect((await loadSettings(repo)).approvedProjectAllow).toEqual(['bash(ls)']);
    expect((await readdir(join(root,'config'))).sort()).toEqual(['project-rule-adoptions.json','project-rule-adoptions.json.bak']);
    if (process.platform !== 'win32') expect((await stat(file)).mode & 0o777).toBe(0o600);
  } finally {
    if (previous === undefined) delete process.env.XIAOK_CONFIG_DIR; else process.env.XIAOK_CONFIG_DIR = previous;
    await rm(root,{recursive:true,force:true});
  }
});

it('Windows workdir and Git -C keep the workspace boundary', async () => {
  expect(getCommandWriteTargets("git -C 'C:\\workspace\\sub' -C nested archive -oa.zip HEAD")).toEqual(['C:\\workspace\\sub\\nested\\a.zip']);
  const manager = new PermissionManager({mode:'auto',cwd:'C:\\workspace',allowRules:['bash(git *)']});
  expect(await manager.check('bash',{command:'git status > out',workdir:'sub'})).toBe('allow');
  expect(await manager.check('bash',{command:'git status > out',workdir:'C:\\outside'})).toBe('prompt');
  expect(await manager.check('bash',{command:'git status > out',workdir:'\\\\server\\share'})).toBe('prompt');
});
it('npm test remains allowed under its matching rule', async () => {
  for (const mode of ['default','auto'] as const) expect(await new PermissionManager({mode,allowRules:['bash(npm *)']}).check('bash',{command:'npm test'})).toBe('allow');
});
