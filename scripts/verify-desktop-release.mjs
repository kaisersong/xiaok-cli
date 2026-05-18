#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const tag = process.argv[2];
const repo = process.env.GITHUB_REPOSITORY || 'kaisersong/xiaok-cli';

function fail(message) {
  console.error(`[desktop-release] ${message}`);
  process.exit(1);
}

function gh(args) {
  return execFileSync('gh', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function parseMetadataYaml(filePath) {
  const text = readFileSync(filePath, 'utf8');
  const version = text.match(/^version:\s*['"]?([^'"\n]+)['"]?/m)?.[1]?.trim();
  const urls = [...text.matchAll(/^\s*-\s+url:\s*['"]?([^'"\n]+)['"]?/gm)].map((match) => match[1].trim());
  return { version, urls };
}

function assertAsset(assets, name) {
  if (!assets.has(name)) fail(`missing release asset: ${name}`);
}

if (!tag) {
  fail('usage: node scripts/verify-desktop-release.mjs desktop-v<version>');
}

const version = tag.match(/^desktop-v(.+)$/)?.[1];
if (!version) {
  fail(`desktop release tag must look like desktop-v<version>, got: ${tag}`);
}

const release = JSON.parse(gh([
  'release',
  'view',
  tag,
  '--repo',
  repo,
  '--json',
  'tagName,name,isDraft,isPrerelease,assets,publishedAt,url',
]));

if (release.tagName !== tag) fail(`release tag mismatch: expected ${tag}, got ${release.tagName}`);
if (release.isDraft) fail(`${tag} is still a draft`);
if (release.isPrerelease) fail(`${tag} is marked prerelease`);

const assets = new Set(release.assets.map((asset) => asset.name));
const requiredAssets = [
  'latest-mac.yml',
  'latest.yml',
  `xiaok-${version}-arm64-mac.zip`,
  `xiaok-${version}-arm64.dmg`,
  `xiaok-setup-${version}.exe`,
];

for (const asset of requiredAssets) {
  assertAsset(assets, asset);
}

const releases = JSON.parse(gh([
  'release',
  'list',
  '--repo',
  repo,
  '--limit',
  '50',
  '--json',
  'tagName,isLatest,isDraft,isPrerelease',
]));
const current = releases.find((item) => item.tagName === tag);
if (!current) fail(`${tag} was not returned by gh release list`);
if (!current.isLatest) fail(`${tag} is not marked as the GitHub Latest release`);

const workDir = mkdtempSync(join(tmpdir(), 'xiaok-desktop-release-'));
try {
  for (const metadataName of ['latest-mac.yml', 'latest.yml']) {
    gh([
      'release',
      'download',
      tag,
      '--repo',
      repo,
      '--pattern',
      metadataName,
      '--dir',
      workDir,
      '--clobber',
    ]);

    const metadataPath = join(workDir, metadataName);
    if (!existsSync(metadataPath)) fail(`failed to download ${metadataName}`);
    const metadata = parseMetadataYaml(metadataPath);
    if (metadata.version !== version) {
      fail(`${metadataName} version mismatch: expected ${version}, got ${metadata.version || 'missing'}`);
    }
    if (metadata.urls.length === 0) fail(`${metadataName} does not reference any update files`);
    for (const url of metadata.urls) {
      const assetName = url.split('/').pop();
      if (!assetName || !assets.has(assetName)) {
        fail(`${metadataName} references missing release asset: ${url}`);
      }
    }
  }
} finally {
  rmSync(workDir, { recursive: true, force: true });
}

console.log(`[desktop-release] verified ${tag} (${release.url})`);
