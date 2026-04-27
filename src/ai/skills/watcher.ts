import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { getConfigDir } from '../../utils/config.js';
import { resolveSkillRoots, type SkillLoadOptions } from './loader.js';

export interface SkillCatalogWatcherOptions {
  cwd?: string;
  xiaokConfigDir?: string;
  options?: SkillLoadOptions;
  pollMs?: number;
  onChange: () => Promise<void> | void;
}

export interface SkillCatalogWatcher {
  close(): void;
}

function computeRootFingerprint(root: string): string[] {
  const resolvedRoot = resolve(root);
  if (!existsSync(resolvedRoot)) {
    return [`missing:${resolvedRoot}`];
  }

  const entries = readdirSync(resolvedRoot, { withFileTypes: true });
  const fingerprints: string[] = [`root:${resolvedRoot}`];

  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith('.md')) {
      const filePath = join(resolvedRoot, entry.name);
      const stat = statSync(filePath);
      fingerprints.push(`flat:${filePath}:${stat.mtimeMs}:${stat.size}`);
      continue;
    }

    if (!entry.isDirectory() && !entry.isSymbolicLink()) {
      continue;
    }

    const skillPath = join(resolvedRoot, entry.name, 'SKILL.md');
    if (!existsSync(skillPath)) {
      fingerprints.push(`dir:${join(resolvedRoot, entry.name)}:empty`);
      continue;
    }

    const stat = statSync(skillPath);
    fingerprints.push(`dir-skill:${skillPath}:${stat.mtimeMs}:${stat.size}`);
  }

  return fingerprints;
}

function computeCatalogFingerprint(options: SkillCatalogWatcherOptions): string {
  const roots = resolveSkillRoots(
    options.xiaokConfigDir ?? getConfigDir(),
    options.cwd ?? process.cwd(),
    options.options,
  );

  const parts = [
    ...roots.builtinRoots.flatMap((root) => computeRootFingerprint(root)),
    ...computeRootFingerprint(roots.globalSkillsDir),
    ...computeRootFingerprint(roots.projectSkillsDir),
  ];

  return parts.sort().join('|');
}

export function createSkillCatalogWatcher(options: SkillCatalogWatcherOptions): SkillCatalogWatcher {
  let closed = false;
  let fingerprint = computeCatalogFingerprint(options);
  let running = false;
  const pollMs = options.pollMs ?? 250;

  const interval = setInterval(() => {
    if (closed || running) {
      return;
    }

    running = true;
    try {
      const next = computeCatalogFingerprint(options);
      if (next !== fingerprint) {
        fingerprint = next;
        void Promise.resolve(options.onChange()).catch(() => {});
      }
    } finally {
      running = false;
    }
  }, pollMs);

  return {
    close() {
      if (closed) {
        return;
      }
      closed = true;
      clearInterval(interval);
    },
  };
}
