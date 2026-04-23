import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileSessionStore } from '../../../src/ai/runtime/session-store.js';
import { SessionSkillEvalStore } from '../../../src/runtime/intent-delegation/skill-eval-store.js';
import { createIntentLedgerRecord } from '../../../src/runtime/intent-delegation/dispatcher.js';
import type { IntentPlanDraft, PlannedStep, RiskTier } from '../../../src/ai/intent-delegation/types.js';

describe('session skill eval store', () => {
  let rootDir: string;

  beforeEach(() => {
    rootDir = join(tmpdir(), `xiaok-skill-eval-store-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(rootDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(rootDir, { recursive: true, force: true });
  });

  it('seeds non-generic skill observations and persists runtime updates plus feedback', async () => {
    const sessionStore = new FileSessionStore(rootDir);
    await sessionStore.save(createSessionSnapshot('sess_skill_eval'));
    const store = new SessionSkillEvalStore(sessionStore);
    const intent = createIntentLedgerRecord(createPlanDraft({
      sessionId: 'sess_skill_eval',
      instanceId: 'inst_skill_eval',
      intentId: 'intent_skill_eval',
    }), 100);

    const seeded = await store.ensureObservationsForIntent('sess_skill_eval', intent);
    expect(seeded.observations).toEqual([
      expect.objectContaining({
        intentId: 'intent_skill_eval',
        stepId: 'intent_skill_eval:stage:1:step:compose',
        selectedSkillName: 'compose-report',
        deliverableFamily: 'document',
      }),
    ]);

    const invoked = await store.recordSkillInvocation('sess_skill_eval', {
      intentId: 'intent_skill_eval',
      stepId: 'intent_skill_eval:stage:1:step:compose',
      skillName: 'compose-report',
      now: 110,
    });
    expect(invoked.observations[0]?.actualSkillName).toBe('compose-report');

    const completed = await store.updateObservationStatus('sess_skill_eval', {
      intentId: 'intent_skill_eval',
      stepId: 'intent_skill_eval:stage:1:step:compose',
      status: 'completed',
      now: 111,
    });
    expect(completed.observations[0]?.status).toBe('completed');

    const artifacted = await store.recordArtifact('sess_skill_eval', {
      intentId: 'intent_skill_eval',
      stageId: 'intent_skill_eval:stage:1',
      structuralValidation: 'passed',
      semanticValidation: 'passed',
      now: 112,
    });
    expect(artifacted.observations[0]).toMatchObject({
      artifactRecorded: true,
      structuralValidation: 'passed',
      semanticValidation: 'passed',
    });

    const feedback = {
      feedbackId: 'feedback_1',
      sessionId: 'sess_skill_eval',
      intentId: 'intent_skill_eval',
      kind: 'routing' as const,
      sentiment: 'positive' as const,
      observationIds: [artifacted.observations[0]!.observationId],
      createdAt: 120,
    };
    const fed = await store.recordFeedback('sess_skill_eval', feedback);
    expect(fed.feedback).toEqual([feedback]);

    const reloaded = await store.load('sess_skill_eval');
    expect(reloaded?.observations[0]).toMatchObject({
      actualSkillName: 'compose-report',
      status: 'completed',
      artifactRecorded: true,
    });
    expect(reloaded?.feedback[0]).toMatchObject({
      feedbackId: 'feedback_1',
      kind: 'routing',
      sentiment: 'positive',
    });
  });
});

function createSessionSnapshot(sessionId: string) {
  return {
    sessionId,
    cwd: '/tmp/xiaok',
    createdAt: 100,
    updatedAt: 100,
    lineage: [sessionId],
    messages: [],
    usage: { inputTokens: 0, outputTokens: 0 },
    compactions: [],
    memoryRefs: [],
    approvalRefs: [],
    backgroundJobRefs: [],
  };
}

function createPlanDraft(input: {
  sessionId: string;
  instanceId: string;
  intentId: string;
  riskTier?: RiskTier;
}): IntentPlanDraft {
  const riskTier = input.riskTier ?? 'medium';
  const steps = [
    createStep(input.intentId, 0, 'collect', 'generic_llm::collect', [], riskTier),
    createStep(input.intentId, 1, 'compose', 'compose-report', [`${input.intentId}:stage:1:step:collect`], riskTier),
  ];

  return {
    instanceId: input.instanceId,
    intentId: input.intentId,
    sessionId: input.sessionId,
    rawIntent: 'Write a proposal',
    normalizedIntent: 'write a proposal',
    intentType: 'generate',
    deliverable: 'proposal',
    finalDeliverable: 'proposal',
    explicitConstraints: [],
    delegationBoundary: [],
    riskTier,
    intentMode: 'single_stage',
    segmentationConfidence: 'low',
    templateId: 'tpl_generate',
    stages: [{
      stageId: `${input.intentId}:stage:1`,
      order: 0,
      label: '生成 proposal',
      intentType: 'generate',
      deliverable: 'proposal',
      templateId: 'tpl_generate',
      riskTier,
      dependsOnStageIds: [],
      steps,
    }],
    steps,
    continuationMode: 'new_intent',
  };
}

function createStep(
  intentId: string,
  order: number,
  key: PlannedStep['key'],
  skillName: string | null,
  dependsOn: string[],
  riskTier: RiskTier,
): PlannedStep {
  return {
    stepId: `${intentId}:stage:1:step:${key}`,
    key,
    order,
    role: key === 'collect' ? 'collect' : 'compose',
    skillName,
    dependsOn,
    status: 'planned',
    riskTier,
  };
}
