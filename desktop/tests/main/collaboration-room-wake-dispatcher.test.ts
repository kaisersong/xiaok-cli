import { describe, expect, it, vi } from 'vitest';
import { createCollaborationRoomWakeDispatcher } from '../../electron/collaboration-room-wake-dispatcher.js';

describe('collaboration room wake dispatcher', () => {
  it('claims a durable wake, passes only the current room snapshot to the isolated executor, and completes once', async () => {
    const brokerClient = {
      getRoomSnapshot: vi.fn(async () => ({
        ok: true,
        room: { roomId: 'room-a', title: 'A', revision: 3 },
        messages: [
          { messageId: 'private-sentinel', roomId: 'room-b', text: 'must not leak', sender: { kind: 'user', userId: 'u' } },
          { messageId: 'msg-1', roomId: 'room-a', text: 'inspect boundaries', sender: { kind: 'user', userId: 'u' } },
        ],
      })),
      claimWake: vi.fn(async () => ({ ok: true, claimToken: 'claim-1' })),
      completeWake: vi.fn(async () => ({ ok: true })),
    };
    const execute = vi.fn(async () => ({ text: 'Boundaries reviewed.' }));
    const dispatcher = createCollaborationRoomWakeDispatcher({ brokerClient, execute });

    const result = await dispatcher.dispatchMessage({
      roomId: 'room-a',
      roomMessageId: 'msg-1',
      logicalAgentIds: ['agent-a'],
    });

    expect(result).toEqual({ ok: true, completed: ['agent-a'], failed: [] });
    expect(brokerClient.claimWake).toHaveBeenCalledTimes(1);
    const envelope = execute.mock.calls[0][0];
    expect(envelope.logicalAgentId).toBe('agent-a');
    expect(envelope.roomId).toBe('room-a');
    expect(envelope.messages.map((message: { messageId: string }) => message.messageId)).toEqual(['msg-1']);
    expect(JSON.stringify(envelope)).not.toContain('must not leak');
    expect(brokerClient.completeWake).toHaveBeenCalledWith({
      claimToken: 'claim-1',
      reply: { kind: 'text', text: 'Boundaries reviewed.' },
    });
  });

  it('passes attachment paths only from the persisted source message to the executor', async () => {
    const brokerClient = {
      getRoomSnapshot: vi.fn(async () => ({
        ok: true,
        room: { roomId: 'room-a', title: 'A', revision: 3 },
        messages: [{
          messageId: 'msg-1',
          roomId: 'room-a',
          kind: 'text',
          text: 'read the attachment',
          sender: { kind: 'user', userId: 'u' },
          sourceRef: {
            kind: 'user_attachments',
            attachments: [
              { filePath: '/tmp/brief.md', name: 'brief.md' },
              { filePath: 42, name: 'invalid' },
            ],
          },
        }],
      })),
      claimWake: vi.fn(async () => ({ ok: true, claimToken: 'claim-1' })),
      completeWake: vi.fn(async () => ({ ok: true })),
    };
    const execute = vi.fn(async () => ({ text: 'done' }));
    const dispatcher = createCollaborationRoomWakeDispatcher({ brokerClient, execute });

    await dispatcher.dispatchMessage({ roomId: 'room-a', roomMessageId: 'msg-1', logicalAgentIds: ['agent-a'] });

    expect(execute).toHaveBeenCalledWith(expect.objectContaining({
      attachmentPaths: ['/tmp/brief.md'],
    }));
  });

  it('does not execute when the broker refuses the claim', async () => {
    const brokerClient = {
      getRoomSnapshot: vi.fn(async () => ({
        ok: true,
        room: { roomId: 'room-a' },
        messages: [{ messageId: 'msg-1', roomId: 'room-a', kind: 'text', text: 'hello' }],
      })),
      claimWake: vi.fn(async () => ({ ok: false, code: 'room_delivery_conflict' })),
      completeWake: vi.fn(),
    };
    const execute = vi.fn();
    const dispatcher = createCollaborationRoomWakeDispatcher({ brokerClient, execute });

    const result = await dispatcher.dispatchMessage({ roomId: 'room-a', roomMessageId: 'msg-1', logicalAgentIds: ['agent-a'] });

    expect(result).toEqual({ ok: true, completed: [], failed: ['agent-a'] });
    expect(execute).not.toHaveBeenCalled();
    expect(brokerClient.completeWake).not.toHaveBeenCalled();
  });

  it('never impersonates a self-running agent with the Desktop model', async () => {
    const brokerClient = {
      getRoomSnapshot: vi.fn(async () => ({
        ok: true,
        room: { roomId: 'room-a' },
        messages: [{ messageId: 'msg-1', roomId: 'room-a', kind: 'text', text: '@qoder review' }],
      })),
      claimWake: vi.fn(),
      completeWake: vi.fn(),
    };
    const execute = vi.fn();
    const dispatcher = createCollaborationRoomWakeDispatcher({
      brokerClient,
      canExecute: vi.fn(async () => false),
      execute,
    });

    const result = await dispatcher.dispatchMessage({ roomId: 'room-a', roomMessageId: 'msg-1', logicalAgentIds: ['qoder-1'] });

    expect(result).toEqual({ ok: true, completed: [], failed: ['qoder-1'] });
    expect(brokerClient.claimWake).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it('emits progress after each settled agent and a final discussion event', async () => {
    const brokerClient = {
      getRoomSnapshot: vi.fn(async () => ({
        ok: true,
        room: { roomId: 'room-a', title: 'A', revision: 3 },
        messages: [{ messageId: 'msg-1', roomId: 'room-a', kind: 'text', text: 'review', sender: { kind: 'user', userId: 'u' } }],
      })),
      claimWake: vi.fn(async ({ logicalAgentId }: { logicalAgentId: string }) => (
        logicalAgentId === 'agent-b'
          ? { ok: false, code: 'room_delivery_conflict' }
          : { ok: true, claimToken: `claim-${logicalAgentId}` }
      )),
      completeWake: vi.fn(async () => ({ ok: true })),
    };
    const onEvent = vi.fn();
    const dispatcher = createCollaborationRoomWakeDispatcher({
      brokerClient,
      execute: vi.fn(async ({ logicalAgentId }) => ({ text: `${logicalAgentId} done` })),
      onEvent,
    });

    const result = await dispatcher.dispatchMessage({
      roomId: 'room-a',
      roomMessageId: 'msg-1',
      logicalAgentIds: ['agent-b', 'agent-a'],
    });

    expect(result).toEqual({ ok: true, completed: ['agent-a'], failed: ['agent-b'] });
    expect(onEvent.mock.calls.map(([event]) => event)).toEqual([
      {
        type: 'wake_settled',
        roomId: 'room-a',
        roomMessageId: 'msg-1',
        logicalAgentId: 'agent-a',
        outcome: 'completed',
        remaining: 1,
      },
      {
        type: 'wake_settled',
        roomId: 'room-a',
        roomMessageId: 'msg-1',
        logicalAgentId: 'agent-b',
        outcome: 'failed',
        remaining: 0,
      },
      {
        type: 'discussion_settled',
        roomId: 'room-a',
        roomMessageId: 'msg-1',
        completed: ['agent-a'],
        failed: ['agent-b'],
      },
    ]);
  });
});
