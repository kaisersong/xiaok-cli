// @vitest-environment node
import { mkdtempSync, rmSync,realpathSync,writeFileSync,existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RoomWorkspaceLocalStore, prepareWorkspaceRoot, workspaceDigest } from '../../electron/room-workspace-local.js';
import {openOwnedWorkflowNormalCase} from '../support/owned-workflow-normal-case.js';
import {sealAndDrainKSwarmServiceInstance} from '../../electron/kswarm-service.js';
import {createRoomExternalDiscussionAdapter} from '../../electron/room-external-discussion-adapter.js';
import { createRoomWorkspaceRuntime } from '../../electron/room-workspace-runtime.js';
const cleanups: Array<() => void|Promise<void>> = [];
afterEach(async () => { for (const fn of cleanups.splice(0).reverse()) await fn(); });
async function originalProjectService(projectId='p'){const owned=await openOwnedWorkflowNormalCase({project:{id:projectId,name:'Original project',goal:'Read state'},workflowName:'room_admission_fixture',phaseTitle:'Read',prompt:'Read state',label:'Original admission'});cleanups.push(()=>owned.close());return owned.kswarmService;}
async function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'room-runtime-')); cleanups.push(() => rmSync(root, { recursive: true, force: true, maxRetries: 5 }));
  const store = new RoomWorkspaceLocalStore(join(root, 'local.sqlite')); cleanups.push(() => store.close());
  const physical = await prepareWorkspaceRoot(root);
  store.prepareBinding({ ...physical, bindingId: 'b', roomId: 'r', workspaceId: 'w', hostId: 'h', generation: 1, requestId: 'q', payloadDigest: workspaceDigest('binding', physical), createdBy: 'user.local' });
  store.activateBinding('b', { workspaceId: 'w', activeBindingId: 'b', generation: 1 });
  const config = { activeBindingId: 'b', workspaceId: 'w', originHostId: 'h', generation: 1, revision: 3, phase: 'active' };
  const calls: string[] = [];
  const request = vi.fn(async (_roomId, action, input) => {
    calls.push(action);
    if (action === 'acquire') return { ok: true, claim: { ...config, ...input, roomId: 'r', workspaceRevision: 3, bindingId: 'b', claimId: 'claim', protocolVersion: 1, hostIncarnation: 1, instructionsRevision: 0, executionState: 'admitted', authorizationState: 'valid' } };
    if (action === 'claim-wake') return { ok: true, claimToken: 'wake' };
    return { ok: true };
  });
  const broker = { get: vi.fn(async () => ({ ok: true, config })), request };
  const wake = { claimWake: vi.fn(), completeWake: vi.fn(async () => { calls.push('completeWake'); return { ok: true }; }) };
  const envelope = { roomId: 'r', roomTitle: 'room', roomRevision: 1, roomMessageId: 'msg', logicalAgentId: 'a', contextScope: { kind: 'room_only' }, attachmentPaths: [], contextWindow: { fromSequence: 1, toSequence: 1, totalMessages: 1, isComplete: true, snapshotAt: '' }, messages: [] };
  return { root, store, calls, broker, wake, envelope };
}
describe('R3 workspace runtime actual admission and physical cleanup ordering', () => {
  it.each(['throw', 'refusal'] as const)('preserves an undefined execution cause when wake cleanup reports %s', async mode => {
    const f = await fixture();
    f.broker.get.mockResolvedValue({ ok: true, config: null } as never);
    f.wake.claimWake.mockResolvedValue({ ok: true, claimToken: 'wake' });
    const cleanupError = new Error('wake cleanup failed');
    const abandonWake = vi.fn(async () => {
      if (mode === 'throw') throw cleanupError;
      return { ok: false, code: 'wake_cleanup_refused' };
    });
    const runtime = createRoomWorkspaceRuntime({ ...f, wake: { ...f.wake, abandonWake }, execute: async () => { throw undefined; }, ensureProtocol: async () => {} });
    let failed = false;
    let cause: unknown;
    try { await runtime.run(f.envelope as never); } catch (error) { failed = true; cause = error; }
    expect(failed).toBe(true);
    expect(cause).toBeInstanceOf(AggregateError);
    expect((cause as AggregateError).errors[0]).toBeUndefined();
    if (mode === 'throw') expect((cause as AggregateError).errors[1]).toBe(cleanupError);
    else expect((cause as AggregateError).errors[1]).toMatchObject({ message: 'wake_cleanup_refused' });
    expect(abandonWake).toHaveBeenCalledOnce();
    await runtime.shutdown();
  });
  it.each(['prepare','project_discussion'] as const)('refuses %s without the original B start reader before an execution journal, wake or claim',async entry=>{
    const f=await fixture(),save=vi.spyOn(f.store,'saveRecord'),execute=vi.fn(async()=>({text:'must not start'})),ensureProtocol=vi.fn(async()=>{}),dispatch=vi.fn(async()=>({ok:true}));
    const runtime=createRoomWorkspaceRuntime({...f,kswarmService:{},execute,ensureProtocol,executeProject:vi.fn(),projectAdapter:{resolve:async()=>({mapping:{workFolder:realpathSync(f.root),artifactsDir:realpathSync(f.root),mappingRevision:1},task:{id:'p__t'}}),dispatch}} as any);
    let failure:unknown;
    try{
      try{if(entry==='prepare')await runtime.prepareProjectTask({roomId:'r',projectId:'p',taskId:'p__t',logicalAgentId:'a',requestId:'unqualified'});else await runtime.run({...f.envelope,contextScope:{kind:'project',projectId:'p'}} as any);}catch(error){failure=error;}
      expect(save).not.toHaveBeenCalled();expect(f.broker.request).not.toHaveBeenCalled();expect(f.wake.claimWake).not.toHaveBeenCalled();expect(dispatch).not.toHaveBeenCalled();expect(execute).not.toHaveBeenCalled();expect(ensureProtocol).not.toHaveBeenCalled();expect(failure).toMatchObject({message:'project_execution_start_reader_unavailable'});
    }finally{await runtime.shutdown();}
  });
  it('recovers only proven exited external groups, isolates missing tokens, and accepts exact already-completed delivery',async()=>{
    const f=await fixture();const child=spawnSync(process.execPath,['-e',''],{detached:true});expect(child.status).toBe(0);
    const common={roomId:'r',sourceMessageId:'msg',logicalAgentId:'a',contextScope:{kind:'room_only'},runtime:'qoder',hostId:'h',hostIncarnation:1,ownerPid:child.pid};
    f.store.saveRecord('external-discussion-operation','unknown',{...common,operationId:'unknown',phase:'claiming'});
    f.store.saveRecord('external-discussion-operation','exited',{...common,operationId:'exited',phase:'running',pid:child.pid,processGroupId:child.pid,processStartIdentity:'actual-old-process',claimToken:'wake-exited'});
    f.store.saveRecord('external-discussion-operation','complete',{...common,operationId:'complete',phase:'released',groupExitVerified:true,claimToken:'wake-complete'});
    const abandonWake=vi.fn(async(input:any)=>({ok:true,wakeStatus:input.claimToken==='wake-complete'?'completed':'failed'}));
    f.broker.request.mockImplementation(async(_room,action,input)=>({ok:true,wake:{roomId:'r',roomMessageId:'msg',logicalAgentId:'a',contextScope:{kind:'room_only'},wakeStatus:input.claimToken==='wake-complete'?'completed':'claimed'}}) as any);
    const runtime=createRoomWorkspaceRuntime({...f,wake:{...f.wake,abandonWake},execute:vi.fn(),ensureProtocol:vi.fn()});
    expect(await (runtime as any).recoverExternalDiscussions()).toEqual({completed:1,abandoned:1,pending:1});
    expect(f.store.getRecord<any>('external-discussion-operation','unknown').recoveryState).toBe('unknown_pending');
    expect(f.store.getRecord<any>('external-discussion-operation','exited').phase).toBe('abandoned');
    expect(f.store.getRecord<any>('external-discussion-operation','complete').phase).toBe('completed');
    expect(abandonWake).toHaveBeenCalledOnce();expect(f.broker.request.mock.calls.every(call=>call[1]==='recover-wake')).toBe(true);
  });
  it('does not treat a prepared supervisor gap or live owner as physical exit during recovery',async()=>{
    const f=await fixture();const child=spawnSync(process.execPath,['-e','']);expect(child.status).toBe(0);
    f.store.saveRecord('external-discussion-operation','prepared',{operationId:'prepared',roomId:'r',ownerPid:child.pid,phase:'prepared',claimToken:'wake'});
    f.store.saveRecord('external-discussion-operation','live',{operationId:'live',roomId:'r',ownerPid:process.pid,phase:'running',pid:process.pid,processGroupId:process.pid,claimToken:'wake'});
    const abandonWake=vi.fn();const runtime=createRoomWorkspaceRuntime({...f,wake:{...f.wake,abandonWake},execute:vi.fn(),ensureProtocol:vi.fn()});
    expect(await (runtime as any).recoverExternalDiscussions()).toEqual({completed:0,abandoned:0,pending:2});
    expect(abandonWake).not.toHaveBeenCalled();
  });
  it('does not adopt a recovery delivery from another scope or source and continues with the next exact item',async()=>{
    const f=await fixture();const common={roomId:'r',sourceMessageId:'msg',logicalAgentId:'a',contextScope:{kind:'room_only'},ownerPid:process.pid,phase:'released',groupExitVerified:true};
    for(const operationId of ['wrong','right'])f.store.saveRecord('external-discussion-operation',operationId,{...common,operationId,claimToken:operationId});
    f.broker.request.mockImplementation(async(_room,_action,input)=>({ok:true,wake:{roomId:'r',roomMessageId:input.claimToken==='wrong'?'other-source':'msg',logicalAgentId:'a',contextScope:{kind:'room_only'},wakeStatus:'completed'}}) as any);
    const abandonWake=vi.fn();const execute=vi.fn();const runtime=createRoomWorkspaceRuntime({...f,wake:{...f.wake,abandonWake},execute,ensureProtocol:vi.fn()});
    expect(await runtime.recoverExternalDiscussions()).toEqual({completed:1,abandoned:0,pending:1});
    expect(f.store.getRecord<any>('external-discussion-operation','wrong')).toMatchObject({phase:'released',recoveryState:'cleanup_pending'});
    expect(abandonWake).not.toHaveBeenCalled();expect(execute).not.toHaveBeenCalled();
  });
  it('keeps cancelled external execution pending until its physical promise settles and never respawns a durable pending operation',async()=>{
    const f=await fixture();let finish!:()=>void;let entered!:()=>void;const started=new Promise<void>(r=>{entered=r;});const gate=new Promise<void>(r=>{finish=r;});let captured:any;
    const abandonWake=vi.fn(async()=>({ok:true}));
    const external=vi.fn(async(input:any)=>{
      captured=input;const prepared={operationId:input.operationId,runtime:'qoder',neutralRoot:'/neutral-owned',ownerPid:process.pid,phase:'prepared'};
      await input.onPrepared(prepared);const running={...prepared,phase:'running',pid:1234,processGroupId:1234,processStartIdentity:'start'};
      await input.onStarted(running);entered();await gate;
      await input.onExited({...running,phase:'released',exitCode:0,groupExitVerified:true});
      return {text:'cancelled result',resourcesReleased:true};
    });
    const config={...f,wake:{...f.wake,abandonWake},execute:vi.fn(),ensureProtocol:vi.fn(),externalDiscussion:{resolve:async()=>({protocol:'room_discussion_v1',logicalAgentId:'a',runtime:'qoder',supported:true,proof:{freshSession:true,toolsDisabled:true,mcpDisabled:true,hooksDisabled:true}}),getHostIdentity:async()=>({hostId:'h',hostIncarnation:1}),execute:external}} as any;
    const runtime=createRoomWorkspaceRuntime(config);const run=runtime.run(f.envelope);const rejected=expect(run).rejects.toThrow();await started;
    expect(runtime.run(f.envelope)).toBe(run);await runtime.cancelRoom('r');
    let shutdownSettled=false;const shutdown=runtime.shutdown().then(()=>{shutdownSettled=true;});await Promise.resolve();
    expect(captured.signal.aborted).toBe(true);expect(shutdownSettled).toBe(false);expect(abandonWake).not.toHaveBeenCalled();expect(f.wake.completeWake).not.toHaveBeenCalled();
    expect(f.store.getRecord<any>('external-discussion-operation',captured.operationId).phase).toBe('running');
    const restarted=createRoomWorkspaceRuntime(config);await expect(restarted.run(f.envelope)).rejects.toThrow('discussion_cleanup_pending');expect(external).toHaveBeenCalledOnce();
    finish();await rejected;await shutdown;
    expect(abandonWake).toHaveBeenCalledExactlyOnceWith({roomId:'r',claimToken:'wake',reason:'execution_failed'});
    expect(f.store.getRecord<any>('external-discussion-operation',captured.operationId)).toMatchObject({phase:'released',groupExitVerified:true});
  });
  it('does not accept external output without matching physical exit evidence',async()=>{
    const f=await fixture();const abandonWake=vi.fn(async()=>({ok:true}));
    const runtime=createRoomWorkspaceRuntime({...f,wake:{...f.wake,abandonWake},execute:vi.fn(),ensureProtocol:vi.fn(),externalDiscussion:{
      resolve:async()=>({protocol:'room_discussion_v1',logicalAgentId:'a',runtime:'qoder',supported:true,proof:{freshSession:true,toolsDisabled:true,mcpDisabled:true,hooksDisabled:true}}),getHostIdentity:async()=>({hostId:'h',hostIncarnation:1}),
      execute:async()=>({text:'self-reported cleanup',resourcesReleased:true}),
    }} as any);
    await expect(runtime.run(f.envelope)).rejects.toThrow('discussion_cleanup_pending');
    expect(f.wake.completeWake).not.toHaveBeenCalled();expect(abandonWake).toHaveBeenCalledOnce();
  });
  it.skipIf(process.platform==='win32')('retains the actual adapter no-spawn fact after prepared journal revocation and recovers its original wake',async()=>{
    const f=await fixture(),manager=await originalProjectService(),marker=join(f.root,'must-not-spawn'),cli=join(f.root,'discussion.cjs');
    writeFileSync(cli,`if(process.argv.includes('--probe'))console.log(JSON.stringify({protocol:'room_discussion_v1',runtime:'xiaok',freshSession:true,toolsDisabled:true,mcpDisabled:true,hooksDisabled:true}));else require('node:fs').writeFileSync(${JSON.stringify(marker)},'bad');`);
    const adapter=createRoomExternalDiscussionAdapter({profiles:{xiaok:{executable:process.execPath,argsPrefix:[cli]}},temporaryRoot:f.root});
    const save=f.store.saveRecord.bind(f.store);let seal:Promise<void>|undefined;
    vi.spyOn(f.store,'saveRecord').mockImplementation((kind,key,value)=>{save(kind,key,value);if(kind==='external-discussion-operation'&&(value as any).phase==='prepared')seal=sealAndDrainKSwarmServiceInstance(manager);});
    const originalRequest=f.broker.request.getMockImplementation()!;
    f.broker.request.mockImplementation(async(room,action,input)=>action==='recover-wake'?{ok:true,wake:{roomId:'r',roomMessageId:'msg',logicalAgentId:'a',contextScope:{kind:'project',projectId:'p'},wakeStatus:'failed'}}:originalRequest(room,action,input));
    const runtime=createRoomWorkspaceRuntime({...f,kswarmService:manager,execute:vi.fn(),ensureProtocol:vi.fn(),wake:{...f.wake,abandonWake:async()=>({ok:true,wakeStatus:'failed'})},externalDiscussion:{resolve:async()=>({protocol:'room_discussion_v1',logicalAgentId:'a',runtime:'xiaok',supported:true,proof:{freshSession:true,toolsDisabled:true,mcpDisabled:true,hooksDisabled:true}}),getHostIdentity:async()=>({hostId:'h',hostIncarnation:1}),execute:adapter.execute}} as any);
    try{
      await expect(runtime.run({...f.envelope,contextScope:{kind:'project',projectId:'p'}} as any)).rejects.toThrow();await seal;
      expect(existsSync(marker)).toBe(false);const journal=f.store.listRecords<any>('external-discussion-operation')[0];
      expect(journal).toMatchObject({phase:'not-spawned',noSpawnVerified:true});expect(journal).not.toHaveProperty('groupExitVerified');
      expect(await runtime.recoverExternalDiscussions()).toEqual({completed:0,abandoned:1,pending:0});
    }finally{await runtime.shutdown();}
  });

  it('routes an external bound Room through discussion only, persists physical owner, and completes no file claim',async()=>{
    const f=await fixture();const execute=vi.fn();let captured:any;
    const external=vi.fn(async(input:any)=>{
      captured=input;
      const prepared={operationId:input.operationId,runtime:'qoder',neutralRoot:'/neutral-owned',ownerPid:process.pid,phase:'prepared'};
      await input.onPrepared(prepared);
      expect(f.store.getRecord<any>('external-discussion-operation',input.operationId)).toMatchObject({phase:'prepared',claimToken:'wake',logicalAgentId:'a'});
      const started={...prepared,phase:'running',pid:1234,processGroupId:1234,processStartIdentity:'os-start-id'};
      await input.onStarted(started);
      await input.onExited({...started,phase:'released',exitCode:0,groupExitVerified:true});
      return {text:'actual external discussion',resourcesReleased:true};
    });
    const externalDiscussion={resolve:async()=>({protocol:'room_discussion_v1',logicalAgentId:'a',runtime:'qoder',supported:true,proof:{freshSession:true,toolsDisabled:true,mcpDisabled:true,hooksDisabled:true}}),getHostIdentity:async()=>({hostId:'h',hostIncarnation:1}),execute:external};
    const runtime=createRoomWorkspaceRuntime({...f,execute,ensureProtocol:vi.fn(),externalDiscussion} as any);
    const envelope={...f.envelope,attachmentPaths:['/secret/file'],messages:[
      {messageId:'one',kind:'text',text:`Discuss ${realpathSync(f.root)}/plan`,contextScope:{kind:'room_only'},sender:{privateToken:'do-not-copy'}},
      {messageId:'two',kind:'text',text:'project-secret',contextScope:{kind:'project',projectId:'p'}},
      {messageId:'three',kind:'artifact',text:'artifact-file-content',contextScope:{kind:'room_only'}},
    ]};
    await expect(runtime.run(envelope as any)).resolves.toEqual({ok:true});
    expect(execute).not.toHaveBeenCalled();expect(f.calls).toEqual(['claim-wake','completeWake']);
    expect(captured.prompt).toContain('[workspace-root]/plan');
    for(const secret of [realpathSync(f.root),'/secret/file','do-not-copy','project-secret','artifact-file-content','wake'])expect(captured.prompt).not.toContain(secret);
    expect(captured).not.toHaveProperty('claimToken');expect(captured).not.toHaveProperty('envelope');
    expect(f.store.getRecord<any>('external-discussion-operation',captured.operationId)).toMatchObject({phase:'completed',groupExitVerified:true});
    await runtime.run(envelope as any);expect(external).toHaveBeenCalledOnce();
  });
  it('rejects an unsupported external runtime before claiming or silently falling back to hosted',async()=>{
    const f=await fixture();const execute=vi.fn(async()=>({text:'wrong hosted identity'}));
    const runtime=createRoomWorkspaceRuntime({...f,execute,ensureProtocol:async()=>{},externalDiscussion:{
      resolve:async()=>({logicalAgentId:'a',runtime:'kiro',supported:false,reason:'discussion_protocol_unavailable'}),execute:vi.fn(),
    }} as any);
    await expect(runtime.run(f.envelope)).rejects.toThrow('discussion_protocol_unavailable');
    expect(execute).not.toHaveBeenCalled();expect(f.broker.request).not.toHaveBeenCalled();
  });
  it.each(['execute','complete'])('abandons only the held wake token when %s fails after real execution settles',async failure=>{
    const f=await fixture();const abandonWake=vi.fn(async()=>({ok:true}));
    if(failure==='complete')f.wake.completeWake.mockResolvedValue({ok:false,code:'reply_denied'} as never);
    const execute=vi.fn(async(_e,_t,workspace)=>{
      await workspace.port.release(workspace.context,{kind:'resources-disposed',executorInstanceId:workspace.context.executorInstanceId,verified:true});
      if(failure==='execute')throw new Error('model_failed');return {text:'done'};
    });
    const runtime=createRoomWorkspaceRuntime({...f,wake:{...f.wake,abandonWake},execute,ensureProtocol:async()=>{}});
    await expect(runtime.run(f.envelope)).rejects.toThrow(failure==='execute'?'model_failed':'reply_denied');
    expect(abandonWake).toHaveBeenCalledExactlyOnceWith({roomId:'r',claimToken:'wake',reason:'execution_failed'});
    expect(execute).toHaveBeenCalledOnce();expect(f.calls).toContain('release');
  });
  it.each(['active','draining'])('allows authorized project discussion without a file mapping when Room is %s',async phase=>{
    const kswarmService=await originalProjectService('unmapped');
    const f=await fixture();const snapshot=await f.broker.get();f.broker.get.mockResolvedValue({...snapshot,config:{...snapshot.config,phase}} as never);
    const execute=vi.fn(async()=>({text:'discussion only'}));
    const resolve=vi.fn(async()=>{throw new Error('workspace_project_mapping_required');});
    const runtime=createRoomWorkspaceRuntime({...f,kswarmService,execute,ensureProtocol:async()=>{},projectAdapter:{resolve} as any});
    expect(await runtime.run({...f.envelope,contextScope:{kind:'project',projectId:'unmapped'}} as any)).toEqual({ok:true});
    expect(resolve).not.toHaveBeenCalled();expect(execute.mock.calls[0][2]).toBeUndefined();
    expect(f.calls).toEqual(['claim-wake','completeWake']);
  });
  it('rejects reuse of a project request id for another task before acquiring a claim',async()=>{
    const kswarmService=await originalProjectService('p');
    const f=await fixture();let finish!:()=>void;const ready=new Promise<void>(resolve=>{finish=resolve;});
    const runtime=createRoomWorkspaceRuntime({...f,kswarmService,ensureProtocol:()=>ready,execute:vi.fn(),executeProject:vi.fn(),projectAdapter:{} as any});
    const input={roomId:'r',projectId:'p',taskId:'p__t',logicalAgentId:'a',requestId:'same'};
    const first=runtime.prepareProjectTask(input);const rejected=expect(first).rejects.toThrow();
    const conflict=runtime.prepareProjectTask({...input,taskId:'p__other'});
    // Do not leave a failing regression hanging on the test gate.
    const conflictCheck=expect(conflict).rejects.toThrow('workspace_idempotency_conflict');
    const stop=runtime.shutdown();finish();await conflictCheck;await stop;await rejected;
  });
  it('shutdown cancels and releases a prepared handoff that never entered a runner',async()=>{
    const kswarmService=await originalProjectService('p');
    const f=await fixture();const executeProject=vi.fn();
    const projectAdapter={resolve:async()=>({mapping:{workFolder:realpathSync(f.root),artifactsDir:realpathSync(f.root),mappingRevision:1},task:{id:'p__t'}}),dispatch:async()=>({ok:true})} as any;
    const runtime=createRoomWorkspaceRuntime({...f,kswarmService,ensureProtocol:async()=>{},execute:vi.fn(),executeProject,projectAdapter});
    await runtime.prepareProjectTask({roomId:'r',projectId:'p',taskId:'p__t',logicalAgentId:'a',requestId:'pending'});
    expect(f.calls).not.toContain('release');await runtime.shutdown();
    expect(f.calls.slice(-2)).toEqual(['cancel','release']);expect(executeProject).not.toHaveBeenCalled();
    expect(f.store.getRecord<any>('project-execution','claim').status).toBe('cancelled');
  });
  it('re-reads a late prepared project handoff and still permits its original cancel/release after the reader is sealed',async()=>{
    const f=await fixture(),kswarmService=await originalProjectService(),executeProject=vi.fn();
    const projectAdapter={resolve:async()=>({mapping:{workFolder:realpathSync(f.root),artifactsDir:realpathSync(f.root),mappingRevision:1},task:{id:'p__t'}}),dispatch:async()=>({ok:true}),authorize:async()=>({})} as any;
    const runtime=createRoomWorkspaceRuntime({...f,kswarmService,ensureProtocol:async()=>{},execute:vi.fn(),executeProject,projectAdapter});
    try{
      await runtime.prepareProjectTask({roomId:'r',projectId:'p',taskId:'p__t',logicalAgentId:'a',requestId:'late'});
      const context=f.store.getRecord<any>('project-execution','claim').context;
      await sealAndDrainKSwarmServiceInstance(kswarmService);
      let failure:unknown;try{await runtime.runProjectTask({handoff:{kind:'kswarm_task_handoff_v1',runId:context.runId,project:{id:'p',name:'Original',goal:'Read state'},task:{id:'p__t',title:'Read state'},workspaceContext:context},targetParticipantId:'a'});}catch(error){failure=error;}
      expect(executeProject).not.toHaveBeenCalled();expect(failure).toBeInstanceOf(Error);
      await runtime.shutdown();expect(f.calls.slice(-2)).toEqual(['cancel','release']);
    }finally{await runtime.shutdown();}
  });
  it('replays a completed project request before attempting an already released claim', async () => {
    const f=await fixture();
    const input={roomId:'r',projectId:'p',taskId:'p__t',logicalAgentId:'a',requestId:'request'};
    const key=workspaceDigest('project-prepare-request',input);
    f.store.saveRecord('project-request',key,{claimId:'finished'});
    f.store.saveRecord('project-execution','finished',{context:{claimId:'finished',runId:'run'},status:'completed'});
    const ensureProtocol=vi.fn(),dispatch=vi.fn();
    const runtime=createRoomWorkspaceRuntime({...f,ensureProtocol,execute:vi.fn(),executeProject:vi.fn(),projectAdapter:{dispatch} as any});
    expect(await runtime.prepareProjectTask(input)).toMatchObject({ok:true,claimId:'finished',runId:'run',reused:true});
    expect(ensureProtocol).not.toHaveBeenCalled();expect(f.broker.request).not.toHaveBeenCalled();expect(dispatch).not.toHaveBeenCalled();
  });
  it('tracks early project admission through shutdown and never acquires after the stop fence', async () => {
    const kswarmService=await originalProjectService('p');
    const f=await fixture();let resume!:()=>void;
    const wait=new Promise<void>(resolve=>{resume=resolve;});
    const runtime=createRoomWorkspaceRuntime({...f,kswarmService,ensureProtocol:()=>wait,execute:vi.fn(),executeProject:vi.fn(),projectAdapter:{} as any});
    const input={roomId:'r',projectId:'p',taskId:'p__t',logicalAgentId:'a',requestId:'request'};
    const run=runtime.prepareProjectTask(input);expect(runtime.prepareProjectTask(input)).toBe(run);
    const rejected=expect(run).rejects.toThrow();let settled=false;
    const stop=runtime.shutdown().then(()=>{settled=true;});await Promise.resolve();expect(settled).toBe(false);
    resume();await stop;await rejected;expect(f.broker.request).not.toHaveBeenCalled();
  });
  it('passes discussion cancellation to the actual executing callback and waits for settlement',async()=>{
    const f=await fixture();f.broker.get.mockResolvedValue({ok:true,config:null} as never);
    f.wake.claimWake.mockResolvedValue({ok:true,claimToken:'discussion'});
    let signal:AbortSignal|undefined,finish!:()=>void;
    const execute=vi.fn(async(_e,_token,_workspace,received)=>{signal=received;await new Promise<void>(resolve=>{finish=resolve;});return {text:'stopped'};});
    const runtime=createRoomWorkspaceRuntime({...f,ensureProtocol:async()=>{},execute});
    const run=runtime.run(f.envelope);await vi.waitFor(()=>expect(execute).toHaveBeenCalledOnce());
    await runtime.cancelRoom('r');expect(signal?.aborted).toBe(true);
    let stopped=false;const stop=runtime.shutdown().then(()=>{stopped=true;});await Promise.resolve();expect(stopped).toBe(false);
    finish();await run;await stop;
  });
  it('single-flights duplicate envelope requests instead of sharing a claim between two executions', async () => {
    const f = await fixture(); let unblock!: () => void; const wait = new Promise<void>(resolve => { unblock = resolve; });
    const execute = vi.fn(async (_envelope, _token, options) => { await wait; await options.port.release(options.context, { kind: 'resources-disposed', executorInstanceId: options.context.executorInstanceId, verified: true }); return { text: 'once' }; });
    const runtime = createRoomWorkspaceRuntime({ ...f, execute, ensureProtocol: async () => {} });
    const first = runtime.run(f.envelope); const second = runtime.run(f.envelope);
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1)); unblock();
    await Promise.all([first, second]); expect(execute).toHaveBeenCalledTimes(1);
  });
  it('shutdown fences an admission still waiting on broker state', async () => {
    const f = await fixture(); let resolveState!: (value: unknown) => void;
    f.broker.get.mockImplementation(() => new Promise(resolve => { resolveState = resolve; }) as never);
    const execute = vi.fn(); const runtime = createRoomWorkspaceRuntime({ ...f, execute, ensureProtocol: async () => {} });
    const run = runtime.run(f.envelope); const rejected = expect(run).rejects.toThrow();
    const stopping = runtime.shutdown(); resolveState({ ok: true, config: null });
    await stopping; await rejected; expect(execute).not.toHaveBeenCalled(); expect(f.wake.claimWake).not.toHaveBeenCalled();
  });
  it('releases acquired but never started resources when local binding resolution fails', async () => {
    const f = await fixture();
    const original = f.broker.request.getMockImplementation()!;
    f.broker.request.mockImplementation(async (...args) => {
      const result = await original(...args);
      if (args[1] === 'acquire') return { ...result, claim: { ...result.claim, bindingId: 'missing-binding' } };
      return result;
    });
    const runtime = createRoomWorkspaceRuntime({ ...f, execute: async () => ({ text: 'not called' }), ensureProtocol: async () => {} });
    await expect(runtime.run(f.envelope)).rejects.toThrow('workspace_binding_unavailable');
    expect(f.calls).toEqual(['acquire', 'release']);
  });
  it('ACKs before execution and completes wake before releasing physical root claim', async () => {
    const f = await fixture();
    const execute = vi.fn(async (_envelope, token, options) => {
      expect(token).toBe('wake'); expect(options.context.effectiveCwd).toContain('room-runtime-');
      expect(f.calls).toEqual(['acquire', 'ack', 'claim-wake']);
      await options.port.release(options.context, { kind: 'resources-disposed', executorInstanceId: options.context.executorInstanceId, verified: true });
      expect(f.calls).not.toContain('release'); return { text: 'done' };
    });
    const runtime = createRoomWorkspaceRuntime({ ...f, execute, ensureProtocol: async () => {} });
    expect((await runtime.run(f.envelope)).ok).toBe(true);
    expect(f.calls.slice(-2)).toEqual(['completeWake', 'release']);
  });
  it('task completion without actual cleanup proof cannot release the claim', async () => {
    const f = await fixture();
    const runtime = createRoomWorkspaceRuntime({ ...f, execute: async () => ({ text: 'done' }), ensureProtocol: async () => {} });
    await expect(runtime.run(f.envelope)).rejects.toThrow('workspace_cleanup_pending');
    expect(f.calls).not.toContain('release');
  });
});
