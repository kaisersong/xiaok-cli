import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const verifierPath = join(__dirname, '..', '..', 'scripts', 'verify-packaged-slide-plugin.mjs');

function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

describe('packaged slide plugin verifier', () => {
  let rootDir: string;
  let appPath: string;
  let pluginRoot: string;

  beforeEach(() => {
    rootDir = mkdtempSync(join(tmpdir(), 'xiaok-packaged-slide-verifier-'));
    appPath = join(rootDir, 'xiaok.app');
    pluginRoot = join(
      appPath,
      'Contents',
      'Resources',
      'bundled-plugins',
      'kai-slide-creator',
    );
  });

  afterEach(() => {
    rmSync(rootDir, { recursive: true, force: true, maxRetries: 3 });
  });

  function writeFixture(options: {
    version?: unknown;
    contents?: Record<string, string>;
    files?: unknown;
  } = {}, targetRoot = pluginRoot): void {
    const contents = options.contents ?? {};
    mkdirSync(targetRoot, { recursive: true });

    for (const [relativePath, content] of Object.entries(contents)) {
      const target = join(targetRoot, relativePath);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, content);
    }

    const files = options.files ?? Object.fromEntries(
      Object.entries(contents).map(([relativePath, content]) => [relativePath, sha256(content)]),
    );

    writeFileSync(
      join(targetRoot, 'plugin.json'),
      JSON.stringify({ name: 'kai-slide-creator', version: options.version ?? '3.2.1' }),
    );
    writeFileSync(
      join(targetRoot, 'vendor-manifest.json'),
      JSON.stringify({ version: 1, files }),
    );
  }

  function runVerifierWithArguments(args: string[]) {
    return spawnSync(process.execPath, [verifierPath, ...args], { encoding: 'utf8' });
  }

  function runVerifier(expectedCount = 2, expectedVersion = '3.2.1') {
    return runVerifierWithArguments([
      '--app',
      appPath,
      '--expected-count',
      String(expectedCount),
      '--expected-version',
      expectedVersion,
    ]);
  }

  it('verifies every manifest file and prints a machine-readable summary', () => {
    writeFixture({
      contents: {
        'themes/kingdee/reference.md': '# Kingdee',
        'demos/data-story-en.html': '<html>deck</html>',
      },
    });

    const result = runVerifier();

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout)).toEqual({
      verified: 2,
      expected: 2,
      version: '3.2.1',
    });
  });

  it('rejects a manifest whose files field is not an object', () => {
    writeFixture({ files: [] });

    const result = runVerifier(0);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/manifest files must be an object/i);
  });

  it('rejects a manifest file count that differs from the expected count', () => {
    writeFixture({ contents: { 'themes/kingdee/reference.md': '# Kingdee' } });

    const result = runVerifier(2);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/file count mismatch.*expected 2.*found 1/i);
  });

  it('rejects a plugin version that differs from the expected version', () => {
    writeFixture({ version: '3.2.0', contents: {} });

    const result = runVerifier(0);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/version mismatch.*expected 3\.2\.1.*found 3\.2\.0/i);
  });

  it('rejects a manifest entry whose file is missing', () => {
    writeFixture({ files: { 'themes/kingdee/missing.md': sha256('missing') } });

    const result = runVerifier(1);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/missing manifest file.*themes\/kingdee\/missing\.md/i);
  });

  it('rejects a manifest path that escapes the plugin root', () => {
    writeFixture({ files: { '../escape.txt': sha256('outside') } });
    writeFileSync(join(pluginRoot, '..', 'escape.txt'), 'outside');

    const result = runVerifier(1);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/unsafe manifest path.*\.\.\/escape\.txt/i);
  });

  it.each([
    ['a Windows drive path', 'C:\\escape.txt'],
    ['a UNC path', '\\\\server\\share\\escape.txt'],
    ['backslash parent traversal', '..\\escape.txt'],
  ])('rejects %s in the manifest', (_label, relativePath) => {
    writeFixture({ files: { [relativePath]: sha256('outside') } });

    const result = runVerifier(1);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/unsafe manifest path/i);
  });

  it('rejects a packaged plugin root symlink that escapes bundled-plugins', () => {
    const outsidePluginRoot = join(rootDir, 'outside-plugin');
    writeFixture({ contents: { 'themes/kingdee/reference.md': '# Kingdee' } }, outsidePluginRoot);
    mkdirSync(dirname(pluginRoot), { recursive: true });
    symlinkSync(
      outsidePluginRoot,
      pluginRoot,
      process.platform === 'win32' ? 'junction' : 'dir',
    );

    const result = runVerifier(1);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/packaged plugin root escapes bundled-plugins/i);
  });

  for (const metadataName of ['plugin.json', 'vendor-manifest.json'] as const) {
    it.skipIf(process.platform === 'win32')(
      `rejects ${metadataName} when it is a symlink outside the plugin root`,
      () => {
        writeFixture({ contents: {} });
        const metadataPath = join(pluginRoot, metadataName);
        const outsideMetadataPath = join(rootDir, `outside-${metadataName}`);
        writeFileSync(outsideMetadataPath, readFileSync(metadataPath));
        rmSync(metadataPath);
        symlinkSync(outsideMetadataPath, metadataPath, 'file');

        const result = runVerifier(0);

        expect(result.status).not.toBe(0);
        expect(result.stderr).toMatch(
          new RegExp(`metadata file escapes packaged plugin root.*${metadataName}`, 'i'),
        );
      },
    );
  }

  it.skipIf(process.platform === 'win32')(
    'rejects a manifest entry symlink that escapes the plugin root',
    () => {
      const relativePath = 'themes/kingdee/reference.md';
      const outsideFile = join(rootDir, 'outside-reference.md');
      const outsideContent = '# Outside Kingdee';
      writeFixture({ files: { [relativePath]: sha256(outsideContent) } });
      writeFileSync(outsideFile, outsideContent);
      const entryPath = join(pluginRoot, relativePath);
      mkdirSync(dirname(entryPath), { recursive: true });
      symlinkSync(outsideFile, entryPath, 'file');

      const result = runVerifier(1);

      expect(result.status).not.toBe(0);
      expect(result.stderr).toMatch(/symlink escape.*themes\/kingdee\/reference\.md/i);
    },
  );

  it('rejects a manifest entry that resolves to a directory', () => {
    writeFixture({ files: { 'themes/kingdee': sha256('directory') } });
    mkdirSync(join(pluginRoot, 'themes', 'kingdee'), { recursive: true });

    const result = runVerifier(1);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/manifest entry is not a file.*themes\/kingdee/i);
  });

  it.each([
    ['an invalid string hash', 'not-a-sha-256'],
    ['a non-string hash', 42],
  ])('rejects %s', (_label, invalidHash) => {
    writeFixture({ files: { 'themes/kingdee/reference.md': invalidHash } });

    const result = runVerifier(1);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/invalid sha-256.*themes\/kingdee\/reference\.md/i);
  });

  it('rejects a manifest entry whose SHA-256 does not match', () => {
    writeFixture({
      contents: { 'themes/kingdee/reference.md': '# Kingdee' },
      files: { 'themes/kingdee/reference.md': '0'.repeat(64) },
    });

    const result = runVerifier(1);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/sha-256 mismatch.*themes\/kingdee\/reference\.md/i);
  });

  it('rejects a missing required argument', () => {
    const result = runVerifierWithArguments([
      '--app',
      appPath,
      '--expected-count',
      '0',
    ]);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/missing required argument.*--expected-version/i);
  });

  it('rejects a duplicate argument', () => {
    const result = runVerifierWithArguments([
      '--app',
      appPath,
      '--expected-count',
      '0',
      '--expected-version',
      '3.2.1',
      '--app',
      appPath,
    ]);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/duplicate argument.*--app/i);
  });

  it('rejects an unknown argument', () => {
    const result = runVerifierWithArguments([
      '--app',
      appPath,
      '--expected-count',
      '0',
      '--expected-version',
      '3.2.1',
      '--unknown',
      'value',
    ]);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/unknown argument.*--unknown/i);
  });
});
