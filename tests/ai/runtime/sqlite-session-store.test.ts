import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SQLiteSessionStore } from '../../../src/ai/runtime/session-store/sqlite-store.js';

describe('SQLiteSessionStore', () => {
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
      });

      reloaded = new SQLiteSessionStore(dbPath);
      await expect(reloaded.load('sess_sqlite')).resolves.toMatchObject({
        sessionId: 'sess_sqlite',
        cwd: '/workspace/sqlite',
        model: 'gpt-4.1',
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
