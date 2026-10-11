import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerMemoryCommands } from '../../src/commands/memory.js';
import { Command } from 'commander';

const ports = vi.hoisted(() => ({
  loadConfig: vi.fn(), createStore: vi.fn(), createAdapter: vi.fn(),
  resolveBinding: vi.fn(), createFromBinding: vi.fn(), createLlm: vi.fn(),
}));
vi.mock('../../src/utils/config.js', () => ({ loadConfig: ports.loadConfig }));
vi.mock('../../src/ai/memory/store.js', () => ({ createMemoryStoreAsync: ports.createStore }));
vi.mock('../../src/ai/models.js', () => ({ createAdapter: ports.createAdapter, createAdapterFromBinding: ports.createFromBinding }));
vi.mock('../../src/ai/providers/control-plane.js', () => ({ resolveRuntimeModelBinding: ports.resolveBinding }));
vi.mock('../../src/ai/memory/layered-store.js', () => ({ createLLMFromAdapter: ports.createLlm }));

describe('memory command registration', () => {
  it('should register memory command with subcommands', () => {
    const program = new Command();
    registerMemoryCommands(program);

    const memCmd = program.commands.find(c => c.name() === 'memory');
    expect(memCmd).toBeDefined();

    const subcommands = memCmd!.commands.map(c => c.name());
    expect(subcommands).toContain('stats');
    expect(subcommands).toContain('list');
    expect(subcommands).toContain('search');
    expect(subcommands).toContain('compact');
    expect(subcommands).toContain('clear');
  });

  it('stats command should have correct description', () => {
    const program = new Command();
    registerMemoryCommands(program);

    const memCmd = program.commands.find(c => c.name() === 'memory');
    const statsCmd = memCmd!.commands.find(c => c.name() === 'stats');
    expect(statsCmd!.description()).toContain('统计');
  });

  it('search command should require a query argument', () => {
    const program = new Command();
    registerMemoryCommands(program);

    const memCmd = program.commands.find(c => c.name() === 'memory');
    const searchCmd = memCmd!.commands.find(c => c.name() === 'search');
    // Commander stores arguments as registeredArguments
    const args = (searchCmd as any)._args || (searchCmd as any).registeredArguments;
    expect(args.length).toBeGreaterThan(0);
    expect(args[0].name()).toBe('query');
  });
});

describe('actual Commander memory compact handler', () => {
  const config = { memory: { modelId: 'memory-model' }, models: { 'memory-model': {}, 'chat-model': {} } };
  const binding = { wireModel: 'controlled-memory-model' };
  const adapter = { controlledAdapter: true };
  const llm = async () => '{}';
  let store: { compact?: ReturnType<typeof vi.fn>; setLLMFn: ReturnType<typeof vi.fn>; getStats: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> };
  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    store = { compact: vi.fn().mockResolvedValue({}), setLLMFn: vi.fn(), getStats: vi.fn().mockReturnValue({ l0: 8, l1: 8, l2: 6, l3: 10 }), close: vi.fn() };
    ports.loadConfig.mockResolvedValue(config); ports.createStore.mockResolvedValue(store);
    ports.resolveBinding.mockReturnValue(binding); ports.createFromBinding.mockReturnValue(adapter);
    ports.createAdapter.mockReturnValue(adapter); ports.createLlm.mockReturnValue(llm);
  });
  afterEach(() => vi.restoreAllMocks());
  const execute = async () => {
    const program = new Command(); registerMemoryCommands(program);
    await program.parseAsync(['node', 'xiaok', 'memory', 'compact']);
  };
  it('uses the selected memory model through the real binding resolver and preserves user force', async () => {
    await execute();
    expect(ports.resolveBinding).toHaveBeenCalledExactlyOnceWith(config, 'memory-model');
    expect(ports.createFromBinding).toHaveBeenCalledExactlyOnceWith(binding);
    expect(ports.createAdapter).not.toHaveBeenCalled();
    expect(store.setLLMFn).toHaveBeenCalledExactlyOnceWith(llm);
    expect(store.compact).toHaveBeenCalledExactlyOnceWith({ requestSource: 'user', force: true });
    expect(store.close).toHaveBeenCalledTimes(1);
  });
  it.each([undefined, 'not-configured'])('falls back to the main binding for absent or invalid memory selection %s', async modelId => {
    const current = { ...config, memory: { modelId } }; ports.loadConfig.mockResolvedValue(current);
    await execute(); expect(ports.resolveBinding).toHaveBeenCalledExactlyOnceWith(current, undefined);
    expect(store.close).toHaveBeenCalledTimes(1);
  });
  it('closes once after adapter initialization fails without compacting', async () => {
    ports.createFromBinding.mockImplementation(() => { throw Error('controlled-adapter-failure'); });
    await execute(); expect(store.compact).not.toHaveBeenCalled(); expect(store.close).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalledWith('无法初始化模型 adapter:', expect.stringContaining('controlled-adapter-failure'));
  });
  it('closes once and preserves the original compaction rejection', async () => {
    const error = Error('controlled-compaction-failure'); store.compact!.mockRejectedValue(error);
    await expect(execute()).rejects.toBe(error); expect(store.close).toHaveBeenCalledTimes(1);
  });
  it('closes once if post-compaction stats throws', async () => {
    const error = Error('controlled-stats-failure'); store.getStats.mockImplementation(() => { throw error; });
    await expect(execute()).rejects.toBe(error); expect(store.close).toHaveBeenCalledTimes(1);
  });
  it('closes once for a backend without compaction and does not initialize a model', async () => {
    store.compact = undefined; await execute();
    expect(ports.createFromBinding).not.toHaveBeenCalled(); expect(store.close).toHaveBeenCalledTimes(1);
  });
});
