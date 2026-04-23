import { describe, expect, it } from 'vitest';
import type { IntentPlanDraft, PlannedStep, RiskTier } from '../../../src/ai/intent-delegation/types.js';
import { applyIntentStepUpdate, createIntentLedgerRecord } from '../../../src/runtime/intent-delegation/dispatcher.js';
import {
  consumeFreshContextHandoff,
  hasPendingFreshContextHandoff,
} from '../../../src/runtime/intent-delegation/handoff.js';
import { createEmptySessionIntentLedger } from '../../../src/runtime/intent-delegation/store.js';

describe('intent delegation handoff', () => {
  it('marks downstream stages for fresh context handoff and consumes the flag once applied', () => {
    const ledger = createEmptySessionIntentLedger('sess_handoff', 100);
    const plan = createPlanDraft({
      sessionId: 'sess_handoff',
      instanceId: 'inst_handoff',
      intentId: 'intent_handoff',
    });
    let intent = createIntentLedgerRecord(plan, 101);
    ledger.intents = [intent];
    ledger.latestPlan = intent;
    ledger.activeIntentId = intent.intentId;
    ledger.ownership = {
      state: 'owned',
      ownerInstanceId: 'inst_handoff',
      updatedAt: 101,
    };

    intent = applyIntentStepUpdate(intent, {
      stepId: 'intent_handoff:stage:1:step:collect',
      status: 'running',
      now: 102,
    });
    intent = applyIntentStepUpdate(intent, {
      stepId: 'intent_handoff:stage:1:step:collect',
      status: 'completed',
      now: 103,
    });

    ledger.intents = [intent];
    ledger.latestPlan = intent;
    ledger.activeIntentId = intent.intentId;

    expect(intent.activeStageId).toBe('intent_handoff:stage:2');
    expect(hasPendingFreshContextHandoff(ledger, 'inst_handoff')).toBe(true);

    const consumed = consumeFreshContextHandoff(intent, 104);
    const activeStage = consumed.stages.find((stage) => stage.stageId === consumed.activeStageId);
    expect(activeStage?.needsFreshContextHandoff).toBe(false);
  });
});

function createPlanDraft(input: {
  sessionId: string;
  instanceId: string;
  intentId: string;
  riskTier?: RiskTier;
}): IntentPlanDraft {
  const riskTier = input.riskTier ?? 'medium';
  const stageOneSteps = [
    createStep(`${input.intentId}:stage:1`, 0, 'collect', [], riskTier),
  ];
  const stageTwoSteps = [
    createStep(`${input.intentId}:stage:2`, 0, 'compose', [], riskTier),
  ];

  return {
    instanceId: input.instanceId,
    intentId: input.intentId,
    sessionId: input.sessionId,
    rawIntent: '生成 md，然后生成报告',
    normalizedIntent: '生成 md 然后 生成 报告',
    intentType: 'generate',
    deliverable: 'md -> 报告',
    finalDeliverable: '报告',
    explicitConstraints: [],
    delegationBoundary: [],
    riskTier,
    intentMode: 'multi_stage',
    segmentationConfidence: 'high',
    templateId: 'generate_v1',
    stages: [
      {
        stageId: `${input.intentId}:stage:1`,
        order: 0,
        label: '提取 Markdown',
        intentType: 'generate',
        deliverable: 'md',
        templateId: 'generate_v1',
        riskTier,
        dependsOnStageIds: [],
        steps: stageOneSteps,
      },
      {
        stageId: `${input.intentId}:stage:2`,
        order: 1,
        label: '生成报告',
        intentType: 'generate',
        deliverable: '报告',
        templateId: 'generate_v1',
        riskTier,
        dependsOnStageIds: [`${input.intentId}:stage:1`],
        steps: stageTwoSteps,
      },
    ],
    steps: stageOneSteps,
    continuationMode: 'new_intent',
  };
}

function createStep(
  stageId: string,
  order: number,
  key: 'collect' | 'compose',
  dependsOn: string[],
  riskTier: RiskTier,
): PlannedStep {
  return {
    stepId: `${stageId}:step:${key}`,
    key,
    order,
    role: key,
    skillName: null,
    dependsOn,
    status: 'planned',
    riskTier,
  };
}
