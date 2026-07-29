import { spawn } from 'node:child_process';
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

async function loadRuntime(): Promise<any> {
  return import(pathToFileURL(join(
    process.cwd(),
    'scripts/evals/kimi-k3-d9/desktop-fixture-runtime.mjs',
  )).href);
}

async function writePackage(
  nodeModulesRoot: string,
  packageName: string,
  packageJson: Record<string, unknown>,
  files: Record<string, string>,
) {
  const packageRoot = join(nodeModulesRoot, ...packageName.split('/'));
  await mkdir(packageRoot, { recursive: true });
  await writeFile(
    join(packageRoot, 'package.json'),
    `${JSON.stringify({ name: packageName, ...packageJson }, null, 2)}\n`,
  );
  for (const [relativePath, content] of Object.entries(files)) {
    const path = join(packageRoot, relativePath);
    await mkdir(join(path, '..'), { recursive: true });
    await writeFile(path, content);
  }
}

function runNode(
  executable: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv },
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(executable, args, {
      ...options,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => {
      stdout += String(chunk);
    });
    child.stderr.on('data', chunk => {
      stderr += String(chunk);
    });
    child.once('error', rejectPromise);
    child.once('exit', code => resolvePromise({ code, stdout, stderr }));
  });
}

describe('Kimi K3 D9 frozen Desktop fixture runtime', () => {
  it('copies a closed SDK/zod dependency graph and resolves it with the explicit frozen Node only', async () => {
    const {
      attestFrozenDesktopFixtureRuntime,
      materializeFrozenDesktopFixtureRuntime,
    } = await loadRuntime();
    const root = await mkdtemp(join(tmpdir(), 'kimi-d9-desktop-fixture-'));
    const sourceRoot = join(root, 'source');
    const runtimeRoot = join(root, 'frozen-runtime');
    const nodeModulesRoot = join(sourceRoot, 'node_modules');
    const serverSourcePath = join(
      sourceRoot,
      'scripts',
      'evals',
      'kimi-k3-d9',
      'fixture-server.mjs',
    );
    try {
      await mkdir(join(serverSourcePath, '..'), { recursive: true });
      await mkdir(join(sourceRoot, 'dist', 'ai', 'runtime'), {
        recursive: true,
      });
      await writeFile(
        serverSourcePath,
        [
          "import { sdkMarker } from '@modelcontextprotocol/sdk/server/mcp.js';",
          "import { zodMarker } from 'zod/v4';",
          "import { canonicalMarker } from '../../../dist/ai/runtime/canonical-json.js';",
          'export async function runStdioFixtureServerFromEnvironment() {',
          '  process.stdout.write(JSON.stringify({ sdkMarker, zodMarker, canonicalMarker }));',
          '}',
          '',
        ].join('\n'),
      );
      await writeFile(
        join(sourceRoot, 'dist', 'ai', 'runtime', 'canonical-json.js'),
        "export const canonicalMarker = 'frozen-canonical';\n",
      );
      await writePackage(nodeModulesRoot, '@modelcontextprotocol/sdk', {
        version: '1.2.3',
        type: 'module',
        exports: {
          './server/mcp.js': './server/mcp.js',
        },
        dependencies: {
          'sdk-leaf': '1.0.0',
        },
        peerDependencies: {
          zod: '1.0.0',
        },
      }, {
        'server/mcp.js': [
          "import { leafMarker } from 'sdk-leaf';",
          "export const sdkMarker = `frozen-sdk:${leafMarker}`;",
          '',
        ].join('\n'),
      });
      await writePackage(nodeModulesRoot, 'sdk-leaf', {
        version: '1.0.0',
        type: 'module',
        exports: './index.js',
      }, {
        'index.js': "export const leafMarker = 'leaf';\n",
      });
      await writePackage(nodeModulesRoot, 'zod', {
        version: '1.0.0',
        type: 'module',
        exports: {
          './v4': './v4.js',
        },
      }, {
        'v4.js': "export const zodMarker = 'frozen-zod';\n",
      });

      const runtime = await materializeFrozenDesktopFixtureRuntime({
        sourceRoot,
        runtimeRoot,
        nodeExecutable: process.execPath,
      });
      const outsideCwd = join(root, 'outside-cwd');
      await mkdir(outsideCwd);

      expect(runtime).toEqual(expect.objectContaining({
        schemaVersion: 1,
        runtimeRoot,
        nodeExecutable: process.execPath,
        serverEntryPath: join(runtimeRoot, 'fixture-server-entry.mjs'),
        sdkPackageRoot: join(
          runtimeRoot,
          'node_modules',
          '@modelcontextprotocol',
          'sdk',
        ),
        zodPackageRoot: join(runtimeRoot, 'node_modules', 'zod'),
        treeDigest: expect.stringMatching(/^[0-9a-f]{64}$/u),
        nodeExecutableDigest: expect.stringMatching(/^[0-9a-f]{64}$/u),
      }));
      expect(await attestFrozenDesktopFixtureRuntime(runtime)).toBe(true);
      const guard = await readFile(runtime.guardPath, 'utf8');
      expect(guard).toContain('registerHooks');
      expect(guard).toContain('KIMI_D9_FIXTURE_RUNTIME_ESCAPE');

      const result = await runNode(runtime.nodeExecutable, [
        '--no-global-search-paths',
        '--import',
        runtime.guardPath,
        runtime.serverEntryPath,
      ], {
        cwd: outsideCwd,
        env: {
          KIMI_D9_FIXTURE_RUNTIME_ROOT: runtime.runtimeRoot,
          PATH: '/definitely/not/a/node/path',
        },
      });
      expect(result).toEqual({
        code: 0,
        stdout: JSON.stringify({
          sdkMarker: 'frozen-sdk:leaf',
          zodMarker: 'frozen-zod',
          canonicalMarker: 'frozen-canonical',
        }),
        stderr: '',
      });
      await expect(attestFrozenDesktopFixtureRuntime({
        ...runtime,
        nodeExecutableDigest: '00'.repeat(32),
      })).rejects.toThrow('KIMI_D9_DESKTOP_FIXTURE_RUNTIME_DRIFT');
      await writeFile(runtime.serverEntryPath, '\n', { flag: 'a' });
      await expect(
        attestFrozenDesktopFixtureRuntime(runtime),
      ).rejects.toThrow('KIMI_D9_DESKTOP_FIXTURE_RUNTIME_DRIFT');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('fails closed when the frozen tree or Node executable drifts', async () => {
    const {
      attestFrozenDesktopFixtureRuntime,
    } = await loadRuntime();
    const root = await mkdtemp(join(tmpdir(), 'kimi-d9-fixture-drift-'));
    try {
      await expect(attestFrozenDesktopFixtureRuntime({
        schemaVersion: 1,
        runtimeRoot: root,
        nodeExecutable: process.execPath,
        serverEntryPath: join(root, 'server.mjs'),
        guardPath: join(root, 'guard.mjs'),
        sdkPackageRoot: join(root, 'node_modules', '@modelcontextprotocol', 'sdk'),
        zodPackageRoot: join(root, 'node_modules', 'zod'),
        treeDigest: '00'.repeat(32),
        nodeExecutableDigest: '11'.repeat(32),
      })).rejects.toThrow('KIMI_D9_DESKTOP_FIXTURE_RUNTIME_DRIFT');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
