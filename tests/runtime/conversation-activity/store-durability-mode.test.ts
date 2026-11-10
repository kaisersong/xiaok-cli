import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { ConversationActivityStore } from '../../../src/runtime/conversation-activity/store.js';

const now = 1000;
const origin = { profileId: 'profile', threadId: 'thread', workspaceId: 'workspace', actorId: 'user' };
const event = (s: number, kind = 'progress') => ({ schemaVersion: 1, eventId: `event-${s}`, source: 'task_host', logicalSourceId: 'host', sourceDataEpoch: 'epoch', workId: 'task', runId: '', transportGeneration: 1, sourceSequence: s, kind, occurredAt: now, receivedAt: now, summary: `phase ${s}`, evidenceRefs: [] });
function open(file: string) {
  const store = new ConversationActivityStore(file, { now: () => now });
  store.prepareAssociation({ operationId: 'operation', creationIdempotencyKey: 'creation', origin });
  store.bindWork({ operationId: 'operation', watchId: 'watch', source: 'task_host', logicalSourceId: 'host', sourceDataEpoch: 'epoch', workId: 'task', runId: '' });
  return store;
}
const writer = (store: ConversationActivityStore) => (store as unknown as { db: DatabaseSync }).db;
const pragma = (db: DatabaseSync, name: string) => Object.values(db.prepare(`PRAGMA ${name}`).get() as object)[0];

describe('conversation activity writer durability mode', () => {
  it('opens the writer in WAL with synchronous=NORMAL', () => {
    const root = mkdtempSync(join(tmpdir(), 'activity-durability-'));
    try {
      const store = open(join(root, 'a.sqlite'));
      expect(pragma(writer(store), 'journal_mode')).toBe('wal');
      expect(pragma(writer(store), 'synchronous')).toBe(1);
      store.close();
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it('commits only terminal-state transactions with synchronous=FULL and returns to NORMAL', () => {
    const root = mkdtempSync(join(tmpdir(), 'activity-durability-'));
    try {
      const store = open(join(root, 'a.sqlite')), db = writer(store), exec = db.exec.bind(db), log: string[] = [];
      db.exec = (sql: string) => { if (/synchronous|^COMMIT$/.test(sql)) log.push(sql); return exec(sql); };
      store.ingest('watch', event(1, 'started'));
      store.ingest('watch', event(2, 'progress'));
      expect(log).toEqual(['COMMIT', 'COMMIT']);
      log.length = 0;
      store.ingest('watch', event(3, 'completed'));
      expect(log).toEqual(['PRAGMA synchronous=FULL', 'COMMIT', 'PRAGMA synchronous=NORMAL']);
      log.length = 0;
      store.reconcileSnapshot('watch', 'epoch', 4, 'failed', false);
      expect(log[0]).toBe('PRAGMA synchronous=FULL');
      expect(log.at(-1)).toBe('PRAGMA synchronous=NORMAL');
      expect(pragma(db, 'synchronous')).toBe(1);
      store.close();
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it.each([1, 2, 3])('releases every cached statement on close: delete files and reopen at once (round %s)', () => {
    const root = mkdtempSync(join(tmpdir(), 'activity-durability-'));
    const file = join(root, 'a.sqlite');
    try {
      const first = open(file);
      for (let s = 1; s <= 300; s++) first.ingest('watch', event(s));
      first.close();
      for (const suffix of ['', '-wal', '-shm']) rmSync(file + suffix, { force: true });
      expect(existsSync(file)).toBe(false);
      const second = open(file);
      second.ingest('watch', event(1));
      expect(pragma(writer(second), 'journal_mode')).toBe('wal');
      second.close();
      for (const suffix of ['', '-wal', '-shm']) rmSync(file + suffix, { force: true });
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
