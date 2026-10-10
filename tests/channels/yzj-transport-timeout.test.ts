import { afterEach, expect, it, vi } from 'vitest';
import { YZJTransport } from '../../src/channels/yzj-transport.js';
afterEach(() => vi.unstubAllGlobals());

it('每次 fetch 携带超时 signal，超时错误向调用方传播', async () => {
  const timeout = vi.spyOn(AbortSignal, 'timeout');
  const error = new Error('timeout');
  const fetchMock = vi.fn(async (_url, options) => {
    expect(options.signal).toBeInstanceOf(AbortSignal);
    throw error;
  });
  vi.stubGlobal('fetch', fetchMock);
  try {
    await expect(new YZJTransport({ webhookUrl: 'https://example.invalid/ws' }).deliver({
      channel: 'yzj', target: { chatId: 'r', userId: 'owner' }, text: 'confirmation', kind: 'approval',
    })).rejects.toBe(error);
    expect(timeout).toHaveBeenCalledWith(8_000);
    expect(fetchMock).toHaveBeenCalledOnce();
  } finally { timeout.mockRestore(); }
});
