import { afterEach, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

// Exercise the compatibility route with the real current SQLite as well as the
// actual minimum runtime. Only the runtime version metadata is substituted.
vi.mock('node:process', async original => {
  const actual = await original<typeof import('node:process')>();
  return { ...actual, versions: { ...actual.versions, node: '22.14.0' } };
});
const seam = vi.hoisted(() => ({
  paths: new Map<number, string>(), flags: new Map<number, unknown>(), open: new Set<number>(), roots: [] as string[],
  read: undefined as undefined | ((fd: number, position: number | bigint | null) => void),
  close: undefined as undefined | ((fd: number) => void),
  write: undefined as undefined | (() => void),
  lstat: undefined as undefined | ((path: string) => void),
  removed: [] as string[],
}));
vi.mock('node:fs', async original => {
  const actual = await original<typeof import('node:fs')>();
  return { ...actual,
    lstatSync(...args: Parameters<typeof actual.lstatSync>) {
      seam.lstat?.(String(args[0])); return actual.lstatSync(...args);
    },
    openSync(...args: Parameters<typeof actual.openSync>) {
      const fd = actual.openSync(...args); seam.paths.set(fd, String(args[0])); seam.flags.set(fd, args[1]); seam.open.add(fd); return fd;
    },
    closeSync(fd: number) { seam.close?.(fd); actual.closeSync(fd); seam.open.delete(fd); },
    readSync(fd: number, buffer: NodeJS.ArrayBufferView, offset: number, length: number, position: number | bigint | null) {
      seam.read?.(fd, position); return actual.readSync(fd, buffer, offset, length, position);
    },
    writeSync(fd: number, buffer: NodeJS.ArrayBufferView, offset: number, length: number, position: number | null) {
      seam.write?.(); return actual.writeSync(fd, buffer, offset, length, position);
    },
    mkdtempSync(...args: Parameters<typeof actual.mkdtempSync>) {
      const root = actual.mkdtempSync(...args); seam.roots.push(String(root)); return root;
    },
    rmSync(...args: Parameters<typeof actual.rmSync>) { seam.removed.push(String(args[0])); return actual.rmSync(...args); },
  };
});
import { ConversationActivityStore } from '../../../src/runtime/conversation-activity/store.js';

const nativeFs = await vi.importActual<typeof import('node:fs')>('node:fs');
const closeDb = DatabaseSync.prototype.close;
const prepareDb = DatabaseSync.prototype.prepare;
const execDb = DatabaseSync.prototype.exec;
const fixtures: { root: string; file: string; readers: ConversationActivityStore[]; dbs: Set<DatabaseSync>; closed: Set<DatabaseSync> }[] = [];
function attempt(run: () => unknown): { threw: boolean; error?: unknown } {
  try { run(); return { threw: false }; } catch (error) { return { threw: true, error }; }
}
function snapshot(root: string) {
  return nativeFs.readdirSync(root).sort().map(name => {
    const file = join(root, name), stat = nativeFs.statSync(file, { bigint: true });
    return { name, bytes: nativeFs.readFileSync(file).toString('hex'), mtime: stat.mtimeNs, mode: stat.mode };
  });
}
function fixture() {
  const root = nativeFs.mkdtempSync(join(tmpdir(), 'activity-readonly-compat-'));
  nativeFs.chmodSync(root, 0o700);
  const file = join(nativeFs.realpathSync(root), 'activity.sqlite'), writer = new ConversationActivityStore(file);
  writer.prepareAssociation({ operationId: 'op', creationIdempotencyKey: 'op',
    origin: { profileId: 'p', threadId: 't', actorId: 'user', workspaceId: root } });
  writer.close();
  const f = { root, file, readers: [] as ConversationActivityStore[], dbs: new Set<DatabaseSync>(), closed: new Set<DatabaseSync>() };
  fixtures.push(f);
  const exec = DatabaseSync.prototype.exec, prepare = DatabaseSync.prototype.prepare;
  vi.spyOn(DatabaseSync.prototype, 'exec').mockImplementation(function (this: DatabaseSync, sql: string) {
    f.dbs.add(this); return exec.call(this, sql);
  });
  vi.spyOn(DatabaseSync.prototype, 'prepare').mockImplementation(function (this: DatabaseSync, ...args: Parameters<DatabaseSync['prepare']>) {
    f.dbs.add(this); return prepare.apply(this, args);
  });
  vi.spyOn(DatabaseSync.prototype, 'close').mockImplementation(function (this: DatabaseSync) {
    f.dbs.add(this); const result = closeDb.call(this); f.closed.add(this); return result;
  });
  seam.paths.clear(); seam.flags.clear(); seam.open.clear(); seam.roots.length = 0; seam.removed.length = 0;
  return f;
}
function read(f: ReturnType<typeof fixture>) {
  const reader = new ConversationActivityStore(f.file, { readOnly: true }); f.readers.push(reader); return reader;
}
afterEach(() => {
  seam.read = undefined; seam.close = undefined; seam.write = undefined; seam.lstat = undefined;
  const failures: unknown[] = [];
  for (const f of fixtures.splice(0)) {
    for (const reader of f.readers) { try { reader.close(); } catch (error) { failures.push(error); } }
    for (const db of f.dbs) if (!f.closed.has(db)) {
      try { closeDb.call(db); f.closed.add(db); } catch (error) { failures.push(error); }
    }
    for (const fd of seam.open) { try { nativeFs.closeSync(fd); } catch (error) { failures.push(error); } }
    seam.open.clear();
    for (const root of [...seam.roots, f.root]) {
      try { nativeFs.rmSync(root, { recursive: true, force: true }); } catch (error) { failures.push(error); }
    }
  }
  vi.restoreAllMocks();
  if (failures.length) throw new AggregateError(failures, 'readonly_fixture_cleanup_failed');
});

it('reads an original offline WAL through a private copy with source bytes and mtime unchanged', () => {
  const f = fixture(), before = snapshot(f.root), reader = read(f);
  expect(reader.getAssociation('op')).not.toBeNull();
  expect(snapshot(f.root)).toEqual(before);
  expect(seam.roots).toHaveLength(1);
  if (process.platform !== 'win32') expect(Number(nativeFs.statSync(seam.roots[0]).mode) & 0o777).toBe(0o700);
  const actual = (reader as unknown as { db: DatabaseSync }).db;
  const main = actual.prepare('PRAGMA database_list').get() as { file: string };
  expect(main.file).toBe(nativeFs.realpathSync(join(seam.roots[0], 'activity.sqlite')));
  expect(() => reader.prepareAssociation({ operationId: 'bad', creationIdempotencyKey: 'bad',
    origin: { profileId: 'p', threadId: 't', actorId: 'user', workspaceId: f.root } })).toThrow('conversation_activity_readonly');
  reader.close(); expect(nativeFs.existsSync(seam.roots[0])).toBe(false);
  expect(snapshot(f.root)).toEqual(before);
});
it('rejects a missing original owner instead of opening an offline WAL source', () => {
  const f = fixture(); nativeFs.unlinkSync(f.file + '.owner.sqlite'); const before = snapshot(f.root);
  expect(() => read(f)).toThrow('conversation_activity_readonly_owner_unproved'); expect(seam.roots).toHaveLength(0); expect(snapshot(f.root)).toEqual(before);
});
it.each(['nonempty-delete', 'nonempty-wal', 'journal', 'owner-shm'])('rejects unproved %s owner without source sidecars', kind => {
  const f = fixture(), owner = f.file + '.owner.sqlite';
  if (kind.startsWith('nonempty')) {
    const db = new DatabaseSync(owner);
    db.exec(`PRAGMA journal_mode=${kind === 'nonempty-wal' ? 'WAL' : 'DELETE'}; CREATE TABLE old_writer(x)`); db.close();
  } else nativeFs.writeFileSync(owner + (kind === 'journal' ? '-journal' : '-shm'), 'unproved');
  const before = snapshot(f.root); expect(() => read(f)).toThrow('conversation_activity_readonly_owner_unproved'); expect(seam.roots).toHaveLength(0);
  expect(snapshot(f.root)).toEqual(before);
});
it('retains the original active WAL read path without requiring a private copy', () => {
  const f = fixture(), writer = new ConversationActivityStore(f.file);
  try { const reader = read(f); expect(reader.getAssociation('op')).not.toBeNull(); expect(seam.roots).toHaveLength(0); }
  finally { writer.close(); }
});
it('rejects WAL without shm without creating either source sidecar', () => {
  const f = fixture(); nativeFs.writeFileSync(f.file + '-wal', 'unproved'); const before = snapshot(f.root);
  expect(() => read(f)).toThrow('conversation_activity_readonly_sidecars_missing'); expect(snapshot(f.root)).toEqual(before);
});
it.each(['empty-with-journal', 'nonempty'] as const)('refuses a real %s exclusive owner and leaves its same-process lock intact', kind => {
  const f = fixture(), owner = new DatabaseSync(f.file + '.owner.sqlite');
  if (kind === 'nonempty') owner.exec('CREATE TABLE legacy_owner(x)');
  owner.exec('PRAGMA journal_mode=DELETE; BEGIN EXCLUSIVE');
  if (kind === 'empty-with-journal') expect(nativeFs.existsSync(f.file + '.owner.sqlite-journal')).toBe(true);
  else expect(nativeFs.statSync(f.file + '.owner.sqlite').size).toBeGreaterThan(0);
  try {
    expect(() => read(f)).toThrow('conversation_activity_readonly_owner_unproved'); expect(seam.roots).toHaveLength(0);
    const child = spawnSync(process.execPath, ['--input-type=module', '-e',
      `import {DatabaseSync} from 'node:sqlite';const d=new DatabaseSync(${JSON.stringify(f.file + '.owner.sqlite')});try{d.exec('PRAGMA busy_timeout=0; PRAGMA journal_mode=DELETE; BEGIN EXCLUSIVE');console.log('BAD_ACQUIRED')}catch(e){console.log('BUSY:'+e.errcode)}finally{d.close()}`], { encoding: 'utf8' });
    expect(child.status).toBe(0); expect(child.stdout.trim()).toBe('BUSY:5');
    console.log('readonly_owned_child_reaped', { pid: child.pid, status: child.status });
  } finally { owner.close(); }
});
it('holds the original owner read lock for the actual copy window and releases it afterwards', () => {
  const f = fixture(); let childResult: ReturnType<typeof spawnSync> | undefined;
  seam.read = fd => {
    if (seam.paths.get(fd) !== f.file || childResult) return;
    childResult = spawnSync(process.execPath, ['--input-type=module', '-e',
      `import {DatabaseSync} from 'node:sqlite';const d=new DatabaseSync(${JSON.stringify(f.file + '.owner.sqlite')});try{d.exec('PRAGMA busy_timeout=0; PRAGMA journal_mode=DELETE; BEGIN EXCLUSIVE');console.log('BAD_ACQUIRED')}catch(e){console.log('BUSY:'+e.errcode)}finally{d.close()}`], { encoding: 'utf8' });
  };
  read(f); expect(childResult?.status).toBe(0); expect(String(childResult?.stdout).trim()).toBe('BUSY:5');
  console.log('readonly_copy_child_reaped', { pid: childResult?.pid, status: childResult?.status });
  const replacement = new ConversationActivityStore(f.file); replacement.close();
});
it('rejects source mutation during the actual copy and closes every known temporary descriptor', () => {
  const f = fixture(); let changed = false;
  seam.read = fd => { if (!changed && seam.paths.get(fd) === f.file) { changed = true; nativeFs.appendFileSync(f.file, 'changed'); } };
  expect(() => read(f)).toThrow(); expect(changed).toBe(true); expect(seam.open.size).toBe(0);
});
it.each([new Error('copy_write_primary'), undefined])('preserves the original write throw including undefined while closing other resources', primary => {
  const f = fixture(); seam.write = () => { throw primary; };
  const result = attempt(() => read(f)); expect(result.threw).toBe(true); expect(result.error).toBe(primary);
  expect(seam.open.size).toBe(0); expect([...f.dbs].every(db => f.closed.has(db))).toBe(true);
});
it.each([new Error('copy_close_primary'), undefined])('retains an unknown copy descriptor and its root while still closing independent resources', primary => {
  const f = fixture(); let failedFd: number | undefined;
  seam.close = fd => { if (seam.paths.get(fd)?.includes('activity-readonly-') && seam.paths.get(fd) !== f.file) { failedFd = fd; throw primary; } };
  const result = attempt(() => read(f)); expect(result.threw).toBe(true); expect(result.error).toBe(primary);
  expect(failedFd).toBeDefined(); expect(seam.open).toEqual(new Set([failedFd]));
  expect(seam.roots).toHaveLength(1); expect(nativeFs.existsSync(seam.roots[0])).toBe(true);
  expect([...f.dbs].every(db => f.closed.has(db))).toBe(true);
});
it.each([new Error('data_close_primary'), undefined])('retains actual data handle and private root after normal close is unknown', primary => {
  const f = fixture(), reader = read(f), actual = (reader as unknown as { db: DatabaseSync }).db;
  vi.spyOn(DatabaseSync.prototype, 'close').mockImplementation(function (this: DatabaseSync) {
    if (this === actual) throw primary;
    closeDb.call(this); f.closed.add(this);
  });
  const result = attempt(() => reader.close()); expect(result.threw).toBe(true); expect(result.error).toBe(primary);
  expect(nativeFs.existsSync(seam.roots[0])).toBe(true); expect(f.closed.has(actual)).toBe(false);
  expect(attempt(() => reader.close()).threw).toBe(true); // No later false known-close ACK or SDK retry.
  vi.mocked(DatabaseSync.prototype.close).mockRestore();
  // Cleanup belongs to this known pre-native fault fixture, not a production retry.
  closeDb.call(actual); f.closed.add(actual); f.readers.length = 0;
});

it.each([['22.14.0', true], ['22.15.0', false], ['23.9.0', true], ['23.10.0', false], ['24.0.0', false]] as const)(
  'uses the official SQLite URI support boundary at Node %s', async (node, needsCopy) => {
    const { activitySqliteNeedsOfflineCopy } = await import('../../../src/runtime/conversation-activity/readonly-snapshot.js');
    expect(activitySqliteNeedsOfflineCopy(node)).toBe(needsCopy);
  },
);

it.each([new Error('readonly_prepare_primary'), undefined])('constructor preserves prepare presence and retains its actual private data handle when close is unknown', primary => {
  const f = fixture();
  let actual: DatabaseSync | undefined, privatePath = '';
  vi.spyOn(DatabaseSync.prototype, 'prepare').mockImplementation(function (this: DatabaseSync, sql: string) {
    f.dbs.add(this);
    if (sql === 'PRAGMA user_version') {
      actual = this;
      privatePath = String((prepareDb.call(this, 'PRAGMA database_list').get() as { file: string }).file);
      throw primary;
    }
    return prepareDb.call(this, sql);
  });
  vi.spyOn(DatabaseSync.prototype, 'close').mockImplementation(function (this: DatabaseSync) {
    if (this === actual) throw undefined;
    closeDb.call(this); f.closed.add(this);
  });
  const result = attempt(() => read(f));
  expect(result.threw).toBe(true); expect(result.error).toBe(primary);
  expect(actual).toBeDefined(); expect(privatePath).toBe(nativeFs.realpathSync(join(seam.roots[0], 'activity.sqlite')));
  expect(nativeFs.existsSync(seam.roots[0])).toBe(true);
  expect([...f.dbs].filter(db => !f.closed.has(db))).toEqual([actual]);
});
it.each([new Error('owner_close_primary'), undefined])('unknown owner close refuses admission after independent descriptor closes', primary => {
  const f = fixture();
  let fence: DatabaseSync | undefined, dataPrepareCalls = 0;
  vi.spyOn(DatabaseSync.prototype, 'exec').mockImplementation(function (this: DatabaseSync, sql: string) {
    if (sql.includes('SELECT name FROM sqlite_schema')) fence = this;
    f.dbs.add(this); return execDb.call(this, sql);
  });
  vi.spyOn(DatabaseSync.prototype, 'prepare').mockImplementation(function (this: DatabaseSync, ...args: Parameters<DatabaseSync['prepare']>) {
    f.dbs.add(this); dataPrepareCalls += 1; return prepareDb.apply(this, args);
  });
  vi.spyOn(DatabaseSync.prototype, 'close').mockImplementation(function (this: DatabaseSync) {
    if (this === fence) throw primary;
    closeDb.call(this); f.closed.add(this);
  });
  const result = attempt(() => read(f)); expect(result.threw).toBe(true); expect(result.error).toBe(primary);
  expect(fence).toBeDefined(); expect(dataPrepareCalls).toBe(0); expect(seam.open.size).toBe(0);
  expect(nativeFs.existsSync(seam.roots[0])).toBe(true); expect(f.closed.has(fence!)).toBe(false);
});
it('keeps a body Error ahead of an undefined close failure and retains every unknown descriptor', () => {
  const f = fixture(), primary = Error('write_before_unknown_close');
  seam.write = () => { throw primary; };
  seam.close = () => { throw undefined; };
  const result = attempt(() => read(f)); expect(result.threw).toBe(true); expect(result.error).toBe(primary);
  expect(seam.open.size).toBe(2); expect([...f.dbs].every(db => f.closed.has(db))).toBe(true);
  expect(nativeFs.existsSync(seam.roots[0])).toBe(true);
});

it.each([new Error('owner_stat_primary'), undefined])('preserves an actual owner metadata SDK error including undefined', primary => {
  const f = fixture();
  seam.lstat = path => { if (path === f.file + '.owner.sqlite') throw primary; };
  const result = attempt(() => read(f)); expect(result.threw).toBe(true); expect(result.error).toBe(primary);
  expect(seam.open.size).toBe(0); expect(seam.roots).toHaveLength(0);
});

it('uses the real Store Windows branch without POSIX O_NOFOLLOW or a command shim', () => {
  const f = fixture(), descriptor = Object.getOwnPropertyDescriptor(process, 'platform');
  if (!descriptor) throw Error('actual_platform_descriptor_missing');
  let reader: ConversationActivityStore;
  try {
    Object.defineProperty(process, 'platform', { ...descriptor, value: 'win32' });
    reader = read(f);
  } finally { Object.defineProperty(process, 'platform', descriptor); }
  const source = [...seam.paths].find(([, path]) => path === f.file);
  expect(source).toBeDefined();
  expect(seam.flags.get(source![0])).toBe(nativeFs.constants.O_RDONLY);
  expect(reader!.getAssociation('op')).not.toBeNull();
  // The existing fixture children use this actual Node executable directly.
  expect(process.execPath.toLowerCase().endsWith('.cmd')).toBe(false);
});
