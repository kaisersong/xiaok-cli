// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ContinuityService } from '../../electron/context-continuity/service.js';
import { registerContextContinuityIpc } from '../../electron/context-continuity/ipc.js';
import { resetIpcSchemaRegistryForTests } from '../../electron/ipc-runtime.js';
import { DesktopShutdownGate, ShutdownAwareIpcMain } from '../../electron/shutdown-aware-ipc-main.js';
const user = { requestSource: 'user' as const, profileId: 'p', actorId: 'desktop-user:p' };
let root: string, service: ContinuityService;
let handlers: Map<string, (event: unknown, input?: unknown) => Promise<unknown>>;
beforeEach(() => {
  resetIpcSchemaRegistryForTests(); root = mkdtempSync(join(tmpdir(), 'continuity-ipc-'));
  service = new ContinuityService({ dbPath: join(root, 'store.sqlite'), profileId: 'p' }); handlers = new Map();
  registerContextContinuityIpc({ handle: (channel, fn) => { handlers.set(channel, fn as never); } } as never,
    { service, actor: user }, event => (event as unknown as { trusted?: boolean }).trusted === true);
});
afterEach(() => { service.close(); rmSync(root, { recursive: true, force: true, maxRetries: 3 }); resetIpcSchemaRegistryForTests(); });
const call = (name: string, input?: unknown, event = { trusted: true }) => handlers.get(`desktop:context:${name}`)!(event, input);
describe('context IPC binds authenticated main identity and strict schemas', () => {
  it('searches through real registered semantic IPC and rejects actor widening fields',async()=>{
    const c=service.createConversation(user,{operationId:'search-source',title:'Search'});
    service.recordMessage(user,{conversationId:c.id,sourceKind:'desktop_task',sourceId:'search-task',sourceDataEpoch:'epoch',sourceMessageId:'m',sourceRevision:1,role:'user',text:'IPC_SEARCH_CANARY',executionState:'settled'});
    expect(await call('searchHistory',{query:'IPC_SEARCH_CANARY'})).toMatchObject({mode:'keyword',hits:[{excerpt:'IPC_SEARCH_CANARY'}]});
    await expect(call('searchHistory',{query:'x',profileId:'p'})).rejects.toThrow();
    await expect(call('searchHistory',{query:'x'},{trusted:false})).rejects.toThrow('not_readable');
    expect(await call('setHistorySearchConsent',{conversationId:c.id,enabled:true})).toEqual({enabled:true,revision:1});
    expect(await call('getHistorySearchConsent',{conversationId:c.id})).toEqual({enabled:true,revision:1});
  });
  it('rechecks the actual original search result after the final handler await',async()=>{
    const c=service.createConversation(user,{operationId:'search-source',title:'Search'});
    service.recordMessage(user,{conversationId:c.id,sourceKind:'desktop_task',sourceId:'search-task',sourceDataEpoch:'epoch',sourceMessageId:'m',sourceRevision:1,role:'user',text:'IPC_SEARCH_CANARY',executionState:'settled'});
    const original=service.searchHistory.bind(service);
    vi.spyOn(service,'searchHistory').mockImplementation((actor,input)=>{const result=original(actor,input);queueMicrotask(()=>service.setScopePolicy(id=>id===c.id?'blocked':'readable'));return result;});
    await expect(call('searchHistory',{query:'IPC_SEARCH_CANARY'})).rejects.toThrow('not_readable');
  });
  it('rechecks the original search result at the outer IPC handoff after the inner handler has already finished',async()=>{
    const c=service.createConversation(user,{operationId:'search-handoff-source',title:'Search'});
    service.recordMessage(user,{conversationId:c.id,sourceKind:'desktop_task',sourceId:'search-task',sourceDataEpoch:'epoch',sourceMessageId:'m',sourceRevision:1,role:'user',text:'IPC_HANDOFF_PRIVATE_CANARY',executionState:'settled'});
    const original=service.assertHistorySearchCurrent.bind(service);let calls=0;
    vi.spyOn(service,'assertHistorySearchCurrent').mockImplementation((result,actor)=>{
      original(result,actor);
      // The class checks itself internally. This first public assertion is
      // the inner handler's fence, before registerIpcHandler's outer await.
      if(++calls===1)queueMicrotask(()=>service.setScopePolicy(id=>id===c.id?'blocked':'readable'));
    });
    await expect(call('searchHistory',{query:'IPC_HANDOFF_PRIVATE_CANARY'})).rejects.toThrow('not_readable');
  });
  it('keeps the real shutdown-aware registrar final fence after its additional production await',async()=>{
    const rawHandlers=new Map<string,(event:unknown,input:unknown)=>Promise<unknown>>(),gate=new DesktopShutdownGate();
    const registrar=new ShutdownAwareIpcMain({handle:(channel,listener)=>{rawHandlers.set(channel,listener as never);}},gate);
    registerContextContinuityIpc(registrar,{service,actor:user},event=>(event as unknown as {trusted:boolean}).trusted);
    const c=service.createConversation(user,{operationId:'shutdown-search-source',title:'Search'});
    service.recordMessage(user,{conversationId:c.id,sourceKind:'desktop_task',sourceId:'search-task',sourceDataEpoch:'epoch',sourceMessageId:'m',sourceRevision:1,role:'user',text:'SHUTDOWN_HANDOFF_PRIVATE_CANARY',executionState:'settled'});
    const original=service.assertHistorySearchCurrent.bind(service);let checks=0;
    vi.spyOn(service,'assertHistorySearchCurrent').mockImplementation((result,actor)=>{
      original(result,actor);if(++checks===2)queueMicrotask(()=>service.setScopePolicy(id=>id===c.id?'blocked':'readable'));
    });
    await expect(rawHandlers.get('desktop:context:searchHistory')!({trusted:true},{query:'SHUTDOWN_HANDOFF_PRIVATE_CANARY'})).rejects.toThrow('not_readable');
    expect(gate.outstanding).toBe(0);
  });
  it('does not bypass search revocation through the sibling exact-reference IPC',async()=>{
    const c=service.createConversation(user,{operationId:'exact-source',title:'Exact'});
    service.recordMessage(user,{conversationId:c.id,sourceKind:'desktop_task',sourceId:'exact-task',sourceDataEpoch:'epoch',sourceMessageId:'m',sourceRevision:1,role:'user',text:'EXACT_IPC_PRIVATE_CANARY',executionState:'settled'});
    const ref=service.createReference(user,{conversationId:c.id,expectedRevision:service.getConversation(user,c.id)!.revision,operationId:'exact-ref'});
    const original=service.resolveReference.bind(service);
    vi.spyOn(service,'resolveReference').mockImplementation((actor,input)=>{const page=original(actor,input);queueMicrotask(()=>service.setScopePolicy(id=>id===c.id?'blocked':'readable'));return page;});
    await expect(call('resolveReference',{refId:ref.refId})).rejects.toThrow('not_readable');
  });
  it('does not swallow an unexpected async search finalizer inside the actual semantic channel wrapper',async()=>{
    const rawHandlers=new Map<string,(event:unknown,input:unknown)=>Promise<unknown>>(),gate=new DesktopShutdownGate();
    registerContextContinuityIpc(new ShutdownAwareIpcMain({handle:(channel,listener)=>{rawHandlers.set(channel,listener as never);}},gate),{service,actor:user},()=>true);
    const original=service.assertHistorySearchCurrent.bind(service);let checks=0,release!:()=>void,done=false;
    vi.spyOn(service,'assertHistorySearchCurrent').mockImplementation((result,actor)=>{original(result,actor);if(++checks===1)return new Promise<void>(resolve=>{release=resolve;});});
    const running=rawHandlers.get('desktop:context:searchHistory')!({},{query:'none'}).then(value=>({value}),error=>({error})).finally(()=>{done=true;});
    await vi.waitFor(()=>expect(release).toBeTypeOf('function'));const early=done,held=gate.outstanding;release();const result=await running;
    expect(early).toBe(false);expect(held).toBe(1);expect(result).toMatchObject({error:{message:'ipc_output_fence_invalid'}});expect(gate.outstanding).toBe(0);
  });
  it('rejects untrusted renderer and caller-supplied actor/profile/scope fields', async () => {
    await expect(call('createConversation', { title: 'test', operationId: 'create' }, { trusted: false })).rejects.toThrow('not_readable');
    for (const extra of [{ profileId: 'foreign' }, { actorId: 'forged' }, { requestSource: 'user' }, { scope: { kind: 'room', roomId: 'foreign' } }]) {
      await expect(call('createConversation', { operationId: 'create', ...extra })).rejects.toThrow();
    }
    expect(service.listConversations(user)).toEqual([]);
  });
  it('round-trips a real reference through registered production handlers', async () => {
    const c = await call('createConversation', { title: 'test', operationId: 'create' }) as { id: string };
    service.recordMessage(user, { conversationId: c.id, sourceKind: 'desktop_task', sourceId: 'task-one', sourceDataEpoch: 'epoch', sourceMessageId: 'user', sourceRevision: 1, role: 'user', text: 'original', executionState: 'settled' });
    const current = await call('getConversation', { conversationId: c.id }) as { revision: number };
    const ref = await call('createReference', { conversationId: c.id, expectedRevision: current.revision, operationId: 'ref' }) as { refId: string };
    const page = await call('resolveReference', { refId: ref.refId }) as { messages: Array<{ text: string }> };
    expect(page.messages[0].text).toBe('original');
    await expect(call('resolveReference', { refId: ref.refId, limit: 100000 })).rejects.toThrow();
    await expect(call('resolveReference', { refId: ref.refId, actor: user })).rejects.toThrow();
  });
  it('keeps external credential issuance and listener controls behind the authenticated user IPC boundary',async()=>{
    for(const [channel,input] of [['getMcpStatus',undefined],['setMcpEnabled',{enabled:true}],['issueMcpConfig',{operationId:'issue',targetConversationId:'target',refIds:['a'.repeat(32)]}],['listExternalReaders',undefined],['revokeExternalReader',{credentialId:'credential'}]] as const){
      await expect(call(channel,input,{trusted:false})).rejects.toThrow('not_readable');
    }
    await expect(call('issueMcpConfig',{operationId:'issue',targetConversationId:'target',refIds:['a'.repeat(32)],profileId:'forged'})).rejects.toThrow();
    await expect(call('setMcpEnabled',{enabled:true,port:0,host:'0.0.0.0'})).rejects.toThrow();
    expect(service.listExternalReaders(user)).toEqual([]);
  });
});
