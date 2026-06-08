import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

function findRepoRoot(startDir: string): string | null {
  let current = resolve(startDir);
  while (true) {
    if (existsSync(join(current, 'package.json')) && existsSync(join(current, 'desktop', 'electron-builder.json'))) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function getDevelopmentServiceRoots(
  startDir: string,
  serviceName: 'kswarm' | 'intent-broker',
  cwd: string = process.cwd(),
  homeDir: string = process.env.HOME || process.env.USERPROFILE || '',
): string[] {
  const candidates = new Set<string>();
  const repoRoot = findRepoRoot(startDir) ?? findRepoRoot(cwd);
  if (repoRoot) {
    candidates.add(resolve(repoRoot, '..', serviceName));
    candidates.add(resolve(repoRoot, serviceName));
  }
  if (cwd) {
    candidates.add(resolve(cwd, '..', serviceName));
  }
  if (homeDir) {
    candidates.add(resolve(homeDir, 'projects', serviceName));
  }
  return Array.from(candidates);
}

export function getDevelopmentServiceCandidates(
  startDir: string,
  serviceName: 'kswarm' | 'intent-broker',
  entryRelative: string,
  cwd: string = process.cwd(),
  homeDir: string = process.env.HOME || process.env.USERPROFILE || '',
): string[] {
  const candidates = new Set<string>();
  for (const root of getDevelopmentServiceRoots(startDir, serviceName, cwd, homeDir)) {
    candidates.add(resolve(root, entryRelative));
  }
  return Array.from(candidates);
}

export interface ServiceLaunchSpec {
  cwd: string;
  entryPath: string;
  nodeArgs: string[];
  repoRoot?: string;
}

export function getDevelopmentBrokerLaunchSpec(
  startDir: string,
  cwd: string = process.cwd(),
  homeDir: string = process.env.HOME || process.env.USERPROFILE || '',
): ServiceLaunchSpec | null {
  for (const root of getDevelopmentServiceRoots(startDir, 'intent-broker', cwd, homeDir)) {
    const entryPath = resolve(root, 'src', 'cli.js');
    if (!existsSync(entryPath)) continue;
    return {
      cwd: root,
      entryPath,
      nodeArgs: ['--experimental-sqlite', entryPath],
    };
  }
  return null;
}
