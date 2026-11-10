// @vitest-environment node
import {afterAll, afterEach, beforeEach, expect, it, vi} from 'vitest';
import {DatabaseSync} from 'node:sqlite';
import {existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';

const state = vi.hoisted(() => ({calls: 0, present: false, error: undefined as unknown}));
const isolated = await vi.hoisted(async () => {
  const fs = await import('node:fs'), path = await import('node:path'), os = await import('node:os');
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'loop-runtime-registry-fault-config-')));
  fs.chmodSync(root, 0o700);
  const previous = process.env.XIAOK_CONFIG_DIR, config = path.join(root, 'initial', '.xiaok');
  fs.mkdirSync(config, {recursive: true, mode: 0o700});
  process.env.XIAOK_CONFIG_DIR = config;
  return {root, previous};
});
vi.mock('../../electron/loop-database-source-observation.js', async load => {
  const actual = await load<typeof import('../../electron/loop-database-source-observation.js')>();
  return {...actual, registerLoopDatabaseSourceObservation(source: Parameters<typeof actual.registerLoopDatabaseSourceObservation>[0]) {
    state.calls++;
    if (state.present) throw state.error;
    return actual.registerLoopDatabaseSourceObservation(source);
  }};
});
vi.unmock('../../../src/runtime/verification/ordinary-source-writer-observation.js');
vi.mock('../../../src/runtime/verification/migration-markers.js', () => ({
  readInstalledCurrentProfile: () => ({kind: 'ordinary'}),
}));

const exec = DatabaseSync.prototype.exec, close = DatabaseSync.prototype.close;
let root: string, serial = 0;
const opened = new Set<DatabaseSync>();
const closeCalls: DatabaseSync[] = [];
const returned: Array<{close(): void}> = [];
beforeEach(() => {
  vi.resetModules();
  state.calls = 0; state.present = true; state.error = undefined;
  root = realpathSync(mkdtempSync(join(tmpdir(), 'loop-runtime-registry-fault-data-')));
  const config = join(isolated.root, 'case-' + ++serial, '.xiaok');
  mkdirSync(config, {recursive: true, mode: 0o700});
  process.env.XIAOK_CONFIG_DIR = config;
  vi.spyOn(DatabaseSync.prototype, 'exec').mockImplementation(function (this: DatabaseSync, sql: string) {
    if (sql === 'PRAGMA journal_mode=WAL') opened.add(this);
    return Reflect.apply(exec, this, [sql]);
  });
});
afterEach(() => {
  // Test-only teardown never turns the product's unknown close into known.
  for (const runtime of returned.splice(0)) { try { runtime.close(); } catch {} }
  vi.restoreAllMocks();
  for (const db of opened) {
    try { Reflect.apply(close, db, []); }
    catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== 'ERR_INVALID_STATE' || (error as Error).message !== 'database is not open') throw error;
    }
  }
  opened.clear(); closeCalls.length = 0;
  rmSync(root, {recursive: true, force: true});
});
afterAll(() => {
  if (isolated.previous === undefined) delete process.env.XIAOK_CONFIG_DIR;
  else process.env.XIAOK_CONFIG_DIR = isolated.previous;
  rmSync(isolated.root, {recursive: true, force: true});
});

it.skipIf(process.platform === 'win32').each([false, true])('keeps the actual registration primary (%s undefined) and closes every entered database', async bare => {
  const primary = bare ? undefined : Error('actual-registration-fault');
  state.error = primary;
  vi.spyOn(DatabaseSync.prototype, 'close').mockImplementation(function (this: DatabaseSync) {
    closeCalls.push(this); return Reflect.apply(close, this, []);
  });
  const {createDesktopLoopRuntime} = await import('../../electron/loop-executor.js');
  let failed = false, caught: unknown;
  try { returned.push(createDesktopLoopRuntime({dataRoot: root, loopDbPath: join(root, 'loops.sqlite'),
    completionEvidenceDbPath: join(root, 'evidence.sqlite')})); }
  catch (error) { failed = true; caught = error; }
  expect(failed).toBe(true);
  expect(caught).toBe(primary);
  expect(state.calls).toBe(1);
  expect(opened.size).toBe(2);
  expect(new Set(closeCalls)).toEqual(opened);
  for (const db of opened) expect(() => db.prepare('SELECT 1').get()).toThrow('database is not open');
});

it.skipIf(process.platform === 'win32').each([false, true])('retains an unknown close (%s undefined), attempts its sibling, and prevents any new runtime birth', async bare => {
  const primary = Error('actual-registration-fault'), cleanup = bare ? undefined : Error('actual-close-unconfirmed');
  state.error = primary;
  let unknown: DatabaseSync | undefined;
  vi.spyOn(DatabaseSync.prototype, 'close').mockImplementation(function (this: DatabaseSync) {
    closeCalls.push(this);
    if (!unknown) { unknown = this; throw cleanup; }
    return Reflect.apply(close, this, []);
  });
  const {createDesktopLoopRuntime} = await import('../../electron/loop-executor.js');
  let failed = false, caught: unknown;
  try { returned.push(createDesktopLoopRuntime({dataRoot: root, loopDbPath: join(root, 'loops.sqlite'),
    completionEvidenceDbPath: join(root, 'evidence.sqlite')})); }
  catch (error) { failed = true; caught = error; }
  expect(failed).toBe(true);
  expect(caught).toBe(primary);
  expect(opened.size).toBe(2);
  expect(new Set(closeCalls)).toEqual(opened);
  expect(unknown!.prepare('SELECT 1').get()).toBeDefined();
  const before = opened.size;
  let traps = 0;
  const fake = new Proxy({}, {get() { traps++; throw Error('options-must-not-be-read'); }});
  expect(() => createDesktopLoopRuntime(fake as never)).toThrow('loop_runtime_cleanup_unconfirmed');
  expect(traps).toBe(0);
  expect(opened.size).toBe(before);
  expect(existsSync(join(root, 'new-runtime'))).toBe(false);
});
