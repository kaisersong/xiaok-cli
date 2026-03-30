# xiaok CLI Runtime Layer 重构设计

**日期：** 2026-03-31
**状态：** 草案已确认，待用户审阅

---

## 概述

本设计解决 `xiaok-cli` 当前 chat runtime 的一个结构性问题：CLI 交互、会话状态、工具编排、流式事件和 UI 更新现在耦合得过紧，导致后续要增强中断、运行态观察、测试稳定性和扩展能力时，改动会持续堆在 `Agent` 与 `chat.ts` 上。

本次改造不接入 `OpenClaw` 或 `pi-agent-core` 的实际依赖，也不把 `xiaok` 变成 gateway 平台。目标只是参考它们已经验证过的运行时思想，把 `xiaok chat` 这条单会话 CLI 路径改造成更清晰的 runtime 分层。

一句话总结：

- 保留 `xiaok` 现有的模型适配层、工具层、system prompt 和终端体验
- 重构当前 chat runtime 的内部边界
- 为后续演进预留 run lifecycle、abort、usage、compact 和更细粒度事件流

---

## 目标

- 将当前 `Agent` 的“大循环”拆成可测试、可组合的 CLI runtime 内核。
- 让 `chat.ts` 面向 runtime 事件工作，而不是直接依赖 agent 内部 streaming 细节。
- 明确区分以下职责：
  - 会话状态管理
  - 单次 run 生命周期管理
  - 模型流式编排
  - 工具调用编排
  - UI 事件消费
- 保持现有 `ModelAdapter`、`ToolRegistry`、`PermissionManager`、`buildSystemPrompt()` 的投资不被推翻。
- 为未来增强能力留出稳定接口：
  - run id
  - abort
  - in-flight 状态判断
  - 更细粒度 usage/compact/tool 事件

## 非目标

- 本次不接入 `@mariozechner/pi-agent-core`、`OpenClaw` 或任何新 agent runtime 依赖。
- 本次不改造 `yzj` channel、webhook、websocket 或任何 channel gateway 逻辑。
- 本次不实现真实 subagent、多 agent routing、session wait API、后台任务系统。
- 本次不做 context engine、plugin runtime、MCP runtime。
- 本次不重写工具权限系统，只在 runtime 编排层整理边界。

---

## 当前问题

### 1. `Agent` 同时承担了过多责任

当前 [`src/ai/agent.ts`](../../../src/ai/agent.ts) 同时处理：

- 用户输入写入消息历史
- context compact 判定
- 调用 `ModelAdapter.stream()`
- 累积 assistant blocks
- 串行执行工具
- 合并 usage
- 发 runtime hooks

这使它既像“会话对象”，又像“单次 run 执行器”，还像“事件桥接层”。这种结构在功能较少时可工作，但继续增强后会让测试和修改成本快速升高。

### 2. `chat.ts` 过度了解 runtime 细节

当前 [`src/commands/chat.ts`](../../../src/commands/chat.ts) 直接：

- 自己拼装 `Agent`
- 自己管理技能 reload 后的 prompt 更新
- 直接消费 `StreamChunk`
- 直接把 `tool_started` / `tool_finished` hooks 绑定到 spinner 和状态栏

这意味着 UI 层知道太多 runtime 内部协议。将来只要 agent streaming 或 tool event 稍有变化，`chat.ts` 就得一起改。

### 3. 缺少显式 run 概念

当前系统只有“一个 session 的历史消息”，没有真正的 run 抽象。虽然 `Agent` 内部生成了 `turnId`，但上层并没有围绕“当前活动 run”建立清晰接口。

直接后果：

- 无法干净表达当前是否有活动 run
- 无法提供更明确的 abort 入口
- runtime 状态只能通过副作用推断
- 测试只能围绕 `runTurn()` 黑盒断言，而不是围绕生命周期断言

### 4. custom agent / subagent 仍停留在提示层

当前 `customAgents` 只是被摘要注入 system prompt；`executeSubAgent()` 只是字符串桩实现。这说明 `xiaok` 还没有 runtime 级 agent orchestration，本次也不应假装要直接做那一层。

这反而强化了本设计的边界：本次聚焦 CLI runtime，而不是扩张到多 agent 平台能力。

---

## 参考思想

本次设计明确借鉴本地 `OpenClaw` / `pi-agent-core` 体系的 4 个运行时思想，但只借思想，不借实现：

1. **run 是一等概念**
   - 一次输入对应一个具备生命周期的运行单元，而不是只剩一个 `while` 循环。
2. **session 与 run 分层**
   - session 负责长期状态，run 负责单次执行。
3. **UI 只消费 runtime 事件**
   - UI 不应知道内部到底用了哪种 streaming 细节。
4. **编排层独立于 provider/tool 细节**
   - adapter 处理 provider 差异，registry 处理工具执行，runtime 负责把它们编排起来。

本次不会照搬 `OpenClaw` 的 queue lane、context engine、plugin hooks、agent routing、task ledger 等平台层能力，因为这会把 `xiaok` 从 CLI 工具硬拉成另一个系统。

---

## 设计原则

### 1. 保留已有健康边界

以下模块本次保留为现有职责：

- `ModelAdapter`
- `ToolRegistry`
- `PermissionManager`
- `buildSystemPrompt()`
- 技能加载与 slash command 机制

本次重构只针对 runtime orchestration。

### 2. 引入显式 runtime 分层

将当前 `Agent` 的职责拆成 3 层：

- **Session State**
  - 管理消息历史、usage、compact 结果
- **Run Controller**
  - 管理 run id、abort signal、活动 run 状态
- **Agent Runtime**
  - 执行单次用户输入对应的编排循环

### 3. 让 `Agent` 退化为兼容壳

为了降低改动风险，本次不要求立刻删掉 `Agent`。更稳的做法是：

- 把 `Agent` 变成面向上层的兼容 facade
- 内部委托给新的 runtime 层

这样现有调用方改动最小，也方便增量迁移测试。

### 4. 只服务 CLI chat

第一阶段 runtime 接口只围绕 `xiaok chat` 的需要设计，不为了未来 channel/gateway 提前塞入大量平台能力。

判断标准很明确：

- 如果某个抽象只对 gateway/multi-agent 有价值，而对 CLI chat 没有直接收益，本次不做

---

## 目标架构

### 1. Session State

新增 `AgentSessionState`，负责：

- 保存 `Message[]`
- 保存累计 `UsageStats`
- 执行 `forceCompact()`
- 基于阈值做 compact 判定与消息裁剪

它不负责：

- 直接调用模型
- 执行工具
- 处理 UI

### 2. Run Controller

新增 `AgentRunController`，负责：

- 生成 `runId`
- 保存当前 run 是否 active
- 维护本次 run 的 `AbortController`
- 提供：
  - `startRun()`
  - `abortActiveRun()`
  - `hasActiveRun()`

由于本次只做 CLI chat，同一 session 内同时最多只能有一个活动 run。若调用方在活动 run 期间再次发起执行，应返回明确错误，而不是静默重入。

### 3. Agent Runtime

新增 `AgentRuntime`，负责：

- 接受用户输入并创建 run
- 将输入写入 `AgentSessionState`
- 调用 `ModelAdapter.stream()`
- 将模型流式输出标准化为 runtime 事件
- 收集 `tool_use`
- 串行执行工具并回填 tool result
- 在工具调用后继续迭代，直到模型返回纯文本结束

它不负责：

- 绘制 Markdown
- 操作 spinner/status bar
- 直接读取 skills 或 config 文件

### 4. Runtime Events

新增统一 runtime 事件层，至少包括：

- `run_started`
- `assistant_text`
- `tool_started`
- `tool_finished`
- `usage_updated`
- `compact_triggered`
- `run_completed`
- `run_failed`
- `run_aborted`

其中：

- `assistant_text` 用于 UI 渐进渲染
- `usage_updated` 用于状态栏
- `tool_*` 用于 spinner 和工具可视化
- `run_*` 用于测试和上层控制逻辑

### 5. `chat.ts` 只做装配与消费

`chat.ts` 的职责收敛为：

- 构造 adapter / registry / system prompt / runtime
- 每轮输入前 reload skills 并刷新 prompt
- 订阅 runtime 事件
- 把事件映射到：
  - MarkdownRenderer
  - StatusBar
  - Spinner
  - 错误输出

这意味着 `chat.ts` 不再依赖 runtime 内部的消息数组或 tool loop 细节。

---

## 数据流

目标数据流如下：

```text
用户输入
  -> ChatCommand 调用 AgentRuntime.startRun(input)
  -> RunController 创建 runId / AbortSignal
  -> SessionState 追加 user message
  -> AgentRuntime 调用 ModelAdapter.stream()
  -> 逐步发出 assistant_text / usage_updated / tool_started 等事件
  -> 若有 tool_use:
       -> ToolRegistry.executeTool()
       -> SessionState 追加 tool_result
       -> 继续下一轮模型调用
  -> 无 tool_use:
       -> 发出 run_completed
```

失败路径：

```text
模型异常 / 工具异常 / abort / maxIterations 命中
  -> runtime 结束活动 run
  -> 发出 run_failed 或 run_aborted
  -> 上层决定如何展示错误
```

---

## 兼容策略

### 1. `ModelAdapter` 不改接口

当前 `stream(messages, tools, systemPrompt)` 接口保持不变。原因：

- 这层已经把 OpenAI / Claude 差异隔离得足够清楚
- 本次关注点不是 provider protocol，而是 runtime orchestration

### 2. `ToolRegistry` 先不结构化重写

当前工具执行结果仍保持字符串返回值。runtime 只负责：

- 记录工具开始/结束事件
- 根据是否以 `Error` 开头判断错误态
- 将结果包成 `tool_result` block 写回 session

后续若要引入 richer tool payload，再单独立项。

### 3. `Agent` 暂保留对外入口

为降低迁移面，本次允许保留：

- `runTurn()`
- `forceCompact()`
- `setAdapter()`
- `setSystemPrompt()`
- `getUsage()`

但这些方法内部将不再直接承载全部逻辑，而是委托给新 runtime / session state。

---

## 文件结构

### 新增文件

- `src/ai/runtime/events.ts`
  - 定义 chat runtime 事件类型
- `src/ai/runtime/session.ts`
  - 定义 `AgentSessionState`
- `src/ai/runtime/controller.ts`
  - 定义 `AgentRunController`
- `src/ai/runtime/agent-runtime.ts`
  - 定义 `AgentRuntime` 主编排器
- `tests/ai/runtime/events.test.ts`
  - 校验 runtime 事件类型和基础行为
- `tests/ai/runtime/session.test.ts`
  - 校验消息、usage、compact 逻辑
- `tests/ai/runtime/controller.test.ts`
  - 校验 run lifecycle 和 abort
- `tests/ai/runtime/agent-runtime.test.ts`
  - 校验主编排循环

### 修改文件

- `src/ai/agent.ts`
  - 退化为兼容 facade，内部委托 runtime
- `src/commands/chat.ts`
  - 改为消费 runtime 事件
- `tests/ai/agent.test.ts`
  - 调整为验证 facade 与 runtime 的契约，而不是所有逻辑都压在 `Agent` 类上

### 明确不修改

- `src/commands/yzj.ts`
- `src/channels/*`
- `src/ai/mcp/*`
- `src/ai/agents/subagent.ts`

这些边界由后续工作或其他并行开发负责，本次禁止顺手扩张。

---

## 测试策略

本次实现必须遵循 TDD。

### 第一批失败测试要锁定的行为

#### `AgentSessionState`

- 初始消息为空，usage 为零
- 追加 user/assistant/tool_result 后消息顺序正确
- `forceCompact()` 能保留占位符和最近消息
- 超过阈值时 `shouldCompact` 与 session compact 行为一致

#### `AgentRunController`

- 每次 `startRun()` 生成唯一 `runId`
- 活动 run 期间再次启动会报错
- `abortActiveRun()` 会触发 signal
- run 结束后 active 状态清理

#### `AgentRuntime`

- 纯文本输出时会发出 `run_started -> assistant_text -> run_completed`
- 出现 `tool_use` 时会发出 `tool_started -> tool_finished`
- 工具循环会在 tool result 后继续调用模型
- 收到 usage chunk 时会发出 `usage_updated`
- 命中 compact 时会发出 `compact_triggered`
- 命中 abort 时会发出 `run_aborted`
- 命中 `maxIterations` 时会发出 `run_failed`

#### `chat.ts` 集成

- runtime 的 `assistant_text` 能驱动 MarkdownRenderer
- runtime 的 `usage_updated` 能驱动 StatusBar
- runtime 的 `tool_started` / `tool_finished` 能驱动 spinner

### 回归约束

- 现有 OpenAI / Claude adapter 测试不应回归
- 现有 skill slash 命令路径不应回归
- `forceCompact()` 用户体验保持现状

---

## 风险与取舍

### 1. 保留 `Agent` 兼容层会短期增加一层间接调用

优点：

- 迁移更稳
- 调用面更小

代价：

- 短期会同时存在 runtime 与 facade 两层

这是可以接受的，因为本次目标是稳态重构，不是激进清理。

### 2. 不引入结构化 tool result

优点：

- 与当前工具实现完全兼容
- 不会把本次改造成“大范围协议重写”

代价：

- runtime 事件仍需用较简单的错误约定桥接字符串结果

这属于刻意控制范围，而不是设计缺陷。

### 3. 不把 channel 统一进同一 runtime

优点：

- 避免与正在进行的云之家 channel 开发冲突
- 先把 CLI 核心边界做对

代价：

- 将来如果要统一 CLI 与 channel runtime，还需要第二阶段设计

这也是合理取舍，因为当前用户已经明确要求本次不涉及 channel。

---

## 交付顺序

1. 写并确认本设计文档
2. 基于本设计写 implementation plan
3. 先写 runtime 层失败测试
4. 写最小实现使测试通过
5. 调整 `Agent` facade 与 `chat.ts` 集成
6. 跑核心测试与构建验证

---

## 验收标准

满足以下条件即视为第一阶段完成：

- `xiaok chat` 仍保持现有交互体验
- CLI runtime 具备显式 run 生命周期与 runtime 事件流
- `Agent` 不再承担所有编排逻辑
- `chat.ts` 只消费 runtime 事件，不直接依赖内部 loop 细节
- 新增 runtime 测试通过
- 现有 adapter / skill / agent 基础测试不回归

---

## 后续演进候选

本设计完成后，再单独立项考虑：

- richer tool result payload
- `chat` 的显式 stop/abort 命令
- channel runtime 统一
- 真实 subagent runtime
- context assembly / memory / compaction 策略升级

本次不提前实现这些内容。
