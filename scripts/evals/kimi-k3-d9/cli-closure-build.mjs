import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import {
  chmod,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  readlink,
  realpath,
  rename,
  stat,
  writeFile,
} from 'node:fs/promises';
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
export const APPROVED_D9_DESIGN_SHA256 =
  '71fb4c66ac5b48c7d2a3d73c0bf786b4f81f3e542b51aa05a04b2ffabffcbb75';

export const OFFICIAL_NODE_RUNTIME_INPUT = Object.freeze({
  archiveIdentity: 'node-v24.15.0-darwin-arm64.tar.gz',
  archiveSha256: '372331b969779ab5d15b949884fc6eaf88d5afe87bde8ba881d6400b9100ffc4',
  nodeVersion: 'v24.15.0',
  modulesAbi: '137',
  nodeApi: '10',
  platform: 'darwin',
  arch: 'arm64',
  npmVersion: '11.12.1',
});

const REQUIRED_OPERATION_SEQUENCE = Object.freeze([
  'build-install',
  'build-release',
  'runtime-install',
  'assemble',
]);

function fail(code, details = '') {
  throw new Error(details ? `${code}: ${details}` : code);
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function canonicalize(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

function canonicalBytes(value) {
  return Buffer.from(JSON.stringify(canonicalize(value)), 'utf8');
}

function toPosix(path) {
  return path.split(sep).join('/');
}

export function isWithinRoot(root, candidate) {
  const child = relative(resolve(root), resolve(candidate));
  return child === '' || (!child.startsWith(`..${sep}`) && child !== '..' && !isAbsolute(child));
}

export function validateConstructionRecipe(input) {
  if (input.dirty) {
    fail('KIMI_D9_CONSTRUCTION_DIRTY_WORKTREE');
  }
  if (input.actualCommit !== input.expectedCommit) {
    fail('KIMI_D9_CONSTRUCTION_COMMIT_MISMATCH');
  }
  if ((input.unexpectedGeneratedOutputs ?? []).length > 0) {
    fail('KIMI_D9_CONSTRUCTION_UNEXPECTED_GENERATED_OUTPUT');
  }
  const operations = input.operations ?? [];
  if (
    operations.length !== REQUIRED_OPERATION_SEQUENCE.length
    || operations.some((operation, index) => operation !== REQUIRED_OPERATION_SEQUENCE[index])
  ) {
    const forbidden = operations.find((operation) =>
      ['prune', 'relink', 'copy-over'].includes(operation));
    fail(forbidden
      ? 'KIMI_D9_CONSTRUCTION_FORBIDDEN_OPERATION'
      : 'KIMI_D9_CONSTRUCTION_RECIPE_MISMATCH');
  }
  return { constructionCount: 1, valid: true };
}

export async function verifyOfficialNodeArchive(input) {
  const archivePath = resolve(input.archivePath);
  const archiveIdentity = basename(archivePath);
  if (archiveIdentity !== input.expectedIdentity) {
    fail('KIMI_D9_NODE_ARCHIVE_IDENTITY_MISMATCH', archiveIdentity);
  }
  const archiveSha256 = sha256(await readFile(archivePath).catch(() =>
    fail('KIMI_D9_NODE_ARCHIVE_MISSING', archivePath)));
  if (archiveSha256 !== input.expectedSha256) {
    fail('KIMI_D9_NODE_ARCHIVE_DIGEST_MISMATCH', archiveSha256);
  }
  return { archiveIdentity, archiveSha256, archivePath };
}

async function defaultInspectWorktree(sourceWorktree) {
  const [{ stdout: commitOutput }, { stdout: statusOutput }] = await Promise.all([
    execFileAsync('git', ['-C', sourceWorktree, 'rev-parse', 'HEAD'], {
      encoding: 'utf8',
    }),
    execFileAsync('git', ['-C', sourceWorktree, 'status', '--porcelain=v1'], {
      encoding: 'utf8',
    }),
  ]);
  const statusLines = statusOutput.split(/\r?\n/u).filter(Boolean);
  return {
    commit: commitOutput.trim(),
    dirty: statusLines.length > 0,
    statusPaths: statusLines.map((line) => line.slice(3)),
    unexpectedGeneratedOutputs: [],
  };
}

async function defaultRunGit(request) {
  await execFileAsync('git', ['-C', request.repoRoot, ...request.args], {
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  });
}

export async function createDetachedRecordedWorktree(input) {
  if (!/^[0-9a-f]{40}$/u.test(input.commit)) {
    fail('KIMI_D9_WORKTREE_COMMIT_INVALID');
  }
  const repoRoot = await realpath(resolve(input.repoRoot)).catch(() =>
    fail('KIMI_D9_WORKTREE_REPO_MISSING'));
  const worktreePath = resolve(input.worktreePath);
  if (isWithinRoot(repoRoot, worktreePath)) {
    fail('KIMI_D9_WORKTREE_PATH_NOT_INDEPENDENT');
  }
  if (await lstat(worktreePath).catch(() => null)) {
    fail('KIMI_D9_WORKTREE_PATH_EXISTS');
  }
  await mkdir(dirname(worktreePath), { recursive: true, mode: 0o700 });
  const request = {
    repoRoot,
    args: ['worktree', 'add', '--detach', worktreePath, input.commit],
  };
  await (input.runGit ?? defaultRunGit)(request);
  const resolvedWorktreePath = await realpath(worktreePath).catch(() =>
    fail('KIMI_D9_WORKTREE_CREATION_FAILED'));
  const inspectWorktree = input.inspectWorktree ?? defaultInspectWorktree;
  const inspection = await inspectWorktree(resolvedWorktreePath);
  if (inspection.commit !== input.commit) {
    fail('KIMI_D9_CONSTRUCTION_COMMIT_MISMATCH');
  }
  if (inspection.dirty || (inspection.unexpectedGeneratedOutputs ?? []).length > 0) {
    fail('KIMI_D9_CONSTRUCTION_DIRTY_WORKTREE');
  }
  return {
    repoRoot,
    worktreePath: resolvedWorktreePath,
    commit: inspection.commit,
    clean: true,
  };
}

async function defaultRunStep(step, context) {
  const nodeExecutable = step === 'runtime-install'
    ? resolve(context.cwd, 'runtime', 'node', 'bin', 'node')
    : resolve(context.nodeDistributionRoot, 'bin', 'node');
  const npmCli = step === 'runtime-install'
    ? resolve(
      context.cwd,
      'runtime',
      'node',
      'lib',
      'node_modules',
      'npm',
      'bin',
      'npm-cli.js',
    )
    : resolve(
      context.nodeDistributionRoot,
      'lib',
      'node_modules',
      'npm',
      'bin',
      'npm-cli.js',
    );
  const argumentsByStep = {
    'build-install': [npmCli, 'ci'],
    'build-release': [npmCli, 'run', 'build:release'],
    'runtime-install': [npmCli, 'ci', '--omit=dev', '--include=optional'],
  };
  const args = argumentsByStep[step];
  if (!args) {
    fail('KIMI_D9_CONSTRUCTION_FORBIDDEN_OPERATION', step);
  }
  await execFileAsync(nodeExecutable, args, {
    cwd: context.cwd,
    encoding: 'utf8',
    env: context.environment,
    maxBuffer: 16 * 1024 * 1024,
  });
}

function pathAllowed(path, allowlist) {
  return allowlist.some((allowed) =>
    path === allowed || path.startsWith(`${allowed.replace(/\/+$/u, '')}/`));
}

async function copyRequiredPath(source, destination, code) {
  const metadata = await lstat(source).catch(() => null);
  if (!metadata) {
    fail(code, source);
  }
  await cp(source, destination, {
    recursive: metadata.isDirectory(),
    dereference: false,
    errorOnExist: true,
    force: false,
    preserveTimestamps: true,
    verbatimSymlinks: true,
  });
}

async function makeTreeReadOnly(path) {
  const metadata = await lstat(path);
  if (metadata.isSymbolicLink()) {
    return;
  }
  if (metadata.isDirectory()) {
    for (const child of await readdir(path)) {
      await makeTreeReadOnly(resolve(path, child));
    }
    await chmod(path, 0o555);
    return;
  }
  if (metadata.isFile()) {
    await chmod(path, metadata.mode & 0o111 ? 0o555 : 0o444);
    return;
  }
  fail('KIMI_D9_UNSUPPORTED_FILE_TYPE', path);
}

export async function constructCliRuntimeClosure(input) {
  if (!input.officialNodeArchive && input.allowSyntheticNodeRuntime !== true) {
    fail('KIMI_D9_NODE_ARCHIVE_ATTESTATION_REQUIRED');
  }
  const constructionParent = resolve(input.constructionParent);
  await mkdir(constructionParent, { recursive: true, mode: 0o700 });
  const markerPath = join(constructionParent, 'construction.started.json');
  try {
    await writeFile(markerPath, JSON.stringify({
      version: 'kimi-k3-d9-cli-construction-v1',
      expectedCommit: input.expectedCommit,
    }), { flag: 'wx', mode: 0o400 });
  } catch (error) {
    if (error?.code === 'EEXIST') {
      fail('KIMI_D9_CONSTRUCTION_ALREADY_STARTED');
    }
    throw error;
  }

  const inspectWorktree = input.inspectWorktree ?? defaultInspectWorktree;
  const runStep = input.runStep ?? defaultRunStep;
  const sourceWorktree = await realpath(resolve(input.sourceWorktree)).catch(() =>
    fail('KIMI_D9_CONSTRUCTION_SOURCE_MISSING'));
  const nodeDistributionRoot = await realpath(resolve(input.nodeDistributionRoot))
    .catch(() => fail('KIMI_D9_NODE_DISTRIBUTION_MISSING'));
  const guardSourcePath = await realpath(resolve(input.guardSourcePath)).catch(() =>
    fail('KIMI_D9_GUARD_SOURCE_MISSING'));

  if (input.officialNodeArchive) {
    await verifyOfficialNodeArchive(input.officialNodeArchive);
    if (!input.expectedNodeDistributionTreeDigest) {
      fail('KIMI_D9_NODE_DISTRIBUTION_ATTESTATION_REQUIRED');
    }
    await verifyOfficialNodeDistributionTree({
      distributionRoot: nodeDistributionRoot,
      expectedTreeDigest: input.expectedNodeDistributionTreeDigest,
    });
  }

  const before = await inspectWorktree(sourceWorktree);
  validateConstructionRecipe({
    expectedCommit: input.expectedCommit,
    actualCommit: before.commit,
    dirty: before.dirty,
    unexpectedGeneratedOutputs: before.unexpectedGeneratedOutputs ?? [],
    operations: REQUIRED_OPERATION_SEQUENCE,
  });

  const buildEnvironment = Object.freeze({
    HOME: input.buildHome ?? resolve(constructionParent, 'build-home'),
    PATH: `${resolve(nodeDistributionRoot, 'bin')}:/usr/bin:/bin`,
    NODE_OPTIONS: '',
    NODE_PATH: '',
    DYLD_LIBRARY_PATH: '',
    DYLD_FALLBACK_LIBRARY_PATH: '',
    DYLD_INSERT_LIBRARIES: '',
  });
  await runStep('build-install', {
    cwd: sourceWorktree,
    nodeDistributionRoot,
    environment: buildEnvironment,
  });
  await runStep('build-release', {
    cwd: sourceWorktree,
    nodeDistributionRoot,
    environment: buildEnvironment,
  });

  const afterBuild = await inspectWorktree(sourceWorktree);
  if (afterBuild.commit !== input.expectedCommit) {
    fail('KIMI_D9_CONSTRUCTION_COMMIT_MISMATCH');
  }
  const generatedAllowlist = input.generatedOutputAllowlist ?? [];
  const unexpected = [
    ...(afterBuild.unexpectedGeneratedOutputs ?? []),
    ...(afterBuild.statusPaths ?? []).filter((path) =>
      !pathAllowed(path, generatedAllowlist)),
  ];
  if (unexpected.length > 0) {
    fail('KIMI_D9_CONSTRUCTION_UNEXPECTED_GENERATED_OUTPUT', unexpected[0]);
  }

  const stagingRoot = await mkdtemp(join(constructionParent, '.staging-'));
  await mkdir(resolve(stagingRoot, 'runtime', 'guard'), { recursive: true });
  await mkdir(resolve(stagingRoot, 'runtime'), { recursive: true });
  await Promise.all([
    copyRequiredPath(
      resolve(sourceWorktree, 'dist'),
      resolve(stagingRoot, 'dist'),
      'KIMI_D9_REQUIRED_TREE_MISSING',
    ),
    copyRequiredPath(
      resolve(sourceWorktree, 'data'),
      resolve(stagingRoot, 'data'),
      'KIMI_D9_REQUIRED_TREE_MISSING',
    ),
    copyRequiredPath(
      resolve(sourceWorktree, 'package.json'),
      resolve(stagingRoot, 'package.json'),
      'KIMI_D9_PACKAGE_METADATA_MISSING',
    ),
    copyRequiredPath(
      resolve(sourceWorktree, 'package-lock.json'),
      resolve(stagingRoot, 'package-lock.json'),
      'KIMI_D9_PACKAGE_LOCK_MISSING',
    ),
    copyRequiredPath(
      nodeDistributionRoot,
      resolve(stagingRoot, 'runtime', 'node'),
      'KIMI_D9_NODE_DISTRIBUTION_MISSING',
    ),
    copyRequiredPath(
      guardSourcePath,
      resolve(stagingRoot, 'runtime', 'guard', 'runtime-guard.mjs'),
      'KIMI_D9_GUARD_SOURCE_MISSING',
    ),
  ]);
  await runStep('runtime-install', {
    cwd: stagingRoot,
    nodeDistributionRoot: resolve(stagingRoot, 'runtime', 'node'),
    environment: {
      ...buildEnvironment,
      HOME: input.runtimeHome ?? resolve(constructionParent, 'runtime-home'),
      PATH: `${resolve(stagingRoot, 'runtime', 'node', 'bin')}:/usr/bin:/bin`,
    },
  });

  await attestCliRuntimeClosure(stagingRoot);
  await makeTreeReadOnly(stagingRoot);
  const stagingAttestation = await attestCliRuntimeClosure(stagingRoot);
  const closurePath = resolve(
    constructionParent,
    `cli-closure-${stagingAttestation.closureDigest}`,
  );
  await rename(stagingRoot, closurePath).catch((error) => {
    if (error?.code === 'EEXIST') {
      fail('KIMI_D9_CONSTRUCTION_DUPLICATE_ARTIFACT');
    }
    throw error;
  });
  const attestation = await attestCliRuntimeClosure(closurePath);
  if (attestation.closureDigest !== stagingAttestation.closureDigest) {
    fail('KIMI_D9_CLOSURE_DIGEST_MISMATCH', 'post-rename');
  }
  return {
    closurePath,
    attestation,
    constructionCount: 1,
  };
}

async function inventoryDirectory(treeRoot, closureRoot) {
  const absoluteTreeRoot = resolve(treeRoot);
  const absoluteClosureRoot = await realpath(resolve(closureRoot)).catch(() =>
    fail('KIMI_D9_REQUIRED_TREE_MISSING', closureRoot));
  const entries = [];

  async function visit(absolutePath, relativePath) {
    const metadata = await lstat(absolutePath);
    const mode = metadata.mode & 0o7777;
    const normalizedPath = toPosix(relativePath);

    if (metadata.isSymbolicLink()) {
      const target = await readlink(absolutePath);
      let resolvedTarget;
      try {
        resolvedTarget = await realpath(absolutePath);
      } catch {
        fail('KIMI_D9_EXTERNAL_SYMLINK', normalizedPath);
      }
      if (!isWithinRoot(absoluteClosureRoot, resolvedTarget)) {
        fail('KIMI_D9_EXTERNAL_SYMLINK', normalizedPath);
      }
      entries.push({
        relativePath: normalizedPath,
        fileType: 'symlink',
        mode,
        target,
      });
      return;
    }

    if (metadata.isDirectory()) {
      if (relativePath !== '') {
        entries.push({ relativePath: normalizedPath, fileType: 'directory', mode });
      }
      const children = await readdir(absolutePath);
      children.sort((left, right) =>
        Buffer.from(left, 'utf8').compare(Buffer.from(right, 'utf8')));
      for (const child of children) {
        await visit(
          resolve(absolutePath, child),
          relativePath === '' ? child : `${relativePath}/${child}`,
        );
      }
      return;
    }

    if (metadata.isFile()) {
      if (metadata.nlink !== 1) {
        fail('KIMI_D9_HARD_LINK', normalizedPath);
      }
      entries.push({
        relativePath: normalizedPath,
        fileType: 'file',
        mode,
        contentSha256: sha256(await readFile(absolutePath)),
      });
      return;
    }

    fail('KIMI_D9_UNSUPPORTED_FILE_TYPE', normalizedPath);
  }

  const treeMetadata = await stat(absoluteTreeRoot).catch(() => null);
  if (!treeMetadata?.isDirectory()) {
    fail('KIMI_D9_REQUIRED_TREE_MISSING', absoluteTreeRoot);
  }
  await visit(absoluteTreeRoot, '');
  return entries;
}

export async function digestTree(treeRoot, options = {}) {
  const closureRoot = options.closureRoot ?? treeRoot;
  const entries = await inventoryDirectory(treeRoot, closureRoot);
  return {
    digest: sha256(canonicalBytes(entries)),
    entries,
  };
}

export async function verifyOfficialNodeDistributionTree(input) {
  const distributionRoot = await realpath(resolve(input.distributionRoot))
    .catch(() => fail('KIMI_D9_NODE_DISTRIBUTION_MISSING'));
  const actualTreeDigest = (await digestTree(distributionRoot, {
    closureRoot: distributionRoot,
  })).digest;
  if (actualTreeDigest !== input.expectedTreeDigest) {
    fail('KIMI_D9_NODE_DISTRIBUTION_TREE_MISMATCH', actualTreeDigest);
  }
  return {
    distributionRoot,
    expectedTreeDigest: input.expectedTreeDigest,
    actualTreeDigest,
  };
}

async function digestFile(path, code) {
  const metadata = await lstat(path).catch(() => null);
  if (!metadata?.isFile()) {
    fail(code, path);
  }
  if (metadata.nlink !== 1) {
    fail('KIMI_D9_HARD_LINK', path);
  }
  return sha256(await readFile(path));
}

export async function attestCliRuntimeClosure(closureRoot) {
  const root = await realpath(resolve(closureRoot)).catch(() =>
    fail('KIMI_D9_CLOSURE_MISSING', closureRoot));
  const paths = {
    dist: resolve(root, 'dist'),
    data: resolve(root, 'data'),
    nodeModules: resolve(root, 'node_modules'),
    nodeRuntime: resolve(root, 'runtime', 'node'),
    guard: resolve(root, 'runtime', 'guard'),
    packageJson: resolve(root, 'package.json'),
    packageLock: resolve(root, 'package-lock.json'),
  };

  const [
    dist,
    data,
    nodeModules,
    nodeRuntime,
    guard,
    packageJsonDigest,
    packageLockDigest,
  ] = await Promise.all([
    digestTree(paths.dist, { closureRoot: root }),
    digestTree(paths.data, { closureRoot: root }),
    digestTree(paths.nodeModules, { closureRoot: root }),
    digestTree(paths.nodeRuntime, { closureRoot: root }),
    digestTree(paths.guard, { closureRoot: root }),
    digestFile(paths.packageJson, 'KIMI_D9_PACKAGE_METADATA_MISSING'),
    digestFile(paths.packageLock, 'KIMI_D9_PACKAGE_LOCK_MISSING'),
  ]);

  const payload = {
    version: 'cli-runtime-closure-v1',
    distTreeDigest: dist.digest,
    dataTreeDigest: data.digest,
    packageJsonDigest,
    packageLockDigest,
    nodeModulesTreeDigest: nodeModules.digest,
    nodeRuntimeTreeDigest: nodeRuntime.digest,
    guardTreeDigest: guard.digest,
  };
  const rootMetadata = await stat(root);
  return {
    ...payload,
    closureDigest: sha256(canonicalBytes(payload)),
    physicalIdentity: {
      realpath: root,
      device: String(rootMetadata.dev),
      inode: String(rootMetadata.ino),
    },
  };
}

export async function verifyCliRuntimeClosure(closureRoot, expected) {
  const actual = await attestCliRuntimeClosure(closureRoot);
  for (const [field, value] of Object.entries(expected)) {
    if (actual[field] !== value) {
      fail('KIMI_D9_CLOSURE_DIGEST_MISMATCH', field);
    }
  }
  return actual;
}
