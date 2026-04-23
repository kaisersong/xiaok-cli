import { describe, expect, it } from 'vitest';
import type { IntentPlanDraft, PlannedStep, RiskTier } from '../../src/ai/intent-delegation/types.js';
import { initializeChatIntentLedger } from '../../src/commands/chat.js';
import { appendIntentToLedger, createEmptySessionIntentLedger } from '../../src/runtime/intent-delegation/store.js';
import { markSessionOwned, releaseSessionOwnership } from '../../src/runtime/intent-delegation/ownership.js';

describe('chat intent ownership initialization', () => {
  it('allows resume of a released session without forcing takeover', () => {
    const released = releaseSessionOwnership(
      markSessionOwned(
        appendIntentToLedger(
          createEmptySessionIntentLedger('sess_resume', 100),
          createPlanDraft({
            sessionId: 'sess_resume',
            instanceId: 'inst_old',
            intentId: 'intent_resume',
          }),
          101,
        ),
        'inst_old',
        102,
      ),
      'inst_old',
      103,
    );

    const resumed = initializeChatIntentLedger(released, 'sess_resume', 'inst_new', 'resume');

    expect(resumed.ownership).toMatchObject({
      state: 'resume',
      ownerInstanceId: 'inst_new',
      previousOwnerInstanceId: 'inst_old',
    });
  });

  it('requires explicit high-risk confirmation before takeover', () => {
    const owned = markSessionOwned(
      appendIntentToLedger(
        createEmptySessionIntentLedger('sess_takeover', 100),
        createPlanDraft({
          sessionId: 'sess_takeover',
          instanceId: 'inst_old',
          intentId: 'intent_takeover',
          riskTier: 'high',
        }),
        101,
      ),
      'inst_old',
      102,
    );

    expect(() => initializeChatIntentLedger(owned, 'sess_takeover', 'inst_new', 'takeover')).toThrow(
      /confirm-high-risk-takeover/i,
    );

    const takenOver = initializeChatIntentLedger(owned, 'sess_takeover', 'inst_new', 'takeover', {
      confirmHighRiskTakeover: true,
    });
    expect(takenOver.ownership).toMatchObject({
      state: 'takeover',
      ownerInstanceId: 'inst_new',
      previousOwnerInstanceId: 'inst_old',
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
    rawIntent: 'Write a proposal',
    normalizedIntent: 'write a proposal',
    intentType: 'generate',
    deliverable: 'proposal draft',
    explicitConstraints: [],
    delegationBoundary: [],
    riskTier,
    templateId: 'generate_v1',
    steps: [
      createStep(input.intentId, 0, 'collect', [], riskTier),
      createStep(input.intentId, 1, 'normalize', [`${input.intentId}:step:collect`], riskTier),
    ],
    continuationMode: 'new_intent',
  };
}

function createStep(
  intentId: string,
  order: number,
  key: 'collect' | 'normalize',
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
