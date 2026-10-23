import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Plain JS fixture controls of the real verifier, not full HEAD/native/package qualification.
const script = join(process.cwd(), 'scripts/verify-pack-dist.mjs');
const root = mkdtempSync(join(tmpdir(), 'release-gates literal ${UNSET_GATE_LITERAL} '));
const repo = join(root, 'source repo');
const buildFiles: Record<string, string> = {
  'index.js': 'export const ordinaryFixture = true;\n',
  'build-info.js': 'export const BUILD_TIME = null;\n',
  'commands/chat.js': 'export const approval = false;\n',
  'commands/project-rule-adoption.js': 'export const adoption = true;\n',
  'channels/turn-origin.js': 'export const origin = true;\n',
  'channels/sender-allowlist.js': 'export const guard = true;\n',
  'channels/embedded-yzj.js': '// getTurnOrigin SenderAllowlistGuard\n',
  'ai/runtime/runtime-facade.js': '// runWithTurnOrigin\n',
  'commands/yzj.js': '// allowedSenders\n',
  'ai/permissions/workspace.js': '// realpathSync\n',
};
let sha: string;
let archiveId = 0;
const git = (...args: string[]) => execFileSync('git', ['-c', 'user.email=qa@example.com', '-c', 'user.name=qa', ...args], { cwd: repo, encoding: 'utf8' }).trim();
beforeAll(() => {
  mkdirSync(repo);
  writeFileSync(join(repo, 'package.json'), JSON.stringify({ name: 'ordinary-gate-fixture', version: '9.9.9', scripts: { build: 'node build.cjs' } }));
  writeFileSync(join(repo, 'expected.json'), JSON.stringify(buildFiles));
  writeFileSync(join(repo, 'build.cjs'), "const fs=require('node:fs'),path=require('node:path');for(const [name,text] of Object.entries(JSON.parse(fs.readFileSync('expected.json','utf8')))){const file=path.join('dist',name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,text);}\n");
  git('init', '-q'); git('add', '.'); git('commit', '-q', '-m', 'ordinary verifier fixture'); sha = git('rev-parse', 'HEAD');
  mkdirSync(join(repo, 'node_modules')); // No install hook or executable dependency.
});
afterAll(() => rmSync(root, { recursive: true, force: true }));
function bundle(overrides: Record<string, string | null> = {}, version = '9.9.9') {
  const stage = join(root, `archive-${++archiveId}`); const pkg = join(stage, 'package'); mkdirSync(pkg, { recursive: true });
  writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name: 'ordinary-gate-fixture', version }));
  for (const [name, text] of Object.entries({ ...buildFiles, ...overrides })) {
    if (text === null) continue;
    const file = join(pkg, 'dist', name); mkdirSync(join(file, '..'), { recursive: true }); writeFileSync(file, text);
  }
  const tgz = join(root, `fixture-${archiveId}.tgz`);
  execFileSync('tar', ['-czf', tgz, '-C', stage, 'package']); return tgz;
}
function verify(tgz: string, ref = sha, sourceRepo = repo) {
  return spawnSync(process.execPath, [script, '--tgz', tgz, '--repo', sourceRepo, '--ref', ref], { encoding: 'utf8', timeout: 15_000 });
}
describe('actual verify-pack-dist ordinary gates', () => {
  it('accepts identical ordinary JS bytes/version and resolves literal shell characters in repo paths', () => {
    const result = verify(bundle()); expect(result.status, result.stderr).toBe(0); expect(result.stdout).toContain(`对照提交：${sha}`);
  }, 15_000);
  const required = [
    ['channels/embedded-yzj.js', 'getTurnOrigin'],
    ['channels/embedded-yzj.js', 'SenderAllowlistGuard'],
    ['ai/runtime/runtime-facade.js', 'runWithTurnOrigin'],
    ['commands/yzj.js', 'allowedSenders'],
    ['ai/permissions/workspace.js', 'realpathSync'],
  ];
  for (const [file, text] of required) it(`rejects missing upstream critical string ${text}`, () => {
    const result = verify(bundle({ [file]: buildFiles[file].replace(text, 'removed') }));
    expect(result.status).toBe(1); expect(result.stderr).toContain(`缺少「${text}」`);
  }, 15_000);
  for (const file of ['commands/project-rule-adoption.js', 'channels/turn-origin.js', 'channels/sender-allowlist.js']) it(`rejects missing upstream critical file ${file}`, () => {
    const result = verify(bundle({ [file]: null })); expect(result.status).toBe(1); expect(result.stderr).toContain(`缺少关键文件 dist/${file}`);
  }, 15_000);
  it('rejects forbidden automatic approval text', () => {
    const result = verify(bundle({ 'commands/chat.js': 'onPromptOverride: async () => true' })); expect(result.status).toBe(1); expect(result.stderr).toContain('仍含「onPromptOverride: async () => true」');
  }, 15_000);
  for (const [title, changes, message] of [
    ['missing', { 'index.js': null }, '包内缺少：dist/index.js'],
    ['extra', { 'surplus.js': '// extra' }, '包内多出（重建结果没有）：dist/surplus.js'],
    ['different', { 'index.js': '// changed' }, '内容不同：dist/index.js'],
  ] as const) it(`rejects ${title} dist bytes`, () => {
    const result = verify(bundle(changes)); expect(result.status).toBe(1); expect(result.stderr).toContain(message);
  }, 15_000);
  it('rejects a package version different from the archived source', () => {
    const result = verify(bundle({}, '9.9.8')); expect(result.status).toBe(1); expect(result.stderr).toContain('版本不一致：源码 9.9.9，包内 9.9.8');
  }, 15_000);
  it('rejects missing tgz without running a build', () => {
    const result = verify(join(root, 'absent.tgz')); expect(result.status).toBe(2); expect(result.stderr).toContain('tgz 不存在');
  });
  it('rejects an invalid option-looking ref as data', () => {
    const result = verify(bundle(), '--not-a-reference'); expect(result.status).toBe(1); expect(result.stderr).toContain('脚本执行失败');
  }, 15_000);
  it('preserves upstream build-info byte exclusion', () => {
    const result = verify(bundle({ 'build-info.js': 'export const BUILD_TIME = "fixture time";' })); expect(result.status, result.stderr).toBe(0);
  }, 15_000);
  it('preserves upstream extra-path exception with plain text only, not a binary/proof', () => {
    const result = verify(bundle({ 'runtime/verification/native/win32-x64/ordinary-gate-fixture.txt': 'plain text parser control, not native qualification' })); expect(result.status, result.stderr).toBe(0);
  }, 15_000);
  it('treats shell substitution ref literally and creates no side-effect file', () => {
    const sentinel = join(root, 'forbidden-side-effect');
    const result = verify(bundle(), '$(touch ' + sentinel + ')'); expect(result.status).toBe(1); expect(result.stderr).toContain('脚本执行失败'); expect(existsSync(sentinel)).toBe(false);
  }, 15_000);
  it('rejects a source checkout without node_modules before build', () => {
    const empty = join(root, 'no modules'); execFileSync('git', ['clone', '-q', repo, empty]);
    const result = verify(bundle(), sha, empty); expect(result.status).toBe(1); expect(result.stderr).toContain('不存在，先在 --repo 里 npm ci');
  }, 15_000);
  it('rejects an actual ordinary fixture build failure', () => {
    const failed = join(root, 'failed build'); execFileSync('git', ['clone', '-q', repo, failed]);
    writeFileSync(join(failed, 'build.cjs'), 'process.exit(7);\n');
    execFileSync('git', ['add', 'build.cjs'], { cwd: failed });
    execFileSync('git', ['-c', 'user.email=qa@example.com', '-c', 'user.name=qa', 'commit', '-q', '-m', 'plain JS build failure'], { cwd: failed });
    const failedSHA = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: failed, encoding: 'utf8' }).trim(); mkdirSync(join(failed, 'node_modules'));
    const result = verify(bundle(), failedSHA, failed); expect(result.status).toBe(1); expect(result.stderr).toContain('脚本执行失败');
  }, 15_000);
  it('registers the actual verifier npm entry', () => {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')); expect(pkg.scripts['verify:pack-dist']).toBe('node scripts/verify-pack-dist.mjs');
  });
  it('registers the actual full SHA verifier npm entry', () => {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')); expect(pkg.scripts['verify:release-sha']).toBe('node scripts/check-release-sha.mjs');
  });
});
