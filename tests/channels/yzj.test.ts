import { afterEach, describe, expect, it, vi } from 'vitest';
import { deriveYZJWebSocketUrl } from '../../src/channels/yzj-ws-url.js';
import { classifyWebSocketPayload } from '../../src/channels/yzj-websocket-client-helpers.js';
import { parseYZJMessage } from '../../src/channels/yzj.js';
import { YZJTransport } from '../../src/channels/yzj-transport.js';

describe('yzj channel helpers', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('derives websocket URL from webhookUrl', () => {
    expect(
      deriveYZJWebSocketUrl('https://yunzhijia.com/gateway/robot/webhook/send?yzjtype=12&yzjtoken=abc')
    ).toBe('wss://yunzhijia.com/xuntong/websocket?yzjtoken=abc');
  });

  it('classifies directPush frames and returns ack payload when needed', () => {
    expect(
      classifyWebSocketPayload({
        cmd: 'directPush',
        needAck: true,
        seq: 42,
      })
    ).toEqual({
      kind: 'control',
      reason: 'directPush',
      ack: '{"cmd":"ack","seq":42}',
    });
  });

  it('maps yzj message into channel request with reply metadata', () => {
    const req = parseYZJMessage({
      type: 2,
      robotId: 'robot-1',
      robotName: 'robot',
      operatorOpenid: 'openid-1',
      operatorName: 'Alice',
      time: 1710000000000,
      msgId: 'msg-1',
      content: 'fix build',
      groupType: 0,
    });

    expect(req.sessionKey).toEqual({
      channel: 'yzj',
      chatId: 'robot-1',
      userId: 'openid-1',
    });
    expect(req.replyTarget).toEqual({
      chatId: 'robot-1',
      userId: 'openid-1',
      messageId: 'msg-1',
      metadata: {
        operatorName: 'Alice',
        robotName: 'robot',
        groupType: 0,
        sentAt: 1710000000000,
        replySummary: 'fix build',
      },
    });
  });

  it('builds yzj outbound payload with openId and reply param', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      text: async () => '',
    }));
    vi.stubGlobal('fetch', fetchMock);

    const transport = new YZJTransport({
      webhookUrl: 'https://yunzhijia.com/gateway/robot/webhook/send?yzjtype=12&yzjtoken=abc',
    });

    await transport.deliver({
      channel: 'yzj',
      target: {
        chatId: 'robot-1',
        userId: 'openid-1',
        messageId: 'msg-1',
        metadata: {
          operatorName: 'Alice',
          replySummary: 'fix build',
        },
      },
      text: 'working on it',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    });
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body).toMatchObject({
      msgtype: 2,
      content: 'working on it',
      paramType: 3,
      param: {
        replyMsgId: 'msg-1',
        replySummary: 'fix build',
        replyPersonName: 'Alice',
      },
      notifyParams: [
        {
          type: 'openIds',
          values: ['openid-1'],
        },
      ],
    });
  });

  it('splits oversized outbound text into multiple requests', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      text: async () => '',
    }));
    vi.stubGlobal('fetch', fetchMock);

    const transport = new YZJTransport({
      webhookUrl: 'https://yunzhijia.com/gateway/robot/webhook/send?yzjtype=12&yzjtoken=abc',
      chunkLimit: 10,
    });

    const result = await transport.deliverWithMetrics({
      channel: 'yzj',
      target: {
        chatId: 'robot-1',
        userId: 'openid-1',
      },
      text: '12345\n67890\nabcde',
    });

    expect(result.chunks).toBeGreaterThan(1);
    expect(fetchMock).toHaveBeenCalledTimes(result.chunks);

    const sentChunks = fetchMock.mock.calls.map((call) => {
      const body = JSON.parse(String(call[1]?.body));
      return String(body.content);
    });

    expect(sentChunks.every((chunk) => chunk.length <= 10)).toBe(true);
  });

  it('retries on 429 and succeeds', async () => {
    vi.useFakeTimers();
    let calls = 0;
    const fetchMock = vi.fn(async () => {
      calls += 1;
      if (calls < 3) {
        return { ok: false, status: 429, text: async () => 'rate limited' };
      }
      return { ok: true, text: async () => '' };
    });
    vi.stubGlobal('fetch', fetchMock);

    const transport = new YZJTransport({
      webhookUrl: 'https://example.com/send',
    });

    const promise = transport.deliver({
      channel: 'yzj',
      target: { chatId: 'r1' },
      text: 'hello',
    });

    await vi.runAllTimersAsync();
    await promise;

    expect(calls).toBe(3);
    vi.useRealTimers();
  });

  it('throws YZJTransportError with status 401 without retrying', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 401,
      text: async () => 'unauthorized',
    }));
    vi.stubGlobal('fetch', fetchMock);

    const { YZJTransportError } = await import('../../src/channels/yzj-transport.js');
    const transport = new YZJTransport({
      webhookUrl: 'https://example.com/send',
    });

    await expect(transport.deliver({
      channel: 'yzj',
      target: { chatId: 'r1' },
      text: 'hello',
    })).rejects.toThrow('认证失败');

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
