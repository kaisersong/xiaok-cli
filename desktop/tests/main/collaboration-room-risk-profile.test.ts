import { afterEach, expect, it, vi } from 'vitest';
import { createCollaborationRoomService } from '../../electron/collaboration-room-service.js';
import { registerSemanticDesktopIpc } from '../../electron/semantic-ipc.js';
import { resetIpcSchemaRegistryForTests } from '../../electron/ipc-runtime.js';
import { KSWARM_PROJECT_FACT_SCHEMA } from '../../shared/kswarm-project-agent-ipc-contract.js';
import { registerKSwarmProjectAgentTypedIpc } from '../../electron/kswarm-project-agent-typed-ipc.js';
import { registerKSwarmProxy } from '../../electron/kswarm-ipc-proxy.js';

afterEach(() => resetIpcSchemaRegistryForTests());

it.each(['low', 'normal', 'high', { level: 'normal' }, null, undefined])(
  'preserves project risk profile %j through service and typed room IPC', async riskProfile => {
    const project = { id: 'project-fixture', name: 'Fixture', riskProfile };
    const snapshot = { ok: true, room: { roomId: 'room-fixture', title: 'Fixture', status: 'active' },
      members: [], messages: [{ messageId: 'message-fixture', kind: 'text', text: 'Fixture',
        sender: { kind: 'user', userId: 'user.local' }, sourceRef: { projectId: project.id } }] };
    const request = vi.fn(async (path: string) => ({ ok: true, json: async () => path === '/agents' ? { agents: [] } : { project } }));
    const service = createCollaborationRoomService({ brokerClient: { getRoomSnapshot: async () => snapshot } as never,
      kswarmClient: { request } });
    const handlers = new Map<string, Function>();
    registerSemanticDesktopIpc({ handle: (channel: string, handler: Function) => handlers.set(channel, handler) } as never,
      { assistant: {} as never, collaborationRooms: service });
    const result = await handlers.get('desktop:collaborationRoom:getRoom')!({}, 'room-fixture');
    expect(result).toMatchObject({ ok: true, projects: [project], messages: snapshot.messages });
    expect(request).toHaveBeenCalledWith('/projects/project-fixture');
  },
);

it.each(['low', 'normal', 'high'])('preserves %s through project creation and mode IPC', async riskProfile => {
  const project = { id: 'project-fixture', name: 'Fixture', riskProfile };
  const handlers = new Map<string, Function>();
  registerKSwarmProjectAgentTypedIpc({ handle: (channel: string, handler: Function) => handlers.set(channel, handler) } as never,
    { createKSwarmProject: async () => project, updateKSwarmProjectExecutionMode: async () => ({ ok: true, project }) } as never);
  expect(await handlers.get('desktop:kswarm:project:create')!({}, { name: 'Fixture', goal: 'Fixture', poAgent: 'fixture-worker' })).toEqual(project);
  expect(await handlers.get('desktop:kswarm:project:updateExecutionMode')!({}, { projectId: project.id, executionMode: 'direct' })).toEqual({ ok: true, project });
});

it.each([42, true, []])('rejects malformed risk profile %j', riskProfile => {
  expect(KSWARM_PROJECT_FACT_SCHEMA.safeParse({ id: 'project-fixture', name: 'Fixture', riskProfile }).success).toBe(false);
});

it.each(['/projects', '/projects/project-fixture'])('preserves project risk in proxy reads of %s', async path => {
  const project = { id: 'project-fixture', name: 'Fixture', riskProfile: 'normal' };
  const payload = path === '/projects' ? [project] : { project };
  const handlers = new Map<string, Function>();
  registerKSwarmProxy({ handle: (channel: string, handler: Function) => handlers.set(channel, handler) } as never,
    {} as never, { request: async () => new Response(JSON.stringify(payload)), getDesktopMutationToken: () => 'fixture-token' });
  expect(await handlers.get('desktop:kswarm:proxy:get')!({}, path)).toEqual(payload);
});
