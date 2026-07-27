import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

async function loadDriver(): Promise<any> {
  return import(pathToFileURL(join(
    process.cwd(),
    'scripts/evals/kimi-k3-d9/desktop-driver.mjs',
  )).href);
}

const STRATA = [
  'desktop-no-tool-multiturn',
  'desktop-single-tool',
  'desktop-multi-tool',
  'desktop-long-synthesized-history',
  'desktop-new-invocation-recovery',
];

describe('Kimi K3 D9 Desktop strata', () => {
  it('freezes five packaged-product plans with deterministic validators', async () => {
    const { createDesktopStratumPlan } = await loadDriver();
    for (const stratum of STRATA) {
      const plan = createDesktopStratumPlan({
        stratum,
        fixtureId: `fixture:${stratum}`,
        promptDigest: 'ab'.repeat(32),
        synthesizedHistoryDigest: stratum === 'desktop-long-synthesized-history'
          ? 'cd'.repeat(32)
          : null,
      });
      expect(plan.surface).toBe('desktop');
      expect(plan.packagedProductOnly).toBe(true);
      expect(plan.validatorId).toBe(`d9-validator:${stratum}:v1`);
      expect(plan.turns.length).toBeGreaterThan(0);
      expect(JSON.stringify(plan)).not.toContain('runDesktopToolLoop');
      expect(JSON.stringify(plan)).not.toContain('ai/adapters');
    }
  });

  it.each([
    {
      name: 'assistant role',
      patch: { canonicalHistoryRoleVector: ['system', 'user', 'assistant'] },
    },
    {
      name: 'post-assistant recovery',
      patch: { recoveryPhase: 'after-assistant' },
    },
    {
      name: 'terminal semantics drift',
      patch: { candidateTerminalSemantics: 'durable-resume-rejected' },
    },
    {
      name: 'candidate-only unsupported resume',
      patch: { candidateOnlyDurableResumeUnsupported: true },
    },
  ])('rejects recovery boundary with $name before manifest', async ({ patch }) => {
    const { validateDesktopRecoveryBoundary } = await loadDriver();
    expect(() => validateDesktopRecoveryBoundary({
      recoveryPhase: 'before-first-assistant',
      canonicalHistoryRoleVector: ['system', 'user'],
      baselineTerminalSemantics: 'task-not-started',
      candidateTerminalSemantics: 'task-not-started',
      candidateOnlyDurableResumeUnsupported: false,
      ...patch,
    })).toThrow('KIMI_D9_DESKTOP_RECOVERY_BOUNDARY_INVALID');
  });

  it('accepts only exact evidence for every Desktop stratum', async () => {
    const {
      createDesktopStratumPlan,
      validateDesktopStratumEvidence,
    } = await loadDriver();
    for (const stratum of STRATA) {
      const plan = createDesktopStratumPlan({
        stratum,
        fixtureId: `fixture:${stratum}`,
        promptDigest: 'ab'.repeat(32),
        synthesizedHistoryDigest: stratum === 'desktop-long-synthesized-history'
          ? 'cd'.repeat(32)
          : null,
      });
      const evidence = {
        stratum,
        completedTurns: plan.turns.length,
        expectedTurns: plan.turns.length,
        fixtureInvocations: plan.expectedFixtureInvocations,
        expectedFixtureInvocations: plan.expectedFixtureInvocations,
        continuityMarkersMatched: true,
        synthesizedHistoryDigest: plan.synthesizedHistoryDigest,
        recoveryInvocationCount: plan.recoveryInvocationCount,
        recoveryBoundary: plan.recoveryBoundary,
        terminalStatus: 'completed',
      };
      expect(validateDesktopStratumEvidence(evidence)).toEqual({
        success: true,
        stratum,
      });
      expect(() => validateDesktopStratumEvidence({
        ...evidence,
        completedTurns: Math.max(0, plan.turns.length - 1),
      })).toThrow('KIMI_D9_DESKTOP_STRATUM_EVIDENCE_INVALID');
    }
  });
});
