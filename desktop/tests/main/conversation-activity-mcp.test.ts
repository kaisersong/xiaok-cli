// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConversationActivityStore } from '../../../src/runtime/conversation-activity/store.js';
import { ConversationActivityService } from '../../../src/runtime/conversation-activity/service.js';
import { ConversationMcpActivities } from '../../../src/runtime/conversation-activity/mcp.js';
import type { McpClientConnection } from '../../../src/platform/mcp/transport.js';
import {DesktopMultiAgentStore} from '../../electron/desktop-multi-agent-store.js';
import {ActivityNativeIdentityRepository} from '../../../src/runtime/conversation-activity/native-identity.js';
import type {ActivityThreadIdentity} from '../../../src/runtime/conversation-activity/service.js';

describe('MCP durable conversation origin and recovery', () => {
  const cleanup: Array<() => void> = [];
  afterEach(() => { for (const stop of cleanup.splice(0).reverse()) stop(); });
  function fixture(getThread?:(threadId:string)=>ActivityThreadIdentity|null) {
    const root = mkdtempSync(join(tmpdir(), 'xiaok-mcp-activity-')); cleanup.push(() => rmSync(root, { recursive: true, force: true }));
    const store = new ConversationActivityStore(join(root, 'activity.sqlite')); cleanup.push(() => store.close());
    const threadIdentity={profileId:'profile',workspaceId:'workspace',deleteState:'none' as 'none'|'delete_pending'|'deleted'};
    let mcp!: ConversationMcpActivities;
    const service = new ConversationActivityService({ store, profileId: 'profile', actorId: 'user',
      getThread: getThread??(threadId => ({ threadId, ...threadIdentity })), canObserveWork: watch => mcp.canObserve(watch) });
    cleanup.push(() => service.dispose());
    const onError=vi.fn();
    mcp = new ConversationMcpActivities({ store, service, actorId: 'user', originThread: async taskId => taskId === 'authorized-task' ? 'origin' : null,onError });
    cleanup.push(() => mcp.dispose());
    const raw = { taskId: 'remote-task', status: 'completed', createdAt: '2026-10-09T00:00:00Z', lastUpdatedAt: '2026-10-09T00:00:01Z', ttlMs: 1000,
      result: { resultType: 'complete', content: [], isError: true } };
    const update = vi.fn(async () => {}), cancel = vi.fn(async () => {});
    const connection = { client: {}, tasks: { endpointId: 'server-one', capabilities: { execution: true }, cancelTask: cancel, task: () => ({ updateJson: update, snapshot: async () => ({ ...raw, raw, retentionMs: 1000, ttl: 1000, extensions: {} }) }) } } as unknown as McpClientConnection;
    mcp.register(connection);
    return { store, service, mcp, connection, raw, update, cancel,threadIdentity,onError };
  }
  const reference = { endpointId: 'server-one', generation: 'v2' as const, taskId: 'remote-task', originalOperation: 'tools/call' as const };
  const actor = { requestSource: 'user' as const, actorId: 'user' };
  const request = () => ({ method: 'elicitation/create', params: { message: 'Question', requestedSchema: {
    type: 'object', properties: { answer: { type: 'string' } }, required: ['answer'],
  } } });
  for (const boundary of ['questions', 'fields', 'options', 'method', 'field-type', 'hidden-structure'] as const) it(`refuses an incomplete or unrepresentable ${boundary} collection instead of returning a truncated form`, async () => {
    const f = fixture(), observer = (await f.mcp.observer('authorized-task', 'invocation', f.connection))!;
    await observer.handle(reference);
    const questions: Record<string, unknown> = { question: request() };
    if (boundary === 'questions') for (let index=1; index<=32; index++) questions['question'+index]=request();
    if (boundary === 'fields') questions.question={...request(),params:{requestedSchema:{type:'object',properties:Object.fromEntries(Array.from({length:33},(_,i)=>['field'+i,{type:'string'}]))}}};
    if (boundary === 'options') questions.question={...request(),params:{requestedSchema:{type:'object',properties:{answer:{type:'string',enum:['supported',42]}}}}};
    if (boundary === 'method') questions.question={...request(),method:'unknown/question'};
    if (boundary === 'field-type') questions.question={...request(),params:{requestedSchema:{type:'object',properties:{answer:{type:'object'}}}}};
    if (boundary === 'hidden-structure') questions.question={...request(),params:{requestedSchema:{...request().params.requestedSchema,allOf:[{required:['hidden']}]}}};
    Object.assign(f.raw,{status:'input_required',inputRequests:questions});
    await expect(f.mcp.inputs('mcp:invocation',actor)).rejects.toThrow('activity_mcp_input_unavailable');
    expect(f.update).not.toHaveBeenCalled();expect(f.cancel).not.toHaveBeenCalled();
  });
  it('rejects an input snapshot returned by a connection replaced during its await',async()=>{
    const f=fixture(),observer=(await f.mcp.observer('authorized-task','invocation',f.connection))!;await observer.handle(reference);
    Object.assign(f.raw,{status:'input_required',inputRequests:{question:request()}});
    const original=f.connection.tasks!.task.bind(f.connection.tasks!);let armed=true;
    f.connection.tasks!.task=((...args: Parameters<typeof original>)=>{const task=original(...args);return {...task,snapshot:async()=>{const result=await task.snapshot();if(armed){armed=false;f.mcp.register({...f.connection,client:{},tasks:f.connection.tasks} as McpClientConnection);}return result;}};}) as typeof original;
    await expect(f.mcp.inputs('mcp:invocation',actor)).rejects.toThrow('activity_mcp_connection_superseded');
    expect(f.update).not.toHaveBeenCalled();
  });
  it('rejects a replaced connection during the final answer snapshot before sending any update',async()=>{
    const f=fixture(),observer=(await f.mcp.observer('authorized-task','invocation',f.connection))!;await observer.handle(reference);
    Object.assign(f.raw,{status:'input_required',inputRequests:{question:request()}});
    const [form]=await f.mcp.inputs('mcp:invocation',actor),original=f.connection.tasks!.task.bind(f.connection.tasks!);let snapshots=0;
    f.connection.tasks!.task=((...args:Parameters<typeof original>)=>{const task=original(...args);return {...task,snapshot:async()=>{const result=await task.snapshot();if(++snapshots===2)f.mcp.register({...f.connection,client:{},tasks:f.connection.tasks} as McpClientConnection);return result;}};}) as typeof original;
    await expect(f.mcp.answerInput('mcp:invocation',{inputId:'question',expectedDigest:form.expectedDigest,action:'accept',content:{answer:'explicit'}},actor)).rejects.toThrow('activity_mcp_connection_superseded');
    expect(f.update).not.toHaveBeenCalled();
  });
  it('rechecks a connection changed while authorizing cancellation before issuing the remote cancel',async()=>{
    const f=fixture(),observer=(await f.mcp.observer('authorized-task','invocation',f.connection))!;await observer.handle(reference);
    let authorizations=0;vi.spyOn(f.service,'canReadSource').mockImplementation(async()=>{if(++authorizations===2)f.mcp.register({...f.connection,client:{},tasks:f.connection.tasks} as McpClientConnection);return true;});
    await expect(f.mcp.cancel('mcp:invocation',actor)).rejects.toThrow('activity_mcp_connection_superseded');expect(f.cancel).not.toHaveBeenCalled();
  });
  it('checks again in the cancel caller frame after the authorization Promise resolves',async()=>{
    const f=fixture(),observer=(await f.mcp.observer('authorized-task','invocation',f.connection))!;await observer.handle(reference);
    let checks=0;vi.spyOn(f.service,'canReadSource').mockImplementation(()=>{if(++checks===2)queueMicrotask(()=>queueMicrotask(()=>f.mcp.register({...f.connection,client:{},tasks:f.connection.tasks} as McpClientConnection)));return Promise.resolve(true);});
    await expect(f.mcp.cancel('mcp:invocation',actor)).rejects.toThrow('activity_mcp_connection_superseded');expect(f.cancel).not.toHaveBeenCalled();
  });
  for(const change of ['delete','workspace'] as const)it(`checks the original native thread ${change} fence immediately before a remote cancel`,async()=>{
    const f=fixture(),observer=(await f.mcp.observer('authorized-task','invocation',f.connection))!;await observer.handle(reference);
    let checks=0;vi.spyOn(f.service,'canReadSource').mockImplementation(()=>{if(++checks===2)queueMicrotask(()=>queueMicrotask(()=>{if(change==='delete')f.threadIdentity.deleteState='delete_pending';else f.threadIdentity.workspaceId='other';}));return Promise.resolve(true);});
    await expect(f.mcp.cancel('mcp:invocation',actor)).rejects.toThrow(/activity_thread_/);expect(f.cancel).not.toHaveBeenCalled();
  });
  it('reads the actual native groups.sqlite deletion fence before the activity tombstone is delivered',async()=>{
    const root=mkdtempSync(join(tmpdir(),'mcp-native-thread-'));cleanup.push(()=>rmSync(root,{recursive:true,force:true}));
    const file=join(root,'groups.sqlite'),native=new DesktopMultiAgentStore(file);cleanup.push(()=>native.close());native.registerThread({threadId:'origin',profileId:'profile',workspaceId:'workspace',cwd:root});
    const identity=new ActivityNativeIdentityRepository({kind:'desktop',profileId:'profile',path:file});cleanup.push(()=>identity.close());
    const f=fixture(threadId=>identity.getThread(threadId)),observer=(await f.mcp.observer('authorized-task','invocation',f.connection))!;await observer.handle(reference);
    let checks=0;vi.spyOn(f.service,'canReadSource').mockImplementation(()=>{if(++checks===2)queueMicrotask(()=>queueMicrotask(()=>native.beginThreadDeletion('origin',{
      operationId:'native-delete',actorId:'user',bootId:native.bootId,expectedRevision:native.getThread('origin')!.threadRevision!,requestHash:'delete',startedAt:1,result:{operationId:'native-delete',state:'cleanup_pending'},
    })));return Promise.resolve(true);});
    await expect(f.mcp.cancel('mcp:invocation',actor)).rejects.toThrow('activity_thread_deleted');expect(f.cancel).not.toHaveBeenCalled();expect(f.store.getWatch('mcp:invocation')?.status).toBe('active');
  });
  for(const effect of ['cancel','answer'] as const)for(const failure of ['snapshot','source-write'] as const)it(`keeps the acknowledged ${effect} receipt when its later ${failure} observation fails`,async()=>{
    const f=fixture(),observer=(await f.mcp.observer('authorized-task','invocation',f.connection))!;await observer.handle(reference);
    Object.assign(f.raw,{status:'input_required',inputRequests:{question:request()}});
    const [form]=await f.mcp.inputs('mcp:invocation',actor),fault=Error('post-effect observation failed'),original=f.connection.tasks!.task.bind(f.connection.tasks!);let sent=false;
    const remote=effect==='cancel'?f.cancel:f.update;remote.mockImplementation(async()=>{sent=true;});
    if(failure==='snapshot')f.connection.tasks!.task=((...args:Parameters<typeof original>)=>{const task=original(...args);return {...task,snapshot:async()=>{if(sent)throw fault;return task.snapshot();}};}) as typeof original;
    else vi.spyOn(f.service,'acceptEvent').mockImplementation(async()=>{throw fault;});
    if(effect==='cancel')await expect(f.mcp.cancel('mcp:invocation',actor)).resolves.toEqual({requested:true});
    else await expect(f.mcp.answerInput('mcp:invocation',{inputId:'question',expectedDigest:form.expectedDigest,action:'accept',content:{answer:'explicit'}},actor)).resolves.toBeUndefined();
    expect(remote).toHaveBeenCalledOnce();expect(f.onError).toHaveBeenCalledWith(fault);
  });
  it('preserves a remote cancel rejection unchanged and does not retry or pretend it was acknowledged',async()=>{
    const f=fixture(),observer=(await f.mcp.observer('authorized-task','invocation',f.connection))!;await observer.handle(reference);
    const fault=Error('remote request outcome unknown');f.cancel.mockRejectedValueOnce(fault);
    await expect(f.mcp.cancel('mcp:invocation',actor)).rejects.toBe(fault);expect(f.cancel).toHaveBeenCalledOnce();expect(f.onError).not.toHaveBeenCalled();
  });
  it('keeps the cancel request receipt when native deletion occurs after the remote acknowledgement',async()=>{
    const f=fixture(),observer=(await f.mcp.observer('authorized-task','invocation',f.connection))!;await observer.handle(reference);
    f.cancel.mockImplementation(async()=>{f.threadIdentity.deleteState='delete_pending';});
    await expect(f.mcp.cancel('mcp:invocation',actor)).resolves.toEqual({requested:true});expect(f.cancel).toHaveBeenCalledOnce();expect(f.onError).toHaveBeenCalledWith(expect.objectContaining({message:'activity_thread_deleted'}));
  });
  it('keeps the acknowledged receipt while close waits for the actual failing post-effect observation tail',async()=>{
    const f=fixture(),observer=(await f.mcp.observer('authorized-task','invocation',f.connection))!;await observer.handle(reference);
    let reject!:(error:Error)=>void,entered=false;const fault=Error('held post-effect source failure'),held=new Promise<never>((_,fail)=>{reject=fail;});
    vi.spyOn(f.service,'acceptEvent').mockImplementation(()=>{entered=true;return held;});
    const receipt=f.mcp.cancel('mcp:invocation',actor);await vi.waitFor(()=>expect(entered).toBe(true));expect(f.cancel).toHaveBeenCalledOnce();
    const closing=f.mcp.close();let settled=false;void closing.then(()=>{settled=true;},()=>{settled=true;});await Promise.resolve();await Promise.resolve();expect(settled).toBe(false);
    reject(fault);await expect(receipt).resolves.toEqual({requested:true});await expect(closing).rejects.toMatchObject({errors:expect.arrayContaining([fault])});expect(f.onError).toHaveBeenCalledWith(fault);
  });
  it('persists the handle with the original conversation and deduplicates notification/query outcomes without equating isError with success', async () => {
    const f = fixture();
    expect(await f.mcp.observer('foreign-task', 'other', f.connection)).toBeUndefined();
    const observer = (await f.mcp.observer('authorized-task', 'invocation', f.connection))!;
    await observer.handle(reference);
    for (let i = 0; i < 10; i++) await observer.event(reference, { type: 'task', task: {} as never });
    expect(f.store.getMcpReference('mcp:invocation')).toEqual(reference);
    expect(f.store.getWatch('mcp:invocation')?.origin.threadId).toBe('origin');
    expect(f.store.getProjection('mcp:invocation')).toMatchObject({ executionState: 'completed', businessOutcome: 'error' });
    expect(f.store.getDiagnostics().sourceEvents).toBe(1);
  });
  it('rolls back binding when a reference belongs to a different endpoint', async () => {
    const f = fixture();
    await f.service.prepareAssociation({ threadId: 'origin', operationId: 'operation', creationIdempotencyKey: 'operation' }, { requestSource: 'user', actorId: 'user' });
    await expect(f.service.bindWork({ operationId: 'operation', watchId: 'watch', source: 'mcp', logicalSourceId: 'server-one', sourceDataEpoch: 'epoch', workId: 'remote-task' }, { ...reference, endpointId: 'server-two' })).rejects.toThrow('invalid_activity_mcp_reference');
    expect(f.store.getWatch('watch')).toBeNull();
  });
  it('fences a late old connection response and refuses a stopped watch', async () => {
    const f = fixture(), observer = (await f.mcp.observer('authorized-task', 'invocation', f.connection))!;
    await observer.handle(reference);
    await f.service.stopWatch('mcp:invocation', 0, { requestSource: 'user', actorId: 'user' });
    await observer.event(reference, { type: 'task', task: {} as never });
    expect(f.store.getDiagnostics().sourceEvents).toBe(0);
    expect(f.store.getProjection('mcp:invocation')?.executionState).toBe('accepted');
  });
  it('requires the current actor and exact pending-input fingerprint before responding', async () => {
    const f = fixture(), observer = (await f.mcp.observer('authorized-task', 'invocation', f.connection))!;
    await observer.handle(reference);
    Object.assign(f.raw, { status: 'input_required', inputRequests: { question: { method: 'elicitation/create', params: { message: '选择格式', mode: 'form', requestedSchema: {
      type: 'object', properties: { format: { type: 'string', enum: ['html', 'pdf'] } }, required: ['format'],
    } } } } });
    const actor = { requestSource: 'user' as const, actorId: 'user' };
    const [form] = await f.mcp.inputs('mcp:invocation', actor);
    expect(form.fields[0]).toMatchObject({ key: 'format', type: 'choice', options: ['html', 'pdf'] });
    await expect(f.mcp.answerInput('mcp:invocation', { inputId: 'question', expectedDigest: 'stale', action: 'accept', content: { format: 'html' } }, actor)).rejects.toThrow('activity_mcp_input_stale');
    await expect(f.mcp.answerInput('mcp:invocation', { inputId: 'question', expectedDigest: form.expectedDigest, action: 'accept', content: { format: 'exe' } }, actor)).rejects.toThrow('activity_mcp_input_invalid');
    await expect(f.mcp.answerInput('mcp:invocation', { inputId: 'question', expectedDigest: form.expectedDigest, action: 'accept', content: { format: 'html' } }, { requestSource: 'agent', actorId: 'user' })).rejects.toThrow('activity_actor_forbidden');
    expect(f.update).not.toHaveBeenCalled();
    await f.mcp.answerInput('mcp:invocation', { inputId: 'question', expectedDigest: form.expectedDigest, action: 'accept', content: { format: 'html' } }, actor);
    expect(f.update).toHaveBeenCalledWith({ question: { action: 'accept', content: { format: 'html' } } });
  });
  it('returns a cancel request receipt while source status is still working', async () => {
    const f = fixture(), observer = (await f.mcp.observer('authorized-task', 'invocation', f.connection))!;
    await observer.handle(reference); Object.assign(f.raw, { status: 'working', result: undefined });
    await expect(f.mcp.cancel('mcp:invocation', { requestSource: 'user', actorId: 'user' })).resolves.toEqual({ requested: true });
    expect(f.store.getProjection('mcp:invocation')?.executionState).toBe('running');
    expect(f.cancel).toHaveBeenCalledOnce();
  });
});
