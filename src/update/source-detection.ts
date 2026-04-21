import type { DetectInstallSourceDeps, InstallSource } from './types.js';

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/\/+/g, '/');
}

function stripDistEntry(path: string): string | null {
  const normalized = normalizePath(path);
  if (!normalized.endsWith('/dist/index.js')) {
    return null;
  }
  return normalized.slice(0, -'/dist/index.js'.length);
}

export async function detectInstallSource(
  deps: DetectInstallSourceDeps,
): Promise<InstallSource> {
  const resolvedBin = await deps.realpath(deps.argv0);
  const normalizedArgv0 = normalizePath(deps.argv0);
  const normalizedBin = normalizePath(resolvedBin);
  const repoRoot = stripDistEntry(resolvedBin);

  if (
    repoRoot
    && await deps.pathExists(`${repoRoot}/.git`)
  ) {
    if (normalizedArgv0 !== normalizedBin) {
      return {
        kind: 'npm_link',
        repoRoot,
        binPath: resolvedBin,
      };
    }

    return {
      kind: 'git_repo',
      repoRoot,
      binPath: resolvedBin,
    };
  }

  const npmRoot = await deps.npmRootGlobal();
  const packageRoot = `${normalizePath(npmRoot)}/xiaokcode`;
  if (normalizedBin === packageRoot || normalizedBin.startsWith(`${packageRoot}/`)) {
    return {
      kind: 'npm_global',
      packageRoot,
      binPath: resolvedBin,
    };
  }

  return {
    kind: 'unsupported',
    reason: 'Unsupported install source. Please update manually.',
    binPath: resolvedBin,
  };
}
