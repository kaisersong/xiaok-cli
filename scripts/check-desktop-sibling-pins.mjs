#!/usr/bin/env node
/**
 * Fail when desktop-cross-platform.yml and desktop-release.yml disagree on
 * sibling repo pins (kai-xiaok-plugins / kswarm / intent-broker).
 * Release file is the source of truth for the expected SHAs.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const REPOS = ['kai-xiaok-plugins', 'kswarm', 'intent-broker'];
const SHA_RE = /[0-9a-f]{40}/i;

function extractPins(workflowPath) {
  const text = readFileSync(workflowPath, 'utf8');
  const pins = {};
  for (const repo of REPOS) {
    // Match: clone .../<repo>.git ... then a nearby fetch ... origin <sha>
    const cloneRe = new RegExp(
      String.raw`git clone[^\n]*github\.com/kaisersong/${repo}\.git[^\n]*\n(?:[^\n]*\n){0,3}?[^\n]*fetch[^\n]* origin (${SHA_RE.source})`,
      'i',
    );
    const m = text.match(cloneRe);
    if (m) {
      pins[repo] = m[1].toLowerCase();
      continue;
    }
    // Unpinned shallow clone (no fetch SHA) — record as null
    const unpinned = new RegExp(
      String.raw`git clone[^\n]*github\.com/kaisersong/${repo}\.git`,
      'i',
    );
    if (unpinned.test(text)) {
      pins[repo] = null;
      continue;
    }
    pins[repo] = undefined;
  }
  return pins;
}

const releasePath = join(root, '.github/workflows/desktop-release.yml');
const crossPath = join(root, '.github/workflows/desktop-cross-platform.yml');
const releasePins = extractPins(releasePath);
const crossPins = extractPins(crossPath);

let failed = false;
for (const repo of REPOS) {
  const expected = releasePins[repo];
  const actual = crossPins[repo];
  if (!expected) {
    console.error(`[sibling-pins] desktop-release.yml missing pinned SHA for ${repo}`);
    failed = true;
    continue;
  }
  if (actual === undefined) {
    console.error(`[sibling-pins] desktop-cross-platform.yml missing clone for ${repo}`);
    failed = true;
    continue;
  }
  if (actual === null) {
    console.error(`[sibling-pins] desktop-cross-platform.yml clones ${repo} without a pinned SHA (release has ${expected})`);
    failed = true;
    continue;
  }
  if (actual !== expected) {
    console.error(`[sibling-pins] ${repo} pin drift: cross-platform=${actual} release=${expected}`);
    failed = true;
    continue;
  }
  console.log(`[sibling-pins] ${repo}=${expected}`);
}

if (failed) process.exit(1);
console.log('[sibling-pins] desktop-cross-platform.yml matches desktop-release.yml');
