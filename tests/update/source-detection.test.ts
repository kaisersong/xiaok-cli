import { describe, expect, it } from 'vitest';
import { detectInstallSource } from '../../src/update/source-detection.js';

describe('detectInstallSource', () => {
  it('classifies a git-backed repo install from the resolved executable path', async () => {
    const detected = await detectInstallSource({
      argv0: '/Users/song/projects/xiaok-cli/dist/index.js',
      cwd: '/Users/song/projects/xiaok-cli',
      realpath: async (path) => path,
      pathExists: async (path) => path === '/Users/song/projects/xiaok-cli/.git',
      npmRootGlobal: async () => '/opt/homebrew/lib/node_modules',
    });

    expect(detected).toEqual({
      kind: 'git_repo',
      repoRoot: '/Users/song/projects/xiaok-cli',
      binPath: '/Users/song/projects/xiaok-cli/dist/index.js',
    });
  });

  it('classifies an npm global install only when the resolved package path lives under npm root -g', async () => {
    const detected = await detectInstallSource({
      argv0: '/opt/homebrew/bin/xiaok',
      cwd: '/tmp',
      realpath: async () => '/opt/homebrew/lib/node_modules/xiaokcode/dist/index.js',
      pathExists: async () => false,
      npmRootGlobal: async () => '/opt/homebrew/lib/node_modules',
    });

    expect(detected).toEqual({
      kind: 'npm_global',
      packageRoot: '/opt/homebrew/lib/node_modules/xiaokcode',
      binPath: '/opt/homebrew/lib/node_modules/xiaokcode/dist/index.js',
    });
  });

  it('classifies npm link when the launched bin resolves into a git-backed repo dist entry', async () => {
    const detected = await detectInstallSource({
      argv0: '/opt/homebrew/bin/xiaok',
      cwd: '/tmp',
      realpath: async () => '/Users/song/projects/xiaok-cli/dist/index.js',
      pathExists: async (path) => path === '/Users/song/projects/xiaok-cli/.git',
      npmRootGlobal: async () => '/opt/homebrew/lib/node_modules',
    });

    expect(detected).toEqual({
      kind: 'npm_link',
      repoRoot: '/Users/song/projects/xiaok-cli',
      binPath: '/Users/song/projects/xiaok-cli/dist/index.js',
    });
  });

  it('falls back to unsupported for unknown package managers and temporary runners', async () => {
    const detected = await detectInstallSource({
      argv0: '/private/var/folders/.../xfs-12345/index.js',
      cwd: '/tmp',
      realpath: async (path) => path,
      pathExists: async () => false,
      npmRootGlobal: async () => '/opt/homebrew/lib/node_modules',
    });

    expect(detected.kind).toBe('unsupported');
  });
});
