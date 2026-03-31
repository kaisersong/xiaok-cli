#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { lstatSync } from 'node:fs';
import { basename } from 'node:path';

function collectForbiddenDocsPaths(paths) {
  return paths
    .map((entry) => entry.replaceAll('\\', '/'))
    .filter((entry) => entry.startsWith('docs/'));
}

function getStagedPaths() {
  const output = execFileSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACMR'], {
    encoding: 'utf8',
  });
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function ensureDocsIsSymlink() {
  const stats = lstatSync('docs');
  if (!stats.isSymbolicLink()) {
    throw new Error('docs must be a symlink to the sibling mydocs repository');
  }
}

function main() {
  if (process.env.SKIP_EXTERNAL_DOCS_CHECK === '1') {
    process.exit(0);
  }

  ensureDocsIsSymlink();
  const violations = collectForbiddenDocsPaths(getStagedPaths());
  if (violations.length === 0) {
    process.exit(0);
  }

  const repoName = basename(process.cwd());
  process.stderr.write(
    [
      `[docs-policy] Do not commit docs content in ${repoName}.`,
      `[docs-policy] Commit the real files under ../mydocs/${repoName} instead.`,
      '[docs-policy] Blocked paths:',
      ...violations.map((entry) => `  - ${entry}`),
    ].join('\n') + '\n',
  );
  process.exit(1);
}

try {
  main();
} catch (error) {
  process.stderr.write(`[docs-policy] ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
