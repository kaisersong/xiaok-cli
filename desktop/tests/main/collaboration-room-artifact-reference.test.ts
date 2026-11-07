import { describe, expect, it } from 'vitest';
import { createCollaborationRoomService } from '../../electron/collaboration-room-service.js';
import { ROOM_SEMANTIC_OUTPUT_SCHEMAS } from '../../shared/collaboration-room-ipc-contract.js';

const historicalMessage = {
  messageId: 'message-fixture', kind: 'project_event',
  sender: { kind: 'system', service: 'kswarm' },
  sourceRef: { projectId: 'project-fixture', taskId: 'task-research',
    eventType: 'artifact.registered', artifactId: 'task-research:report.md',
    artifact: { filename: 'report.md', kind: 'markdown', mimeType: null } },
};

async function compose(tasks: unknown[], message: unknown = historicalMessage, unavailable = false) {
  const snapshot = { ok: true, room: { roomId: 'room-fixture', title: 'Fixture', status: 'active' },
    members: [], projects: ['project-fixture'], messages: [message] };
  const before = structuredClone(snapshot);
  const service = createCollaborationRoomService({
    brokerClient: { getRoomSnapshot: async () => snapshot } as never,
    kswarmClient: { request: async path => {
      if (unavailable) throw Error('offline');
      return { ok: true, json: async () => path === '/agents' ? { agents: [] }
        : { project: { id: 'project-fixture', name: 'Fixture' }, tasks } };
    } },
  });
  const result = ROOM_SEMANTIC_OUTPUT_SCHEMAS.getRoom.parse(await service.getRoom('room-fixture'));
  expect(snapshot).toEqual(before);
  return result.messages![0].sourceRef!;
}

describe('room artifact references from current task facts', () => {
  it('resolves a moved artifact in its producing task and enriches MIME without changing event identity', async () => {
    const result = await compose([
      { id: 'task-other', result: { artifacts: [{ filename: 'run-other/report.md', mimeType: 'text/plain' }] } },
      { id: 'task-research', result: { artifacts: [{ filename: 'run-current/report.md', mimeType: 'text/markdown' }] } },
    ]);
    expect(result).toMatchObject({ artifactId: 'task-research:report.md', taskId: 'task-research',
      artifact: { filename: 'run-current/report.md', mimeType: 'text/markdown', kind: 'markdown' } });
  });

  it('prefers the exact full filename over another artifact with the same basename', async () => {
    const message = structuredClone(historicalMessage);
    message.sourceRef.artifact.filename = 'run-a/report.md';
    const result = await compose([{ id: 'task-research', result: { artifacts: [
      { filename: 'run-a/report.md', mimeType: 'text/markdown' },
      { filename: 'run-b/report.md', mimeType: 'text/plain' },
    ] } }], message);
    expect(result.artifact).toMatchObject({ filename: 'run-a/report.md', mimeType: 'text/markdown' });
  });

  it.each([
    [{ id: 'task-other', result: { artifacts: [{ filename: 'run-other/report.md' }] } }],
    [{ id: 'task-research', result: { artifacts: [{ filename: 'run-a/report.md' }, { filename: 'run-b/report.md' }] } }],
    [{ id: 'task-research', result: { artifacts: [] } }],
    [{ id: 'task-research', result: { artifacts: null } }],
  ])('preserves the reference when current facts cannot identify one artifact: %j', async task => {
    expect(await compose([task])).toEqual(historicalMessage.sourceRef);
  });

  it('keeps historical messages readable while KSwarm is unavailable', async () => {
    expect(await compose([], historicalMessage, true)).toEqual(historicalMessage.sourceRef);
  });

  it('does not infer a task for old events without task identity', async () => {
    const message = { ...historicalMessage, sourceRef: { ...historicalMessage.sourceRef, taskId: undefined } };
    expect(await compose([{ id: 'task-research', result: { artifacts: [{ filename: 'run-current/report.md' }] } }], message))
      .toEqual(message.sourceRef);
  });

  it('does not rewrite ordinary messages that happen to contain artifact metadata', async () => {
    const message = { ...historicalMessage, kind: 'text' };
    expect(await compose([{ id: 'task-research', result: { artifacts: [{ filename: 'run-current/report.md' }] } }], message))
      .toEqual(message.sourceRef);
  });
});
