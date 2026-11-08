import { afterAll, afterEach, expect, it, vi } from 'vitest';
import { rmSync } from 'node:fs';
import { join } from 'node:path';

const env = await vi.hoisted(async () => {
  const fs = await import('node:fs'), os = await import('node:os'), path = await import('node:path');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-task-writer-account-'));
  fs.chmodSync(home, 0o700); const config = path.join(home, '.xiaok'); fs.mkdirSync(config, { mode: 0o700 });
  const previous = process.env.XIAOK_CONFIG_DIR; process.env.XIAOK_CONFIG_DIR = config;
  return { home, config, previous, kind: 'ordinary' as 'ordinary' | 'protected' | 'unavailable' };
});
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
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { closeNativeBeforeUse, saveNativeProjection, disconnectNative, sendNativeOwned } from '../../electron/codex-native-lifecycle.js';
import { beginCodexBridgeShutdown } from '../../electron/codex-task-operations.js';
import { createCodexRunObservation } from '../../electron/codex-task-observation.js';
import { CodexTaskBridge } from '../../electron/codex-task-bridge.js';
import { MaterialRegistry } from '../../../src/runtime/task-host/material-registry.js';
import { FileTaskSnapshotStore } from '../../../src/runtime/task-host/snapshot-store.js';
import { actor, ControlledCodexClient, clientFactory, rows } from '../support/codex-writer-cutover-fixture.js';
import { createKnownDirectoryWriterFence } from '../../../src/runtime/verification/known-directory-writer-fence.js';

console.log(JSON.stringify({ fixtureWorkerPid: process.pid, privateConfig: env.config, nativeGrant: false }));
let retainedUnknown=false;
const active: Array<{ root: string; bridge: CodexTaskBridge }> = [];
function fixture(admitThread?: ConstructorParameters<typeof CodexTaskBridge>[0]['admitThread']) {
  const root = mkdtempSync(join(tmpdir(), 'codex-task-cutover-')), clients: ControlledCodexClient[] = [];
  const bridge = new CodexTaskBridge({ dataRoot: root, profileId: actor.actorId, cwd: root,
    materialRegistry: new MaterialRegistry({ workspaceRoot: join(root, 'workspace') }),
    snapshotStore: new FileTaskSnapshotStore(join(root, 'tasks')), createClient: clientFactory(clients), admitThread });
  active.push({ root, bridge }); return { root, bridge, clients, file: join(root, 'codex-task-routes.sqlite') };
}
afterEach(async () => {
  vi.restoreAllMocks();
  const errors: unknown[] = [];
  for (const f of active.splice(0)) try { await f.bridge.dispose(); rmSync(f.root, { recursive: true, force: true }); }
  catch (raw) { errors.push(raw); console.log(JSON.stringify({ retainedRoot: f.root, pid: process.pid })); }
  env.kind = 'ordinary';
  if (errors.length) throw new AggregateError(errors, 'codex_task_cutover_fixture_close_failed');
});
afterAll(() => {
  if (env.previous === undefined) delete process.env.XIAOK_CONFIG_DIR; else process.env.XIAOK_CONFIG_DIR = env.previous;
  if(!retainedUnknown)rmSync(env.home, { recursive: true, force: true });
});

it.each(['protected', 'unavailable'] as const)('rejects the actual live select SQL after observing %s and cannot revive', async kind => {
  const f = fixture(); f.bridge.select(true); const before = rows(f.file, 'settings'); env.kind = kind;
  expect(() => f.bridge.select(false)).toThrow();
  expect(rows(f.file, 'settings')).toEqual(before);
  env.kind = 'ordinary'; expect(() => f.bridge.select(false)).toThrow();
});

it.skipIf(process.platform === 'win32')('rejects routes updates after the original durable fence covers both actual registered CodeX stores', () => {
  const f = fixture(), before = rows(f.file, 'settings');
  createKnownDirectoryWriterFence(f.root, 'sqlite-db').persist();
  expect(() => f.bridge.select(true)).toThrow();
  expect(rows(f.file, 'settings')).toEqual(before);
});

it('rechecks after the actual prepared-task admission callback before routes INSERT', async () => {
  let checks = 0;
  const f = fixture(async () => () => { if (++checks === 2) env.kind = 'protected'; });
  await expect(f.bridge.create({ prompt: 'bounded', materials: [], context: { threadId: 'thread' } }, actor)).rejects.toBeDefined();
  expect(checks).toBeGreaterThanOrEqual(2);
  expect(rows(f.file, 'routes')).toEqual([]);
  expect(f.clients).toHaveLength(0);
});

it('holds an original created native session through a reentrant DTO read before threads INSERT', async () => {
  const f = fixture(), clone = globalThis.structuredClone;
  let returnedNativeId = false;
  vi.spyOn(globalThis, 'structuredClone').mockImplementation(value => {
    const copy = clone(value);
    if (copy && typeof copy === 'object' && 'title' in copy && copy.title === 'Codex' && 'nativeId' in copy === false && 'messages' in copy && 'id' in copy) {
      const id = copy.id;
      Object.defineProperty(copy, 'id', { configurable: true, enumerable: true, get() { returnedNativeId = true; env.kind = 'protected'; return id; } });
    }
    return copy;
  });
  const prepared = await f.bridge.create({ prompt: 'bounded', materials: [], context: { threadId: 'thread' } }, actor);
  await vi.waitFor(() => expect(returnedNativeId).toBe(true));
  expect(rows(f.file, 'threads')).toEqual([]);
  await vi.waitFor(() => expect(f.clients[0]?.calls).toContain('close-enter'));
  // No response/native grant is fabricated: the controlled transport was really
  // constructed by the original Service; only the returned display DTO reenters.
  expect(f.clients[0]?.calls).toContain('create');
});

it('a bridge-observed cut also prevents its original native sibling from reviving',async()=>{
  const f=fixture(),service=(f.bridge as unknown as {native:import('../../electron/codex-native-service.js').CodexNativeService}).native;
  const session=await service.create(actor,f.root);env.kind='protected';expect(()=>f.bridge.select(true)).toThrow();
  env.kind='ordinary';await expect(service.send(actor,session.id,'must-stay-denied')).rejects.toThrow();
  expect(f.clients[0].calls).not.toContain('start');
});
it('a native-observed cut also prevents the original routes sibling from reviving',async()=>{
  const f=fixture(),service=(f.bridge as unknown as {native:import('../../electron/codex-native-service.js').CodexNativeService}).native;
  const session=await service.create(actor,f.root);env.kind='protected';await expect(service.send(actor,session.id,'cut')).rejects.toThrow();
  env.kind='ordinary';expect(()=>f.bridge.select(true)).toThrow();expect(rows(f.file,'settings')).toEqual([]);
});

it('fixed cleanup/projection/observer consumers reject foreign and copied members before Proxy traps',async()=>{
  let traps=0;const foreign=new Proxy({},{get(){traps++;throw undefined;},getOwnPropertyDescriptor(){traps++;throw undefined;},ownKeys(){traps++;throw undefined;}});
  expect(()=>closeNativeBeforeUse(foreign)).toThrow('CODEX_PROCESS_ORIGINAL_SERVICE_REQUIRED');
  expect(()=>saveNativeProjection(foreign,foreign as never)).toThrow('CODEX_PROCESS_ORIGINAL_SERVICE_REQUIRED');
  await expect(disconnectNative(foreign,actor,'x')).rejects.toThrow('CODEX_PROCESS_ORIGINAL_SERVICE_REQUIRED');
  await expect(sendNativeOwned(foreign,actor,'x','x')).rejects.toThrow('CODEX_PROCESS_ORIGINAL_SERVICE_REQUIRED');
  expect(()=>beginCodexBridgeShutdown(foreign)).toThrow('CODEX_PROCESS_ORIGINAL_BRIDGE_REQUIRED');
  expect(()=>createCodexRunObservation(foreign,foreign)).toThrow('CODEX_RUN_OBSERVATION_REQUIRED');
  const f=fixture();expect(()=>createCodexRunObservation(f.bridge,{input:{},run:{}})).toThrow('CODEX_RUN_OBSERVATION_REQUIRED');expect(traps).toBe(0);
});

it('reads actual prepared task DTO arguments before the last route SQL check',async()=>{
  const f=fixture(),original=f.bridge.host.prepareTask;
  vi.spyOn(f.bridge.host,'prepareTask').mockImplementation(async input=>{
    const task=await Reflect.apply(original,f.bridge.host,[input]),id=task.taskId;
    Object.defineProperty(task,'taskId',{configurable:true,enumerable:true,get(){env.kind='protected';return id;}});return task;
  });
  await expect(f.bridge.create({prompt:'bounded',materials:[],context:{threadId:'thread'}},actor)).rejects.toBeDefined();
  expect(rows(f.file,'routes')).toEqual([]);expect(f.clients).toHaveLength(0);
});
it('attempts the original Host drain even if the original native membership check throws synchronously',async()=>{
  const f=fixture(),native=(f.bridge as unknown as {native:import('../../electron/codex-native-service.js').CodexNativeService}).native;
  const internal=native as unknown as {db:unknown},db=internal.db,originalDrain=f.bridge.host.drain;let entered=false;
  vi.spyOn(f.bridge.host,'drain').mockImplementation(function(){entered=true;return Reflect.apply(originalDrain,this,[]);});
  internal.db={};
  try{
    await expect(f.bridge.quiesceShutdown()).rejects.toBeDefined();expect(entered).toBe(true);
    internal.db=db;expect(()=>f.bridge.select(true)).toThrow();
    await native.dispose();
  }finally{
    internal.db=db;retainedUnknown=true;active.splice(active.findIndex(x=>x.bridge===f.bridge),1);
    console.log(JSON.stringify({retainedUnknownRoot:f.root,privateAccount:env.home,pid:process.pid,physicalClosedNotClaimed:true}));
  }
});
