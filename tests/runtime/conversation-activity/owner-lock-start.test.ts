import { afterAll, afterEach, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, mkdirSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ConversationActivityStore } from '../../../src/runtime/conversation-activity/store.js';
import { ensureConversationActivityOwner } from '../../../src/runtime/conversation-activity/owner-launcher.js';

const privateConfig = await vi.hoisted(async () => {
  const fs = await import('node:fs'), path = await import('node:path'), os = await import('node:os');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'activity-owner-start-config-'));
  fs.chmodSync(root, 0o700);
  const previous = process.env.XIAOK_CONFIG_DIR;
  process.env.XIAOK_CONFIG_DIR = root;
  return { root, previous };
});
afterAll(() => {
  if (privateConfig.previous === undefined) delete process.env.XIAOK_CONFIG_DIR;
  else process.env.XIAOK_CONFIG_DIR = privateConfig.previous;
  rmSync(privateConfig.root, { recursive: true, force: true });
});

const roots: string[] = [];
const children: Array<{ child: ChildProcess; done: Promise<void>; record: { pid?: number; root: string; code?: number | null; signal?: string | null } }> = [];
const stores: ConversationActivityStore[] = [];
const entry = join(process.cwd(), '.test-dist/tests/runtime/conversation-activity/fixtures/owner-lock-start-entry.js');
function root() { const value = mkdtempSync(join(tmpdir(), 'activity-owner-start-')); roots.push(value); return value; }
function own(child: ChildProcess, path: string) {
  const record = { pid: child.pid, root: path, code: undefined as number | null | undefined, signal: undefined as string | null | undefined };
  const done = new Promise<void>(resolve => child.once('exit', (code, signal) => {
    record.code = code; record.signal = signal; resolve();
  }));
  children.push({ child, done, record });
  console.log(JSON.stringify({ activityOwnerChild: record, phase: 'birth' }));
  return child;
}
afterEach(async () => {
  vi.restoreAllMocks();
  const failures: unknown[] = [];
  for (const store of stores.splice(0)) {
    try { store.close(); } catch (raw) { failures.push(raw); }
  }
  for (const { child } of children) {
    child.ref();
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
  }
  for (const { done, record } of children.splice(0)) {
    try { await done; } catch (error) { failures.push(error); }
    console.log(JSON.stringify({ activityOwnerChild: record, phase: 'joined' }));
  }
  for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true });
  if (failures.length) throw new AggregateError(failures, 'activity_owner_fixture_cleanup_failed');
});

it('waits for a real transient initialization reader before taking the original owner transaction', async () => {
  const path = root(), file = join(path, 'conversation-activity.sqlite');
  const reader = own(spawn(process.execPath, [entry, file + '.owner.sqlite', 'reader'], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] }), path);
  expect((await once(reader, 'message'))[0]).toMatchObject({ phase: 'reader-ready', pid: reader.pid });
  const original = DatabaseSync.prototype.exec;
  let notified = false;
  vi.spyOn(DatabaseSync.prototype, 'exec').mockImplementation(function (this: DatabaseSync, sql: string) {
    if (sql.includes('BEGIN EXCLUSIVE') && !notified) { notified = true; reader.send('release'); }
    return Reflect.apply(original, this, [sql]);
  });
  const store = new ConversationActivityStore(file); stores.push(store);
  expect(notified).toBe(true);
  expect(store.listWatches()).toEqual([]);
});

it('keeps a live original owner exclusive and restores zero waiting after acquisition', () => {
  const path = root(), file = join(path, 'conversation-activity.sqlite');
  const original = DatabaseSync.prototype.exec;
  let owner: DatabaseSync | undefined;
  vi.spyOn(DatabaseSync.prototype, 'exec').mockImplementation(function (this: DatabaseSync, sql: string) {
    if (sql.includes('BEGIN EXCLUSIVE')) owner = this;
    return Reflect.apply(original, this, [sql]);
  });
  const store = new ConversationActivityStore(file); stores.push(store);
  expect(owner!.prepare('PRAGMA busy_timeout').get()).toEqual({ timeout: 0 });
  let caught: unknown;
  try { new ConversationActivityStore(file); } catch (raw) { caught = raw; }
  expect(caught).toBeInstanceOf(Error);
  expect(caught).toMatchObject({ message: 'conversation_activity_owner_held', cause: { errcode: 5 } });
  expect(store.listWatches()).toEqual([]);
});

it('retains an undefined post-acquisition failure and actually closes the failed owner', () => {
  const file = join(root(), 'conversation-activity.sqlite');
  const original = DatabaseSync.prototype.exec, close = DatabaseSync.prototype.close;
  let owner: DatabaseSync | undefined, closed = false, dataOpened = false;
  vi.spyOn(DatabaseSync.prototype, 'exec').mockImplementation(function (this: DatabaseSync, sql: string) {
    if (sql.includes('BEGIN EXCLUSIVE')) owner = this;
    if (sql.startsWith('PRAGMA journal_mode=WAL')) dataOpened = true;
    if (sql === 'PRAGMA busy_timeout=0') throw undefined;
    return Reflect.apply(original, this, [sql]);
  });
  vi.spyOn(DatabaseSync.prototype, 'close').mockImplementation(function (this: DatabaseSync) {
    Reflect.apply(close, this, []); if (this === owner) closed = true;
  });
  let caught: unknown;
  try { stores.push(new ConversationActivityStore(file)); } catch (raw) { caught = raw; }
  expect(caught).toBeInstanceOf(Error);
  expect(Object.getOwnPropertyDescriptor(caught, 'cause')).toMatchObject({ value: undefined });
  expect(closed).toBe(true);
  expect(dataOpened).toBe(false);
});

it.each(Array.from({ length: 12 }, (_, round) => round))('attaches both callers to one real canonical owner at fresh concurrent startup round %i', async (round) => {
    const path = root(), sessions = join(path, 'sessions'); mkdirSync(sessions);
    const ready: ChildProcess[] = [];
    const config = { schemaVersion: 1 as const, dataRoot: path, profileId: 'profile', actorId: 'user', identity: { kind: 'cli' as const, path: sessions } };
    const clients = await Promise.allSettled([1, 2].map(() => ensureConversationActivityOwner(config, { entryPath: entry,
      spawn(command, args, options) {
        const child = own(spawn(command, args, { ...options, stdio: [...options.stdio as ['ignore', number, number], 'ipc'] }), path);
        child.on('message', message => {
          if ((message as { phase?: string }).phase !== 'entry-ready') return;
          ready.push(child); if (ready.length === 2) for (const peer of ready) peer.send('go');
        });
        return child;
      } })));
    try {
      const log = join(path, 'activity-owner.log');
      console.log(JSON.stringify({ round, path, outcomes: clients.map(result => result.status), diagnostic: existsSync(log) ? readFileSync(log, 'utf8') : '' }));
      expect(clients.map(result => result.status)).toEqual(['fulfilled', 'fulfilled']);
      const values = clients.filter(result => result.status === 'fulfilled').map(result => result.value);
      const statuses = await Promise.all(values.map(client => client.request('status')));
      expect(statuses[1]).toEqual(statuses[0]);
    } finally {
      for (const result of clients) if (result.status === 'fulfilled') result.value.dispose();
      const group = children.filter(value => value.record.root === path);
      for (const { child } of group) { child.ref(); if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM'); }
      await Promise.all(group.map(value => value.done));
    }
}, 15_000);
