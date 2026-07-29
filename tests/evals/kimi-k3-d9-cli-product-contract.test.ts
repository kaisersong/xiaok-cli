import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

const roots: string[] = [];
const execFileAsync = promisify(execFile);

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root =>
    rm(root, { recursive: true, force: true, maxRetries: 3 })));
});

async function loadDriver(): Promise<any> {
  return import(pathToFileURL(join(
    process.cwd(),
    'scripts/evals/kimi-k3-d9/cli-driver.mjs',
  )).href);
}

async function frozenSyntheticClosure({
  entrySource = 'process.exit(0);\n',
}: {
  entrySource?: string;
} = {}): Promise<{
  closureRoot: string;
  manifestPath: string;
  manifestHash: string;
}> {
  const root = await mkdtemp(join(tmpdir(), 'kimi-d9-cli-contract-'));
  roots.push(root);
  const closureRoot = join(root, 'closure');
  for (const directory of [
    'dist',
    'data',
    'node_modules/fixture',
    'runtime/node/bin',
    'runtime/guard',
  ]) {
    await mkdir(join(closureRoot, directory), { recursive: true });
  }
  await writeFile(join(closureRoot, 'dist/index.js'), entrySource);
  await writeFile(join(closureRoot, 'dist/blocked.js'), 'export {};\n');
  await writeFile(join(closureRoot, 'data/catalog.json'), '{}\n');
  await writeFile(join(closureRoot, 'package.json'), '{"type":"module"}\n');
  await writeFile(join(closureRoot, 'package-lock.json'), '{"lockfileVersion":3}\n');
  await writeFile(join(closureRoot, 'node_modules/fixture/index.js'), 'export {};\n');
  await writeFile(
    join(closureRoot, 'runtime/guard/runtime-guard.mjs'),
    await readFile(join(
      process.cwd(),
      'scripts/evals/kimi-k3-d9/runtime-guard.mjs',
    )),
  );
  await writeFile(
    join(closureRoot, 'runtime/node/bin/node'),
    `#!/bin/sh\nexec '${process.execPath}' "$@"\n`,
    { mode: 0o755 },
  );
  await chmod(join(closureRoot, 'runtime/node/bin/node'), 0o755);

  const { attestCliRuntimeClosure } = await import(pathToFileURL(join(
    process.cwd(),
    'scripts/evals/kimi-k3-d9/cli-closure-build.mjs',
  )).href);
  const { canonicalize } = await import(pathToFileURL(join(
    process.cwd(),
    'scripts/evals/kimi-k3-d9/canonical.mjs',
  )).href);
  const attestation = await attestCliRuntimeClosure(closureRoot);
  const allowedModuleRelativePaths = ['dist/index.js'];
  const manifest = {
    schemaVersion: 1,
    artifactKind: 'cli-runtime-closure-v1',
    closureRoot: attestation.physicalIdentity.realpath,
    closureAttestation: attestation,
    nodeRelativePath: 'runtime/node/bin/node',
    entryRelativePath: 'dist/index.js',
    guardRelativePath: 'runtime/guard/runtime-guard.mjs',
    allowedModuleRelativePaths,
    resolutionGraphDigest: createHash('sha256').update(canonicalize({
      entryRelativePath: 'dist/index.js',
      modules: allowedModuleRelativePaths,
    })).digest('hex'),
  };
  const bytes = canonicalize(manifest);
  const manifestPath = join(root, 'closure-manifest.json');
  await writeFile(manifestPath, bytes, { mode: 0o400 });
  return {
    closureRoot: attestation.physicalIdentity.realpath,
    manifestPath,
    manifestHash: createHash('sha256').update(bytes).digest('hex'),
  };
}

describe('Kimi K3 D9 CLI black-box product contract', () => {
  it('accepts only a hash-matched physical closure manifest and re-attests its bytes', async () => {
    const {
      createCliProductLaunch,
      loadFrozenCliClosure,
    } = await loadDriver();
    const frozen = await frozenSyntheticClosure();
    const closure = await loadFrozenCliClosure({
      closureManifestPath: frozen.manifestPath,
      closureManifestHash: frozen.manifestHash,
    });
    const launch = createCliProductLaunch({
      frozenClosure: closure,
      workspace: '/private/tmp/d9/arm/workspace',
      homeDir: '/private/tmp/d9/arm/home',
      configDir: '/private/tmp/d9/arm/config',
      traceDir: '/private/tmp/d9/arm/trace',
      tempDir: '/private/tmp/d9/arm/temp',
      xdgConfigDir: '/private/tmp/d9/arm/xdg-config',
      xdgCacheDir: '/private/tmp/d9/arm/xdg-cache',
      xdgDataDir: '/private/tmp/d9/arm/xdg-data',
      preservedThinking: true,
    });

    expect(launch.command).toBe(`${frozen.closureRoot}/runtime/node/bin/node`);
    expect(launch.args).toEqual([
      '--no-global-search-paths',
      '--import',
      `${frozen.closureRoot}/runtime/guard/runtime-guard.mjs`,
      `${frozen.closureRoot}/dist/index.js`,
      'chat',
      '--auto',
    ]);
    expect(launch.cwd).toBe('/private/tmp/d9/arm/workspace');
    expect(launch.env.HOME).not.toBe(launch.env.XIAOK_CONFIG_DIR);
    expect(launch.env.NODE_PATH).toBe('');
    expect(launch.env.NODE_OPTIONS).toBe('');
    expect(launch.env.XIAOK_EXPERIMENTAL_KIMI_PROMPT_CACHE).toBe('0');
    expect(launch.env.XIAOK_EXPERIMENTAL_KIMI_PRESERVED_THINKING).toBe('1');
    expect(JSON.parse(launch.env.XIAOK_D9_RUNTIME_GUARD_POLICY)).toEqual({
      closureRoot: frozen.closureRoot,
      allowedRealpaths: [`${frozen.closureRoot}/dist/index.js`],
    });
    expect(Object.keys(launch.env)).not.toContain('GITHUB_TOKEN');

    await expect(loadFrozenCliClosure({
      closureManifestPath: frozen.manifestPath,
      closureManifestHash: '00'.repeat(32),
    })).rejects.toThrow('KIMI_D9_CLI_CLOSURE_MANIFEST_INVALID');

    await writeFile(
      join(frozen.closureRoot, 'data/catalog.json'),
      '{"drift":true}\n',
    );
    await expect(loadFrozenCliClosure({
      closureManifestPath: frozen.manifestPath,
      closureManifestHash: frozen.manifestHash,
    })).rejects.toThrow('KIMI_D9_CLI_CLOSURE_DRIFT');
  });

  it('rejects arbitrary product roots, emitted test trees, and owner deep imports', async () => {
    const source = await readFile(
      join(process.cwd(), 'scripts/evals/kimi-k3-d9/cli-driver.mjs'),
      'utf8',
    );
    for (const forbiddenImport of [
      'ai/adapters',
      'control-plane',
      'provider-conversation-authorization',
      'session-store',
      'tool-registry',
      'fake-sdk',
    ]) {
      expect(source).not.toContain(forbiddenImport);
    }

    const { loadFrozenCliClosure } = await loadDriver();
    await expect(loadFrozenCliClosure({
      productRoot: '/private/tmp/arbitrary-product-root',
      closureManifestPath: '/private/tmp/missing.json',
      closureManifestHash: 'ab'.repeat(32),
    })).rejects.toThrow('KIMI_D9_CLI_PRODUCT_ROOT_FORBIDDEN');

    const frozen = await frozenSyntheticClosure();
    const parsed = JSON.parse(await readFile(frozen.manifestPath, 'utf8'));
    parsed.entryRelativePath = '.test-dist/index.js';
    const { canonicalize } = await import(pathToFileURL(join(
      process.cwd(),
      'scripts/evals/kimi-k3-d9/canonical.mjs',
    )).href);
    const bytes = canonicalize(parsed);
    await chmod(frozen.manifestPath, 0o600);
    await writeFile(frozen.manifestPath, bytes);
    await expect(loadFrozenCliClosure({
      closureManifestPath: frozen.manifestPath,
      closureManifestHash: createHash('sha256').update(bytes).digest('hex'),
    })).rejects.toThrow('KIMI_D9_CLI_PRODUCT_CONTRACT_INVALID');
  });

  it('executes the frozen runtime guard and rejects a module outside the allowed graph', async () => {
    const {
      createCliProductLaunch,
      loadFrozenCliClosure,
    } = await loadDriver();
    const frozen = await frozenSyntheticClosure({
      entrySource: "import './blocked.js';\n",
    });
    const closure = await loadFrozenCliClosure({
      closureManifestPath: frozen.manifestPath,
      closureManifestHash: frozen.manifestHash,
    });
    const sessionRoot = await mkdtemp(join(
      tmpdir(),
      'kimi-d9-guard-session-',
    ));
    roots.push(sessionRoot);
    const paths = {
      workspace: join(sessionRoot, 'workspace'),
      homeDir: join(sessionRoot, 'home'),
      configDir: join(sessionRoot, 'config'),
      traceDir: join(sessionRoot, 'trace'),
      tempDir: join(sessionRoot, 'temp'),
      xdgConfigDir: join(sessionRoot, 'xdg-config'),
      xdgCacheDir: join(sessionRoot, 'xdg-cache'),
      xdgDataDir: join(sessionRoot, 'xdg-data'),
    };
    await Promise.all(Object.values(paths).map(path =>
      mkdir(path, { recursive: true })));
    const launch = createCliProductLaunch({
      frozenClosure: closure,
      ...paths,
      preservedThinking: true,
    });
    const outcome = await execFileAsync(
      launch.command,
      launch.args,
      {
        cwd: launch.cwd,
        env: launch.env,
        timeout: 2_000,
      },
    ).then(
      () => 'resolved',
      (error: any) => `${error.message}\n${error.stderr ?? ''}`,
    );
    expect(outcome).toContain('KIMI_D9_GUARD_GRAPH_MISMATCH');
  });
});
