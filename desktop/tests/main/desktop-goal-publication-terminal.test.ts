// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createDesktopGoalShutdownOwner } from '../../electron/desktop-goal-shutdown-owner.js';
const remote = vi.hoisted(() => ({ protected: false, app: {} as any, owner: {} as any, committed: false, approve: vi.fn(), prepare: vi.fn(), recover: vi.fn() }));
vi.mock('../../../src/runtime/verification/installed-owner-state.js', () => ({ readInstalledCurrentOwner: (owner: unknown) => remote.protected ? ({ kind: 'protected-unregistered', authorityId: 'authority', owner: { profileId: 'profile', ...(owner as object) } }) : ({ kind: 'ordinary' }) }));
vi.mock('../../../src/runtime/verification/installed-goal-application.js', () => ({ createInstalledGoalApplicationClient: () => ({ inspect: async () => ({ state: 'active', current: remote.app, pendingTransitionId: null, pendingTarget: null }), dispose() {} }) }));
vi.mock('../../../src/runtime/verification/installed-completion-publication.js', () => ({ createInstalledCompletionPublisher: () => ({
  prepareRequest: remote.prepare, approve: remote.approve, recoverRequest: remote.recover,
  reconcile: async () => ({ status: 'committed', owner: remote.owner, operationId: 'operation', fullTupleHash: 'a'.repeat(64), businessRevision: 1, currentVerification: 'valid' }),
  observe: async () => ({ owner: remote.owner, businessRevision: 1, currentVerification: 'valid', publication: remote.committed
    ? { status: 'committed', current: true, operationId: 'operation', fullTupleHash: 'a'.repeat(64) } : { status: 'absent' } }),
  readPayload: async () => {
    const bytes = Buffer.from(json({ version: 1, owner: remote.owner, application: remote.app, dependencies: [], evaluations: [] }));
    return { owner: remote.owner, businessRevision: 1, operationId: 'operation', fullTupleHash: 'a'.repeat(64), payloadHash: createHash('sha256').update(bytes).digest('hex'), bytes };
  }, dispose() {},
}) }));
import { canonicalVerificationJson as json } from '../../../src/runtime/verification/protocol.js';
import { goalApplicationBindingHash } from '../../../src/runtime/verification/goal-application-binding.js';
import { goalApplicationFromState } from '../../../src/runtime/goal/completion-intent.js';
import { DesktopGoalCoordinator } from '../../electron/desktop-goal-coordinator.js';
import { SqliteGoalStore } from '../../electron/goal-store-sqlite.js';
import type { PersistedTaskEvent } from '../../../src/runtime/task-host/task-runtime-host.js';
import { DesktopMultiAgentService } from '../../electron/desktop-multi-agent-service.js';
import { DesktopMultiAgentStore } from '../../electron/desktop-multi-agent-store.js';
import { DesktopExecutionCoordinator } from '../../electron/desktop-execution-coordinator.js';
import { InProcessTaskRuntimeHost } from '../../../src/runtime/task-host/task-runtime-host.js';
import { FileTaskSnapshotStore } from '../../../src/runtime/task-host/snapshot-store.js';
import { MaterialRegistry } from '../../../src/runtime/task-host/material-registry.js';
const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
beforeEach(() => { remote.protected = false; remote.committed = false; remote.prepare.mockReset(); remote.approve.mockReset(); remote.recover.mockReset(); });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
async function fixture(actualWorkspace = false) {
  const root = mkdtempSync(join(tmpdir(), 'goal-main-publication-')); cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  const store = new SqliteGoalStore(join(root, 'goals.db')); cleanups.push(() => store.close());
  const host = { prepareTask: vi.fn(async () => ({ taskId: 'task' })), startTask: vi.fn(async () => {}), cancelTask: vi.fn(async () => {}) };
  let coordinator!: DesktopGoalCoordinator, multiAgent: DesktopMultiAgentService | undefined;
  let setAllowed: (allowed:boolean)=>Promise<unknown> = async()=>{throw Error('workspace fixture required');};
  if(actualWorkspace){
    const agents=new DesktopMultiAgentStore(join(root,'groups.sqlite'));cleanups.push(()=>agents.close());
    multiAgent=new DesktopMultiAgentService({store:agents,coordinator:new DesktopExecutionCoordinator(),
      executionDomain:{profileId:'profile',workspaceId:'workspace',cwd:root,actorId:'user'},
      createSession:async()=>{throw Error('no managed children in this fixture');},
      stopForWorkspaceExecutionRevocation:()=>coordinator.stopForWorkspaceExecutionRevocation({requestSource:'user'}),
    });
    multiAgent.registerThread({threadId:'thread',profileId:'profile',workspaceId:'workspace',cwd:root});
    const actualHost=new InProcessTaskRuntimeHost({snapshotStore:new FileTaskSnapshotStore(join(root,'tasks')),
      materialRegistry:new MaterialRegistry({workspaceRoot:join(root,'materials'),maxBytes:1024}),runner:async()=>{}});
    await multiAgent.initialize(actualHost);
    const service=multiAgent;cleanups.push(async()=>{await actualHost.drain();await service.dispose();});
    const access=service.createWorkspaceUserAccess({requestSource:'user',profileId:'profile',workspaceId:'workspace',actorId:'user'});let nonce=0;
    setAllowed=allowed=>{const current=service.getExecutionAuthorization();return service.setExecutionAuthorization({access,requestSource:'user',confirm:true,executionAllowed:allowed,expectedPermissionRevision:current.permissionRevision,operationId:`exec-auth:${current.bootId}:${current.permissionRevision}:publication${++nonce}`});};
  }
  coordinator = new DesktopGoalCoordinator({ store, taskHost: host, instanceId: 'desktop', now: () => 10, multiAgent }); cleanups.push(() => coordinator.disarmAll());
  const created = await coordinator.createGoal({ threadId: 'thread', objective: 'original', expectedEvidenceKinds: ['answer'], turnLimit: 1 });
  const binding = goalApplicationFromState(created.goal.state);
  remote.app = { binding, bindingHash: goalApplicationBindingHash(binding), revision: 1 };
  remote.owner = { profileId: 'profile', ownerKind: 'goal', ownerId: created.goal.state.goalId };
  // Completion tests start from an existing ordinary Goal admitted before profile protection.
  remote.protected = true;
  await coordinator.ackGoalTaskAttached({ threadId: 'thread', attachmentId: created.preparedTask.attachmentId });
  await coordinator.createGoalToolHost('task').requestComplete('original claim');
  const challenge = { challengeId: 'challenge', owner: remote.owner, fullTupleHash: 'a'.repeat(64), deadline: { domainId: 'clock', qualificationEpoch: 1, notBefore: 1, validUntil: 200 } };
  remote.prepare.mockResolvedValue(challenge);
  const observation = { status: 'committed' as const, owner: remote.owner, operationId: 'operation', fullTupleHash: 'a'.repeat(64), businessRevision: 1, currentVerification: 'valid' as const };
  remote.approve.mockImplementation(async () => { remote.committed = true; return observation; });
  remote.recover.mockResolvedValue({ status: 'settlement_exists', owner: remote.owner, challengeId: 'challenge', operationId: 'operation', fullTupleHash: 'a'.repeat(64), challenge });
  const terminal: PersistedTaskEvent = { taskId: 'task', eventIndex: 1, event: { type: 'task_terminal', status: 'completed' }, snapshot: {
    taskId: 'task', sessionId: 'session', status: 'completed', prompt: 'prompt', materials: [],
    events: [{ type: 'assistant_delta', delta: 'actual answer', eventId: 'answer' }, { type: 'task_terminal', status: 'completed' }],
    understanding: { goal: 'goal', deliverable: 'answer', taskType: 'unknown', audience: 'user', inputs: [], missingInfo: [], assumptions: [], riskLevel: 'low', suggestedPlan: [], nextAction: 'answer' },
    executionScope: created.preparedTask.executionScope, usage: { inputTokens: 2, outputTokens: 3, known: true }, createdAt: 1, updatedAt: 2,
  } };
  return { store, host, coordinator, terminal, observation, setAllowed, challenge };
}
it('the actual final budget turn publishes and completes without admitting another task or counting usage twice', async () => {
  const f = await fixture();
  await f.coordinator.handlePersistedTaskEvent(f.terminal);
  expect((await f.store.load('thread'))!.state).toMatchObject({ status: 'complete', turnsUsed: 1, tokensUsed: 5 });
  await f.coordinator.handlePersistedTaskEvent(f.terminal);
  expect((await f.store.load('thread'))!.turns).toHaveLength(1);
  expect(remote.approve).toHaveBeenCalledTimes(1); expect(f.host.prepareTask).toHaveBeenCalledTimes(1);
});
it('native wait holds no thread queue: pause succeeds and late commit preserves the paused Goal with one usage record', async () => {
  const f = await fixture(), release = deferred<typeof f.observation>();
  remote.approve.mockImplementation(async () => { const result = await release.promise; remote.committed = true; return result; });
  const running = f.coordinator.handlePersistedTaskEvent(f.terminal); void running.catch(() => {});
  try {
    await vi.waitFor(() => expect(remote.approve).toHaveBeenCalledTimes(1), { timeout: 2000 });
    expect((await f.store.load('thread'))!.state).toMatchObject({ turnsUsed: 1, tokensUsed: 5 });
    const paused = await f.coordinator.pauseGoal({ threadId: 'thread' });
    expect(paused.state.status).toBe('paused');
    await expect(f.coordinator.resumeGoal({ threadId: 'thread' })).rejects.toThrow(/publication_pending/);
    release.resolve(f.observation); await running;
    expect((await f.store.load('thread'))!.state.status).toBe('paused');
    expect((await f.store.load('thread'))!.completionIntents![0].status).toBe('committed');
    expect(f.host.prepareTask).toHaveBeenCalledTimes(1);
  } finally { release.resolve(f.observation); await running.catch(() => {}); }
});
it('duplicate terminal after a lost approval reply recovers its original attempt without another native approval', async () => {
  const f = await fixture(); remote.approve.mockRejectedValue(Error('reply lost'));
  await f.coordinator.handlePersistedTaskEvent(f.terminal).catch(() => {});
  expect((await f.store.load('thread'))!.state).toMatchObject({ turnsUsed: 1, tokensUsed: 5 });
  remote.committed = true;
  await f.coordinator.handlePersistedTaskEvent(f.terminal);
  expect(remote.approve).toHaveBeenCalledTimes(1); expect(remote.prepare).toHaveBeenCalledTimes(1); expect(remote.recover).toHaveBeenCalledTimes(1);
  expect((await f.store.load('thread'))!.state.status).toBe('complete');
});

it('user recovery while paused only reconciles history, then explicit continue projects without another task or approval', async () => {
  const f = await fixture(); remote.approve.mockRejectedValue(Error('reply lost'));
  await f.coordinator.handlePersistedTaskEvent(f.terminal).catch(() => {});
  await f.coordinator.pauseGoal({ threadId: 'thread' }); remote.committed = true;
  const recovered = await f.coordinator.recoverGoalPublication({ threadId: 'thread', requestSource: 'user' });
  expect(recovered!.state.status).toBe('paused');
  const continued = await f.coordinator.continueGoalPublication({ threadId: 'thread', requestSource: 'user' });
  expect(continued!.state).toMatchObject({ status: 'complete', turnsUsed: 1, tokensUsed: 5 });
  expect(remote.approve).toHaveBeenCalledTimes(1); expect(remote.prepare).toHaveBeenCalledTimes(1);
  expect(f.host.prepareTask).toHaveBeenCalledTimes(1);
});
it.each(['agent', 'scheduler'] as const)('publication recovery and continue reject %s sources before remote access', async requestSource => {
  const f = await fixture();
  await expect(f.coordinator.recoverGoalPublication({ threadId: 'thread', requestSource })).rejects.toThrow(/source/);
  await expect(f.coordinator.continueGoalPublication({ threadId: 'thread', requestSource })).rejects.toThrow(/source/);
  expect(remote.prepare).not.toHaveBeenCalled(); expect(remote.recover).not.toHaveBeenCalled();
});
it('the settled turn / missing attempt crash gap does not replay native until explicit user continue', async () => {
  const f = await fixture();
  const { GoalService } = await import('../../../src/runtime/goal/service.js');
  const service = new GoalService({ store: f.store, ownership: { assertOwned() {} }, now: () => 10 });
  const document = (await f.store.load('thread'))!, intent = document.completionIntents![0];
  await service.settleTurn({ sessionId: 'thread', expectedRevision: document.state.revision, requestSource: 'runtime', instanceId: 'desktop' }, {
    turnId: intent.turnId, tokensUsed: 5, activeWallClockMs: 1, terminalDecision: { kind: 'publication_pending', intentId: intent.intentId },
  });
  await f.coordinator.handlePersistedTaskEvent(f.terminal);
  await f.coordinator.recoverGoalPublication({ threadId: 'thread', requestSource: 'user' });
  expect(remote.prepare).not.toHaveBeenCalled(); expect(remote.approve).not.toHaveBeenCalled();
  expect((await f.coordinator.continueGoalPublication({ threadId: 'thread', requestSource: 'user' }))!.state.status).toBe('complete');
  expect(remote.prepare).toHaveBeenCalledTimes(1); expect(remote.approve).toHaveBeenCalledTimes(1);
  expect(f.host.prepareTask).toHaveBeenCalledTimes(1);
});

it('actual workspace revocation reaches a publication-only thread and refuses new continue while preserving late committed history',async()=>{
 const f=await fixture(true),release=deferred<typeof f.observation>();
 remote.approve.mockImplementation(async()=>{const result=await release.promise;remote.committed=true;return result;});
 const running=f.coordinator.handlePersistedTaskEvent(f.terminal);void running.catch(()=>{});
 try{
  await vi.waitFor(()=>expect(remote.approve).toHaveBeenCalledTimes(1));
  expect((await f.coordinator.getGoal('thread'))!.activation).toBe('disarmed');
  await f.setAllowed(false);
  await vi.waitFor(async()=>expect((await f.store.load('thread'))!.state).toMatchObject({status:'paused',terminalReason:'permission_revoked',turnsUsed:1,tokensUsed:5}));
  release.resolve(f.observation);await running;
  expect((await f.store.load('thread'))!.state.status).toBe('paused');
  expect((await f.store.load('thread'))!.completionIntents![0].status).toBe('committed');
  await expect(f.coordinator.continueGoalPublication({threadId:'thread',requestSource:'user'})).rejects.toThrow();
  expect(remote.approve).toHaveBeenCalledTimes(1);expect(f.host.prepareTask).toHaveBeenCalledTimes(1);
 }finally{release.resolve(f.observation);await running.catch(()=>{});}
});
it('disarmAll invalidates an in-flight publication projection without discarding its original completion facts',async()=>{
 const f=await fixture(),release=deferred<typeof f.observation>();
 remote.approve.mockImplementation(async()=>{const result=await release.promise;remote.committed=true;return result;});
 const running=f.coordinator.handlePersistedTaskEvent(f.terminal);void running.catch(()=>{});
 try{
  await vi.waitFor(()=>expect(remote.approve).toHaveBeenCalledTimes(1));f.coordinator.disarmAll();
  release.resolve(f.observation);await running.catch(()=>{});
  expect((await f.store.load('thread'))!.completionIntents![0].status).toBe('committed');
  expect((await f.store.load('thread'))!.state.status).not.toBe('complete');
  expect(f.host.prepareTask).toHaveBeenCalledTimes(1);
 }finally{release.resolve(f.observation);await running.catch(()=>{});}
});

it('disarm during prepare preserves the original durable request without invoking native approval',async()=>{
 const f=await fixture(),release=deferred<typeof f.challenge>();remote.prepare.mockImplementation(()=>release.promise);
 const running=f.coordinator.handlePersistedTaskEvent(f.terminal);void running.catch(()=>{});
 try{
  await vi.waitFor(()=>expect(remote.prepare).toHaveBeenCalledTimes(1));f.coordinator.disarmAll();
  release.resolve(f.challenge);await expect(running).rejects.toThrow('goal_publication_disarmed');
  const document=(await f.store.load('thread'))!;
  expect(document.state.status).toBe('active');expect(document.state.pendingCompletionIntentId).toBeTruthy();
  expect(await f.store.listCompletionAttempts('thread',document.state.pendingCompletionIntentId!)).toHaveLength(1);
  expect(remote.approve).not.toHaveBeenCalled();expect(f.host.prepareTask).toHaveBeenCalledTimes(1);
 }finally{release.resolve(f.challenge);await running.catch(()=>{});}
});
it('workflow captures its host admission once and rejects an asynchronous permission result',async()=>{
 const f=await fixture();
 const {GoalService}=await import('../../../src/runtime/goal/service.js');
 const {createGoalPublicationWorkflow}=await import('../../../src/runtime/goal/publication-workflow.js');
 const document=(await f.store.load('thread'))!,intent=document.completionIntents![0];
 await new GoalService({store:f.store,ownership:{assertOwned(){}},now:()=>10}).settleTurn({sessionId:'thread',expectedRevision:document.state.revision,requestSource:'runtime',instanceId:'desktop'},
  {turnId:intent.turnId,tokensUsed:5,activeWallClockMs:1,terminalDecision:{kind:'publication_pending',intentId:intent.intentId}});
 const original=vi.fn(async()=>{}),replacement=vi.fn();
 const options={store:f.store,now:()=>10,assertAdmission:original};const workflow=createGoalPublicationWorkflow(options);
 options.assertAdmission=replacement;
 await expect(workflow.run({sessionId:'thread',intentId:intent.intentId,requestSource:'user',action:'start'})).rejects.toThrow('goal_publication_admission_sync');
 expect(original).toHaveBeenCalledTimes(1);expect(replacement).not.toHaveBeenCalled();expect(remote.prepare).not.toHaveBeenCalled();
 expect(await f.store.listCompletionAttempts('thread',intent.intentId)).toHaveLength(0);
});
it('disarm during the terminal persistence await cannot start publication using a fresh epoch',async()=>{
 const f=await fixture(),entered=deferred<void>(),release=deferred<void>();const commit=f.store.commit.bind(f.store);
 const spy=vi.spyOn(f.store,'commit').mockImplementation(async input=>{await commit(input);if(input.next.pendingCompletionIntentId){entered.resolve();await release.promise;}});
 const running=f.coordinator.handlePersistedTaskEvent(f.terminal);void running.catch(()=>{});
 try{await entered.promise;f.coordinator.disarmAll();release.resolve();await running.catch(()=>{});
  expect(remote.prepare).not.toHaveBeenCalled();expect(remote.approve).not.toHaveBeenCalled();
  expect((await f.store.load('thread'))!.state.status).toBe('active');
 }finally{release.resolve();await running.catch(()=>{});spy.mockRestore();}
});
it('disarm while explicit continue reads actual attempts leaves the paused pending Goal unchanged',async()=>{
 const f=await fixture();remote.approve.mockRejectedValue(Error('reply lost'));await f.coordinator.handlePersistedTaskEvent(f.terminal).catch(()=>{});
 await f.coordinator.pauseGoal({threadId:'thread'});const original=f.store.listCompletionAttempts.bind(f.store),entered=deferred<void>(),release=deferred<void>();
 const spy=vi.spyOn(f.store,'listCompletionAttempts').mockImplementation(async(...args)=>{const rows=await original(...args);entered.resolve();await release.promise;return rows;});
 const running=f.coordinator.continueGoalPublication({threadId:'thread',requestSource:'user'});void running.catch(()=>{});
 try{await entered.promise;f.coordinator.disarmAll();release.resolve();await expect(running).rejects.toThrow('goal_publication_disarmed');
  expect((await f.store.load('thread'))!.state.status).toBe('paused');expect(remote.recover).not.toHaveBeenCalled();
 }finally{release.resolve();await running.catch(()=>{});spy.mockRestore();}
});

it('actual app shutdown retains SQLite while native publication is held and rejects later Goal ingress', async () => {
  const f = await fixture(), release = deferred<typeof f.observation>();
  remote.approve.mockImplementation(async () => { const result = await release.promise; remote.committed = true; return result; });
  const running = f.coordinator.handlePersistedTaskEvent(f.terminal); void running.catch(() => {});
  const { DesktopShutdownCoordinator } = await import('../../electron/desktop-shutdown-coordinator.js');
  const { DesktopShutdownGate } = await import('../../electron/shutdown-aware-ipc-main.js');
  const owner = createDesktopGoalShutdownOwner(f.coordinator, f.store);
  const close = vi.spyOn(f.store, 'close');
  try {
    await vi.waitFor(() => expect(remote.approve).toHaveBeenCalledTimes(1));
    const shutdown = new DesktopShutdownCoordinator({ gate: new DesktopShutdownGate(),
      providerRuntime: { beginShutdown: () => ({ leases: [], waitForSettled: async () => true }), hideAndAbortNonProtected() {}, closeOrdinaryProviders: async () => ({ cleanupFailed: [] }) },
      ingressOwners: [owner.ingress],
      durableStores: [owner.durable],
      destroyWindows() {}, disposeLifetimeResources: async () => {}, releaseMainSourcePin: async () => {}, continuation() {}, ordinaryCleanupDeadlineMs: 20,
    });
    const pending = shutdown.onBeforeQuit().shutdown;
    await expect(f.coordinator.continueGoalPublication({ threadId: 'thread', requestSource: 'user' })).rejects.toThrow('goal_coordinator_closed');
    await expect(f.coordinator.handlePersistedTaskEvent(f.terminal)).rejects.toThrow('goal_coordinator_closed');
    const report = await pending; expect(report.storesClosed).toBe(false); expect(close).not.toHaveBeenCalled();
    await expect(owner.durable.close()).rejects.toThrow('goal_shutdown_not_drained');
    expect(await f.store.load('thread')).not.toBeNull();
    release.resolve(f.observation); await running.catch(() => {});
    expect((await f.store.load('thread'))!.completionIntents![0].status).toBe('committed');
    expect((await f.store.load('thread'))!.state.status).not.toBe('complete');
    expect(await f.coordinator.drainShutdown(20)).toBe(true);
  } finally { release.resolve(f.observation); await running.catch(() => {}); }
});

it('shutdown waits for an actual queued SQLite read before reporting Goal drained', async () => {
  const f = await fixture(), entered = deferred<void>(), release = deferred<void>();
  const load = f.store.load.bind(f.store); let once = true;
  vi.spyOn(f.store, 'load').mockImplementation(async id => { if (once) { once = false; entered.resolve(); await release.promise; } return load(id); });
  const reading = f.coordinator.getGoal('thread'); void reading.catch(() => {});
  await entered.promise;
  try {
    f.coordinator.stopAccepting();
    expect(await f.coordinator.drainShutdown(10)).toBe(false);
    await expect(f.coordinator.pauseGoal({ threadId: 'thread' })).rejects.toThrow('goal_coordinator_closed');
    release.resolve(); await reading.catch(() => {});
    expect(await f.coordinator.drainShutdown(20)).toBe(true);
  } finally { release.resolve(); await reading.catch(() => {}); }
});


it('the registered Goal durable owner closes actual SQLite only after the shutdown census drains', async () => {
  const f = await fixture();
  const close = f.store.close.bind(f.store); let wasClosed = false;
  vi.spyOn(f.store, 'close').mockImplementation(() => { if (!wasClosed) { close(); wasClosed = true; } });
  const owner = createDesktopGoalShutdownOwner(f.coordinator, f.store);
  const { DesktopShutdownCoordinator } = await import('../../electron/desktop-shutdown-coordinator.js');
  const { DesktopShutdownGate } = await import('../../electron/shutdown-aware-ipc-main.js');
  const shutdown = new DesktopShutdownCoordinator({ gate: new DesktopShutdownGate(),
    providerRuntime: { beginShutdown: () => ({ leases: [], waitForSettled: async () => true }), hideAndAbortNonProtected() {}, closeOrdinaryProviders: async () => ({ cleanupFailed: [] }) },
    ingressOwners: [owner.ingress], durableStores: [owner.durable], destroyWindows() {}, disposeLifetimeResources: async () => {}, releaseMainSourcePin: async () => {}, continuation() {},
  });
  expect((await shutdown.onBeforeQuit().shutdown).storesClosed).toBe(true);
  expect(wasClosed).toBe(true);
  await expect(f.store.load('thread')).rejects.toThrow();
  await expect(f.coordinator.getGoal('thread')).rejects.toThrow('goal_coordinator_closed');
  await owner.durable.close();
});
