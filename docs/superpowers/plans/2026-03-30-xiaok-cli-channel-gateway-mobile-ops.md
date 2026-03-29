# xiaok-cli Channel Gateway Mobile Ops Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 `xiaok-cli` 增加面向 `Slack/Telegram/Discord` 的远程消息通道能力，让用户可以在手机上发起任务、查看进度、处理审批与接收结果。

**Architecture:** 先做一层 runtime 级 `hooks/events` 基础设施，再在其上实现 channel gateway、session 映射、审批回流与异步通知。`plugin` 放到最后一层，只负责扩展与分发，不承担首版通道通讯的核心责任。

**Tech Stack:** TypeScript, Node.js, existing `xiaok-cli` runtime, Vitest, HTTP webhook handlers

---

## Scope

本计划覆盖：

- runtime 级 hooks / events
- channel ingress / egress 抽象
- session/thread 映射
- 移动端审批与结果回流
- Slack / Telegram / Discord adapter 最小版本

本计划不包含：

- 完整 plugin marketplace
- OAuth 安装向导
- 多租户 SaaS 控制台
- 富文本 block UI 编辑器

## Core Decision

`hooks` 应该早做，而且应被定义为 **基础运行时机制**，不是“为了通讯才加的外挂能力”。

理由：

- channel 适配器需要订阅 `turn_started` / `approval_required` / `tool_started` / `turn_completed` 等事件
- 后续日志、审计、通知、plugin、web UI 也都会复用同一套事件流
- 如果先直接写 Slack/Telegram 逻辑，再补 hooks，后面几乎一定要返工

所以顺序应该是：

1. `hooks/events`
2. session / approval / notification 基础层
3. channel adapters
4. plugin 化

## File Structure

- Create: `src/runtime/hooks.ts`
  定义 hook/event 类型、订阅器注册、事件派发入口。
- Create: `src/runtime/events.ts`
  定义标准事件载体，如 `turn_started`、`approval_required`、`tool_finished`。
- Modify: `src/ai/agent.ts`
  在 turn loop、tool 执行、完成/异常节点发出标准事件。
- Modify: `src/commands/chat.ts`
  初始化 runtime hooks，并将 CLI 模式与 channel 模式都接到同一事件总线。
- Create: `src/channels/types.ts`
  定义 channel message、reply target、session key、approval action 等共享类型。
- Create: `src/channels/session-store.ts`
  负责 `channel/thread/user -> xiaok session` 映射。
- Create: `src/channels/notifier.ts`
  统一向外发送文本、状态、审批请求、任务完成消息。
- Create: `src/channels/webhook.ts`
  统一 HTTP 入站分发。
- Create: `src/channels/slack.ts`
  Slack adapter 最小实现。
- Create: `src/channels/telegram.ts`
  Telegram bot adapter 最小实现。
- Create: `src/channels/discord.ts`
  Discord bot/webhook adapter 最小实现。
- Create: `src/channels/approval-store.ts`
  存储待审批项、回执 token、超时策略。
- Create: `src/channels/worker.ts`
  把 channel 请求转成异步 agent run，并回推进度。
- Create: `tests/runtime/hooks.test.ts`
- Create: `tests/channels/session-store.test.ts`
- Create: `tests/channels/approval-store.test.ts`
- Create: `tests/channels/notifier.test.ts`
- Create: `tests/channels/slack.test.ts`
- Create: `tests/channels/telegram.test.ts`
- Create: `tests/channels/discord.test.ts`

## Delivery Sequence

按以下顺序执行，不要跳步：

1. Runtime Hooks Foundation
2. Session / Approval / Notification Base
3. Channel Gateway
4. Individual Channel Adapters
5. Optional Pluginization

### Task 1: 建立 runtime hooks / events 基础设施

**Files:**
- Create: `src/runtime/events.ts`
- Create: `src/runtime/hooks.ts`
- Modify: `src/ai/agent.ts`
- Test: `tests/runtime/hooks.test.ts`

- [ ] **Step 1: 写失败测试，锁定事件发射行为**

```ts
// tests/runtime/hooks.test.ts
import { describe, it, expect } from 'vitest';
import { createRuntimeHooks } from '../../src/runtime/hooks.js';

describe('runtime hooks', () => {
  it('delivers emitted events to subscribers', () => {
    const hooks = createRuntimeHooks();
    const seen: string[] = [];

    hooks.on('turn_started', (event) => {
      seen.push(event.turnId);
    });

    hooks.emit({ type: 'turn_started', turnId: 'turn_1', sessionId: 'sess_1' });
    expect(seen).toEqual(['turn_1']);
  });
});
```

```ts
// tests/runtime/hooks.test.ts
it('supports wildcard subscribers for notifications', () => {
  const hooks = createRuntimeHooks();
  const seen: string[] = [];

  hooks.onAny((event) => seen.push(event.type));
  hooks.emit({ type: 'turn_completed', turnId: 'turn_1', sessionId: 'sess_1' });

  expect(seen).toEqual(['turn_completed']);
});
```

- [ ] **Step 2: 运行测试，确认 hooks 基础层不存在**

Run: `npx vitest run tests/runtime/hooks.test.ts`

Expected:

- FAIL，因为 `src/runtime/hooks.ts` / `src/runtime/events.ts` 尚不存在

- [ ] **Step 3: 写最小实现，提供事件总线**

```ts
// src/runtime/events.ts
export type RuntimeEvent =
  | { type: 'turn_started'; sessionId: string; turnId: string }
  | { type: 'turn_completed'; sessionId: string; turnId: string }
  | { type: 'approval_required'; sessionId: string; turnId: string; approvalId: string }
  | { type: 'tool_started'; sessionId: string; turnId: string; toolName: string }
  | { type: 'tool_finished'; sessionId: string; turnId: string; toolName: string; ok: boolean };
```

```ts
// src/runtime/hooks.ts
import type { RuntimeEvent } from './events.js';

type EventHandler<T extends RuntimeEvent['type']> = (event: Extract<RuntimeEvent, { type: T }>) => void;
type AnyHandler = (event: RuntimeEvent) => void;

export function createRuntimeHooks() {
  const handlers = new Map<RuntimeEvent['type'], Set<(event: RuntimeEvent) => void>>();
  const anyHandlers = new Set<AnyHandler>();

  return {
    on<T extends RuntimeEvent['type']>(type: T, handler: EventHandler<T>) {
      const set = handlers.get(type) ?? new Set();
      set.add(handler as (event: RuntimeEvent) => void);
      handlers.set(type, set);
    },
    onAny(handler: AnyHandler) {
      anyHandlers.add(handler);
    },
    emit(event: RuntimeEvent) {
      handlers.get(event.type)?.forEach((handler) => handler(event));
      anyHandlers.forEach((handler) => handler(event));
    },
  };
}
```

- [ ] **Step 4: 运行测试，确认 hooks 基础层可用**

Run: `npx vitest run tests/runtime/hooks.test.ts`

Expected:

- PASS

### Task 2: 让 agent/runtime 接入 hooks

**Files:**
- Modify: `src/ai/agent.ts`
- Modify: `src/types.ts`
- Test: `tests/ai/agent.test.ts`

- [ ] **Step 1: 写失败测试，锁定 agent 生命周期事件**

```ts
// tests/ai/agent.test.ts
it('emits turn_started and turn_completed events', async () => {
  const events: string[] = [];
  const hooks = {
    emit: (event: { type: string }) => events.push(event.type),
  };

  const agent = new Agent(adapter, registry, 'system', { hooks });
  await agent.runTurn('hi', () => {});

  expect(events).toContain('turn_started');
  expect(events).toContain('turn_completed');
});
```

- [ ] **Step 2: 运行测试，确认 agent 还未接入 hooks**

Run: `npx vitest run tests/ai/agent.test.ts`

Expected:

- FAIL，因为 `AgentOptions` 尚无 hooks

- [ ] **Step 3: 写最小实现，在关键节点发射事件**

```ts
// src/ai/agent.ts
interface AgentOptions {
  maxIterations?: number;
  contextLimit?: number;
  hooks?: { emit(event: RuntimeEvent): void };
}
```

```ts
this.options.hooks?.emit({ type: 'turn_started', sessionId, turnId });
this.options.hooks?.emit({ type: 'tool_started', sessionId, turnId, toolName: call.name });
this.options.hooks?.emit({ type: 'tool_finished', sessionId, turnId, toolName: call.name, ok: !isError });
this.options.hooks?.emit({ type: 'turn_completed', sessionId, turnId });
```

- [ ] **Step 4: 运行测试，确认 agent 事件链打通**

Run: `npx vitest run tests/ai/agent.test.ts tests/runtime/hooks.test.ts`

Expected:

- PASS

### Task 3: 建立 channel session / approval / notification 基础层

**Files:**
- Create: `src/channels/types.ts`
- Create: `src/channels/session-store.ts`
- Create: `src/channels/approval-store.ts`
- Create: `src/channels/notifier.ts`
- Test: `tests/channels/session-store.test.ts`
- Test: `tests/channels/approval-store.test.ts`
- Test: `tests/channels/notifier.test.ts`

- [ ] **Step 1: 写失败测试，锁定 session 映射**

```ts
// tests/channels/session-store.test.ts
import { describe, it, expect } from 'vitest';
import { InMemoryChannelSessionStore } from '../../../src/channels/session-store.js';

describe('channel session store', () => {
  it('returns the same session for the same channel thread key', () => {
    const store = new InMemoryChannelSessionStore();

    const a = store.getOrCreate({
      channel: 'slack',
      chatId: 'C123',
      threadId: 'thread_1',
      userId: 'U123',
    });
    const b = store.getOrCreate({
      channel: 'slack',
      chatId: 'C123',
      threadId: 'thread_1',
      userId: 'U123',
    });

    expect(a.sessionId).toBe(b.sessionId);
  });
});
```

- [ ] **Step 2: 运行测试，确认基础层尚不存在**

Run: `npx vitest run tests/channels/session-store.test.ts tests/channels/approval-store.test.ts tests/channels/notifier.test.ts`

Expected:

- FAIL，因为 `src/channels/*` 基础层文件不存在

- [ ] **Step 3: 写最小实现**

```ts
// src/channels/types.ts
export interface ChannelSessionKey {
  channel: 'slack' | 'telegram' | 'discord';
  chatId: string;
  threadId?: string;
  userId?: string;
}
```

```ts
// src/channels/session-store.ts
export class InMemoryChannelSessionStore {
  private sessions = new Map<string, { sessionId: string }>();

  getOrCreate(key: ChannelSessionKey) {
    const id = `${key.channel}:${key.chatId}:${key.threadId ?? ''}:${key.userId ?? ''}`;
    const existing = this.sessions.get(id);
    if (existing) return existing;
    const created = { sessionId: `sess_${this.sessions.size + 1}` };
    this.sessions.set(id, created);
    return created;
  }
}
```

- [ ] **Step 4: 运行测试，确认基础层稳定**

Run: `npx vitest run tests/channels/session-store.test.ts tests/channels/approval-store.test.ts tests/channels/notifier.test.ts`

Expected:

- PASS

### Task 4: 建立统一 channel gateway 与 webhook ingress

**Files:**
- Create: `src/channels/webhook.ts`
- Create: `src/channels/worker.ts`
- Modify: `src/commands/chat.ts`
- Test: `tests/channels/slack.test.ts`
- Test: `tests/channels/telegram.test.ts`
- Test: `tests/channels/discord.test.ts`

- [ ] **Step 1: 写失败测试，锁定 webhook 入站转 agent request**

```ts
// tests/channels/slack.test.ts
it('converts slack message event into a channel request', async () => {
  const req = parseSlackEvent({
    event: {
      channel: 'C123',
      thread_ts: '171',
      user: 'U123',
      text: 'fix build',
    },
  });

  expect(req.message).toBe('fix build');
  expect(req.sessionKey.channel).toBe('slack');
});
```

- [ ] **Step 2: 运行测试，确认 adapter 还未建立**

Run: `npx vitest run tests/channels/slack.test.ts tests/channels/telegram.test.ts tests/channels/discord.test.ts`

Expected:

- FAIL，因为 channel adapters 尚不存在

- [ ] **Step 3: 写最小实现，先统一抽象，不急着接真实 HTTP server**

```ts
// src/channels/webhook.ts
export interface ChannelRequest {
  sessionKey: ChannelSessionKey;
  message: string;
  replyTarget: Record<string, string>;
}
```

```ts
// src/channels/worker.ts
export async function handleChannelRequest(input: ChannelRequest) {
  return {
    accepted: true,
    sessionId: sessionStore.getOrCreate(input.sessionKey).sessionId,
  };
}
```

- [ ] **Step 4: 运行测试，确认 gateway 抽象成立**

Run: `npx vitest run tests/channels/slack.test.ts tests/channels/telegram.test.ts tests/channels/discord.test.ts`

Expected:

- PASS

### Task 5: 接入 Slack / Telegram / Discord 最小适配器

**Files:**
- Create: `src/channels/slack.ts`
- Create: `src/channels/telegram.ts`
- Create: `src/channels/discord.ts`
- Test: `tests/channels/slack.test.ts`
- Test: `tests/channels/telegram.test.ts`
- Test: `tests/channels/discord.test.ts`

- [ ] **Step 1: 写失败测试，锁定三个 adapter 的统一输出**

```ts
// tests/channels/telegram.test.ts
it('converts telegram update into a channel request', () => {
  const req = parseTelegramUpdate({
    message: {
      chat: { id: 1001 },
      from: { id: 2002 },
      text: 'status',
      message_id: 99,
    },
  });

  expect(req.sessionKey.channel).toBe('telegram');
  expect(req.message).toBe('status');
});
```

```ts
// tests/channels/discord.test.ts
it('converts discord message create into a channel request', () => {
  const req = parseDiscordMessage({
    channel_id: 'D1',
    id: 'M1',
    author: { id: 'U1' },
    content: 'approve',
  });

  expect(req.sessionKey.channel).toBe('discord');
  expect(req.message).toBe('approve');
});
```

- [ ] **Step 2: 运行测试，确认三个 adapter 都必须输出统一结构**

Run: `npx vitest run tests/channels/slack.test.ts tests/channels/telegram.test.ts tests/channels/discord.test.ts`

Expected:

- FAIL，直到三个解析器统一通过

- [ ] **Step 3: 写最小实现**

```ts
// src/channels/slack.ts
export function parseSlackEvent(payload: any): ChannelRequest {
  return {
    sessionKey: {
      channel: 'slack',
      chatId: String(payload.event.channel),
      threadId: payload.event.thread_ts ? String(payload.event.thread_ts) : undefined,
      userId: payload.event.user ? String(payload.event.user) : undefined,
    },
    message: String(payload.event.text ?? ''),
    replyTarget: {
      channel: String(payload.event.channel),
      thread_ts: String(payload.event.thread_ts ?? payload.event.ts ?? ''),
    },
  };
}
```

- [ ] **Step 4: 运行测试，确认 adapter 行为一致**

Run: `npx vitest run tests/channels/slack.test.ts tests/channels/telegram.test.ts tests/channels/discord.test.ts`

Expected:

- PASS

### Task 6: 接入审批回流与移动端通知

**Files:**
- Modify: `src/runtime/hooks.ts`
- Modify: `src/channels/notifier.ts`
- Modify: `src/channels/approval-store.ts`
- Test: `tests/channels/approval-store.test.ts`
- Test: `tests/channels/notifier.test.ts`

- [ ] **Step 1: 写失败测试，锁定审批请求与回执**

```ts
// tests/channels/approval-store.test.ts
it('stores approval request and resolves by action token', () => {
  const store = new InMemoryApprovalStore();
  const req = store.create({
    sessionId: 'sess_1',
    turnId: 'turn_1',
    summary: 'Allow bash command?',
  });

  expect(store.resolve(req.approvalId, 'approve')).toBe('approve');
});
```

- [ ] **Step 2: 运行测试，确认审批回流层未完成**

Run: `npx vitest run tests/channels/approval-store.test.ts tests/channels/notifier.test.ts`

Expected:

- FAIL，直到审批回流模型存在

- [ ] **Step 3: 写最小实现**

```ts
// src/channels/approval-store.ts
export class InMemoryApprovalStore {
  private pending = new Map<string, { summary: string }>();

  create(input: { sessionId: string; turnId: string; summary: string }) {
    const approvalId = `approval_${this.pending.size + 1}`;
    this.pending.set(approvalId, { summary: input.summary });
    return { approvalId };
  }

  resolve(approvalId: string, action: 'approve' | 'deny') {
    this.pending.delete(approvalId);
    return action;
  }
}
```

- [ ] **Step 4: 运行测试，确认审批回流与通知摘要可用**

Run: `npx vitest run tests/channels/approval-store.test.ts tests/channels/notifier.test.ts`

Expected:

- PASS

### Task 7: 把 plugin 放到最后一层

**Files:**
- Create: `docs/analysis/2026-03-30-xiaok-cli-channel-plugin-boundary.md`

- [ ] **Step 1: 写文档，明确 plugin 责任边界**

```md
# Channel Plugin Boundary

Plugin 负责：
- 安装 / 启停 channel adapter
- 分发配置
- 注册 channel-specific hooks

Plugin 不负责：
- 基础 hooks/event bus
- session store
- approval store
- runtime notifications
```

- [ ] **Step 2: 不写代码，只输出边界说明**

Expected:

- 让后续 plugin 化不会反向污染 runtime 基础层

## Integration Verification

- [ ] 运行核心 channel/runtime 测试

Run: `npx vitest run tests/runtime/hooks.test.ts tests/channels/session-store.test.ts tests/channels/approval-store.test.ts tests/channels/notifier.test.ts tests/channels/slack.test.ts tests/channels/telegram.test.ts tests/channels/discord.test.ts`

Expected:

- 全部 PASS

- [ ] 运行完整测试集

Run: `npx vitest run`

Expected:

- 全部 PASS

- [ ] 构建项目

Run: `npm run build`

Expected:

- TypeScript build 成功

## Risks

- 若先做 channel adapters 再补 hooks，后续通知/审批/审计会大面积返工
- 移动端审批如果没有稳定 token/session 绑定，容易误批危险操作
- 三个 channel 平台的消息模型差异很大，必须坚持统一内部 `ChannelRequest`
- 如果过早 plugin 化，会把基础 runtime 责任分散到扩展层，后期更难维护

## Rollback Strategy

- Hooks 层不稳定：保留 `RuntimeEvent` 类型，回退具体订阅实现
- Channel 层不稳定：保留 `session-store` / `approval-store`，回退各平台 adapter
- Plugin 边界不清：保留 boundary 文档，暂不实现 plugin runtime

## Follow-Up Plan Candidates

- Web dashboard 审批面板
- background agent + push notification
- channel-specific markdown/render adapters
- plugin system for channel distribution
