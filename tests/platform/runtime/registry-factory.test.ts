import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createPlatformRegistryFactory } from '../../../src/platform/runtime/registry-factory.js';
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
