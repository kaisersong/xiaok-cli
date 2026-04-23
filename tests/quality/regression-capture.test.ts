import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createRegressionRecord,
  slugifyRegressionId,
  writeRegressionRecord,
} from '../../src/quality/regression-capture.js';

describe('regression capture', () => {
  let rootDir: string;

  beforeEach(() => {
    rootDir = join(tmpdir(), `xiaok-regression-capture-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(rootDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(rootDir, { recursive: true, force: true });
  });

  it('creates normalized regression records', () => {
    const record = createRegressionRecord({
      title: 'Report routing drift',
      summary: 'Report stage picked the wrong skill family.',
      kind: 'routing',
      source: 'manual',
      suggestedLayer: 'structured-eval',
    });

    expect(record.id).toBe('report-routing-drift');
    expect(record.evidence).toEqual([]);
    expect(record.title).toBe('Report routing drift');
  });

  it('writes regression records and refuses overwrite by default', () => {
    const first = writeRegressionRecord({
      title: 'Artifact overwrite regression',
      summary: 'Generated report path matched the source file path.',
      kind: 'artifact',
      source: 'runtime',
      suggestedLayer: 'artifact-smoke',
      evidence: [{ kind: 'path', value: '/tmp/report.html' }],
      outputDir: rootDir,
    });

    const parsed = JSON.parse(readFileSync(first.path, 'utf8'));
    expect(parsed).toMatchObject({
      id: 'artifact-overwrite-regression',
      kind: 'artifact',
      suggestedLayer: 'artifact-smoke',
    });

    expect(() => writeRegressionRecord({
      title: 'Artifact overwrite regression',
      summary: 'same title',
      kind: 'artifact',
      source: 'runtime',
      suggestedLayer: 'artifact-smoke',
      outputDir: rootDir,
    })).toThrow(/already exists/);
  });

  it('slugifies ids consistently', () => {
    expect(slugifyRegressionId('  Stage 2 / Report Drift  ')).toBe('stage-2-report-drift');
  });
});
