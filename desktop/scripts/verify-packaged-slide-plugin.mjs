#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';

const REQUIRED_ARGUMENTS = new Set(['--app', '--expected-count', '--expected-version']);

function parseArguments(argv) {
  const values = new Map();

  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];

    if (!REQUIRED_ARGUMENTS.has(flag)) {
      throw new Error(`Unknown argument: ${flag ?? '(missing)'}`);
    }
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`Missing value for ${flag}`);
    }
    if (values.has(flag)) {
      throw new Error(`Duplicate argument: ${flag}`);
    }

    values.set(flag, value);
  }

  for (const flag of REQUIRED_ARGUMENTS) {
    if (!values.has(flag)) {
      throw new Error(`Missing required argument: ${flag}`);
    }
  }

  const appPath = values.get('--app');
  const expectedCountText = values.get('--expected-count');
  const expectedVersion = values.get('--expected-version');

  if (!appPath || !path.isAbsolute(appPath)) {
    throw new Error('--app must be a non-empty absolute path');
  }
  if (!/^\d+$/.test(expectedCountText)) {
    throw new Error('--expected-count must be a non-negative integer');
  }

  const expectedCount = Number(expectedCountText);
  if (!Number.isSafeInteger(expectedCount)) {
    throw new Error('--expected-count must be a safe integer');
  }
  if (!expectedVersion.trim()) {
    throw new Error('--expected-version must be non-empty');
  }

  return { appPath, expectedCount, expectedVersion };
}

async function readJson(filePath, label) {
  let contents;
  try {
    contents = await readFile(filePath, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new Error(`Missing ${label}: ${filePath}`);
    }
    throw error;
  }

  try {
    return JSON.parse(contents);
  } catch (error) {
    throw new Error(`Invalid JSON in ${label}: ${error.message}`);
  }
}

async function resolveExistingPath(filePath, label) {
  try {
    const realPath = await realpath(filePath);
    return { realPath, pathStat: await stat(realPath) };
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new Error(`Missing ${label}: ${filePath}`);
    }
    throw error;
  }
}

function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function escapesRoot(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
}

function isSamePath(left, right) {
  return path.relative(left, right) === '';
}

async function readContainedJson(filePath, pluginRoot, label) {
  const { realPath, pathStat } = await resolveExistingPath(filePath, label);
  if (escapesRoot(pluginRoot, realPath)) {
    throw new Error(`Metadata file escapes packaged plugin root: ${label}`);
  }
  if (!pathStat.isFile()) {
    throw new Error(`Metadata file is not a regular file: ${label}`);
  }

  return readJson(realPath, label);
}

function assertSafeManifestPath(relativePath, pluginRoot) {
  if (typeof relativePath !== 'string' || !relativePath.trim() || relativePath.includes('\0')) {
    throw new Error(`Unsafe manifest path: ${JSON.stringify(relativePath)}`);
  }

  const posixNormalized = path.posix.normalize(relativePath);
  const win32Normalized = path.win32.normalize(relativePath);
  const hasParentTraversal = (
    posixNormalized === '..'
    || posixNormalized.startsWith('../')
    || win32Normalized === '..'
    || win32Normalized.startsWith('..\\')
  );

  if (
    path.isAbsolute(relativePath)
    || path.posix.isAbsolute(relativePath)
    || path.win32.parse(relativePath).root !== ''
    || hasParentTraversal
  ) {
    throw new Error(`Unsafe manifest path: ${JSON.stringify(relativePath)}`);
  }

  const resolvedPath = path.resolve(pluginRoot, relativePath);
  if (escapesRoot(pluginRoot, resolvedPath)) {
    throw new Error(`Unsafe manifest path: ${JSON.stringify(relativePath)}`);
  }

  return resolvedPath;
}

async function readManifestFile(pluginRoot, relativePath) {
  const resolvedPath = assertSafeManifestPath(relativePath, pluginRoot);

  let realFilePath;
  try {
    realFilePath = await realpath(resolvedPath);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new Error(`Missing manifest file: ${relativePath}`);
    }
    throw error;
  }

  if (escapesRoot(pluginRoot, realFilePath)) {
    throw new Error(`Unsafe manifest path (symlink escape): ${JSON.stringify(relativePath)}`);
  }

  const fileStat = await stat(realFilePath);
  if (!fileStat.isFile()) {
    throw new Error(`Manifest entry is not a file: ${relativePath}`);
  }

  return readFile(realFilePath);
}

async function verify() {
  const { appPath, expectedCount, expectedVersion } = parseArguments(process.argv.slice(2));
  const { realPath: realAppPath, pathStat: appStat } = await resolveExistingPath(
    appPath,
    'packaged app',
  );
  if (!appStat.isDirectory()) {
    throw new Error(`Packaged app is not a directory: ${appPath}`);
  }

  const bundledPluginsPath = path.join(
    realAppPath,
    'Contents',
    'Resources',
    'bundled-plugins',
  );
  const {
    realPath: realBundledPluginsRoot,
    pathStat: bundledPluginsStat,
  } = await resolveExistingPath(bundledPluginsPath, 'bundled-plugins root');
  if (!bundledPluginsStat.isDirectory()) {
    throw new Error(`Bundled-plugins root is not a directory: ${bundledPluginsPath}`);
  }
  if (
    isSamePath(realAppPath, realBundledPluginsRoot)
    || escapesRoot(realAppPath, realBundledPluginsRoot)
  ) {
    throw new Error('Bundled-plugins root escapes packaged app');
  }

  const pluginPath = path.join(realBundledPluginsRoot, 'kai-slide-creator');
  const { realPath: pluginRoot, pathStat: pluginStat } = await resolveExistingPath(
    pluginPath,
    'packaged plugin root',
  );
  if (!pluginStat.isDirectory()) {
    throw new Error(`Packaged plugin root is not a directory: ${pluginPath}`);
  }
  if (
    isSamePath(realBundledPluginsRoot, pluginRoot)
    || escapesRoot(realBundledPluginsRoot, pluginRoot)
  ) {
    throw new Error('Packaged plugin root escapes bundled-plugins');
  }

  const plugin = await readContainedJson(
    path.join(pluginRoot, 'plugin.json'),
    pluginRoot,
    'plugin.json',
  );
  const manifest = await readContainedJson(
    path.join(pluginRoot, 'vendor-manifest.json'),
    pluginRoot,
    'vendor-manifest.json',
  );

  if (!isObject(plugin) || typeof plugin.version !== 'string') {
    throw new Error('plugin.json version must be a string');
  }
  if (plugin.version !== expectedVersion) {
    throw new Error(`Plugin version mismatch: expected ${expectedVersion}, found ${plugin.version}`);
  }
  if (!isObject(manifest) || !isObject(manifest.files)) {
    throw new Error('Manifest files must be an object');
  }

  const entries = Object.entries(manifest.files);
  if (entries.length !== expectedCount) {
    throw new Error(`Manifest file count mismatch: expected ${expectedCount}, found ${entries.length}`);
  }

  for (const [relativePath, expectedHash] of entries) {
    if (typeof expectedHash !== 'string' || !/^[a-f\d]{64}$/i.test(expectedHash)) {
      throw new Error(`Invalid SHA-256 for manifest entry: ${relativePath}`);
    }

    const contents = await readManifestFile(pluginRoot, relativePath);
    const actualHash = createHash('sha256').update(contents).digest('hex');
    if (actualHash !== expectedHash.toLowerCase()) {
      throw new Error(`SHA-256 mismatch for manifest entry: ${relativePath}`);
    }
  }

  process.stdout.write(`${JSON.stringify({
    verified: entries.length,
    expected: expectedCount,
    version: plugin.version,
  })}\n`);
}

verify().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`verify-packaged-slide-plugin: ${message}\n`);
  process.exitCode = 1;
});
