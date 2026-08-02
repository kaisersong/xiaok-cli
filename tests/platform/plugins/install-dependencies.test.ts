import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  resolveNpmInvocation,
  runInstallSteps,
} from '../../../src/platform/plugins/install/dependencies.js';
import { resolveInstallPaths, type CommandRunner } from '../../../src/platform/plugins/install/source.js';
import { parseTrustedRegistry, type TrustedInstallStep } from '../../../src/platform/plugins/install/registry.js';

interface Invocation {
  command: string;
  args: string[];
  cwd?: string;
}

function fakeRunner(overrides: { fail?: (command: string, args: string[]) => boolean } = {}): CommandRunner & {
  invocations: Invocation[];
} {
  const invocations: Invocation[] = [];
  return {
    invocations,
    async run(command, args, options) {
      invocations.push({ command, args, cwd: options?.cwd });
      if (overrides.fail?.(command, args)) {
        return { code: 1, stdout: '', stderr: 'boom' };
      }
      return { code: 0, stdout: '', stderr: '' };
    },
    async runBuffer(command, args, options) {
      invocations.push({ command, args, cwd: options?.cwd });
      return { code: 0, stdout: Buffer.alloc(0), stderr: '' };
    },
    async hashStdout(command, args, options) {
      invocations.push({ command, args, cwd: options?.cwd });
      return { code: 0, sha256: '0'.repeat(64), bytes: 0, stderr: '' };
    },
  };
}

function steps(raw: unknown[]): TrustedInstallStep[] {
  return parseTrustedRegistry({
    version: 2,
    plugins: [
      {
        name: 'demo-plugin',
        repo: 'kaisersong/kai-xiaok-plugins',
        path: 'plugins/demo-plugin',
        version: '1.0.0',
        source: { commit: 'a'.repeat(40), treeSha256: 'b'.repeat(64) },
        install: { steps: raw },
      },
    ],
  }).plugins[0].install.steps;
}

describe('typed install steps', () => {
  let root: string;
  let pluginDir: string;
  let pluginsDir: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'xiaok-install-deps-'));
    pluginDir = join(root, 'plugin');
    pluginsDir = join(root, 'plugins-home');
    mkdirSync(join(pluginDir, 'mcp-servers', 'demo'), { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function options(stepList: TrustedInstallStep[], runner: CommandRunner) {
    return {
      pluginName: 'demo-plugin',
      pluginDir,
      digest: 'b'.repeat(64),
      steps: stepList,
      runner,
      paths: resolveInstallPaths(pluginsDir),
    };
  }

  it('runs npm ci with ignore-scripts and a pinned registry, never through a shell', async () => {
    const runner = fakeRunner();

    const result = await runInstallSteps(options(steps([{ kind: 'npm_ci', cwd: 'mcp-servers/demo' }]), runner));

    expect(result.results[0].status).toBe('completed');
    const invocation = runner.invocations[0];
    expect(invocation.cwd).toBe(join(pluginDir, 'mcp-servers', 'demo'));
    expect(invocation.args).toContain('ci');
    expect(invocation.args).toContain('--ignore-scripts');
    expect(invocation.args).toContain('--registry');
    expect(invocation.args).toContain('https://registry.npmjs.org/');
    expect(invocation.args.some((arg) => arg === '-c' || arg === '/c')).toBe(false);
    expect(invocation.command).not.toMatch(/\.cmd$/);
  });

  it('runs only the declared npm script for npm_run', async () => {
    const runner = fakeRunner();

    await runInstallSteps(options(steps([{ kind: 'npm_run', cwd: 'mcp-servers/demo', script: 'build' }]), runner));

    expect(runner.invocations[0].args.slice(0, 2)).toEqual(['run', 'build']);
  });

  it('fails the install when a dependency step exits non-zero', async () => {
    const runner = fakeRunner({ fail: (_command, args) => args.includes('ci') });

    await expect(runInstallSteps(options(steps([{ kind: 'npm_ci' }]), runner)))
      .rejects.toThrow(/npm_ci|exit/i);
  });

  it('resolves npm without spawning a .cmd shim on Windows', () => {
    const windows = resolveNpmInvocation({
      platform: 'win32',
      execPath: 'C:\\Program Files\\nodejs\\node.exe',
      env: { XIAOK_NPM_CLI_JS: 'C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js' },
    });
    expect(windows.command).toBe('C:\\Program Files\\nodejs\\node.exe');
    expect(windows.prefixArgs).toEqual(['C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js']);

    const posix = resolveNpmInvocation({ platform: 'darwin', execPath: '/usr/local/bin/node', env: {} });
    expect(posix.command).toBe('npm');
    expect(posix.prefixArgs).toEqual([]);
  });

  it('creates a digest-isolated python runtime and installs hashed requirements only', async () => {
    writeFileSync(
      join(pluginDir, 'requirements.txt'),
      'mcp==1.27.1 \\\n    --hash=sha256:1111111111111111111111111111111111111111111111111111111111111111\n',
    );
    const runner = fakeRunner();

    const result = await runInstallSteps(options(steps([{ kind: 'python_requirements', file: 'requirements.txt' }]), runner));

    const expectedRuntime = join(pluginsDir, '.runtimes', 'demo-plugin', 'b'.repeat(64));
    expect(result.runtimeDirs).toEqual([expectedRuntime]);
    const venvInvocation = runner.invocations.find((invocation) => invocation.args.includes('venv'));
    expect(venvInvocation?.args).toEqual(['-m', 'venv', expectedRuntime]);
    const pipInvocation = runner.invocations.find((invocation) => invocation.args.includes('pip'));
    expect(pipInvocation?.command.startsWith(expectedRuntime)).toBe(true);
    expect(pipInvocation?.args).toContain('--require-hashes');
    expect(pipInvocation?.args).toContain('-r');
    expect(pipInvocation?.args).toContain(join(pluginDir, 'requirements.txt'));
    expect(pipInvocation?.args).toContain('--no-deps');
  });

  it('removes a runtime created by this run when a later install step fails', async () => {
    writeFileSync(
      join(pluginDir, 'requirements.txt'),
      'mcp==1.27.1 \\\n    --hash=sha256:1111111111111111111111111111111111111111111111111111111111111111\n',
    );
    writeFileSync(join(pluginDir, 'package.json'), '{"name":"demo-plugin"}\n', 'utf8');
    const runner = fakeRunner({ fail: (_command, args) => args.includes('ci') });
    const runtimeDir = join(pluginsDir, '.runtimes', 'demo-plugin', 'b'.repeat(64));

    await expect(runInstallSteps(options(steps([
      { kind: 'python_requirements', file: 'requirements.txt' },
      { kind: 'npm_ci' },
    ]), runner))).rejects.toThrow(/npm_ci|exit/i);

    expect(existsSync(runtimeDir)).toBe(false);
  });

  it('refuses unhashed, editable, vcs, extra-index and escaping requirements', async () => {
    const runner = fakeRunner();
    const cases: Array<[string, RegExp]> = [
      ['mcp==1.27.1\n', /hash/i],
      ['-e .\n', /editable/i],
      ['mcp @ git+https://github.com/foo/bar\n', /vcs|git\+/i],
      ['--extra-index-url https://evil.example.com/simple\n', /index/i],
      ['-r ../../../etc/other.txt\n', /escape|include/i],
      ['./local-wheel.whl\n', /local|path/i],
    ];

    for (const [content, expected] of cases) {
      writeFileSync(join(pluginDir, 'requirements.txt'), content);
      await expect(runInstallSteps(options(steps([{ kind: 'python_requirements' }]), runner)))
        .rejects.toThrow(expected);
    }
    expect(runner.invocations).toEqual([]);
  });

  it('never executes external steps and reports their servers as skipped', async () => {
    const runner = fakeRunner();

    const result = await runInstallSteps(options(
      steps([{ kind: 'external', serverNames: ['slide-renderer'], reason: 'system python required' }]),
      runner,
    ));

    expect(runner.invocations).toEqual([]);
    expect(result.results[0].status).toBe('skipped');
    expect(result.skippedServerNames).toEqual(['slide-renderer']);
  });

  it('refuses to run a step whose cwd is missing inside the plugin root', async () => {
    const runner = fakeRunner();

    await expect(runInstallSteps(options(steps([{ kind: 'npm_ci', cwd: 'mcp-servers/missing' }]), runner)))
      .rejects.toThrow(/mcp-servers\/missing|not a directory|does not exist/i);
    expect(runner.invocations).toEqual([]);
  });
});
