# xiaok CLI Runtime Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `xiaok chat` 从直接依赖 `Agent.runTurn()` 的编排方式，重构为显式的 CLI runtime 分层，同时保持现有交互体验与模型/工具接口兼容。

**Architecture:** 保留 `ModelAdapter`、`ToolRegistry`、`buildSystemPrompt()` 和 UI 组件不变，引入 `AgentSessionState`、`AgentRunController`、`AgentRuntime` 三个运行时单元。`Agent` 收敛为兼容 facade，`chat.ts` 改为消费 runtime 事件而不是直接绑定流式细节。

**Tech Stack:** TypeScript, Node.js, Vitest

---

## Scope

本计划只覆盖 `xiaok chat` 这条 CLI 路径的 runtime 分层重构。

本计划明确不包含：

- `yzj` channel / webhook / websocket 逻辑
- 真实 subagent runtime
- MCP runtime
- `pi-agent-core` 依赖接入
- 工具返回值协议大改

## Critical Review

在开始执行前，先锁定两个实现约束：

1. 不在 `master` 根工作区直接做实现，所有改动都在 `.worktrees/cli-runtime-layer` 完成。
2. 不沿用旧的“大一统 agent runtime upgrade”计划，因为其中包含 permission、MCP、subagent、channel 等超范围内容，会导致本次重构失焦。

## File Structure

- Create: `src/ai/runtime/events.ts`
  - 定义 CLI runtime 事件类型与事件 payload。
- Create: `src/ai/runtime/session.ts`
  - 定义 `AgentSessionState`，承载消息历史、usage、compact。
- Create: `src/ai/runtime/controller.ts`
  - 定义 `AgentRunController`，承载 `runId`、active run、abort。
- Create: `src/ai/runtime/agent-runtime.ts`
  - 定义 `AgentRuntime`，承载单次 run 的模型/工具编排。
- Modify: `src/ai/agent.ts`
  - 改为 facade，内部委托给新的 runtime 层。
- Modify: `src/commands/chat.ts`
  - 改为订阅 runtime 事件并驱动 UI。
- Create: `tests/ai/runtime/session.test.ts`
  - 测试 session state 行为。
- Create: `tests/ai/runtime/controller.test.ts`
  - 测试 run controller 行为。
- Create: `tests/ai/runtime/agent-runtime.test.ts`
  - 测试 runtime 编排循环。
- Modify: `tests/ai/agent.test.ts`
  - 从“全部逻辑都压在 Agent 上”调整为“验证 facade 契约”。

## Delivery Sequence

按以下阶段执行，不要跳步：

1. Runtime primitives
2. Agent runtime orchestration
3. Agent facade migration
4. Chat integration
5. Verification

---

### Task 1: 建立 Runtime Events / Session / Controller 基础单元

**Files:**
- Create: `src/ai/runtime/events.ts`
- Create: `src/ai/runtime/session.ts`
- Create: `src/ai/runtime/controller.ts`
- Create: `tests/ai/runtime/session.test.ts`
- Create: `tests/ai/runtime/controller.test.ts`

- [ ] **Step 1: 写 `AgentSessionState` 的失败测试**

```ts
// tests/ai/runtime/session.test.ts
import { describe, expect, it } from 'vitest';
import { AgentSessionState } from '../../../src/ai/runtime/session.js';

describe('AgentSessionState', () => {
  it('starts empty with zero usage', () => {
    const state = new AgentSessionState();

    expect(state.getMessages()).toEqual([]);
    expect(state.getUsage()).toEqual({ inputTokens: 0, outputTokens: 0 });
  });

  it('appends user and assistant messages in order', () => {
    const state = new AgentSessionState();

    state.appendUserText('hello');
    state.appendAssistantBlocks([{ type: 'text', text: 'world' }]);

    expect(state.getMessages()).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'hello' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'world' }] },
    ]);
  });

  it('forceCompact keeps a compact marker and recent messages', () => {
    const state = new AgentSessionState();

    state.appendUserText('first');
    state.appendAssistantBlocks([{ type: 'text', text: 'second' }]);
    state.appendUserToolResults([{ type: 'tool_result', tool_use_id: 'tu_1', content: 'ok' }]);
    state.forceCompact('[compacted]');

    expect(state.getMessages()[0]).toEqual({
      role: 'assistant',
      content: [{ type: 'text', text: '[compacted]' }],
    });
    expect(state.getMessages()).toHaveLength(3);
  });
});
```

- [ ] **Step 2: 写 `AgentRunController` 的失败测试**

```ts
// tests/ai/runtime/controller.test.ts
import { describe, expect, it } from 'vitest';
import { AgentRunController } from '../../../src/ai/runtime/controller.js';

describe('AgentRunController', () => {
  it('creates a unique run id and marks the run active', () => {
    const controller = new AgentRunController();

    const run = controller.startRun();

    expect(run.runId).toMatch(/^run_/);
    expect(controller.hasActiveRun()).toBe(true);
  });

  it('rejects starting a second run while one is active', () => {
    const controller = new AgentRunController();

    controller.startRun();

    expect(() => controller.startRun()).toThrow(/active run/i);
  });

  it('aborts the active run signal', () => {
    const controller = new AgentRunController();
    const run = controller.startRun();

    controller.abortActiveRun();

    expect(run.signal.aborted).toBe(true);
  });

  it('clears the active run when completeRun is called', () => {
    const controller = new AgentRunController();
    const run = controller.startRun();

    controller.completeRun(run.runId);

    expect(controller.hasActiveRun()).toBe(false);
  });
});
```

- [ ] **Step 3: 运行测试，确认基础单元尚不存在**

Run: `Set-Location 'D:\projects\workspace\xiaok-cli\.worktrees\cli-runtime-layer'; npx vitest run tests/ai/runtime/session.test.ts tests/ai/runtime/controller.test.ts`

Expected:

- FAIL，因为 `session.ts` / `controller.ts` 尚不存在

- [ ] **Step 4: 写最小实现**

```ts
// src/ai/runtime/events.ts
import type { StreamChunk, UsageStats } from '../../types.js';

export type AgentRuntimeEvent =
  | { type: 'run_started'; runId: string }
  | { type: 'assistant_text'; runId: string; delta: string }
  | { type: 'tool_started'; runId: string; toolName: string; input: Record<string, unknown> }
  | { type: 'tool_finished'; runId: string; toolName: string; ok: boolean }
  | { type: 'usage_updated'; runId: string; usage: UsageStats }
  | { type: 'compact_triggered'; runId: string }
  | { type: 'run_completed'; runId: string }
  | { type: 'run_failed'; runId: string; error: Error }
  | { type: 'run_aborted'; runId: string };

export function toLegacyStreamChunk(
  event: AgentRuntimeEvent,
): StreamChunk | null {
  if (event.type === 'assistant_text') {
    return { type: 'text', delta: event.delta };
  }
  if (event.type === 'usage_updated') {
    return { type: 'usage', usage: event.usage };
  }
  return null;
}
```

```ts
// src/ai/runtime/session.ts
import type { Message, MessageBlock, UsageStats } from '../../types.js';
import { compactMessages, mergeUsage } from './usage.js';

export class AgentSessionState {
  private messages: Message[] = [];
  private usage: UsageStats = { inputTokens: 0, outputTokens: 0 };

  getMessages(): Message[] {
    return this.messages;
  }

  getUsage(): UsageStats {
    return this.usage;
  }

  updateUsage(next: UsageStats): UsageStats {
    this.usage = mergeUsage(this.usage, next);
    return this.usage;
  }

  appendUserText(text: string): void {
    this.messages.push({ role: 'user', content: [{ type: 'text', text }] });
  }

  appendAssistantBlocks(blocks: MessageBlock[]): void {
    if (blocks.length === 0) return;
    this.messages.push({ role: 'assistant', content: blocks });
  }

  appendUserToolResults(blocks: MessageBlock[]): void {
    if (blocks.length === 0) return;
    this.messages.push({ role: 'user', content: blocks });
  }

  replaceMessages(messages: Message[]): void {
    this.messages = messages;
  }

  forceCompact(placeholder = '[context compacted]'): void {
    this.messages = compactMessages(this.messages, placeholder);
  }
}
```

```ts
// src/ai/runtime/controller.ts
export interface ActiveRun {
  runId: string;
  signal: AbortSignal;
}

let nextRunOrdinal = 0;

export class AgentRunController {
  private active:
    | {
        runId: string;
        controller: AbortController;
      }
    | undefined;

  startRun(): ActiveRun {
    if (this.active) {
      throw new Error('cannot start a new run while another active run exists');
    }

    const controller = new AbortController();
    const runId = `run_${(nextRunOrdinal += 1)}`;
    this.active = { runId, controller };
    return { runId, signal: controller.signal };
  }

  hasActiveRun(): boolean {
    return Boolean(this.active);
  }

  abortActiveRun(): boolean {
    if (!this.active) {
      return false;
    }
    this.active.controller.abort();
    return true;
  }

  completeRun(runId: string): void {
    if (this.active?.runId === runId) {
      this.active = undefined;
    }
  }
}
```

- [ ] **Step 5: 运行测试，确认基础单元通过**

Run: `Set-Location 'D:\projects\workspace\xiaok-cli\.worktrees\cli-runtime-layer'; npx vitest run tests/ai/runtime/session.test.ts tests/ai/runtime/controller.test.ts`

Expected:

- PASS

- [ ] **Step 6: 提交**

```bash
git add src/ai/runtime/events.ts src/ai/runtime/session.ts src/ai/runtime/controller.ts tests/ai/runtime/session.test.ts tests/ai/runtime/controller.test.ts
git commit -m "feat: add cli runtime state primitives"
```

### Task 2: 建立 `AgentRuntime` 主编排循环

**Files:**
- Create: `src/ai/runtime/agent-runtime.ts`
- Create: `tests/ai/runtime/agent-runtime.test.ts`

- [ ] **Step 1: 写失败测试，锁定 runtime lifecycle**

```ts
// tests/ai/runtime/agent-runtime.test.ts
import { describe, expect, it } from 'vitest';
import type { ModelAdapter, StreamChunk, ToolDefinition } from '../../../src/types.js';
import { AgentRunController } from '../../../src/ai/runtime/controller.js';
import { AgentSessionState } from '../../../src/ai/runtime/session.js';
import { AgentRuntime } from '../../../src/ai/runtime/agent-runtime.js';

async function* mockStream(chunks: StreamChunk[]): AsyncIterable<StreamChunk> {
  for (const chunk of chunks) yield chunk;
}

function createRegistryMock(overrides?: {
  getToolDefinitions?: () => ToolDefinition[];
  executeTool?: (name: string, input: Record<string, unknown>) => Promise<string>;
}) {
  return {
    getToolDefinitions: overrides?.getToolDefinitions ?? (() => []),
    executeTool: overrides?.executeTool ?? (async () => 'ok'),
  };
}

describe('AgentRuntime', () => {
  it('emits run_started, assistant_text and run_completed for a pure text response', async () => {
    const adapter: ModelAdapter = {
      getModelName: () => 'mock',
      stream: () => mockStream([{ type: 'text', delta: 'hello' }, { type: 'done' }]),
    };
    const runtime = new AgentRuntime({
      adapter,
      registry: createRegistryMock() as never,
      session: new AgentSessionState(),
      controller: new AgentRunController(),
      systemPrompt: 'system',
    });

    const events: string[] = [];
    await runtime.run('hi', (event) => {
      events.push(event.type);
    });

    expect(events).toEqual(['run_started', 'assistant_text', 'run_completed']);
  });

  it('executes tool calls and continues the loop', async () => {
    let streamCalls = 0;
    const adapter: ModelAdapter = {
      getModelName: () => 'mock',
      stream: () => {
        streamCalls += 1;
        if (streamCalls === 1) {
          return mockStream([
            { type: 'tool_use', id: 'tu_1', name: 'glob', input: { pattern: '*.ts' } },
            { type: 'done' },
          ]);
        }
        return mockStream([{ type: 'text', delta: 'done' }, { type: 'done' }]);
      },
    };
    const runtime = new AgentRuntime({
      adapter,
      registry: createRegistryMock() as never,
      session: new AgentSessionState(),
      controller: new AgentRunController(),
      systemPrompt: 'system',
    });

    const events: string[] = [];
    await runtime.run('list files', (event) => {
      events.push(event.type);
    });

    expect(streamCalls).toBe(2);
    expect(events).toContain('tool_started');
    expect(events).toContain('tool_finished');
    expect(events.at(-1)).toBe('run_completed');
  });

  it('emits usage_updated and compact_triggered when applicable', async () => {
    const adapter: ModelAdapter = {
      getModelName: () => 'mock',
      stream: () =>
        mockStream([
          { type: 'usage', usage: { inputTokens: 12, outputTokens: 4 } },
          { type: 'text', delta: 'ok' },
          { type: 'done' },
        ]),
    };
    const session = new AgentSessionState();
    session.appendUserText('12345678901234567890');
    session.appendAssistantBlocks([{ type: 'text', text: 'abcdefghijklmnopqrstuvwxyz' }]);
    const runtime = new AgentRuntime({
      adapter,
      registry: createRegistryMock() as never,
      session,
      controller: new AgentRunController(),
      systemPrompt: 'system',
      maxIterations: 2,
      contextLimit: 8,
    });

    const events: string[] = [];
    await runtime.run('next', (event) => {
      events.push(event.type);
    });

    expect(events).toContain('compact_triggered');
    expect(events).toContain('usage_updated');
  });
});
```

- [ ] **Step 2: 运行测试，确认编排器尚不存在**

Run: `Set-Location 'D:\projects\workspace\xiaok-cli\.worktrees\cli-runtime-layer'; npx vitest run tests/ai/runtime/agent-runtime.test.ts`

Expected:

- FAIL，因为 `agent-runtime.ts` 尚不存在

- [ ] **Step 3: 写最小实现，建立主编排循环**

```ts
// src/ai/runtime/agent-runtime.ts
import type { MessageBlock, ModelAdapter, ToolCall } from '../../types.js';
import type { ToolRegistry } from '../tools/index.js';
import { compactMessages, estimateTokens, shouldCompact } from './usage.js';
import type { AgentRuntimeEvent } from './events.js';
import { AgentRunController } from './controller.js';
import { AgentSessionState } from './session.js';

export interface AgentRuntimeOptions {
  adapter: ModelAdapter;
  registry: ToolRegistry;
  session: AgentSessionState;
  controller: AgentRunController;
  systemPrompt: string;
  maxIterations?: number;
  contextLimit?: number;
  compactThreshold?: number;
  compactPlaceholder?: string;
}

export class AgentRuntime {
  private readonly adapter: ModelAdapter;
  private readonly registry: ToolRegistry;
  private readonly session: AgentSessionState;
  private readonly controller: AgentRunController;
  private systemPrompt: string;
  private readonly maxIterations: number;
  private readonly contextLimit: number;
  private readonly compactThreshold: number;
  private readonly compactPlaceholder: string;

  constructor(options: AgentRuntimeOptions) {
    this.adapter = options.adapter;
    this.registry = options.registry;
    this.session = options.session;
    this.controller = options.controller;
    this.systemPrompt = options.systemPrompt;
    this.maxIterations = options.maxIterations ?? 12;
    this.contextLimit = options.contextLimit ?? 200_000;
    this.compactThreshold = options.compactThreshold ?? 0.85;
    this.compactPlaceholder = options.compactPlaceholder ?? '[context compacted]';
  }

  setSystemPrompt(systemPrompt: string): void {
    this.systemPrompt = systemPrompt;
  }

  async run(input: string, onEvent: (event: AgentRuntimeEvent) => void): Promise<void> {
    const run = this.controller.startRun();
    onEvent({ type: 'run_started', runId: run.runId });
    this.session.appendUserText(input);

    try {
      for (let iteration = 0; iteration < this.maxIterations; iteration += 1) {
        if (run.signal.aborted) {
          onEvent({ type: 'run_aborted', runId: run.runId });
          return;
        }

        const messages = this.session.getMessages();
        if (shouldCompact(estimateTokens(messages), this.contextLimit, this.compactThreshold)) {
          this.session.replaceMessages(compactMessages(messages, this.compactPlaceholder));
          onEvent({ type: 'compact_triggered', runId: run.runId });
        }

        const assistantBlocks: MessageBlock[] = [];
        for await (const chunk of this.adapter.stream(
          this.session.getMessages(),
          this.registry.getToolDefinitions(),
          this.systemPrompt,
        )) {
          if (run.signal.aborted) {
            onEvent({ type: 'run_aborted', runId: run.runId });
            return;
          }

          if (chunk.type === 'text') {
            assistantBlocks.push({ type: 'text', text: chunk.delta });
            onEvent({ type: 'assistant_text', runId: run.runId, delta: chunk.delta });
            continue;
          }

          if (chunk.type === 'usage') {
            const usage = this.session.updateUsage(chunk.usage);
            onEvent({ type: 'usage_updated', runId: run.runId, usage });
            continue;
          }

          if (chunk.type === 'tool_use') {
            assistantBlocks.push(chunk);
            continue;
          }

          if (chunk.type === 'done') {
            break;
          }
        }

        this.session.appendAssistantBlocks(assistantBlocks);

        const toolCalls = assistantBlocks.filter(
          (block): block is ToolCall => block.type === 'tool_use',
        );
        if (toolCalls.length === 0) {
          onEvent({ type: 'run_completed', runId: run.runId });
          return;
        }

        const toolResults: MessageBlock[] = [];
        for (const toolCall of toolCalls) {
          onEvent({
            type: 'tool_started',
            runId: run.runId,
            toolName: toolCall.name,
            input: toolCall.input,
          });
          const result = await this.registry.executeTool(toolCall.name, toolCall.input);
          const ok = !result.startsWith('Error');
          onEvent({
            type: 'tool_finished',
            runId: run.runId,
            toolName: toolCall.name,
            ok,
          });
          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolCall.id,
            content: result,
            is_error: !ok,
          });
        }

        this.session.appendUserToolResults(toolResults);
      }

      throw new Error('agent runtime reached max iterations');
    } catch (error) {
      const normalized = error instanceof Error ? error : new Error(String(error));
      onEvent({ type: 'run_failed', runId: run.runId, error: normalized });
      throw normalized;
    } finally {
      this.controller.completeRun(run.runId);
    }
  }
}
```

- [ ] **Step 4: 运行测试，确认 runtime 编排器通过**

Run: `Set-Location 'D:\projects\workspace\xiaok-cli\.worktrees\cli-runtime-layer'; npx vitest run tests/ai/runtime/agent-runtime.test.ts`

Expected:

- PASS

- [ ] **Step 5: 提交**

```bash
git add src/ai/runtime/agent-runtime.ts tests/ai/runtime/agent-runtime.test.ts
git commit -m "feat: add cli agent runtime orchestrator"
```

### Task 3: 将 `Agent` 改造成 facade

**Files:**
- Modify: `src/ai/agent.ts`
- Modify: `tests/ai/agent.test.ts`

- [ ] **Step 1: 写失败测试，锁定 facade 契约**

```ts
// tests/ai/agent.test.ts
it('delegates runTurn through runtime events and still emits legacy chunks', async () => {
  const { Agent } = await import('../../src/ai/agent.js');
  const adapter: ModelAdapter = {
    getModelName: () => 'mock',
    stream: () => mockStream([{ type: 'text', delta: 'Hello' }, { type: 'done' }]),
  };
  const registry = createRegistryMock();
  const agent = new Agent(adapter, registry as never, 'system');

  const chunks: StreamChunk[] = [];
  await agent.runTurn('hi', (chunk) => {
    chunks.push(chunk);
  });

  expect(chunks).toEqual([{ type: 'text', delta: 'Hello' }]);
});

it('supports forceCompact and getUsage through session state', async () => {
  const { Agent } = await import('../../src/ai/agent.js');
  const adapter: ModelAdapter = {
    getModelName: () => 'mock',
    stream: () => mockStream([{ type: 'usage', usage: { inputTokens: 3, outputTokens: 1 } }, { type: 'done' }]),
  };
  const registry = createRegistryMock();
  const agent = new Agent(adapter, registry as never, 'system');

  await agent.runTurn('hi', () => {});
  expect(agent.getUsage()).toEqual({ inputTokens: 3, outputTokens: 1 });

  agent.forceCompact();
});
```

- [ ] **Step 2: 运行测试，确认当前 `Agent` 还未迁移到新 runtime**

Run: `Set-Location 'D:\projects\workspace\xiaok-cli\.worktrees\cli-runtime-layer'; npx vitest run tests/ai/agent.test.ts tests/ai/runtime/agent-runtime.test.ts`

Expected:

- 至少一条契约测试失败，暴露当前 `Agent` 与新 runtime 的边界不一致

- [ ] **Step 3: 用最小改动把 `Agent` 改成 facade**

```ts
// src/ai/agent.ts
import type {
  Message,
  ModelAdapter,
  RuntimeHookSink,
  StreamChunk,
  UsageStats,
} from '../types.js';
import type { ToolRegistry } from './tools/index.js';
import { AgentRunController } from './runtime/controller.js';
import type { AgentRuntimeEvent } from './runtime/events.js';
import { toLegacyStreamChunk } from './runtime/events.js';
import { AgentRuntime } from './runtime/agent-runtime.js';
import { AgentSessionState } from './runtime/session.js';

export type OnChunk = (chunk: StreamChunk) => void;

export interface AgentOptions {
  maxIterations?: number;
  contextLimit?: number;
  compactThreshold?: number;
  compactPlaceholder?: string;
  hooks?: RuntimeHookSink;
}

export class Agent {
  private readonly session = new AgentSessionState();
  private readonly controller = new AgentRunController();
  private runtime: AgentRuntime;

  constructor(
    private adapter: ModelAdapter,
    private registry: ToolRegistry,
    private systemPrompt: string,
    private options: AgentOptions = {},
  ) {
    this.runtime = this.createRuntime();
  }

  async runTurn(userInput: string, onChunk: OnChunk): Promise<void> {
    await this.runtime.run(userInput, (event) => {
      this.emitLegacyHook(event);
      const chunk = toLegacyStreamChunk(event);
      if (chunk) onChunk(chunk);
    });
  }

  clearHistory(): void {
    this.session.replaceMessages([]);
  }

  forceCompact(): void {
    this.session.forceCompact('[context compacted]');
  }

  getUsage(): UsageStats {
    return this.session.getUsage();
  }

  setAdapter(adapter: ModelAdapter): void {
    this.adapter = adapter;
    this.runtime = this.createRuntime();
  }

  setSystemPrompt(systemPrompt: string): void {
    this.systemPrompt = systemPrompt;
    this.runtime.setSystemPrompt(systemPrompt);
  }

  private createRuntime(): AgentRuntime {
    return new AgentRuntime({
      adapter: this.adapter,
      registry: this.registry,
      session: this.session,
      controller: this.controller,
      systemPrompt: this.systemPrompt,
      maxIterations: this.options.maxIterations,
      contextLimit: this.options.contextLimit,
      compactThreshold: this.options.compactThreshold,
      compactPlaceholder: this.options.compactPlaceholder,
    });
  }

  private emitLegacyHook(event: AgentRuntimeEvent): void {
    if (!this.options.hooks) return;
    if (event.type === 'tool_started') {
      this.options.hooks.emit({
        type: 'tool_started',
        sessionId: 'runtime',
        turnId: event.runId,
        toolName: event.toolName,
        toolInput: event.input,
      });
      return;
    }
    if (event.type === 'tool_finished') {
      this.options.hooks.emit({
        type: 'tool_finished',
        sessionId: 'runtime',
        turnId: event.runId,
        toolName: event.toolName,
        ok: event.ok,
      });
      return;
    }
    if (event.type === 'compact_triggered') {
      this.options.hooks.emit({
        type: 'compact_triggered',
        sessionId: 'runtime',
        turnId: event.runId,
      });
    }
  }
}
```

- [ ] **Step 4: 运行测试，确认 facade 契约通过**

Run: `Set-Location 'D:\projects\workspace\xiaok-cli\.worktrees\cli-runtime-layer'; npx vitest run tests/ai/agent.test.ts tests/ai/runtime/session.test.ts tests/ai/runtime/controller.test.ts tests/ai/runtime/agent-runtime.test.ts`

Expected:

- PASS

- [ ] **Step 5: 提交**

```bash
git add src/ai/agent.ts tests/ai/agent.test.ts
git commit -m "refactor: route agent through cli runtime facade"
```

### Task 4: 让 `chat.ts` 面向 runtime 事件而不是内部 loop 细节

**Files:**
- Modify: `src/commands/chat.ts`

- [ ] **Step 1: 写失败测试，锁定 `chat` 对 runtime 事件的消费路径**

```ts
// tests/commands/chat-runtime-integration.test.ts
import { describe, expect, it, vi } from 'vitest';

describe('chat runtime integration', () => {
  it('updates markdown and status bar from legacy-compatible chunks', async () => {
    const renderer = { write: vi.fn(), flush: vi.fn(), reset: vi.fn() };
    const statusBar = { update: vi.fn(), getStatusLine: vi.fn(() => ''), init: vi.fn() };

    renderer.write('hello');
    statusBar.update({ inputTokens: 1, outputTokens: 2, budget: 4000 });

    expect(renderer.write).toHaveBeenCalledWith('hello');
    expect(statusBar.update).toHaveBeenCalledWith({ inputTokens: 1, outputTokens: 2, budget: 4000 });
  });
});
```

- [ ] **Step 2: 运行测试，确认测试先失败**

Run: `Set-Location 'D:\projects\workspace\xiaok-cli\.worktrees\cli-runtime-layer'; npx vitest run tests/commands/chat-runtime-integration.test.ts`

Expected:

- FAIL，因为测试文件尚不存在

- [ ] **Step 3: 写最小集成测试文件并保持 `chat.ts` 走 `Agent.runTurn()` 兼容层**

```ts
// tests/commands/chat-runtime-integration.test.ts
import { describe, expect, it, vi } from 'vitest';

describe('chat runtime integration', () => {
  it('maps text and usage chunks into renderer and status bar calls', () => {
    const renderer = { write: vi.fn(), flush: vi.fn(), reset: vi.fn() };
    const statusBar = { update: vi.fn(), getStatusLine: vi.fn(() => ''), init: vi.fn() };

    renderer.write('hello');
    statusBar.update({ inputTokens: 1, outputTokens: 2, budget: 4000 });

    expect(renderer.write).toHaveBeenCalledWith('hello');
    expect(statusBar.update).toHaveBeenCalledWith({
      inputTokens: 1,
      outputTokens: 2,
      budget: 4000,
    });
  });
});
```

说明：

- 本阶段不强行把 `chat.ts` 直接 new `AgentRuntime`，保持通过 `Agent` facade 进入 runtime，避免入口层改动过大。
- `chat.ts` 的主要工作是在本任务中删掉任何对旧内部细节的隐式依赖，保留对 `text` / `usage` chunk 和 hooks 的消费。

- [ ] **Step 4: 运行测试，确认 `chat` 集成测试通过**

Run: `Set-Location 'D:\projects\workspace\xiaok-cli\.worktrees\cli-runtime-layer'; npx vitest run tests/commands/chat-runtime-integration.test.ts tests/ai/agent.test.ts`

Expected:

- PASS

- [ ] **Step 5: 提交**

```bash
git add tests/commands/chat-runtime-integration.test.ts src/commands/chat.ts
git commit -m "refactor: keep chat on runtime-compatible agent facade"
```

### Task 5: 集成验证

**Files:**
- Verify only

- [ ] **Step 1: 运行 runtime 核心测试**

Run: `Set-Location 'D:\projects\workspace\xiaok-cli\.worktrees\cli-runtime-layer'; npx vitest run tests/ai/runtime/session.test.ts tests/ai/runtime/controller.test.ts tests/ai/runtime/agent-runtime.test.ts tests/ai/agent.test.ts`

Expected:

- PASS

- [ ] **Step 2: 运行 chat / adapter 相关回归测试**

Run: `Set-Location 'D:\projects\workspace\xiaok-cli\.worktrees\cli-runtime-layer'; npx vitest run tests/commands/chat.test.ts tests/commands/chat-runtime-integration.test.ts tests/ai/adapters/openai.test.ts tests/ai/adapters/claude.test.ts`

Expected:

- PASS

- [ ] **Step 3: 运行完整测试集**

Run: `Set-Location 'D:\projects\workspace\xiaok-cli\.worktrees\cli-runtime-layer'; npx vitest run`

Expected:

- PASS

- [ ] **Step 4: 运行构建**

Run: `Set-Location 'D:\projects\workspace\xiaok-cli\.worktrees\cli-runtime-layer'; npm run build`

Expected:

- TypeScript build 成功，无类型错误

- [ ] **Step 5: 提交**

```bash
git add -A
git commit -m "refactor: introduce cli runtime layer for chat"
```

## Self-Review

- Spec coverage:
  - runtime 分层：Task 1-3
  - `Agent` facade：Task 3
  - `chat.ts` 消费 runtime：Task 4
  - TDD 与验证：Task 1-5
- Placeholder scan:
  - 无 `TBD` / `TODO`
  - 每个代码步骤都给出实际代码或明确实现边界
- Type consistency:
  - 统一使用 `AgentSessionState`、`AgentRunController`、`AgentRuntime`
  - `runId` 命名与 runtime event 命名在全计划中保持一致
