import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

interface LockPackage {
  version?: string;
  deprecated?: string;
}

interface PackageLock {
  packages?: Record<string, LockPackage>;
}

interface ProjectPackage {
  allowScripts?: Record<string, boolean>;
  dependencies?: Record<string, string>;
}

interface DeprecatedNode {
  path: string;
  version: string;
  message: string;
}

function readDeprecatedNodes(lockPath: string): DeprecatedNode[] {
  const lock = JSON.parse(readFileSync(lockPath, 'utf8')) as PackageLock;
  return Object.entries(lock.packages ?? {})
    .filter((entry): entry is [string, Required<LockPackage>] => (
      typeof entry[1].version === 'string' && typeof entry[1].deprecated === 'string'
    ))
    .map(([path, pkg]) => ({
      path,
      version: pkg.version,
      message: pkg.deprecated,
    }))
    .sort((left, right) => left.path.localeCompare(right.path));
}

const allowedDesktopUpstreamDeprecations = new Map([
  ['node_modules/boolean', '3.2.0'],
  ['node_modules/glob', '7.2.3'],
  ['node_modules/inflight', '1.0.6'],
  ['node_modules/lodash.isequal', '4.5.0'],
  ['node_modules/rimraf', '2.6.3'],
]);

describe('deprecated npm dependency contract', () => {
  it('keeps the root CLI lockfile free of deprecated packages', () => {
    const deprecated = readDeprecatedNodes(join(process.cwd(), 'package-lock.json'));

    expect(deprecated).toEqual([]);
  });

  it('allows only the reviewed stable Electron toolchain exceptions in desktop', () => {
    const deprecated = readDeprecatedNodes(join(process.cwd(), 'desktop', 'package-lock.json'));
    const unexpected = deprecated.filter((entry) => (
      allowedDesktopUpstreamDeprecations.get(entry.path) !== entry.version
    ));
    const actualAllowed = deprecated
      .filter((entry) => allowedDesktopUpstreamDeprecations.get(entry.path) === entry.version)
      .map(({ path, version }) => [path, version]);

    expect(unexpected).toEqual([]);
    expect(actualAllowed).toEqual([...allowedDesktopUpstreamDeprecations.entries()]);
  });

  it('pins the reviewed npm 12 install-script approvals in both projects', () => {
    const rootPackage = JSON.parse(
      readFileSync(join(process.cwd(), 'package.json'), 'utf8'),
    ) as ProjectPackage;
    const desktopPackage = JSON.parse(
      readFileSync(join(process.cwd(), 'desktop', 'package.json'), 'utf8'),
    ) as ProjectPackage;

    expect(rootPackage.allowScripts).toEqual({
      'better-sqlite3@13.0.3': true,
      'esbuild@0.27.4': true,
      'fsevents@2.3.3': true,
      'nodejieba@3.5.8': true,
      'onnxruntime-node@1.26.0': true,
    });
    expect(desktopPackage.allowScripts).toEqual({
      'better-sqlite3@13.0.3': true,
      'electron@39.8.10': true,
      'electron-winstaller@5.4.0': true,
      'esbuild@0.27.7': true,
      'fsevents@2.3.2': true,
      'fsevents@2.3.3': true,
      'msgpackr-extract@3.0.4': true,
      'nodejieba@3.5.8': true,
    });
    expect(desktopPackage.dependencies?.['electron-updater']).toBe('^6.8.9');
  });
});
