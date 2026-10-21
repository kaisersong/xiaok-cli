import { describe, expect, it, vi } from 'vitest';

import { createLoopPublicationIpcAuthorizer } from '../../electron/loop-publication-ipc.js';
import { registerSemanticDesktopIpc } from '../../electron/semantic-ipc.js';
import type { AssistantProfileDto, AssistantCandidateDto } from '../../shared/assistant-ipc-contract.js';
function profile(status: AssistantProfileDto['status']): AssistantProfileDto { return {id:'default-personal-assistant',status,locale:'zh',timeZone:'UTC',eveningTime:'22:30',morningTime:'08:30',workdays:[1],quietHours:{start:'22:00',end:'08:00'},dataScopes:['threads'],createdAt:1,updatedAt:1}; }
function candidate(status: AssistantCandidateDto['status']): AssistantCandidateDto { return {id:'candidate-1',runId:'run-1',kind:'memory',status,title:'t',content:'c',scope:'global',confidence:1,evidenceRefs:[],dedupeKey:'d',createdAt:1}; }
function overview() {return {profile:profile('active'),suggestions:[],pendingCandidateCount:0,candidates:[]};}

describe('semantic desktop IPC', () => {
  it('registers only semantic assistant and KSwarm operations and fixes user authority in main', async () => {
    const handlers = new Map<string, (...args: any[]) => unknown>();
    const ipcMain = { handle: vi.fn((channel: string, handler: (...args: any[]) => unknown) => handlers.set(channel, handler)) };
    const assistant = {
      getOverview: vi.fn(overview),
      activate: vi.fn(() => profile('active')),
      pause: vi.fn(() => profile('paused')),
      resume: vi.fn(() => profile('active')),
      acceptCandidate: vi.fn(() => candidate('accepted')),
      rejectCandidate: vi.fn(() => candidate('rejected')),
    };
    const kswarm = {
      planProjectTeam: vi.fn(), applyProjectTeamPlan: vi.fn(), getProjectTeamOperation: vi.fn(),
      createKSwarmProject: vi.fn(), updateKSwarmProjectExecutionMode: vi.fn(), deleteKSwarmProject: vi.fn(), createKSwarmAgent: vi.fn(), updateKSwarmAgent: vi.fn(async () => ({id: 'agent-1', name: 'New'})),
      archiveKSwarmAgent: vi.fn(), startKSwarmAgent: vi.fn(), stopKSwarmAgent: vi.fn(), probeKSwarmAgent: vi.fn(),
    };

    registerSemanticDesktopIpc(ipcMain as never, { assistant, kswarm, authorizeAssistant: () => true });

    await handlers.get('desktop:assistant:acceptCandidate')?.({}, { candidateId: 'candidate-1' });
    await handlers.get('desktop:assistant:rejectCandidate')?.({}, { candidateId: 'candidate-1' });
    await handlers.get('desktop:assistant:activate')?.({});
    await handlers.get('desktop:kswarm:agent:update')?.({}, { agentId: 'agent-1', patch: { name: 'New' } });
    expect(assistant.acceptCandidate).toHaveBeenCalledWith({ candidateId: 'candidate-1', requestSource: 'user', collectionId: undefined });
    expect(assistant.rejectCandidate).toHaveBeenCalledWith({ candidateId: 'candidate-1', requestSource: 'user' });
    expect(assistant.activate).toHaveBeenCalledWith({ requestSource: 'user' });
    expect(kswarm.updateKSwarmAgent).toHaveBeenCalledWith({ id: 'agent-1', changes: { name: 'New' } }, { requestSource: 'user' });
    expect([...handlers.keys()]).not.toContain('desktop:assistant:store');
    expect([...handlers.keys()]).not.toContain('desktop:kswarm:request');
  });
});


describe('assistant fixed Main ingress', () => {
  function fixture() {
    const handlers = new Map<string, (...args: any[]) => unknown>();
    const assistant = Object.fromEntries(['getOverview','activate','pause','resume','acceptCandidate','rejectCandidate'].map(key => [key, vi.fn(() => key==='getOverview'?overview():key==='acceptCandidate'?candidate('accepted'):key==='rejectCandidate'?candidate('rejected'):profile(key==='pause'?'paused':'active'))]));
    const window = {isDestroyed: () => false,webContents:{mainFrame:{url:'app://desktop'}}};
    let current: any = window;
    const authorizeAssistant = createLoopPublicationIpcAuthorizer({getWindow:()=>current,isTrustedUrl:url=>url==='app://desktop'});
    registerSemanticDesktopIpc({handle:(key:string,fn:(...args:any[])=>unknown)=>handlers.set(key,fn)} as never,{assistant:assistant as never,kswarm:{} as never,authorizeAssistant});
    return {handlers,assistant,window,replace(){current={isDestroyed:()=>false,webContents:{mainFrame:{url:'app://desktop'}}};},event:{sender:window.webContents,senderFrame:window.webContents.mainFrame}};
  }
  it('denies old windows, subframes and forged user sources before every assistant call', async () => {
    for(const method of ['getOverview','activate','pause','resume','acceptCandidate','rejectCandidate']) {
      const f=fixture(), call=f.handlers.get(`desktop:assistant:${method}`)!;
      const args=method.endsWith('Candidate')?[{candidateId:'candidate-1'}]:[];
      expect(()=>call({...f.event,senderFrame:{}},...args)).toThrow('assistant_ipc_denied');
      f.replace();expect(()=>call(f.event,...args)).toThrow('assistant_ipc_denied');
      expect(f.assistant[method]).not.toHaveBeenCalled();
    }
    const f=fixture();
    await expect(f.handlers.get('desktop:assistant:acceptCandidate')!(f.event,{candidateId:'candidate-1',requestSource:'agent'})).rejects.toThrow('assistant_ipc_input');
    expect(f.assistant.acceptCandidate).not.toHaveBeenCalled();
  });
  it('enforces exact argument shapes without invoking accessors', async () => {
    const f=fixture(),accept=f.handlers.get('desktop:assistant:acceptCandidate')!;
    const read=vi.fn(()=> 'candidate-1');
    for(const input of [{candidateId:'candidate-1',extra:true},{get candidateId(){return read();}},[],null]) {
      await expect(accept(f.event,input)).rejects.toThrow();
    }
    expect(()=>accept(f.event,{candidateId:'candidate-1'},{})).toThrow('assistant_ipc_input');
    expect(()=>f.handlers.get('desktop:assistant:pause')!(f.event,{requestSource:'user'})).toThrow('assistant_ipc_input');
    expect(read).not.toHaveBeenCalled();expect(f.assistant.acceptCandidate).not.toHaveBeenCalled();
    await accept(f.event,{candidateId:'candidate-1',collectionId:'collection-1'});
    expect(f.assistant.acceptCandidate).toHaveBeenCalledWith({candidateId:'candidate-1',collectionId:'collection-1',requestSource:'user'});
  });
  it('denies when no actual Main authorizer was installed', () => {
    const handlers=new Map<string, (...args:any[])=>unknown>(),getOverview=vi.fn();
    registerSemanticDesktopIpc({handle:(key:string,fn:(...args:any[])=>unknown)=>handlers.set(key,fn)} as never,{assistant:{getOverview} as never,kswarm:{} as never});
    expect(()=>handlers.get('desktop:assistant:getOverview')!({})).toThrow('assistant_ipc_denied');
    expect(getOverview).not.toHaveBeenCalled();
  });
});

it('room deletion defaults to deny and supplies authority only for the trusted sender', async () => {
  const handlers = new Map<string, (...args: any[]) => unknown>();
  const deleteRoom = vi.fn(() => ({ok: true, roomId: 'room-1', deletedAt: '2026-10-10T00:00:00Z'}));
  const options = {assistant: {} as never, kswarm: {} as never, collaborationRooms: {deleteRoom} as never};
  const ipc = {handle: (channel: string, fn: (...args: any[]) => unknown) => handlers.set(channel, fn)} as never;
  registerSemanticDesktopIpc(ipc, options);
  const input = {roomId: 'room-1', expectedRoomRevision: 1};
  expect(await handlers.get('desktop:collaborationRoom:deleteRoom')!({}, input)).toMatchObject({ok: false});
  expect(deleteRoom).not.toHaveBeenCalled();
  const event = {};
  const trustedHandlers = new Map<string, (...args: any[]) => unknown>();
  const trustedIpc = {handle: (channel: string, fn: (...args: any[]) => unknown) => trustedHandlers.set(channel, fn)} as never;
  registerSemanticDesktopIpc(trustedIpc, {...options, authorizeRoomDeletion: caller => caller === event});
  expect(await trustedHandlers.get('desktop:collaborationRoom:deleteRoom')!({}, input)).toMatchObject({ok: false});
  expect(await trustedHandlers.get('desktop:collaborationRoom:deleteRoom')!(event, input)).toMatchObject({ok: true});
  expect(deleteRoom).toHaveBeenCalledWith(input, {requestSource: 'user'});
});

it('keeps the first deletion authorizer after same-registrar rebinding and rejects forged wire source', async () => {
  const handlers = new Map<string, (...args: any[]) => unknown>();
  const deleteRoom = vi.fn(() => ({ok: true, roomId: 'room-1', deletedAt: '2026-10-10T00:00:00Z'}));
  const options = {assistant: {} as never, kswarm: {} as never, collaborationRooms: {deleteRoom} as never};
  const ipc = {handle: (channel: string, fn: (...args: any[]) => unknown) => handlers.set(channel, fn)} as never;
  registerSemanticDesktopIpc(ipc, options);
  const before = handlers.get('desktop:collaborationRoom:deleteRoom');
  expect(() => registerSemanticDesktopIpc(ipc, {...options, authorizeRoomDeletion: () => true})).toThrow('room_semantic_ipc_registrar_owner_conflict');
  expect(handlers.get('desktop:collaborationRoom:deleteRoom')).toBe(before);
  expect(await before!({}, new Proxy({}, {ownKeys(){throw Error('must-not-read');}}))).toEqual({ok:false,code:'room_actor_forbidden'});
  expect(deleteRoom).not.toHaveBeenCalled();
  const trustedHandlers = new Map<string, (...args: any[]) => unknown>();
  registerSemanticDesktopIpc({handle: (channel: string, fn: (...args: any[]) => unknown) => trustedHandlers.set(channel, fn)} as never,
    {...options, authorizeRoomDeletion: () => true});
  expect(await trustedHandlers.get('desktop:collaborationRoom:deleteRoom')!({}, {roomId:'room-1',expectedRoomRevision:1,requestSource:'user'}))
    .toEqual({ok:false,code:'room_input_invalid'});
  expect(deleteRoom).not.toHaveBeenCalled();
});
