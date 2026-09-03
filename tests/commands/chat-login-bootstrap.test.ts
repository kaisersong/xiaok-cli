import { describe, expect, it, vi } from 'vitest';
import type { Config, ModelAdapter } from '../../src/types.js';
import { DEFAULT_CONFIG } from '../../src/types.js';
import { MissingProviderApiKeyError } from '../../src/ai/providers/control-plane.js';
import { createChatAdapterWithLoginBootstrap } from '../../src/commands/chat-login-bootstrap.js';

function cloneDefaultConfig(): Config {
  return JSON.parse(JSON.stringify(DEFAULT_CONFIG)) as Config;
}

function fakeAdapter(name = 'test-model'): ModelAdapter {
  return {
    async *stream() {
      yield { type: 'done' as const };
    },
    getModelName: () => name,
  };
}

describe('interactive chat login bootstrap', () => {
  it('runs the existing login flow, reloads config, and retries adapter creation', async () => {
    const initial = cloneDefaultConfig();
    const configured = cloneDefaultConfig();
    configured.defaultProvider = 'deepseek';
    const adapter = fakeAdapter('deepseek');
    const missingKey = new MissingProviderApiKeyError('anthropic', 'ANTHROPIC');
    const createAdapter = vi.fn()
      .mockImplementationOnce(() => { throw missingKey; })
      .mockReturnValueOnce(adapter);
    const runLogin = vi.fn().mockResolvedValue({ status: 'saved', providerId: 'deepseek' });
    const loadConfig = vi.fn().mockResolvedValue(configured);
    const writeLine = vi.fn();

    const result = await createChatAdapterWithLoginBootstrap(initial, {
      interactive: true,
      hasInitialInput: false,
    }, { createAdapter, runLogin, loadConfig, writeLine });

    expect(runLogin).toHaveBeenCalledWith({ setDefault: true });
    expect(loadConfig).toHaveBeenCalledOnce();
    expect(createAdapter).toHaveBeenNthCalledWith(1, initial);
    expect(createAdapter).toHaveBeenNthCalledWith(2, configured);
    expect(result).toEqual({ config: configured, adapter });
    expect(writeLine).toHaveBeenCalledWith(expect.stringContaining('登录'));
  });

  it.each([
    { interactive: false, hasInitialInput: false },
    { interactive: true, hasInitialInput: true },
  ])('does not prompt outside an input-free interactive chat: %o', async (options) => {
    const missingKey = new MissingProviderApiKeyError('anthropic', 'ANTHROPIC');
    const runLogin = vi.fn();

    await expect(createChatAdapterWithLoginBootstrap(cloneDefaultConfig(), options, {
      createAdapter: () => { throw missingKey; },
      runLogin,
      loadConfig: vi.fn(),
      writeLine: vi.fn(),
    })).rejects.toBe(missingKey);

    expect(runLogin).not.toHaveBeenCalled();
  });

  it('does not reinterpret unrelated adapter errors as login requirements', async () => {
    const unrelated = new Error('custom 模型需要配置 baseUrl');
    const runLogin = vi.fn();

    await expect(createChatAdapterWithLoginBootstrap(cloneDefaultConfig(), {
      interactive: true,
      hasInitialInput: false,
    }, {
      createAdapter: () => { throw unrelated; },
      runLogin,
      loadConfig: vi.fn(),
      writeLine: vi.fn(),
    })).rejects.toBe(unrelated);

    expect(runLogin).not.toHaveBeenCalled();
  });

  it('returns the original missing-key error when login is cancelled', async () => {
    const missingKey = new MissingProviderApiKeyError('anthropic', 'ANTHROPIC');
    const createAdapter = vi.fn(() => { throw missingKey; });

    await expect(createChatAdapterWithLoginBootstrap(cloneDefaultConfig(), {
      interactive: true,
      hasInitialInput: false,
    }, {
      createAdapter,
      runLogin: vi.fn().mockResolvedValue({ status: 'cancelled' }),
      loadConfig: vi.fn(),
      writeLine: vi.fn(),
    })).rejects.toBe(missingKey);

    expect(createAdapter).toHaveBeenCalledOnce();
  });
});
