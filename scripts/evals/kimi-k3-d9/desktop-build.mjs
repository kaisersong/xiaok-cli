import { spawn } from 'node:child_process';
import { lstat, realpath } from 'node:fs/promises';
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from 'node:path';
import { canonicalize } from './canonical.mjs';

const DESKTOP_REPOS = Object.freeze([
  'xiaok-cli',
  'kswarm',
  'intent-broker',
  'kai-xiaok-plugins',
]);
const PAIRED_SIBLING_REPOS = Object.freeze([
  'kswarm',
  'intent-broker',
  'kai-xiaok-plugins',
]);
const SOURCE_ENTRY_KEYS = Object.freeze([
  'repositoryIdentity',
  'commit',
  'clean',
  'statusByteCount',
  'lockfileDigest',
  'generatedOutputDigest',
  'packedInputTreeDigest',
]);
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const COMMIT_PATTERN = /^[0-9a-f]{40}$/u;

function fail(code) {
  throw new Error(code);
}

function isPlainObject(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value, expected) {
  if (!isPlainObject(value)) return false;
  const keys = Object.keys(value);
  return keys.length === expected.length
    && keys.every(key => expected.includes(key));
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

function validRepositoryIdentity(value) {
  return typeof value === 'string'
    && value.length > 0
    && !value.includes('://')
    && !value.includes('@')
    && !/[?#]/u.test(value);
}

export function validateDesktopSourceCommitMap(sourceCommitMap) {
  if (!hasExactKeys(sourceCommitMap, DESKTOP_REPOS)) {
    fail('KIMI_D9_DESKTOP_SOURCE_COMMIT_MAP_INVALID');
  }
  for (const repo of DESKTOP_REPOS) {
    const entry = sourceCommitMap[repo];
    if (
      !hasExactKeys(entry, SOURCE_ENTRY_KEYS)
      || !validRepositoryIdentity(entry.repositoryIdentity)
      || !COMMIT_PATTERN.test(entry.commit)
      || entry.clean !== true
      || entry.statusByteCount !== 0
      || !SHA256_PATTERN.test(entry.lockfileDigest)
      || !SHA256_PATTERN.test(entry.generatedOutputDigest)
      || !SHA256_PATTERN.test(entry.packedInputTreeDigest)
    ) {
      fail('KIMI_D9_DESKTOP_SOURCE_COMMIT_MAP_INVALID');
    }
  }
  return true;
}

export function validatePairedDesktopSourceCommitMaps(
  baselineSourceCommitMap,
  candidateSourceCommitMap,
) {
  validateDesktopSourceCommitMap(baselineSourceCommitMap);
  validateDesktopSourceCommitMap(candidateSourceCommitMap);
  for (const repo of PAIRED_SIBLING_REPOS) {
    if (
      canonicalize(baselineSourceCommitMap[repo])
      !== canonicalize(candidateSourceCommitMap[repo])
    ) {
      fail('KIMI_D9_DESKTOP_SIBLING_PROVENANCE_MISMATCH');
    }
  }
  return true;
}

export function createDesktopBuildPlan({
  arm,
  layoutRoot,
  xiaokCliRoot,
  artifactPath,
  sourceCommitMap,
}) {
  validateDesktopSourceCommitMap(sourceCommitMap);
  const appPath = resolve(artifactPath);
  const artifactOutputDirectory = dirname(appPath);
  const outputRoot = dirname(artifactOutputDirectory);
  if (
    !['baseline', 'candidate'].includes(arm)
    || !isAbsolute(layoutRoot)
    || !isAbsolute(xiaokCliRoot)
    || !isAbsolute(artifactPath)
    || !isWithin(layoutRoot, xiaokCliRoot)
    || resolve(xiaokCliRoot) !== join(resolve(layoutRoot), 'xiaok-cli')
    || !artifactPath.endsWith('.app')
    || !/^mac(?:-[a-z0-9_-]+)?$/u.test(basename(artifactOutputDirectory))
    || isWithin(resolve(xiaokCliRoot), artifactPath)
  ) {
    fail('KIMI_D9_DESKTOP_BUILD_LAYOUT_INVALID');
  }
  const packagingCwd = join(resolve(xiaokCliRoot), 'desktop');
  return deepFreeze({
    schemaVersion: 1,
    arm,
    surface: 'desktop',
    layoutRoot: resolve(layoutRoot),
    xiaokCliRoot: resolve(xiaokCliRoot),
    packagingCwd,
    outputRoot,
    artifactPath: appPath,
    executablePath: join(appPath, 'Contents', 'MacOS', 'xiaok'),
    sourceCommitMap: structuredClone(sourceCommitMap),
    command: {
      executable: process.execPath,
      args: [
        join(
          packagingCwd,
          'node_modules',
          'electron-builder',
          'out',
          'cli',
          'cli.js',
        ),
        '--dir',
        '--config',
        join(packagingCwd, 'electron-builder.json'),
        `-c.directories.output=${outputRoot}`,
        '-c.mac.identity=null',
        '-c.win.signAndEditExecutable=false',
      ],
      env: {
        CSC_IDENTITY_AUTO_DISCOVERY: 'false',
        LANG: 'C.UTF-8',
      },
    },
  });
}

export function createDesktopBuildLedger() {
  const constructed = new Set();
  return Object.freeze({
    reserve(plan) {
      const key = `${plan?.arm}:${plan?.surface}`;
      if (
        !['baseline:desktop', 'candidate:desktop'].includes(key)
        || typeof plan.artifactPath !== 'string'
      ) {
        fail('KIMI_D9_DESKTOP_BUILD_PLAN_INVALID');
      }
      if (constructed.has(key)) {
        fail('KIMI_D9_DESKTOP_ARTIFACT_ALREADY_CONSTRUCTED');
      }
      constructed.add(key);
      return Object.freeze({
        artifactPath: plan.artifactPath,
        constructionCompletionCount: 1,
      });
    },
  });
}

export async function runDesktopBuildOnce({
  plan,
  ledger,
  spawnImpl = spawn,
}) {
  const reservation = ledger.reserve(plan);
  await new Promise((resolvePromise, rejectPromise) => {
    const child = spawnImpl(plan.command.executable, plan.command.args, {
      cwd: plan.packagingCwd,
      env: plan.command.env,
      stdio: 'inherit',
      shell: false,
    });
    child.once('error', rejectPromise);
    child.once('exit', (code, signal) => {
      if (code === 0 && signal === null) {
        resolvePromise();
      } else {
        rejectPromise(new Error('KIMI_D9_DESKTOP_BUILD_FAILED'));
      }
    });
  });
  const artifactStat = await lstat(plan.artifactPath).catch(() => null);
  if (
    !artifactStat?.isDirectory()
    || !isWithin(plan.outputRoot, await realpath(plan.artifactPath))
  ) {
    fail('KIMI_D9_DESKTOP_BUILD_FAILED');
  }
  return reservation;
}
