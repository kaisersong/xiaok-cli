import { createHash } from 'node:crypto';
import {
  cp,
  lstat,
  mkdir,
  readFile,
  realpath,
  writeFile,
} from 'node:fs/promises';
import {
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from 'node:path';
import { digestTree } from './tree-digest.mjs';

const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const FIXTURE_MODULE_RELATIVE_PATH =
  'scripts/evals/kimi-k3-d9/fixture-server.mjs';
const SERVER_RELATIVE_PATH = 'fixture-server-entry.mjs';
const CANONICAL_RELATIVE_PATH =
  'dist/ai/runtime/canonical-json.js';
const GUARD_RELATIVE_PATH = 'fixture-runtime-guard.mjs';
const SDK_PACKAGE_RELATIVE_PATH =
  'node_modules/@modelcontextprotocol/sdk';
const ZOD_PACKAGE_RELATIVE_PATH = 'node_modules/zod';
const RUNTIME_KEYS = Object.freeze([
  'schemaVersion',
  'runtimeRoot',
  'nodeExecutable',
  'serverEntryPath',
  'guardPath',
  'sdkPackageRoot',
  'zodPackageRoot',
  'treeDigest',
  'nodeExecutableDigest',
]);

function fail(code) {
  throw new Error(code);
}

function deepFreeze(value) {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function isWithin(root, child) {
  const path = relative(resolve(root), resolve(child));
  return path === ''
    || (!path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path));
}

async function pathType(path) {
  const stat = await lstat(path).catch(() => null);
  if (stat?.isFile()) return 'file';
  if (stat?.isDirectory()) return 'directory';
  return null;
}

async function sha256File(path) {
  return createHash('sha256').update(await readFile(path)).digest('hex');
}

function packagePath(root, packageName) {
  return join(root, ...packageName.split('/'));
}

async function resolveInstalledPackage({
  dependencyName,
  fromPackageRoot,
  sourceRoot,
}) {
  let current = resolve(fromPackageRoot);
  const boundary = resolve(sourceRoot);
  while (isWithin(boundary, current)) {
    const candidate = packagePath(
      join(current, 'node_modules'),
      dependencyName,
    );
    if (await pathType(join(candidate, 'package.json')) === 'file') {
      return candidate;
    }
    if (current === boundary) break;
    current = dirname(current);
  }
  return null;
}

async function copyPackageClosure({
  sourceRoot,
  runtimeRoot,
  seedPackageNames,
}) {
  const physicalSourceRoot = await realpath(sourceRoot);
  const sourceNodeModules = join(sourceRoot, 'node_modules');
  const queue = [];
  for (const packageName of seedPackageNames) {
    const sourcePackageRoot = packagePath(sourceNodeModules, packageName);
    if (await pathType(join(sourcePackageRoot, 'package.json')) !== 'file') {
      fail('KIMI_D9_DESKTOP_FIXTURE_RUNTIME_INPUT_INVALID');
    }
    queue.push(sourcePackageRoot);
  }

  const copied = new Set();
  while (queue.length > 0) {
    const sourcePackageRoot = queue.shift();
    const sourceRealPath = await realpath(sourcePackageRoot);
    if (!isWithin(physicalSourceRoot, sourceRealPath)) {
      fail('KIMI_D9_DESKTOP_FIXTURE_RUNTIME_INPUT_INVALID');
    }
    const packageRelativePath = relative(sourceRoot, sourcePackageRoot);
    if (copied.has(packageRelativePath)) continue;

    const packageJson = JSON.parse(await readFile(
      join(sourcePackageRoot, 'package.json'),
      'utf8',
    ));
    if (
      typeof packageJson.name !== 'string'
      || packageJson.name.length === 0
    ) {
      fail('KIMI_D9_DESKTOP_FIXTURE_RUNTIME_INPUT_INVALID');
    }
    const destination = join(runtimeRoot, packageRelativePath);
    await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
    await cp(sourcePackageRoot, destination, {
      recursive: true,
      force: false,
      errorOnExist: true,
      dereference: true,
      preserveTimestamps: false,
      filter: sourcePath => {
        const packagePath = relative(sourcePackageRoot, sourcePath);
        return packagePath === ''
          || (
            packagePath !== 'node_modules'
            && !packagePath.startsWith(`node_modules${sep}`)
          );
      },
    });
    copied.add(packageRelativePath);

    const dependencyNames = new Set([
      ...Object.keys(packageJson.dependencies ?? {}),
      ...Object.keys(packageJson.optionalDependencies ?? {}),
      ...Object.keys(packageJson.peerDependencies ?? {}),
    ]);
    for (const dependencyName of dependencyNames) {
      const dependencyRoot = await resolveInstalledPackage({
        dependencyName,
        fromPackageRoot: sourcePackageRoot,
        sourceRoot,
      });
      if (dependencyRoot) queue.push(dependencyRoot);
      else if (
        Object.hasOwn(packageJson.dependencies ?? {}, dependencyName)
        || (
          Object.hasOwn(packageJson.peerDependencies ?? {}, dependencyName)
          && packageJson.peerDependenciesMeta?.[dependencyName]?.optional
            !== true
        )
      ) {
        fail('KIMI_D9_DESKTOP_FIXTURE_RUNTIME_INPUT_INVALID');
      }
    }
  }
}

function guardSource() {
  return [
    "import { registerHooks } from 'node:module';",
    "import { realpathSync } from 'node:fs';",
    "import { fileURLToPath } from 'node:url';",
    "import { isAbsolute, relative, resolve, sep } from 'node:path';",
    '',
    'const configuredRoot = process.env.KIMI_D9_FIXTURE_RUNTIME_ROOT;',
    'if (!configuredRoot || !isAbsolute(configuredRoot)) {',
    "  throw new Error('KIMI_D9_FIXTURE_RUNTIME_ROOT_INVALID');",
    '}',
    'const runtimeRoot = realpathSync(configuredRoot);',
    'function inside(path) {',
    '  const rel = relative(runtimeRoot, resolve(path));',
    "  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));",
    '}',
    'registerHooks({',
    '  resolve(specifier, context, nextResolve) {',
    '    const result = nextResolve(specifier, context);',
    "    if (result.url.startsWith('node:')) return result;",
    "    if (!result.url.startsWith('file:')) {",
    "      throw new Error('KIMI_D9_FIXTURE_RUNTIME_ESCAPE');",
    '    }',
    '    const path = realpathSync(fileURLToPath(result.url));',
    '    if (!inside(path)) {',
    "      throw new Error('KIMI_D9_FIXTURE_RUNTIME_ESCAPE');",
    '    }',
    '    return result;',
    '  },',
    '});',
    '',
  ].join('\n');
}

function serverEntrySource() {
  return [
    "import { runStdioFixtureServerFromEnvironment } from './scripts/evals/kimi-k3-d9/fixture-server.mjs';",
    '',
    'runStdioFixtureServerFromEnvironment().catch(() => {',
    "  process.stderr.write('KIMI_D9_FIXTURE_SERVER_FAILED\\n');",
    '  process.exitCode = 1;',
    '});',
    '',
  ].join('\n');
}

export async function materializeFrozenDesktopFixtureRuntime({
  sourceRoot,
  runtimeRoot,
  nodeExecutable,
}) {
  if (
    !isAbsolute(sourceRoot)
    || !isAbsolute(runtimeRoot)
    || !isAbsolute(nodeExecutable)
    || resolve(sourceRoot) === resolve(runtimeRoot)
    || isWithin(sourceRoot, runtimeRoot)
    || isWithin(runtimeRoot, sourceRoot)
    || await pathType(sourceRoot) !== 'directory'
    || await pathType(nodeExecutable) !== 'file'
    || await lstat(runtimeRoot).catch(() => null)
  ) {
    fail('KIMI_D9_DESKTOP_FIXTURE_RUNTIME_INPUT_INVALID');
  }

  const sourceServer = join(sourceRoot, FIXTURE_MODULE_RELATIVE_PATH);
  const sourceCanonical = join(sourceRoot, CANONICAL_RELATIVE_PATH);
  if (
    await pathType(sourceServer) !== 'file'
    || await pathType(sourceCanonical) !== 'file'
  ) {
    fail('KIMI_D9_DESKTOP_FIXTURE_RUNTIME_INPUT_INVALID');
  }

  await mkdir(runtimeRoot, { recursive: false, mode: 0o700 });
  const serverEntryPath = join(runtimeRoot, SERVER_RELATIVE_PATH);
  const fixtureModulePath = join(
    runtimeRoot,
    FIXTURE_MODULE_RELATIVE_PATH,
  );
  const canonicalPath = join(runtimeRoot, CANONICAL_RELATIVE_PATH);
  const guardPath = join(runtimeRoot, GUARD_RELATIVE_PATH);
  await mkdir(dirname(fixtureModulePath), { recursive: true, mode: 0o700 });
  await mkdir(dirname(canonicalPath), { recursive: true, mode: 0o700 });
  await cp(sourceServer, fixtureModulePath, {
    force: false,
    errorOnExist: true,
    dereference: true,
  });
  await cp(sourceCanonical, canonicalPath, {
    force: false,
    errorOnExist: true,
    dereference: true,
  });
  await copyPackageClosure({
    sourceRoot,
    runtimeRoot,
    seedPackageNames: ['@modelcontextprotocol/sdk', 'zod'],
  });
  await writeFile(serverEntryPath, serverEntrySource(), {
    encoding: 'utf8',
    flag: 'wx',
    mode: 0o600,
  });
  await writeFile(guardPath, guardSource(), {
    encoding: 'utf8',
    flag: 'wx',
    mode: 0o600,
  });

  const tree = await digestTree(runtimeRoot);
  const runtime = deepFreeze({
    schemaVersion: 1,
    runtimeRoot: resolve(runtimeRoot),
    nodeExecutable: resolve(nodeExecutable),
    serverEntryPath,
    guardPath,
    sdkPackageRoot: join(runtimeRoot, SDK_PACKAGE_RELATIVE_PATH),
    zodPackageRoot: join(runtimeRoot, ZOD_PACKAGE_RELATIVE_PATH),
    treeDigest: tree.digest,
    nodeExecutableDigest: await sha256File(nodeExecutable),
  });
  await attestFrozenDesktopFixtureRuntime(runtime);
  return runtime;
}

export async function attestFrozenDesktopFixtureRuntime(runtime) {
  const keys = runtime && typeof runtime === 'object'
    ? Object.keys(runtime)
    : [];
  if (
    keys.length !== RUNTIME_KEYS.length
    || RUNTIME_KEYS.some(key => !keys.includes(key))
    || runtime.schemaVersion !== 1
    || !isAbsolute(runtime.runtimeRoot)
    || !isAbsolute(runtime.nodeExecutable)
    || runtime.serverEntryPath
      !== join(runtime.runtimeRoot, SERVER_RELATIVE_PATH)
    || runtime.guardPath !== join(runtime.runtimeRoot, GUARD_RELATIVE_PATH)
    || runtime.sdkPackageRoot
      !== join(runtime.runtimeRoot, SDK_PACKAGE_RELATIVE_PATH)
    || runtime.zodPackageRoot
      !== join(runtime.runtimeRoot, ZOD_PACKAGE_RELATIVE_PATH)
    || !SHA256_PATTERN.test(runtime.treeDigest)
    || !SHA256_PATTERN.test(runtime.nodeExecutableDigest)
  ) {
    fail('KIMI_D9_DESKTOP_FIXTURE_RUNTIME_DRIFT');
  }

  const requiredTypes = await Promise.all([
    pathType(runtime.runtimeRoot),
    pathType(runtime.nodeExecutable),
    pathType(runtime.serverEntryPath),
    pathType(runtime.guardPath),
    pathType(join(runtime.sdkPackageRoot, 'package.json')),
    pathType(join(runtime.zodPackageRoot, 'package.json')),
  ]);
  if (
    requiredTypes[0] !== 'directory'
    || requiredTypes[1] !== 'file'
    || requiredTypes.slice(2).some(type => type !== 'file')
    || !isWithin(
      await realpath(runtime.runtimeRoot),
      await realpath(runtime.serverEntryPath),
    )
    || !isWithin(
      await realpath(runtime.runtimeRoot),
      await realpath(runtime.guardPath),
    )
  ) {
    fail('KIMI_D9_DESKTOP_FIXTURE_RUNTIME_DRIFT');
  }

  const [sdkPackage, zodPackage, tree, executableDigest] =
    await Promise.all([
      readFile(join(runtime.sdkPackageRoot, 'package.json'), 'utf8')
        .then(JSON.parse),
      readFile(join(runtime.zodPackageRoot, 'package.json'), 'utf8')
        .then(JSON.parse),
      digestTree(runtime.runtimeRoot),
      sha256File(runtime.nodeExecutable),
    ]);
  if (
    sdkPackage.name !== '@modelcontextprotocol/sdk'
    || zodPackage.name !== 'zod'
    || tree.entries.some(entry => entry.fileType === 'symlink')
    || tree.digest !== runtime.treeDigest
    || executableDigest !== runtime.nodeExecutableDigest
  ) {
    fail('KIMI_D9_DESKTOP_FIXTURE_RUNTIME_DRIFT');
  }
  return true;
}
