import { describe, expect, it } from 'vitest';
import { appendIntentToLedger, createEmptySessionIntentLedger } from '../../../src/runtime/intent-delegation/store.js';
import {
  assertSessionWriteOwnership,
  markSessionOwned,
  releaseSessionOwnership,
  resumeSessionOwnership,
  takeoverSessionOwnership,
} from '../../../src/runtime/intent-delegation/ownership.js';
import type { IntentPlanDraft, PlannedStep, RiskTier } from '../../../src/ai/intent-delegation/types.js';

describe('intent delegation ownership', () => {
  it('allows only one active owner per session', () => {
    const ledger = appendIntentToLedger(
      createEmptySessionIntentLedger('sess_owner'),
      createPlanDraft({ sessionId: 'sess_owner', instanceId: 'inst_a', intentId: 'intent_owner' }),
      100,
    );

    const owned = markSessionOwned(ledger, 'inst_a', 101);
    expect(owned.ownership).toMatchObject({
      state: 'owned',
      ownerInstanceId: 'inst_a',
    });

    expect(() => markSessionOwned(owned, 'inst_b', 102)).toThrow(/already owned/i);
  });

  it('keeps resume and takeover as explicit distinct states', () => {
    const base = appendIntentToLedger(
      createEmptySessionIntentLedger('sess_resume'),
      createPlanDraft({ sessionId: 'sess_resume', instanceId: 'inst_a', intentId: 'intent_resume' }),
      100,
    );

    const released = releaseSessionOwnership(markSessionOwned(base, 'inst_a', 101), 'inst_a', 102);
    const resumed = resumeSessionOwnership(released, 'inst_a', 103);
    expect(resumed.ownership).toMatchObject({
      state: 'resume',
      ownerInstanceId: 'inst_a',
      previousOwnerInstanceId: 'inst_a',
    });

    const takenOver = takeoverSessionOwnership(markSessionOwned(base, 'inst_a', 104), 'inst_b', {
      now: 105,
      confirmHighRisk: true,
    });
    expect(takenOver.ownership).toMatchObject({
      state: 'takeover',
      ownerInstanceId: 'inst_b',
      previousOwnerInstanceId: 'inst_a',
    });
  });

  it('allows explicit resume of a released session from a new process instance', () => {
    const base = appendIntentToLedger(
      createEmptySessionIntentLedger('sess_release_takeover'),
      createPlanDraft({
        sessionId: 'sess_release_takeover',
        instanceId: 'inst_a',
        intentId: 'intent_release_takeover',
      }),
      100,
    );

    const released = releaseSessionOwnership(markSessionOwned(base, 'inst_a', 101), 'inst_a', 102);
    const resumed = resumeSessionOwnership(released, 'inst_b', 103);

    expect(resumed.ownership).toMatchObject({
      state: 'resume',
      ownerInstanceId: 'inst_b',
      previousOwnerInstanceId: 'inst_a',
    });
  });

  it('does not let markSessionOwned bypass released-session transfer for a different instance', () => {
    const base = appendIntentToLedger(
      createEmptySessionIntentLedger('sess_mark_bypass'),
      createPlanDraft({
        sessionId: 'sess_mark_bypass',
        instanceId: 'inst_a',
        intentId: 'intent_mark_bypass',
      }),
      100,
    );

    const released = releaseSessionOwnership(markSessionOwned(base, 'inst_a', 101), 'inst_a', 102);

    expect(() => markSessionOwned(released, 'inst_b', 103)).toThrow(/resume|takeover|prior owner/i);
    const resumedByOtherInstance = resumeSessionOwnership(released, 'inst_b', 104);
    expect(resumedByOtherInstance.ownership).toMatchObject({
      state: 'resume',
      ownerInstanceId: 'inst_b',
      previousOwnerInstanceId: 'inst_a',
    });

    const resumed = resumeSessionOwnership(released, 'inst_a', 105);
    expect(resumed.ownership).toMatchObject({
      state: 'resume',
      ownerInstanceId: 'inst_a',
      previousOwnerInstanceId: 'inst_a',
    });
  });

  it('permits writes only for the active owner instance', () => {
    const owned = markSessionOwned(createEmptySessionIntentLedger('sess_write_owner'), 'inst_owner', 101);

    expect(() => assertSessionWriteOwnership(owned, 'inst_other', 'update intent')).toThrow(/owned by inst_owner/i);
    expect(() => assertSessionWriteOwnership(releaseSessionOwnership(owned, 'inst_owner', 102), 'inst_owner', 'update intent')).toThrow(/ownership is released/i);
    expect(() => assertSessionWriteOwnership(owned, 'inst_owner', 'update intent')).not.toThrow();
  });

  it('requires explicit confirmation for high-risk takeover', () => {
    const highRiskLedger = appendIntentToLedger(
      createEmptySessionIntentLedger('sess_high'),
      createPlanDraft({
        sessionId: 'sess_high',
        instanceId: 'inst_a',
        intentId: 'intent_high',
        riskTier: 'high',
      }),
      100,
    );
    const owned = markSessionOwned(highRiskLedger, 'inst_a', 101);

    expect(() => takeoverSessionOwnership(owned, 'inst_b', { now: 102 })).toThrow(/confirmation/i);

    const confirmed = takeoverSessionOwnership(owned, 'inst_b', {
      now: 103,
      confirmHighRisk: true,
    });
    expect(confirmed.ownership).toMatchObject({
      state: 'takeover',
      ownerInstanceId: 'inst_b',
      previousOwnerInstanceId: 'inst_a',
    });
  });
});

function createPlanDraft(input: {
  sessionId: string;
  instanceId: string;
  intentId: string;
  riskTier?: RiskTier;
}): IntentPlanDraft {
  const riskTier = input.riskTier ?? 'medium';
  return {
    instanceId: input.instanceId,
    intentId: input.intentId,
    sessionId: input.sessionId,
    rawIntent: 'Write a brief',
    normalizedIntent: 'write a brief',
    intentType: 'generate',
    deliverable: 'brief',
    explicitConstraints: [],
    delegationBoundary: [],
    riskTier,
    templateId: 'tpl_generate',
    steps: [
      createStep(input.intentId, 0, 'collect', [], riskTier),
      createStep(input.intentId, 1, 'compose', [`${input.intentId}:step:collect`], riskTier),
    ],
    continuationMode: 'new_intent',
  };
}

function createStep(
  intentId: string,
  order: number,
  key: 'collect' | 'compose',
  dependsOn: string[],
  riskTier: RiskTier,
): PlannedStep {
  return {
    stepId: `${intentId}:step:${key}`,
    key,
    order,
    role: key,
    skillName: null,
    dependsOn,
    status: 'planned',
    riskTier,
  };
}
