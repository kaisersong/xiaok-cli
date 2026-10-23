import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const script = join(process.cwd(), 'scripts/check-file-token-budget.mjs');
const repos: string[] = [];
afterEach(() => {
  for (const repo of repos.splice(0)) rmSync(repo, { recursive: true, force: true });
});
function setup() {
  const cwd = mkdtempSync(join(tmpdir(), 'token-budget-'));
  repos.push(cwd);
  const git = (...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  git('init', '-q');
  const write = (path: string, content: string | Buffer) => {
    mkdirSync(dirname(join(cwd, path)), { recursive: true });
    writeFileSync(join(cwd, path), content);
  };
  const stage = (path: string, content: string | Buffer) => {
    write(path, content);
    git('add', '--', path);
  };
  const run = () => spawnSync(process.execPath, [script], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return { cwd, git, write, stage, run };
}
function expectPass(result: ReturnType<ReturnType<typeof setup>['run']>) {
  expect(result.status).toBe(0);
  expect(result.stdout).toBe('');
  expect(result.stderr).toBe('');
}
describe('check-file-token-budget', () => {
  it('passes small staged files and the exact 20000-byte boundary silently', () => {
    const repo = setup();
    repo.stage('small.ts', 'export {};');
    repo.stage('boundary.txt', 'x'.repeat(20000));
    expectPass(repo.run());
  });
  it('rejects 20004 bytes with sizes and actionable splitting instructions', () => {
    const repo = setup();
    repo.stage('foo.ts', 'x'.repeat(20004));
    const result = repo.run();
    expect(result.status).toBe(1);
    for (const text of ['foo.ts', '20004', '5001', '5000', '20000', '按职责', '重新导出', 'describe', '二级标题', 'data/', '.token-budget-ignore', 'foo.types.ts', 'foo.helpers.ts']) {
      expect(result.stderr).toContain(text);
    }
  });
  it('ignores lockfiles and generated output at any depth', () => {
    const repo = setup();
    for (const path of ['package-lock.json', 'nested/pnpm-lock.yaml', 'yarn.lock', 'bun.lockb', 'nested/bun.lock', 'dist/large.js', 'nested/build/large.js', 'out/file', 'coverage/file', 'x.min.js', 'x.map', 'x.generated.ts', 'x.d.ts', '__snapshots__/x', 'snapshots/x', 'x.snap', 'artifacts/x', 'test-results/x']) {
      repo.stage(path, 'x'.repeat(20004));
    }
    expectPass(repo.run());
  });
  it('reads staged size rather than the enlarged working copy', () => {
    const repo = setup();
    repo.stage('small.ts', 'export {};');
    repo.write('small.ts', 'x'.repeat(20004));
    expectPass(repo.run());
  });
  it('honors root ignore globs and comments', () => {
    const repo = setup();
    repo.write('.token-budget-ignore', '# 数据迁移理由\ndata/**/*.json\n');
    repo.stage('data/large.json', 'x'.repeat(20004));
    repo.stage('data/nested/large.json', 'x'.repeat(20004));
    expectPass(repo.run());
    repo.stage('source.json', 'x'.repeat(20004));
    expect(repo.run().status).toBe(1);
  });
  it('ignores binaries according to Git numstat', () => {
    const repo = setup();
    repo.stage('image.bin', Buffer.alloc(20004));
    expectPass(repo.run());
  });
  it('handles tabs, newlines and non-ASCII paths without losing files', () => {
    const repo = setup();
    const path = '目录/带\t制表\n换行.ts';
    repo.stage(path, 'x'.repeat(20004));
    const result = repo.run();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(path);
  });
  it('passes an empty index', () => expectPass(setup().run()));
});
