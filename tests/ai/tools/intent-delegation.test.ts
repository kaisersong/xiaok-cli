import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IntentPlanDraft, PlannedStep, RiskTier } from '../../../src/ai/intent-delegation/types.js';
import { FileSessionStore } from '../../../src/ai/runtime/session-store.js';
import { createIntentDelegationTools } from '../../../src/ai/tools/intent-delegation.js';
import { markSessionOwned } from '../../../src/runtime/intent-delegation/ownership.js';
import { SessionIntentDelegationStore, appendIntentToLedger, createEmptySessionIntentLedger } from '../../../src/runtime/intent-delegation/store.js';

describe('intent delegation tools', () => {
  let rootDir: string;

  beforeEach(() => {
    rootDir = join(tmpdir(), `xiaok-intent-tools-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(rootDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(rootDir, { recursive: true, force: true });
  });

  it('exposes only native intent-delegation tools and persists intent state', async () => {
    const sessionStore = new FileSessionStore(rootDir);
    await sessionStore.save(createSessionSnapshot('sess_1'));
    const ledgerStore = new SessionIntentDelegationStore(sessionStore);
    const tools = new Map(
      createIntentDelegationTools({ ledgerStore, sessionId: 'sess_1' }).map((tool) => [tool.definition.name, tool]),
    );

    expect([...tools.keys()]).toEqual(expect.arrayContaining([
      'intent_create',
      'intent_step_update',
      'intent_stage_artifact',
      'intent_salvage',
    ]));
    expect([...tools.keys()]).not.toEqual(expect.arrayContaining(['task_create', 'task_update', 'task_list', 'task_get']));

    const created = JSON.parse(await tools.get('intent_create')!.execute({
      instance_id: 'inst_1',
      session_id: 'sess_1',
      raw_intent: 'Write a customer proposal',
      normalized_intent: 'write a customer proposal',
      intent_type: 'generate',
      deliverable: 'proposal draft',
      explicit_constraints: ['use Chinese'],
      delegation_boundary: ['do not send externally'],
      risk_tier: 'medium',
      template_id: 'generate_v1',
    })) as { intentId: string; activeStepId: string; overallStatus: string };

    expect(created.intentId).toContain('intent_');
    expect(created.activeStepId).toContain(':step:collect');
    expect(created.overallStatus).toBe('drafting_plan');

    const running = JSON.parse(await tools.get('intent_step_update')!.execute({
      instance_id: 'inst_1',
      session_id: 'sess_1',
      intent_id: created.intentId,
      active_step_id: created.activeStepId,
      step_status: 'running',
      breadcrumb: 'Collecting source materials',
    })) as { overallStatus: string; latestBreadcrumb: string };

    expect(running.overallStatus).toBe('executing');
    expect(running.latestBreadcrumb).toBe('Collecting source materials');

    const artifacted = JSON.parse(await tools.get('intent_stage_artifact')!.execute({
      instance_id: 'inst_1',
      session_id: 'sess_1',
      intent_id: created.intentId,
      stage_id: running.activeStageId,
      label: 'proposal.md',
      kind: 'markdown',
      storage: 'file_ref',
      path: '/tmp/proposal.md',
      summary: 'normalized markdown draft',
      structural_validation: 'passed',
      semantic_validation: 'pending',
    })) as { artifacts?: Array<{ label: string; path?: string }> };

    expect(artifacted.artifacts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        label: 'proposal.md',
        path: '/tmp/proposal.md',
      }),
    ]));

    const salvaged = JSON.parse(await tools.get('intent_salvage')!.execute({
      instance_id: 'inst_1',
      session_id: 'sess_1',
      intent_id: created.intentId,
      summary: ['materials normalized', 'outline drafted'],
      reason: 'missing_material',
    })) as { salvageSummary: string[] };

    expect(salvaged.salvageSummary).toEqual(['materials normalized', 'outline drafted']);

    const reloaded = await ledgerStore.load('sess_1');
    expect(reloaded?.activeIntentId).toBe(created.intentId);
    expect(reloaded?.latestPlan?.latestBreadcrumb).toBe('Collecting source materials');
    expect(reloaded?.latestPlan?.artifacts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        label: 'proposal.md',
        kind: 'markdown',
      }),
    ]));
    expect(reloaded?.latestPlan?.salvageSummary).toEqual(['materials normalized', 'outline drafted']);
  });

  it('persists dispatcher-owned step transitions through the store boundary', async () => {
    const sessionStore = new FileSessionStore(rootDir);
    await sessionStore.save(createSessionSnapshot('sess_2'));
    const ledgerStore = new SessionIntentDelegationStore(sessionStore);
    const tools = new Map(
      createIntentDelegationTools({ ledgerStore, sessionId: 'sess_2' }).map((tool) => [tool.definition.name, tool]),
    );

    const created = JSON.parse(await tools.get('intent_create')!.execute({
      instance_id: 'inst_2',
      session_id: 'sess_2',
      raw_intent: 'Write a customer proposal',
      normalized_intent: 'write a customer proposal',
      intent_type: 'generate',
      deliverable: 'proposal draft',
      risk_tier: 'medium',
      template_id: 'generate_v1',
    })) as { intentId: string; activeStepId: string };

    await tools.get('intent_step_update')!.execute({
      instance_id: 'inst_2',
      session_id: 'sess_2',
      intent_id: created.intentId,
      active_step_id: created.activeStepId,
      step_status: 'running',
      breadcrumb: 'Collecting source materials',
    });

    const completed = JSON.parse(await tools.get('intent_step_update')!.execute({
      instance_id: 'inst_2',
      session_id: 'sess_2',
      intent_id: created.intentId,
      active_step_id: created.activeStepId,
      step_status: 'completed',
      breadcrumb: 'Collected source materials',
    })) as { activeStepId: string; steps: Array<{ stepId: string; status: string }> };

    expect(completed.activeStepId).toMatch(/:step:normalize$/);
    expect(completed.steps.find((step) => step.stepId === created.activeStepId)?.status).toBe('completed');
  });

  it('uses the scoped session and instance even when the model sends stale identifiers', async () => {
    const sessionStore = new FileSessionStore(rootDir);
    await sessionStore.save(createSessionSnapshot('sess_scoped'));
    const ledgerStore = new SessionIntentDelegationStore(sessionStore);
    const tools = new Map(
      createIntentDelegationTools({
        ledgerStore,
        sessionId: 'sess_scoped',
        instanceId: 'inst_scoped',
      }).map((tool) => [tool.definition.name, tool]),
    );

    const created = JSON.parse(await tools.get('intent_create')!.execute({
      instance_id: 'session_001',
      session_id: 'session_001',
      raw_intent: 'Write a customer proposal',
      normalized_intent: 'write a customer proposal',
      intent_type: 'generate',
      deliverable: 'proposal draft',
      risk_tier: 'medium',
      template_id: 'generate_v1',
    })) as { sessionId: string; instanceId: string; intentId: string; activeStepId: string };

    expect(created.sessionId).toBe('sess_scoped');
    expect(created.instanceId).toBe('inst_scoped');

    const running = JSON.parse(await tools.get('intent_step_update')!.execute({
      instance_id: 'session_001',
      session_id: 'session_001',
      intent_id: created.intentId,
      active_step_id: created.activeStepId,
      step_status: 'running',
      breadcrumb: 'Collecting source materials',
    })) as { overallStatus: string };

    expect(running.overallStatus).toBe('executing');
  });

  it('rejects intent_create when the caller does not own the session', async () => {
    const sessionStore = new FileSessionStore(rootDir);
    await sessionStore.save({
      ...createSessionSnapshot('sess_owned_create'),
      intentDelegation: markSessionOwned(createEmptySessionIntentLedger('sess_owned_create', 100), 'inst_owner', 101),
    });
    const ledgerStore = new SessionIntentDelegationStore(sessionStore);
    const tools = new Map(
      createIntentDelegationTools({ ledgerStore, sessionId: 'sess_owned_create' }).map((tool) => [tool.definition.name, tool]),
    );

    await expect(tools.get('intent_create')!.execute({
      instance_id: 'inst_intruder',
      session_id: 'sess_owned_create',
      raw_intent: 'Write a customer proposal',
      normalized_intent: 'write a customer proposal',
      intent_type: 'generate',
      deliverable: 'proposal draft',
      risk_tier: 'medium',
      template_id: 'generate_v1',
    })).rejects.toThrow(/owned by inst_owner|owner instance/i);
  });

  it('rejects intent_step_update when the caller does not own the session', async () => {
    const sessionStore = new FileSessionStore(rootDir);
    const ledger = markSessionOwned(
      appendIntentToLedger(
        createEmptySessionIntentLedger('sess_owned_update', 100),
        createPlanDraft({
          sessionId: 'sess_owned_update',
          instanceId: 'inst_owner',
          intentId: 'intent_owned_update',
        }),
        101,
      ),
      'inst_owner',
      102,
    );
    await sessionStore.save({
      ...createSessionSnapshot('sess_owned_update'),
      intentDelegation: ledger,
    });
    const ledgerStore = new SessionIntentDelegationStore(sessionStore);
    const tools = new Map(
      createIntentDelegationTools({ ledgerStore, sessionId: 'sess_owned_update' }).map((tool) => [tool.definition.name, tool]),
    );

    await expect(tools.get('intent_step_update')!.execute({
      instance_id: 'inst_intruder',
      session_id: 'sess_owned_update',
      intent_id: 'intent_owned_update',
      active_step_id: 'intent_owned_update:step:collect',
      step_status: 'running',
      breadcrumb: 'Trying to write into another instance session',
    })).rejects.toThrow(/owned by inst_owner|owner instance/i);
  });

  it('rejects intent_salvage when the caller does not own the session', async () => {
    const sessionStore = new FileSessionStore(rootDir);
    const ledger = markSessionOwned(
      appendIntentToLedger(
        createEmptySessionIntentLedger('sess_owned_salvage', 100),
        createPlanDraft({
          sessionId: 'sess_owned_salvage',
          instanceId: 'inst_owner',
          intentId: 'intent_owned_salvage',
        }),
        101,
      ),
      'inst_owner',
      102,
    );
    await sessionStore.save({
      ...createSessionSnapshot('sess_owned_salvage'),
      intentDelegation: ledger,
    });
    const ledgerStore = new SessionIntentDelegationStore(sessionStore);
    const tools = new Map(
      createIntentDelegationTools({ ledgerStore, sessionId: 'sess_owned_salvage' }).map((tool) => [tool.definition.name, tool]),
    );

    await expect(tools.get('intent_salvage')!.execute({
      instance_id: 'inst_intruder',
      session_id: 'sess_owned_salvage',
      intent_id: 'intent_owned_salvage',
      summary: ['draft outline'],
    })).rejects.toThrow(/owned by inst_owner|owner instance/i);
  });

  it('reuses the active intent when continuation_mode is continue_active', async () => {
    const sessionStore = new FileSessionStore(rootDir);
    const ledger = markSessionOwned(
      appendIntentToLedger(
        createEmptySessionIntentLedger('sess_continue', 100),
        createPlanDraft({
          sessionId: 'sess_continue',
          instanceId: 'inst_continue',
          intentId: 'intent_active',
          rawIntent: 'Write a customer proposal',
          normalizedIntent: 'write a customer proposal',
          deliverable: 'proposal draft',
        }),
        101,
      ),
      'inst_continue',
      102,
    );
    await sessionStore.save({
      ...createSessionSnapshot('sess_continue'),
      intentDelegation: ledger,
    });
    const ledgerStore = new SessionIntentDelegationStore(sessionStore);
    const tools = new Map(
      createIntentDelegationTools({ ledgerStore, sessionId: 'sess_continue' }).map((tool) => [tool.definition.name, tool]),
    );

    const continued = JSON.parse(await tools.get('intent_create')!.execute({
      instance_id: 'inst_continue',
      session_id: 'sess_continue',
      raw_intent: 'Continue the same proposal with a finance angle',
      normalized_intent: 'continue the same proposal with a finance angle',
      intent_type: 'revise',
      deliverable: 'proposal draft',
      risk_tier: 'medium',
      template_id: 'revise_v1',
      continuation_mode: 'continue_active',
    })) as { intentId: string; rawIntent: string; templateId: string };

    expect(continued.intentId).toBe('intent_active');
    expect(continued.rawIntent).toBe('Continue the same proposal with a finance angle');
    expect(continued.templateId).toBe('revise_v1');

    const reloaded = await ledgerStore.load('sess_continue');
    expect(reloaded?.activeIntentId).toBe('intent_active');
    expect(reloaded?.intents).toHaveLength(1);
    expect(reloaded?.latestPlan?.intentId).toBe('intent_active');
    expect(reloaded?.latestPlan?.rawIntent).toBe('Continue the same proposal with a finance angle');
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
  rawIntent?: string;
  normalizedIntent?: string;
  deliverable?: string;
  riskTier?: RiskTier;
}): IntentPlanDraft {
  const riskTier = input.riskTier ?? 'medium';
  return {
    instanceId: input.instanceId,
    intentId: input.intentId,
    sessionId: input.sessionId,
    rawIntent: input.rawIntent ?? 'Write a proposal',
    normalizedIntent: input.normalizedIntent ?? 'write a proposal',
    intentType: 'generate',
    deliverable: input.deliverable ?? 'proposal draft',
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
