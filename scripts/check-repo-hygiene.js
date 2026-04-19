import { execFileSync } from 'node:child_process';
import { dirname } from 'node:path';
import { realpathSync } from 'node:fs';

const NOISE_PREFIXES = [
  '.DS_Store',
  '.test-cache/',
  '.test-dist/',
  '.xiaok/state/',
  '.xiaok-test/',
];

function runGit(args, cwd) {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim();
}

function runOptional(command, args) {
  try {
    return execFileSync(command, args, { encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

export function parseStatusPorcelain(output) {
  return output
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line && !line.startsWith('##'))
    .map((line) => ({
      code: line.slice(0, 2),
      path: line.slice(3).split(' -> ').at(-1) ?? '',
    }));
}

function isNoisePath(path) {
  return NOISE_PREFIXES.some((prefix) => path === prefix || path.startsWith(prefix));
}

export function evaluateRepoHealth({
  repoRoot,
  branch,
  ahead,
  behind,
  entries,
  globalXiaokTarget,
}) {
  const issues = [];
  const warnings = [];
  const noiseEntries = entries.map((entry) => entry.path).filter(isNoisePath);
  const trackedWorkEntries = entries
    .filter((entry) => entry.code !== '??' && !isNoisePath(entry.path))
    .map((entry) => entry.path);
  const untrackedWorkEntries = entries
    .filter((entry) => entry.code === '??' && !isNoisePath(entry.path))
    .map((entry) => entry.path);

  if (branch === 'master') {
    if (behind > 0) issues.push(`master is behind origin/master by ${behind} commit(s)`);
    if (ahead > 0) issues.push(`master is ahead of origin/master by ${ahead} commit(s)`);
    if (trackedWorkEntries.length > 0) issues.push('master has tracked working tree changes');
    if (untrackedWorkEntries.length > 0) {
      issues.push(`master has untracked work items: ${untrackedWorkEntries.join(', ')}`);
    }
    if (globalXiaokTarget && globalXiaokTarget !== repoRoot) {
      warnings.push(`global xiaok points to ${globalXiaokTarget} instead of ${repoRoot}`);
    }
  } else {
    if (behind > 0) warnings.push(`${branch} is behind origin/master by ${behind} commit(s)`);
    if (trackedWorkEntries.length > 0 || untrackedWorkEntries.length > 0) {
      warnings.push(`${branch} has active worktree changes`);
    }
  }

  if (noiseEntries.length > 0) {
    warnings.push(`runtime noise detected: ${noiseEntries.join(', ')}`);
  }

  return {
    ok: issues.length === 0,
    issues,
    warnings,
  };
}

function getGlobalXiaokTarget() {
  const xiaokPath = runOptional(process.platform === 'win32' ? 'where' : 'which', ['xiaok']);
  if (!xiaokPath) return '';
  const firstPath = xiaokPath.split(/\r?\n/).find(Boolean);
  if (!firstPath) return '';
  try {
    const resolvedBin = realpathSync(firstPath);
    return dirname(dirname(resolvedBin));
  } catch {
    return '';
  }
}

export function main() {
  const repoRoot = runGit(['rev-parse', '--show-toplevel'], process.cwd());
  const branch = runGit(['branch', '--show-current'], repoRoot);
  const entries = parseStatusPorcelain(runGit(['status', '--short', '--branch'], repoRoot));
  const [aheadText, behindText] = runGit(
    ['rev-list', '--left-right', '--count', 'HEAD...origin/master'],
    repoRoot,
  ).split(/\s+/);
  const report = evaluateRepoHealth({
    repoRoot,
    branch,
    ahead: Number(aheadText || 0),
    behind: Number(behindText || 0),
    entries,
    globalXiaokTarget: getGlobalXiaokTarget(),
  });

  const lines = [
    `[repo-hygiene] repo: ${repoRoot}`,
    `[repo-hygiene] branch: ${branch}`,
  ];

  if (report.issues.length === 0) {
    lines.push('[repo-hygiene] blocking issues: none');
  } else {
    lines.push('[repo-hygiene] blocking issues:');
    for (const issue of report.issues) lines.push(`  - ${issue}`);
  }

  if (report.warnings.length > 0) {
    lines.push('[repo-hygiene] warnings:');
    for (const warning of report.warnings) lines.push(`  - ${warning}`);
  }

  lines.push('[repo-hygiene] cadence: run this at start, midday, and before finishing work.');
  lines.push('[repo-hygiene] rule: keep master clean; do feature work in .worktrees/<branch>.');
  process.stdout.write(lines.join('\n') + '\n');
  process.exit(report.ok ? 0 : 1);
}
