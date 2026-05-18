import { describe, expect, it } from 'vitest';
import { evaluateRecoveryContinuityGuard } from '../../../src/runtime/guards/recovery-continuity-guard.js';

describe('RecoveryContinuityGuard', () => {
  it('warns when active recovery has no prior snapshot or trace reference', () => {
    const decision = evaluateRecoveryContinuityGuard({
      taskId: 'task-1',
      recovering: true,
      hasSnapshot: false,
      hasTraceReference: false,
    });

    expect(decision).toMatchObject({
      ok: false,
      mode: 'warn',
      allowOverride: true,
    });
    expect(decision.events[0]).toMatchObject({ type: 'guard.warned', refs: { taskId: 'task-1' } });
  });

  it('passes ordinary starts and recoveries with continuity evidence', () => {
    expect(evaluateRecoveryContinuityGuard({ taskId: 'task-1', recovering: false, hasSnapshot: false, hasTraceReference: false }).ok).toBe(true);
    expect(evaluateRecoveryContinuityGuard({ taskId: 'task-1', recovering: true, hasSnapshot: true, hasTraceReference: false }).ok).toBe(true);
  });
});
