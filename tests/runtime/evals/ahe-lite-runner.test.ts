import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runAheLiteEval } from '../../../src/runtime/evals/ahe-lite-runner.js';
import { validateAheLiteEvalResult } from '../../../src/runtime/evals/result-schema.js';

describe('AHE-lite deterministic eval runner', () => {
  it('runs deterministic scenarios, writes trace-backed results, and computes effectiveness gates', async () => {
    const root = mkdtempSync(join(tmpdir(), 'xiaok-ahe-lite-eval-'));
    mkdirSync(root, { recursive: true });
    const outputPath = join(root, 'latest.json');

    const summary = await runAheLiteEval({ outputPath, traceRoot: join(root, 'traces') });

    expect(summary.recommendation).toBe('ship');
    expect(summary.metrics).toMatchObject({
      redactionLeakCount: 0,
      incidentPrimaryFindingRate: 1,
      emptyArtifactDetectionRate: 1,
      traceSchemaValidRate: 1,
    });
    expect(summary.results.map((result) => result.evalId)).toEqual(
      expect.arrayContaining([
        'ahe-lite-incident-tech-conference-blocked-project',
        'ahe-lite-empty-artifact',
        'ahe-lite-code-missing-verification',
      ]),
    );
    expect(existsSync(outputPath)).toBe(true);
    const persisted = JSON.parse(readFileSync(outputPath, 'utf8')) as typeof summary;
    for (const result of persisted.results) {
      expect(validateAheLiteEvalResult(result, { baselinePath: persisted.baselinePath })).toEqual({ ok: true });
    }
  });
});
