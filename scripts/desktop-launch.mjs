#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const localAppPath = join(repoRoot, 'desktop', 'release', 'mac-arm64', 'xiaok.app');
const installedAppPath = join(process.env.HOME ?? '', 'Applications', 'xiaok.app');
const appPath = existsSync(installedAppPath) ? installedAppPath : localAppPath;

if (!existsSync(appPath)) {
  const pack = spawnSync('npm', ['run', 'desktop:pack'], {
    cwd: repoRoot,
    stdio: 'inherit',
  });
  if (pack.status !== 0) {
    process.exit(pack.status ?? 1);
  }
}

const launchTarget = existsSync(installedAppPath) ? installedAppPath : localAppPath;
const executablePath = join(launchTarget, 'Contents', 'MacOS', 'xiaok');

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
