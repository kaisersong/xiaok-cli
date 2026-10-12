import { describe, expect, it, afterAll } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const script = join(process.cwd(), 'scripts/check-release-sha.mjs');
const root = mkdtempSync(join(tmpdir(), 'check-release-sha-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.email=qa@example.com', '-c', 'user.name=qa', ...args], { cwd, encoding: 'utf8' }).trim();

function setup() {
  const origin = join(root, 'origin.git');
  const work = join(root, 'work');
  execFileSync('git', ['init', '-q', '--bare', origin]);
  execFileSync('git', ['clone', '-q', origin, work]);
  const commit = (version: string, note: string) => {
    writeFileSync(join(work, 'package.json'), JSON.stringify({ name: 'x', version, note }));
    git(work, 'add', 'package.json');
    git(work, 'commit', '-q', '-m', `v${version}`);
    return git(work, 'rev-parse', 'HEAD');
  };
  const first = commit('9.9.9', 'a');
  const second = commit('9.9.9', 'b');
  git(work, 'tag', '-a', 'desktop-v9.9.9', first, '-m', 'desktop');
  git(work, 'push', '-q', 'origin', 'HEAD', '--tags');
  return { work, first, second };
}
const run = (work: string, sha: string, version = '9.9.9', extra: string[] = ['--no-package']) =>
  spawnSync('node', [script, '--repo', work, '--sha', sha, '--version', version, ...extra], { encoding: 'utf8' });

describe('check-release-sha', () => {
  const { work, first, second } = setup();

  it('passes when the desktop tag points at the given full SHA', () => {
    const r = run(work, first);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('未测：按 --no-package 跳过包内容核对');
  });

  it('fails when the desktop tag points at a different commit', () => {
    const r = run(work, second);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('不通过：tag desktop-v9.9.9');
  });

  it('fails when the source version differs from the requested version', () => {
    const r = run(work, first, '9.9.8');
    expect(r.status).toBe(1);
  });

  it('fails when no package source is given and --no-package is not explicit', () => {
    const r = run(work, first, '9.9.9', []);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('不通过：提供了包来源');
  });

  it('fails when --tgz points to a missing file', () => {
    const r = run(work, first, '9.9.9', ['--tgz', join(root, 'missing.tgz')]);
    expect(r.status).not.toBe(0);
  });

  it('rejects abbreviated SHAs with a usage error', () => {
    const r = run(work, first.slice(0, 8));
    expect(r.status).toBe(2);
  });
});
