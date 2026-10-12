import { afterEach, expect, it, vi } from 'vitest';
import { api } from '../../renderer/src/api/bridge';
const original = window.xiaokDesktop;
afterEach(() => { window.xiaokDesktop = original; vi.restoreAllMocks(); });
it.each(['listChannels', 'listMCPInstalls'] as const)('actual bridge preserves %s rejection identity', async method => {
  const error = Error('owned_ipc_failure'), produce = vi.fn().mockRejectedValue(error);
  window.xiaokDesktop = { ...original, [method]: produce };
  await expect(api[method]()).rejects.toBe(error); expect(produce).toHaveBeenCalledTimes(1);
});
it.each(['listChannels', 'listMCPInstalls'] as const)('actual bridge treats absent %s preload as unavailable', async method => {
  window.xiaokDesktop = { ...original, [method]: undefined };
  await expect(api[method]()).rejects.toThrow();
});
it.each(['listChannels', 'listMCPInstalls'] as const)('actual bridge keeps genuine empty %s success and zero argument ABI', async method => {
  const produce = vi.fn().mockResolvedValue([]); window.xiaokDesktop = { ...original, [method]: produce };
  expect(await api[method]()).toEqual([]); expect(produce).toHaveBeenCalledExactlyOnceWith();
});
