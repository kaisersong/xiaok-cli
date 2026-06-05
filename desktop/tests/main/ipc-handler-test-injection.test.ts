import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  IPC_SCHEMA_REGISTRY,
  registerIpcHandler,
  resetIpcSchemaRegistryForTests,
  setIpcMainForTests,
  setIpcMainImpl,
} from '../../electron/ipc-runtime.js';
import { z } from 'zod';

function createFakeIpcMain() {
  const handlers = new Map<string, Function>();
  return {
    handle: vi.fn((channel: string, handler: Function) => {
      handlers.set(channel, handler);
    }),
    invoke: (channel: string, event: unknown, raw: unknown) => {
      const fn = handlers.get(channel);
      if (!fn) throw new Error(`No handler for ${channel}`);
      return fn(event, raw);
    },
    handlers,
  };
}

describe('ipc-runtime registerIpcHandler', () => {
  let fakeIpcMain: ReturnType<typeof createFakeIpcMain>;

  afterEach(() => {
    resetIpcSchemaRegistryForTests();
  });

  function setup() {
    fakeIpcMain = createFakeIpcMain();
    setIpcMainForTests(fakeIpcMain as any);
  }

  it('registers a handler and adds it to IPC_SCHEMA_REGISTRY', () => {
    setup();
    registerIpcHandler({
      channel: 'test:echo',
      input: z.object({ msg: z.string() }),
      output: z.object({ reply: z.string() }),
      sourceFile: 'test-file.ts',
      rolloutRound: 1,
      handler: async (input) => ({ reply: input.msg }),
    });

    expect(IPC_SCHEMA_REGISTRY.has('test:echo')).toBe(true);
    expect(IPC_SCHEMA_REGISTRY.get('test:echo')!.sourceFile).toBe('test-file.ts');
    expect(IPC_SCHEMA_REGISTRY.get('test:echo')!.rolloutRound).toBe(1);
    expect(fakeIpcMain.handle).toHaveBeenCalledWith('test:echo', expect.any(Function));
  });

  it('throws on duplicate channel registration', () => {
    setup();
    registerIpcHandler({
      channel: 'test:dupe',
      input: z.object({}),
      output: z.object({}),
      sourceFile: 'first.ts',
      rolloutRound: 1,
      handler: async () => ({}),
    });

    expect(() =>
      registerIpcHandler({
        channel: 'test:dupe',
        input: z.object({}),
        output: z.object({}),
        sourceFile: 'second.ts',
        rolloutRound: 1,
        handler: async () => ({}),
      }),
    ).toThrow('registered twice');
  });

  it('validates input with Zod schema', async () => {
    setup();
    registerIpcHandler({
      channel: 'test:validated',
      input: z.object({ count: z.number() }),
      output: z.object({ doubled: z.number() }),
      sourceFile: 'test.ts',
      rolloutRound: 2,
      handler: async (input) => ({ doubled: input.count * 2 }),
    });

    const result = await fakeIpcMain.invoke('test:validated', {}, { count: 5 });
    expect(result).toEqual({ doubled: 10 });

    await expect(
      fakeIpcMain.invoke('test:validated', {}, { count: 'not a number' }),
    ).rejects.toThrow();
  });

  it('setIpcMainForTests injects a fake ipcMain', () => {
    setup();
    registerIpcHandler({
      channel: 'test:injected',
      input: z.void(),
      output: z.string(),
      sourceFile: 'injection.ts',
      rolloutRound: 1,
      handler: async () => 'injected',
    });

    expect(fakeIpcMain.handlers.has('test:injected')).toBe(true);
  });

  it('resetIpcSchemaRegistryForTests clears the registry', () => {
    setup();
    registerIpcHandler({
      channel: 'test:clear',
      input: z.void(),
      output: z.void(),
      sourceFile: 'clear.ts',
      rolloutRound: 1,
      handler: async () => undefined,
    });

    expect(IPC_SCHEMA_REGISTRY.size).toBe(1);
    resetIpcSchemaRegistryForTests();
    expect(IPC_SCHEMA_REGISTRY.size).toBe(0);
  });

  it('records riskTags in registry entry', () => {
    setup();
    registerIpcHandler({
      channel: 'test:risky',
      input: z.object({}),
      output: z.object({}),
      sourceFile: 'risky.ts',
      rolloutRound: 3,
      riskTags: ['fs-read', 'capability-token'],
      handler: async () => ({}),
    });

    expect(IPC_SCHEMA_REGISTRY.get('test:risky')!.riskTags).toEqual(['fs-read', 'capability-token']);
  });
});
