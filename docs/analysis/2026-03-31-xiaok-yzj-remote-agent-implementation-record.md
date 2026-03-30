# xiaok YZJ Remote Agent Implementation Record

日期：2026-03-31

## 目标

本轮工作的目标不是继续把云之家入口做成“多回几句”的同步机器人，而是把它升级成一个可远程发起复杂任务的 agent surface。交付范围包括：

- 普通消息任务化
- 异步执行与任务状态跟踪
- `/status` `/cancel` 控制面
- `/approve` `/deny` 审批回流
- `/skill` 显式 skill 触发
- `/bind` 会话工作区绑定
- runtime 过程通知
- 长结果摘要化编排

## 实现思路

### 1. 从同步回复切到任务模型

之前 `yzj serve` 的链路是：

1. 收到消息
2. 直接执行 agent
3. 等待最终文本
4. 回发云之家

这个模型对长任务不成立。现在改成：

1. 收到消息
2. 解析命令层
3. 对普通消息或 `/skill` 创建 `taskId`
4. 先返回任务 ACK
5. 后台异步执行 agent
6. 期间通过 runtime 事件往云之家回推进展
7. 最终回结果，并保留 `/status` 可查询状态

核心文件：

- `src/commands/yzj.ts`
- `src/channels/task-store.ts`
- `src/channels/task-manager.ts`

### 2. 增加显式命令层

移动端上不能把 `/status`、`/bind`、`/approve` 这类控制操作丢给模型猜。新增 `parseYZJCommand()`，把命令层和普通任务彻底分流。

本轮支持的命令：

- `/help`
- `/status [taskId]`
- `/cancel <taskId>`
- `/approve <approvalId>`
- `/deny <approvalId>`
- `/bind <cwd>`
- `/bind clear`
- `/skill <name> [args]`

核心文件：

- `src/channels/command-parser.ts`

### 3. 用 session 绑定工作区

YZJ session 现在可以绑定到一个明确的 `cwd`。绑定后：

- 新建任务会记录 `cwd` / `repoRoot` / `branch`
- Agent session 会按绑定目录重建
- skill catalog 也按绑定目录重新加载
- bash 默认工作目录会落在绑定目录

为避免运行中的 session 被半路切上下文，`/bind` 在当前 session 还有 `queued/running/waiting_approval` 任务时会拒绝切换。

核心文件：

- `src/channels/session-binding-store.ts`
- `src/commands/yzj.ts`

### 4. 把 runtime 事件接到云之家

这轮没有另起一套“YZJ 专用执行模型”，而是继续复用 agent runtime hooks，只是在 channel 侧加一个 `YZJRuntimeNotifier` 订阅并转发关键事件：

- `turn_started`
- `tool_started`
- `tool_finished`
- `approval_required`
- `compact_triggered`

其中 tool 事件做了短时间聚合，避免消息刷屏。

核心文件：

- `src/channels/yzj-runtime-notifier.ts`

### 5. 审批回流

原本 channel 层只有一个简单的 approval store。现在扩展成：

- 审批单带 `createdAt` / `expiresAt`
- 支持等待决策 Promise
- 支持超时失效
- agent 在 `onPrompt` 时不再直接交互确认，而是：
  1. 生成 approval
  2. 发 `approval_required`
  3. 等待 `/approve` 或 `/deny`
  4. 继续或拒绝工具调用

任务状态也会切到 `waiting_approval`，并在审批回流后恢复到 `running`。

核心文件：

- `src/channels/approval-store.ts`
- `src/commands/yzj.ts`
- `src/channels/task-manager.ts`

### 6. 输出编排

为了适配手机端：

- 任务最终结果会带 `taskId`
- 长文本结果会带“任务完成 + 摘要 + 详细结果”编排
- 任务状态页会展示：
  - 工作区
  - 分支
  - 最近进展
  - 审批单
  - 回复摘要
  - 错误信息

## 本轮主要改动文件

代码：

- `src/commands/yzj.ts`
- `src/channels/agent-service.ts`
- `src/channels/approval-store.ts`
- `src/channels/command-parser.ts`
- `src/channels/session-binding-store.ts`
- `src/channels/task-manager.ts`
- `src/channels/task-store.ts`
- `src/channels/types.ts`
- `src/channels/yzj-runtime-notifier.ts`

测试：

- `tests/channels/approval-store.test.ts`
- `tests/channels/command-parser.test.ts`
- `tests/channels/session-binding-store.test.ts`
- `tests/channels/task-manager.test.ts`
- `tests/channels/yzj-runtime-notifier.test.ts`

## 提交记录

本轮 Owner B 范围内的功能分成两次提交：

1. `9a3c004dc833711ae34c0a02b7d03f81a458656d`
   内容：异步任务控制面，包含 `/help` `/status` `/cancel` `/skill`

2. `8c450c75d09bb20f1662640e86984574e3753151`
   内容：审批回流、工作区绑定、runtime 通知、输出编排

加上前置通道打通提交：

3. `df5d703639d87d6330788b3ce54e6d64cc8b987e`
   内容：YZJ websocket/webhook 收发链路和基础 channel 接入

## 验证情况

已完成：

- `npm --prefix D:\projects\workspace\xiaok-cli\.worktrees\yzj-channel run build`
- `node dist/index.js yzj serve --help`
- 基于 `dist` 的 Node 冒烟脚本
  覆盖：
  - `/approve`
  - `/bind`
  - approval 等待与 resolve
  - runtime notifier 的开始执行 / 待审批通知

未完成：

- `vitest run`

原因：

- 当前沙箱环境里 `vitest` fork worker 会报 `spawn EPERM`
- 所以测试文件已经补齐，但本次会话只能用 `build + node smoke` 替代

## 约束与未决项

### 1. 未直接写入用户真实配置文件

本次会话的 sandbox / approval policy 不允许我直接写：

- `C:\Users\song\.xiaok\config.json`

所以 webhook URL 只能通过用户本机命令或后续允许提权的会话写入。

### 2. 尚未集成回主工作区

当前改动都在：

- `D:\projects\workspace\xiaok-cli\.worktrees\yzj-channel`

并已提交为小提交，等待 Owner A 或另一个 Codex cherry-pick 集成。

### 3. `dist/` 仍是本地构建产物

本 worktree 已构建，`dist/` 已更新，但这些生成文件当前没有随这两次功能提交一起进入 git。最终是否把 `dist/` 提交进主仓库，应由整合侧按项目惯例处理。

## 当前可用的云之家侧交互

一旦整合并构建到主工作区，YZJ 入口可以支持：

```text
帮我排查当前工作区的构建错误
/status
/status task_3
/cancel task_3
/bind D:\projects\workspace\xiaok-cli
/bind clear
/skill review 看下当前改动能不能合并
/approve approval_2
/deny approval_2
```

## 结论

这轮交付后，YZJ 入口已经从“能回消息”升级成“能远程发任务、看进展、做审批、绑定工作区”的最小 remote-agent 面板。

后续再往前走，优先级应该是：

1. 集成回主工作区并重新 build
2. 在真机云之家里做端到端回归
3. 视体验决定是否继续做更细的事件节流、卡片化输出和持久化 task store
