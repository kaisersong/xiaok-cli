import { expect, it } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { ConversationActivityStore } from '../../../src/runtime/conversation-activity/store.js';
import { ACTIVITY_STORAGE_NAMES } from '../../../src/runtime/conversation-activity/storage-permissions.js';
// Like process fixtures, workers use emitted production modules, including in source Vitest.
const production = await import(pathToFileURL(join(process.cwd(), '.test-dist/src/runtime/conversation-activity/owner-retire.js')).href);
it.each(['pending', 'completed', 'failed', 'cancelled', 'empty', 'corrupt', 'schema', 'missing', 'no_projection'])('reads %s without modifying SQLite files', async kind => {
  const root = mkdtempSync(join(tmpdir(), 'activity-read-only-'));
  const file = join(root, ACTIVITY_STORAGE_NAMES.database);
  try {
    if (kind === 'corrupt') writeFileSync(file, 'broken database');
    else if (kind !== 'missing') {
      const store = new ConversationActivityStore(file);
      try {
        if (!['empty', 'schema'].includes(kind)) {
          store.prepareAssociation({ operationId: 'op', creationIdempotencyKey: 'op', origin: { profileId: 'profile', threadId: 'thread', actorId: 'user', workspaceId: root } });
          store.bindWork({ operationId: 'op', watchId: 'watch', source: 'task_host', logicalSourceId: 'host', sourceDataEpoch: 'epoch', workId: 'task' });
          if (['completed', 'failed', 'cancelled'].includes(kind)) store.ingest('watch', { schemaVersion: 1, eventId: 'done', source: 'task_host', logicalSourceId: 'host', sourceDataEpoch: 'epoch', workId: 'task', runId: '', sourceSequence: 1, transportGeneration: 0, kind, receivedAt: Date.now(), evidenceRefs: [] });
        }
      } finally { store.close(); }
      if (kind === 'schema' || kind === 'no_projection') {
        const db = new DatabaseSync(file);
        try { db.exec(kind === 'schema' ? 'PRAGMA user_version=3' : 'DELETE FROM work_projections'); } finally { db.close(); }
      }
    }
    const before = readdirSync(root).sort().map(name => ({ name, bytes: readFileSync(join(root, name)), mtime: statSync(join(root, name)).mtimeMs }));
    expect(await production.readPendingTasks(root)).toBe(['pending', 'no_projection'].includes(kind) ? 'pending' : ['corrupt', 'schema', 'missing'].includes(kind) ? 'unknown' : 'none');
    expect(readdirSync(root).sort()).toEqual(before.map(item => item.name));
    for (const item of before) { expect(readFileSync(join(root, item.name))).toEqual(item.bytes); expect(statSync(join(root, item.name)).mtimeMs).toBe(item.mtime); }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

it('reads pending facts from a live WAL without changing database or WAL bytes/mtime', async () => {
  const root = mkdtempSync(join(tmpdir(), 'activity-live-read-'));
  const file = join(root, ACTIVITY_STORAGE_NAMES.database);
  const store = new ConversationActivityStore(file);
  try {
    store.prepareAssociation({ operationId: 'op', creationIdempotencyKey: 'op', origin: { profileId: 'profile', threadId: 'thread', actorId: 'user', workspaceId: root } });
    store.bindWork({ operationId: 'op', watchId: 'watch', source: 'task_host', logicalSourceId: 'host', sourceDataEpoch: 'epoch', workId: 'task' });
    const names = readdirSync(root).sort();
    const before = [file, `${file}-wal`].map(path => ({ path, bytes: readFileSync(path), mtime: statSync(path).mtimeMs }));
    expect(await production.readPendingTasks(root)).toBe('pending');
    expect(readdirSync(root).sort()).toEqual(names);
    for (const item of before) { expect(readFileSync(item.path)).toEqual(item.bytes); expect(statSync(item.path).mtimeMs).toBe(item.mtime); }
  } finally { store.close(); rmSync(root, { recursive: true, force: true }); }
});
it('fails closed when WAL exists without shared memory instead of creating a sidecar', async () => {
  const root = mkdtempSync(join(tmpdir(), 'activity-wal-no-shm-'));
  const file = join(root, ACTIVITY_STORAGE_NAMES.database);
  try {
    const store = new ConversationActivityStore(file); store.close(); writeFileSync(`${file}-wal`, 'unverified WAL');
    const names = readdirSync(root).sort();
    expect(await production.readPendingTasks(root)).toBe('unknown'); expect(readdirSync(root).sort()).toEqual(names);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
