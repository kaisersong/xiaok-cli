import { describe, expect, it } from 'vitest';
import { bootstrapTurnIntentPlan } from '../../../src/runtime/intent-delegation/chat-bootstrap.js';
import { createEmptySessionIntentLedger } from '../../../src/runtime/intent-delegation/store.js';
import { SessionIntentDelegationStore } from '../../../src/runtime/intent-delegation/store.js';
import type { IntentPlanDraft, PlannedStep, RiskTier } from '../../../src/ai/intent-delegation/types.js';
import type { SessionStore, PersistedSessionSnapshot } from '../../../src/ai/runtime/session-store/store.js';

describe('chat intent bootstrap', () => {
  it('appends a new_intent plan before the turn starts', async () => {
    const sessionId = 'sess_bootstrap';
    const snapshot = createSnapshot(sessionId);
    const store = new StubSessionStore(snapshot);
    const ledgerStore = new SessionIntentDelegationStore(store);
    const plan = createPlanDraft({
      sessionId,
      instanceId: 'inst_bootstrap',
      intentId: 'intent_bootstrap',
      deliverable: '幻灯片',
      continuationMode: 'new_intent',
    });

    const next = await bootstrapTurnIntentPlan(ledgerStore, sessionId, createEmptySessionIntentLedger(sessionId), plan);

    expect(next.activeIntentId).toBe(plan.intentId);
    expect(next.latestPlan?.deliverable).toBe('幻灯片');
    expect(next.intents).toHaveLength(1);
  });

  it('does not bootstrap continue_active plans', async () => {
    const sessionId = 'sess_continue';
    const snapshot = createSnapshot(sessionId);
    const store = new StubSessionStore(snapshot);
    const ledgerStore = new SessionIntentDelegationStore(store);
    const initial = createEmptySessionIntentLedger(sessionId);
    const plan = createPlanDraft({
      sessionId,
      instanceId: 'inst_continue',
      intentId: 'intent_continue',
      continuationMode: 'continue_active',
    });

    const next = await bootstrapTurnIntentPlan(ledgerStore, sessionId, initial, plan);

    expect(next).toEqual(initial);
  });

  it('does not bootstrap ambiguous generate plans without a concrete deliverable', async () => {
    const sessionId = 'sess_ambiguous';
    const snapshot = createSnapshot(sessionId);
    const store = new StubSessionStore(snapshot);
    const ledgerStore = new SessionIntentDelegationStore(store);
    const initial = createEmptySessionIntentLedger(sessionId);
    const plan = createPlanDraft({
      sessionId,
      instanceId: 'inst_ambiguous',
      intentId: 'intent_ambiguous',
      rawIntent: '帮我处理一下这个',
      normalizedIntent: '帮我处理一下这个',
      deliverable: '交付物',
      continuationMode: 'new_intent',
    });

    const next = await bootstrapTurnIntentPlan(ledgerStore, sessionId, initial, plan);

    expect(next).toEqual(initial);
  });
});

class StubSessionStore implements SessionStore {
  constructor(private snapshot: PersistedSessionSnapshot) {}

  async load(sessionId: string): Promise<PersistedSessionSnapshot | null> {
    return this.snapshot.sessionId === sessionId ? structuredClone(this.snapshot) : null;
  }

  async save(snapshot: PersistedSessionSnapshot): Promise<void> {
    this.snapshot = structuredClone(snapshot);
  }

  async loadLast(): Promise<PersistedSessionSnapshot | null> {
    return structuredClone(this.snapshot);
  }

  async list(): Promise<Array<{ sessionId: string; cwd: string; updatedAt: number; preview: string }>> {
    return [{
      sessionId: this.snapshot.sessionId,
      cwd: this.snapshot.cwd,
      updatedAt: this.snapshot.updatedAt,
      preview: '',
    }];
  }

  async fork(sessionId: string): Promise<PersistedSessionSnapshot> {
    const loaded = await this.load(sessionId);
    if (!loaded) {
      throw new Error(`missing session ${sessionId}`);
    }
    return loaded;
  }
}

function createSnapshot(sessionId: string): PersistedSessionSnapshot {
  return {
    sessionId,
    cwd: '/tmp',
    model: 'test-model',
    createdAt: 100,
    updatedAt: 100,
    lineage: [],
    messages: [],
    usage: { inputTokens: 0, outputTokens: 0 },
    compactions: [],
    memoryRefs: [],
    approvalRefs: [],
    backgroundJobRefs: [],
    intentDelegation: createEmptySessionIntentLedger(sessionId, 100),
  };
}

function createPlanDraft(input: {
  sessionId: string;
  instanceId: string;
  intentId: string;
  deliverable?: string;
  rawIntent?: string;
  normalizedIntent?: string;
  continuationMode: IntentPlanDraft['continuationMode'];
  riskTier?: RiskTier;
}): IntentPlanDraft {
  const riskTier = input.riskTier ?? 'low';
  return {
    instanceId: input.instanceId,
    intentId: input.intentId,
    sessionId: input.sessionId,
    rawIntent: input.rawIntent ?? '把这篇文档生成幻灯片 /Users/song/Downloads/x-article-intent-ux.pdf',
    normalizedIntent: input.normalizedIntent ?? '把这篇文档生成幻灯片 /users/song/downloads/x-article-intent-ux pdf',
    intentType: 'generate',
    deliverable: input.deliverable ?? '幻灯片',
    explicitConstraints: [],
    delegationBoundary: [],
    riskTier,
    templateId: 'generate_v1',
    steps: [
      createStep(input.intentId, 0, 'collect', [], riskTier),
      createStep(input.intentId, 1, 'normalize', [`${input.intentId}:step:collect`], riskTier),
      createStep(input.intentId, 2, 'compose', [`${input.intentId}:step:normalize`], riskTier),
      createStep(input.intentId, 3, 'validate', [`${input.intentId}:step:compose`], riskTier),
    ],
    continuationMode: input.continuationMode,
  };
}

function createStep(
  intentId: string,
  order: number,
  key: 'collect' | 'normalize' | 'compose' | 'validate',
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
