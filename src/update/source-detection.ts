import { dirname, resolve } from 'node:path';
import type { DetectInstallSourceDeps, InstallSource } from './types.js';

export async function detectInstallSource(
  deps: DetectInstallSourceDeps,
): Promise<InstallSource> {
  const resolvedBin = await deps.realpath(deps.argv0);
  const repoRoot = resolve(dirname(resolvedBin), '..');

  if (
    resolvedBin.endsWith('/dist/index.js')
    && await deps.pathExists(resolve(repoRoot, '.git'))
  ) {
    if (resolve(deps.argv0) !== resolvedBin) {
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
  if (resolvedBin.startsWith(resolve(npmRoot, 'xiaokcode'))) {
    return {
      kind: 'npm_global',
      packageRoot: resolve(npmRoot, 'xiaokcode'),
      binPath: resolvedBin,
    };
  }

  return {
    kind: 'unsupported',
    reason: 'Unsupported install source. Please update manually.',
    binPath: resolvedBin,
  };
}
