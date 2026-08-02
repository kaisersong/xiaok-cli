import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  computeGitTreeSha256,
  sha256Hex,
  type GitObjectEntry,
} from '../../../src/platform/plugins/install/integrity.js';
import { DEFAULT_REGISTRY_V2_URL } from '../../../src/platform/plugins/install/registry.js';
import { defaultCommandRunner, resolveInstallPaths, type CommandRunner } from '../../../src/platform/plugins/install/source.js';
import { readActivePluginPointer } from '../../../src/platform/plugins/install/active-pointer.js';
import { installPlugin } from '../../../src/platform/plugins/install/installer.js';
import type { McpConnectFn } from '../../../src/platform/plugins/install/probe.js';
import { initFixtureRepo, type FixtureRepo } from './install-fixtures.js';

function entryFor(path: string, content: string, mode = '100644'): GitObjectEntry {
  return { mode, path, contentSha256: sha256Hex(Buffer.from(content)) };
}

function manifestBody(version: string, extras: Record<string, unknown> = {}): string {
  return `${JSON.stringify(
    {
      name: 'demo-plugin',
      version,
      mcpServers: [{ name: 'renderer', type: 'stdio', command: 'node', args: ['server.js'] }],
      ...extras,
    },
    null,
    2,
  )}\n`;
}

interface NonGitInvocation {
  command: string;
  args: string[];
  cwd?: string;
}

function delegatingRunner(options: { failNonGit?: boolean } = {}): CommandRunner & { nonGit: NonGitInvocation[] } {
  const nonGit: NonGitInvocation[] = [];
  const wrap = <T>(command: string, args: string[], runOptions: { cwd?: string } | undefined, fallback: T, real: () => Promise<T>) => {
    if (command === 'git') return real();
    nonGit.push({ command, args, cwd: runOptions?.cwd });
    return Promise.resolve(fallback);
  };

  return {
    nonGit,
    run(command, args, runOptions) {
      return wrap(
        command,
        args,
        runOptions,
        { code: options.failNonGit ? 1 : 0, stdout: '', stderr: options.failNonGit ? 'build failed' : '' },
        () => defaultCommandRunner.run(command, args, runOptions),
      );
    },
    runBuffer(command, args, runOptions) {
      return wrap(command, args, runOptions, { code: 0, stdout: Buffer.alloc(0), stderr: '' }, () =>
        defaultCommandRunner.runBuffer(command, args, runOptions),
      );
    },
    hashStdout(command, args, runOptions) {
      return wrap(command, args, runOptions, { code: 0, sha256: '0'.repeat(64), bytes: 0, stderr: '' }, () =>
        defaultCommandRunner.hashStdout(command, args, runOptions),
      );
    },
  };
}

function fakeConnect(options: { fail?: boolean } = {}): McpConnectFn & { calls: string[]; configs: Array<Record<string, unknown>> } {
  const calls: string[] = [];
  const configs: Array<Record<string, unknown>> = [];
  const connect = (async (serverName: string, config: Record<string, unknown>) => {
    calls.push(serverName);
    configs.push(config);
    if (options.fail) throw new Error('server exited immediately');
    return {
      client: {
        listTools: async () => ({ tools: [{ name: 'render' }] }),
        close: async () => {},
      },
      protocolEra: 'legacy',
      getStderrTail: () => '',
      getChildPid: () => null,
      close: async () => {},
      dispose: () => {},
    };
  }) as unknown as McpConnectFn & { calls: string[]; configs: Array<Record<string, unknown>> };
  (connect as unknown as { calls: string[] }).calls = calls;
  (connect as unknown as { configs: unknown[] }).configs = configs;
  return connect;
}

describe('plugin install transaction', () => {
  let root: string;
  let repo: FixtureRepo;
  let pluginsDir: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'xiaok-installer-'));
    repo = initFixtureRepo(join(root, 'origin'));
    pluginsDir = join(root, 'plugins-home');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function publish(version: string, options: { manifestExtras?: Record<string, unknown>; extraFiles?: Record<string, string> } = {}) {
    const manifest = manifestBody(version, options.manifestExtras);
    repo.writeFile('plugins/demo-plugin/plugin.json', manifest);
    const entries = [entryFor('plugin.json', manifest)];
    for (const [rel, content] of Object.entries(options.extraFiles ?? {})) {
      repo.writeFile(`plugins/demo-plugin/${rel}`, content);
      entries.push(entryFor(rel, content));
    }
    const commit = repo.commit(`publish ${version}`);
    return { commit, digest: computeGitTreeSha256(entries), version };
  }

  function registryRequest(
    published: Array<{ commit: string; digest: string; version: string }>,
    steps: unknown[] = [],
    documentVersion = 2,
  ) {
    const latest = published[published.length - 1];
    const body = JSON.stringify({
      version: documentVersion,
      plugins: [
        {
          name: 'demo-plugin',
          display_name: 'Demo Plugin',
          description: 'fixture plugin',
          repo: 'kaisersong/kai-xiaok-plugins',
          path: 'plugins/demo-plugin',
          version: latest.version,
          source: { commit: latest.commit, treeSha256: latest.digest },
          install: { steps },
        },
      ],
    });
    return async (url: string) => ({
      statusCode: 200,
      headers: {} as Record<string, string>,
      body: Buffer.from(body, 'utf8'),
      url,
    });
  }

  function installOptions(request: ReturnType<typeof registryRequest>, extras: Record<string, unknown> = {}) {
    return {
      pluginsDir,
      request,
      cloneUrl: repo.dir,
      allowLocalSource: true,
      connect: fakeConnect(),
      runner: delegatingRunner(),
      ...extras,
    };
  }

  it('verifies, probes and atomically activates a plugin', async () => {
    const published = publish('1.0.0');

    const result = await installPlugin('demo-plugin', installOptions(registryRequest([published])));

    expect(result.status).toBe('installed');
    expect(result.digest).toBe(published.digest);
    expect(result.probe.status).toBe('verified');

    const paths = resolveInstallPaths(pluginsDir);
    const pointer = readActivePluginPointer(paths, 'demo-plugin');
    expect(pointer.digest).toBe(published.digest);
    expect(pointer.commit).toBe(published.commit);
    expect(pointer.version).toBe('1.0.0');
    expect(pointer.registryUrl).toBe(DEFAULT_REGISTRY_V2_URL);
    expect(pointer.pluginDir).toBe(
      join(paths.managedDir, 'demo-plugin', published.digest, 'repo', 'plugins', 'demo-plugin'),
    );
    expect(existsSync(join(pointer.pluginDir, 'plugin.json'))).toBe(true);
    expect(pointer.probe.outcomes[0]).toMatchObject({ serverName: 'renderer', status: 'connected' });
  });

  it('runs typed install steps inside the immutable version directory', async () => {
    const published = publish('1.0.0', { extraFiles: { 'mcp-servers/demo/package.json': '{"name":"demo"}\n' } });
    const runner = delegatingRunner();

    await installPlugin('demo-plugin', installOptions(
      registryRequest([published], [
        { kind: 'npm_ci', cwd: 'mcp-servers/demo' },
        { kind: 'npm_run', cwd: 'mcp-servers/demo', script: 'build' },
      ]),
      { runner },
    ));

    const paths = resolveInstallPaths(pluginsDir);
    const versionDir = join(paths.managedDir, 'demo-plugin', published.digest);
    expect(runner.nonGit.map((invocation) => invocation.args[0])).toEqual(['ci', 'run']);
    for (const invocation of runner.nonGit) {
      expect(invocation.cwd).toBe(join(versionDir, 'repo', 'plugins', 'demo-plugin', 'mcp-servers', 'demo'));
    }
  });

  it('keeps the previous active pointer when a dependency step fails', async () => {
    const first = publish('1.0.0');
    await installPlugin('demo-plugin', installOptions(registryRequest([first])));

    const second = publish('2.0.0', { extraFiles: { 'mcp-servers/demo/package.json': '{"name":"demo"}\n' } });
    await expect(installPlugin('demo-plugin', installOptions(
      registryRequest([second], [{ kind: 'npm_ci', cwd: 'mcp-servers/demo' }]),
      { runner: delegatingRunner({ failNonGit: true }), force: true },
    ))).rejects.toThrow(/npm_ci|exit/i);

    const paths = resolveInstallPaths(pluginsDir);
    expect(readActivePluginPointer(paths, 'demo-plugin').digest).toBe(first.digest);
    expect(existsSync(join(paths.managedDir, 'demo-plugin', second.digest))).toBe(false);
  });

  it('keeps the previous active pointer when the candidate probe fails', async () => {
    const first = publish('1.0.0');
    await installPlugin('demo-plugin', installOptions(registryRequest([first])));

    const second = publish('2.0.0');
    await expect(installPlugin('demo-plugin', installOptions(
      registryRequest([second]),
      { connect: fakeConnect({ fail: true }), force: true },
    ))).rejects.toThrow(/renderer/);

    const paths = resolveInstallPaths(pluginsDir);
    expect(readActivePluginPointer(paths, 'demo-plugin').digest).toBe(first.digest);
    expect(existsSync(join(paths.managedDir, 'demo-plugin', second.digest))).toBe(false);
  });

  it('removes an unactivated Python runtime when candidate probing fails', async () => {
    const requirements = 'mcp==1.27.1 \\\n+    --hash=sha256:1111111111111111111111111111111111111111111111111111111111111111\n';
    const published = publish('1.0.0', {
      manifestExtras: {
        mcpServers: [{ name: 'renderer', type: 'stdio', command: 'python3', args: ['server.py'] }],
      },
      extraFiles: { 'requirements.txt': requirements },
    });

    await expect(installPlugin('demo-plugin', installOptions(
      registryRequest([published], [{ kind: 'python_requirements', file: 'requirements.txt' }]),
      { connect: fakeConnect({ fail: true }) },
    ))).rejects.toThrow(/renderer/);

    const paths = resolveInstallPaths(pluginsDir);
    expect(existsSync(join(paths.runtimesDir, 'demo-plugin', published.digest))).toBe(false);
  });

  it('refuses a custom registry without --trust-registry before downloading anything', async () => {
    const published = publish('1.0.0');

    await expect(installPlugin('demo-plugin', installOptions(
      registryRequest([published]),
      { registryUrl: 'https://example.com/registry-v2.json' },
    ))).rejects.toThrow(/--trust-registry/);

    expect(existsSync(join(pluginsDir, '.managed'))).toBe(false);
  });

  it('fails closed on a legacy v1 registry', async () => {
    const published = publish('1.0.0');

    await expect(installPlugin('demo-plugin', installOptions(registryRequest([published], [], 1))))
      .rejects.toThrow(/registry v2/i);
    expect(existsSync(join(pluginsDir, '.managed'))).toBe(false);
  });

  it('skips reinstalling the active digest unless forced', async () => {
    const published = publish('1.0.0');
    await installPlugin('demo-plugin', installOptions(registryRequest([published])));

    const runner = delegatingRunner();
    const result = await installPlugin('demo-plugin', installOptions(registryRequest([published]), { runner }));

    expect(result.status).toBe('already-installed');
    expect(runner.nonGit).toEqual([]);

    const forced = await installPlugin('demo-plugin', installOptions(registryRequest([published]), { force: true }));
    expect(forced.status).toBe('installed');
    expect(readActivePluginPointer(resolveInstallPaths(pluginsDir), 'demo-plugin').digest).toBe(published.digest);
  });

  it('does not mutate the active Python runtime when force-reinstalling the same digest', async () => {
    const requirements = 'mcp==1.27.1 \\\n    --hash=sha256:1111111111111111111111111111111111111111111111111111111111111111\n';
    const published = publish('1.0.0', {
      manifestExtras: {
        mcpServers: [{ name: 'renderer', type: 'stdio', command: 'python3', args: ['server.py'] }],
      },
      extraFiles: { 'requirements.txt': requirements },
    });
    const request = registryRequest(
      [published],
      [{ kind: 'python_requirements', file: 'requirements.txt' }],
    );
    await installPlugin('demo-plugin', installOptions(request));

    const paths = resolveInstallPaths(pluginsDir);
    const runtimeDir = join(paths.runtimesDir, 'demo-plugin', published.digest);
    const sentinel = join(runtimeDir, 'active-runtime-sentinel');
    writeFileSync(sentinel, 'keep', 'utf8');
    const failingRunner = delegatingRunner({ failNonGit: true });

    await expect(installPlugin('demo-plugin', installOptions(request, {
      force: true,
      runner: failingRunner,
    }))).resolves.toMatchObject({ status: 'installed', digest: published.digest });

    expect(failingRunner.nonGit).toEqual([]);
    expect(readFileSync(sentinel, 'utf8')).toBe('keep');
    expect(readActivePluginPointer(paths, 'demo-plugin').pythonRuntimeDir).toBe(runtimeDir);
  });

  it('retains the current and previous version and prunes older ones', async () => {
    const first = publish('1.0.0');
    await installPlugin('demo-plugin', installOptions(registryRequest([first])));
    const second = publish('2.0.0');
    await installPlugin('demo-plugin', installOptions(registryRequest([second])));
    const third = publish('3.0.0');
    const paths = resolveInstallPaths(pluginsDir);
    const firstRuntime = join(paths.runtimesDir, 'demo-plugin', first.digest);
    const secondRuntime = join(paths.runtimesDir, 'demo-plugin', second.digest);
    mkdirSync(firstRuntime, { recursive: true });
    mkdirSync(secondRuntime, { recursive: true });
    const result = await installPlugin('demo-plugin', installOptions(registryRequest([third])));

    const kept = readdirSync(join(paths.managedDir, 'demo-plugin')).sort();
    expect(kept).toEqual([second.digest, third.digest].sort());
    expect(result.prunedVersionDirs).toEqual([join(paths.managedDir, 'demo-plugin', first.digest)]);
    expect(result.prunedRuntimeDirs).toEqual([firstRuntime]);
    expect(existsSync(secondRuntime)).toBe(true);
    expect(readActivePluginPointer(paths, 'demo-plugin').previousDigest).toBe(second.digest);
  });

  it('removes orphaned candidate directories left behind by a crash', async () => {
    const first = publish('1.0.0');
    const paths = resolveInstallPaths(pluginsDir);
    const orphan = join(paths.managedDir, 'demo-plugin', 'f'.repeat(64));
    mkdirSync(join(orphan, 'repo'), { recursive: true });
    writeFileSync(join(orphan, 'repo', 'partial'), 'crash', 'utf8');

    const result = await installPlugin('demo-plugin', installOptions(registryRequest([first])));

    expect(result.prunedVersionDirs).toContain(orphan);
    expect(existsSync(orphan)).toBe(false);
  });

  it('refuses to install while another install holds the plugin lock', async () => {
    const published = publish('1.0.0');
    const paths = resolveInstallPaths(pluginsDir);
    mkdirSync(paths.locksDir, { recursive: true });
    writeFileSync(join(paths.locksDir, 'demo-plugin.lock'), JSON.stringify({
      pid: process.pid,
      token: 'other',
      createdAt: new Date().toISOString(),
    }), 'utf8');

    await expect(installPlugin('demo-plugin', installOptions(registryRequest([published]))))
      .rejects.toThrow(/in progress/i);
    expect(existsSync(join(paths.activeDir, 'demo-plugin.json'))).toBe(false);
  });

  it('releases the plugin lock after a successful install', async () => {
    const published = publish('1.0.0');
    await installPlugin('demo-plugin', installOptions(registryRequest([published])));

    const paths = resolveInstallPaths(pluginsDir);
    expect(existsSync(join(paths.locksDir, 'demo-plugin.lock'))).toBe(false);
  });

  it('reports unverified when every declared server is skipped by an external step', async () => {
    const published = publish('1.0.0', {
      manifestExtras: {
        mcpServers: [{ name: 'renderer', type: 'stdio', command: 'python3', args: ['server.py'] }],
      },
    });
    const connect = fakeConnect();

    const result = await installPlugin('demo-plugin', installOptions(
      registryRequest([published], [
        { kind: 'external', serverNames: ['renderer'], reason: 'requires system python' },
      ]),
      { connect },
    ));

    expect(result.probe.status).toBe('unverified');
    expect(result.skippedServerNames).toEqual(['renderer']);
    expect((connect as unknown as { calls: string[] }).calls).toEqual([]);
    expect(readActivePluginPointer(resolveInstallPaths(pluginsDir), 'demo-plugin').probe.status).toBe('unverified');
  });

  it('rejects a plugin missing from the registry without touching the plugins home', async () => {
    const published = publish('1.0.0');

    await expect(installPlugin('other-plugin', installOptions(registryRequest([published]))))
      .rejects.toThrow(/other-plugin/);
    expect(existsSync(join(pluginsDir, '.managed'))).toBe(false);
  });

  it('probes a python plugin with its digest-isolated runtime interpreter', async () => {
    const requirements = 'mcp==1.27.1 \\\n    --hash=sha256:1111111111111111111111111111111111111111111111111111111111111111\n';
    const published = publish('1.0.0', {
      manifestExtras: {
        mcpServers: [{ name: 'renderer', type: 'stdio', command: 'python3', args: ['server.py'] }],
      },
      extraFiles: { 'requirements.txt': requirements },
    });
    const connect = fakeConnect();

    await installPlugin('demo-plugin', installOptions(
      registryRequest([published], [{ kind: 'python_requirements', file: 'requirements.txt' }]),
      { connect },
    ));

    const paths = resolveInstallPaths(pluginsDir);
    const expectedPython = join(paths.runtimesDir, 'demo-plugin', published.digest, 'bin', 'python');
    expect((connect as unknown as { configs: Array<{ command: string }> }).configs[0].command)
      .toBe(expectedPython);
    expect(readActivePluginPointer(paths, 'demo-plugin').pythonRuntimeDir)
      .toBe(join(paths.runtimesDir, 'demo-plugin', published.digest));
  });

  it('rejects a candidate whose manifest disagrees with the registry version', async () => {
    const manifest = manifestBody('9.9.9');
    repo.writeFile('plugins/demo-plugin/plugin.json', manifest);
    const commit = repo.commit('mismatched manifest');
    const digest = computeGitTreeSha256([entryFor('plugin.json', manifest)]);
    const request = async (url: string) => ({
      statusCode: 200,
      headers: {} as Record<string, string>,
      body: Buffer.from(JSON.stringify({
        version: 2,
        plugins: [{
          name: 'demo-plugin',
          repo: 'kaisersong/kai-xiaok-plugins',
          path: 'plugins/demo-plugin',
          version: '1.0.0',
          source: { commit, treeSha256: digest },
        }],
      }), 'utf8'),
      url,
    });

    await expect(installPlugin('demo-plugin', installOptions(request as never)))
      .rejects.toThrow(/version/i);
    expect(existsSync(join(resolveInstallPaths(pluginsDir).activeDir, 'demo-plugin.json'))).toBe(false);
  });
});
