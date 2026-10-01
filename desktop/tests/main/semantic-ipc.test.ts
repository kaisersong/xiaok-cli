import { describe, expect, it, vi } from 'vitest';

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
      createKSwarmProject: vi.fn(), createKSwarmAgent: vi.fn(), updateKSwarmAgent: vi.fn(),
      archiveKSwarmAgent: vi.fn(), startKSwarmAgent: vi.fn(), stopKSwarmAgent: vi.fn(), probeKSwarmAgent: vi.fn(),
    };

    registerSemanticDesktopIpc(ipcMain as never, { assistant, kswarm });

    await handlers.get('desktop:assistant:acceptCandidate')?.({}, { candidateId: 'candidate-1', requestSource: 'agent' });
    await handlers.get('desktop:assistant:rejectCandidate')?.({}, { candidateId: 'candidate-1', requestSource: 'scheduler' });
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
