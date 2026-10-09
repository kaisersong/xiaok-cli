import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSandboxPolicy, extractSandboxAllowedPaths } from '../../../src/platform/sandbox/policy.js';

describe('sandbox policy', () => {
  it('allows paths inside the worktree root and denies external paths', () => {
    const policy = createSandboxPolicy({
      pathAllowlist: ['/repo/.worktrees'],
      pathDenylist: ['/repo/.worktrees/secret'],
    });

    expect(policy.checkPath('/repo/.worktrees/task-a/file.ts')).toMatchObject({ allowed: true });
    expect(policy.checkPath('/tmp/escape')).toMatchObject({ allowed: false });
    expect(policy.checkPath('/repo/.worktrees/secret/token.txt')).toMatchObject({ allowed: false });
  });

  it('filters env vars and blocks network when disabled', () => {
    const policy = createSandboxPolicy({
      allowedEnv: ['PATH', 'HOME'],
      network: 'deny',
    });

    expect(policy.filterEnv({ PATH: '/bin', SECRET: 'x' })).toEqual({ PATH: '/bin' });
    expect(policy.checkNetworkAccess()).toMatchObject({ allowed: false });
  });

  it('allows runtime expansion of path allowlist entries', () => {
    const policy = createSandboxPolicy({
      pathAllowlist: ['/repo'],
    });

    expect(policy.checkPath('/tmp/outside.txt')).toMatchObject({ allowed: false });

    policy.expandAllowedPaths(['/tmp/outside.txt']);

    expect(policy.checkPath('/tmp/outside.txt')).toMatchObject({ allowed: true });
  });

  it('matches expanded Windows directory prefixes for child paths', () => {
    const policy = createSandboxPolicy({
      pathAllowlist: ['D:\\projects\\xiaok-cli'],
    });

    policy.expandAllowedPaths(['C:\\Users\\song\\AppData\\Roaming\\npm\\node_modules\\@scope\\pkg\\docs']);

    expect(
      policy.checkPath('C:\\Users\\song\\AppData\\Roaming\\npm\\node_modules\\@scope\\pkg\\docs\\providers.md'),
    ).toMatchObject({ allowed: true });
  });

  it('extracts sandbox directory prefixes from persisted sandbox-expand rules', () => {
    expect(extractSandboxAllowedPaths([
      'sandbox-expand:read(C:\\Users\\song\\AppData\\Roaming\\npm\\node_modules\\@scope\\pkg\\docs/*)',
      'bash(cmd *)',
      'sandbox-expand:glob(/tmp/vendor/assets/*)',
    ])).toEqual([
      'C:\\Users\\song\\AppData\\Roaming\\npm\\node_modules\\@scope\\pkg\\docs',
      '/tmp/vendor/assets',
    ]);
  });

  describe('normalizes paths before comparing (P0-4)', () => {
    const policy = createSandboxPolicy({ pathAllowlist: ['/ws'] });

    it('allows a plain in-workspace path', () => {
      expect(policy.checkPath('/ws/src/a.ts').allowed).toBe(true);
    });

    it('allows the workspace root itself and in-workspace paths with harmless dot segments', () => {
      expect(policy.checkPath('/ws').allowed).toBe(true);
      expect(policy.checkPath('/ws/').allowed).toBe(true);
      expect(policy.checkPath('/ws/src/../lib/./b.ts').allowed).toBe(true);
    });

    it.each(['/ws/../home/u/.bashrc', '/ws/src/../../etc/x', '/ws/./../tmp/x'])('rejects parent traversal out of the allowlist: %s', (p) => {
      expect(policy.checkPath(p).allowed).toBe(false);
    });

    it('does not treat a sibling directory with the same prefix as inside', () => {
      expect(policy.checkPath('/ws-other/x').allowed).toBe(false);
    });

    it('applies the denylist after normalization', () => {
      const p = createSandboxPolicy({ pathAllowlist: ['/repo'], pathDenylist: ['/repo/secret'] });
      expect(p.checkPath('/repo/src/../secret/token.txt').allowed).toBe(false);
    });

    it('rejects an in-workspace symlink that points outside', () => {
      const ws = mkdtempSync(join(tmpdir(), 'qa-ws-'));
      const out = mkdtempSync(join(tmpdir(), 'qa-out-'));
      writeFileSync(join(out, 'secret.txt'), 'x');
      symlinkSync(out, join(ws, 'link'));
      const p = createSandboxPolicy({ pathAllowlist: [ws] });
      expect(p.checkPath(join(ws, 'link', 'secret.txt')).allowed).toBe(false);
      expect(p.checkPath(join(ws, 'link', 'not-yet-created.txt')).allowed).toBe(false);
    });

    it('rejects a dangling in-workspace symlink whose target is outside', () => {
      const ws = mkdtempSync(join(tmpdir(), 'qa-ws-'));
      const out = mkdtempSync(join(tmpdir(), 'qa-out-'));
      symlinkSync(join(out, 'will-be-created.txt'), join(ws, 'dangling.txt'));
      expect(createSandboxPolicy({ pathAllowlist: [ws] }).checkPath(join(ws, 'dangling.txt')).allowed).toBe(false);
    });

    it('normalizes Windows-style paths lexically and rejects traversal out of them', () => {
      const p = createSandboxPolicy({ pathAllowlist: ['C:\\ws'] });
      expect(p.checkPath('C:\\ws\\src\\a.ts').allowed).toBe(true);
      expect(p.checkPath('C:/ws/src/a.ts').allowed).toBe(true);
      expect(p.checkPath('C:\\ws\\..\\evil\\x').allowed).toBe(false);
      expect(p.checkPath('C:\\ws-other\\x').allowed).toBe(false);
    });

    it('normalizes runtime-expanded entries too', () => {
      const p = createSandboxPolicy({ pathAllowlist: ['/repo'] });
      p.expandAllowedPaths(['/opt/docs/../shared']);
      expect(p.checkPath('/opt/shared/readme.md').allowed).toBe(true);
      expect(p.checkPath('/opt/docs/readme.md').allowed).toBe(false);
    });

    it('does not crash on symlink loops and keeps them inside only if they really are', () => {
      const ws = mkdtempSync(join(tmpdir(), 'qa-ws-'));
      symlinkSync(join(ws, 'loop-b'), join(ws, 'loop-a'));
      symlinkSync(join(ws, 'loop-a'), join(ws, 'loop-b'));
      const p = createSandboxPolicy({ pathAllowlist: [ws] });
      expect(() => p.checkPath(join(ws, 'loop-a', 'x'))).not.toThrow();
      expect(p.checkPath('/elsewhere/loop').allowed).toBe(false);
    });

    it('returns a decision instead of throwing for paths with NUL bytes', () => {
      expect(createSandboxPolicy({ pathAllowlist: ['/ws'] }).checkPath('/ws/a\0b').allowed).toBeTypeOf('boolean');
    });

    it('still allows in-workspace symlinks that stay inside, new files, and a symlinked workspace root', () => {
      const ws = mkdtempSync(join(tmpdir(), 'qa-ws-'));
      mkdirSync(join(ws, 'real'));
      writeFileSync(join(ws, 'real', 'a.ts'), 'x');
      symlinkSync(join(ws, 'real'), join(ws, 'alias'));
      const rootAlias = join(mkdtempSync(join(tmpdir(), 'qa-alias-')), 'ws-link');
      symlinkSync(ws, rootAlias);

      const p = createSandboxPolicy({ pathAllowlist: [ws] });
      expect(p.checkPath(join(ws, 'alias', 'a.ts')).allowed).toBe(true);
      expect(p.checkPath(join(ws, 'new-dir', 'new-file.ts')).allowed).toBe(true);
      expect(p.checkPath(join(rootAlias, 'real', 'a.ts')).allowed).toBe(true);
      expect(createSandboxPolicy({ pathAllowlist: [rootAlias] }).checkPath(join(realpathSync(ws), 'real', 'a.ts')).allowed).toBe(true);
    });
  });
});
