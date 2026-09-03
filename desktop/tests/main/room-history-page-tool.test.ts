import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createGetRoomMessagesPageTool,
  setRoomHistoryBrokerClient,
} from '../../electron/room-history-page-tool';
import {
  registerRoomHistoryCapability,
  releaseRoomHistoryCapability,
} from '../../electron/room-history-capability-registry';

describe('getRoomMessagesPage tool (design §6.2 RoomHistoryReadCapability)', () => {
  afterEach(() => {
    releaseRoomHistoryCapability('task-1');
    setRoomHistoryBrokerClient(null);
  });

  it('rejects when the current task has no registered Room capability (ordinary non-Room task)', async () => {
    const tool = createGetRoomMessagesPageTool();
    const result = await tool.execute({}, { taskId: 'task-1' } as any);
    expect(result).toContain('Error');
    expect(result).toContain('不是协作空间任务');
  });

  it('rejects when no taskId is present in the execution context', async () => {
    const tool = createGetRoomMessagesPageTool();
    const result = await tool.execute({}, {} as any);
    expect(result).toContain('Error');
  });

  it('calls the bound broker client with the capability-bound roomId/claimToken, never exposing them to tool input', async () => {
    registerRoomHistoryCapability('task-1', { roomId: 'room-1', claimToken: 'secret-claim-token' });
    const listRoomMessagesPage = vi.fn().mockResolvedValue({ ok: true, messages: [{ text: 'hi' }] });
    setRoomHistoryBrokerClient({ listRoomMessagesPage });

    const tool = createGetRoomMessagesPageTool();
    const result = await tool.execute({ limit: 10 }, { taskId: 'task-1' } as any);

    expect(listRoomMessagesPage).toHaveBeenCalledWith({
      roomId: 'room-1',
      claimToken: 'secret-claim-token',
      limit: 10,
    });
    expect(result).toContain('hi');
  });

  it('clamps a non-integer or out-of-range limit to the default page size instead of silently enlarging', async () => {
    registerRoomHistoryCapability('task-1', { roomId: 'room-1', claimToken: 'tok' });
    const listRoomMessagesPage = vi.fn().mockResolvedValue({ ok: true, messages: [] });
    setRoomHistoryBrokerClient({ listRoomMessagesPage });

    const tool = createGetRoomMessagesPageTool();
    await tool.execute({ limit: 99999 }, { taskId: 'task-1' } as any);
    expect(listRoomMessagesPage).toHaveBeenCalledWith(expect.objectContaining({ limit: 200 }));

    await tool.execute({ limit: -5 }, { taskId: 'task-1' } as any);
    expect(listRoomMessagesPage).toHaveBeenCalledWith(expect.objectContaining({ limit: 50 }));

    await tool.execute({ limit: 3.5 }, { taskId: 'task-1' } as any);
    expect(listRoomMessagesPage).toHaveBeenCalledWith(expect.objectContaining({ limit: 50 }));
  });

  it('reports an error when no broker client is bound yet', async () => {
    registerRoomHistoryCapability('task-1', { roomId: 'room-1', claimToken: 'tok' });
    const tool = createGetRoomMessagesPageTool();
    const result = await tool.execute({}, { taskId: 'task-1' } as any);
    expect(result).toContain('Error');
    expect(result).toContain('不可用');
  });

  it('the tool schema never accepts roomId or claimToken as caller-controlled input fields', () => {
    const tool = createGetRoomMessagesPageTool();
    const properties = (tool.definition.inputSchema as any).properties;
    expect(properties).not.toHaveProperty('roomId');
    expect(properties).not.toHaveProperty('claimToken');
  });
});
