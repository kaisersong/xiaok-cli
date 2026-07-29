import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true, maxRetries: 3 });
  }
});

async function loadModule(): Promise<any> {
  return import(pathToFileURL(join(
    process.cwd(),
    'scripts/evals/kimi-k3-d9/cli-launch.mjs',
  )).href);
}

function syntheticLaunchRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'kimi-d9-launch-'));
  roots.push(root);
  mkdirSync(join(root, 'dist'), { recursive: true });
  mkdirSync(join(root, 'runtime/node/bin'), { recursive: true });
  mkdirSync(join(root, 'runtime/guard'), { recursive: true });
  writeFileSync(join(root, 'dist/index.js'), 'console.log("synthetic-ok");\n');
  writeFileSync(join(root, 'runtime/node/bin/node'), 'synthetic-node\n', { mode: 0o755 });
  writeFileSync(join(root, 'runtime/guard/runtime-guard.mjs'), 'export {};\n');
  return root;
}

describe('Kimi K3 D9 CLI launch contract', () => {
  it('constructs an allowlisted environment and rejects Node/DYLD loader injection', async () => {
    const { createLaunchSpec } = await loadModule();
    const root = syntheticLaunchRoot();
    const closureNode = join(root, 'runtime/node/bin/node');
    const options = {
      closureRoot: root,
      nodeExecutable: closureNode,
      entryRelativePath: 'dist/index.js',
      guardRelativePath: 'runtime/guard/runtime-guard.mjs',
      args: ['--version'],
      allowedEnvironment: {
        HOME: join(root, 'home'),
        PATH: '/usr/bin:/bin',
        KIMI_API_KEY: 'secret-not-logged',
      },
    };
    const spec = await createLaunchSpec(options);
    expect(spec.command).toBe(realpathSync(closureNode));
    expect(spec.args.slice(0, 3)).toEqual([
      '--no-global-search-paths',
      '--import',
      realpathSync(join(root, 'runtime/guard/runtime-guard.mjs')),
    ]);
    expect(spec.env).toMatchObject({
      NODE_OPTIONS: '',
      NODE_PATH: '',
      DYLD_LIBRARY_PATH: '',
      DYLD_FALLBACK_LIBRARY_PATH: '',
      DYLD_INSERT_LIBRARIES: '',
    });

    for (const field of [
      'NODE_OPTIONS',
      'NODE_PATH',
      'DYLD_LIBRARY_PATH',
      'DYLD_FALLBACK_LIBRARY_PATH',
      'DYLD_INSERT_LIBRARIES',
    ]) {
      await expect(createLaunchSpec({
        ...options,
        allowedEnvironment: { ...options.allowedEnvironment, [field]: 'injected' },
      })).rejects.toThrow('KIMI_D9_LAUNCH_ENV_INJECTION');
    }
  });

  it('recomputes the guard realpath and digest before every product process', async () => {
    const { createLaunchSpec } = await loadModule();
    const { digestGuardTree } = await import(pathToFileURL(join(
      process.cwd(),
      'scripts/evals/kimi-k3-d9/runtime-guard.mjs',
    )).href);
    const root = syntheticLaunchRoot();
    const closureNode = join(root, 'runtime/node/bin/node');
    const guardRoot = join(root, 'runtime/guard');
    const expectedGuardTreeDigest = await digestGuardTree(guardRoot);
    const base = {
      closureRoot: root,
      nodeExecutable: closureNode,
      entryRelativePath: 'dist/index.js',
      guardRelativePath: 'runtime/guard/runtime-guard.mjs',
      expectedGuardTreeDigest,
      allowedEnvironment: { HOME: join(root, 'home'), PATH: '/usr/bin:/bin' },
      args: [],
    };
    await expect(createLaunchSpec(base)).resolves.toBeDefined();

    writeFileSync(join(guardRoot, 'runtime-guard.mjs'), 'export const drift = true;\n');
    await expect(createLaunchSpec(base)).rejects
      .toThrow('KIMI_D9_GUARD_DIGEST_MISMATCH');
  });

  it('recomputes the exact Node executable and runtime identity before launch', async () => {
    const {
      createLaunchSpec,
      probeNodeLaunchContract,
    } = await loadModule();
    const root = syntheticLaunchRoot();
    const closureNode = join(root, 'runtime/node/bin/node');
    const probe = async () => ({
      nodeVersion: 'v24.15.0',
      modulesAbi: '137',
      nodeApi: '10',
      platform: 'darwin',
      arch: 'arm64',
      registerHooksType: 'function',
    });
    const expectedNodeLaunchContract = await probeNodeLaunchContract(
      closureNode,
      { probe },
    );
    const options = {
      closureRoot: root,
      nodeExecutable: closureNode,
      entryRelativePath: 'dist/index.js',
      guardRelativePath: 'runtime/guard/runtime-guard.mjs',
      allowedEnvironment: { HOME: join(root, 'home'), PATH: '/usr/bin:/bin' },
      args: [],
      expectedNodeLaunchContract,
      nodeRuntimeProbe: probe,
    };
    await expect(createLaunchSpec(options)).resolves.toBeDefined();

    writeFileSync(closureNode, 'drifted-node\n', { mode: 0o755 });
    await expect(createLaunchSpec(options)).rejects
      .toThrow('KIMI_D9_NODE_LAUNCH_CONTRACT_MISMATCH');
  });

  it('uses the exact closure Node and stable graph independent of caller cwd', async () => {
    const { createLaunchSpec } = await loadModule();
    const root = syntheticLaunchRoot();
    const closureNode = join(root, 'runtime/node/bin/node');
    const first = await createLaunchSpec({
      closureRoot: root,
      nodeExecutable: closureNode,
      entryRelativePath: 'dist/index.js',
      guardRelativePath: 'runtime/guard/runtime-guard.mjs',
      allowedEnvironment: { HOME: join(root, 'home'), PATH: '/usr/bin:/bin' },
      args: [],
      callerCwd: tmpdir(),
    });
    const second = await createLaunchSpec({
      closureRoot: root,
      nodeExecutable: closureNode,
      entryRelativePath: 'dist/index.js',
      guardRelativePath: 'runtime/guard/runtime-guard.mjs',
      allowedEnvironment: { HOME: join(root, 'home'), PATH: '/usr/bin:/bin' },
      args: [],
      callerCwd: join(root, 'dist'),
    });
    expect(first.command).toBe(second.command);
    expect(first.cwd).toBe(realpathSync(root));
    expect(first.args).toEqual(second.args);
  });
});
