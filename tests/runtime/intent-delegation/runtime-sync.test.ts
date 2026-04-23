import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileSessionStore } from '../../../src/ai/runtime/session-store.js';
import { createIntentDelegationTools } from '../../../src/ai/tools/intent-delegation.js';
import { createRuntimeHooks } from '../../../src/runtime/hooks.js';
import { wireIntentDelegationToRuntimeSync } from '../../../src/runtime/intent-delegation/runtime-sync.js';
import { SessionIntentDelegationStore } from '../../../src/runtime/intent-delegation/store.js';

describe('intent delegation runtime sync', () => {
  let rootDir: string;

  beforeEach(() => {
    rootDir = join(tmpdir(), `xiaok-intent-runtime-sync-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(rootDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(rootDir, { recursive: true, force: true });
  });

  it('emits trace events from real runtime tool events and keeps failure lifecycle updates', async () => {
    const sessionStore = new FileSessionStore(rootDir);
    await sessionStore.save(createSessionSnapshot('sess_1'));
    const ledgerStore = new SessionIntentDelegationStore(sessionStore);
    const tools = new Map(
      createIntentDelegationTools({ ledgerStore, sessionId: 'sess_1' }).map((tool) => [tool.definition.name, tool]),
    );
    const hooks = createRuntimeHooks();
    const emittedTypes: string[] = [];
    hooks.onAny((event) => {
      emittedTypes.push(event.type);
    });

    wireIntentDelegationToRuntimeSync({
      hooks,
      ledgerStore,
      sessionId: 'sess_1',
    });

    const createInput = {
      instance_id: 'inst_1',
      session_id: 'sess_1',
      raw_intent: 'Write a proposal',
      normalized_intent: 'write a proposal',
      intent_type: 'generate',
      deliverable: 'proposal draft',
      explicit_constraints: ['use Chinese'],
      delegation_boundary: ['do not send externally'],
      risk_tier: 'medium',
      template_id: 'generate_v1',
    };
    hooks.emit({
      type: 'tool_started',
      sessionId: 'sess_1',
      turnId: 'turn_1',
      toolName: 'intent_create',
      toolInput: createInput,
    });
    const createdResponse = await tools.get('intent_create')!.execute(createInput);
    const created = JSON.parse(createdResponse) as { intentId: string; activeStepId: string; activeStageId: string };
    hooks.emit({
      type: 'tool_finished',
      sessionId: 'sess_1',
      turnId: 'turn_1',
      toolName: 'intent_create',
      ok: true,
    });
    await flush();

    const runningInput = {
      instance_id: 'inst_1',
      session_id: 'sess_1',
      intent_id: created.intentId,
      active_step_id: created.activeStepId,
      step_status: 'running',
      breadcrumb: 'Collecting source materials',
    };
    hooks.emit({
      type: 'tool_started',
      sessionId: 'sess_1',
      turnId: 'turn_1',
      toolName: 'intent_step_update',
      toolInput: runningInput,
    });
    await tools.get('intent_step_update')!.execute(runningInput);
    hooks.emit({
      type: 'tool_finished',
      sessionId: 'sess_1',
      turnId: 'turn_1',
      toolName: 'intent_step_update',
      ok: true,
    });
    await flush();

    const completedInput = {
      instance_id: 'inst_1',
      session_id: 'sess_1',
      intent_id: created.intentId,
      active_step_id: created.activeStepId,
      step_status: 'completed',
      breadcrumb: 'Collected source materials',
      receipt_note: 'Captured three source inputs',
    };
    hooks.emit({
      type: 'tool_started',
      sessionId: 'sess_1',
      turnId: 'turn_1',
      toolName: 'intent_step_update',
      toolInput: completedInput,
    });
    await tools.get('intent_step_update')!.execute(completedInput);
    hooks.emit({
      type: 'tool_finished',
      sessionId: 'sess_1',
      turnId: 'turn_1',
      toolName: 'intent_step_update',
      ok: true,
    });
    await flush();

    const artifactInput = {
      instance_id: 'inst_1',
      session_id: 'sess_1',
      intent_id: created.intentId,
      stage_id: created.activeStageId,
      label: 'proposal.md',
      kind: 'markdown',
      storage: 'file_ref',
      path: '/tmp/proposal.md',
      structural_validation: 'passed',
      semantic_validation: 'pending',
    };
    hooks.emit({
      type: 'tool_started',
      sessionId: 'sess_1',
      turnId: 'turn_1',
      toolName: 'intent_stage_artifact',
      toolInput: artifactInput,
    });
    await tools.get('intent_stage_artifact')!.execute(artifactInput);
    hooks.emit({
      type: 'tool_finished',
      sessionId: 'sess_1',
      turnId: 'turn_1',
      toolName: 'intent_stage_artifact',
      ok: true,
    });
    await flush();

    const salvageInput = {
      instance_id: 'inst_1',
      session_id: 'sess_1',
      intent_id: created.intentId,
      summary: ['materials normalized', 'outline drafted'],
      reason: 'missing_material',
    };
    hooks.emit({
      type: 'tool_started',
      sessionId: 'sess_1',
      turnId: 'turn_1',
      toolName: 'intent_salvage',
      toolInput: salvageInput,
    });
    await tools.get('intent_salvage')!.execute(salvageInput);
    hooks.emit({
      type: 'tool_finished',
      sessionId: 'sess_1',
      turnId: 'turn_1',
      toolName: 'intent_salvage',
      ok: true,
    });
    await flush();

    hooks.emit({
      type: 'tool_finished',
      sessionId: 'sess_1',
      turnId: 'turn_1',
      toolName: 'read',
      ok: false,
    });
    await settleAsyncStoreWork();

    expect(emittedTypes).toEqual(expect.arrayContaining([
      'intent_created',
      'step_activated',
      'artifact_recorded',
      'breadcrumb_emitted',
      'receipt_emitted',
      'salvage_emitted',
    ]));

    const ledger = await ledgerStore.load('sess_1');
    expect(ledger?.latestPlan).toMatchObject({
      intentId: created.intentId,
      latestBreadcrumb: 'Collected source materials',
      latestReceipt: 'Captured three source inputs',
      salvageSummary: ['materials normalized', 'outline drafted'],
    });
    expect(ledger?.breadcrumbs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        intentId: created.intentId,
        stepId: created.activeStepId,
        message: 'Collecting source materials',
      }),
      expect.objectContaining({
        intentId: created.intentId,
        stepId: created.activeStepId,
        message: 'Collected source materials',
      }),
    ]));
    expect(ledger?.receipt).toEqual(expect.objectContaining({
      intentId: created.intentId,
      stepId: created.activeStepId,
      note: 'Captured three source inputs',
    }));
    expect(ledger?.latestPlan?.artifacts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        stageId: created.activeStageId,
        label: 'proposal.md',
        kind: 'markdown',
      }),
    ]));
    expect(ledger?.salvage).toEqual(expect.objectContaining({
      intentId: created.intentId,
      reason: 'missing_material',
      summary: ['materials normalized', 'outline drafted'],
    }));
    expect(ledger?.latestPlan?.blockedReason).toBe('tool read returned an error');
  });

  it('does not lose trace events when tool_finished arrives before the async start snapshot resolves', async () => {
    const sessionStore = new FileSessionStore(rootDir);
    await sessionStore.save(createSessionSnapshot('sess_race'));
    const baseStore = new SessionIntentDelegationStore(sessionStore);
    const tools = new Map(
      createIntentDelegationTools({ ledgerStore: baseStore, sessionId: 'sess_race' }).map((tool) => [tool.definition.name, tool]),
    );

    let startLoadReleased = false;
    let loadCount = 0;
    const ledgerStore = {
      ...baseStore,
      load: async (sessionId: string) => {
        loadCount += 1;
        if (loadCount === 1 && !startLoadReleased) {
          await new Promise<void>((resolve) => setTimeout(resolve, 20));
          startLoadReleased = true;
        }
        return baseStore.load(sessionId);
      },
    } as SessionIntentDelegationStore;

    const hooks = createRuntimeHooks();
    const emittedTypes: string[] = [];
    hooks.onAny((event) => {
      emittedTypes.push(event.type);
    });

    wireIntentDelegationToRuntimeSync({
      hooks,
      ledgerStore,
      sessionId: 'sess_race',
    });

    const createInput = {
      instance_id: 'inst_race',
      session_id: 'sess_race',
      raw_intent: 'Write a proposal',
      normalized_intent: 'write a proposal',
      intent_type: 'generate',
      deliverable: 'proposal draft',
      explicit_constraints: ['use Chinese'],
      delegation_boundary: ['do not send externally'],
      risk_tier: 'medium',
      template_id: 'generate_v1',
    };

    hooks.emit({
      type: 'tool_started',
      sessionId: 'sess_race',
      turnId: 'turn_race',
      toolName: 'intent_create',
      toolInput: createInput,
    });

    await tools.get('intent_create')!.execute(createInput);

    hooks.emit({
      type: 'tool_finished',
      sessionId: 'sess_race',
      turnId: 'turn_race',
      toolName: 'intent_create',
      ok: true,
    });

    await new Promise((resolve) => setTimeout(resolve, 40));
    await flush();

    expect(emittedTypes).toContain('intent_created');
  });

  it('does not re-emit stale existing breadcrumbs or receipt on the first cold-start step update', async () => {
    const sessionStore = new FileSessionStore(rootDir);
    const existingLedger = createExistingLedger('sess_existing', 'inst_existing', 'intent_existing');
    await sessionStore.save({
      ...createSessionSnapshot('sess_existing'),
      intentDelegation: existingLedger,
    });
    const baseStore = new SessionIntentDelegationStore(sessionStore);
    const tools = new Map(
      createIntentDelegationTools({ ledgerStore: baseStore, sessionId: 'sess_existing' }).map((tool) => [tool.definition.name, tool]),
    );

    let releaseBootstrap = false;
    let loadCount = 0;
    const ledgerStore = {
      ...baseStore,
      load: async (sessionId: string) => {
        loadCount += 1;
        if (loadCount === 1 && !releaseBootstrap) {
          await new Promise<void>((resolve) => setTimeout(resolve, 20));
          releaseBootstrap = true;
        }
        return baseStore.load(sessionId);
      },
    } as SessionIntentDelegationStore;

    const hooks = createRuntimeHooks();
    const emitted = hooksCollector(hooks);
    wireIntentDelegationToRuntimeSync({
      hooks,
      ledgerStore,
      sessionId: 'sess_existing',
    });

    const input = {
      instance_id: 'inst_existing',
      session_id: 'sess_existing',
      intent_id: 'intent_existing',
      active_step_id: 'intent_existing:step:collect',
      step_status: 'running',
      breadcrumb: 'New breadcrumb after startup',
    };

    hooks.emit({
      type: 'tool_started',
      sessionId: 'sess_existing',
      turnId: 'turn_existing',
      toolName: 'intent_step_update',
      toolInput: input,
    });
    await tools.get('intent_step_update')!.execute(input);
    hooks.emit({
      type: 'tool_finished',
      sessionId: 'sess_existing',
      turnId: 'turn_existing',
      toolName: 'intent_step_update',
      ok: true,
    });

    await new Promise((resolve) => setTimeout(resolve, 40));
    await flush();

    expect(emitted.types.filter((type) => type === 'breadcrumb_emitted')).toHaveLength(1);
    expect(emitted.breadcrumbs).toEqual(['New breadcrumb after startup']);
    expect(emitted.types).not.toContain('receipt_emitted');
    expect(emitted.types).not.toContain('salvage_emitted');
  });

  it('does not re-emit stale existing salvage on the first cold-start salvage write', async () => {
    const sessionStore = new FileSessionStore(rootDir);
    const existingLedger = createExistingLedger('sess_existing_salvage', 'inst_existing', 'intent_existing');
    await sessionStore.save({
      ...createSessionSnapshot('sess_existing_salvage'),
      intentDelegation: existingLedger,
    });
    const baseStore = new SessionIntentDelegationStore(sessionStore);
    const tools = new Map(
      createIntentDelegationTools({ ledgerStore: baseStore, sessionId: 'sess_existing_salvage' }).map((tool) => [tool.definition.name, tool]),
    );

    let releaseBootstrap = false;
    let loadCount = 0;
    const ledgerStore = {
      ...baseStore,
      load: async (sessionId: string) => {
        loadCount += 1;
        if (loadCount === 1 && !releaseBootstrap) {
          await new Promise<void>((resolve) => setTimeout(resolve, 20));
          releaseBootstrap = true;
        }
        return baseStore.load(sessionId);
      },
    } as SessionIntentDelegationStore;

    const hooks = createRuntimeHooks();
    const emitted = hooksCollector(hooks);
    wireIntentDelegationToRuntimeSync({
      hooks,
      ledgerStore,
      sessionId: 'sess_existing_salvage',
    });

    const input = {
      instance_id: 'inst_existing',
      session_id: 'sess_existing_salvage',
      intent_id: 'intent_existing',
      summary: ['fresh salvage after startup'],
      reason: 'missing_material',
    };

    hooks.emit({
      type: 'tool_started',
      sessionId: 'sess_existing_salvage',
      turnId: 'turn_existing_salvage',
      toolName: 'intent_salvage',
      toolInput: input,
    });
    await tools.get('intent_salvage')!.execute(input);
    hooks.emit({
      type: 'tool_finished',
      sessionId: 'sess_existing_salvage',
      turnId: 'turn_existing_salvage',
      toolName: 'intent_salvage',
      ok: true,
    });

    await new Promise((resolve) => setTimeout(resolve, 40));
    await flush();

    expect(emitted.types.filter((type) => type === 'salvage_emitted')).toHaveLength(1);
    expect(emitted.salvageSummaries).toEqual([['fresh salvage after startup']]);
  });

  it('does not attribute unrelated later tool failures to a terminal active intent', async () => {
    const sessionStore = new FileSessionStore(rootDir);
    const existingLedger = createExistingLedger('sess_terminal', 'inst_terminal', 'intent_terminal');
    existingLedger.latestPlan = {
      ...existingLedger.latestPlan!,
      overallStatus: 'completed',
      activeStepId: 'intent_terminal:step:collect',
    };
    existingLedger.intents = existingLedger.intents.map((intent) => ({
      ...intent,
      overallStatus: 'completed',
      activeStepId: 'intent_terminal:step:collect',
    }));
    await sessionStore.save({
      ...createSessionSnapshot('sess_terminal'),
      intentDelegation: existingLedger,
    });

    const ledgerStore = new SessionIntentDelegationStore(sessionStore);
    const hooks = createRuntimeHooks();

    wireIntentDelegationToRuntimeSync({
      hooks,
      ledgerStore,
      sessionId: 'sess_terminal',
    });

    hooks.emit({
      type: 'tool_finished',
      sessionId: 'sess_terminal',
      turnId: 'turn_terminal',
      toolName: 'read',
      ok: false,
    });
    await settleAsyncStoreWork();

    const reloaded = await ledgerStore.load('sess_terminal');
    expect(reloaded?.latestPlan?.overallStatus).toBe('completed');
    expect(reloaded?.latestPlan?.blockedReason).toBeUndefined();
  });

  it('refreshes cached ledger after partial native tool failure before the next intent diff', async () => {
    const sessionStore = new FileSessionStore(rootDir);
    await sessionStore.save(createSessionSnapshot('sess_partial'));
    const baseStore = new SessionIntentDelegationStore(sessionStore);
    const tools = new Map(
      createIntentDelegationTools({ ledgerStore: baseStore, sessionId: 'sess_partial' }).map((tool) => [tool.definition.name, tool]),
    );

    const created = JSON.parse(await tools.get('intent_create')!.execute({
      instance_id: 'inst_partial',
      session_id: 'sess_partial',
      raw_intent: 'Write a proposal',
      normalized_intent: 'write a proposal',
      intent_type: 'generate',
      deliverable: 'proposal draft',
      risk_tier: 'medium',
      template_id: 'generate_v1',
    })) as { intentId: string; activeStepId: string };

    let throwOnBreadcrumb = true;
    const ledgerStore = Object.assign(
      Object.create(Object.getPrototypeOf(baseStore)),
      baseStore,
      {
        load: baseStore.load.bind(baseStore),
        appendIntent: baseStore.appendIntent.bind(baseStore),
        updateIntent: baseStore.updateIntent.bind(baseStore),
        recordReceipt: baseStore.recordReceipt.bind(baseStore),
        recordSalvage: baseStore.recordSalvage.bind(baseStore),
        saveDispatchedIntent: baseStore.saveDispatchedIntent.bind(baseStore),
        recordBreadcrumb: async (...args: Parameters<SessionIntentDelegationStore['recordBreadcrumb']>) => {
          if (throwOnBreadcrumb) {
            throw new Error('breadcrumb write failed');
          }
          return baseStore.recordBreadcrumb(...args);
        },
      },
    ) as SessionIntentDelegationStore;

    const failingTools = new Map(
      createIntentDelegationTools({ ledgerStore, sessionId: 'sess_partial' }).map((tool) => [tool.definition.name, tool]),
    );

    const hooks = createRuntimeHooks();
    const emitted = hooksCollector(hooks);
    wireIntentDelegationToRuntimeSync({
      hooks,
      ledgerStore,
      sessionId: 'sess_partial',
    });

    const failedInput = {
      instance_id: 'inst_partial',
      session_id: 'sess_partial',
      intent_id: created.intentId,
      active_step_id: created.activeStepId,
      step_status: 'running',
      breadcrumb: 'Collecting source materials',
    };

    hooks.emit({
      type: 'tool_started',
      sessionId: 'sess_partial',
      turnId: 'turn_partial_1',
      toolName: 'intent_step_update',
      toolInput: failedInput,
    });
    await expect(failingTools.get('intent_step_update')!.execute(failedInput)).rejects.toThrow('breadcrumb write failed');
    hooks.emit({
      type: 'tool_finished',
      sessionId: 'sess_partial',
      turnId: 'turn_partial_1',
      toolName: 'intent_step_update',
      ok: false,
    });
    await settleAsyncStoreWork();

    throwOnBreadcrumb = false;
    const completedInput = {
      instance_id: 'inst_partial',
      session_id: 'sess_partial',
      intent_id: created.intentId,
      active_step_id: created.activeStepId,
      step_status: 'completed',
      breadcrumb: 'Collected source materials',
      receipt_note: 'Captured three source inputs',
    };

    hooks.emit({
      type: 'tool_started',
      sessionId: 'sess_partial',
      turnId: 'turn_partial_2',
      toolName: 'intent_step_update',
      toolInput: completedInput,
    });
    await failingTools.get('intent_step_update')!.execute(completedInput);
    hooks.emit({
      type: 'tool_finished',
      sessionId: 'sess_partial',
      turnId: 'turn_partial_2',
      toolName: 'intent_step_update',
      ok: true,
    });
    await settleAsyncStoreWork();

    expect(emitted.types.filter((type) => type === 'step_activated')).toHaveLength(0);
    expect(emitted.breadcrumbs).toEqual(['Collected source materials']);
    expect(emitted.types.filter((type) => type === 'receipt_emitted')).toHaveLength(1);
  });
});

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

async function settleAsyncStoreWork(): Promise<void> {
  await flush();
  await new Promise((resolve) => setTimeout(resolve, 20));
  await flush();
}

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

function hooksCollector(hooks: ReturnType<typeof createRuntimeHooks>) {
  const types: string[] = [];
  const breadcrumbs: string[] = [];
  const salvageSummaries: string[][] = [];
  hooks.onAny((event) => {
    types.push(event.type);
    if (event.type === 'breadcrumb_emitted') {
      breadcrumbs.push(event.message);
    }
    if (event.type === 'salvage_emitted') {
      salvageSummaries.push(event.summary);
    }
  });
  return { types, breadcrumbs, salvageSummaries };
}

function createExistingLedger(sessionId: string, instanceId: string, intentId: string) {
  return {
    instanceId,
    sessionId,
    activeIntentId: intentId,
    latestPlan: {
      intentId,
      instanceId,
      sessionId,
      rawIntent: 'Write a proposal',
      normalizedIntent: 'write a proposal',
      intentType: 'generate' as const,
      deliverable: 'proposal draft',
      explicitConstraints: [],
      delegationBoundary: [],
      riskTier: 'medium' as const,
      templateId: 'generate_v1',
      steps: [
        {
          stepId: `${intentId}:step:collect`,
          key: 'collect',
          order: 0,
          role: 'collect' as const,
          skillName: null,
          dependsOn: [],
          status: 'planned' as const,
          riskTier: 'medium' as const,
        },
      ],
      activeStepId: `${intentId}:step:collect`,
      overallStatus: 'drafting_plan' as const,
      attemptCount: 1,
      latestBreadcrumb: 'Old breadcrumb',
      latestReceipt: 'Old receipt',
      salvageSummary: ['old salvage'],
      createdAt: 100,
      updatedAt: 100,
    },
    intents: [{
      intentId,
      instanceId,
      sessionId,
      rawIntent: 'Write a proposal',
      normalizedIntent: 'write a proposal',
      intentType: 'generate' as const,
      deliverable: 'proposal draft',
      explicitConstraints: [],
      delegationBoundary: [],
      riskTier: 'medium' as const,
      templateId: 'generate_v1',
      steps: [
        {
          stepId: `${intentId}:step:collect`,
          key: 'collect',
          order: 0,
          role: 'collect' as const,
          skillName: null,
          dependsOn: [],
          status: 'planned' as const,
          riskTier: 'medium' as const,
        },
      ],
      activeStepId: `${intentId}:step:collect`,
      overallStatus: 'drafting_plan' as const,
      attemptCount: 1,
      latestBreadcrumb: 'Old breadcrumb',
      latestReceipt: 'Old receipt',
      salvageSummary: ['old salvage'],
      createdAt: 100,
      updatedAt: 100,
    }],
    breadcrumbs: [{
      intentId,
      stepId: `${intentId}:step:collect`,
      status: 'running' as const,
      message: 'Old breadcrumb',
      createdAt: 100,
    }],
    receipt: {
      intentId,
      stepId: `${intentId}:step:collect`,
      note: 'Old receipt',
      createdAt: 100,
    },
    salvage: {
      intentId,
      summary: ['old salvage'],
      reason: 'missing_material',
      createdAt: 100,
    },
    ownership: {
      state: 'owned' as const,
      ownerInstanceId: instanceId,
      updatedAt: 100,
    },
    updatedAt: 100,
  };
}
