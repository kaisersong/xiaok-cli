# xiaok Clio Adoption Wave 3 Agent Platform Design

**Context**

第三轮才进入“平台层”。这部分最容易失控，因此本设计明确要求在前两轮 runtime 与 workflow 稳定后再做。目标是把 `xiaok` 从单 agent CLI 扩展成多 agent、本地插件、LSP 与更强 sandbox 的平台。

## Goal

引入 background agents、worktree isolation、agent teams、plugin system、LSP integration、完整 MCP runtime 与 sandboxing 强化，形成可扩展 agent platform。

## In Scope

本轮覆盖以下 Clio 能力：

- Background Agents
- Worktree Isolation
- Agent Teams
- Plugin System
- LSP Integration
- Sandboxing 强化
- MCP Support 完整化
  - server lifecycle
  - stdio transport
  - tool discovery and invocation
- Custom Agents 强化
  - frontmatter 扩展
  - tool/model/isolation/background policy

## Explicit Non-Goals

- 不做 SaaS / cloud agent orchestration
- 不做分布式队列
- 不做成本中心、账单和多租户
- 不做 IDE 内嵌 UI

## Design Principles

1. agent platform 必须以隔离为核心，而不是先做协作花样。
2. 插件系统只允许声明式扩展，不允许随意侵入核心控制流。
3. LSP 与 MCP 都是 capability provider，不直接成为核心 runtime 的硬依赖。
4. sandboxing 规则要先服务本地安全与可解释性，再考虑“更聪明的自动化”。

## Feature Mapping

### 1. Background Agents

在 `Agent` / `AgentRuntime` 之上增加 job runner：

- 前台任务继续走当前 CLI turn
- 后台任务以 job id 持久化
- 完成后通知 CLI / YZJ

### 2. Worktree Isolation

sub-agent 默认可选独立 worktree 执行，要求：

- 自动创建/复用工作树
- 绑定 branch naming 规则
- 记录 owner / source task / cleanup policy

### 3. Agent Teams

在 background agents 基础上新增 team abstraction：

- TeamCreate
- TeamDelete
- SendMessage

重点不是 UI，而是：

- 消息路由
- 成员状态
- team-scoped memory / task link

### 4. Plugin System

采用 manifest 驱动：

- `plugin.json`
- skills
- agents
- hooks
- MCP servers
- commands injection

插件加载顺序、命名冲突、权限范围都要明确定义。

### 5. LSP Integration

引入 `LspManager` / `LspClient`：

- 启动语言服务
- 采集 diagnostics
- 把 diagnostics 摘要注入系统提示或 operator 命令输出

先做 diagnostics read-only，不在本轮做 code action 自动执行。

### 6. MCP Runtime Completion

当前 `src/ai/mcp/client.ts` 只有 schema 归一化，本轮补：

- server config
- stdio lifecycle
- initialize / tools/list / tools/call
- `mcp__server__tool` 命名约定
- 故障隔离与超时

### 7. Sandboxing

在现有 workspace 限制与 permissions 之上，补：

- path allowlist / denylist
- environment filtering
- network policy
- resource limits
- worktree-aware path scope

## Architecture

新增平台层目录建议：

- `src/platform/agents/*`
- `src/platform/worktrees/*`
- `src/platform/teams/*`
- `src/platform/plugins/*`
- `src/platform/lsp/*`
- `src/platform/sandbox/*`
- `src/ai/mcp/runtime/*`

与现有代码的关系：

- `src/ai/agent.ts` / `src/ai/runtime/*`
  - 继续承担单 agent runtime
- 平台层负责 orchestration、isolation、capability attachment
- YZJ / CLI 作为上层入口，各自决定何时调用 background/team/plugin 能力

## Testing Strategy

- background job lifecycle tests
- worktree isolation tests
- team messaging tests
- plugin manifest loading tests
- LSP framing / diagnostics tests
- MCP server lifecycle tests
- sandbox path/env/network policy tests

## Exit Criteria

- 能启动 isolated background agent 并拿到完成通知
- 能通过 MCP runtime 调用外部 server tools
- 能加载本地 plugin 并注入 skills / commands / agents
- 能采集 LSP diagnostics 并暴露给 agent/operator
- sandbox policy 对不同入口和 worktree 可解释、可测试

