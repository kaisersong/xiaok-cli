// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createRoomProjectScopeGuard } from '../../electron/room-project-scope-guard.js';

type Result = Record<string, any>;
function setup(mode?: 'legacy' | 'projection') {
  let scope: unknown = { kind:'project', projectId:'p' };
  let membership = true;
  const client = {
    getRoomSnapshot: vi.fn(async () => ({ ok:true, room:{roomId:'r'}, messages:[{roomId:'r',messageId:'m',contextScope:scope}] })),
    claimWake: vi.fn(async () => ({ok:true,kind:'old-claim'})),
    listRoomMessagesPage: vi.fn(async () => ({ok:true,kind:'page'})),
    completeWake: vi.fn(async () => ({ok:true,kind:'complete'})),
  };
  const workspace = { request: vi.fn(async () => ({ok:true,kind:'claim'})) };
  const read = vi.fn(async (_roomId:string, _messageId:string, _signal:AbortSignal):Promise<Result> => ({ok:true,schema:'room-authorization-context/v1',room:{roomId:'r'},source:{messageId:'m',roomId:'r',contextScope:scope}}));
  const kswarm = vi.fn(async () => ({ ok:true, json:async () => membership ? {ok:true,project:{id:'p',primaryRoomId:'r',status:'active'}} : {ok:false,error:'room_project_access_denied'} }));
  const options = {roomClient:client,workspaceBroker:workspace,kswarmRequest:kswarm,authorizationReadMode:mode,authorizationContextReader:read};
  // Extra options are intentional test-first contract inputs; production defaults must stay legacy.
  const guard = createRoomProjectScopeGuard(options);
  const call = (entry:string) => entry === 'claim'
    ? guard.roomClient.claimWake({roomId:'r',roomMessageId:'m',logicalAgentId:'a'})
    : entry === 'workspace-claim'
      ? guard.workspaceBroker.request('r','claim-wake',{roomMessageId:'m',logicalAgentId:'a'})
      : entry === 'page'
        ? guard.roomClient.listRoomMessagesPage({roomId:'r',claimToken:'m|a|1|expiry'})
        : guard.roomClient.completeWake({roomId:'r',claimToken:'m|a|1|expiry'});
  return {client,workspace,read,kswarm,guard,call,setScope:(value:unknown)=>{scope=value;},revoke:()=>{membership=false;}};
}

it('ordinary/default legacy guard never probes a projection reader', async () => {
  const f=setup();
  expect((await f.call('claim')).ok).toBe(true);
  expect(f.read).not.toHaveBeenCalled();
  expect(f.client.getRoomSnapshot).toHaveBeenCalledTimes(1);
});

describe.each(['claim','workspace-claim','page','complete'])('projection sibling entry %s', entry => {
  it('reads only the requested source and checks KSwarm freshly on every operation', async () => {
    const f=setup('projection');
    expect((await f.call(entry)).ok).toBe(true);
    expect(f.read).toHaveBeenCalledWith('r','m',expect.any(AbortSignal));
    expect(f.client.getRoomSnapshot).not.toHaveBeenCalled();
    expect(f.kswarm).toHaveBeenCalledTimes(1);
    expect(f.kswarm).toHaveBeenCalledWith('/projects/p/workspace-mapping?logicalAgentId=a',expect.objectContaining({signal:expect.any(AbortSignal)}));
    f.revoke();
    expect(await f.call(entry)).toMatchObject({ok:false,code:'room_project_access_denied'});
    expect(f.read).toHaveBeenCalledTimes(2);
    expect(f.kswarm).toHaveBeenCalledTimes(2);
    expect(f.workspace.request.mock.calls.length+f.client.listRoomMessagesPage.mock.calls.length+f.client.completeWake.mock.calls.length).toBe(1);
  });

  it.each([false,0,[],'project',{kind:'project',projectId:''},{kind:'future'}].map(scope=>({scope})))('keeps original invalid-scope refusal $scope', async ({scope}) => {
    const old=setup('legacy'),next=setup('projection');old.setScope(scope);next.setScope(scope);
    expect(await next.call(entry)).toEqual(await old.call(entry));
    expect(next.kswarm).not.toHaveBeenCalled();
    expect(next.read).toHaveBeenCalledTimes(1);
    expect(next.workspace.request).not.toHaveBeenCalled();
    expect(next.client.listRoomMessagesPage).not.toHaveBeenCalled();
    expect(next.client.completeWake).not.toHaveBeenCalled();
  });

  it('room_only still bypasses KSwarm without caching authorization', async () => {
    const f=setup('projection');f.setScope({kind:'room_only'});
    expect((await f.call(entry)).ok).toBe(true);
    f.read.mockResolvedValue({ok:false,code:'broker_unavailable'});
    expect(await f.call(entry)).toMatchObject({ok:false,code:'broker_unavailable'});
    expect(f.read).toHaveBeenCalledTimes(2);
    expect(f.kswarm).not.toHaveBeenCalled();
  });

  it('deadline aborts the read and cannot admit a late result', async () => {
    const f=setup('projection');vi.useFakeTimers();
    let resolve!:(value:Result)=>void;
    f.read.mockImplementation(()=>new Promise(done=>{resolve=done;}));
    try {
      const pending=f.call(entry);await vi.advanceTimersByTimeAsync(15000);
      expect(await pending).toEqual({ok:false,code:'room_project_authorization_timeout'});
      expect(f.read.mock.calls[0][2].aborted).toBe(true);
      resolve({ok:true,schema:'room-authorization-context/v1',room:{roomId:'r'},source:{messageId:'m',roomId:'r',contextScope:{kind:'room_only'}}});
      await vi.advanceTimersByTimeAsync(0);
      expect(f.workspace.request).not.toHaveBeenCalled();expect(f.client.completeWake).not.toHaveBeenCalled();expect(f.client.listRoomMessagesPage).not.toHaveBeenCalled();
    } finally {vi.useRealTimers();}
  });
});

it.each([
  {ok:true,schema:'future/v2',room:{roomId:'r'},source:{roomId:'r',messageId:'m',contextScope:{kind:'room_only'}}},
  {ok:true,schema:'room-authorization-context/v1',room:{roomId:'wrong'},source:{roomId:'r',messageId:'m',contextScope:{kind:'room_only'}}},
  {ok:true,schema:'room-authorization-context/v1',room:{roomId:'r'},source:{roomId:'foreign',messageId:'m',contextScope:{kind:'room_only'}}},
])('untrusted projection identity/schema cannot invoke: %j', async value => {
  const f=setup('projection');f.read.mockResolvedValue(value);
  expect(await f.call('claim')).toMatchObject({ok:false,code:'broker_unavailable'});
  expect(f.workspace.request).not.toHaveBeenCalled();expect(f.client.getRoomSnapshot).not.toHaveBeenCalled();
});
