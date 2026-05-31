import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createPlatformRegistryFactory } from '../../../src/platform/runtime/registry-factory.js';
import { PermissionManager } from '../../../src/ai/permissions/manager.js';
import { applySandboxToTools } from '../../../src/platform/sandbox/tool-wrappers.js';
import { buildToolList } from '../../../src/ai/tools/index.js';
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
}));

// Mock dependencies
vi.mock('./context.js', () => ({
  createPlatformRuntimeContext: vi.fn(),
}));

function mockRegistry(tools: Tool[]) {
  const toolMap = new Map<string, Tool>();
  for (const t of tools) toolMap.set(t.definition.name, t);
  return {
    getToolDefinitions: (): ToolDefinition[] => [...toolMap.values()].map(t => t.definition),
  };
}

vi.mock('../../../src/ai/tools/index.js', () => ({
  buildToolList: vi.fn(() => mockState.tools),
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
    createBackgroundRunner: vi.fn(() => ({})),
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
      createBackgroundRunner: vi.fn(() => ({})),
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
      createBackgroundRunner: vi.fn(() => ({})),
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
