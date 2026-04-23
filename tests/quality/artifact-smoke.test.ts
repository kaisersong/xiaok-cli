import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkArtifactSmoke, resolveArtifactKind } from '../../src/quality/artifact-smoke.js';

describe('artifact smoke', () => {
  let rootDir: string;

  beforeEach(() => {
    rootDir = join(tmpdir(), `xiaok-artifact-smoke-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(rootDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(rootDir, { recursive: true, force: true });
  });

  it('passes markdown files with real content', () => {
    const artifactPath = join(rootDir, 'artifact.md');
    writeFileSync(artifactPath, '# Title\n\nSome useful content.\n', 'utf8');

    const result = checkArtifactSmoke({ artifactPath });
    expect(result.ok).toBe(true);
    expect(result.kind).toBe('markdown');
    expect(result.errors).toEqual([]);
  });

  it('fails when artifact path matches a provided source path', () => {
    const artifactPath = join(rootDir, 'artifact.md');
    writeFileSync(artifactPath, '# Title\n', 'utf8');

    const result = checkArtifactSmoke({
      artifactPath,
      sourcePaths: [artifactPath],
    });
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('artifact path matches a provided source path');
  });

  it('fails html files that miss an html shell or content root', () => {
    const artifactPath = join(rootDir, 'artifact.html');
    writeFileSync(artifactPath, '<div>just a fragment</div>', 'utf8');

    const result = checkArtifactSmoke({ artifactPath });
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual([
      'html artifact is missing an html shell',
      'html artifact is missing a body-like content root',
    ]);
  });

  it('fails invalid json files', () => {
    const artifactPath = join(rootDir, 'artifact.json');
    writeFileSync(artifactPath, '{"broken": true', 'utf8');

    const result = checkArtifactSmoke({ artifactPath });
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toMatch(/^json artifact failed to parse:/);
  });

  it('detects pptx from extension and checks for zip header', () => {
    const artifactPath = join(rootDir, 'artifact.pptx');
    writeFileSync(artifactPath, Buffer.from('PKmock'));

    const result = checkArtifactSmoke({ artifactPath });
    expect(result.ok).toBe(true);
    expect(result.kind).toBe('pptx');
    expect(resolveArtifactKind(artifactPath)).toBe('pptx');
  });
});
