import { describe, expect, it } from 'vitest';
import { evaluateProtectedOutputGuard } from '../../../src/runtime/guards/protected-output-guard.js';

describe('ProtectedOutputGuard', () => {
  it('blocks delete or overwrite of protected delivered artifacts without override', () => {
    const decision = evaluateProtectedOutputGuard({
      operation: 'delete',
      targetPath: '/tmp/out/report.md',
      protectedArtifacts: [{ artifactId: 'artifact-1', path: '/tmp/out/report.md' }],
    });

    expect(decision).toMatchObject({
      ok: false,
      mode: 'block',
      allowOverride: true,
    });
    expect(decision.events[0]).toMatchObject({
      type: 'guard.blocked',
      refs: { artifactId: 'artifact-1' },
    });
  });

  it('allows override with auditable actor and reason', () => {
    const decision = evaluateProtectedOutputGuard({
      operation: 'overwrite',
      targetPath: '/tmp/out/report.md',
      protectedArtifacts: [{ artifactId: 'artifact-1', path: '/tmp/out/report.md' }],
      override: { actor: 'human', reason: 'replace stale report' },
    });

    expect(decision).toMatchObject({ ok: true, mode: 'pass' });
    expect(decision.events[0]).toMatchObject({ type: 'guard.override' });
  });
});
