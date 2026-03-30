# xiaok Clio Adoption Wave 2 Workflow and Operator Experience Design

**Context**

第二轮在第一轮 runtime 基础上，补“人机协作工作流”。目标不是继续堆工具，而是让 `xiaok` 能在复杂任务里显式管理计划、任务、人工输入、git 工作流与 operator hooks。

## Goal

把 `xiaok` 从“能跑工具的 chat”升级为“可控的工程工作台”。重点是 plan mode、任务编排、ask-user、git 工作流、hooks、权限 UX 与操作者命令面。

## In Scope

本轮覆盖以下 Clio 能力：

- EnterPlanMode / ExitPlanMode
- AskUserQuestion
- TaskCreate / TaskUpdate / TaskList / TaskGet
- Git workflow commands
  - `/commit`
  - `/pr`
  - `/review`
- Hooks
  - pre-hooks / post-hooks
  - settings 驱动
- 权限体验增强
  - default / auto / plan 完整收敛
  - allow / deny rules CLI 配置
  - Shift+Tab 循环切换模式
- Operator commands
  - `/doctor`
  - `/settings`
  - `/init`
  - `/context`
- Input / UI 增强
  - Undo / Redo
  - 可配置 keybindings
  - Status bar 字段配置
- Extended thinking
  - CLI flag / config budget
  - 仅在 provider 支持时启用

## Explicit Non-Goals

- 不做 plugins / LSP / teams / background agents
- 不做 sandbox engine 重构
- 不做完整 cloud task backend
- 不做成本显示

## Design Principles

1. 计划模式必须是真只读，不是“只是少用写工具”。
2. task system 要同时服务 CLI 与 YZJ，不做两个平行体系。
3. hooks 只能做边界扩展，不能把核心控制流藏进 shell 脚本。
4. git workflow 命令先做本地可验证的窄实现，不直接耦合复杂平台 API。

## Feature Mapping

### 1. Plan Mode

把当前 `PermissionManager` 的 `plan` 模式升级为显式 workflow 状态：

- CLI slash command 可进入 / 退出
- tool schema 对模型可见
- write / edit / bash 在 plan mode 下被系统性拒绝
- UI 要明确展示当前处于 plan mode

### 2. AskUserQuestion

新增 safe tool，让 agent 在运行过程中可显式暂停并向用户提问。CLI 侧需要：

- 显示问题
- 阻塞等待回答
- 把回答作为 tool result 回灌模型

YZJ 侧先不复用此交互流程，但 task model 需兼容未来远程问答。

### 3. Task Management

本轮把现有 YZJ task store / task manager 提升为 shared task subsystem：

- CLI tasks
- YZJ tasks
- future sub-agent tasks

要求：

- 统一 task model
- 支持 progress note
- 支持 owner/session/source
- slash command 与 tool 双入口都可操作

### 4. Git Workflow

新增 `/commit`、`/review`、`/pr` 三类命令：

- `/commit`
  - 分析 staged diff
  - 生成 message
  - 执行非交互 commit
- `/review`
  - 汇总当前 diff 风险
- `/pr`
  - 先生成 title/body
  - 若本机有 `gh` 再执行创建

### 5. Hooks

在 settings 中新增 hook 配置：

- pre-hooks
- post-hooks
- tool filter
- timeout

执行语义：

- pre hook 非零退出阻止工具执行
- post hook 非零退出只记录 warning

### 6. Permission UX

现有权限系统已有基础模式和 allow rules，本轮补：

- CLI flags 级 allow/deny 注入
- UI 快捷切换
- 统一规则匹配行为
- 审批提示输出更清晰

### 7. Operator Commands and UI

补系统诊断和配置可见性：

- `/doctor`
- `/settings`
- `/context`
- `/init`

同时补输入体验：

- undo/redo
- keybindings config
- status bar fields config

## Architecture

新增或重构以下单元：

- `src/runtime/tasking/*`
  - shared task types / store / manager
- `src/ai/tools/ask-user.ts`
- `src/ai/tools/tasks.ts`
- `src/commands/git-commit.ts`
- `src/commands/git-review.ts`
- `src/commands/git-pr.ts`
- `src/runtime/hooks-runner.ts`
- `src/runtime/keybindings.ts`
- `src/runtime/settings-view.ts`

重构点：

- `src/ai/permissions/manager.ts`
  - 从简单判定器升级为支持 CLI rules / mode transition 的 manager
- `src/commands/chat.ts`
  - 支持更多 slash commands 与 ask-user loop
- `src/channels/task-manager.ts`
  - 迁移到 shared task subsystem 或封装成 adaptor

## Testing Strategy

- plan mode denial tests
- ask-user integration tests
- task tool tests
- shared task store migration tests
- git workflow command tests
- hook runner tests
- input undo/redo tests
- keybindings config tests

## Exit Criteria

- agent 可主动向用户提问并继续
- plan mode 成为显式工作流状态
- task 系统可被 CLI 与 YZJ 共用
- `/commit` `/review` `/pr` 至少具备本地可执行窄路径
- hooks 可对工具执行前后生效
- operator 命令可诊断当前环境与上下文

