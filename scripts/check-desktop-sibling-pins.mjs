#!/usr/bin/env node
/**
 * Fail when desktop-cross-platform.yml and desktop-release.yml disagree on
 * sibling repo pins (kai-xiaok-plugins / kswarm / intent-broker).
 *
 * Release file is the source of truth for the expected SHAs. Every clone of
 * each repo in BOTH files is checked (matchAll) — a drifted second block in
 * build-windows must fail, not just the first clone in build-mac.
 *
 * Usage:
 *   node scripts/check-desktop-sibling-pins.mjs
 *   node scripts/check-desktop-sibling-pins.mjs --release <path> --cross <path>
 *   node scripts/check-desktop-sibling-pins.mjs --root <dir>
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const REPOS = ['kai-xiaok-plugins', 'kswarm', 'intent-broker'];
const SHA_RE = /[0-9a-f]{40}/i;

/**
 * For a clone match, look at the next few lines for a same-repo fetch pin.
 * Stops at the next `git clone` so a following repo's fetch cannot bleed in.
 */
function pinAfterClone(after, repo) {
  const nextLines = after.replace(/^\r?\n/, '').split(/\r?\n/).slice(0, 3);
  for (const line of nextLines) {
    if (/git\s+clone\b/i.test(line)) break;
    if (!line.toLowerCase().includes(repo.toLowerCase())) continue;
    const m = line.match(new RegExp(String.raw`fetch[^\n]*\sorigin\s+(${SHA_RE.source})`, 'i'));
    if (m) return m[1].toLowerCase();
  }
  return null;
}

/**
 * Collect every clone of each sibling repo: pinned SHA or null if unpinned.
 * Uses matchAll so a second job block cannot hide drift.
 */
export function extractAllPins(workflowPath) {
  const text = readFileSync(workflowPath, 'utf8');
  const pins = {};
  for (const repo of REPOS) {
    const occurrences = [];
    const cloneRe = new RegExp(
      String.raw`git clone[^\n]*github\.com/kaisersong/${repo}\.git[^\n]*`,
      'gi',
    );
    for (const m of text.matchAll(cloneRe)) {
      occurrences.push(pinAfterClone(text.slice(m.index + m[0].length), repo));
    }
    pins[repo] = occurrences;
  }
  return pins;
}

export function checkSiblingPins(releasePath, crossPath) {
  const releasePins = extractAllPins(releasePath);
  const crossPins = extractAllPins(crossPath);
  let failed = false;

  for (const repo of REPOS) {
    const releaseList = releasePins[repo] ?? [];
    const crossList = crossPins[repo] ?? [];

    if (releaseList.length === 0) {
      console.error(`[sibling-pins] desktop-release.yml missing clone for ${repo}`);
      failed = true;
      continue;
    }
    if (releaseList.some((p) => p === null)) {
      console.error(`[sibling-pins] desktop-release.yml clones ${repo} without a pinned SHA`);
      failed = true;
      continue;
    }
    const uniqueRelease = [...new Set(releaseList)];
    if (uniqueRelease.length !== 1) {
      console.error(
        `[sibling-pins] desktop-release.yml internal pin drift for ${repo}: ${releaseList.join(', ')}`,
      );
      failed = true;
      continue;
    }
    const expected = uniqueRelease[0];

    if (crossList.length === 0) {
      console.error(`[sibling-pins] desktop-cross-platform.yml missing clone for ${repo}`);
      failed = true;
      continue;
    }

    let repoFailed = false;
    for (let i = 0; i < crossList.length; i++) {
      const actual = crossList[i];
      if (actual === null) {
        console.error(
          `[sibling-pins] desktop-cross-platform.yml clones ${repo} without a pinned SHA (occurrence ${i + 1}; release has ${expected})`,
        );
        failed = true;
        repoFailed = true;
        continue;
      }
      if (actual !== expected) {
        console.error(
          `[sibling-pins] ${repo} pin drift at cross-platform occurrence ${i + 1}: cross-platform=${actual} release=${expected}`,
        );
        failed = true;
        repoFailed = true;
      }
    }
    if (!repoFailed) {
      console.log(`[sibling-pins] ${repo}=${expected} (release×${releaseList.length}, cross×${crossList.length})`);
    }
  }

  return failed;
}

function parseArgs(argv) {
  let releasePath = join(root, '.github/workflows/desktop-release.yml');
  let crossPath = join(root, '.github/workflows/desktop-cross-platform.yml');
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--release') {
      releasePath = argv[++i];
    } else if (arg === '--cross') {
      crossPath = argv[++i];
    } else if (arg === '--root') {
      const base = argv[++i];
      releasePath = join(base, '.github/workflows/desktop-release.yml');
      crossPath = join(base, '.github/workflows/desktop-cross-platform.yml');
    } else if (arg.startsWith('--release=')) {
      releasePath = arg.slice('--release='.length);
    } else if (arg.startsWith('--cross=')) {
      crossPath = arg.slice('--cross='.length);
    } else if (arg.startsWith('--root=')) {
      const base = arg.slice('--root='.length);
      releasePath = join(base, '.github/workflows/desktop-release.yml');
      crossPath = join(base, '.github/workflows/desktop-cross-platform.yml');
    }
  }
  return { releasePath, crossPath };
}

function main(argv = process.argv) {
  const { releasePath, crossPath } = parseArgs(argv);
  const failed = checkSiblingPins(releasePath, crossPath);
  if (failed) process.exit(1);
  console.log('[sibling-pins] desktop-cross-platform.yml matches desktop-release.yml');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
