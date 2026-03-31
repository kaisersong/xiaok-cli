# xiaok-cli

[English](./README.md) | 简体中文

`xiaok-cli` 是一个面向金蝶云之家开发者的 AI 编程命令行工具。它同时提供本地终端助手、skill 机制，以及云之家 IM 网关，让同一套 agent runtime 能在终端和移动端会话里复用。

当前这套 runtime 已经不只是一个本地对话壳。终端和 IM 会话现在共用一层平台运行时，包含持久化通道状态、可恢复任务元数据、后台 subagent 执行、worktree 隔离，以及插件驱动的 MCP/LSP 集成。

## 能做什么

- 在终端里运行交互式 AI 编程助手
- 支持 Claude 和 OpenAI 适配器
- 加载内置、全局和项目级 skills
- 通过共享 agent runtime 执行文件、搜索、shell 等工具
- 支持会话持久化、恢复和分叉
- 自动把项目指令文件和 git 上下文注入 runtime
- 支持 print/json 单次输出、图片输入，以及 web fetch/search 工具
- 通过 WebSocket 或 webhook 接入云之家 IM
- 把云之家消息转成带状态、审批和工作区绑定的异步任务
- 云之家会话、reply target、审批单、任务和去重状态可跨重启持久化
- 通过共享 registry 把声明式 subagent 接到前台/后台执行链路，并支持独立 worktree
- 通过插件声明加载 MCP、LSP、hooks 和 skills 到共享平台 runtime

## 项目能力

### 本地 CLI

- `xiaok` 或 `xiaok chat`
- 交互式对话模式
- 单次任务模式
- `-p` / `--json` 打印模式
- `--resume <id>` / `--fork-session <id>`
- 支持本地图片路径输入到多模态模型
- 斜杠命令触发 skills
- `/mode [default|auto|plan]`
- `/tasks`
- `/task <id>`
- 带权限控制的工具调用
- `ask_user` 工具，可在运行中向操作者提问
- 会话级 `task_create` / `task_update` / `task_list` / `task_get`
- 按模型能力调整上下文策略，并支持 prompt caching
- 自动加载 `AGENTS.md`、`CLAUDE.md`、git 分支、脏状态和最近提交
- `web_fetch` / `web_search`
- read/glob/grep/bash 共享截断与分页输出
- 共享平台 runtime，统一装配 MCP/LSP/plugin 能力
- 声明式 subagent，可按需后台运行
- 支持 worktree 隔离的 subagent 执行

### 云之家 IM 网关

- `xiaok yzj serve`
- WebSocket 入站
- webhook fallback 入站
- 普通消息异步任务化
- `/help`
- `/status [taskId]`
- `/cancel <taskId>`
- `/approve <approvalId>`
- `/deny <approvalId>`
- `/bind <cwd>`
- `/bind clear`
- `/skill <name> [args]`
- runtime 过程通知
- 审批等待与回流
- 长结果摘要化输出
- 会话绑定、reply target、审批单、任务和入站去重的持久化
- 审批、任务、后台任务在重启后的中断收敛
- `/status` 输出会话级运行时快照
- 共享 runtime 中可装配插件提供的 MCP 工具和 LSP 诊断

## 环境要求

- Node.js 20+
- Windows、macOS 或 Linux
- 可用的 Claude 或 OpenAI API Key
- 如果要接入云之家 IM，需要有效的机器人 `sendMsgUrl`

## 安装

```bash
npm install
npm run build
```

从源码直接运行：

```bash
npm run dev -- --help
```

运行构建产物：

```bash
node dist/index.js --help
```

当前分支包版本：`0.1.2`

## 配置

默认配置文件位置：

- Windows：`%USERPROFILE%\.xiaok\config.json`
- macOS/Linux：`~/.xiaok/config.json`

也可以通过环境变量覆盖配置目录：

```bash
XIAOK_CONFIG_DIR=/path/to/config
```

配置示例：

```json
{
  "schemaVersion": 1,
  "defaultModel": "claude",
  "models": {
    "claude": {
      "model": "claude-opus-4-6",
      "apiKey": "your-api-key"
    }
  },
  "defaultMode": "interactive",
  "contextBudget": 4000,
  "channels": {
    "yzj": {
      "sendMsgUrl": "https://www.yunzhijia.com/gateway/robot/webhook/send?...",
      "inboundMode": "websocket",
      "webhookPath": "/yzj/webhook",
      "webhookPort": 3001
    }
  }
}
```

## 基本使用

启动交互模式：

```bash
xiaok
```

执行单次任务：

```bash
xiaok "review the current workspace changes"
```

查看聊天命令帮助：

```bash
xiaok chat --help
```

## Skills

skills 会从以下位置加载：

- 内置 skill 目录：`data/skills`
- 用户全局 skill：`~/.xiaok/skills`
- 项目本地 skill：`<repo>/.xiaok/skills`

示例：

```text
/review 看一下当前改动是否适合合并
/deploy 生成一份发布检查清单
```

## 文档工作流

`xiaok-cli` 的项目文档现在放在同级仓库路径 `../mydocs/xiaok-cli`。

- 当前仓库里的 `docs` 是指向 `../mydocs/xiaok-cli` 的符号链接
- 文档内容提交到 `mydocs` 仓库
- 代码、测试和运行时改动继续提交到 `xiaok-cli` 仓库

本地 pre-commit hook 会阻止把 `docs/...` 实体内容重新提交回 `xiaok-cli`，避免两个仓库再次漂移。

## 云之家接入

先配置云之家机器人 `sendMsgUrl`：

```bash
xiaok yzj config set-send-msg-url "https://www.yunzhijia.com/gateway/robot/webhook/send?..."
xiaok yzj config set-inbound-mode websocket
```

查看当前配置：

```bash
xiaok yzj config show
```

启动网关：

```bash
xiaok yzj serve
```

也可以直接在命令里传 URL：

```bash
xiaok yzj serve "https://www.yunzhijia.com/gateway/robot/webhook/send?..."
```

只验证链路、不实际调用模型时：

```bash
xiaok yzj serve "https://www.yunzhijia.com/gateway/robot/webhook/send?..." --dry-run
```

### 云之家里的常见命令

```text
/help
/bind D:\projects\workspace\xiaok-cli
帮我看看当前工作区的构建错误
/status
/status task_3
/approve approval_2
/deny approval_2
/cancel task_3
/skill review 看下当前 diff 是否安全
```

### 持久化状态与恢复语义

云之家网关的运行状态存放在 `~/.xiaok/state/yzj`，包括：

- 会话到频道的映射
- 任务元数据与任务状态
- 待审批记录
- 最近一次 reply target
- 入站消息去重记录

工作区级的平台状态存放在 `<workspace>/.xiaok/state`，包括：

- 后台任务元数据
- agent team 与消息状态
- MCP/LSP 的能力健康快照

如果进程在任务、审批或后台任务未完成时重启，runtime 会把它们收敛为“已中断”状态，而不是无限挂起。随后 `/status` 会用用户可读的快照把这些恢复信息展示出来。

## 开发

构建：

```bash
npm run build
```

测试：

```bash
npm test
```

监听测试：

```bash
npm run test:watch
```

## 目录结构

```text
src/
  ai/          agent runtime、模型适配器、tools、skills
  auth/        认证与 token 存储
  channels/    channel 网关、任务/审批/session 抽象
  commands/    CLI 命令入口
  platform/    共享 runtime 装配：plugins、MCP、LSP、sandbox、teams、worktrees
  runtime/     runtime event hooks
  ui/          终端 UI
  utils/       配置和辅助工具
tests/
docs/
data/
```

## 架构说明

- 终端 CLI 和云之家网关复用同一套核心 agent runtime 与平台 registry 装配
- channel 集成位于边界层 `src/channels`
- 共享 tasking 基础设施位于 `src/runtime/tasking`
- 工作区平台状态存放在 `<cwd>/.xiaok/state`
- 云之家网关状态存放在 `~/.xiaok/state/yzj`
- runtime events 会被复用为移动端进展通知

## 当前限制

- `ask_user` 只在带 TTY 的交互式 CLI 里可用
- 云之家接入当前主要面向文本工作流，还没有做富文本卡片
- `/status` 当前更偏向运维排障快照，而不是富交互面板
- 在受限 Windows 沙箱里，`vitest` 可能会报 `spawn EPERM`
- 工作区外的用户配置文件修改，可能需要在本机直接执行命令

## 相关文档

- [YZJ remote-agent 实现记录](./docs/analysis/2026-03-31-xiaok-yzj-remote-agent-implementation-record.md)
- [YZJ 集成交接说明](./docs/analysis/2026-03-31-xiaok-yzj-integration-handoff.md)
- [YZJ remote-agent 实施计划](./docs/superpowers/plans/2026-03-31-xiaok-yzj-remote-agent.md)
- [YZJ remote-agent 设计文档](./docs/superpowers/specs/2026-03-31-xiaok-yzj-remote-agent-design.md)
