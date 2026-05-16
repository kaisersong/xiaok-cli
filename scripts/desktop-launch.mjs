#!/usr/bin/env node
import { existsSync, mkdirSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const platform = process.platform;
const isCodexShell = process.env.CODEX_SHELL === '1';

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

function getDevElectronPath(currentPlatform) {
  if (currentPlatform === 'darwin') {
    return join(repoRoot, 'desktop', 'node_modules', 'electron', 'dist', 'Electron.app', 'Contents', 'MacOS', 'Electron');
  }
  if (currentPlatform === 'win32') {
    return join(repoRoot, 'desktop', 'node_modules', 'electron', 'dist', 'electron.exe');
  }
  if (currentPlatform === 'linux') {
    return join(repoRoot, 'desktop', 'node_modules', 'electron', 'dist', 'electron');
  }
  throw new Error(`Unsupported desktop platform: ${currentPlatform}`);
}

function buildCodexRuntimeEnv(baseEnv) {
  if (!isCodexShell) {
    return { ...baseEnv };
  }

  const runtimeRoot = join(repoRoot, '.codex-desktop-runtime');
  const roamingDir = join(runtimeRoot, 'Roaming');
  const localDir = join(runtimeRoot, 'Local');
  const homeDir = join(runtimeRoot, 'Home');
  mkdirSync(roamingDir, { recursive: true });
  mkdirSync(localDir, { recursive: true });
  mkdirSync(homeDir, { recursive: true });

  return {
    ...baseEnv,
    APPDATA: roamingDir,
    LOCALAPPDATA: localDir,
    USERPROFILE: homeDir,
    HOME: homeDir,
    XIAOK_DESKTOP_DISABLE_SINGLE_INSTANCE: '1',
  };
}

function ensureDesktopBuild() {
  const mainEntry = join(repoRoot, 'desktop', 'dist', 'main', 'desktop', 'electron', 'main.js');
  const rendererEntry = join(repoRoot, 'desktop', 'dist', 'renderer', 'index.html');
  if (existsSync(mainEntry) && existsSync(rendererEntry)) {
    return;
  }

  const build = spawnSync('npm', ['run', 'build', '--prefix', 'desktop'], {
    cwd: repoRoot,
    stdio: 'inherit',
  });
  if (build.status !== 0) {
    process.exit(build.status ?? 1);
  }
}

function resolveLaunchBundlePath(currentPlatform) {
  const installedPath = getInstalledBundlePath(currentPlatform);
  if (installedPath && existsSync(installedPath)) {
    return installedPath;
  }
  return getLocalBundlePath(currentPlatform);
}

if (isCodexShell) {
  ensureDesktopBuild();

  const electronPath = getDevElectronPath(platform);
  if (!existsSync(electronPath)) {
    console.error(`electron runtime not found: ${electronPath}`);
    process.exit(1);
  }

  const opened = spawn(electronPath, ['.'], {
    cwd: join(repoRoot, 'desktop'),
    env: buildCodexRuntimeEnv(process.env),
    detached: true,
    stdio: 'ignore',
  });
  opened.unref();
  process.exit(0);
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
  env: buildCodexRuntimeEnv(process.env),
  detached: true,
  stdio: 'ignore',
});
opened.unref();

process.exit(0);
