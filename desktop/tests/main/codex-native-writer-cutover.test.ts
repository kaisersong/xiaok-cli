import { afterAll, afterEach, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const env = await vi.hoisted(async () => {
  const fs = await import('node:fs'), os = await import('node:os'), path = await import('node:path');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-writer-account-'));
  fs.chmodSync(home, 0o700); const config = path.join(home, '.xiaok'); fs.mkdirSync(config, { mode: 0o700 });
  const previous = process.env.XIAOK_CONFIG_DIR; process.env.XIAOK_CONFIG_DIR = config;
  return { home, config, previous, kind: 'ordinary' as 'ordinary' | 'protected' | 'unavailable' };
});
// This adapter only drives a denial. It never creates an installed index/Native grant.
vi.mock('../../../src/runtime/verification/ordinary-source-writer-observation.js', async original =>
  await original<typeof import('../../../src/runtime/verification/ordinary-source-writer-observation.js')>());
vi.mock('../../../src/runtime/verification/migration-markers.js', async original => ({
  ...await original<typeof import('../../../src/runtime/verification/migration-markers.js')>(),
  readInstalledCurrentProfile: () => Object.freeze({ kind: env.kind }),
}));
vi.mock('node:os', async original => {
  const actual = await original<typeof import('node:os')>();
  const userInfo: typeof actual.userInfo = options => ({ ...actual.userInfo(options), homedir: env.home });
  return { ...actual, userInfo, homedir: () => env.home };
});
import { CodexNativeService, readOriginalCodexProcessSession } from '../../electron/codex-native-service.js';
import { createKnownDirectoryWriterFence } from '../../../src/runtime/verification/known-directory-writer-fence.js';
import { actor, newNativeFixture, cleanNative, rows, deferred, type ControlledCodexClient } from '../support/codex-writer-cutover-fixture.js';

console.log(JSON.stringify({ fixtureWorkerPid: process.pid, privateConfig: env.config, nativeGrant: false }));
let retainedUnknown=false;
const active: ReturnType<typeof newNativeFixture>[] = [];
function fixture() { const f = newNativeFixture(); active.push(f); return f; }
afterEach(async () => {
  vi.restoreAllMocks();
  const failures: unknown[] = [];
  for (const f of active.splice(0)) try { await cleanNative(f); } catch (raw) { failures.push(raw); console.log(JSON.stringify({ retainedRoot: f.root, pid: process.pid })); }
  env.kind = 'ordinary';
  if (failures.length) throw new AggregateError(failures, 'codex_cutover_fixture_close_failed');
});
afterAll(() => {
  if (env.previous === undefined) delete process.env.XIAOK_CONFIG_DIR; else process.env.XIAOK_CONFIG_DIR = env.previous;
  if(!retainedUnknown)rmSync(env.home, { recursive: true, force: true });
});

it.each(['protected', 'unavailable'] as const)('rejects new SQL and positive transport in a live original service after observing %s', async kind => {
  const f = fixture(), session = await f.service.create(actor, f.root);
  await f.service.send(actor, session.id, 'before');
  const before = rows(f.file, 'codex_native_sessions'), calls = [...f.clients[0].calls];
  env.kind = kind;
  await expect(f.service.send(actor, session.id, 'after-cut')).rejects.toThrow();
  await expect(f.service.create(actor, f.root)).rejects.toThrow();
  expect(rows(f.file, 'codex_native_sessions')).toEqual(before);
  expect(f.clients[0].calls.filter(x => ['start', 'steer', 'connect', 'create', 'resume'].includes(x))).toEqual(calls);
  env.kind = 'ordinary';
  await expect(f.service.send(actor, session.id, 'must-not-revive')).rejects.toThrow();
});

it.skipIf(process.platform === 'win32')('uses the original durable directory fence for a live native SQLite writer', async () => {
  const f = fixture(), session = await f.service.create(actor, f.root), before = rows(f.file, 'codex_native_sessions');
  createKnownDirectoryWriterFence(f.root, 'sqlite-db').persist();
  await expect(f.service.send(actor, session.id, 'after-fence')).rejects.toThrow();
  expect(rows(f.file, 'codex_native_sessions')).toEqual(before);
});

it('declines real pending callback state on cut without allowing an event to write a late projection', async () => {
  const f = fixture(), session = await f.service.create(actor, f.root);
  await f.service.send(actor, session.id, 'before');
  const pending = f.clients[0].approval(); expect(f.service.get(actor, session.id).approvals).toHaveLength(1);
  const before = rows(f.file, 'codex_native_sessions'); env.kind = 'protected';
  expect(() => f.clients[0].emit('item/agentMessage/delta', { itemId: 'late', delta: 'late' })).not.toThrow();
  expect(await pending).toEqual({ decision: 'decline' });
  expect(rows(f.file, 'codex_native_sessions')).toEqual(before);
  expect(() => f.service.readApprovalInventory(actor, session.id)).toThrow();
});

it('lets the original approval timeout decline after its first observation of cut, without uncaught save error', async () => {
  const f = fixture(), session = await f.service.create(actor, f.root); await f.service.send(actor, session.id, 'before');
  const pending = f.clients[0].approval(), before = rows(f.file, 'codex_native_sessions'); env.kind = 'unavailable';
  expect(await pending).toEqual({ decision: 'decline' });
  expect(rows(f.file, 'codex_native_sessions')).toEqual(before);
});

it('still waits the actual owned close promise while cut rejects projection writes', async () => {
  const f = fixture(), session = await f.service.create(actor, f.root); await f.service.send(actor, session.id, 'before');
  const gate = deferred(); f.clients[0].closeGate = gate.promise; env.kind = 'protected';
  try {
    await expect(f.service.send(actor, session.id, 'seal')).rejects.toThrow();
    let done = false; const closing = f.service.dispose().then(() => { done = true; });
    await vi.waitFor(() => expect(f.clients[0].calls).toContain('close-enter'));
    expect(done).toBe(false); gate.resolve(); await closing;
    expect(f.clients[0].calls).toContain('close-return');
  } finally { gate.resolve(); }
});

it('keeps actor and Source private membership denials independent from routing', async () => {
  const f = fixture();
  for (const source of ['agent', 'scheduler'] as const) await expect(f.service.create({ requestSource: source, actorId: actor.actorId }, f.root)).rejects.toThrow('native_access_denied');
  let reads = 0; const proxy = new Proxy({}, { get() { reads++; throw Error('must-not-read'); } });
  expect(() => readOriginalCodexProcessSession(proxy)).toThrow('CODEX_PROCESS_ORIGINAL_SESSION_REQUIRED'); expect(reads).toBe(0);
  expect(f.clients).toHaveLength(0);
});

it('keeps the Windows no-POSIX-fence branch denied by a non-ordinary route before opening a file', () => {
  const f = fixture(), file = join(f.root, 'new', 'win.sqlite');
  env.kind = 'protected'; const platform = vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
  try { expect(() => new CodexNativeService({ dbPath: file, profileId: actor.actorId })).toThrow('ordinary_source_route'); }
  finally { platform.mockRestore(); }
});

it('preserves an undefined SDK first cause when the following projection sees cut',async()=>{
  const f=fixture(),session=await f.service.create(actor,f.root),before=rows(f.file,'codex_native_sessions');
  f.clients[0].beforeStart=()=>{env.kind='protected';};f.clients[0].startFailure={raw:undefined};
  await expect(f.service.send(actor,session.id,'uncertain')).rejects.toBeUndefined();
  expect(f.service.get(actor,session.id).messages.at(-1)?.state).toBe('unknown');
  // The pre-SDK queued projection exists; the post-effect failure never overwrites it.
  expect(rows(f.file,'codex_native_sessions')).not.toEqual(before);
  expect(JSON.parse((rows(f.file,'codex_native_sessions')[0] as {snapshot:string}).snapshot).messages.at(-1).state).toBe('queued');
});
it('keeps acknowledged input sent when only the post-ACK projection is retired',async()=>{
  const f=fixture(),session=await f.service.create(actor,f.root);
  f.clients[0].afterStart=()=>{env.kind='protected';};
  await expect(f.service.send(actor,session.id,'acknowledged')).rejects.toThrow('CODEX_ORDINARY_WRITER_RETIRED');
  expect(f.service.get(actor,session.id).messages.at(-1)?.state).toBe('sent');
  env.kind='ordinary';await expect(f.service.send(actor,session.id,'never-retry')).rejects.toThrow();
  expect(f.clients[0].calls.filter(x=>x==='start')).toHaveLength(1);
});
it('owns a close raw Promise symbol tail until actual tail settlement',async()=>{
  const f=fixture(),session=await f.service.create(actor,f.root),tail=deferred();
  f.clients[0].closeTail=tail.promise;
  try{
    let done=false;const closing=f.service.dispose().then(()=>{done=true;});
    await vi.waitFor(()=>expect(f.clients[0].calls).toContain('close-return'));
    await new Promise(resolve=>setTimeout(resolve,15));expect(done).toBe(false);
    tail.resolve();await closing;expect(done).toBe(true);
  }finally{tail.resolve();}
});
it('declines pending state when original onFailure first observes retirement',async()=>{
  const f=fixture(),session=await f.service.create(actor,f.root);await f.service.send(actor,session.id,'before');
  const pending=f.clients[0].approval(),before=rows(f.file,'codex_native_sessions');env.kind='protected';
  expect(()=>f.clients[0].fail(Error('actual callback'))).not.toThrow();
  expect(await pending).toEqual({decision:'decline'});expect(rows(f.file,'codex_native_sessions')).toEqual(before);
  expect(await f.clients[0].approval()).toEqual({decision:'decline'});
});
it('a narrowing decision callback cannot accept after reentering a route cut',async()=>{
  const f=fixture(),session=await f.service.create(actor,f.root);await f.service.send(actor,session.id,'before');
  const pending=f.clients[0].approval(),token=f.service.get(actor,session.id).approvals[0].token,before=rows(f.file,'codex_native_sessions');
  await expect(f.service.decide(actor,session.id,token,'allow',()=>{env.kind='protected';})).rejects.toThrow();
  expect(await pending).toEqual({decision:'decline'});expect(rows(f.file,'codex_native_sessions')).toEqual(before);
});
it('keeps a thrown undefined interrupt cause and permanently retains unknown cleanup',async()=>{
  const f=fixture(),session=await f.service.create(actor,f.root);await f.service.send(actor,session.id,'before');
  f.clients[0].interruptFailure={raw:undefined};env.kind='protected';
  await expect(f.service.interrupt(actor,session.id)).rejects.toBeUndefined();
  const closed=await f.service.dispose().then(()=>({ok:true}),raw=>({ok:false,raw}));expect(closed.ok).toBe(false);
  expect(f.clients[0].calls).toContain('close-return');
  // Do not delete an unknown owner's DB/account or reattempt with a fresh row.
  retainedUnknown=true;active.splice(active.indexOf(f),1);
  console.log(JSON.stringify({retainedUnknownRoot:f.root,privateAccount:env.home,pid:process.pid,physicalClosedNotClaimed:true}));
});

it('checks again after original SQLite prepare returns before the actual write',async()=>{
  const f=fixture(),session=await f.service.create(actor,f.root),before=rows(f.file,'codex_native_sessions');
  const original=DatabaseSync.prototype.prepare;
  vi.spyOn(DatabaseSync.prototype,'prepare').mockImplementation(function(sql){
    const statement=Reflect.apply(original,this,[sql]);
    if(sql.startsWith('INSERT OR REPLACE INTO codex_native_sessions'))env.kind='protected';
    return statement;
  });
  await expect(f.service.send(actor,session.id,'never-sql-run')).rejects.toThrow();
  expect(rows(f.file,'codex_native_sessions')).toEqual(before);expect(f.clients[0].calls).not.toContain('start');
});
it('owns metadata symbol tails on the actual negative SDK function',async()=>{
  const f=fixture();await f.service.create(actor,f.root);const tail=deferred(),key=Symbol('fixed-close-function-tail'),fn=f.clients[0].close;
  Object.defineProperty(fn,key,{configurable:true,value:tail.promise});
  try{
    let done=false;const closing=f.service.dispose().then(()=>{done=true;});
    await vi.waitFor(()=>expect(f.clients[0].calls).toContain('close-return'));expect(done).toBe(false);
    delete (fn as unknown as Record<symbol,unknown>)[key];tail.resolve();await closing;
  }finally{delete (fn as unknown as Record<symbol,unknown>)[key];tail.resolve();}
});
