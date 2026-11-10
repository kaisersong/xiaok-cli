// @vitest-environment node
import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ContinuityService } from '../../electron/context-continuity/service.js';
import { assembleOwnedHistory } from '../../electron/context-continuity/history.js';
import { ASSISTANT_CHAT_THREAD } from '../../shared/assistant-inbox-contract.js';
const actor = { requestSource: 'user' as const, profileId: 'a', actorId: 'desktop-user:a' };
const WORK_THREAD = 'a0c22222-1111-4111-8111-111111111111';
let root: string, service: ContinuityService;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'assistant-continuity-')); service = new ContinuityService({ dbPath: join(root, 'store.sqlite'), profileId: 'a' }); });
afterEach(() => { service.close(); rmSync(root, { recursive: true, force: true, maxRetries: 3 }); });

it('creates the fixed assistant conversations once on the first owned-history read', () => {
  for (const id of [ASSISTANT_CHAT_THREAD, WORK_THREAD]) {
    expect(service.getConversation(actor, id)).toBeNull();
    expect(assembleOwnedHistory(service, actor, 'task_first', { threadId: id })).toMatchObject({ history: [], audit: { threadId: id } });
    const created = service.getConversation(actor, id);
    expect(created).toMatchObject({ id, coverage: 'complete', taskIds: [] });
    expect(service.ensureAssistantConversation(actor, id)).toEqual(created);
    expect(service.store.db.prepare('SELECT COUNT(*) AS n FROM conversations WHERE id=?').get(id)).toEqual({ n: 1 });
  }
});

it('keeps ordinary threads strict and never resurrects a deleted assistant conversation', () => {
  expect(() => assembleOwnedHistory(service, actor, 'task_x', { threadId: 'thread-ordinary' })).toThrow('not_readable');
  expect(() => service.ensureAssistantConversation(actor, 'thread-ordinary')).toThrow('invalid_argument');
  expect(() => service.ensureAssistantConversation({ ...actor, requestSource: 'agent' as never }, ASSISTANT_CHAT_THREAD)).toThrow();
  service.ensureAssistantConversation(actor, ASSISTANT_CHAT_THREAD);
  service.store.db.prepare('UPDATE conversations SET deleted=1 WHERE id=?').run(ASSISTANT_CHAT_THREAD);
  expect(service.ensureAssistantConversation(actor, ASSISTANT_CHAT_THREAD)).toBeNull();
  expect(() => assembleOwnedHistory(service, actor, 'task_y', { threadId: ASSISTANT_CHAT_THREAD })).toThrow('not_readable');
});

it('never recreates a deleted assistant conversation on later reads', () => {
  assembleOwnedHistory(service, actor, 'task_a', { threadId: ASSISTANT_CHAT_THREAD });
  service.store.db.prepare('UPDATE conversations SET deleted=1 WHERE id=?').run(ASSISTANT_CHAT_THREAD);
  for (let i = 0; i < 3; i++) expect(() => assembleOwnedHistory(service, actor, `task_b${i}`, { threadId: ASSISTANT_CHAT_THREAD })).toThrow('not_readable');
  expect(service.store.db.prepare('SELECT COUNT(*) AS n, MAX(deleted) AS d FROM conversations WHERE id=?').get(ASSISTANT_CHAT_THREAD)).toEqual({ n: 1, d: 1 });
});

it('creates exactly one assistant conversation for two concurrent first reads on the same store', async () => {
  const other = new ContinuityService({ dbPath: join(root, 'store.sqlite'), profileId: 'a' });
  try {
    const reads = await Promise.all([service, other, service, other].map((owner, index) => Promise.resolve().then(() => assembleOwnedHistory(owner, actor, `task_c${index}`, { threadId: ASSISTANT_CHAT_THREAD }))));
    for (const read of reads) expect(read).toMatchObject({ history: [], audit: { threadId: ASSISTANT_CHAT_THREAD } });
    expect(service.store.db.prepare('SELECT COUNT(*) AS n FROM conversations WHERE id=?').get(ASSISTANT_CHAT_THREAD)).toEqual({ n: 1 });
    expect(other.getConversation(actor, ASSISTANT_CHAT_THREAD)).toEqual(service.getConversation(actor, ASSISTANT_CHAT_THREAD));
  } finally { other.close(); }
});

