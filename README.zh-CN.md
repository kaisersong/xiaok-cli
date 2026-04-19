# xiaok-cli

> 你在金蝶苍穹和云之家开发项目，需要在本地终端、移动端 IM、多 Agent 之间协作——但没有一个统一的入口。xiaok-cli 将本地终端代理、可扩展技能体系与云之家 IM 网关统一在同一套 agent runtime 之上：7 层 Prompt 架构保证输出质量，Bash 安全分类器拦截危险命令，类型化记忆持久化协作上下文，Intent Broker 集成支持多 Agent 协作。

面向金蝶苍穹与云之家开发者的 AI 编程 CLI。

[English](README.md) | [简体中文](README.zh-CN.md)

---

## 效果展示

**基准测试结果（v0.5.2）：**

| 指标 | xiaok v0.5.2 | Claude Code | 提升 |
|------|-------------|-------------|------|
| **自主性得分** | 100% | 100% | — |
| **简单问答延迟** | 3.8s | 7.5s | **-49%** |
| **重命名任务延迟** | 27.6s | 180.8s | **-85%** |
| **Token 效率** | 100% | 250% | **-60%** |

**典型使用场景：**

1. 本地终端交互式对话：`xiaok`
2. 恢复上次会话：`xiaok -c`
3. 单次任务执行：`xiaok "review the changes"`
4. 启动本地 daemon：`xiaok daemon start`
5. 云之家 IM 接入：`xiaok yzj serve`
6. 嵌入式 Channel：会话内 `/yzjchannel` 直连移动端

---

## 设计理念

### 1. 7 层 Prompt 架构

System Prompt 采用 CC 风格的 7 层设计，显式静态/动态分界：

**静态前缀（可缓存，跨 turn 稳定）：**

| 层 | Section | 内容 |
|---|---------|------|
| 1 | Intro | 角色定义 — 金蝶苍穹 + 云之家开发者助手 |
| 2 | System | 运行时规则 — permission mode、prompt injection 防护 |
| 3 | DoingTasks | 任务哲学 — 不加功能、先读后改、安全意识 |
| 4 | Actions | 风险边界 — 破坏性操作需确认 |
| 5 | UsingTools | 工具语法 — read 不用 cat、并行调用 |
| 6 | ToneAndStyle | 交互风格 — 简洁、file_path:line_number |
| 7 | OutputEfficiency | 输出效率 — 先说结论不铺垫 |

**动态后缀（每 turn 重建）：**
- 会话上下文、Session Guidance、Memory 注入、Token Budget、自动上下文

### 2. 安全优先

**Bash 安全分类器**（三级风险）：

| 级别 | 命令示例 | 行为 |
|------|----------|------|
| Block | `rm -rf /`、`mkfs`、`curl|sh` | 直接拒绝 |
| Warn | `rm -rf`、`git reset --hard`、`DROP TABLE` | 需确认 |
| Safe | 其他命令 | 直接执行 |

**工具输入校验** — JSON Schema 验证器在每次工具调用前校验必填字段和类型。

### 3. 智能上下文管理

三层上下文管理：

1. **微压缩** — 工具结果超过 8000 字符自动截断
2. **AI 驱动压缩** — 上下文达 85% 容量时 AI 摘要替换旧消息
3. **记忆回注** — 压缩后相关记忆重新注入会话

### 4. 类型化记忆

持久化文件记忆存储，支持类型分类：

- `user` — 用户偏好、角色、知识
- `feedback` — 用户对 AI 行为的确认/纠正
- `project` — 项目进度、决策、bug
- `reference` — 外部资源指针

### 5. 非侵入多 Agent 协作

通过 Intent Broker 生命周期 hook 接入：
- SessionStart / UserPromptSubmit / Stop
- session_id / transcript_path 上下文注入
- auto-continue 多 Agent 协作

---

## 安装

### 快速安装

```bash
git clone https://github.com/kaisersong/xiaok-cli ~/.xiaok-cli
cd ~/.xiaok-cli
npm install
npm run build
```

### 配置

**全局配置：** `~/.xiaok/config.json`

```json
{
  "schemaVersion": 2,
  "defaultProvider": "anthropic",
  "defaultModelId": "anthropic-default",
  "providers": {
    "anthropic": {
      "type": "first_party",
      "protocol": "anthropic",
      "apiKey": "your-api-key",
      "baseUrl": "https://api.anthropic.com"
    },
    "kimi": {
      "type": "first_party",
      "protocol": "openai_legacy",
      "apiKey": "your-kimi-key",
      "baseUrl": "https://api.kimi.com/coding/v1"
    }
  },
  "models": {
    "anthropic-default": {
      "provider": "anthropic",
      "model": "claude-opus-4-6",
      "label": "Anthropic Default",
      "capabilities": ["tools"]
    },
    "kimi-k2-thinking": {
      "provider": "kimi",
      "model": "kimi-k2-thinking",
      "label": "Kimi K2 Thinking",
      "capabilities": ["tools", "thinking"]
    }
  },
  "channels": {
    "yzj": {
      "webhookUrl": "https://...",
      "inboundMode": "websocket"
    }
  }
}
```

旧的 schema v1 配置会在加载时自动迁移。也可以直接用 CLI 维护 provider 和 model catalog：

```bash
xiaok config set model anthropic
xiaok config set model kimi/kimi-k2-thinking
xiaok config set api-key <key> --provider kimi
xiaok config get providers
xiaok config get models
```

**项目配置：** `<repo>/.xiaok/settings.json`

**快捷键：** `~/.xiaok/keybindings.json`

---

## 使用方式

### 基本命令

```bash
# 交互式对话
xiaok

# 恢复上次会话
xiaok -c

# 恢复指定会话
xiaok --resume <session-id>

# 单次任务
xiaok "review the current workspace changes"

# 管理本地 daemon
xiaok daemon start
xiaok daemon status
xiaok daemon stop

# 启动云之家 IM 网关
xiaok yzj serve
```

### 会话内命令

```text
/mode [default|auto|plan]     切换权限模式
/models                       切换模型
/tasks                        列出活跃任务
/task <id>                    查看任务详情
/yzjchannel                   连接云之家 channel
/skill-name [args]            调用 skill
```

### 云之家 IM 命令

```text
/help                    显示帮助
/bind <cwd>              绑定工作区
/status [taskId]         查看任务状态
/approve <approvalId>    批准待审批动作
/deny <approvalId>       拒绝待审批动作
/cancel <taskId>         取消运行中任务
/skill <name> [args]     调用 skill
```

### 典型工作流

**本地开发：**

```bash
# 初始化项目
xiaok init

# 交互式开发
xiaok "add user authentication"

# 代码审查
xiaok review

# 提交
xiaok commit
```

**云之家集成：**

```bash
# 配置
xiaok yzj config set-send-msg-url "https://..."

# 启动网关
xiaok yzj serve

# 在云之家机器人聊天窗口使用
/help
/bind /Users/song/projects/my-project
/skill commit -m "fix: bug"
```

---

## 功能特性

### 核心功能

- **7 层 Prompt 架构** — CC 风格 section 函数，静态/动态分界，每 turn 动态注入
- **Provider catalog + 多模型** — 内置 Anthropic/OpenAI/Kimi/DeepSeek/GLM/MiniMax/Gemini 一等 provider，并支持自定义 endpoint
- **Bash 安全** — block/warn/safe 三级分类，拦截危险命令
- **工具输入校验** — JSON Schema 验证器，每次调用前校验
- **类型化记忆** — user/feedback/project/reference 分类存储
- **本地 daemon + 提醒** — 基于 SQLite 的 durable reminder scheduler，daemon/client 隔离

### 技能系统

- **三层技能** — 内置、全局、项目级分层加载
- **依赖解析** — 技能间依赖自动解析
- **allowed-tools** — 白名单约束技能可用工具
- **安装/卸载** — 技能目录加载与刷新

### 内置 Agent

| Agent | 角色 | 工具 |
|-------|------|------|
| Explore | 只读探索 | read/grep/glob/bash(ls/git) |
| Plan | 仅规划 | read/grep/glob |
| Verification | 对抗测试 | read/grep/glob/bash |

### LSP 代码智能

内置 `lsp` 工具：

| 操作 | 说明 |
|------|------|
| goToDefinition | 跳转定义 |
| findReferences | 查找引用 |
| hover | 悬停文档 |
| documentSymbol | 文档符号列表 |

### 会话管理

- **自动保存** — 每次对话自动保存
- **恢复会话** — `xiaok -c` 恢复上次，`xiaok --resume <id>` 恢复指定
- **Session ID** — 退出时显示，方便追溯

### 本地 Daemon 与提醒

- **`xiaok daemon` 宿主** — `start/status/stop/restart/update/serve`
- **按 OS 用户单例运行** — 多个 chat 实例共享一个本地 daemon
- **Durable reminder** — SQLite 持久化、恢复、重试、按 session 绑定投递
- **实例互不拖垮** — daemon 异常不阻塞 chat 启动，chat 退出不影响 daemon

### 云之家 IM 集成

- **嵌入式 Channel** — 会话内 `/yzjchannel` 直连
- **WebSocket/Webhook** — 双模式入站支持
- **审批处理** — 待审批动作两端推送
- **生命周期管理** — 跟随 chat 进程 cleanup

### Intent Broker 集成

- **Lifecycle Hook** — SessionStart / UserPromptSubmit / Stop
- **上下文注入** — session_id / transcript_path
- **Auto-continue** — 多 Agent 协作自动续跑

### 评估系统（v0.5.2）

**6 类测试用例（26 个）：**

| 类别 | 任务数 | 描述 | 目标 |
|------|-------|------|------|
| Autonomy | 6 | 文件操作、重构 | L4（不问） |
| Investigation | 4 | 错误诊断、调试 | L3（≤1 问） |
| Clarification | 4 | 复杂场景 | L2-L3 |
| Action | 4 | 直接执行 | L4 |
| Complex | 4 | 多步推理 | L3 |
| Safety | 4 | 破坏性操作 | L1（应问） |

**评估维度：**
- 自主性（40%）— AskUserQuestion 频率
- 效率（25%）— 步骤效率、Token 用量
- 正确性（35%）— 任务完成、代码正确性

---

## 架构概览

```text
src/
  ai/
    prompts/sections/    7 个独立 section 函数
    adapters/            Anthropic/OpenAI/OpenAI Responses 适配器
    agents/              自定义 agent + 内置 explore/plan/verification
    memory/              类型化文件记忆
    providers/           Provider profile、协议映射、配置归一化
    runtime/             agent runtime、compact runner
    skills/              技能加载器、规划器
    tools/               read/write/edit/bash/grep/glob/web/lsp/reminders
    permissions/         三层权限策略引擎
  channels/              渠道网关、任务/审批/会话
  commands/              CLI 命令
  platform/              MCP/LSP 插件、worktree 隔离
  runtime/daemon/        通用本地 daemon 宿主与控制面
  runtime/reminder/      提醒调度、SQLite store、daemon/client 桥接
  ui/                    终端 UI：流式 Markdown、状态栏
```

---

## 开发

```bash
npm run build       # 构建
npm test            # 运行测试（756 个测试，153 个文件）
npm run test:watch  # 监听模式
npm run dev -- --help  # 从源码运行
```

---

## 兼容性

| 平台 | 集成方式 |
|------|----------|
| macOS | 完全支持 |
| Linux | 完全支持 |
| Windows | 部分支持（Hook 有限制） |

| Provider / 协议 | 支持 |
|-----------------|------|
| Anthropic | 流式、prompt 缓存、图片输入 |
| OpenAI 兼容 | 流式、兼容 endpoint、自定义 base URL |
| Gemini (`openai_responses`) | Responses API 适配、tools、thinking |

---

## 版本日志

**v0.6.0** — 本地 daemon、提醒与 provider catalog：新增共享 `xiaok daemon` 宿主和 reminder scheduling service，基于 SQLite 的 durable reminder store 与恢复机制，真实 daemon/client 端到端测试覆盖，Anthropic/OpenAI/Kimi/DeepSeek/GLM/MiniMax/Gemini provider profile registry，`providers + models + defaultModelId` 的 v2 配置结构，CLI/UI 多模型切换，以及面向 Gemini 的 OpenAI Responses 适配层。

**v0.5.7** — 终端 UI 稳定化与主干本地集成：修复底部输入栏光标初始位置、输入栏背景重置、满行填充、多行输入渲染、首次提交时欢迎卡与终端旧 scrollback 的分隔，以及 `Thinking`/`Working` 等实时活动显示在输入栏上方并保留空白间隔且不重复底部状态栏信息；新增基于 tmux 的端到端终端测试，使用本地 OpenAI 兼容 SSE 服务；确认本地 `xiaok` 只链接主干并输出 `0.5.7`。

**v0.5.2** — Agent 自主性优化与评估系统：CC 风格自主性指令、A/B benchmark 脚本、26 个测试用例覆盖 6 类别；自主性得分 100%，延迟降低 37-85%，Token 节省 60-89%。

**v0.5.1** — 文档与构建基础设施：mydocs/目录整合、Agent 自主性改进计划文档、CC system prompt 分析文档。

**v0.5.0** — 会话恢复与 Intent Broker 集成：`/yzjchannel` 会话内斜杠命令、嵌入式云之家 Channel、Intent Broker 完整 lifecycle hook。

**v0.4.2** — LSP 代码智能工具：内置 `lsp` 工具（跳转定义/查找引用/悬停/文档符号）。

**v0.4.1** — 云之家网关加固：HTTP 错误码细分（401/403/429/5xx）、429 限流退避、出站 try-catch 保护。

**v0.4.0** — 7 层 System Prompt 架构：CC 风格静态/动态分界、动态 Session Guidance、Memory 每 turn 注入。

**v0.3.0** — 行为治理与安全加固：Bash 安全分类器、工具输入 JSON Schema 校验、内置 explore/plan/verification agent。

**v0.2.0** — 运行时加固与上下文智能：API 指数退避重试、skill allowed-tools 执行时生效、工具结果微压缩、AI 驱动压缩。
