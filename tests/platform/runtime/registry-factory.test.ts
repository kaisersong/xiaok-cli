import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createPlatformRegistryFactory } from '../../../src/platform/runtime/registry-factory.js';
import { PermissionManager } from '../../../src/ai/permissions/manager.js';
import { applySandboxToTools } from '../../../src/platform/sandbox/tool-wrappers.js';
import { buildToolList, ToolRegistry } from '../../../src/ai/tools/index.js';
import type { PlatformRuntimeContext } from '../../../src/platform/runtime/context.js';
import type { ModelAdapter, Tool, ToolDefinition } from '../../../src/types.js';

const mockState = vi.hoisted(() => ({
  tools: [
    { definition: { name: 'Read', description: 'Read file', inputSchema: {} }, execute: async () => '', permission: 'safe' },
    { definition: { name: 'Write', description: 'Write file', inputSchema: {} }, execute: async () => '', permission: 'safe' },
    { definition: { name: 'Edit', description: 'Edit file', inputSchema: {} }, execute: async () => '', permission: 'safe' },
    { definition: { name: 'Bash', description: 'Run bash', inputSchema: {} }, execute: async () => '', permission: 'bash' },
    { definition: { name: 'Grep', description: 'Search', inputSchema: {} }, execute: async () => '', permission: 'safe' },
    { definition: { name: 'Glob', description: 'Find files', inputSchema: {} }, execute: async () => '', permission: 'safe' },
    { definition: { name: 'WebFetch', description: 'Fetch URL', inputSchema: {} }, execute: async () => '', permission: 'safe' },
    { definition: { name: 'WebSearch', description: 'Search web', inputSchema: {} }, execute: async () => '', permission: 'safe' },
    // Simulate CC tools leaking into registry
    { definition: { name: 'Agent', description: 'CC agent', inputSchema: {} }, execute: async () => '', permission: 'safe' },
    { definition: { name: 'TaskCreate', description: 'CC task', inputSchema: {} }, execute: async () => '', permission: 'safe' },
    { definition: { name: 'TaskUpdate', description: 'CC task', inputSchema: {} }, execute: async () => '', permission: 'safe' },
    { definition: { name: 'TaskList', description: 'CC task', inputSchema: {} }, execute: async () => '', permission: 'safe' },
    { definition: { name: 'ExitPlanMode', description: 'CC plan', inputSchema: {} }, execute: async () => '', permission: 'safe' },
  ] as Tool[],
  registries: [] as any[],
}));

// Mock dependencies
vi.mock('./context.js', () => ({
  createPlatformRuntimeContext: vi.fn(),
}));

function mockRegistry(tools: Tool[]) {
  const toolMap = new Map<string, Tool>();
  for (const t of tools) toolMap.set(t.definition.name, t);
  const registry = {
    getRegisteredTool: (name: string) => toolMap.get(name),
    dispose: vi.fn(() => toolMap.clear()),
    unregisterTool: vi.fn((name: string) => toolMap.delete(name)),
    getToolDefinitions: (): ToolDefinition[] => [...toolMap.values()].map(t => t.definition),
    registerTool: vi.fn((tool: Tool) => { toolMap.set(tool.definition.name, tool); }),
    executeTool: vi.fn(async (name: string, input: Record<string, unknown>, context?: unknown) => {
      const tool = toolMap.get(name);
      if (!tool) throw new Error(`unknown mocked tool: ${name}`);
      return tool.execute(input, context as any);
    }),
  };
  mockState.registries.push(registry);
  return registry;
}
vi.mock('../../../src/ai/tools/index.js', () => ({
  buildToolList: vi.fn((_skillTool, _workspace, extraTools = []) => [...mockState.tools, ...extraTools]),
  ToolRegistry: vi.fn().mockImplementation((_opts, tools) => mockRegistry(tools)),
}));

vi.mock('../../../src/platform/sandbox/tool-wrappers.js', () => ({
  applySandboxToTools: vi.fn((tools) => tools),
}));

vi.mock('../../../src/runtime/hooks-runner.js', () => ({
  createHooksRunner: vi.fn(() => ({})),
}));

vi.mock('../../../src/ai/tools/tool-pool.js', () => ({
  mergeToolPools: vi.fn((nonMcp, mcp) => [...nonMcp, ...mcp]),
  isMcpTool: vi.fn(() => false),
}));

function makeMockPlatform(expandAllowedPaths = vi.fn()): PlatformRuntimeContext {
  return {
    customAgents: [],
    pluginRuntime: { hookConfigs: [], agentDirs: [] },
    mcpTools: [],
    sandboxEnforcer: {},
    sandboxPolicy: { expandAllowedPaths },
    capabilityRegistry: { register: vi.fn() },
    worktreeManager: undefined,
    lspManager: undefined,
    teamService: undefined,
    createBackgroundRunner: vi.fn(() => ({ dispose: vi.fn(async () => ({ settled: true, pendingJobs: [] })) })),
    createReminderApi: vi.fn(() => undefined),
    mcpReady: Promise.resolve(),
    onMcpToolsChanged: vi.fn(() => () => undefined),
  } as unknown as PlatformRuntimeContext;
}

function getLastSandboxDeniedCallback() {
  const calls = vi.mocked(applySandboxToTools).mock.calls;
  const options = calls.at(-1)?.[2] as {
    onSandboxDenied?: (deniedPath: string, toolName: string) => Promise<{ shouldProceed: boolean }> | { shouldProceed: boolean };
  } | undefined;
  if (!options?.onSandboxDenied) {
    throw new Error('expected sandbox denial callback to be registered');
  }
  return options.onSandboxDenied;
}

describe('registry-factory sandbox auto mode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('auto-expands sandbox denials in auto mode without prompting', async () => {
    const expandAllowedPaths = vi.fn();
    const onSandboxDenied = vi.fn(async () => ({ shouldProceed: false }));
    const factory = createPlatformRegistryFactory({
      platform: makeMockPlatform(expandAllowedPaths),
      source: 'chat',
      sessionId: 'test-session',
      adapter: () => ({ name: 'test', generate: vi.fn(), stream: vi.fn() } as unknown as ModelAdapter),
      permissionManager: new PermissionManager({ mode: 'auto' }),
      onSandboxDenied,
      buildSystemPrompt: async () => 'prompt',
    });

    factory.createRegistry('/test/cwd');
    const result = await getLastSandboxDeniedCallback()('/external/docs/file.md', 'read');

    expect(result).toEqual({ shouldProceed: true });
    expect(expandAllowedPaths).toHaveBeenCalledWith(['/external/docs/file.md']);
    expect(onSandboxDenied).not.toHaveBeenCalled();
  });

  it('lets the sandbox enforcer own outside-cwd checks for workspace tools', () => {
    const factory = createPlatformRegistryFactory({
      platform: makeMockPlatform(),
      source: 'chat',
      sessionId: 'test-session',
      adapter: () => ({ name: 'test', generate: vi.fn(), stream: vi.fn() } as unknown as ModelAdapter),
      permissionManager: new PermissionManager({ mode: 'auto' }),
      buildSystemPrompt: async () => 'prompt',
    });

    factory.createRegistry('/test/cwd');

    expect(vi.mocked(buildToolList)).toHaveBeenCalledWith(
      undefined,
      { cwd: '/test/cwd', allowOutsideCwd: true },
      expect.any(Array),
    );
  });

  it('delegates sandbox denials outside auto mode', async () => {
    const expandAllowedPaths = vi.fn();
    const onSandboxDenied = vi.fn(async () => ({ shouldProceed: false }));
    const factory = createPlatformRegistryFactory({
      platform: makeMockPlatform(expandAllowedPaths),
      source: 'chat',
      sessionId: 'test-session',
      adapter: () => ({ name: 'test', generate: vi.fn(), stream: vi.fn() } as unknown as ModelAdapter),
      permissionManager: new PermissionManager({ mode: 'default' }),
      onSandboxDenied,
      buildSystemPrompt: async () => 'prompt',
    });

    factory.createRegistry('/test/cwd');
    const result = await getLastSandboxDeniedCallback()('/external/docs/file.md', 'read');

    expect(result).toEqual({ shouldProceed: false });
    expect(expandAllowedPaths).not.toHaveBeenCalled();
    expect(onSandboxDenied).toHaveBeenCalledWith('/external/docs/file.md', 'read');
  });
});

describe('registry-factory CC tool filtering', () => {
  let factory: ReturnType<typeof createPlatformRegistryFactory>;

  beforeEach(() => {
    vi.clearAllMocks();
    const mockPlatform = {
      customAgents: [],
      pluginRuntime: { hookConfigs: [], agentDirs: [] },
      mcpTools: [],
      sandboxEnforcer: undefined,
      sandboxPolicy: {},
      capabilityRegistry: { register: vi.fn() },
      worktreeManager: undefined,
      lspManager: undefined,
      teamService: undefined,
      createBackgroundRunner: vi.fn(() => ({ dispose: vi.fn(async () => ({ settled: true, pendingJobs: [] })) })),
      createReminderApi: vi.fn(() => undefined),
      mcpReady: Promise.resolve(),
      onMcpToolsChanged: vi.fn(() => () => undefined),
    } as unknown as PlatformRuntimeContext;

    factory = createPlatformRegistryFactory({
      platform: mockPlatform,
      source: 'chat',
      sessionId: 'test-session',
      adapter: () => ({ name: 'test', generate: vi.fn(), stream: vi.fn() } as unknown as ModelAdapter),
      buildSystemPrompt: async () => 'prompt',
    });
  });

  it('excludes Agent tool from registry', () => {
    const registry = factory.createRegistry('/test/cwd');
    const names = registry.getToolDefinitions().map(t => t.name);
    expect(names).not.toContain('Agent');
  });

  it('excludes Task* tools from registry', () => {
    const registry = factory.createRegistry('/test/cwd');
    const names = registry.getToolDefinitions().map(t => t.name);
    expect(names).not.toContain('TaskCreate');
    expect(names).not.toContain('TaskUpdate');
    expect(names).not.toContain('TaskList');
    expect(names).not.toContain('TaskGet');
    expect(names).not.toContain('TaskOutput');
    expect(names).not.toContain('TaskStop');
  });

  it('excludes plan mode tools from registry', () => {
    const registry = factory.createRegistry('/test/cwd');
    const names = registry.getToolDefinitions().map(t => t.name);
    expect(names).not.toContain('ExitPlanMode');
    expect(names).not.toContain('EnterPlanMode');
  });

  it('excludes worktree tools from registry', () => {
    const registry = factory.createRegistry('/test/cwd');
    const names = registry.getToolDefinitions().map(t => t.name);
    expect(names).not.toContain('ExitWorktree');
    expect(names).not.toContain('EnterWorktree');
  });

  it('excludes CC Skill tool from registry', () => {
    const registry = factory.createRegistry('/test/cwd');
    const names = registry.getToolDefinitions().map(t => t.name);
    expect(names).not.toContain('Skill');
  });

  it('preserves xiaok builtin tools', () => {
    const registry = factory.createRegistry('/test/cwd');
    const names = registry.getToolDefinitions().map(t => t.name);
    expect(names).toContain('Read');
    expect(names).toContain('Write');
    expect(names).toContain('Edit');
    expect(names).toContain('Bash');
    expect(names).toContain('Grep');
    expect(names).toContain('Glob');
    expect(names).toContain('WebFetch');
    expect(names).toContain('WebSearch');
  });

  it('filtering does not affect allowedTools parameter', () => {
    const registry = factory.createRegistry('/test/cwd', ['Read', 'Bash', 'Agent']);
    const names = registry.getToolDefinitions().map(t => t.name);
    // Agent should be filtered out by both CC filter AND allowedTools filter
    expect(names).not.toContain('Agent');
    // Read and Bash should be present
    expect(names).toContain('Read');
    expect(names).toContain('Bash');
  });
});

describe('registry-factory allowedTools filtering', () => {
  let factory: ReturnType<typeof createPlatformRegistryFactory>;

  beforeEach(() => {
    vi.clearAllMocks();
    const mockPlatform = {
      customAgents: [],
      pluginRuntime: { hookConfigs: [], agentDirs: [] },
      mcpTools: [],
      sandboxEnforcer: undefined,
      sandboxPolicy: {},
      capabilityRegistry: { register: vi.fn() },
      worktreeManager: undefined,
      lspManager: undefined,
      teamService: undefined,
      createBackgroundRunner: vi.fn(() => ({ dispose: vi.fn(async () => ({ settled: true, pendingJobs: [] })) })),
      createReminderApi: vi.fn(() => undefined),
      mcpReady: Promise.resolve(),
      onMcpToolsChanged: vi.fn(() => () => undefined),
    } as unknown as PlatformRuntimeContext;

    factory = createPlatformRegistryFactory({
      platform: mockPlatform,
      source: 'chat',
      sessionId: 'test-session',
      adapter: () => ({ name: 'test', generate: vi.fn(), stream: vi.fn() } as unknown as ModelAdapter),
      buildSystemPrompt: async () => 'prompt',
    });
  });

  it('filters tools to allowedTools when specified', () => {
    const registry = factory.createRegistry('/test/cwd', ['Read', 'Bash']);
    const names = registry.getToolDefinitions().map(t => t.name);
    expect(names).toContain('Read');
    expect(names).toContain('Bash');
    expect(names).not.toContain('Write');
    expect(names).not.toContain('Edit');
  });

  it('includes all tools when allowedTools is empty', () => {
    const registry = factory.createRegistry('/test/cwd', []);
    const names = registry.getToolDefinitions().map(t => t.name);
    expect(names).toContain('Read');
    expect(names).toContain('Write');
  });

  it('includes all tools when allowedTools is undefined', () => {
    const registry = factory.createRegistry('/test/cwd');
    const names = registry.getToolDefinitions().map(t => t.name);
    expect(names).toContain('Read');
    expect(names).toContain('Write');
  });
});

describe('registry-factory multi-agent surface', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.registries.length = 0;
  });

  function makeFactory(source: 'chat' | 'yzj') {
    return createPlatformRegistryFactory({
      platform: makeMockPlatform(),
      source,
      sessionId: 'test-session',
      adapter: () => ({ name: 'test', generate: vi.fn(), stream: vi.fn() } as unknown as ModelAdapter),
      buildSystemPrompt: async () => 'prompt',
    });
  }

  it('registers the full control plane for the chat root agent', () => {
    const names = makeFactory('chat').createRegistry('/test/cwd').getToolDefinitions().map((tool) => tool.name);
    expect(names).toEqual(expect.arrayContaining([
      'spawn_agent', 'send_message', 'followup_task', 'wait_agent',
      'list_agents', 'interrupt_agent', 'close_agent',
    ]));
  });

  it('does not give an untracked child unusable coordinator tools', () => {
    const names = makeFactory('chat')
      .createRegistry('/test/cwd', ['Read'], 'agent_child', { parentDepth: 1 })
      .getToolDefinitions().map((tool) => tool.name);
    expect(names).toEqual(['Read']);
    for (const name of ['spawn_agent', 'followup_task', 'interrupt_agent', 'close_agent', 'send_message', 'wait_agent', 'list_agents']) {
      expect(names).not.toContain(name);
    }
  });

  it('does not expose session multi-agent tools to the yzj channel', () => {
    const names = makeFactory('yzj').createRegistry('/test/cwd').getToolDefinitions().map((tool) => tool.name);
    expect(names).not.toEqual(expect.arrayContaining([
      'spawn_agent', 'send_message', 'followup_task', 'wait_agent',
      'list_agents', 'interrupt_agent', 'close_agent',
    ]));
  });

  it('unregisters a closed child registry from MCP refresh and unsubscribes on factory dispose', async () => {
    let publishMcpTools: ((tools: Tool[]) => void) | undefined;
    const unsubscribe = vi.fn();
    const platform = makeMockPlatform();
    platform.onMcpToolsChanged = vi.fn((listener) => {
      publishMcpTools = listener;
      return unsubscribe;
    });
    const adapter = {
      async *stream() {
        yield { type: 'text', delta: 'child done' } as const;
        yield { type: 'done' } as const;
      },
    } as unknown as ModelAdapter;
    const factory = createPlatformRegistryFactory({
      platform,
      source: 'chat',
      sessionId: 'test-session',
      adapter: () => adapter,
      buildSystemPrompt: async () => 'prompt',
    });
    const root = factory.createRegistry('/test/cwd') as unknown as ReturnType<typeof mockRegistry>;

    const child = JSON.parse(await root.executeTool('spawn_agent', {
      task_name: 'child', message: 'run', fork_context: false,
    })) as { id: string };
    await root.executeTool('wait_agent', { targets: [child.id], timeout_ms: 10_000 });
    await root.executeTool('close_agent', { target: child.id });

    expect(mockState.registries).toHaveLength(2);
    const [rootRegistry, childRegistry] = mockState.registries as Array<ReturnType<typeof mockRegistry>>;
    rootRegistry.registerTool.mockClear();
    childRegistry.registerTool.mockClear();
    publishMcpTools?.([{
      definition: { name: 'mcp__late__probe', description: 'probe', inputSchema: {} },
      permission: 'safe',
      execute: async () => 'ok',
    }]);

    expect(rootRegistry.registerTool).toHaveBeenCalledOnce();
    expect(childRegistry.registerTool).not.toHaveBeenCalled();
    await factory.dispose();
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(vi.mocked(ToolRegistry)).toHaveBeenCalledTimes(2);
  });

  it.each(['interrupt_agent', 'close_agent'] as const)('forwards %s cancellation through named initialization before registry creation', async (stopTool) => {
    let finishPrompt!: (value: string) => void;
    const promptGate = new Promise<string>((resolve) => { finishPrompt = resolve; });
    const buildSystemPrompt = vi.fn(() => promptGate);
    const adapter = vi.fn(() => ({ async *stream() { yield { type: 'done' as const }; } } as unknown as ModelAdapter));
    const platform = makeMockPlatform();
    const releaseWorktree = vi.fn(async () => {});
    const allocateWorktree = vi.fn(async (input) => ({ ...input, path: process.cwd(), created: true }));
    platform.worktreeManager = { allocate: allocateWorktree, release: releaseWorktree } as unknown as PlatformRuntimeContext['worktreeManager'];
    platform.customAgents = [{ name: 'initializing', systemPrompt: '', source: 'builtin', isolation: 'worktree', cleanup: 'delete' }];
    const factory = createPlatformRegistryFactory({ platform, source: 'chat',
      sessionId: 'initialization-cancellation', adapter, buildSystemPrompt,
    });
    const root = factory.createRegistry(process.cwd()) as unknown as ReturnType<typeof mockRegistry>;
    const child = JSON.parse(await root.executeTool('spawn_agent', {
      task_name: 'initializing', agent: 'initializing', message: 'must not start after stop', fork_context: false,
    })) as { id: string };
    await vi.waitFor(() => expect(buildSystemPrompt).toHaveBeenCalledOnce());
    const stopped = root.executeTool(stopTool, { target: child.id });
    finishPrompt('late prompt');
    await stopped;
    try {
      await vi.waitFor(async () => {
        const agents = JSON.parse(await root.executeTool('list_agents', {}));
        expect(agents.find((item: { id: string }) => item.id === child.id).executionActive).toBe(false);
      });
      expect(adapter).not.toHaveBeenCalled();
      expect(mockState.registries).toHaveLength(1);
      expect(allocateWorktree).toHaveBeenCalledOnce();
      expect(releaseWorktree).toHaveBeenCalledExactlyOnceWith(process.cwd());
      if (stopTool === 'interrupt_agent') {
        await root.executeTool('followup_task', { target: child.id, message: 'fresh followup' });
        await vi.waitFor(() => expect(adapter).toHaveBeenCalledOnce());
        expect(buildSystemPrompt).toHaveBeenCalledTimes(2);
      }
    } finally {
      await factory.dispose();
    }
  });
});

it('routes reminder delivery through the frontend sink instead of raw stdout', async () => {
  const platform = makeMockPlatform();
  let sink!: (message: string) => void;
  vi.mocked(platform.createReminderApi).mockReturnValue({
    start: vi.fn(async () => {}),
    registerInChatSink: vi.fn((_sessionId, callback) => { sink = callback; return () => {}; }),
  } as any);
  const notifyReminder = vi.fn();
  const factory = createPlatformRegistryFactory({ platform, source: 'chat', sessionId: 'reminder-test',
    adapter: () => ({} as ModelAdapter), buildSystemPrompt: async () => '', notifyReminder });
  const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  try {
    sink('download complete');
    expect(notifyReminder).toHaveBeenCalledWith('download complete');
    expect(stdout).not.toHaveBeenCalled();
  } finally { stdout.mockRestore(); await factory.dispose(); }
});
