#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const platform = process.platform;

function getLocalBundlePath(currentPlatform) {
  if (currentPlatform === 'darwin') {
    return join(repoRoot, 'desktop', 'release', 'mac-arm64', 'xiaok.app');
  }
  if (currentPlatform === 'win32') {
    return join(repoRoot, 'desktop', 'release', 'win-unpacked');
  }
  if (currentPlatform === 'linux') {
    return join(repoRoot, 'desktop', 'release', 'linux-unpacked');
  }
  throw new Error(`Unsupported desktop platform: ${currentPlatform}`);
}

function getInstalledBundlePath(currentPlatform) {
  if (currentPlatform === 'darwin') {
    return join(process.env.HOME ?? '', 'Applications', 'xiaok.app');
  }
  return null;
}

function getExecutablePath(bundlePath, currentPlatform) {
  if (currentPlatform === 'darwin') {
    return join(bundlePath, 'Contents', 'MacOS', 'xiaok');
  }
  if (currentPlatform === 'win32') {
    return join(bundlePath, 'xiaok.exe');
  }
  if (currentPlatform === 'linux') {
    return join(bundlePath, 'xiaok');
  }
  throw new Error(`Unsupported desktop platform: ${currentPlatform}`);
}

function resolveLaunchBundlePath(currentPlatform) {
  const installedPath = getInstalledBundlePath(currentPlatform);
  if (installedPath && existsSync(installedPath)) {
    return installedPath;
  }
  return getLocalBundlePath(currentPlatform);
}

let launchTarget = resolveLaunchBundlePath(platform);
let executablePath = getExecutablePath(launchTarget, platform);

if (!existsSync(executablePath)) {
  const pack = spawnSync('npm', ['run', 'desktop:pack:dir'], {
    cwd: repoRoot,
    stdio: 'inherit',
  });
  if (pack.status !== 0) {
    process.exit(pack.status ?? 1);
  }
  launchTarget = getLocalBundlePath(platform);
  executablePath = getExecutablePath(launchTarget, platform);
}

if (!existsSync(executablePath)) {
  console.error(`xiaok desktop executable not found: ${executablePath}`);
  process.exit(1);
}

const opened = spawn(executablePath, [], {
  cwd: repoRoot,
  detached: true,
  stdio: 'ignore',
});
opened.unref();

process.exit(0);
