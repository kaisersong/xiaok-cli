// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { registerHarnessOptimizationIpc } from '../../electron/harness-optimization-ipc.js';
import { createPreloadApi, INVOKE_CHANNEL_BY_KEY } from '../../electron/preload-api.js';

describe('D0 narrow IPC and preload', () => {
  it('binds only the trusted main-frame user and never trusts payload source', async () => {
    const handlers = new Map<string, (event: unknown, input?: unknown) => unknown>();
    const actor = { requestSource: 'user', principalId: 'main-window' };
    const trustedEvent = {};
    const services = { getHarnessOptimizationConfig: vi.fn(async () => ({ publicStatus: 'unavailable' })),
      saveHarnessOptimizationConfig: vi.fn(async () => ({})), setHarnessOptimizationEnabled: vi.fn(async () => ({})),
      revokeHarnessOptimizationGrants: vi.fn(async () => ({})), resetOptimizationClockGuard: vi.fn(async () => ({})) };
    registerHarnessOptimizationIpc({ handle: (channel, fn) => { handlers.set(channel, fn as never); } }, services as never,
      event => event === trustedEvent ? actor : null);
    expect(handlers.size).toBe(5);
    for (const handler of handlers.values()) {
      await expect(handler({}, { requestSource: 'user', principalId: 'main-window' })).rejects.toThrow('actor_forbidden');
    }
    await handlers.get('desktop:saveHarnessOptimizationConfig')!(trustedEvent, { mode: 'reflect' });
    expect(services.saveHarnessOptimizationConfig).toHaveBeenCalledWith({ mode: 'reflect' }, actor);
    const invoke = vi.fn(async () => ({}));
    const api = createPreloadApi({ invoke, on: vi.fn(), off: vi.fn() } as never);
    await api.getHarnessOptimizationConfig();
    expect(invoke).toHaveBeenLastCalledWith('desktop:getHarnessOptimizationConfig');
    await api.setHarnessOptimizationEnabled(false);
    expect(invoke).toHaveBeenLastCalledWith('desktop:setHarnessOptimizationEnabled', false);
    expect(INVOKE_CHANNEL_BY_KEY.revokeHarnessOptimizationGrants).toBe('desktop:revokeHarnessOptimizationGrants');
    expect(Object.keys(api)).not.toContain('prepareAttempt');
    expect(Object.keys(api)).not.toContain('send');
  });
});
