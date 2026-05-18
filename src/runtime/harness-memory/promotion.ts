import type { HarnessMemoryEvidence } from './types.js';

export function evaluateHarnessMemoryPromotion(evidence: HarnessMemoryEvidence[]): {
  status: 'rejected' | 'candidate' | 'active';
  reason: string;
} {
  if (evidence.length === 0 || evidence.some((item) => item.evidenceIds.length === 0 || !item.traceBundlePath)) {
    return { status: 'rejected', reason: 'missing-evidence' };
  }
  const sources = new Set<string>();
  for (const item of evidence) {
    if (item.evalCaseId) sources.add(`eval:${item.evalCaseId}`);
    else if (item.projectId) sources.add(`project:${item.projectId}`);
    else if (item.sessionId) sources.add(`session:${item.sessionId}`);
  }
  if (sources.size >= 3) return { status: 'active', reason: 'three-distinct-sources' };
  if (evidence.length >= 3) return { status: 'candidate', reason: 'sources-not-distinct' };
  return { status: 'candidate', reason: 'needs-three-distinct-sources' };
}
