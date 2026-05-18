import { describe, expect, it } from 'vitest';
import { evaluateVerificationBeforeCompletionGuard } from '../../../src/runtime/guards/verification-before-completion-guard.js';
import type { TraceBundleV1 } from '../../../src/runtime/trace/schema.js';

function bundle(overrides: Partial<TraceBundleV1>): TraceBundleV1 {
  return {
    schemaVersion: 1,
    bundleId: 'trace_guard_verification',
    createdAt: '2026-05-18T00:00:00.000Z',
    source: { app: 'xiaok-cli' },
    scope: { kind: 'session', sessionId: 'sess-1' },
    environment: {},
    turns: [],
    events: [],
    toolCalls: [],
    approvals: [],
    tasks: [],
    agents: [],
    artifacts: [],
    memoryRefs: [],
    skillEvidence: [],
    recovery: [],
    crashes: [],
    redactions: [],
    attachments: [],
    summary: {},
    ...overrides,
  };
}

describe('VerificationBeforeCompletionGuard', () => {
  it('warns for code completion without verification evidence', () => {
    const decision = evaluateVerificationBeforeCompletionGuard({
      scope: { kind: 'code', confidence: 0.9 },
      bundle: bundle({ toolCalls: [{ id: 'tool-1', name: 'Edit', inputPreview: '{}', startedAt: '2026-05-18T00:00:00.000Z', ok: true }] }),
    });

    expect(decision).toMatchObject({
      ok: false,
      mode: 'warn',
      allowOverride: true,
    });
    expect(decision.events[0]).toMatchObject({ type: 'guard.warned', source: 'guard' });
  });

  it('passes verified code tasks and non-code tasks', () => {
    expect(evaluateVerificationBeforeCompletionGuard({
      scope: { kind: 'code', confidence: 0.9 },
      bundle: bundle({ toolCalls: [{ id: 'tool-1', name: 'npm test', inputPreview: '{}', startedAt: '2026-05-18T00:00:00.000Z', ok: true }] }),
    }).ok).toBe(true);
    expect(evaluateVerificationBeforeCompletionGuard({
      scope: { kind: 'document', confidence: 0.9 },
      bundle: bundle({ toolCalls: [] }),
    }).ok).toBe(true);
  });
});
