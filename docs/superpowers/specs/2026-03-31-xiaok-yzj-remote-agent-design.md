# xiaok YZJ Remote Agent Design

**日期：** 2026-03-31  
**状态：** Draft

---

## 概述

`xiaok-cli` 已经具备云之家（YZJ）IM 的 WebSocket / Webhook 双入口能力，能够完成：

- 云之家消息入站
- session 复用
- 模型生成
- 文本回包

这只能证明“入口已打通”，还不能支持真正的远程复杂任务。当前移动端体验仍然停留在“像聊天机器人一样接一句、回一句”，缺少：

- 长任务的异步执行与状态跟踪
- tool 过程可视化
- 审批回流
- skill 友好的触发方式
- 工作区绑定

本设计文档定义下一阶段的目标：把 YZJ IM 入口从“可聊天”升级为“可远程干活”的 agent surface。

---

## 目标

### 产品目标

- 允许用户在云之家中发起真实编码/调试/文档任务
- 用户能够看到任务状态，而不只是最终结果
- 长任务不阻塞单次消息回包链路
- 云之家中可以触发 skill、审批、查询状态、取消任务
- 同一会话可绑定到本地 repo / cwd / branch，上下文持续可用

### 工程目标

- 复用现有 `runtime hooks`、`session-store`、`approval-store`、`agent` 基础设施
- YZJ adapter 不反向定义 runtime 基础层
- 保持 CLI 模式与 YZJ 模式共享同一 agent runtime
- 先做单机单进程版本，再考虑多实例/持久队列

---

## 非目标

- 不做富文本卡片设计器
- 不做完整的云之家应用管理后台
- 不做多租户 SaaS 控制台
- 不在这一阶段引入外部消息队列或数据库
- 不实现“任意时刻恢复历史任务结果”的完整持久化产品体验

---

## 问题定义

当前 YZJ 接入存在 5 个核心短板：

1. **任务是同步思维，不是异步任务模型**
   当前收到消息后立即执行 agent，并把最终文本直接回发。对长任务来说，这个模型过于脆弱。

2. **移动端看不到中间过程**
   `tool_started` / `tool_finished` / `approval_required` / `compact_triggered` 等 runtime 事件只在本地存在，云之家侧不可见。

3. **skill 只能“靠 prompt 猜”**
   用户理论上可以发 `/skill` 文本，但没有可靠的命令语义层，也没有移动端友好的回执与错误提示。

4. **复杂任务没有“任务句柄”**
   用户无法查询“这个任务现在到哪一步了”“最近一次失败是什么”“需不需要我审批”。

5. **缺少会话到工作区的绑定**
   如果一个云之家群里同时谈多个项目，当前系统没有显式机制区分任务应落到哪个 cwd / repo / branch。

---

## 核心设计决策

### 1. 从“消息响应”升级到“任务响应”

YZJ 入口不再把每条消息都视为一次简单聊天，而是视为：

- 新任务创建
- 已有任务继续追问
- 对系统命令的调用
- 对审批/取消等控制面的操作

每个远程任务都有 `taskId`，日志和通知围绕 `taskId` 展开。

### 2. 先做进程内异步任务，再做持久化队列

首版采用单进程内存态：

- 入站消息快速 ACK
- 创建任务记录
- agent 在后台异步执行
- runtime 事件实时推送到 YZJ

理由：

- 当前 `xiaok-cli` 仍是单机 CLI 工具
- 先验证产品交互和 runtime 边界，比先引入数据库/队列更重要

### 3. YZJ 作为 runtime 事件订阅者，而不是专用 agent 分支

YZJ 不单独定义另一套 agent 执行模型；它只订阅并转发既有 runtime 事件：

- `turn_started`
- `tool_started`
- `tool_finished`
- `approval_required`
- `turn_completed`
- `compact_triggered`

这样 CLI、本地 UI、未来 Web UI、YZJ IM 看到的是同一条真实事件流。

### 4. skill / control 使用显式命令层

不把 `/status`、`/cancel`、`/approve`、`/skill xxx` 混在普通自然语言推理里，而是先做一层命令解析，再决定是否进入 agent。

这样能显著降低移动端误判。

### 5. 会话必须支持工作区绑定

一个 YZJ session 不只是 `chatId + userId`，还应额外关联：

- `cwd`
- `repoRoot`
- `branch`
- 可选 `agentProfile`

这样复杂任务才能有稳定执行上下文。

---

## 用户体验

### 1. 发起复杂任务

用户在云之家中发送：

```text
帮我排查 xiaok-cli 为什么在 Windows 上 npm run build 会失败
```

系统立即回：

```text
已创建任务 task_12
项目：D:\projects\workspace\xiaok-cli
状态：排队中
可发送 /status task_12 查看进度
```

后台开始执行 agent，后续事件持续推送。

### 2. 查看任务状态

用户发送：

```text
/status task_12
```

系统返回：

- 当前阶段
- 最近一次工具调用
- 最近错误
- 是否等待审批
- 最后更新时间

### 3. 触发 skill

用户发送：

```text
/skill review 看一下当前工作区改动是否能合并
```

系统立即回：

```text
已启动 skill：review
任务：task_13
```

### 4. 审批

当 agent 发出 `approval_required` 时，云之家收到：

```text
任务 task_12 需要审批
操作：bash
摘要：git push origin feature/yzj
发送 /approve appr_7 或 /deny appr_7
```

### 5. 取消任务

用户发送：

```text
/cancel task_12
```

系统取消后台任务，并回：

```text
任务 task_12 已取消
```

---

## 命令面设计

### 命令总览

```text
/status [taskId]
/cancel <taskId>
/approve <approvalId>
/deny <approvalId>
/skill <name> [args...]
/bind [cwd|repo]
/help
```

### 命令语义

- `/status`
  查看当前 session 最近任务，或指定任务
- `/cancel`
  请求取消后台运行中的任务
- `/approve` / `/deny`
  处理 runtime approval
- `/skill`
  以显式 skill 模式触发 agent
- `/bind`
  绑定当前 session 的工作区
- `/help`
  返回移动端支持的命令与示例

### 命令解析优先级

1. 先检查是否匹配显式命令
2. 若不是命令，则视为普通 agent 任务
3. skill 命令转换为结构化 agent 输入，而不是裸文本透传

---

## 系统架构

### 逻辑层

1. **YZJ ingress**
   负责 WebSocket/Webhook 收包、签名校验、去重、命令解析

2. **Task manager**
   负责创建任务、跟踪状态、取消、超时、session 关联

3. **Runtime event bridge**
   把 agent runtime events 映射为 YZJ 侧的状态通知

4. **Approval bridge**
   把审批项暴露到 YZJ，并接收 `/approve` `/deny`

5. **Workspace binding**
   管理 session -> repo/cwd 的绑定

6. **YZJ outbound transport**
   负责分片发送、节流、错误重试、引用回复

### 数据流

```text
YZJ message
  → protocol adapter
  → command parser
  → task manager
  → agent runtime
  → runtime events
  → YZJ notifier
  → YZJ IM
```

---

## 数据模型

### RemoteTask

```ts
interface RemoteTask {
  taskId: string;
  sessionId: string;
  channel: 'yzj';
  status: 'queued' | 'running' | 'waiting_approval' | 'completed' | 'failed' | 'cancelled';
  prompt: string;
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  finishedAt?: number;
  replySummary?: string;
  errorMessage?: string;
  approvalId?: string;
  cwd?: string;
  branch?: string;
}
```

### SessionBinding

```ts
interface SessionBinding {
  sessionId: string;
  channel: 'yzj';
  chatId: string;
  userId?: string;
  cwd?: string;
  repoRoot?: string;
  branch?: string;
  updatedAt: number;
}
```

### TaskEventSnapshot

```ts
interface TaskEventSnapshot {
  taskId: string;
  phase: string;
  toolName?: string;
  approvalId?: string;
  message: string;
  at: number;
}
```

---

## Runtime 事件到云之家通知的映射

| Runtime Event | YZJ 展示 |
|---|---|
| `turn_started` | 任务开始，显示 `taskId` |
| `tool_started` | 正在执行某工具 |
| `tool_finished` | 工具成功/失败 |
| `approval_required` | 发送审批指令提示 |
| `compact_triggered` | 提示上下文已压缩 |
| `turn_completed` | 任务完成，显示摘要 |

### 通知节流

不能把每个 event 都无脑发到云之家，否则会刷屏。

首版策略：

- `turn_started` 必发
- `approval_required` 必发
- `turn_completed` / `failed` 必发
- `tool_started/tool_finished` 走节流
  例如每 2-3 秒聚合成一条“最近进展”

---

## 异步任务模型

### 状态机

```text
queued
  → running
  → waiting_approval
  → running
  → completed

queued/running/waiting_approval
  → failed
  → cancelled
```

### 创建策略

- 普通文本消息默认创建任务
- 若当前 session 存在运行中的任务：
  - 默认创建新任务，而不是插队进入旧任务
  - 后续可增加“继续当前任务”模式

### 取消策略

- 取消请求发给 task manager
- task manager 转发给对应 agent 的 `AbortController`
- 取消成功后发出 `cancelled` 通知

---

## 工作区绑定

### 为什么必须做

没有 workspace binding，远程复杂任务只知道“收到一句话”，不知道应该在哪个 repo 里执行。

### 绑定方式

首版支持：

```text
/bind D:\projects\workspace\xiaok-cli
```

系统校验路径存在、可读，然后把它绑定到当前 YZJ session。

后续可扩展：

- `/bind repo xiaok-cli`
- `/bind branch feature/yzj`
- `/bind clear`

### 回退策略

若 session 未绑定工作区：

- 仍允许普通问答
- 对需要工作区的任务直接回错误提示
- 引导用户先 `/bind`

---

## 审批模型

### 当前问题

现有 `approval-store` 能在本地持有审批，但 YZJ 还没有控制面。

### 设计

- 当 `approval_required` 事件发出时，task 状态切换到 `waiting_approval`
- YZJ 收到一条结构化文本提示
- 用户发送 `/approve appr_x` 或 `/deny appr_x`
- 系统把决策传回 runtime

### 约束

- 审批消息必须包含唯一 `approvalId`
- 审批只能执行一次
- 超时审批自动失效

---

## 长回复策略

### 当前问题

单条文本很容易过长，复杂任务结果会导致：

- 云之家文本过长
- 手机端难以阅读
- 失败时难以定位是哪段出问题

### 设计

- transport 层负责按字符上限切片
- 优先按段落/换行切分
- 每片都保留回复引用上下文
- 最终在日志中记录：
  - `chunks`
  - `replyChars`
  - `outboundMs`

### 后续升级

复杂任务输出不应只靠切片，而应升级为：

- 摘要
- 关键日志
- 文件改动
- 下一步建议

---

## 文件结构建议

### 新增

- `src/channels/task-store.ts`
- `src/channels/task-manager.ts`
- `src/channels/command-parser.ts`
- `src/channels/session-binding-store.ts`
- `src/channels/yzj-runtime-notifier.ts`
- `tests/channels/task-manager.test.ts`
- `tests/channels/command-parser.test.ts`
- `tests/channels/session-binding-store.test.ts`

### 修改

- `src/commands/yzj.ts`
- `src/channels/agent-service.ts`
- `src/channels/notifier.ts`
- `src/runtime/events.ts`
- `src/ai/agent.ts`

---

## 分阶段交付

### Phase A: 控制面最小闭环

- `/status`
- `/cancel`
- `/approve`
- `/deny`
- task store（内存）

### Phase B: runtime 事件通知

- `tool_started/tool_finished`
- `approval_required`
- `turn_completed`
- 事件节流

### Phase C: skill 入口

- `/skill <name> [args]`
- skill 成功/失败回执
- skill 与普通任务的显示区分

### Phase D: 工作区绑定

- `/bind`
- session -> cwd 持久化
- 未绑定工作区的错误提示

### Phase E: 输出编排优化

- 长回复摘要化
- 任务结束报告模板

---

## 风险与权衡

### 1. 事件过多导致刷屏

解决：

- 节流与聚合
- 把“阶段变化”视为一级消息，tool 细节视为二级消息

### 2. 内存态 task store 在重启后丢失

接受：

- 首版优先验证产品交互
- 后续如有必要再持久化

### 3. 用户误把自然语言当命令

解决：

- 仅 `/` 前缀走命令解析
- 其余保持普通 agent 输入

### 4. 远程执行风险更高

解决：

- 审批模型必须可回流
- 后续要支持 session 级权限策略

---

## 成功标准

以下都满足时，认为“YZJ 远程复杂任务”首版成立：

- 用户能从云之家发起长任务，并得到 `taskId`
- 用户能通过 `/status` 查看任务进展
- 用户能处理审批与取消
- tool 过程可以被节流后同步到云之家
- skill 能通过显式命令触发
- 同一 session 绑定工作区后，可持续执行复杂任务

---

## 结论

YZJ 集成的下一步，不应该继续围绕“怎么再多回几句文本”，而应该升级为：

**把云之家会话建成 `xiaok` 的远程任务面板。**

只有当任务、状态、审批、skill、工作区绑定都进入同一套模型，云之家入口才真正具备“远程复杂任务”能力。
