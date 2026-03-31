import { describe, expect, it, vi } from 'vitest';
import { Agent } from '../../src/ai/agent.js';
import { ChannelAgentService } from '../../src/channels/agent-service.js';
import type { ModelAdapter, StreamChunk } from '../../src/types.js';
import { ToolRegistry } from '../../src/ai/tools/index.js';

async function* mockStream(chunks: StreamChunk[]): AsyncIterable<StreamChunk> {
  for (const chunk of chunks) {
    yield chunk;
  }
}

describe('ChannelAgentService', () => {
  it('disposes existing sessions when resetSession or closeAll is called', async () => {
    const dispose1 = vi.fn();
    const dispose2 = vi.fn();
    let createCount = 0;
    const adapter: ModelAdapter = {
      getModelName: () => 'mock',
      stream: () => mockStream([{ type: 'text', delta: 'ok' }, { type: 'done' }]),
    };

    const service = new ChannelAgentService(
      {
        async createSession() {
          createCount += 1;
          return {
            agent: new Agent(adapter, new ToolRegistry({}), 'system'),
            dispose: createCount === 1 ? dispose1 : dispose2,
          };
        },
      },
      {
        reply: async () => undefined,
      },
    );

    await service.execute({
      sessionKey: { channel: 'yzj', chatId: 'robot-1', userId: 'user-1' },
      message: 'hello',
      replyTarget: { chatId: 'robot-1', userId: 'user-1' },
    }, 'sess_1');
    await service.execute({
      sessionKey: { channel: 'yzj', chatId: 'robot-2', userId: 'user-2' },
      message: 'hello',
      replyTarget: { chatId: 'robot-2', userId: 'user-2' },
    }, 'sess_2');

    service.resetSession('sess_1');
    service.closeAll();

    expect(dispose1).toHaveBeenCalledTimes(1);
    expect(dispose2).toHaveBeenCalledTimes(1);
  });
});
