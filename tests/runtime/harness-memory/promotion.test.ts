import { describe, expect, it } from 'vitest';
import { evaluateHarnessMemoryPromotion } from '../../../src/runtime/harness-memory/promotion.js';

describe('harness memory promotion rules', () => {
  it('keeps single or same-session repeated failures as candidates', () => {
    expect(evaluateHarnessMemoryPromotion([
      { traceBundlePath: '/trace/1.json', evidenceIds: ['task:a'], sessionId: 'sess-1', projectId: 'proj-1' },
    ])).toEqual({ status: 'candidate', reason: 'needs-three-distinct-sources' });

    expect(evaluateHarnessMemoryPromotion([
      { traceBundlePath: '/trace/1.json', evidenceIds: ['task:a'], sessionId: 'sess-1', projectId: 'proj-1' },
      { traceBundlePath: '/trace/2.json', evidenceIds: ['task:b'], sessionId: 'sess-1', projectId: 'proj-1' },
      { traceBundlePath: '/trace/3.json', evidenceIds: ['task:c'], sessionId: 'sess-1', projectId: 'proj-1' },
    ])).toEqual({ status: 'candidate', reason: 'sources-not-distinct' });
  });

  it('allows promotion from three distinct sessions, projects, or eval cases', () => {
    expect(evaluateHarnessMemoryPromotion([
      { traceBundlePath: '/trace/1.json', evidenceIds: ['task:a'], sessionId: 'sess-1' },
      { traceBundlePath: '/trace/2.json', evidenceIds: ['task:b'], sessionId: 'sess-2' },
      { traceBundlePath: '/trace/3.json', evidenceIds: ['task:c'], evalCaseId: 'eval-1' },
    ])).toEqual({ status: 'active', reason: 'three-distinct-sources' });
  });

  it('rejects promotion without evidence ids', () => {
    expect(evaluateHarnessMemoryPromotion([
      { traceBundlePath: '/trace/1.json', evidenceIds: [], sessionId: 'sess-1' },
      { traceBundlePath: '/trace/2.json', evidenceIds: ['task:b'], sessionId: 'sess-2' },
      { traceBundlePath: '/trace/3.json', evidenceIds: ['task:c'], sessionId: 'sess-3' },
    ])).toEqual({ status: 'rejected', reason: 'missing-evidence' });
  });
});
