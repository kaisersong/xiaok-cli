import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { computeBaselineHash } from '../../../src/runtime/evals/baseline.js';
import { validateAheLiteEvalResult } from '../../../src/runtime/evals/result-schema.js';
import type { TraceBundleV1 } from '../../../src/runtime/trace/schema.js';

function writeTrace(root: string, bundle?: Partial<TraceBundleV1>): string {
  const trace: TraceBundleV1 = {
    schemaVersion: 1,
    bundleId: 'trace_eval_1',
    createdAt: '2026-05-18T00:00:00.000Z',
    source: { app: 'kswarm' },
    scope: { kind: 'project', projectId: 'proj-1' },
    environment: {},
    turns: [],
    events: [],
    toolCalls: [],
    approvals: [],
    tasks: [{ id: 'item-6', title: '评审', status: 'blocked', blockedReason: 'missing_review_evidence' }],
    agents: [{ id: 'agent-1', status: 'idle' }],
    artifacts: [],
    memoryRefs: [],
    skillEvidence: [],
    recovery: [],
    crashes: [],
    redactions: [],
    attachments: [],
    summary: { projectStatus: 'active' },
    ...bundle,
  };
  const path = join(root, 'trace.json');
  writeFileSync(path, JSON.stringify(trace, null, 2), 'utf8');
  return path;
}

describe('AHE-lite eval result schema', () => {
  it('accepts an eval result backed by a valid trace and diagnoser finding', () => {
    const root = mkdtempSync(join(tmpdir(), 'xiaok-eval-result-'));
    mkdirSync(root, { recursive: true });
    const traceBundlePath = writeTrace(root);
    const baseline = { evalId: 'ahe-lite-incident-tech-conference-blocked-project', ok: true };
    const baselinePath = join(root, 'baseline.json');
    writeFileSync(baselinePath, JSON.stringify(baseline), 'utf8');

    const result = validateAheLiteEvalResult({
      evalId: 'ahe-lite-incident-tech-conference-blocked-project',
      ok: true,
      expectedFailureCategory: 'blocked_task',
      actualFailureCategory: 'blocked_task',
      primaryFinding: 'blocked_task:item-6',
      evidenceIds: ['task:item-6'],
      traceBundlePath,
      baselineHash: computeBaselineHash(baseline),
      durationMs: 12,
      environment: { mode: 'deterministic' },
    }, { baselinePath });

    expect(result).toEqual({ ok: true });
  });

  it('rejects missing traces, unresolved evidence ids, and hand-written categories', () => {
    const root = mkdtempSync(join(tmpdir(), 'xiaok-eval-result-'));
    const traceBundlePath = writeTrace(root);
    const baselinePath = join(root, 'baseline.json');
    writeFileSync(baselinePath, JSON.stringify({ evalId: 'x' }), 'utf8');

    const result = validateAheLiteEvalResult({
      evalId: 'x',
      ok: false,
      expectedFailureCategory: 'empty_artifact',
      actualFailureCategory: 'empty_artifact',
      primaryFinding: 'empty_artifact:item-99',
      evidenceIds: ['task:item-99'],
      traceBundlePath,
      baselineHash: 'sha256:wrong',
      durationMs: 1,
      environment: { mode: 'deterministic' },
    }, { baselinePath });

    expect(result).toEqual({
      ok: false,
      errors: [
        'evidenceIds[0]:task:item-99',
        'primaryFinding:empty_artifact:item-99',
        'actualFailureCategory:empty_artifact',
        'baselineHash',
      ],
    });
  });
});
