#!/usr/bin/env node
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
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
