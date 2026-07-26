import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Message, UsageStats } from '../../../src/types.js';
import { FileSessionStore, SQLiteSessionStore } from '../../../src/ai/runtime/session-store.js';
import { createFileSessionStore } from '../../../src/ai/runtime/session-store/file-store.js';
import type { SessionStore } from '../../../src/ai/runtime/session-store/store.js';
import { AgentSessionState } from '../../../src/ai/runtime/session.js';
import { createPromptCacheAffinity } from '../../../src/ai/runtime/prompt-cache-affinity.js';
import { createEmptySessionIntentLedger } from '../../../src/runtime/intent-delegation/store.js';
import { createEmptySessionSkillEvalState } from '../../../src/runtime/intent-delegation/skill-eval.js';
import { createEmptySessionSkillExecutionState } from '../../../src/ai/skills/execution-state.js';
import { OpenAIAdapter } from '../../../src/ai/adapters/openai.js';
import {
  buildOpenAIHarnessContext,
  resolveKimiHarnessFeatureFlags,
} from '../../../src/ai/providers/model-harness-profile.js';

function preservedThinkingRoundTripMessages(): Message[] {
  return [
    {
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: 'non-empty reasoning' },
        { type: 'text', text: 'first answer' },
      ],
    },
    {
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: ' \n\t ' },
        { type: 'text', text: 'second answer' },
      ],
    },
    {
      role: 'assistant',
      content: [{ type: 'text', text: 'empty backfill answer' }],
    },
    {
      role: 'assistant',
      content: [{
        type: 'tool_use',
        id: 'tu_round_trip',
        name: 'search',
        input: { q: 'round trip' },
      }],
    },
  ];
}

async function serializeResumedKimiMessages(
  messages: Message[],
): Promise<Array<Record<string, unknown>>> {
  const adapter = new OpenAIAdapter({
    apiKey: 'test-key',
    kimiCodingHeadersApplied: true,
    harnessContext: buildOpenAIHarnessContext({
      identity: {
        providerId: 'kimi',
        providerType: 'first_party',
        protocol: 'openai_legacy',
        canonicalBaseUrl: 'https://api.kimi.com/coding/v1',
        wireModel: 'k3',
        capabilities: ['tools', 'thinking'],
      },
      flags: resolveKimiHarnessFeatureFlags({
        XIAOK_EXPERIMENTAL_KIMI_PRESERVED_THINKING: '1',
      }),
    }),
  });
  let captured: { messages: Array<Record<string, unknown>> } | undefined;
  const client = {
    chat: {
      completions: {
        create: async (request: { messages: Array<Record<string, unknown>> }) => {
          captured = request;
          return {
            async *[Symbol.asyncIterator]() {
              yield { choices: [{ delta: {}, finish_reason: 'stop' }] };
            },
          };
        },
      },
    },
  };
  (adapter as unknown as { client: typeof client }).client = client;

  try {
    for await (const _ of adapter.stream(messages, [], 'system')) { /* consume */ }
  } finally {
    adapter.dispose();
  }
  if (!captured) {
    throw new Error('Kimi request was not captured');
  }
  return captured.messages;
}

const FORK_INTENT_LEDGER_STORES: Array<{
  label: string;
  create(rootDir: string): {
    store: SessionStore;
    dispose(): void;
  };
}> = [
  {
    label: 'FileSessionStore',
    create(rootDir) {
      return {
        store: new FileSessionStore(rootDir),
        dispose() {},
      };
    },
  },
  {
    label: 'SQLiteSessionStore',
    create(rootDir) {
      const store = new SQLiteSessionStore(join(rootDir, 'fork-parity.db'));
      return {
        store,
        dispose: () => store.dispose(),
      };
    },
  },
];

describe('FileSessionStore', () => {
  let rootDir: string;

  beforeEach(() => {
    rootDir = join(tmpdir(), `xiaok-session-store-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(rootDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(rootDir, { recursive: true, force: true });
  });

  it('saves and loads a session snapshot', async () => {
    const store = new FileSessionStore(rootDir);
    const messages: Message[] = [
      { role: 'user', content: [{ type: 'text', text: 'hello' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'world' }] },
    ];
    const usage: UsageStats = { inputTokens: 10, outputTokens: 5 };

    await store.save({
      sessionId: 'sess_alpha',
      cwd: 'D:/projects/workspace/xiaok-cli',
      model: 'claude-opus-4-6',
      createdAt: 100,
      updatedAt: 200,
      lineage: ['sess_alpha'],
      messages,
      usage,
      compactions: [],
      memoryRefs: [],
      approvalRefs: [],
      backgroundJobRefs: [],
      skillExecution: createEmptySessionSkillExecutionState(200),
    });

    await expect(store.load('sess_alpha')).resolves.toEqual({
      sessionId: 'sess_alpha',
      cwd: 'D:/projects/workspace/xiaok-cli',
      model: 'claude-opus-4-6',
      createdAt: 100,
      updatedAt: 200,
      lineage: ['sess_alpha'],
      messages,
      usage,
      compactions: [],
      memoryRefs: [],
      approvalRefs: [],
      backgroundJobRefs: [],
      skillExecution: createEmptySessionSkillExecutionState(200),
    });
  });

  it('creates, lists, loads, resumes, and forks full UUID session IDs', async () => {
    const store = new FileSessionStore(rootDir);
    const sessionId = store.createSessionId();
    const secondNewSessionId = store.createSessionId();

    expect(sessionId).toMatch(
      /^sess_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );

    await store.save({
      sessionId,
      cwd: '/uuid-round-trip',
      createdAt: 100,
      updatedAt: 200,
      lineage: [sessionId],
      messages: [{ role: 'user', content: [{ type: 'text', text: 'uuid preview' }] }],
      usage: { inputTokens: 1, outputTokens: 2 },
      compactions: [],
      memoryRefs: [],
      approvalRefs: [],
      backgroundJobRefs: [],
    });

    await expect(store.load(sessionId)).resolves.toMatchObject({ sessionId });
    await expect(store.loadLast()).resolves.toMatchObject({ sessionId });
    await expect(store.list()).resolves.toEqual([
      expect.objectContaining({ sessionId, preview: 'uuid preview' }),
    ]);

    const forked = await store.fork(sessionId);
    expect(forked.sessionId).toMatch(
      /^sess_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(forked.sessionId).not.toBe(sessionId);
    expect(forked.forkedFromSessionId).toBe(sessionId);
    await expect(store.load(forked.sessionId)).resolves.toMatchObject({
      sessionId: forked.sessionId,
      forkedFromSessionId: sessionId,
    });
    expect(createPromptCacheAffinity(secondNewSessionId))
      .not.toBe(createPromptCacheAffinity(sessionId));
    expect(createPromptCacheAffinity(forked.sessionId))
      .not.toBe(createPromptCacheAffinity(sessionId));
    expect(createPromptCacheAffinity(forked.sessionId))
      .not.toBe(createPromptCacheAffinity(secondNewSessionId));
  });

  it('keeps legacy session IDs loadable without rewriting them', async () => {
    const store = new FileSessionStore(rootDir);
    await store.save({
      sessionId: 'sess_1',
      cwd: '/legacy',
      createdAt: 100,
      updatedAt: 200,
      lineage: ['sess_1'],
      messages: [],
      usage: { inputTokens: 0, outputTokens: 0 },
      compactions: [],
      memoryRefs: [],
      approvalRefs: [],
      backgroundJobRefs: [],
    });

    await expect(store.load('sess_1')).resolves.toMatchObject({
      sessionId: 'sess_1',
      lineage: ['sess_1'],
    });
  });

  it('round-trips a real applied compaction through save, load, and restore', async () => {
    const store = new FileSessionStore(rootDir);
    const state = new AgentSessionState();
    state.appendUserText(`old request ${'a'.repeat(10_000)}`);
    state.appendAssistantBlocks([{ type: 'text', text: `old answer ${'b'.repeat(10_000)}` }]);
    state.appendUserText('recent request');
    state.appendAssistantBlocks([{ type: 'text', text: 'recent answer' }]);
    const outcome = state.applyCompaction(
      state.planCompaction(),
      'LLM summary: preserve /tmp/report.html',
    );
    expect(outcome.status).toBe('compacted');

    await store.save({
      ...state.exportSnapshot(),
      sessionId: 'sess_compacted',
      cwd: 'D:/projects/workspace/xiaok-cli',
      model: 'mock',
      createdAt: 100,
      updatedAt: 200,
      lineage: ['sess_compacted'],
    });
    const loaded = await store.load('sess_compacted');
    expect(loaded).not.toBeNull();

    const resumed = new AgentSessionState();
    resumed.restoreSnapshot(loaded!);

    expect((resumed.getMessages()[0]!.content[0] as { type: 'text'; text: string }).text)
      .toBe('LLM summary: preserve /tmp/report.html');
    expect(resumed.getCompactions()).toEqual([outcome.record]);
    expect(resumed.planCompaction().invalidReason).toBeUndefined();
  });

  it('round-trips preserved Kimi reasoning through file save, restore, and serialization', async () => {
    const store = new FileSessionStore(rootDir);
    const messages = preservedThinkingRoundTripMessages();
    await store.save({
      sessionId: 'sess_kimi_file_round_trip',
      cwd: 'D:/projects/workspace/xiaok-cli',
      model: 'k3',
      createdAt: 100,
      updatedAt: 200,
      lineage: ['sess_kimi_file_round_trip'],
      messages,
      usage: { inputTokens: 10, outputTokens: 5 },
      compactions: [],
      memoryRefs: [],
      approvalRefs: [],
      backgroundJobRefs: [],
    });

    const loaded = await store.load('sess_kimi_file_round_trip');
    expect(loaded).not.toBeNull();
    const resumed = new AgentSessionState();
    resumed.restoreSnapshot(loaded!);
    const wireMessages = await serializeResumedKimiMessages(resumed.getMessages());
    const assistants = wireMessages.filter((message) => message.role === 'assistant');

    expect(assistants.map((message) => message.reasoning_content)).toEqual([
      'non-empty reasoning',
      ' \n\t ',
      '',
      '',
    ]);
    expect(assistants[2]).toHaveProperty('content', 'empty backfill answer');
    expect(assistants[3]?.tool_calls).toHaveLength(1);
    expect(Object.hasOwn(assistants[3]!, 'content')).toBe(false);
  });

  it('lists saved sessions ordered by most recent update', async () => {
    const store = new FileSessionStore(rootDir);
    const lexicallyLaterButOlder = 'sess_ffffffff-ffff-4fff-8fff-ffffffffffff';
    const lexicallyEarlierButNewer = 'sess_00000000-0000-4000-8000-000000000000';

    await store.save({
      sessionId: lexicallyLaterButOlder,
      cwd: 'D:/projects/old',
      createdAt: 100,
      updatedAt: 110,
      lineage: [lexicallyLaterButOlder],
      messages: [],
      usage: { inputTokens: 0, outputTokens: 0 },
      compactions: [],
      memoryRefs: [],
      approvalRefs: [],
      backgroundJobRefs: [],
    });
    await store.save({
      sessionId: lexicallyEarlierButNewer,
      cwd: 'D:/projects/new',
      createdAt: 120,
      updatedAt: 220,
      lineage: [lexicallyEarlierButNewer],
      messages: [{ role: 'user', content: [{ type: 'text', text: 'latest' }] }],
      usage: { inputTokens: 3, outputTokens: 1 },
      compactions: [],
      memoryRefs: [],
      approvalRefs: [],
      backgroundJobRefs: [],
    });

    await expect(store.list()).resolves.toEqual([
      {
        sessionId: lexicallyEarlierButNewer,
        cwd: 'D:/projects/new',
        updatedAt: 220,
        preview: 'latest',
      },
      {
        sessionId: lexicallyLaterButOlder,
        cwd: 'D:/projects/old',
        updatedAt: 110,
        preview: '',
      },
    ]);
  });

  it('forks an existing session into a new snapshot', async () => {
    const store = new FileSessionStore(rootDir);

    await store.save({
      sessionId: 'sess_source',
      cwd: 'D:/projects/source',
      model: 'claude-opus-4-6',
      createdAt: 100,
      updatedAt: 200,
      lineage: ['sess_source'],
      messages: [{ role: 'assistant', content: [{ type: 'text', text: 'original' }] }],
      usage: { inputTokens: 7, outputTokens: 9 },
      compactions: [{ id: 'cmp_1', createdAt: 150, summary: 'summary', replacedMessages: 2 }],
      promptSnapshotId: 'prompt_1',
      memoryRefs: ['mem_1'],
      approvalRefs: ['apr_1'],
      backgroundJobRefs: ['bg_1'],
      skillExecution: {
        invocations: [{
          invocationId: 'skill_inv_1',
          sessionId: 'sess_source',
          agentId: 'main',
          skillName: 'release-checklist',
          requested: ['release-checklist'],
          strategy: 'inline',
          strictMode: true,
          bundleHash: 'hash',
          status: 'completed',
          plan: {
            type: 'skill_plan',
            requested: ['release-checklist'],
            strategy: 'inline',
            primarySkill: 'release-checklist',
            strict: true,
            resolved: [],
          },
          evidence: [{
            type: 'step_completed',
            invocationId: 'skill_inv_1',
            agentId: 'main',
            stepId: 'read_skill',
            createdAt: 160,
          }],
          createdAt: 150,
          updatedAt: 160,
          compliance: {
            passed: true,
            missingReferences: [],
            missingScripts: [],
            missingSteps: [],
            failedChecks: [],
            checkedAt: 160,
          },
        }],
        updatedAt: 160,
      },
    });

    const forked = await store.fork('sess_source');

    expect(forked.sessionId).not.toBe('sess_source');
    expect(forked.forkedFromSessionId).toBe('sess_source');
    expect(forked.lineage).toEqual(['sess_source']);
    expect(forked.messages).toEqual([
      { role: 'assistant', content: [{ type: 'text', text: 'original' }] },
    ]);
    expect(forked.usage).toEqual({ inputTokens: 7, outputTokens: 9 });
    expect(forked.compactions).toEqual([{ id: 'cmp_1', createdAt: 150, summary: 'summary', replacedMessages: 2 }]);
    expect(forked.promptSnapshotId).toBe('prompt_1');
    expect(forked.memoryRefs).toEqual(['mem_1']);
    expect(forked.approvalRefs).toEqual(['apr_1']);
    expect(forked.backgroundJobRefs).toEqual(['bg_1']);
    expect(forked.skillExecution?.invocations[0]?.skillName).toBe('release-checklist');
  });

  it.each(FORK_INTENT_LEDGER_STORES)(
    'rekeys nested intent delegation session identities when forking with $label',
    async ({ create }) => {
      const { store, dispose } = create(rootDir);
      try {
        await store.save({
          sessionId: 'sess_nested',
          cwd: '/nested',
          createdAt: 100,
          updatedAt: 200,
          lineage: ['sess_nested'],
          messages: [],
          usage: { inputTokens: 0, outputTokens: 0 },
          compactions: [],
          memoryRefs: [],
          approvalRefs: [],
          backgroundJobRefs: [],
          intentDelegation: {
            instanceId: 'inst_nested',
            sessionId: 'sess_nested',
            activeIntentId: 'intent_nested',
            latestPlan: {
              intentId: 'intent_nested',
              instanceId: 'inst_nested',
              sessionId: 'sess_nested',
              rawIntent: 'Write summary',
              normalizedIntent: 'write summary',
              intentType: 'generate',
              deliverable: 'summary',
              explicitConstraints: [],
              delegationBoundary: [],
              riskTier: 'medium',
              templateId: 'tpl_generate',
              steps: [
                {
                  stepId: 'intent_nested:step:collect',
                  key: 'collect',
                  order: 0,
                  role: 'collect',
                  skillName: null,
                  dependsOn: [],
                  status: 'planned',
                  riskTier: 'medium',
                },
              ],
              activeStepId: 'intent_nested:step:collect',
              overallStatus: 'drafting_plan',
              attemptCount: 1,
              createdAt: 100,
              updatedAt: 200,
            },
            intents: [{
              intentId: 'intent_nested',
              instanceId: 'inst_nested',
              sessionId: 'sess_nested',
              rawIntent: 'Write summary',
              normalizedIntent: 'write summary',
              intentType: 'generate',
              deliverable: 'summary',
              explicitConstraints: [],
              delegationBoundary: [],
              riskTier: 'medium',
              templateId: 'tpl_generate',
              steps: [
                {
                  stepId: 'intent_nested:step:collect',
                  key: 'collect',
                  order: 0,
                  role: 'collect',
                  skillName: null,
                  dependsOn: [],
                  status: 'planned',
                  riskTier: 'medium',
                },
              ],
              activeStepId: 'intent_nested:step:collect',
              overallStatus: 'drafting_plan',
              attemptCount: 1,
              createdAt: 100,
              updatedAt: 200,
            }],
            breadcrumbs: [],
            receipt: null,
            salvage: null,
            ownership: {
              state: 'released',
              previousOwnerInstanceId: 'inst_nested',
              updatedAt: 200,
            },
            updatedAt: 200,
          },
        });

        const forked = await store.fork('sess_nested');
        const source = await store.load('sess_nested');
        const persistedFork = await store.load(forked.sessionId);

        expect(forked.sessionId).not.toBe('sess_nested');
        expect(forked.forkedFromSessionId).toBe('sess_nested');
        expect(forked.lineage).toEqual(['sess_nested']);
        expect(forked.intentDelegation).toMatchObject({
          sessionId: forked.sessionId,
          instanceId: 'inst_nested',
          ownership: {
            state: 'released',
            previousOwnerInstanceId: 'inst_nested',
            updatedAt: 200,
          },
        });
        expect(forked.intentDelegation?.latestPlan?.sessionId).toBe(forked.sessionId);
        expect(forked.intentDelegation?.intents.map((intent) => intent.sessionId))
          .toEqual([forked.sessionId]);
        expect(persistedFork?.intentDelegation?.sessionId).toBe(forked.sessionId);
        expect(source?.intentDelegation?.sessionId).toBe('sess_nested');
        expect(source?.intentDelegation?.latestPlan?.sessionId).toBe('sess_nested');
        expect(source?.intentDelegation?.intents.map((intent) => intent.sessionId))
          .toEqual(['sess_nested']);
        expect(source?.intentDelegation).toMatchObject({
          instanceId: 'inst_nested',
          ownership: {
            state: 'released',
            previousOwnerInstanceId: 'inst_nested',
            updatedAt: 200,
          },
        });
      } finally {
        dispose();
      }
    },
  );

  it('keeps save/load/loadLast/list/fork working through the shared SessionStore contract', async () => {
    const store: SessionStore = createFileSessionStore(rootDir);

    await store.save({
      sessionId: 'sess_contract',
      cwd: '/contract',
      createdAt: 100,
      updatedAt: 200,
      lineage: ['sess_contract'],
      messages: [{ role: 'user', content: [{ type: 'text', text: 'contract preview' }] }],
      usage: { inputTokens: 1, outputTokens: 2 },
      compactions: [],
      memoryRefs: [],
      approvalRefs: [],
      backgroundJobRefs: [],
    });

    const loaded = await store.load('sess_contract');
    const last = await store.loadLast();
    const listed = await store.list();
    const forked = await store.fork('sess_contract');

    expect(loaded?.sessionId).toBe('sess_contract');
    expect(last?.sessionId).toBe('sess_contract');
    expect(listed[0]).toMatchObject({
      sessionId: 'sess_contract',
      preview: 'contract preview',
    });
    expect(forked.forkedFromSessionId).toBe('sess_contract');
  });

  it('persists intent delegation and skill eval state through SQLiteSessionStore', async () => {
    let store: SQLiteSessionStore;
    try {
      store = new SQLiteSessionStore(join(rootDir, 'sessions.db'));
    } catch (error) {
      if (isSqliteAbiMismatch(error)) {
        return;
      }
      throw error;
    }
    const intentDelegation = createEmptySessionIntentLedger('sess_sqlite', 200);
    intentDelegation.instanceId = 'inst_sqlite';
    intentDelegation.ownership = {
      state: 'owned',
      ownerInstanceId: 'inst_sqlite',
      updatedAt: 200,
    };

    const skillEval = createEmptySessionSkillEvalState(200);
    skillEval.observations.push({
      observationId: 'obs_sqlite',
      sessionId: 'sess_sqlite',
      intentId: 'intent_sqlite',
      stageId: 'intent_sqlite:stage:1',
      stepId: 'intent_sqlite:stage:1:step:compose',
      intentType: 'generate',
      stageRole: 'compose',
      deliverable: '报告',
      deliverableFamily: 'document',
      selectedSkillName: 'report-skill',
      actualSkillName: 'report-skill',
      status: 'completed',
      artifactRecorded: true,
      structuralValidation: 'passed',
      semanticValidation: 'passed',
      createdAt: 200,
      updatedAt: 200,
    });

    await store.save({
      sessionId: 'sess_sqlite',
      cwd: '/sqlite',
      createdAt: 100,
      updatedAt: 200,
      lineage: ['sess_sqlite'],
      messages: [],
      usage: { inputTokens: 0, outputTokens: 0 },
      compactions: [],
      memoryRefs: [],
      approvalRefs: [],
      backgroundJobRefs: [],
      intentDelegation,
      skillEval,
    });

    const loaded = await store.load('sess_sqlite');
    expect(loaded?.intentDelegation).toMatchObject({
      sessionId: 'sess_sqlite',
      instanceId: 'inst_sqlite',
      ownership: {
        state: 'owned',
        ownerInstanceId: 'inst_sqlite',
      },
    });
    expect(loaded?.skillEval?.observations).toEqual([
      expect.objectContaining({
        observationId: 'obs_sqlite',
        actualSkillName: 'report-skill',
        status: 'completed',
      }),
    ]);
  });

  describe('loadLast', () => {
    it('returns null when no last_session file exists', async () => {
      const store = new FileSessionStore(rootDir);
      await expect(store.loadLast()).resolves.toBeNull();
    });

    it('loads the most recently saved session', async () => {
      const store = new FileSessionStore(rootDir);
      await store.save({
        sessionId: 'sess_recent',
        cwd: '/recent',
        createdAt: 100,
        updatedAt: 200,
        lineage: ['sess_recent'],
        messages: [],
        usage: { inputTokens: 0, outputTokens: 0 },
        compactions: [],
        memoryRefs: [],
        approvalRefs: [],
        backgroundJobRefs: [],
      });

      const loaded = await store.loadLast();
      expect(loaded).not.toBeNull();
      expect(loaded!.sessionId).toBe('sess_recent');
    });

    it('last_session contains only session ID (no path or extra content)', async () => {
      const store = new FileSessionStore(rootDir);
      await store.save({
        sessionId: 'sess_clean_id',
        cwd: '/test',
        createdAt: 100,
        updatedAt: 200,
        lineage: ['sess_clean_id'],
        messages: [],
        usage: { inputTokens: 0, outputTokens: 0 },
        compactions: [],
        memoryRefs: [],
        approvalRefs: [],
        backgroundJobRefs: [],
      });

      const lastSessionPath = join(rootDir, 'last_session');
      expect(existsSync(lastSessionPath)).toBe(true);

      const content = readFileSync(lastSessionPath, 'utf-8').trim();
      expect(content).toBe('sess_clean_id');
      // Ensure no path separators or extra content
      expect(content).not.toContain('/');
      expect(content).not.toContain('\n');
      expect(content).toMatch(/^sess_[a-z0-9_]+$/);
    });

    it('returns null if last_session contains corrupted content', async () => {
      const store = new FileSessionStore(rootDir);
      // Write corrupted content (e.g., path or garbage)
      writeFileSync(join(rootDir, 'last_session'), '/some/path/sess_xyz.json\n', 'utf-8');

      await expect(store.loadLast()).resolves.toBeNull();
    });
  });
});

function isSqliteAbiMismatch(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /NODE_MODULE_VERSION|better-sqlite3/i.test(message);
}
