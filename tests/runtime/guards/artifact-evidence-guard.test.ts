import { describe, expect, it } from 'vitest';
import { evaluateArtifactEvidenceGuard } from '../../../src/runtime/guards/artifact-evidence-guard.js';

describe('ArtifactEvidenceGuard', () => {
  it('blocks completed task submission when no artifact evidence exists', () => {
    const decision = evaluateArtifactEvidenceGuard({
      taskId: 'item-2',
      status: 'done',
      artifacts: [],
    });

    expect(decision).toMatchObject({
      ok: false,
      mode: 'block',
      allowOverride: true,
    });
    expect(decision.events).toEqual([
      expect.objectContaining({
        source: 'guard',
        type: 'guard.blocked',
        refs: { taskId: 'item-2' },
      }),
    ]);
  });

  it('passes non-terminal or artifact-backed tasks', () => {
    expect(evaluateArtifactEvidenceGuard({ taskId: 'item-1', status: 'in_progress', artifacts: [] }).ok).toBe(true);
    expect(evaluateArtifactEvidenceGuard({ taskId: 'item-2', status: 'done', artifacts: ['artifact-1'] }).ok).toBe(true);
  });
});
