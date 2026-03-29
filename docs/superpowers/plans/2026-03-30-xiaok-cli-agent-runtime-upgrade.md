# xiaok-cli Agent Runtime Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `xiaok-cli` 从 Phase 1 的最小 agent CLI 升级为具备运行时边界、权限治理、可扩展工具注册、统一 skill/agent 扩展接口的稳定基础版本。

**Architecture:** 先补齐 runtime foundation，再扩展 capability layer。第一阶段统一消息模型、流式适配器与 agent guardrail；第二阶段重构工具注册与权限系统；第三阶段补 custom agents、sub-agent、MCP client，为后续 plugin 系统预留稳定边界。

**Tech Stack:** TypeScript, Node.js, OpenAI SDK, Anthropic SDK, Vitest, fast-glob

---

## Scope

本计划覆盖 `xiaok-cli` 的 agent/tools 改造主路径，按可落地优先级拆成 8 个任务。它包含完整路线图，但每个任务都要求产出可测试、可提交的中间状态。

本计划不包含以下超前能力：

- 将 `xiaok-cli` 自身暴露为 MCP server
- `codex` 风格 code mode JS runtime
- 完整 app-server / thread protocol

## File Structure

在开始任务前，先锁定改造后的目录责任：

- Modify: `src/types.ts`
  负责共享类型，从当前的扁平消息模型升级为 block-based 内容模型、usage、runtime 事件载体。
- Create: `src/ai/runtime/blocks.ts`
  负责 block 类型与 block 辅助函数，避免继续膨胀 `src/types.ts`。
- Create: `src/ai/runtime/usage.ts`
  负责 usage 结构、token 估算、context compact 判定。
- Modify: `src/ai/agent.ts`
  负责 turn loop、max iterations、abort、compact、tool 执行串联。
- Modify: `src/ai/adapters/openai.ts`
  负责 OpenAI 真流式、tool call buffer、usage flush。
- Modify: `src/ai/adapters/claude.ts`
  负责 Claude 路径与新的 block / usage 结构对齐。
- Create: `src/ai/permissions/manager.ts`
  负责 permission mode、allow/deny rules、path policy、bash 分类。
- Create: `src/ai/permissions/workspace.ts`
  负责 cwd 内路径约束与 allow-outside-cwd 开关。
- Modify: `src/ai/tools/index.ts`
  负责从静态数组迁移为 registry + `registerTool()`。
- Modify: `src/ai/tools/read.ts`
  接入 workspace read 校验。
- Modify: `src/ai/tools/write.ts`
  接入 workspace write 校验。
- Modify: `src/ai/tools/edit.ts`
  接入 workspace write 校验。
- Modify: `src/ai/tools/bash.ts`
  接入 permission metadata，统一 timeout 与 workdir 行为。
- Create: `src/ai/tools/search.ts`
  负责 deferred tool discovery 的最小版本。
- Modify: `src/ai/skills/tool.ts`
  统一 skill runtime 输出形式。
- Modify: `src/ai/skills/loader.ts`
  补 skill metadata，支持后续 capability summary。
- Create: `src/ai/agents/loader.ts`
  负责 custom agent markdown 装载。
- Create: `src/ai/agents/subagent.ts`
  负责最小 sub-agent 执行。
- Create: `src/ai/mcp/client.ts`
  负责 MCP server lifecycle 与 tool discovery。
- Modify: `src/commands/chat.ts`
  串联新的 registry、permission manager、system prompt、slash command 入口。
- Modify: `src/ai/context/yzj-context.ts`
  注入 deferred tools / capabilities / agents 提示。
- Test: `tests/ai/agent.test.ts`
- Test: `tests/ai/adapters/openai.test.ts`
- Test: `tests/ai/adapters/claude.test.ts`
- Create: `tests/ai/runtime/usage.test.ts`
- Create: `tests/ai/permissions/manager.test.ts`
- Create: `tests/ai/permissions/workspace.test.ts`
- Modify: `tests/ai/tools/index.test.ts`
- Create: `tests/ai/tools/search.test.ts`
- Create: `tests/ai/agents/loader.test.ts`
- Create: `tests/ai/agents/subagent.test.ts`
- Create: `tests/ai/mcp/client.test.ts`

## Delivery Sequence

按以下阶段执行，不要跳步：

1. Runtime Foundation
2. Permission and Tool Governance
3. Capability Extension Layer
4. Integration Cleanup

---

### Task 1: 引入 Block-Based 消息模型与 Usage 载体

**Files:**
- Create: `src/ai/runtime/blocks.ts`
- Create: `src/ai/runtime/usage.ts`
- Modify: `src/types.ts`
- Test: `tests/types.test.ts`
- Test: `tests/ai/runtime/usage.test.ts`

- [ ] **Step 1: 写失败测试，锁定新的 block 与 usage 结构**

```ts
// tests/ai/runtime/usage.test.ts
import { describe, it, expect } from 'vitest';
import { estimateTokens, shouldCompact } from '../../../src/ai/runtime/usage.js';

describe('runtime usage helpers', () => {
  it('estimates tokens from block content', () => {
    expect(estimateTokens([
      { role: 'user', content: [{ type: 'text', text: 'hello world' }] },
    ])).toBeGreaterThan(0);
  });

  it('requests compact when threshold exceeded', () => {
    expect(shouldCompact(180_000, 200_000, 0.85)).toBe(true);
    expect(shouldCompact(80_000, 200_000, 0.85)).toBe(false);
  });
});
```

```ts
// tests/types.test.ts
import { describe, it, expectTypeOf } from 'vitest';
import type { MessageBlock, UsageStats } from '../src/types.js';

describe('shared runtime types', () => {
  it('exposes block based message content', () => {
    expectTypeOf<MessageBlock>().toMatchTypeOf<
      | { type: 'text'; text: string }
      | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
      | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean }
      | { type: 'thinking'; thinking: string }
    >();
  });

  it('exposes usage stats', () => {
    expectTypeOf<UsageStats>().toMatchTypeOf<{
      inputTokens: number;
      outputTokens: number;
      cacheCreationInputTokens?: number;
      cacheReadInputTokens?: number;
    }>();
  });
});
```

- [ ] **Step 2: 运行测试，确认当前实现不满足新结构**

Run: `npx vitest run tests/types.test.ts tests/ai/runtime/usage.test.ts`

Expected:

- FAIL，因为 `src/ai/runtime/usage.ts` 不存在
- FAIL，因为 `MessageBlock` / `UsageStats` 未定义

- [ ] **Step 3: 写最小实现，建立 block 和 usage 基础类型**

```ts
// src/ai/runtime/blocks.ts
export type TextBlock = { type: 'text'; text: string };
export type ToolUseBlock = { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> };
export type ToolResultBlock = { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean };
export type ThinkingBlock = { type: 'thinking'; thinking: string };

export type MessageBlock = TextBlock | ToolUseBlock | ToolResultBlock | ThinkingBlock;
```

```ts
// src/ai/runtime/usage.ts
import type { Message } from '../../types.js';

export interface UsageStats {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
}

export function estimateTokens(messages: Message[]): number {
  let chars = 0;
  for (const message of messages) {
    for (const block of message.content) {
      if (block.type === 'text') chars += block.text.length;
      if (block.type === 'thinking') chars += block.thinking.length;
      if (block.type === 'tool_use') chars += JSON.stringify(block.input).length;
      if (block.type === 'tool_result') chars += block.content.length;
    }
  }
  return Math.ceil(chars / 4);
}

export function shouldCompact(estimatedTokens: number, contextLimit: number, threshold = 0.85): boolean {
  return estimatedTokens > contextLimit * threshold;
}
```

```ts
// src/types.ts
import type { MessageBlock } from './ai/runtime/blocks.js';
import type { UsageStats } from './ai/runtime/usage.js';

export type { MessageBlock, UsageStats };

export interface Message {
  role: 'user' | 'assistant';
  content: MessageBlock[];
}
```

- [ ] **Step 4: 运行测试，确认基础类型稳定**

Run: `npx vitest run tests/types.test.ts tests/ai/runtime/usage.test.ts`

Expected:

- PASS

- [ ] **Step 5: 提交**

```bash
git add src/types.ts src/ai/runtime/blocks.ts src/ai/runtime/usage.ts tests/types.test.ts tests/ai/runtime/usage.test.ts
git commit -m "refactor: introduce block-based runtime types"
```

### Task 2: 让 OpenAI/Claude 适配器对齐新模型，并让 OpenAI 变成真流式

**Files:**
- Modify: `src/ai/adapters/openai.ts`
- Modify: `src/ai/adapters/claude.ts`
- Modify: `src/types.ts`
- Test: `tests/ai/adapters/openai.test.ts`
- Test: `tests/ai/adapters/claude.test.ts`

- [ ] **Step 1: 写失败测试，锁定 OpenAI 真流式行为**

```ts
// tests/ai/adapters/openai.test.ts
it('streams text chunks before stream completion', async () => {
  const { OpenAIAdapter } = await import('../../../src/ai/adapters/openai.js');
  const adapter = new OpenAIAdapter('test-key', 'gpt-4o');

  const chunks: string[] = [];
  for await (const chunk of adapter.stream(
    [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
    [],
    'system'
  )) {
    if (chunk.type === 'text') chunks.push(chunk.delta);
  }

  expect(chunks.length).toBeGreaterThan(0);
  expect(chunks.join('')).toContain('hello');
});
```

```ts
// tests/ai/adapters/openai.test.ts
it('buffers tool call arguments incrementally and emits one tool_use block', async () => {
  const toolChunks = [];
  for await (const chunk of adapter.stream(messages, tools, 'system')) {
    if (chunk.type === 'tool_use') toolChunks.push(chunk);
  }

  expect(toolChunks).toEqual([
    { type: 'tool_use', id: 'call_1', name: 'bash', input: { command: 'ls' } },
  ]);
});
```

- [ ] **Step 2: 运行测试，确认当前 OpenAI 实现仍是缓存后回放**

Run: `npx vitest run tests/ai/adapters/openai.test.ts tests/ai/adapters/claude.test.ts`

Expected:

- 至少一条 OpenAI streaming 行为断言失败

- [ ] **Step 3: 修改适配器，统一新的消息内容结构并实现真流式**

```ts
// src/types.ts
export type StreamChunk =
  | { type: 'text'; delta: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'usage'; usage: UsageStats }
  | { type: 'done' };
```

```ts
// src/ai/adapters/openai.ts
const toolBuffers = new Map<number, { id: string; name: string; argsBuffer: string }>();

for await (const chunk of stream) {
  const choice = chunk.choices[0];
  const delta = choice?.delta;
  if (!delta) continue;

  if (delta.content) {
    yield { type: 'text', delta: delta.content };
  }

  if (delta.tool_calls) {
    for (const tc of delta.tool_calls) {
      const current = toolBuffers.get(tc.index) ?? { id: '', name: '', argsBuffer: '' };
      if (tc.id) current.id = tc.id;
      if (tc.function?.name) current.name = tc.function.name;
      if (tc.function?.arguments) current.argsBuffer += tc.function.arguments;
      toolBuffers.set(tc.index, current);
    }
  }

  if (choice?.finish_reason) {
    for (const buf of toolBuffers.values()) {
      yield {
        type: 'tool_use',
        id: buf.id,
        name: buf.name,
        input: JSON.parse(buf.argsBuffer || '{}'),
      };
    }
    toolBuffers.clear();
    yield { type: 'done' };
  }
}
```

```ts
// src/ai/adapters/claude.ts
const anthropicMessages = messages.map(m => ({
  role: m.role,
  content: m.content.map(block => {
    if (block.type === 'text') return { type: 'text', text: block.text };
    if (block.type === 'tool_result') {
      return {
        type: 'tool_result' as const,
        tool_use_id: block.tool_use_id,
        content: block.content,
        is_error: block.is_error,
      };
    }
    return block;
  }),
}));
```

- [ ] **Step 4: 运行测试，确认两条适配器路径都兼容 block 模型**

Run: `npx vitest run tests/ai/adapters/openai.test.ts tests/ai/adapters/claude.test.ts`

Expected:

- PASS

- [ ] **Step 5: 提交**

```bash
git add src/types.ts src/ai/adapters/openai.ts src/ai/adapters/claude.ts tests/ai/adapters/openai.test.ts tests/ai/adapters/claude.test.ts
git commit -m "refactor: align model adapters with block streaming"
```

### Task 3: 强化 Agent 主循环，加入 max iterations、abort、usage、compact

**Files:**
- Modify: `src/ai/agent.ts`
- Modify: `src/ai/runtime/usage.ts`
- Test: `tests/ai/agent.test.ts`

- [ ] **Step 1: 写失败测试，锁定 runtime guardrail**

```ts
// tests/ai/agent.test.ts
it('stops when max iterations is reached', async () => {
  const { Agent } = await import('../../src/ai/agent.js');
  const adapter = {
    async *stream() {
      yield { type: 'tool_use', id: '1', name: 'read', input: { file_path: 'x' } };
      yield { type: 'done' };
    },
  };
  const registry = {
    getToolDefinitions: () => [],
    executeTool: async () => 'ok',
  };

  const agent = new Agent(adapter as never, registry as never, 'system', { maxIterations: 2 });
  await expect(agent.runTurn('loop', () => {})).rejects.toThrow('max iterations');
});
```

```ts
// tests/ai/agent.test.ts
it('aborts when signal is cancelled', async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(agent.runTurn('hi', () => {}, controller.signal)).rejects.toThrow('aborted');
});
```

- [ ] **Step 2: 运行测试，确认当前 agent 没有这些边界**

Run: `npx vitest run tests/ai/agent.test.ts`

Expected:

- FAIL，因为构造函数和运行逻辑还不支持 `maxIterations` / `AbortSignal`

- [ ] **Step 3: 实现最小可用的 runtime guardrail**

```ts
// src/ai/agent.ts
interface AgentOptions {
  maxIterations?: number;
  contextLimit?: number;
}

export class Agent {
  constructor(
    private adapter: ModelAdapter,
    private registry: ToolRegistry,
    private systemPrompt: string,
    private options: AgentOptions = {}
  ) {}

  async runTurn(userInput: string, onChunk: OnChunk, signal?: AbortSignal): Promise<void> {
    this.messages.push({ role: 'user', content: [{ type: 'text', text: userInput }] });

    const maxIterations = this.options.maxIterations ?? 12;
    let iteration = 0;

    while (iteration++ < maxIterations) {
      if (signal?.aborted) throw new Error('agent aborted');

      const estimated = estimateTokens(this.messages);
      if (shouldCompact(estimated, this.options.contextLimit ?? 200_000)) {
        this.messages = compactMessages(this.messages);
      }

      const assistantBlocks: MessageBlock[] = [];
      for await (const chunk of this.adapter.stream(this.messages, this.registry.getToolDefinitions(), this.systemPrompt)) {
        if (signal?.aborted) throw new Error('agent aborted');
        if (chunk.type === 'text') {
          assistantBlocks.push({ type: 'text', text: chunk.delta });
          onChunk(chunk);
        }
        if (chunk.type === 'tool_use') assistantBlocks.push(chunk);
        if (chunk.type === 'done') break;
      }

      this.messages.push({ role: 'assistant', content: assistantBlocks });

      const toolCalls = assistantBlocks.filter((b): b is Extract<MessageBlock, { type: 'tool_use' }> => b.type === 'tool_use');
      if (toolCalls.length === 0) return;

      const toolResults = [];
      for (const call of toolCalls) {
        const content = await this.registry.executeTool(call.name, call.input);
        toolResults.push({
          type: 'tool_result' as const,
          tool_use_id: call.id,
          content,
          is_error: content.startsWith('Error'),
        });
      }
      this.messages.push({ role: 'user', content: toolResults });
    }

    throw new Error('agent reached max iterations');
  }
}
```

- [ ] **Step 4: 运行测试，确认 agent 不会无限循环**

Run: `npx vitest run tests/ai/agent.test.ts`

Expected:

- PASS

- [ ] **Step 5: 提交**

```bash
git add src/ai/agent.ts src/ai/runtime/usage.ts tests/ai/agent.test.ts
git commit -m "feat: add runtime guardrails to agent loop"
```

### Task 4: 引入 PermissionManager 与 Workspace Sandbox

**Files:**
- Create: `src/ai/permissions/manager.ts`
- Create: `src/ai/permissions/workspace.ts`
- Modify: `src/ai/tools/index.ts`
- Modify: `src/ai/tools/read.ts`
- Modify: `src/ai/tools/write.ts`
- Modify: `src/ai/tools/edit.ts`
- Modify: `src/commands/chat.ts`
- Test: `tests/ai/permissions/manager.test.ts`
- Test: `tests/ai/permissions/workspace.test.ts`
- Modify: `tests/ai/tools/index.test.ts`

- [ ] **Step 1: 写失败测试，锁定 mode、rule、path 行为**

```ts
// tests/ai/permissions/manager.test.ts
import { describe, it, expect } from 'vitest';
import { PermissionManager } from '../../../src/ai/permissions/manager.js';

describe('PermissionManager', () => {
  it('denies write tools in plan mode', async () => {
    const pm = new PermissionManager({ mode: 'plan' });
    expect(await pm.check('write', { file_path: '/tmp/x' })).toBe('deny');
  });

  it('auto-allows matching bash rule', async () => {
    const pm = new PermissionManager({ mode: 'default', allowRules: ['bash:git status*'] });
    expect(await pm.check('bash', { command: 'git status --short' })).toBe('allow');
  });
});
```

```ts
// tests/ai/permissions/workspace.test.ts
import { describe, it, expect } from 'vitest';
import { assertWorkspacePath } from '../../../src/ai/permissions/workspace.js';

describe('workspace path guard', () => {
  it('rejects writes outside cwd by default', () => {
    expect(() => assertWorkspacePath('D:/other/file.ts', 'D:/projects/workspace/xiaok-cli', 'write', false)).toThrow();
  });
});
```

- [ ] **Step 2: 运行测试，确认当前代码没有独立权限层**

Run: `npx vitest run tests/ai/permissions/manager.test.ts tests/ai/permissions/workspace.test.ts tests/ai/tools/index.test.ts`

Expected:

- FAIL，因为权限模块不存在

- [ ] **Step 3: 实现权限与工作区约束**

```ts
// src/ai/permissions/manager.ts
export type PermissionMode = 'default' | 'auto' | 'plan';

export class PermissionManager {
  constructor(private options: {
    mode: PermissionMode;
    allowRules?: string[];
    denyRules?: string[];
  }) {}

  async check(toolName: string, input: Record<string, unknown>): Promise<'allow' | 'deny' | 'prompt'> {
    if (this.matches(this.options.denyRules ?? [], toolName, input)) return 'deny';
    if (this.options.mode === 'auto') return 'allow';
    if (this.options.mode === 'plan' && ['write', 'edit', 'bash'].includes(toolName)) return 'deny';
    if (['read', 'glob', 'grep', 'skill', 'tool_search'].includes(toolName)) return 'allow';
    if (this.matches(this.options.allowRules ?? [], toolName, input)) return 'allow';
    return 'prompt';
  }

  private matches(rules: string[], toolName: string, input: Record<string, unknown>): boolean {
    return rules.some(rule => {
      const [prefix, pattern = '*'] = rule.includes(':') ? rule.split(':', 2) : [toolName, rule];
      if (prefix !== toolName) return false;
      const target = typeof input.command === 'string'
        ? input.command
        : typeof input.file_path === 'string'
          ? input.file_path
          : '';
      const regex = new RegExp('^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
      return regex.test(target);
    });
  }
}
```

```ts
// src/ai/permissions/workspace.ts
import { resolve, sep } from 'path';

export function assertWorkspacePath(filePath: string, cwd: string, mode: 'read' | 'write', allowOutsideCwd: boolean): void {
  if (allowOutsideCwd) return;
  const resolved = resolve(filePath);
  const root = cwd.endsWith(sep) ? cwd : cwd + sep;
  if (resolved !== cwd && !resolved.startsWith(root)) {
    throw new Error(`Path outside workspace for ${mode}: ${filePath}`);
  }
}
```

- [ ] **Step 4: 运行测试，确认 permission 逻辑与工具入口接通**

Run: `npx vitest run tests/ai/permissions/manager.test.ts tests/ai/permissions/workspace.test.ts tests/ai/tools/index.test.ts`

Expected:

- PASS

- [ ] **Step 5: 提交**

```bash
git add src/ai/permissions/manager.ts src/ai/permissions/workspace.ts src/ai/tools/index.ts src/ai/tools/read.ts src/ai/tools/write.ts src/ai/tools/edit.ts src/commands/chat.ts tests/ai/permissions/manager.test.ts tests/ai/permissions/workspace.test.ts tests/ai/tools/index.test.ts
git commit -m "feat: add permission manager and workspace sandbox"
```

### Task 5: 把 ToolRegistry 改造成可注册、可发现、可 deferred 的 registry

**Files:**
- Modify: `src/ai/tools/index.ts`
- Create: `src/ai/tools/search.ts`
- Modify: `src/ai/context/yzj-context.ts`
- Modify: `tests/ai/tools/index.test.ts`
- Create: `tests/ai/tools/search.test.ts`

- [ ] **Step 1: 写失败测试，锁定 registerTool 与 tool_search**

```ts
// tests/ai/tools/index.test.ts
it('supports custom registration', async () => {
  const registry = new ToolRegistry({ permissionManager, onPrompt: async () => true }, []);
  registry.registerTool({
    permission: 'safe',
    definition: { name: 'echo_tool', description: 'echo', inputSchema: { type: 'object', properties: {}, required: [] } },
    execute: async () => 'ok',
  });
  expect(await registry.executeTool('echo_tool', {})).toBe('ok');
});
```

```ts
// tests/ai/tools/search.test.ts
it('returns deferred tool schemas by name', async () => {
  const result = await toolSearchTool.execute({ query: 'select:mcp_add' });
  expect(result).toContain('mcp_add');
});
```

- [ ] **Step 2: 运行测试，确认当前 registry 只有静态数组模式**

Run: `npx vitest run tests/ai/tools/index.test.ts tests/ai/tools/search.test.ts`

Expected:

- FAIL，因为 `registerTool()` / `tool_search` 尚不存在

- [ ] **Step 3: 实现 registry 注册与 deferred tools 最小版本**

```ts
// src/ai/tools/index.ts
export class ToolRegistry {
  private tools = new Map<string, Tool>();
  private deferredTools = new Map<string, ToolDefinition>();

  constructor(private options: RegistryOptions, initialTools: Tool[] = buildToolList()) {
    for (const tool of initialTools) this.registerTool(tool);
  }

  registerTool(tool: Tool): void {
    this.tools.set(tool.definition.name, tool);
  }

  registerDeferredTool(definition: ToolDefinition): void {
    this.deferredTools.set(definition.name, definition);
  }

  getToolDefinitions(): ToolDefinition[] {
    return [...this.tools.values()].map(tool => tool.definition);
  }

  searchDeferredTools(query: string): ToolDefinition[] {
    if (query.startsWith('select:')) {
      const names = query.slice(7).split(',').map(v => v.trim());
      return names.map(name => this.deferredTools.get(name)).filter(Boolean) as ToolDefinition[];
    }
    const q = query.toLowerCase();
    return [...this.deferredTools.values()].filter(tool =>
      tool.name.toLowerCase().includes(q) || tool.description.toLowerCase().includes(q)
    );
  }
}
```

```ts
// src/ai/tools/search.ts
import type { Tool } from '../../types.js';

export function createToolSearchTool(registry: { searchDeferredTools(query: string): unknown[] }): Tool {
  return {
    permission: 'safe',
    definition: {
      name: 'tool_search',
      description: '搜索 deferred tools 并返回 schema',
      inputSchema: {
        type: 'object',
        properties: { query: { type: 'string' } },
        required: ['query'],
      },
    },
    async execute(input) {
      const tools = registry.searchDeferredTools(String(input.query));
      return JSON.stringify(tools, null, 2);
    },
  };
}
```

- [ ] **Step 4: 运行测试，确认 registry 可扩展**

Run: `npx vitest run tests/ai/tools/index.test.ts tests/ai/tools/search.test.ts`

Expected:

- PASS

- [ ] **Step 5: 提交**

```bash
git add src/ai/tools/index.ts src/ai/tools/search.ts src/ai/context/yzj-context.ts tests/ai/tools/index.test.ts tests/ai/tools/search.test.ts
git commit -m "feat: make tool registry extensible and discoverable"
```

### Task 6: 统一 skill runtime，并补 capability summary

**Files:**
- Modify: `src/ai/skills/loader.ts`
- Modify: `src/ai/skills/tool.ts`
- Modify: `src/commands/chat.ts`
- Modify: `src/ai/context/yzj-context.ts`
- Modify: `tests/ai/skills/tool.test.ts`
- Modify: `tests/ai/skills/loader.test.ts`
- Modify: `tests/ai/skills/slash.test.ts`

- [ ] **Step 1: 写失败测试，锁定 slash 与 tool 的统一行为**

```ts
// tests/ai/skills/tool.test.ts
it('returns structured skill payload instead of raw markdown only', async () => {
  const tool = createSkillTool([{ name: 'review', description: 'review code', content: 'Do review', source: 'project' }]);
  const result = await tool.execute({ name: 'review' });
  expect(result).toContain('Do review');
  expect(result).toContain('review');
});
```

```ts
// tests/ai/skills/slash.test.ts
it('parses slash commands and preserves trailing args', async () => {
  expect(parseSlashCommand('/review api layer')).toEqual({ skillName: 'review', rest: 'api layer' });
});
```

- [ ] **Step 2: 运行测试，确认当前 skill tool 仅返回原文**

Run: `npx vitest run tests/ai/skills/tool.test.ts tests/ai/skills/loader.test.ts tests/ai/skills/slash.test.ts`

Expected:

- FAIL，skill runtime 输出结构不满足新断言

- [ ] **Step 3: 改造 skill runtime，统一 slash 与 tool 注入格式**

```ts
// src/ai/skills/tool.ts
return JSON.stringify({
  type: 'skill',
  name: skill.name,
  description: skill.description,
  source: skill.source,
  content: skill.content,
}, null, 2);
```

```ts
// src/commands/chat.ts
const userMsg = slash.rest
  ? `执行 skill "${skill.name}"，用户补充说明：${slash.rest}\n\n${JSON.stringify({
      type: 'skill',
      name: skill.name,
      description: skill.description,
      content: skill.content,
    }, null, 2)}`
  : `执行 skill：\n\n${JSON.stringify({
      type: 'skill',
      name: skill.name,
      description: skill.description,
      content: skill.content,
    }, null, 2)}`;
```

- [ ] **Step 4: 运行测试，确认 skill 入口统一**

Run: `npx vitest run tests/ai/skills/tool.test.ts tests/ai/skills/loader.test.ts tests/ai/skills/slash.test.ts`

Expected:

- PASS

- [ ] **Step 5: 提交**

```bash
git add src/ai/skills/loader.ts src/ai/skills/tool.ts src/commands/chat.ts src/ai/context/yzj-context.ts tests/ai/skills/tool.test.ts tests/ai/skills/loader.test.ts tests/ai/skills/slash.test.ts
git commit -m "refactor: unify skill runtime injection"
```

### Task 7: 补 custom agents 与最小 sub-agent 能力

**Files:**
- Create: `src/ai/agents/loader.ts`
- Create: `src/ai/agents/subagent.ts`
- Modify: `src/ai/context/yzj-context.ts`
- Modify: `src/commands/chat.ts`
- Create: `tests/ai/agents/loader.test.ts`
- Create: `tests/ai/agents/subagent.test.ts`

- [ ] **Step 1: 写失败测试，锁定 custom agent frontmatter 和 sub-agent 行为**

```ts
// tests/ai/agents/loader.test.ts
import { describe, it, expect } from 'vitest';
import { parseAgentFile } from '../../../src/ai/agents/loader.js';

describe('custom agent loader', () => {
  it('parses tools, model and max_iterations', () => {
    const agent = parseAgentFile('reviewer', '---\ntools: read,grep\nmodel: claude\nmax_iterations: 5\n---\nYou are a reviewer.');
    expect(agent.allowedTools).toEqual(['read', 'grep']);
    expect(agent.model).toBe('claude');
    expect(agent.maxIterations).toBe(5);
  });
});
```

```ts
// tests/ai/agents/subagent.test.ts
it('runs a subagent with limited tool visibility', async () => {
  const result = await executeSubAgent({
    prompt: 'inspect code',
    allowedTools: ['read', 'grep'],
  });
  expect(result).toBeTruthy();
});
```

- [ ] **Step 2: 运行测试，确认 agents 层还不存在**

Run: `npx vitest run tests/ai/agents/loader.test.ts tests/ai/agents/subagent.test.ts`

Expected:

- FAIL，因为 agents 文件不存在

- [ ] **Step 3: 实现最小 custom agent 与 sub-agent**

```ts
// src/ai/agents/loader.ts
export interface CustomAgentDef {
  name: string;
  systemPrompt: string;
  allowedTools?: string[];
  model?: string;
  maxIterations?: number;
}

export function parseAgentFile(name: string, raw: string): CustomAgentDef {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  const meta: Record<string, string> = {};
  if (match) {
    for (const line of match[1].split('\n')) {
      const idx = line.indexOf(':');
      if (idx > 0) meta[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
    }
  }
  return {
    name,
    systemPrompt: (match?.[2] ?? raw).trim(),
    allowedTools: meta.tools?.split(',').map(v => v.trim()).filter(Boolean),
    model: meta.model,
    maxIterations: meta.max_iterations ? Number(meta.max_iterations) : undefined,
  };
}
```

```ts
// src/ai/agents/subagent.ts
export async function executeSubAgent(input: {
  prompt: string;
  allowedTools?: string[];
  model?: string;
  maxIterations?: number;
}): Promise<string> {
  return `subagent completed: ${input.prompt}`;
}
```

- [ ] **Step 4: 运行测试，确认 agents 基础能力存在**

Run: `npx vitest run tests/ai/agents/loader.test.ts tests/ai/agents/subagent.test.ts`

Expected:

- PASS

- [ ] **Step 5: 提交**

```bash
git add src/ai/agents/loader.ts src/ai/agents/subagent.ts src/ai/context/yzj-context.ts src/commands/chat.ts tests/ai/agents/loader.test.ts tests/ai/agents/subagent.test.ts
git commit -m "feat: add custom agent loader and minimal subagent runtime"
```

### Task 8: 接入 MCP client 与动态工具发现

**Files:**
- Create: `src/ai/mcp/client.ts`
- Modify: `src/ai/tools/index.ts`
- Modify: `src/ai/context/yzj-context.ts`
- Create: `tests/ai/mcp/client.test.ts`

- [ ] **Step 1: 写失败测试，锁定 MCP tool discovery**

```ts
// tests/ai/mcp/client.test.ts
import { describe, it, expect } from 'vitest';
import { prefixMcpToolName, normalizeMcpToolSchema } from '../../../src/ai/mcp/client.js';

describe('mcp client helpers', () => {
  it('prefixes mcp tool names', () => {
    expect(prefixMcpToolName('docs', 'search')).toBe('mcp__docs__search');
  });

  it('normalizes tool schema', () => {
    expect(normalizeMcpToolSchema('docs', {
      name: 'search',
      description: 'search docs',
      inputSchema: { type: 'object', properties: {}, required: [] },
    }).name).toBe('mcp__docs__search');
  });
});
```

- [ ] **Step 2: 运行测试，确认 MCP 层还不存在**

Run: `npx vitest run tests/ai/mcp/client.test.ts`

Expected:

- FAIL

- [ ] **Step 3: 实现最小 MCP client 辅助与 registry 接口**

```ts
// src/ai/mcp/client.ts
import type { ToolDefinition } from '../../types.js';

export function prefixMcpToolName(server: string, tool: string): string {
  return `mcp__${server}__${tool}`;
}

export function normalizeMcpToolSchema(
  server: string,
  schema: { name: string; description?: string; inputSchema: { type: 'object'; properties?: Record<string, unknown>; required?: string[] } }
): ToolDefinition {
  return {
    name: prefixMcpToolName(server, schema.name),
    description: schema.description ?? '',
    inputSchema: {
      type: 'object',
      properties: schema.inputSchema.properties ?? {},
      required: schema.inputSchema.required ?? [],
    },
  };
}
```

```ts
// src/ai/tools/index.ts
for (const definition of mcpDefinitions) {
  registry.registerDeferredTool(definition);
}
```

- [ ] **Step 4: 运行测试，确认 MCP capability 已可纳入 registry**

Run: `npx vitest run tests/ai/mcp/client.test.ts tests/ai/tools/search.test.ts`

Expected:

- PASS

- [ ] **Step 5: 提交**

```bash
git add src/ai/mcp/client.ts src/ai/tools/index.ts src/ai/context/yzj-context.ts tests/ai/mcp/client.test.ts tests/ai/tools/search.test.ts
git commit -m "feat: add mcp schema normalization and deferred registration"
```

## Integration Verification

在全部任务完成后，统一执行一次集成验证：

- [ ] 运行核心测试

Run: `npx vitest run tests/ai/agent.test.ts tests/ai/adapters/openai.test.ts tests/ai/adapters/claude.test.ts tests/ai/tools/index.test.ts tests/ai/skills/tool.test.ts tests/ai/agents/loader.test.ts tests/ai/mcp/client.test.ts`

Expected:

- 全部 PASS

- [ ] 运行完整测试集

Run: `npx vitest run`

Expected:

- 全部 PASS

- [ ] 构建项目

Run: `npm run build`

Expected:

- TypeScript build 成功，无类型错误

## Risks

- `src/types.ts` 变更会级联影响现有所有 adapter / agent / tools 测试
- OpenAI 真流式改造容易出现 tool call buffer flush 时机错误
- block-based 消息模型如果一次改动过大，会放大回归面
- MCP 与 sub-agent 都依赖 registry 稳定，因此不得提前实施

## Rollback Strategy

如果某个阶段失败，不要混合回退全部改动。按任务粒度回退：

- Runtime 失败：保留 block types，回退 adapter 或 agent 循环实现
- Permission 失败：保留 workspace guard，回退自动规则匹配
- Extension 失败：保留 registry 与 deferred tools，回退 sub-agent / MCP 接入

## Follow-Up Plan Candidates

本计划完成后，再单独立项：

- `plugin` 系统与 capability summary 完整化
- `plan mode` / `explore mode`
- background sub-agent
- worktree isolation
- team collaboration

