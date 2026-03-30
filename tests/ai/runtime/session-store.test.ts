import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Message, UsageStats } from '../../../src/types.js';
import { FileSessionStore } from '../../../src/ai/runtime/session-store.js';

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
      messages,
      usage,
    });

    await expect(store.load('sess_alpha')).resolves.toEqual({
      sessionId: 'sess_alpha',
      cwd: 'D:/projects/workspace/xiaok-cli',
      model: 'claude-opus-4-6',
      createdAt: 100,
      updatedAt: 200,
      messages,
      usage,
    });
  });

  it('lists saved sessions ordered by most recent update', async () => {
    const store = new FileSessionStore(rootDir);

    await store.save({
      sessionId: 'sess_old',
      cwd: 'D:/projects/old',
      createdAt: 100,
      updatedAt: 110,
      messages: [],
      usage: { inputTokens: 0, outputTokens: 0 },
    });
    await store.save({
      sessionId: 'sess_new',
      cwd: 'D:/projects/new',
      createdAt: 120,
      updatedAt: 220,
      messages: [{ role: 'user', content: [{ type: 'text', text: 'latest' }] }],
      usage: { inputTokens: 3, outputTokens: 1 },
    });

    await expect(store.list()).resolves.toEqual([
      {
        sessionId: 'sess_new',
        cwd: 'D:/projects/new',
        updatedAt: 220,
        preview: 'latest',
      },
      {
        sessionId: 'sess_old',
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
      messages: [{ role: 'assistant', content: [{ type: 'text', text: 'original' }] }],
      usage: { inputTokens: 7, outputTokens: 9 },
    });

    const forked = await store.fork('sess_source');

    expect(forked.sessionId).not.toBe('sess_source');
    expect(forked.forkedFromSessionId).toBe('sess_source');
    expect(forked.messages).toEqual([
      { role: 'assistant', content: [{ type: 'text', text: 'original' }] },
    ]);
    expect(forked.usage).toEqual({ inputTokens: 7, outputTokens: 9 });
  });
});
