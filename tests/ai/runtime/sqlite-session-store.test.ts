import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SQLiteSessionStore } from '../../../src/ai/runtime/session-store/sqlite-store.js';
import type { Message } from '../../../src/types.js';
import { AgentSessionState } from '../../../src/ai/runtime/session.js';
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

describe('SQLiteSessionStore', () => {
  it('creates, lists, loads, resumes, and forks full UUID session IDs by time order', async () => {
    const root = join(tmpdir(), `xiaok-sqlite-uuid-session-${Date.now()}`);
    mkdirSync(root, { recursive: true });
    const dbPath = join(root, 'sessions.sqlite');
    let store: SQLiteSessionStore | undefined;

    try {
      store = new SQLiteSessionStore(dbPath);
      const createdSessionId = store.createSessionId();
      const lexicallyLaterButOlder = 'sess_ffffffff-ffff-4fff-8fff-ffffffffffff';
      const lexicallyEarlierButNewer = 'sess_00000000-0000-4000-8000-000000000000';

      expect(createdSessionId).toMatch(
        /^sess_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );

      await store.save({
        sessionId: lexicallyLaterButOlder,
        cwd: '/sqlite/older',
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
        cwd: '/sqlite/newer',
        createdAt: 120,
        updatedAt: 220,
        lineage: [lexicallyEarlierButNewer],
        messages: [{ role: 'user', content: [{ type: 'text', text: 'newer' }] }],
        usage: { inputTokens: 1, outputTokens: 2 },
        compactions: [],
        memoryRefs: [],
        approvalRefs: [],
        backgroundJobRefs: [],
      });

      await expect(store.load(lexicallyEarlierButNewer)).resolves.toMatchObject({
        sessionId: lexicallyEarlierButNewer,
      });
      await expect(store.loadLast()).resolves.toMatchObject({
        sessionId: lexicallyEarlierButNewer,
      });
      await expect(store.list()).resolves.toEqual([
        expect.objectContaining({ sessionId: lexicallyEarlierButNewer }),
        expect.objectContaining({ sessionId: lexicallyLaterButOlder }),
      ]);

      const forked = await store.fork(lexicallyEarlierButNewer);
      expect(forked.sessionId).toMatch(
        /^sess_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
      expect(forked.sessionId).not.toBe(lexicallyEarlierButNewer);
      expect(forked.forkedFromSessionId).toBe(lexicallyEarlierButNewer);
    } finally {
      store?.dispose();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('loads legacy session IDs without rewriting them', async () => {
    const root = join(tmpdir(), `xiaok-sqlite-legacy-session-${Date.now()}`);
    mkdirSync(root, { recursive: true });
    const dbPath = join(root, 'sessions.sqlite');
    let store: SQLiteSessionStore | undefined;

    try {
      store = new SQLiteSessionStore(dbPath);
      await store.save({
        sessionId: 'sess_1',
        cwd: '/sqlite/legacy',
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
    } finally {
      store?.dispose();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('persists normalized session metadata across store instances', async () => {
    const root = join(tmpdir(), `xiaok-sqlite-session-store-${Date.now()}`);
    mkdirSync(root, { recursive: true });
    const dbPath = join(root, 'sessions.sqlite');
    let store: SQLiteSessionStore | undefined;
    let reloaded: SQLiteSessionStore | undefined;

    try {
      store = new SQLiteSessionStore(dbPath);
      await store.save({
        sessionId: 'sess_sqlite',
        cwd: '/workspace/sqlite',
        model: 'gpt-4.1',
        createdAt: 100,
        updatedAt: 200,
        lineage: ['sess_sqlite'],
        messages: [
          { role: 'user', content: [{ type: 'text', text: 'hello sqlite store' }] },
          { role: 'assistant', content: [{ type: 'text', text: 'persisted answer' }] },
        ],
        usage: { inputTokens: 10, outputTokens: 5 },
        compactions: [],
        memoryRefs: [],
        approvalRefs: [],
        backgroundJobRefs: [],
        skillExecution: {
          invocations: [{
            invocationId: 'skill_inv_sqlite',
            sessionId: 'sess_sqlite',
            agentId: 'main',
            skillName: 'release-checklist',
            requested: ['release-checklist'],
            strategy: 'inline',
            strictMode: true,
            bundleHash: 'hash',
            status: 'running',
            plan: {
              type: 'skill_plan',
              requested: ['release-checklist'],
              resolved: [],
              strategy: 'inline',
              primarySkill: 'release-checklist',
              strict: true,
            },
            evidence: [],
            createdAt: 150,
            updatedAt: 150,
          }],
          updatedAt: 150,
        },
      });

      reloaded = new SQLiteSessionStore(dbPath);
      await expect(reloaded.load('sess_sqlite')).resolves.toMatchObject({
        sessionId: 'sess_sqlite',
        cwd: '/workspace/sqlite',
        model: 'gpt-4.1',
        skillExecution: {
          invocations: [
            expect.objectContaining({
              skillName: 'release-checklist',
            }),
          ],
        },
      });
      await expect(reloaded.loadLast()).resolves.toMatchObject({
        sessionId: 'sess_sqlite',
      });
    } finally {
      reloaded?.dispose();
      store?.dispose();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('round-trips preserved Kimi reasoning through SQLite save, restore, and serialization', async () => {
    const root = join(tmpdir(), `xiaok-sqlite-kimi-round-trip-${Date.now()}`);
    mkdirSync(root, { recursive: true });
    const dbPath = join(root, 'sessions.sqlite');
    let store: SQLiteSessionStore | undefined;
    let reloaded: SQLiteSessionStore | undefined;

    try {
      store = new SQLiteSessionStore(dbPath);
      await store.save({
        sessionId: 'sess_kimi_sqlite_round_trip',
        cwd: '/workspace/sqlite',
        model: 'k3',
        createdAt: 100,
        updatedAt: 200,
        lineage: ['sess_kimi_sqlite_round_trip'],
        messages: preservedThinkingRoundTripMessages(),
        usage: { inputTokens: 10, outputTokens: 5 },
        compactions: [],
        memoryRefs: [],
        approvalRefs: [],
        backgroundJobRefs: [],
      });

      reloaded = new SQLiteSessionStore(dbPath);
      const loaded = await reloaded.load('sess_kimi_sqlite_round_trip');
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
    } finally {
      reloaded?.dispose();
      store?.dispose();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('indexes message text for FTS lookups', async () => {
    const root = join(tmpdir(), `xiaok-sqlite-session-search-${Date.now()}`);
    mkdirSync(root, { recursive: true });
    const dbPath = join(root, 'sessions.sqlite');
    let store: SQLiteSessionStore | undefined;

    try {
      store = new SQLiteSessionStore(dbPath);
      await store.save({
        sessionId: 'sess_search',
        cwd: '/workspace/search',
        createdAt: 100,
        updatedAt: 200,
        lineage: ['sess_search'],
        messages: [
          { role: 'user', content: [{ type: 'text', text: '帮我找下午的 permission prompt bug' }] },
          { role: 'assistant', content: [{ type: 'text', text: 'permission prompt clear 会吃掉一行输出' }] },
        ],
        usage: { inputTokens: 3, outputTokens: 4 },
        compactions: [],
        memoryRefs: [],
        approvalRefs: [],
        backgroundJobRefs: [],
      });

      expect(store.searchMessages('permission prompt')).toEqual(expect.arrayContaining([
        expect.objectContaining({
          sessionId: 'sess_search',
          textContent: expect.stringContaining('permission prompt'),
        }),
      ]));
    } finally {
      store?.dispose();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('lists sessions from sqlite rows without writing per-session json snapshots', async () => {
    const root = join(tmpdir(), `xiaok-sqlite-session-list-${Date.now()}`);
    mkdirSync(root, { recursive: true });
    const dbPath = join(root, 'sessions.sqlite');
    let store: SQLiteSessionStore | undefined;

    try {
      store = new SQLiteSessionStore(dbPath);
      await store.save({
        sessionId: 'sess_old',
        cwd: '/workspace/old',
        createdAt: 100,
        updatedAt: 110,
        lineage: ['sess_old'],
        messages: [{ role: 'user', content: [{ type: 'text', text: 'older preview' }] }],
        usage: { inputTokens: 1, outputTokens: 1 },
        compactions: [],
        memoryRefs: [],
        approvalRefs: [],
        backgroundJobRefs: [],
      });
      await store.save({
        sessionId: 'sess_new',
        cwd: '/workspace/new',
        createdAt: 120,
        updatedAt: 220,
        lineage: ['sess_new'],
        messages: [{ role: 'assistant', content: [{ type: 'text', text: 'newest preview' }] }],
        usage: { inputTokens: 2, outputTokens: 3 },
        compactions: [],
        memoryRefs: [],
        approvalRefs: [],
        backgroundJobRefs: [],
      });

      await expect(store.list()).resolves.toEqual([
        {
          sessionId: 'sess_new',
          cwd: '/workspace/new',
          updatedAt: 220,
          preview: 'newest preview',
        },
        {
          sessionId: 'sess_old',
          cwd: '/workspace/old',
          updatedAt: 110,
          preview: 'older preview',
        },
      ]);

      expect(existsSync(dbPath)).toBe(true);
      expect(readdirSync(root).some((entry) => entry.endsWith('.json'))).toBe(false);
    } finally {
      store?.dispose();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
