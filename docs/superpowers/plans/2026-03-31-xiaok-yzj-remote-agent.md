# xiaok YZJ Remote Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把当前“已打通收发链路”的 YZJ IM 入口升级为可执行复杂远程任务的 agent surface，补齐异步任务、runtime 事件通知、审批、skill 指令与工作区绑定。

**Architecture:** 继续复用现有 `agent`、`runtime hooks`、`session-store`、`approval-store`，在其上增加 task manager、command parser、session binding 和 YZJ runtime notifier。保持 YZJ adapter 只做 channel 边界，不反向定义 runtime 基础设施。

**Tech Stack:** TypeScript, Node.js, existing `xiaok-cli` runtime, Commander, Vitest, YZJ WebSocket + HTTP webhook

---

## Scope

本计划覆盖：

- task store / task manager
- YZJ command parser
- runtime event -> YZJ 通知桥
- approval / cancel / status 控制面
- skill 命令化入口
- session workspace binding

本计划不包含：

- 数据库持久化
- 多实例调度
- 富文本卡片 UI
- SaaS 控制台

---

## Delivery Sequence

按以下顺序执行：

1. Task Model And Store
2. Command Parser
3. Runtime Event Bridge
4. Approval And Cancellation
5. Skill Command Surface
6. Workspace Binding
7. Output Shaping

---

## Task 1: 建立 Task Store / Manager

**Files:**

- Create: `src/channels/task-store.ts`
- Create: `src/channels/task-manager.ts`
- Create: `tests/channels/task-manager.test.ts`
- Modify: `src/commands/yzj.ts`

- [ ] 定义 `RemoteTask` 数据结构与状态机
- [ ] 提供内存态 CRUD：create / get / update / listBySession / cancel
- [ ] 把 YZJ 普通消息接入 task manager，而不是直接调用 agent
- [ ] 为每条新任务生成 `taskId`
- [ ] 入站后先回“任务已创建”回执

**Exit Criteria:**

- 云之家普通文本创建 `taskId`
- 同一个 session 下可查询最近任务

---

## Task 2: 增加 Command Parser

**Files:**

- Create: `src/channels/command-parser.ts`
- Create: `tests/channels/command-parser.test.ts`
- Modify: `src/commands/yzj.ts`

- [ ] 解析 `/status [taskId]`
- [ ] 解析 `/cancel <taskId>`
- [ ] 解析 `/approve <approvalId>`
- [ ] 解析 `/deny <approvalId>`
- [ ] 解析 `/skill <name> [args...]`
- [ ] 非 `/` 前缀消息保持普通任务输入

**Exit Criteria:**

- 命令层与普通 agent 输入彻底分流

---

## Task 3: Runtime Event Bridge

**Files:**

- Create: `src/channels/yzj-runtime-notifier.ts`
- Modify: `src/runtime/events.ts`
- Modify: `src/commands/yzj.ts`
- Modify: `src/channels/notifier.ts`
- Test: `tests/channels/notifier.test.ts`

- [ ] 订阅 `turn_started`
- [ ] 订阅 `tool_started`
- [ ] 订阅 `tool_finished`
- [ ] 订阅 `approval_required`
- [ ] 订阅 `turn_completed`
- [ ] 为 tool 事件增加节流/聚合策略

**Exit Criteria:**

- 云之家中能看到任务过程，不只看到最终回复

---

## Task 4: 审批与取消

**Files:**

- Modify: `src/channels/approval-store.ts`
- Modify: `src/commands/yzj.ts`
- Modify: `src/channels/task-manager.ts`
- Create: `tests/channels/approval-bridge.test.ts`

- [ ] 当 runtime 发出 `approval_required` 时，task 状态切换为 `waiting_approval`
- [ ] `/approve` / `/deny` 可回流到 runtime
- [ ] `/cancel` 可以真正中断后台任务
- [ ] 超时审批自动失效

**Exit Criteria:**

- 云之家用户可以真正完成一次审批闭环

---

## Task 5: Skill Command Surface

**Files:**

- Modify: `src/commands/yzj.ts`
- Modify: `src/ai/skills/loader.ts`
- Create: `tests/channels/yzj-skill-command.test.ts`

- [ ] `/skill <name>` 转换为结构化 agent 输入
- [ ] skill 不存在时返回明确错误
- [ ] skill 执行开始/结束有独立回执

**Exit Criteria:**

- 云之家中可稳定调用已有 skill，而不是靠自然语言提示“猜着触发”

---

## Task 6: Workspace Binding

**Files:**

- Create: `src/channels/session-binding-store.ts`
- Modify: `src/channels/session-store.ts`
- Modify: `src/commands/yzj.ts`
- Create: `tests/channels/session-binding-store.test.ts`

- [ ] 定义 `session -> cwd/repoRoot/branch` 绑定模型
- [ ] 实现 `/bind <cwd>`
- [ ] 任务执行前读取绑定上下文
- [ ] 未绑定时返回明确错误提示

**Exit Criteria:**

- 同一个云之家 session 能稳定绑定到某个 repo/cwd

---

## Task 7: 输出编排优化

**Files:**

- Modify: `src/channels/yzj-transport.ts`
- Modify: `src/channels/agent-service.ts`
- Modify: `src/commands/yzj.ts`
- Create: `tests/channels/yzj-output-shaping.test.ts`

- [ ] 在 transport 分片之外，补任务结束摘要模板
- [ ] 为失败任务补结构化错误摘要
- [ ] 为长结果补“摘要 + 分片明细”编排

**Exit Criteria:**

- 复杂任务结果在手机端可读，不再只是原始长文本切片

---

## Acceptance Checklist

- [ ] 用户能在云之家发起任务并获得 `taskId`
- [ ] `/status` 能查看进度
- [ ] `/cancel` 能取消任务
- [ ] `/approve` / `/deny` 能处理审批
- [ ] `/skill` 能稳定触发 skill
- [ ] session 可以绑定工作区
- [ ] runtime 关键事件可见
- [ ] 长回复在云之家侧可读

---

## Notes

- 当前已完成的 YZJ WebSocket/Webhook 收发链路，是本计划的前置条件，不属于本计划的交付内容
- 这份计划默认延续单进程内存态实现；若后续任务量扩大，再评估持久化与队列
