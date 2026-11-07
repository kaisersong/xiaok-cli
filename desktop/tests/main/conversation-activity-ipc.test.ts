import { describe, expect, it, vi } from 'vitest';
import { registerConversationActivityIpc } from '../../electron/conversation-activity-ipc.js';
import { projectActivityAttention } from '../../../src/runtime/conversation-activity/attention-projector.js';

function fixture(authorized = true) {
  const handlers = new Map<string, (event: unknown, input: unknown) => Promise<unknown>>();
  const list = vi.fn(async () => []);
  const service = { assertReadResultCurrent:vi.fn(()=>{}), dismissAttention: vi.fn(async () => undefined), mcpAnswer: vi.fn(async () => {}), unread: vi.fn(() => []), read: vi.fn(), overview: vi.fn(() => vi.fn()), list, subscribe: vi.fn(() => vi.fn()), reporting: vi.fn(async () => 'bad output'), stop: vi.fn(async () => 'bad output'), getWork: vi.fn(async () => 'bad output') };
  const event = { sender: { id: 1, send: vi.fn(), isDestroyed: () => false, once: vi.fn(), removeListener: vi.fn() } };
  const cleanup = registerConversationActivityIpc({ handle: (channel, handler) => { handlers.set(channel, handler as never); } }, service, () => authorized ? { actorId: 'user' } : null);
  return { handlers, service, event, cleanup };
}
describe('activity semantic IPC boundary', () => {
  it('transports the real unified projector result and rejects unknown schemas, actions and cross-work identities',async()=>{
    const f=fixture();const watch={operationId:'op',watchId:'watch',source:'kswarm' as const,logicalSourceId:'hub',sourceDataEpoch:'epoch',workId:'project',origin:{profileId:'profile',workspaceId:'workspace',threadId:'thread',actorId:'user'},status:'active' as const,generation:1,preference:'normal' as const,policyRevision:0,nextReportDueAt:100};
    const projection={watchId:'watch',executionState:'queued' as const,businessOutcome:'unknown' as const,freshness:'fresh' as const,sourceSequence:1,revision:1,lastProgressAt:null,lastHeartbeatAt:null,lastReportAt:null,evidenceRefs:[]};
    const value={watch,projection,presentation:projectActivityAttention(watch,projection)},invoke=()=>f.handlers.get('desktop:activity:work')!(f.event,{watchId:'watch'});
    f.service.getWork.mockResolvedValue(value as never);expect(await invoke()).toEqual(value);
    for(const presentation of [{...value.presentation,schemaVersion:2},{...value.presentation,recommendedAction:'execute_url'},{...value.presentation,workRef:'other'}]){f.service.getWork.mockResolvedValue({...value,presentation} as never);await expect(invoke()).rejects.toThrow();}
    f.service.getWork.mockResolvedValue({watch,projection} as never);expect(await invoke()).toEqual({watch,projection});f.cleanup();
  });
  it('refuses untrusted frames before reading private activity', async () => {
    const f = fixture(false);
    await expect(f.handlers.get('desktop:activity:list')!(f.event, { threadId: 'thread' })).rejects.toThrow('activity_actor_forbidden');
    expect(f.service.list).not.toHaveBeenCalled(); f.cleanup();
  });
  it('rejects actor spoofing, unknown fields, and invalid page sizes before service dispatch', async () => {
    const f = fixture();
    for (const input of [{ threadId: 'thread', actorId: 'evil' }, { threadId: 'thread', limit: 201 }, { threadId: 'thread', afterLocalSeq: -1 }]) {
      await expect(f.handlers.get('desktop:activity:list')!(f.event, input)).rejects.toThrow();
    }
    expect(f.service.list).not.toHaveBeenCalled(); f.cleanup();
  });
  it('requires a trusted native user and exact UI version for attention dismissal', async()=>{
    const f=fixture(),invoke=(input:unknown)=>f.handlers.get('desktop:activity:attention:dismiss')!(f.event,input);
    const input={watchId:'watch',expectedProjectionVersion:7,expectedPresentationIncarnation:'b640b9fa-ff47-4758-aeaf-dfe03d047ca8'};
    for(const invalid of [{...input,actorId:'evil'},{...input,expectedProjectionVersion:-1},{...input,expectedProjectionVersion:Number.MAX_SAFE_INTEGER+1},{...input,expectedPresentationIncarnation:'caller-token'}])await expect(invoke(invalid)).rejects.toThrow();
    expect(f.service.dismissAttention).not.toHaveBeenCalled();
    await expect(invoke(input)).rejects.toThrow();
    expect(f.service.dismissAttention).toHaveBeenCalledWith('watch',{expectedProjectionVersion:7,expectedPresentationIncarnation:input.expectedPresentationIncarnation},{actorId:'user',requestSource:'user'});
    f.cleanup();const denied=fixture(false);await expect(denied.handlers.get('desktop:activity:attention:dismiss')!(denied.event,input)).rejects.toThrow('activity_actor_forbidden');expect(denied.service.dismissAttention).not.toHaveBeenCalled();denied.cleanup();
  });
  it('routes the watch separately from the strict MCP answer envelope', async () => {
    const f = fixture(); const answer = { inputId: 'format', expectedDigest: 'digest', action: 'accept', content: { format: 'pdf' } };
    await f.handlers.get('desktop:activity:mcpAnswer')!(f.event, { watchId: 'watch', ...answer });
    expect(f.service.mcpAnswer).toHaveBeenCalledWith('watch', answer, { actorId: 'user', requestSource: 'user' }); f.cleanup();
  });
  it('validates the returned watch contract instead of admitting an arbitrary result', async () => {
    const f = fixture();
    await expect(f.handlers.get('desktop:activity:stop')!(f.event, { watchId: 'watch', expectedPolicyRevision: 0 })).rejects.toThrow();
    f.cleanup();
  });
  it('keeps subscriptions owned by sender and disposes them without stopping work', async () => {
    const f = fixture();
    await f.handlers.get('desktop:activity:subscribe')!(f.event, { threadId: 'thread', subscriptionId: 'subscription' });
    const stop = f.service.subscribe.mock.results[0].value;
    await f.handlers.get('desktop:activity:unsubscribe')!({ sender: { id: 2 } }, { subscriptionId: 'subscription' });
    expect(stop).not.toHaveBeenCalled();
    f.cleanup(); expect(stop).toHaveBeenCalledTimes(1);
    expect(f.service.stop).not.toHaveBeenCalled();
  });
  it('does not leak a subscription if its view closes while trusted identity is being prepared', async () => {
    const f = fixture();
    let resolve!: (stop: () => void) => void;
    f.service.subscribe.mockImplementation(() => new Promise<() => void>(done => { resolve = done; }) as never);
    const pending = f.handlers.get('desktop:activity:subscribe')!(f.event, { threadId: 'new-thread', subscriptionId: 'pending' });
    await vi.waitFor(() => expect(typeof resolve).toBe('function'));
    f.event.sender.isDestroyed = () => true;
    const stop = vi.fn(); resolve(stop); await pending;
    expect(stop).toHaveBeenCalledOnce(); f.cleanup(); expect(stop).toHaveBeenCalledOnce();
  });
});

function ordinaryProjectView(){
 const watch={operationId:'op',watchId:'watch',source:'kswarm' as const,logicalSourceId:'hub',sourceDataEpoch:'epoch',workId:'project',origin:{profileId:'profile',workspaceId:'workspace',threadId:'thread',actorId:'user'},status:'active' as const,generation:1,preference:'normal' as const,policyRevision:0,nextReportDueAt:100};
 const projection={watchId:'watch',executionState:'queued' as const,businessOutcome:'unknown' as const,freshness:'fresh' as const,sourceSequence:1,revision:1,lastProgressAt:null,lastHeartbeatAt:null,lastReportAt:null,evidenceRefs:[]};return{watch,projection,presentation:projectActivityAttention(watch,projection)};
}
it('checks the original work output after an awaited handler and before typed IPC delivery',async()=>{
 const f=fixture(),view=ordinaryProjectView(),cause=Error('actual_project_output_superseded');let dirty=false;
 f.service.getWork.mockImplementation(async()=>{queueMicrotask(()=>{dirty=true;});return view as never;});f.service.assertReadResultCurrent.mockImplementation(()=>{if(dirty)throw cause;});
 try{await expect(f.handlers.get('desktop:activity:work')!(f.event,{watchId:'watch'})).rejects.toThrow(cause);expect(f.service.assertReadResultCurrent).toHaveBeenCalledWith(view,{actorId:'user',requestSource:'user'});}finally{f.cleanup();}
});
it('rejects a window destroyed during an ordinary project read even without a Native task-read port',async()=>{
 const f=fixture(),view=ordinaryProjectView();f.service.getWork.mockImplementation(async()=>{queueMicrotask(()=>{f.event.sender.isDestroyed=()=>true;});return view as never;});
 try{await expect(f.handlers.get('desktop:activity:work')!(f.event,{watchId:'watch'})).rejects.toThrow();}finally{f.cleanup();}
});
it.each(['false','promise'])('rejects a non-void final ordinary read guard (%s)',async kind=>{
 const f=fixture(),view=ordinaryProjectView();f.service.getWork.mockResolvedValue(view as never);f.service.assertReadResultCurrent.mockImplementation((()=>kind==='false'?false:Promise.resolve()) as never);
 try{await expect(f.handlers.get('desktop:activity:work')!(f.event,{watchId:'watch'})).rejects.toThrow();}finally{f.cleanup();}
});
it('rejects an ordinary project read whose IPC registrar was disposed during the awaited source operation',async()=>{
 const f=fixture(),view=ordinaryProjectView();f.service.getWork.mockImplementation(async()=>{queueMicrotask(f.cleanup);return view as never;});
 try{await expect(f.handlers.get('desktop:activity:work')!(f.event,{watchId:'watch'})).rejects.toThrow();}finally{f.cleanup();}
});
