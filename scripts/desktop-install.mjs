#!/usr/bin/env node
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const desktopPackage = JSON.parse(await readFile(join(repoRoot, 'desktop', 'package.json'), 'utf8'));

if (process.platform === 'darwin') {
  installMac();
} else if (process.platform === 'win32') {
  installWindows(desktopPackage.version);
} else {
  console.error(`Unsupported desktop install platform: ${process.platform}`);
  process.exit(1);
}

function installMac() {
  const sourceAppPath = join(repoRoot, 'desktop', 'release', 'mac-arm64', 'xiaok.app');
  const installDir = join(process.env.HOME ?? '', 'Applications');
  const targetAppPath = join(installDir, 'xiaok.app');
  const legacyTargetAppPath = join(installDir, 'xiaok Desktop.app');

  if (!existsSync(sourceAppPath)) {
    console.error(`Desktop app is not packaged: ${sourceAppPath}`);
    console.error('Run: npm run desktop:pack');
    process.exit(1);
  }

  mkdirSync(installDir, { recursive: true });

  if (existsSync(targetAppPath)) {
    rmSync(targetAppPath, { recursive: true, force: true });
  }

  const copied = spawnSync('/usr/bin/ditto', [sourceAppPath, targetAppPath], {
    cwd: repoRoot,
    stdio: 'inherit',
  });
  if (copied.status !== 0) {
    process.exit(copied.status ?? 1);
  }

  if (existsSync(legacyTargetAppPath)) {
    rmSync(legacyTargetAppPath, { recursive: true, force: true });
  }

  console.log(`Installed xiaok to ${targetAppPath}`);
}

function installWindows(version) {
  const releaseDir = join(repoRoot, 'desktop', 'release');
  const installerPath = join(releaseDir, `xiaok-setup-${version}.exe`);
  const localAppData = process.env.LOCALAPPDATA;

  if (!existsSync(installerPath)) {
    console.error(`Desktop installer is not packaged: ${installerPath}`);
    console.error('Run: npm run desktop:pack');
    process.exit(1);
  }

  if (!localAppData) {
    console.error('LOCALAPPDATA is not set; cannot resolve the Windows install directory.');
    process.exit(1);
  }

  const installedExePath = join(localAppData, 'Programs', 'xiaok', 'xiaok.exe');
  const installed = spawnSync(installerPath, ['/CURRENTUSER', '/S'], {
    cwd: repoRoot,
    stdio: 'inherit',
  });
  if (installed.status !== 0) {
    process.exit(installed.status ?? 1);
  }

  if (!existsSync(installedExePath)) {
    console.error(`Windows install completed without an installed executable: ${installedExePath}`);
    process.exit(1);
  }

  console.log(`Installed xiaok to ${installedExePath}`);
}
