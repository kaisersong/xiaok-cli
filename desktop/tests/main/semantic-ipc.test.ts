import { describe, expect, it, vi } from 'vitest';

import { createLoopPublicationIpcAuthorizer } from '../../electron/loop-publication-ipc.js';
import { registerSemanticDesktopIpc } from '../../electron/semantic-ipc.js';

describe('semantic desktop IPC', () => {
  it('registers only semantic assistant and KSwarm operations and fixes user authority in main', async () => {
    const handlers = new Map<string, (...args: any[]) => unknown>();
    const ipcMain = { handle: vi.fn((channel: string, handler: (...args: any[]) => unknown) => handlers.set(channel, handler)) };
    const assistant = {
      getOverview: vi.fn(() => ({ profile: { status: 'active' } })),
      activate: vi.fn(() => ({ status: 'active' })),
      pause: vi.fn(() => ({ status: 'paused' })),
      resume: vi.fn(() => ({ status: 'active' })),
      acceptCandidate: vi.fn(() => ({ status: 'accepted' })),
      rejectCandidate: vi.fn(() => ({ status: 'rejected' })),
    };
    const kswarm = {
      planProjectTeam: vi.fn(), applyProjectTeamPlan: vi.fn(), getProjectTeamOperation: vi.fn(),
      createKSwarmProject: vi.fn(), updateKSwarmProjectExecutionMode: vi.fn(), deleteKSwarmProject: vi.fn(), createKSwarmAgent: vi.fn(), updateKSwarmAgent: vi.fn(),
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
    const assistant = Object.fromEntries(['getOverview','activate','pause','resume','acceptCandidate','rejectCandidate'].map(key => [key, vi.fn()]));
    const window = {isDestroyed: () => false,webContents:{mainFrame:{url:'app://desktop'}}};
    let current: any = window;
    const authorizeAssistant = createLoopPublicationIpcAuthorizer({getWindow:()=>current,isTrustedUrl:url=>url==='app://desktop'});
    registerSemanticDesktopIpc({handle:(key:string,fn:(...args:any[])=>unknown)=>handlers.set(key,fn)} as never,{assistant:assistant as never,kswarm:{} as never,authorizeAssistant});
    return {handlers,assistant,window,replace(){current={isDestroyed:()=>false,webContents:{mainFrame:{url:'app://desktop'}}};},event:{sender:window.webContents,senderFrame:window.webContents.mainFrame}};
  }
  it('denies old windows, subframes and forged user sources before every assistant call', () => {
    for(const method of ['getOverview','activate','pause','resume','acceptCandidate','rejectCandidate']) {
      const f=fixture(), call=f.handlers.get(`desktop:assistant:${method}`)!;
      const args=method.endsWith('Candidate')?[{candidateId:'candidate-1'}]:[];
      expect(()=>call({...f.event,senderFrame:{}},...args)).toThrow('assistant_ipc_denied');
      f.replace();expect(()=>call(f.event,...args)).toThrow('assistant_ipc_denied');
      expect(f.assistant[method]).not.toHaveBeenCalled();
    }
    const f=fixture();
    expect(()=>f.handlers.get('desktop:assistant:acceptCandidate')!(f.event,{candidateId:'candidate-1',requestSource:'agent'})).toThrow('assistant_ipc_input');
    expect(f.assistant.acceptCandidate).not.toHaveBeenCalled();
  });
  it('enforces exact argument shapes without invoking accessors', () => {
    const f=fixture(),accept=f.handlers.get('desktop:assistant:acceptCandidate')!;
    const read=vi.fn(()=> 'candidate-1');
    for(const input of [{candidateId:'candidate-1',extra:true},{get candidateId(){return read();}},[],null]) {
      expect(()=>accept(f.event,input)).toThrow();
    }
    expect(()=>accept(f.event,{candidateId:'candidate-1'},{})).toThrow('assistant_ipc_input');
    expect(()=>f.handlers.get('desktop:assistant:pause')!(f.event,{requestSource:'user'})).toThrow('assistant_ipc_input');
    expect(read).not.toHaveBeenCalled();expect(f.assistant.acceptCandidate).not.toHaveBeenCalled();
    accept(f.event,{candidateId:'candidate-1',collectionId:'collection-1'});
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
  const deleteRoom = vi.fn(() => ({ok: true}));
  const options = {assistant: {} as never, kswarm: {} as never, collaborationRooms: {deleteRoom} as never};
  const ipc = {handle: (channel: string, fn: (...args: any[]) => unknown) => handlers.set(channel, fn)} as never;
  registerSemanticDesktopIpc(ipc, options);
  const input = {roomId: 'room-1', expectedRoomRevision: 1, requestSource: 'user'};
  expect(await handlers.get('desktop:collaborationRoom:deleteRoom')!({}, input)).toMatchObject({ok: false});
  expect(deleteRoom).not.toHaveBeenCalled();
  const event = {};
  registerSemanticDesktopIpc(ipc, {...options, authorizeRoomDeletion: caller => caller === event});
  expect(await handlers.get('desktop:collaborationRoom:deleteRoom')!({}, input)).toMatchObject({ok: false});
  expect(await handlers.get('desktop:collaborationRoom:deleteRoom')!(event, input)).toMatchObject({ok: true});
  expect(deleteRoom).toHaveBeenCalledWith(input, {requestSource: 'user'});
});
