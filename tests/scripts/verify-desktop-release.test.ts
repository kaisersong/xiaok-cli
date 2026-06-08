import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const {
  buildVerificationReport,
  parseMetadataYaml,
} = await import(pathToFileURL(join(process.cwd(), 'scripts/verify-desktop-release.mjs')).href);

describe('parseMetadataYaml', () => {
  it('extracts version and referenced update files', () => {
    expect(parseMetadataYaml([
      'version: 1.4.1',
      'files:',
      '  - url: xiaok-1.4.1-arm64-mac.zip',
      '  - url: xiaok-1.4.1-arm64.dmg',
    ].join('\n'))).toEqual({
      version: '1.4.1',
      urls: ['xiaok-1.4.1-arm64-mac.zip', 'xiaok-1.4.1-arm64.dmg'],
    });
  });
});

describe('buildVerificationReport', () => {
  const release = {
    tagName: 'desktop-v1.4.1',
    isDraft: true,
    isPrerelease: false,
    url: 'https://github.com/kaisersong/xiaok-cli/releases/tag/desktop-v1.4.1',
    assets: [
      { name: 'latest-mac.yml' },
      { name: 'latest.yml' },
      { name: 'xiaok-1.4.1-arm64-mac.zip' },
      { name: 'xiaok-1.4.1-arm64.dmg' },
      { name: 'xiaok-setup-1.4.1.exe' },
    ],
  };

  it('allows draft releases during pre-publish verification', () => {
    const report = buildVerificationReport({
      tag: 'desktop-v1.4.1',
      release,
      latestRelease: null,
      metadata: {
        'latest-mac.yml': {
          version: '1.4.1',
          urls: ['xiaok-1.4.1-arm64-mac.zip', 'xiaok-1.4.1-arm64.dmg'],
        },
        'latest.yml': {
          version: '1.4.1',
          urls: ['xiaok-setup-1.4.1.exe'],
        },
      },
      requirePublished: false,
      requireLatest: false,
    });

    expect(report.ok).toBe(true);
    expect(report.errors).toEqual([]);
  });

  it('requires published latest status after release publication', () => {
    const report = buildVerificationReport({
      tag: 'desktop-v1.4.1',
      release: { ...release, isDraft: false },
      latestRelease: { tagName: 'desktop-v1.4.0' },
      metadata: {
        'latest-mac.yml': {
          version: '1.4.1',
          urls: ['xiaok-1.4.1-arm64-mac.zip', 'xiaok-1.4.1-arm64.dmg'],
        },
        'latest.yml': {
          version: '1.4.1',
          urls: ['xiaok-setup-1.4.1.exe'],
        },
      },
      requirePublished: true,
      requireLatest: true,
    });

    expect(report.ok).toBe(false);
    expect(report.errors).toContain('desktop-v1.4.1 is not marked as the GitHub Latest release');
  });
});
