import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, lstatSync, readFileSync, readlinkSync, rmSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  computeGitTreeSha256,
  sha256Hex,
  type GitObjectEntry,
} from '../../../src/platform/plugins/install/integrity.js';
import { parseTrustedRegistry, type TrustedRegistryPlugin } from '../../../src/platform/plugins/install/registry.js';
import {
  createRecordingRunner,
  defaultCommandRunner,
  resolveInstallPaths,
  stagePluginSource,
} from '../../../src/platform/plugins/install/source.js';
import { initFixtureRepo, pluginManifestBody, type FixtureRepo } from './install-fixtures.js';

const MANIFEST = pluginManifestBody({ name: 'demo-plugin', version: '1.0.0' });

function entryFor(path: string, content: string | Buffer, mode = '100644'): GitObjectEntry {
  return { mode, path, contentSha256: sha256Hex(Buffer.from(content as string)) };
}

function registryEntry(overrides: {
  commit: string;
  treeSha256: string;
  path?: string;
  name?: string;
}): TrustedRegistryPlugin {
  return parseTrustedRegistry({
    version: 2,
    plugins: [
      {
        name: overrides.name ?? 'demo-plugin',
        repo: 'kaisersong/kai-xiaok-plugins',
        path: overrides.path ?? 'plugins/demo-plugin',
        version: '1.0.0',
        source: { commit: overrides.commit, treeSha256: overrides.treeSha256 },
      },
    ],
  }).plugins[0];
}

describe('plugin source staging', () => {
  let root: string;
  let repo: FixtureRepo;
  let pluginsDir: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'xiaok-install-source-'));
    repo = initFixtureRepo(join(root, 'origin'));
    pluginsDir = join(root, 'plugins-home');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function stageOptions(entry: TrustedRegistryPlugin) {
    return {
      entry,
      paths: resolveInstallPaths(pluginsDir),
      cloneUrl: repo.dir,
      allowLocalSource: true,
    };
  }

  it('stages the pinned commit into an immutable digest directory', async () => {
    repo.writeFile('README.md', 'outside the plugin\n');
    repo.writeFile('plugins/demo-plugin/plugin.json', MANIFEST);
    repo.writeFile('plugins/demo-plugin/bin/run.sh', '#!/bin/sh\necho hi\n', 0o755);
    const commit = repo.commit();
    const treeSha256 = computeGitTreeSha256([
      entryFor('plugin.json', MANIFEST),
      entryFor('bin/run.sh', '#!/bin/sh\necho hi\n', '100755'),
    ]);

    const staged = await stagePluginSource(stageOptions(registryEntry({ commit, treeSha256 })));

    expect(staged.digest).toBe(treeSha256);
    expect(staged.versionDir).toBe(join(pluginsDir, '.managed', 'demo-plugin', treeSha256));
    expect(staged.pluginDir).toBe(join(staged.versionDir, 'repo', 'plugins', 'demo-plugin'));
    expect(readFileSync(join(staged.pluginDir, 'plugin.json'), 'utf8')).toBe(MANIFEST);
    expect(staged.entries.map((entry) => entry.path).sort()).toEqual(['bin/run.sh', 'plugin.json']);
    // Sparse checkout keeps unrelated repository content out of the version dir.
    expect(existsSync(join(staged.versionDir, 'repo', 'README.md'))).toBe(false);
  });

  it('rejects a tree digest that does not match the pinned commit', async () => {
    repo.writeFile('plugins/demo-plugin/plugin.json', MANIFEST);
    const commit = repo.commit();

    await expect(stagePluginSource(stageOptions(registryEntry({ commit, treeSha256: 'c'.repeat(64) }))))
      .rejects.toThrow(/digest|treeSha256/i);
    expect(existsSync(join(pluginsDir, '.managed', 'demo-plugin', 'c'.repeat(64), 'repo', 'plugins')))
      .toBe(false);
  });

  it('ignores later branch movement because the commit is pinned', async () => {
    repo.writeFile('plugins/demo-plugin/plugin.json', MANIFEST);
    const pinned = repo.commit();
    const pinnedDigest = computeGitTreeSha256([entryFor('plugin.json', MANIFEST)]);

    repo.writeFile('plugins/demo-plugin/plugin.json', pluginManifestBody({ name: 'demo-plugin', version: '9.9.9' }));
    repo.writeFile('plugins/demo-plugin/backdoor.js', 'process.exit(0)\n');
    const moved = repo.commit('drifted');
    expect(moved).not.toBe(pinned);

    const staged = await stagePluginSource(stageOptions(registryEntry({ commit: pinned, treeSha256: pinnedDigest })));

    expect(readFileSync(join(staged.pluginDir, 'plugin.json'), 'utf8')).toBe(MANIFEST);
    expect(existsSync(join(staged.pluginDir, 'backdoor.js'))).toBe(false);
  });

  it('rejects a commit that the remote does not have', async () => {
    repo.writeFile('plugins/demo-plugin/plugin.json', MANIFEST);
    repo.commit();

    await expect(stagePluginSource(stageOptions(registryEntry({
      commit: 'd'.repeat(40),
      treeSha256: computeGitTreeSha256([entryFor('plugin.json', MANIFEST)]),
    })))).rejects.toThrow(/fetch|commit/i);
  });

  it('rejects gitlink entries inside the plugin path', async () => {
    repo.writeFile('plugins/demo-plugin/plugin.json', MANIFEST);
    repo.addIndexGitlink('plugins/demo-plugin/vendor', 'e'.repeat(40));
    const commit = repo.commit('with gitlink', { stage: false });

    await expect(stagePluginSource(stageOptions(registryEntry({
      commit,
      treeSha256: computeGitTreeSha256([entryFor('plugin.json', MANIFEST)]),
    })))).rejects.toThrow(/gitlink|submodule/i);
  });

  it('rejects checkout byte drift introduced by gitattributes filters', async () => {
    const notes = 'line one\nline two\n';
    repo.writeFile('.gitattributes', '*.txt text eol=crlf\n');
    repo.writeFile('plugins/demo-plugin/plugin.json', MANIFEST);
    repo.writeFile('plugins/demo-plugin/notes.txt', notes);
    const commit = repo.commit();
    const treeSha256 = computeGitTreeSha256([
      entryFor('plugin.json', MANIFEST),
      entryFor('notes.txt', notes),
    ]);

    await expect(stagePluginSource(stageOptions(registryEntry({ commit, treeSha256 }))))
      .rejects.toThrow(/notes\.txt/);
  });

  it('rejects symlinks that escape the plugin root and keeps safe internal links', async () => {
    repo.writeFile('plugins/demo-plugin/plugin.json', MANIFEST);
    repo.writeSymlink('plugins/demo-plugin/escape', '../../../etc/passwd');
    const escaping = repo.commit('escaping symlink');
    await expect(stagePluginSource(stageOptions(registryEntry({
      commit: escaping,
      treeSha256: computeGitTreeSha256([
        entryFor('plugin.json', MANIFEST),
        entryFor('escape', '../../../etc/passwd', '120000'),
      ]),
    })))).rejects.toThrow(/symlink/i);

    const absoluteRepo = initFixtureRepo(join(root, 'origin-absolute'));
    absoluteRepo.writeFile('plugins/demo-plugin/plugin.json', MANIFEST);
    absoluteRepo.writeSymlink('plugins/demo-plugin/abs', '/etc/passwd');
    const absoluteCommit = absoluteRepo.commit('absolute symlink');
    await expect(stagePluginSource({
      entry: registryEntry({
        commit: absoluteCommit,
        treeSha256: computeGitTreeSha256([
          entryFor('plugin.json', MANIFEST),
          entryFor('abs', '/etc/passwd', '120000'),
        ]),
      }),
      paths: resolveInstallPaths(pluginsDir),
      cloneUrl: absoluteRepo.dir,
      allowLocalSource: true,
    })).rejects.toThrow(/symlink/i);

    const safeRepo = initFixtureRepo(join(root, 'origin-safe'));
    safeRepo.writeFile('plugins/demo-plugin/plugin.json', MANIFEST);
    safeRepo.writeFile('plugins/demo-plugin/docs/readme.md', '# docs\n');
    safeRepo.writeSymlink('plugins/demo-plugin/readme.md', 'docs/readme.md');
    const safeCommit = safeRepo.commit('safe symlink');
    const staged = await stagePluginSource({
      entry: registryEntry({
        commit: safeCommit,
        treeSha256: computeGitTreeSha256([
          entryFor('plugin.json', MANIFEST),
          entryFor('docs/readme.md', '# docs\n'),
          entryFor('readme.md', 'docs/readme.md', '120000'),
        ]),
      }),
      paths: resolveInstallPaths(pluginsDir),
      cloneUrl: safeRepo.dir,
      allowLocalSource: true,
      platform: 'darwin',
    });

    const link = join(staged.pluginDir, 'readme.md');
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(readlinkSync(link)).toBe('docs/readme.md');
  });

  it('rejects case-insensitive and unicode path collisions', async () => {
    repo.writeFile('plugins/demo-plugin/plugin.json', MANIFEST);
    repo.addIndexBlob('plugins/demo-plugin/Notes.md', 'upper\n');
    repo.addIndexBlob('plugins/demo-plugin/notes.md', 'lower\n');
    const caseCommit = repo.commit('case collision', { stage: false });

    await expect(stagePluginSource(stageOptions(registryEntry({
      commit: caseCommit,
      treeSha256: computeGitTreeSha256([
        entryFor('plugin.json', MANIFEST),
        entryFor('Notes.md', 'upper\n'),
        entryFor('notes.md', 'lower\n'),
      ]),
    })))).rejects.toThrow(/conflict/i);

    const unicodeRepo = initFixtureRepo(join(root, 'origin-unicode'));
    unicodeRepo.writeFile('plugins/demo-plugin/plugin.json', MANIFEST);
    unicodeRepo.addIndexBlob('plugins/demo-plugin/caf\u00e9.md', 'nfc\n');
    unicodeRepo.addIndexBlob('plugins/demo-plugin/cafe\u0301.md', 'nfd\n');
    const unicodeCommit = unicodeRepo.commit('unicode collision', { stage: false });

    await expect(stagePluginSource({
      entry: registryEntry({
        commit: unicodeCommit,
        treeSha256: computeGitTreeSha256([
          entryFor('plugin.json', MANIFEST),
          entryFor('caf\u00e9.md', 'nfc\n'),
          entryFor('cafe\u0301.md', 'nfd\n'),
        ]),
      }),
      paths: resolveInstallPaths(pluginsDir),
      cloneUrl: unicodeRepo.dir,
      allowLocalSource: true,
    })).rejects.toThrow(/conflict|NFC/i);
  });

  it('rejects a plugin path that is missing from the pinned commit', async () => {
    repo.writeFile('plugins/other/plugin.json', MANIFEST);
    const commit = repo.commit();

    await expect(stagePluginSource(stageOptions(registryEntry({
      commit,
      treeSha256: computeGitTreeSha256([entryFor('plugin.json', MANIFEST)]),
    })))).rejects.toThrow(/plugins\/demo-plugin/);
  });

  it('never spawns a shell and always passes git arguments as an array', async () => {
    repo.writeFile('plugins/demo-plugin/plugin.json', MANIFEST);
    const commit = repo.commit();
    const recorder = createRecordingRunner(defaultCommandRunner);

    await stagePluginSource({
      ...stageOptions(registryEntry({
        commit,
        treeSha256: computeGitTreeSha256([entryFor('plugin.json', MANIFEST)]),
      })),
      runner: recorder,
    });

    expect(recorder.invocations.length).toBeGreaterThan(0);
    for (const invocation of recorder.invocations) {
      expect(['sh', 'bash', 'zsh', 'cmd', 'cmd.exe', 'powershell.exe']).not.toContain(invocation.command);
      expect(invocation.command).toBe('git');
      expect(Array.isArray(invocation.args)).toBe(true);
      for (const [index, arg] of invocation.args.entries()) {
        expect(arg).not.toMatch(/&&|\|\||;|\$\(/);
        // git's own "-c" is always a config assignment, never a shell command.
        if (arg === '-c') expect(invocation.args[index + 1]).toMatch(/^[\w.-]+=/);
      }
    }
    const fetchInvocation = recorder.invocations.find((invocation) => invocation.args.includes('fetch'));
    expect(fetchInvocation?.env?.GIT_CONFIG_NOSYSTEM).toBe('1');
    expect(fetchInvocation?.env && 'GIT_ASKPASS' in fetchInvocation.env).toBe(false);
    expect(fetchInvocation?.args).toContain('--no-recurse-submodules');
  });

  it('refuses non-https clone urls unless local sources are explicitly allowed', async () => {
    repo.writeFile('plugins/demo-plugin/plugin.json', MANIFEST);
    const commit = repo.commit();
    const entry = registryEntry({ commit, treeSha256: computeGitTreeSha256([entryFor('plugin.json', MANIFEST)]) });

    await expect(stagePluginSource({
      entry,
      paths: resolveInstallPaths(pluginsDir),
      cloneUrl: repo.dir,
    })).rejects.toThrow(/https/i);
    await expect(stagePluginSource({
      entry,
      paths: resolveInstallPaths(pluginsDir),
      cloneUrl: 'https://evil.example.com/kaisersong/plugins',
      allowLocalSource: true,
    })).rejects.toThrow(/github\.com/i);
  });
});
