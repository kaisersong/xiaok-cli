#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

const DEFAULT_REPO = 'kaisersong/xiaok-cli';
const METADATA_ASSETS = ['latest-mac.yml', 'latest.yml'];

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

function getVersionFromTag(tag) {
  return tag.match(/^desktop-v(.+)$/)?.[1] ?? null;
}

function getRequiredAssets(version) {
  return [
    'latest-mac.yml',
    'latest.yml',
    `xiaok-${version}-arm64-mac.zip`,
    `xiaok-${version}-arm64.dmg`,
    `xiaok-setup-${version}.exe`,
  ];
}

function assetNameFromUrl(url) {
  const lastSegment = url.split('/').pop()?.split('?')[0];
  return lastSegment ? decodeURIComponent(lastSegment) : '';
}

export function parseMetadataYaml(text) {
  const version = text.match(/^version:\s*['"]?([^'"\n]+)['"]?/m)?.[1]?.trim();
  const urls = [...text.matchAll(/^\s*-\s+url:\s*['"]?([^'"\n]+)['"]?/gm)].map((match) => match[1].trim());
  return { version, urls };
}

export function buildVerificationReport({
  tag,
  release,
  latestRelease,
  metadata,
  requirePublished = true,
  requireLatest = true,
}) {
  const errors = [];
  const version = getVersionFromTag(tag);

  if (!version) {
    errors.push(`desktop release tag must look like desktop-v<version>, got: ${tag}`);
  }
  if (!release) {
    errors.push(`release not found: ${tag}`);
    return { ok: false, errors, version };
  }
  if (release.tagName !== tag) {
    errors.push(`release tag mismatch: expected ${tag}, got ${release.tagName}`);
  }
  if (requirePublished && release.isDraft) {
    errors.push(`${tag} is still a draft`);
  }
  if (release.isPrerelease) {
    errors.push(`${tag} is marked prerelease`);
  }

  const assets = new Set((release.assets ?? []).map((asset) => asset.name));
  if (version) {
    for (const asset of getRequiredAssets(version)) {
      if (!assets.has(asset)) errors.push(`missing release asset: ${asset}`);
    }
  }

  if (requireLatest) {
    if (!latestRelease?.tagName) {
      errors.push(`could not resolve the GitHub Latest release for ${tag}`);
    } else if (latestRelease.tagName !== tag) {
      errors.push(`${tag} is not marked as the GitHub Latest release`);
    }
  }

  if (version) {
    for (const metadataName of METADATA_ASSETS) {
      const parsed = metadata?.[metadataName];
      if (!parsed) {
        errors.push(`missing downloaded metadata: ${metadataName}`);
        continue;
      }
      if (parsed.version !== version) {
        errors.push(`${metadataName} version mismatch: expected ${version}, got ${parsed.version || 'missing'}`);
      }
      if (parsed.urls.length === 0) {
        errors.push(`${metadataName} does not reference any update files`);
      }
      for (const url of parsed.urls) {
        const assetName = assetNameFromUrl(url);
        if (!assetName || !assets.has(assetName)) {
          errors.push(`${metadataName} references missing release asset: ${url}`);
        }
      }
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    version,
  };
}

function parseArgs(argv) {
  let tag = null;
  let requirePublished = true;
  let requireLatest = true;

  for (const arg of argv) {
    if (arg === '--prepublish') {
      requirePublished = false;
      requireLatest = false;
    } else if (arg === '--allow-draft') {
      requirePublished = false;
    } else if (!tag) {
      tag = arg;
    } else {
      fail(`unknown argument: ${arg}`);
    }
  }

  if (!tag) {
    fail('usage: node scripts/verify-desktop-release.mjs desktop-v<version> [--prepublish|--allow-draft]');
  }

  return { tag, requirePublished, requireLatest };
}

function downloadMetadata(tag, repo, release) {
  const assets = new Set((release.assets ?? []).map((asset) => asset.name));
  const workDir = mkdtempSync(join(tmpdir(), 'xiaok-desktop-release-'));
  const metadata = {};

  try {
    for (const metadataName of METADATA_ASSETS) {
      if (!assets.has(metadataName)) continue;
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
      if (!existsSync(metadataPath)) continue;
      metadata[metadataName] = parseMetadataYaml(readFileSync(metadataPath, 'utf8'));
    }
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }

  return metadata;
}

function getRelease(tag, repo) {
  return JSON.parse(gh([
    'release',
    'view',
    tag,
    '--repo',
    repo,
    '--json',
    'tagName,name,isDraft,isPrerelease,assets,publishedAt,url',
  ]));
}

function getLatestRelease(repo) {
  return JSON.parse(gh([
    'release',
    'view',
    '--repo',
    repo,
    '--json',
    'tagName',
  ]));
}

function main(argv = process.argv.slice(2)) {
  const { tag, requirePublished, requireLatest } = parseArgs(argv);
  const repo = process.env.GITHUB_REPOSITORY || DEFAULT_REPO;
  const release = getRelease(tag, repo);
  const latestRelease = requireLatest ? getLatestRelease(repo) : null;
  const metadata = downloadMetadata(tag, repo, release);
  const report = buildVerificationReport({
    tag,
    release,
    latestRelease,
    metadata,
    requirePublished,
    requireLatest,
  });

  if (!report.ok) {
    for (const error of report.errors) {
      console.error(`[desktop-release] ${error}`);
    }
    process.exit(1);
  }

  const phase = requireLatest ? 'published' : 'prepublish';
  console.log(`[desktop-release] verified ${phase} ${tag} (${release.url})`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
