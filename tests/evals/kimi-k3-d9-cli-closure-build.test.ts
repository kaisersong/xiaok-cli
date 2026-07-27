import {
  chmodSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readlinkSync,
  realpathSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const roots: string[] = [];

function makeWritable(path: string): void {
  const metadata = lstatSync(path, { throwIfNoEntry: false });
  if (!metadata || metadata.isSymbolicLink()) return;
  if (metadata.isDirectory()) {
    chmodSync(path, 0o755);
    for (const child of readdirSync(path)) {
      makeWritable(join(path, child));
    }
  } else {
    chmodSync(path, metadata.mode | 0o600);
  }
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    makeWritable(root);
    rmSync(root, { recursive: true, force: true, maxRetries: 3 });
  }
});

function freshClosure(): string {
  const root = mkdtempSync(join(tmpdir(), 'kimi-d9-closure-'));
  roots.push(root);
  for (const directory of [
    'dist',
    'data',
    'node_modules/pkg',
    'runtime/node/bin',
    'runtime/guard',
  ]) {
    mkdirSync(join(root, directory), { recursive: true });
  }
  writeFileSync(join(root, 'dist/index.js'), 'export const value = 1;\n');
  writeFileSync(join(root, 'data/catalog.json'), '{"model":"k3"}\n');
  writeFileSync(join(root, 'package.json'), '{"name":"fixture","type":"module"}\n');
  writeFileSync(join(root, 'package-lock.json'), '{"lockfileVersion":3}\n');
  writeFileSync(join(root, 'node_modules/pkg/index.js'), 'module.exports = 1;\n');
  writeFileSync(join(root, 'runtime/node/bin/node'), 'synthetic-node\n', { mode: 0o755 });
  writeFileSync(join(root, 'runtime/guard/runtime-guard.mjs'), 'export {};\n');
  return root;
}

async function loadModule(): Promise<any> {
  return import(pathToFileURL(join(
    process.cwd(),
    'scripts/evals/kimi-k3-d9/cli-closure-build.mjs',
  )).href);
}

describe('Kimi K3 D9 CLI closure construction', () => {
  it('binds the approved D9 design and exact one-shot construction recipe', async () => {
    const {
      APPROVED_D9_DESIGN_SHA256,
      OFFICIAL_NODE_RUNTIME_INPUT,
      validateConstructionRecipe,
    } = await loadModule();

    expect(APPROVED_D9_DESIGN_SHA256).toBe(
      '71fb4c66ac5b48c7d2a3d73c0bf786b4f81f3e542b51aa05a04b2ffabffcbb75',
    );
    expect(OFFICIAL_NODE_RUNTIME_INPUT).toEqual({
      archiveIdentity: 'node-v24.15.0-darwin-arm64.tar.gz',
      archiveSha256: '372331b969779ab5d15b949884fc6eaf88d5afe87bde8ba881d6400b9100ffc4',
      nodeVersion: 'v24.15.0',
      modulesAbi: '137',
      nodeApi: '10',
      platform: 'darwin',
      arch: 'arm64',
      npmVersion: '11.12.1',
    });
    expect(validateConstructionRecipe({
      expectedCommit: 'a'.repeat(40),
      actualCommit: 'a'.repeat(40),
      dirty: false,
      unexpectedGeneratedOutputs: [],
      operations: ['build-install', 'build-release', 'runtime-install', 'assemble'],
    })).toEqual({ constructionCount: 1, valid: true });

    for (const invalid of [
      { dirty: true },
      { actualCommit: 'b'.repeat(40) },
      { unexpectedGeneratedOutputs: ['src/unexpected.ts'] },
      { operations: ['build-install', 'build-release', 'runtime-install', 'assemble', 'assemble'] },
      { operations: ['build-install', 'build-release', 'runtime-install', 'prune', 'assemble'] },
      { operations: ['build-install', 'build-release', 'runtime-install', 'copy-over', 'assemble'] },
    ]) {
      expect(() => validateConstructionRecipe({
        expectedCommit: 'a'.repeat(40),
        actualCommit: 'a'.repeat(40),
        dirty: false,
        unexpectedGeneratedOutputs: [],
        operations: ['build-install', 'build-release', 'runtime-install', 'assemble'],
        ...invalid,
      })).toThrow(/KIMI_D9_CONSTRUCTION_/u);
    }
  });

  it('verifies a pre-obtained Node archive by exact identity and bytes before use', async () => {
    const { verifyOfficialNodeArchive } = await loadModule();
    const root = mkdtempSync(join(tmpdir(), 'kimi-d9-node-input-'));
    roots.push(root);
    const archivePath = join(root, 'node-v24.15.0-darwin-arm64.tar.gz');
    writeFileSync(archivePath, 'synthetic archive bytes');
    const expectedSha256 = '22e6654e4eedb6e42b01cc501eb20198229a64051409fe239326ae62617764ca';

    await expect(verifyOfficialNodeArchive({
      archivePath,
      expectedIdentity: 'node-v24.15.0-darwin-arm64.tar.gz',
      expectedSha256,
    })).resolves.toMatchObject({
      archiveIdentity: 'node-v24.15.0-darwin-arm64.tar.gz',
      archiveSha256: expectedSha256,
    });
    await expect(verifyOfficialNodeArchive({
      archivePath,
      expectedIdentity: 'node-v24.15.0-darwin-arm64.tar.gz',
      expectedSha256: '0'.repeat(64),
    })).rejects.toThrow('KIMI_D9_NODE_ARCHIVE_DIGEST_MISMATCH');
  });

  it('binds the extracted official Node distribution full tree before construction', async () => {
    const {
      digestTree,
      verifyOfficialNodeDistributionTree,
    } = await loadModule();
    const root = mkdtempSync(join(tmpdir(), 'kimi-d9-node-tree-'));
    roots.push(root);
    const distributionRoot = join(root, 'node-v24.15.0-darwin-arm64');
    mkdirSync(join(distributionRoot, 'bin'), { recursive: true });
    writeFileSync(join(distributionRoot, 'bin/node'), 'official-node\n', { mode: 0o755 });
    const expectedTreeDigest = (await digestTree(distributionRoot)).digest;

    await expect(verifyOfficialNodeDistributionTree({
      distributionRoot,
      expectedTreeDigest,
    })).resolves.toMatchObject({ expectedTreeDigest });
    writeFileSync(join(distributionRoot, 'bin/node'), 'tree-drift\n', { mode: 0o755 });
    await expect(verifyOfficialNodeDistributionTree({
      distributionRoot,
      expectedTreeDigest,
    })).rejects.toThrow('KIMI_D9_NODE_DISTRIBUTION_TREE_MISMATCH');
  });

  it('accepts an internal symlink when the lexical root has a macOS realpath alias', async () => {
    const { digestTree } = await loadModule();
    const root = mkdtempSync('/tmp/kimi-d9-node-realpath-alias-');
    roots.push(root);
    if (realpathSync(root) === root) return;

    mkdirSync(join(root, 'bin'), { recursive: true });
    mkdirSync(join(root, 'lib/node_modules/npm/bin'), { recursive: true });
    writeFileSync(join(root, 'lib/node_modules/npm/bin/npm-cli.js'), 'npm\n');
    symlinkSync(
      '../lib/node_modules/npm/bin/npm-cli.js',
      join(root, 'bin/npm'),
    );

    await expect(digestTree(root)).resolves.toMatchObject({
      digest: expect.stringMatching(/^[0-9a-f]{64}$/u),
    });
  });

  it('changes the closure digest for product, Node, guard, mode, and symlink drift', async () => {
    const { attestCliRuntimeClosure } = await loadModule();
    const root = freshClosure();
    const initial = await attestCliRuntimeClosure(root);

    writeFileSync(join(root, 'data/catalog.json'), '{"model":"k3-drift"}\n');
    expect((await attestCliRuntimeClosure(root)).closureDigest).not.toBe(initial.closureDigest);

    writeFileSync(join(root, 'data/catalog.json'), '{"model":"k3"}\n');
    chmodSync(join(root, 'runtime/guard/runtime-guard.mjs'), 0o700);
    expect((await attestCliRuntimeClosure(root)).guardTreeDigest).not.toBe(initial.guardTreeDigest);

    chmodSync(join(root, 'runtime/guard/runtime-guard.mjs'), 0o644);
    writeFileSync(join(root, 'runtime/node/bin/node'), 'different-node\n', { mode: 0o755 });
    expect((await attestCliRuntimeClosure(root)).nodeRuntimeTreeDigest)
      .not.toBe(initial.nodeRuntimeTreeDigest);

    writeFileSync(join(root, 'runtime/node/bin/node'), 'synthetic-node\n', { mode: 0o755 });
    symlinkSync('runtime-guard.mjs', join(root, 'runtime/guard/current.mjs'));
    expect((await attestCliRuntimeClosure(root)).guardTreeDigest).not.toBe(initial.guardTreeDigest);
  });

  it('rejects closure-external symlinks and multiply-linked files', async () => {
    const { attestCliRuntimeClosure } = await loadModule();
    const root = freshClosure();
    const outside = join(tmpdir(), `kimi-d9-outside-${process.pid}-${Date.now()}.js`);
    roots.push(outside);
    writeFileSync(outside, 'outside\n');
    symlinkSync(outside, join(root, 'node_modules/pkg/outside.js'));
    await expect(attestCliRuntimeClosure(root)).rejects.toThrow('KIMI_D9_EXTERNAL_SYMLINK');

    rmSync(join(root, 'node_modules/pkg/outside.js'));
    linkSync(
      join(root, 'dist/index.js'),
      join(root, 'node_modules/pkg/hard-linked.js'),
    );
    await expect(attestCliRuntimeClosure(root)).rejects.toThrow('KIMI_D9_HARD_LINK');
  });

  it('assembles one content-addressed read-only physical closure and rejects a second construction', async () => {
    const { constructCliRuntimeClosure } = await loadModule();
    const root = mkdtempSync(join(tmpdir(), 'kimi-d9-construction-'));
    roots.push(root);
    const sourceWorktree = join(root, 'source');
    const constructionParent = join(root, 'construction');
    const nodeDistributionRoot = join(root, 'official-node');
    const guardSourcePath = join(root, 'runtime-guard.mjs');
    mkdirSync(join(sourceWorktree, 'dist'), { recursive: true });
    mkdirSync(join(sourceWorktree, 'data'), { recursive: true });
    mkdirSync(join(nodeDistributionRoot, 'bin'), { recursive: true });
    mkdirSync(join(nodeDistributionRoot, 'lib/node_modules/npm/bin'), { recursive: true });
    writeFileSync(join(sourceWorktree, 'dist/index.js'), 'console.log("built");\n');
    writeFileSync(join(sourceWorktree, 'data/catalog.json'), '{}\n');
    writeFileSync(join(sourceWorktree, 'package.json'), '{"name":"synthetic","type":"module"}\n');
    writeFileSync(join(sourceWorktree, 'package-lock.json'), '{"lockfileVersion":3}\n');
    writeFileSync(join(nodeDistributionRoot, 'bin/node'), 'synthetic-node\n', { mode: 0o755 });
    writeFileSync(
      join(nodeDistributionRoot, 'lib/node_modules/npm/bin/npm-cli.js'),
      'synthetic npm\n',
    );
    symlinkSync(
      '../lib/node_modules/npm/bin/npm-cli.js',
      join(nodeDistributionRoot, 'bin/npm'),
    );
    writeFileSync(guardSourcePath, 'export {};\n');
    const operations: string[] = [];
    const stepPaths: string[] = [];
    const runStep = async (
      step: string,
      context: { cwd: string; environment: { PATH: string } },
    ) => {
      operations.push(step);
      stepPaths.push(context.environment.PATH);
      if (step === 'runtime-install') {
        mkdirSync(join(context.cwd, 'node_modules/pkg'), { recursive: true });
        writeFileSync(join(context.cwd, 'node_modules/pkg/index.js'), 'module.exports=1;\n');
      }
    };
    const input = {
      expectedCommit: 'a'.repeat(40),
      sourceWorktree,
      constructionParent,
      nodeDistributionRoot,
      guardSourcePath,
      allowSyntheticNodeRuntime: true,
      inspectWorktree: async () => ({
        commit: 'a'.repeat(40),
        dirty: false,
        unexpectedGeneratedOutputs: [],
      }),
      runStep,
    };

    const unverifiedOperations: string[] = [];
    await expect(constructCliRuntimeClosure({
      ...input,
      constructionParent: join(root, 'unverified-construction'),
      allowSyntheticNodeRuntime: false,
      runStep: async (step: string) => {
        unverifiedOperations.push(step);
      },
    })).rejects.toThrow('KIMI_D9_NODE_ARCHIVE_ATTESTATION_REQUIRED');
    expect(unverifiedOperations).toEqual([]);

    const result = await constructCliRuntimeClosure(input);
    expect(operations).toEqual([
      'build-install',
      'build-release',
      'runtime-install',
    ]);
    expect(stepPaths.slice(0, 2)).toEqual([
      `${realpathSync(nodeDistributionRoot)}/bin:/usr/bin:/bin`,
      `${realpathSync(nodeDistributionRoot)}/bin:/usr/bin:/bin`,
    ]);
    expect(stepPaths[2]).toMatch(
      new RegExp(
        `^${constructionParent.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}`
        + '/\\.staging-[^/]+/runtime/node/bin:/usr/bin:/bin$',
        'u',
      ),
    );
    expect(result.closurePath).toContain(result.attestation.closureDigest);
    expect(readlinkSync(join(result.closurePath, 'runtime/node/bin/npm')))
      .toBe('../lib/node_modules/npm/bin/npm-cli.js');
    expect(lstatSync(join(result.closurePath, 'dist/index.js')).mode & 0o222).toBe(0);
    const operationCount = operations.length;
    await expect(constructCliRuntimeClosure(input)).rejects
      .toThrow('KIMI_D9_CONSTRUCTION_ALREADY_STARTED');
    expect(operations).toHaveLength(operationCount);
  });

  it('creates a detached clean recorded-commit worktree at an independent path', async () => {
    const { createDetachedRecordedWorktree } = await loadModule();
    const root = mkdtempSync(join(tmpdir(), 'kimi-d9-detached-worktree-'));
    roots.push(root);
    const repoRoot = join(root, 'repo');
    const worktreePath = join(root, 'build-parent/baseline');
    const commit = 'b'.repeat(40);
    mkdirSync(repoRoot);
    const calls: any[] = [];
    const result = await createDetachedRecordedWorktree({
      repoRoot,
      worktreePath,
      commit,
      runGit: async (request: any) => {
        calls.push(request);
        mkdirSync(worktreePath, { recursive: true });
      },
      inspectWorktree: async () => ({
        commit,
        dirty: false,
        unexpectedGeneratedOutputs: [],
      }),
    });
    expect(calls).toEqual([{
      repoRoot: realpathSync(repoRoot),
      args: ['worktree', 'add', '--detach', worktreePath, commit],
    }]);
    expect(result).toMatchObject({ commit, worktreePath: realpathSync(worktreePath) });
    await expect(createDetachedRecordedWorktree({
      repoRoot,
      worktreePath,
      commit,
      runGit: async () => undefined,
      inspectWorktree: async () => ({ commit, dirty: false }),
    })).rejects.toThrow('KIMI_D9_WORKTREE_PATH_EXISTS');
  });
});
