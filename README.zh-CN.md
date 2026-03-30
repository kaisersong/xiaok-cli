# xiaok-cli

[English](./README.md) | 简体中文

`xiaok-cli` 是一个面向金蝶云之家开发者的 AI 编程命令行工具。它同时提供本地终端助手、skill 机制，以及云之家 IM 网关，让同一套 agent runtime 能在终端和移动端会话里复用。

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
  runtime/     runtime event hooks
  ui/          终端 UI
  utils/       配置和辅助工具
tests/
docs/
data/
```

## 架构说明

- 终端 CLI 和云之家网关复用同一套核心 agent runtime
- channel 集成位于边界层 `src/channels`
- 共享 tasking 基础设施位于 `src/runtime/tasking`
- 云之家任务和 CLI workflow task 目前都还是单进程内存态实现
- runtime events 会被复用为移动端进展通知

## 当前限制

- task 状态不会跨进程重启持久化
- `ask_user` 只在带 TTY 的交互式 CLI 里可用
- 云之家接入当前主要面向文本工作流，还没有做富文本卡片
- 在受限 Windows 沙箱里，`vitest` 可能会报 `spawn EPERM`
- 工作区外的用户配置文件修改，可能需要在本机直接执行命令

## 相关文档

- [YZJ remote-agent 实现记录](./docs/analysis/2026-03-31-xiaok-yzj-remote-agent-implementation-record.md)
- [YZJ 集成交接说明](./docs/analysis/2026-03-31-xiaok-yzj-integration-handoff.md)
- [YZJ remote-agent 实施计划](./docs/superpowers/plans/2026-03-31-xiaok-yzj-remote-agent.md)
- [YZJ remote-agent 设计文档](./docs/superpowers/specs/2026-03-31-xiaok-yzj-remote-agent-design.md)
