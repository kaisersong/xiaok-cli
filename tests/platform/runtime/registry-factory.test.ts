import { drainCliRegistryWriters } from '../../../src/commands/chat-owned-writers.js';
import { FileSessionStore } from '../../../src/ai/runtime/session-store/file-store.js';
import { createSessionExecutionAuthority, createSessionExecutionContext } from '../../../src/ai/runtime/session-store/execution-authority.js';
import { createCompoundSessionJournal } from '../../../src/runtime/sol-pi/compound-session-journal.js';
import { createCompoundExecutionCoordinator } from '../../../src/runtime/sol-pi/compound-execution-coordinator.js';
import { createReadTool } from '../../../src/ai/tools/read.js';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createPlatformRegistryFactory } from '../../../src/platform/runtime/registry-factory.js';
import { PermissionManager } from '../../../src/ai/permissions/manager.js';
import { applySandboxToTools } from '../../../src/platform/sandbox/tool-wrappers.js';
import { buildToolList, ToolRegistry } from '../../../src/ai/tools/index.js';
import type { PlatformRuntimeContext } from '../../../src/platform/runtime/context.js';
import type { ModelAdapter, Tool, ToolDefinition } from '../../../src/types.js';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBackgroundRunner } from '../../../src/platform/agents/background-runner.js';

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

vi.mock('../../../src/platform/sandbox/tool-wrappers.js', async importOriginal => ({
  ...await importOriginal<typeof import('../../../src/platform/sandbox/tool-wrappers.js')>(),
  applySandboxToTools: vi.fn((tools) => tools),
}));

vi.mock('../../../src/runtime/hooks-runner.js', () => ({
  createHooksRunner: vi.fn(() => ({ closeAndDrain: () => Promise.resolve() })),
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
    createBackgroundRunner: vi.fn(() => ({ dispose: vi.fn(async () => ({ settled: true, pendingJobs: [] })), waitForDisposedResources: vi.fn(async () => {}) })),
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

  it.each(['auto', 'yolo'] as const)('auto-expands sandbox denials in %s mode without prompting', async mode => {
    const expandAllowedPaths = vi.fn();
    const onSandboxDenied = vi.fn(async () => ({ shouldProceed: false }));
    const factory = createPlatformRegistryFactory({
      platform: makeMockPlatform(expandAllowedPaths),
      source: 'chat',
      sessionId: 'test-session',
      adapter: () => ({ name: 'test', generate: vi.fn(), stream: vi.fn() } as unknown as ModelAdapter),
      permissionManager: new PermissionManager({ mode }),
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
      { cwd: '/test/cwd', allowOutsideCwd: true, outsideCwdGuard: expect.any(Function) },
      expect.any(Array),
      expect.any(Map),
      { isYolo: expect.any(Function) },
    );
  });

  it('shares live YOLO authority with newly created child executors and revokes it on exit', () => {
    const manager = new PermissionManager({ mode: 'yolo' });
    const factory = createPlatformRegistryFactory({
      platform: makeMockPlatform(), source: 'chat', sessionId: 'test-session',
      adapter: () => ({ name: 'test', generate: vi.fn(), stream: vi.fn() } as unknown as ModelAdapter),
      permissionManager: manager, buildSystemPrompt: async () => 'prompt',
    });
    factory.createRegistry('/test/cwd');
    factory.createRegistry('/test/cwd', undefined, 'child');
    const authorities = vi.mocked(buildToolList).mock.calls.slice(-2).map(args => args[4]);
    expect(authorities).toHaveLength(2);
    for (const authority of authorities) expect(authority?.isYolo?.()).toBe(true);
    manager.setMode('auto');
    for (const authority of authorities) expect(authority?.isYolo?.()).toBe(false);
  });

  it('routes outside-cwd tool paths through the sandbox policy check', () => {
    const checkPath = vi.fn(() => ({ allowed: false, reason: 'path is outside allowlist' }));
    const platform = makeMockPlatform();
    (platform as unknown as { sandboxPolicy: Record<string, unknown> }).sandboxPolicy.checkPath = checkPath;
    const factory = createPlatformRegistryFactory({
      platform,
      source: 'chat',
      sessionId: 'test-session',
      adapter: () => ({ name: 'test', generate: vi.fn(), stream: vi.fn() } as unknown as ModelAdapter),
      permissionManager: new PermissionManager({ mode: 'default' }),
      buildSystemPrompt: async () => 'prompt',
    });

    factory.createRegistry('/test/cwd');
    const toolOptions = vi.mocked(buildToolList).mock.calls.at(-1)?.[1] as { outsideCwdGuard?: (p: string) => { allowed: boolean } };
    expect(toolOptions.outsideCwdGuard?.('/elsewhere/file.md')).toEqual({ allowed: false, reason: 'path is outside allowlist' });
    expect(checkPath).toHaveBeenCalledWith('/elsewhere/file.md');
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
      createBackgroundRunner: vi.fn(() => ({ dispose: vi.fn(async () => ({ settled: true, pendingJobs: [] })), waitForDisposedResources: vi.fn(async () => {}) })),
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
      createBackgroundRunner: vi.fn(() => ({ dispose: vi.fn(async () => ({ settled: true, pendingJobs: [] })), waitForDisposedResources: vi.fn(async () => {}) })),
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

  it('publishes one original disposal before unsubscribe reenters it', async () => {
    const platform = makeMockPlatform();
    let nested: Promise<void> | undefined;
    const unsubscribe = vi.fn(() => { nested = factory.dispose(); });
    platform.onMcpToolsChanged = vi.fn(() => unsubscribe);
    const factory = createPlatformRegistryFactory({ platform, source: 'chat', sessionId: 'reentrant',
      adapter: () => ({} as ModelAdapter), buildSystemPrompt: async () => '' });
    await expect(factory.waitForDisposedResources()).rejects.toThrow('platform_cleanup_not_started');
    const stopping = factory.dispose();
    expect(factory.dispose()).toBe(stopping);
    await stopping;
    expect(nested).toBe(stopping);
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(() => factory.createRegistry(process.cwd())).toThrow('disposed');
    await factory.waitForDisposedResources();
  });

  it('holds physical cleanup until the actual child settles even when background drain rejects', async () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'registry-physical-'));
    let finishPrompt!: (value: string) => void;
    let rejectBackground!: (error: Error) => void;
    const prompt = new Promise<string>((resolve) => { finishPrompt = resolve; });
    const background = new Promise<void>((_resolve, reject) => { rejectBackground = reject; });
    const failure = new Error('background physical rejection');
    const runner = createBackgroundRunner({ rootDir, shutdownTimeoutMs: 5, notify: vi.fn(),
      execute: async () => { await background; return { ok: true }; } });
    const platform = makeMockPlatform();
    platform.createBackgroundRunner = vi.fn(() => runner);
    platform.customAgents = [{ name: 'gated', systemPrompt: '', source: 'builtin' }];
    const buildSystemPrompt = vi.fn(() => prompt);
    const factory = createPlatformRegistryFactory({ platform, source: 'chat', sessionId: 'physical',
      adapter: () => ({} as ModelAdapter), buildSystemPrompt });
    try {
      await runner.start({ sessionId: 'physical', source: 'chat', input: 'run' });
      const root = factory.createRegistry(process.cwd()) as unknown as ReturnType<typeof mockRegistry>;
      await root.executeTool('spawn_agent', { task_name: 'gated', agent: 'gated', message: 'run', fork_context: false });
      await vi.waitFor(() => expect(buildSystemPrompt).toHaveBeenCalledOnce());
      await factory.dispose();
      const physical = factory.waitForDisposedResources();
      let settled = false;
      void physical.then(() => { settled = true; }, () => { settled = true; });
      rejectBackground(failure);
      await new Promise(setImmediate);
      expect(settled).toBe(false);
      finishPrompt('done');
      await expect(physical).rejects.toBeInstanceOf(AggregateError);
    } finally {
      finishPrompt('done');
      rejectBackground(failure);
      await factory.dispose();
      rmSync(rootDir, { recursive: true, force: true });
    }
  });

  it('rejects physical completion when the actual child worktree cleanup fails', async () => {
    let finishPrompt!: (value: string) => void;
    const prompt = new Promise<string>((resolve) => { finishPrompt = resolve; });
    const platform = makeMockPlatform();
    const release = vi.fn(async () => { throw new Error('actual worktree cleanup failed'); });
    platform.worktreeManager = { allocate: vi.fn(async (input) => ({ ...input, path: process.cwd(), created: true })),
      release } as unknown as PlatformRuntimeContext['worktreeManager'];
    platform.customAgents = [{ name: 'gated', systemPrompt: '', source: 'builtin', isolation: 'worktree', cleanup: 'delete' }];
    const buildSystemPrompt = vi.fn(() => prompt);
    const factory = createPlatformRegistryFactory({ platform, source: 'chat', sessionId: 'failed-child',
      adapter: () => ({} as ModelAdapter), buildSystemPrompt });
    try {
      const root = factory.createRegistry(process.cwd()) as unknown as ReturnType<typeof mockRegistry>;
      await root.executeTool('spawn_agent', { task_name: 'gated', agent: 'gated', message: 'run', fork_context: false });
      await vi.waitFor(() => expect(buildSystemPrompt).toHaveBeenCalledOnce());
      const disposal = factory.dispose();
      // Let the factory publish its shutdown before releasing initialization.
      await Promise.resolve();
      await Promise.resolve();
      finishPrompt('late prompt');
      await disposal;
      await expect(factory.waitForDisposedResources()).rejects.toMatchObject({ errors: expect.arrayContaining([
        expect.objectContaining({ message: 'multi_agent_cleanup_unconfirmed' }),
      ]) });
      expect(release).toHaveBeenCalledExactlyOnceWith(process.cwd());
    } finally { finishPrompt('late prompt'); await factory.dispose(); }
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


it.each([false, true])('CLI waits for the original factory physical writer before closing the actual compound coordinator (late rejection=%s)', async rejected => {
  if (process.platform === 'win32') return verifyWindowsFactoryPhysicalBarrier(rejected);
  const rootDir=mkdtempSync(join(tmpdir(),'cli-registry-order-'));
  let releaseBackground!:()=>void,enteredBackground!:()=>void,enteredRead!:()=>void;
  const backgroundGate=new Promise<void>(r=>releaseBackground=r),backgroundEntered=new Promise<void>(r=>enteredBackground=r),readEntered=new Promise<void>(r=>enteredRead=r);
  const failure=Error('original background write rejected after shutdown');
  const runner=createBackgroundRunner({rootDir:join(rootDir,'jobs'),shutdownTimeoutMs:5,notify:()=>{},execute:async()=>{
    enteredBackground();await backgroundGate;if(rejected)throw failure;return{ok:true};
  }});
  const platform=makeMockPlatform();platform.createBackgroundRunner=()=>runner;
  const factory=createPlatformRegistryFactory({platform,source:'chat',sessionId:'root',adapter:()=>({} as ModelAdapter),buildSystemPrompt:async()=>''});
  const store=new FileSessionStore(join(rootDir,'sessions')),sessionId='root';
  await store.save({sessionId,cwd:rootDir,createdAt:1,updatedAt:1,lineage:[],messages:[],usage:{inputTokens:0,outputTokens:0},compactions:[],memoryRefs:[],approvalRefs:[],backgroundJobRefs:[]});
  const authority=createSessionExecutionAuthority({root:join(rootDir,'sessions'),sessionIdentity:sessionId,hostContext:createSessionExecutionContext({requestSource:'user',ownerId:'owner',scopeId:'cli-test'})});
  const journal=createCompoundSessionJournal({store,root:join(rootDir,'sessions'),sessionIdentity:sessionId,ownerId:'owner',scopeId:'cli-test',requestSource:'agent',assertCurrent:()=>{}});
  const file=join(rootDir,'source');writeFileSync(file,'original bytes');
  const read=createReadTool({cwd:rootDir}),nativeRead=read.execute;let compoundAborted=false;
  read.execute=async(input,context)=>{
    enteredRead();const signal=context!.signal;
    await new Promise<void>(resolve=>{signal!.addEventListener('abort',()=>{compoundAborted=true;resolve();},{once:true});});
    signal!.throwIfAborted();return nativeRead(input,context);
  };
  const compound=createCompoundExecutionCoordinator({journal,authority,sessionIdentity:sessionId,assertCurrent:()=>{},getPermissionRevision:()=>0,readonlyTools:[read],fileTools:[]});
  const actual=await vi.importActual<typeof import('../../../src/ai/tools/index.js')>('../../../src/ai/tools/index.js');
  const registry=new actual.ToolRegistry({permissionManager:new PermissionManager({mode:'auto'}),compoundExecution:compound},[read]);
  const work=registry.executeTool('read',{file_path:file},{taskId:'task',session:(await store.load(sessionId))!,messages:[],systemPrompt:'',toolDefinitions:[],hostProviderInvocationId:'provider',toolInvocationId:'original'});
  void work.catch(()=>{});
  try {
    await Promise.race([readEntered,work.then(()=>{throw Error('read finished before actual gate');},error=>{throw error;})]);await runner.start({sessionId,source:'chat',input:'hold original background writer'});await backgroundEntered;
    await factory.dispose();
    const drain=drainCliRegistryWriters(factory,compound);void drain.catch(()=>{});
    await new Promise(setImmediate);
    expect(compoundAborted).toBe(false);
    releaseBackground();
    if(rejected)await expect(drain).rejects.toBeInstanceOf(AggregateError);else await drain;
    expect(compoundAborted).toBe(true);await expect(work).rejects.toBeInstanceOf(DOMException);
  }finally{
    releaseBackground();await factory.dispose();await runner.waitForDisposedResources().catch(()=>{});
    await compound.dispose().catch(()=>{});await work.catch(()=>{});registry.dispose();authority.dispose();rmSync(rootDir,{recursive:true,force:true});
  }
},20000);


/** Windows proves unsupported admission and the same physical factory barrier;
 * it does not claim that directory durability or an admitted native read exists. */
async function verifyWindowsFactoryPhysicalBarrier(rejected: boolean): Promise<void> {
  const rootDir=realpathSync(mkdtempSync(join(tmpdir(),'cli-registry-win-order-'))),sessionId='root';
  let releaseBackground:()=>void=()=>{},enteredBackground:()=>void=()=>{};
  const backgroundGate=new Promise<void>(resolve=>{releaseBackground=resolve;}),backgroundEntered=new Promise<void>(resolve=>{enteredBackground=resolve;});
  const failure=Error('original background write rejected after shutdown');
  const runner=createBackgroundRunner({rootDir:join(rootDir,'jobs'),shutdownTimeoutMs:5,notify:()=>{},execute:async()=>{
    enteredBackground();await backgroundGate;if(rejected)throw failure;return {ok:true};
  }});
  const platform=makeMockPlatform();platform.createBackgroundRunner=()=>runner;
  const factory=createPlatformRegistryFactory({platform,source:'chat',sessionId,adapter:()=>({} as ModelAdapter),buildSystemPrompt:async()=>''});
  let authority:ReturnType<typeof createSessionExecutionAuthority>|undefined;
  let compound:ReturnType<typeof createCompoundExecutionCoordinator>|undefined;
  let registry:ToolRegistry|undefined,work:Promise<string>|undefined;
  const expectedFailures=new Set<unknown>();
  let restoreRead:(()=>void)|undefined;
  const outcome=async<T>(promise:Promise<T>)=>promise.then(value=>({ok:true as const,value}), (error:unknown)=>({ok:false as const,error}));
  try {
    const store=new FileSessionStore(join(rootDir,'sessions'));
    await store.save({sessionId,cwd:rootDir,createdAt:1,updatedAt:1,lineage:[],messages:[],usage:{inputTokens:0,outputTokens:0},compactions:[],memoryRefs:[],approvalRefs:[],backgroundJobRefs:[]});
    authority=createSessionExecutionAuthority({root:join(rootDir,'sessions'),sessionIdentity:sessionId,hostContext:createSessionExecutionContext({requestSource:'user',ownerId:'owner',scopeId:'cli-test'})});
    const journal=createCompoundSessionJournal({store,root:join(rootDir,'sessions'),sessionIdentity:sessionId,ownerId:'owner',scopeId:'cli-test',requestSource:'agent',assertCurrent:()=>{}});
    const file=join(rootDir,'source');writeFileSync(file,'original bytes');
    const read=createReadTool({cwd:rootDir}),readObserved=vi.spyOn(read,'execute');
    restoreRead=()=>readObserved.mockRestore();
    const coordinator=createCompoundExecutionCoordinator({journal,authority,sessionIdentity:sessionId,assertCurrent:()=>{},getPermissionRevision:()=>0,readonlyTools:[read],fileTools:[]});
    compound=coordinator;
    const actual=await vi.importActual<typeof import('../../../src/ai/tools/index.js')>('../../../src/ai/tools/index.js');
    registry=new actual.ToolRegistry({permissionManager:new PermissionManager({mode:'auto'}),compoundExecution:coordinator},[read]);
    const session=await store.load(sessionId);if(!session)throw Error('original Windows session missing');
    const context={taskId:'task',session,messages:[],systemPrompt:'',toolDefinitions:[],hostProviderInvocationId:'provider',toolInvocationId:'original'};
    work=registry.executeTool('read',{file_path:file},context);
    const admission=await outcome(work);
    expect(admission.ok).toBe(false);if(admission.ok)throw Error('Windows durability unexpectedly admitted the read');
    expect(admission.error).toBeInstanceOf(Error);
    expect(admission.error).toHaveProperty('message','directory sync durability unsupported on Windows');
    expectedFailures.add(admission.error);
    expect(readObserved).not.toHaveBeenCalled();

    await runner.start({sessionId,source:'chat',input:'hold original background writer'});await backgroundEntered;
    await factory.dispose();
    const backgroundPhysical=runner.waitForDisposedResources(),factoryPhysical=factory.waitForDisposedResources();
    let factorySettled=false,drainSettled=false;
    void factoryPhysical.then(()=>{factorySettled=true;},()=>{factorySettled=true;});
    // The actual coordinator is frozen. Observe only this CLI call edge; never
    // replace its method, suppress errors, insert a gate, or fabricate its Promise.
    const originalDispose=coordinator.dispose,statesAtDispose:boolean[]=[];
    const disposeObserved=vi.fn(()=>{
      statesAtDispose.push(factorySettled);
      return originalDispose.call(coordinator);
    });
    const drain=drainCliRegistryWriters(factory,{...coordinator,dispose:disposeObserved});
    void drain.then(()=>{drainSettled=true;},()=>{drainSettled=true;});
    await new Promise(setImmediate);
    expect(factorySettled).toBe(false);expect(drainSettled).toBe(false);
    expect(disposeObserved).not.toHaveBeenCalled();expect(readObserved).not.toHaveBeenCalled();
    releaseBackground();
    const [backgroundResult,factoryResult,drainResult]=await Promise.all([outcome(backgroundPhysical),outcome(factoryPhysical),outcome(drain)]);
    if(rejected){
      expect(backgroundResult.ok).toBe(false);if(backgroundResult.ok)throw Error('late original background rejection missing');
      expect(backgroundResult.error).toBeInstanceOf(AggregateError);if(!(backgroundResult.error instanceof AggregateError))throw backgroundResult.error;
      expect(backgroundResult.error.errors).toHaveLength(1);expect(backgroundResult.error.errors[0]).toBe(failure);expectedFailures.add(backgroundResult.error);
      expect(factoryResult.ok).toBe(false);if(factoryResult.ok)throw Error('original factory rejection missing');
      expect(factoryResult.error).toBeInstanceOf(AggregateError);if(!(factoryResult.error instanceof AggregateError))throw factoryResult.error;
      expect(factoryResult.error.errors).toHaveLength(1);expect(factoryResult.error.errors[0]).toBe(backgroundResult.error);expectedFailures.add(factoryResult.error);
      expect(drainResult.ok).toBe(false);if(drainResult.ok)throw Error('original CLI physical rejection missing');
      expect(drainResult.error).toBeInstanceOf(AggregateError);if(!(drainResult.error instanceof AggregateError))throw drainResult.error;
      expect(drainResult.error.errors).toHaveLength(1);expect(drainResult.error.errors[0]).toBe(factoryResult.error);
    }else{
      expect(backgroundResult.ok).toBe(true);expect(factoryResult.ok).toBe(true);expect(drainResult.ok).toBe(true);
    }
    expect(disposeObserved).toHaveBeenCalledTimes(1);expect(statesAtDispose).toEqual([true]);
    const disposal=disposeObserved.mock.results[0];if(!disposal||disposal.type!=='return')throw Error('actual compound dispose did not return');
    await expect(disposal.value).resolves.toBeUndefined();
    await expect(registry.executeTool('read',{file_path:file},{...context,toolInvocationId:'after-actual-dispose'})).rejects.toHaveProperty('message','compound_owner_disposed');
    expect(readObserved).not.toHaveBeenCalled();
  }finally{
    releaseBackground();
    // Join every original resource, allowing only exact already-asserted errors.
    // Any new cleanup failure fails this case and retains its own evidence root.
    const results:PromiseSettledResult<unknown>[]=await Promise.allSettled([factory.dispose()]);
    results.push(...await Promise.allSettled([
      runner.waitForDisposedResources(),factory.waitForDisposedResources(),
      Promise.resolve().then(()=>compound?.dispose()),Promise.resolve().then(()=>work),
    ]));
    results.push(...await Promise.allSettled([
      Promise.resolve().then(()=>registry?.dispose()),Promise.resolve().then(()=>authority?.dispose()),Promise.resolve().then(()=>restoreRead?.()),
    ]));
    const unknown=results.flatMap(result=>result.status==='rejected'&&!expectedFailures.has(result.reason)?[result.reason]:[]);
    if(unknown.length)throw new AggregateError(unknown,'Windows factory fixture cleanup unconfirmed');
    rmSync(rootDir,{recursive:true,force:true});
  }
}
