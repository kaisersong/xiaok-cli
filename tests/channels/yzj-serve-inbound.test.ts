import { describe, expect, it, vi } from 'vitest';
import { createYZJInboundProcessor } from '../../src/channels/yzj-inbound.js';
import type { YZJIncomingMessage } from '../../src/channels/yzj-types.js';

const message = (content: string, sender = 'other'): YZJIncomingMessage => ({
  type: 1, robotId: 'robot', robotName: 'bot', operatorOpenid: sender,
  operatorName: 'user', time: 0, msgId: content, content, groupType: 0,
});

describe('serve 入站授权顺序', () => {
  it.each(['hello', '/bind /ws', '/approve approval_1', '/deny approval_1'])('名单外消息不进入会话或命令处理 %s', async content => {
    const handleChannelRequest = vi.fn(); const deliver = vi.fn();
    const inbound = createYZJInboundProcessor({ allowedSenders: ['owner'], markSeen: () => true, deliver, execute: handleChannelRequest, log: vi.fn() });
    await inbound(message(content), 'websocket');
    expect(handleChannelRequest).not.toHaveBeenCalled();
    expect(deliver).toHaveBeenCalledWith(expect.objectContaining({ text: '你没有权限使用这个助手。', target: expect.not.objectContaining({ metadata: expect.anything() }) }));
  });
  it('先去重再授权，允许后才进入现有处理', async () => {
    const execute = vi.fn(); const deliver = vi.fn(); const markSeen = vi.fn().mockReturnValueOnce(false).mockReturnValue(true);
    const inbound = createYZJInboundProcessor({ allowedSenders: ['owner'], markSeen, deliver, execute, log: vi.fn() });
    await inbound(message('hello'), 'websocket');
    expect(deliver).not.toHaveBeenCalled();
    await inbound(message('/bind /ws', 'owner'), 'webhook');
    expect(execute).toHaveBeenCalledWith(message('/bind /ws', 'owner'), 'webhook');
  });
  it('空名单也不建立会话', async () => {
    const execute = vi.fn();
    await createYZJInboundProcessor({ markSeen: () => true, deliver: vi.fn(), execute, log: vi.fn() })(message('hello', 'owner'), 'websocket');
    expect(execute).not.toHaveBeenCalled();
  });
});
