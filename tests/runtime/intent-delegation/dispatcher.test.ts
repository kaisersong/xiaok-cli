import { describe, expect, it } from 'vitest';
import type { IntentPlanDraft, PlannedStep, RiskTier } from '../../../src/ai/intent-delegation/types.js';
import { activateIntentStep, applyIntentStepUpdate, createIntentLedgerRecord } from '../../../src/runtime/intent-delegation/dispatcher.js';

describe('intent delegation dispatcher', () => {
  it('allows only one active step at a time', () => {
    const intent = createIntentLedgerRecord(createPlanDraft({
      sessionId: 'sess_dispatch',
      instanceId: 'inst_dispatch',
      intentId: 'intent_dispatch',
    }), 100);

    const running = activateIntentStep(intent, 'intent_dispatch:step:collect', 101);
    expect(running.steps.filter((step) => step.status === 'running')).toHaveLength(1);
    expect(running.steps[0]?.stepId).toBe('intent_dispatch:step:collect');

    expect(() => activateIntentStep(running, 'intent_dispatch:step:compose', 102)).toThrow(/activeStepId/i);
  });

  it('rejects out-of-order activation and only advances after active completion', () => {
    const intent = createIntentLedgerRecord(createPlanDraft({
      sessionId: 'sess_order',
      instanceId: 'inst_order',
      intentId: 'intent_order',
    }), 100);

    expect(() => activateIntentStep(intent, 'intent_order:step:compose', 101)).toThrow(/out of order/i);

    const running = activateIntentStep(intent, 'intent_order:step:collect', 102);
    const completed = applyIntentStepUpdate(running, {
      stepId: 'intent_order:step:collect',
      status: 'completed',
      now: 103,
    });
    expect(completed.activeStepId).toBe('intent_order:step:compose');
    expect(completed.steps.find((step) => step.stepId === 'intent_order:step:collect')?.status).toBe('completed');

    expect(() => applyIntentStepUpdate(completed, {
      stepId: 'intent_order:step:collect',
      status: 'running',
      now: 104,
    })).toThrow(/activeStepId/i);
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
    rawIntent: 'Write a memo',
    normalizedIntent: 'write a memo',
    intentType: 'generate',
    deliverable: 'memo',
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
