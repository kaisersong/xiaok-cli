import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IntentPlanDraft, PlannedStep, RiskTier } from '../../../src/ai/intent-delegation/types.js';
import { FileSessionStore } from '../../../src/ai/runtime/session-store.js';
import { SessionIntentDelegationStore } from '../../../src/runtime/intent-delegation/store.js';
import { applyIntentStepUpdate, createIntentLedgerRecord } from '../../../src/runtime/intent-delegation/dispatcher.js';

describe('intent delegation store', () => {
  let rootDir: string;

  beforeEach(() => {
    rootDir = join(tmpdir(), `xiaok-intent-ledger-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(rootDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(rootDir, { recursive: true, force: true });
  });

  it('appends, reads, and updates intent ledger state', async () => {
    const sessionStore = new FileSessionStore(rootDir);
    await sessionStore.save(createSessionSnapshot('sess_store'));

    const ledgerStore = new SessionIntentDelegationStore(sessionStore);
    const plan = createPlanDraft({
      sessionId: 'sess_store',
      instanceId: 'inst_store',
      intentId: 'intent_store',
    });

    const appended = await ledgerStore.appendIntent('sess_store', plan);
    expect(appended.instanceId).toBe('inst_store');
    expect(appended.activeIntentId).toBe('intent_store');
    expect(appended.latestPlan.intentId).toBe('intent_store');
    expect(appended.intents).toHaveLength(1);
    expect(appended.intents[0]).toMatchObject({
      intentId: 'intent_store',
      activeStepId: 'intent_store:step:collect',
      overallStatus: 'drafting_plan',
    });

    const updated = await ledgerStore.updateIntent('sess_store', 'intent_store', {
      overallStatus: 'waiting_user',
      blockedReason: 'need user file',
    });
    expect(updated.intents[0]).toMatchObject({
      overallStatus: 'waiting_user',
      blockedReason: 'need user file',
    });
    expect(updated.latestPlan.overallStatus).toBe('waiting_user');

    const reloaded = await new SessionIntentDelegationStore(new FileSessionStore(rootDir)).load('sess_store');
    expect(reloaded).not.toBeNull();
    expect(reloaded).toMatchObject({
      sessionId: 'sess_store',
      activeIntentId: 'intent_store',
      latestPlan: {
        intentId: 'intent_store',
        overallStatus: 'waiting_user',
        blockedReason: 'need user file',
      },
    });
  });

  it('persists breadcrumbs, receipt, and salvage state', async () => {
    const sessionStore = new FileSessionStore(rootDir);
    await sessionStore.save(createSessionSnapshot('sess_trace'));

    const ledgerStore = new SessionIntentDelegationStore(sessionStore);
    const plan = createPlanDraft({
      sessionId: 'sess_trace',
      instanceId: 'inst_trace',
      intentId: 'intent_trace',
      riskTier: 'high',
    });
    await ledgerStore.appendIntent('sess_trace', plan);

    await ledgerStore.recordBreadcrumb('sess_trace', {
      intentId: 'intent_trace',
      stepId: 'intent_trace:step:collect',
      status: 'running',
      message: 'Collecting source materials',
    });
    await ledgerStore.recordReceipt('sess_trace', {
      intentId: 'intent_trace',
      stepId: 'intent_trace:step:collect',
      note: 'Collected three inputs',
    });
    await ledgerStore.recordSalvage('sess_trace', {
      intentId: 'intent_trace',
      summary: ['materials parsed', 'draft outline captured'],
      reason: 'missing_material',
    });

    const reloaded = await new SessionIntentDelegationStore(new FileSessionStore(rootDir)).load('sess_trace');
    expect(reloaded).not.toBeNull();
    expect(reloaded?.breadcrumbs).toEqual([
      expect.objectContaining({
        intentId: 'intent_trace',
        stepId: 'intent_trace:step:collect',
        status: 'running',
        message: 'Collecting source materials',
      }),
    ]);
    expect(reloaded?.receipt).toEqual(expect.objectContaining({
      intentId: 'intent_trace',
      stepId: 'intent_trace:step:collect',
      note: 'Collected three inputs',
    }));
    expect(reloaded?.salvage).toEqual(expect.objectContaining({
      intentId: 'intent_trace',
      reason: 'missing_material',
      summary: ['materials parsed', 'draft outline captured'],
    }));
    expect(reloaded?.latestPlan.latestBreadcrumb).toBe('Collecting source materials');
    expect(reloaded?.latestPlan.latestReceipt).toBe('Collected three inputs');
    expect(reloaded?.latestPlan.salvageSummary).toEqual(['materials parsed', 'draft outline captured']);
  });

  it('rejects raw store-level mutation of dispatcher-owned step sequencing fields', async () => {
    const sessionStore = new FileSessionStore(rootDir);
    await sessionStore.save(createSessionSnapshot('sess_guard'));

    const ledgerStore = new SessionIntentDelegationStore(sessionStore);
    await ledgerStore.appendIntent('sess_guard', createPlanDraft({
      sessionId: 'sess_guard',
      instanceId: 'inst_guard',
      intentId: 'intent_guard',
    }));

    await expect(ledgerStore.updateIntent('sess_guard', 'intent_guard', {
      activeStepId: 'intent_guard:step:compose',
    })).rejects.toThrow(/dispatcher-owned|activeStepId|steps/i);

    await expect(ledgerStore.updateIntent('sess_guard', 'intent_guard', {
      steps: [
        createStep('intent_guard', 0, 'compose', ['intent_guard:step:collect'], 'medium'),
      ],
    })).rejects.toThrow(/dispatcher-owned|activeStepId|steps/i);
  });

  it('keeps activeIntentId and latestPlan aligned when a different intent receives updates', async () => {
    const sessionStore = new FileSessionStore(rootDir);
    await sessionStore.save(createSessionSnapshot('sess_multi'));

    const ledgerStore = new SessionIntentDelegationStore(sessionStore);
    await ledgerStore.appendIntent('sess_multi', createPlanDraft({
      sessionId: 'sess_multi',
      instanceId: 'inst_multi',
      intentId: 'intent_first',
    }));
    await ledgerStore.appendIntent('sess_multi', createPlanDraft({
      sessionId: 'sess_multi',
      instanceId: 'inst_multi',
      intentId: 'intent_second',
    }));

    const updated = await ledgerStore.recordBreadcrumb('sess_multi', {
      intentId: 'intent_first',
      stepId: 'intent_first:step:collect',
      status: 'running',
      message: 'Returning to the first intent',
    });

    expect(updated.activeIntentId).toBe('intent_first');
    expect(updated.latestPlan?.intentId).toBe('intent_first');
    expect(updated.latestPlan?.latestBreadcrumb).toBe('Returning to the first intent');

    const receiptUpdated = await ledgerStore.recordReceipt('sess_multi', {
      intentId: 'intent_second',
      stepId: 'intent_second:step:collect',
      note: 'Second intent checkpoint',
    });

    expect(receiptUpdated.activeIntentId).toBe('intent_second');
    expect(receiptUpdated.latestPlan?.intentId).toBe('intent_second');
    expect(receiptUpdated.latestPlan?.latestReceipt).toBe('Second intent checkpoint');
  });

  it('persists dispatcher-owned step updates through the store without raw snapshot writes', async () => {
    const sessionStore = new FileSessionStore(rootDir);
    await sessionStore.save(createSessionSnapshot('sess_dispatch_store'));

    const ledgerStore = new SessionIntentDelegationStore(sessionStore);
    const plan = createPlanDraft({
      sessionId: 'sess_dispatch_store',
      instanceId: 'inst_dispatch_store',
      intentId: 'intent_dispatch_store',
    });
    await ledgerStore.appendIntent('sess_dispatch_store', plan);

    const running = applyIntentStepUpdate(createIntentLedgerRecord(plan, 100), {
      stepId: 'intent_dispatch_store:step:collect',
      status: 'running',
      now: 101,
    });
    const completed = applyIntentStepUpdate(running, {
      stepId: 'intent_dispatch_store:step:collect',
      status: 'completed',
      now: 102,
    });

    const saved = await ledgerStore.saveDispatchedIntent('sess_dispatch_store', completed);
    expect(saved.latestPlan).toMatchObject({
      intentId: 'intent_dispatch_store',
      activeStepId: 'intent_dispatch_store:step:compose',
      overallStatus: 'executing',
    });
    expect(saved.intents[0]?.steps.find((step) => step.stepId === 'intent_dispatch_store:step:collect')?.status).toBe('completed');
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
  return {
    instanceId: input.instanceId,
    intentId: input.intentId,
    sessionId: input.sessionId,
    rawIntent: 'Write a proposal',
    normalizedIntent: 'write a proposal',
    intentType: 'generate',
    deliverable: 'proposal',
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
