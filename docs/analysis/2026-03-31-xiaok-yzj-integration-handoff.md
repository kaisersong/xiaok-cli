# xiaok YZJ Integration Handoff

日期：2026-03-31

这份文档写给负责主工作区整合的 Codex / Owner A。

## 目标

把 `yzj-channel` worktree 中已经完成的云之家 remote-agent 能力整合回主工作区，并在主工作区重新构建，使本机 `xiaok yzj serve` 直接可用。

## 需要整合的提交

按顺序 cherry-pick 这三个提交：

1. `df5d703639d87d6330788b3ce54e6d64cc8b987e`
   基础 YZJ 通道打通

2. `9a3c004dc833711ae34c0a02b7d03f81a458656d`
   异步任务控制面

3. `8c450c75d09bb20f1662640e86984574e3753151`
   审批回流、工作区绑定、runtime 通知、输出编排

## 功能边界

这三次提交覆盖的 Owner B 范围：

- `src/channels/*`
- `src/commands/yzj.ts`
- `tests/channels/*`

## 未碰的共享文件

本轮没有改这些 single-writer 文件：

- `package.json`
- `src/types.ts`
- `src/commands/chat.ts`

因此正常情况下不应该和 Owner A 的 runtime 重构在这些共享文件上直接冲突。

## 可能会遇到的冲突点

### 1. `src/channels/*`

如果主工作区其他人也动了 channel 目录，需要以主工作区现状为基线，把这三次提交里的功能点吸收进去：

- task store / task manager
- approval store wait/resolve/timeout
- session binding store
- YZJ runtime notifier
- `agent-service` 的 async session factory / abort support

### 2. `src/commands/yzj.ts`

这份文件现在承担的职责明显更多：

- 命令路由
- task manager 接线
- approval 回流
- binding 管理
- session 级 agent/runtime/session-skill-catalog 创建

如果主工作区这份文件已被重写，建议保留主版本整体结构，然后吸收以下能力：

- `parseYZJCommand()` 的命令集
- `TaskManager` 接线
- `InMemoryApprovalStore` + `onPrompt` 等待审批
- `InMemorySessionBindingStore`
- `YZJRuntimeNotifier`
- 长结果格式化逻辑

## 建议整合步骤

### 步骤 1

先在主工作区确认当前分支状态：

```powershell
git status --short
git log --oneline -n 10
```

### 步骤 2

按顺序 cherry-pick：

```powershell
git cherry-pick df5d703639d87d6330788b3ce54e6d64cc8b987e
git cherry-pick 9a3c004dc833711ae34c0a02b7d03f81a458656d
git cherry-pick 8c450c75d09bb20f1662640e86984574e3753151
```

如果发生冲突，优先保留主工作区当前版本的结构，再把 YZJ remote-agent 逻辑补进去，不要直接回退 Owner A 的运行时改动。

### 步骤 3

在主工作区重新构建：

```powershell
npm run build
```

如果项目要求提交 `dist/`，这一步后把更新后的 `dist/` 一并纳入最终整合提交。

### 步骤 4

做最小验证：

```powershell
node dist/index.js yzj serve --help
xiaok yzj config show
xiaok yzj serve "<sendMsgUrl>" --dry-run
```

建议再用真实云之家会话验证：

```text
/help
/bind D:\projects\workspace\xiaok-cli
帮我看看当前工作区有什么未提交改动
/status
```

## 这三次提交带来的最终能力

整合后，YZJ 入口应具备：

- websocket/webhook 双入口
- 普通消息异步任务化
- `/status`
- `/cancel`
- `/approve`
- `/deny`
- `/bind`
- `/skill`
- runtime 过程消息
- 审批等待与超时
- 长输出摘要化

## 当前 worktree 的验证结论

已通过：

- `npm --prefix D:\projects\workspace\xiaok-cli\.worktrees\yzj-channel run build`
- `node D:\projects\workspace\xiaok-cli\.worktrees\yzj-channel\dist\index.js yzj serve --help`
- 基于 `dist` 的 Node 冒烟脚本

未通过但不是代码错误：

- `vitest run`

原因：

- 当前沙箱下 `spawn EPERM`

## 给整合侧的简短判断标准

如果你 cherry-pick 后满足下面四条，说明整合基本正确：

1. `yzj serve --help` 正常
2. 真消息进来后先收到任务 ACK，而不是同步等待完整回复
3. `/bind` `/status` `/approve` `/deny` 有明确回执
4. 需要写/bash 操作时，云之家里会收到审批提示

## 附：本轮文件清单

`9a3c004`：

- `src/channels/agent-service.ts`
- `src/channels/command-parser.ts`
- `src/channels/task-manager.ts`
- `src/channels/task-store.ts`
- `src/commands/yzj.ts`
- `tests/channels/command-parser.test.ts`
- `tests/channels/task-manager.test.ts`

`8c450c7`：

- `src/channels/agent-service.ts`
- `src/channels/approval-store.ts`
- `src/channels/command-parser.ts`
- `src/channels/session-binding-store.ts`
- `src/channels/task-manager.ts`
- `src/channels/task-store.ts`
- `src/channels/types.ts`
- `src/channels/yzj-runtime-notifier.ts`
- `src/commands/yzj.ts`
- `tests/channels/approval-store.test.ts`
- `tests/channels/command-parser.test.ts`
- `tests/channels/session-binding-store.test.ts`
- `tests/channels/task-manager.test.ts`
- `tests/channels/yzj-runtime-notifier.test.ts`

## 结论

Owner B 这边要交付的 YZJ remote-agent 功能已经完成。整合侧现在主要做的是：

1. cherry-pick 这三次提交
2. 解决与主工作区当前 channel/yzj 代码的结构性冲突
3. 在主工作区重新 build
4. 用真实云之家会话回归
