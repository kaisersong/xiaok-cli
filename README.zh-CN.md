# xiaok-cli

> Xiaok 是本地优先的 AI 工作台，提供 Desktop 和 CLI 两种入口。通过工具、技能、SubAgent 协作、持续目标和产物验证，把用户请求落实为可交付的结果。

Desktop 面向对话、文档、知识、自动化和多智能体项目；CLI 面向终端工作流、代码任务和脚本化执行。两端共享模型、工具、技能与运行时基础能力。

[English](README.md) | [简体中文](README.zh-CN.md)

**发布目标：1.5.4（2026-09-10）。** CLI 与 Desktop 版本统一为 **1.5.4**。本次加入协作空间工作区、执行健康跟踪、更新安装交接恢复和 CLI 输入修复。新版本构建及产物校验成功前，最新 Desktop 正式版基线为 **1.5.3**；修改版本号不等于发布 npm。详见[版本日志](#版本日志)。

---

## 效果展示

启动 CLI，直接描述具体任务：

```bash
xiaok login
xiaok "分别检查 agent coordinator 和 registry 的生命周期，再交叉复核工具入口，按严重程度汇总并给出文件与行号。"
```

当实际可用工具与任务适合独立分工时，Xiaok 可以自动分派有界任务，无需先声明 Agent 或创建项目。简单问题和紧密依赖的工作由主 Agent 直接完成。

CLI 会明确展示 **SubAgent**、星座代号、分工、当前活动，以及结束时的工具调用量和耗时。代号从**双鱼座、天秤座**开始，再依次使用白羊座至其余星座；下一轮加 `-2`。同一实例续轮保留代号。所有代号统一强调色；斜体效果取决于终端字体支持。

可以直接补充偏好：“你自己完成”“分派前先问我”“这两块可独立并行审查”。重要取舍尚未确定时需要实际答复，取消或空回答不算批准。

Desktop 中可从对话开始，添加材料并在预览 / Canvas 中查看结果。当前源码还提供 SubAgent 面板，展示分工、活动、消息和结果；它与持久化 KSwarm 项目相互独立。

## Xiaok 中的 Loop Engineering

一个提示词启动一次工作；一个有效的 Loop 还需要触发器、执行器、持久状态、检查器和用户看得见的结果。

| 组成 | Xiaok 实现 |
|---|---|
| 自动化 | 定时任务、用户 Loop、项目与工作流触发 |
| 执行 | 带工具与技能的 CLI / Desktop agent runtime |
| 工作隔离 | 独立 SubAgent 会话、继承的工具权限、可选 worktree |
| 连接能力 | MCP 插件、本地文件、Intent Broker、KSwarm、可选消息通道 |
| 记忆 | 会话状态、SQLite、知识来源、工作流检查点、Loop 记录 |
| 证据 | 可读产物、技能合同、完成检查、审核门禁、来源记录 |
| 诊断 | 产物证据回归 Loop、KSwarm 服务健康 Loop、运行历史及失败原因 |

建立 Loop 时，先定义工作与交付合同，再选择触发方式、保存状态，并增加能区分实际交付与表面成功的检查。提醒只通知，定时任务才执行 AI 工作。每日助理需要用户启用，生成的记忆与知识候选可先审阅再采纳。

**当前源码重点：**

- **SubAgent 协作**：为有价值的独立分工自动启动，展示具体任务，支持消息、同实例续轮、中断、关闭及清理状态。
- **简化系统提示词**：合并重复执行指令，消除授权与输出格式冲突。CLI 通用层从 20,687 缩到 5,993 字符；Desktop 基础层从 8,297 缩到 3,239 字符。这是固定文本测量，不代表 token、延迟或模型质量的同比改善。
- **Goal Mode**：持久目标、状态、暂停/恢复、预算、证据与受控续跑。
- **Room-first 协作**：先与智能体讨论，再通过用户确认，从选中的来源消息创建项目。
- **产物与知识工作流**：预览、编辑、文档入库、本地检索、录音转写和可复用技能。

## Swarm 项目

KSwarm 负责需要计划、智能体分工、并行任务、审核、恢复和最终交付的持久项目。项目拥有独立状态与产物，不等于一次对话里的 SubAgent 组。

智能体侧 `create_project` 工具只生成**提案**。正式创建走 Desktop 中受信任的用户确认路径；普通内容生成或自动 SubAgent 分派不会静默创建持久项目。

### 基础版 Dynamic Workflow

- **持久运行**：阶段、节点、依赖、并行组、检查点、状态与 gate decision 由 KSwarm 保存。
- **内置诊断**：直接检查项目状态，或启动智能体诊断与独立评审。
- **项目与任务范围**：High Quality 项目工作流协调整体交付；任务级提案处理用户明确选择的任务。
- **受控脚本**：受信任工作流使用 `phase`、`agent`、`parallel([() => agent(...), ...])`、`pipeline`，由运行时校验并约束执行。
- **预览与续跑**：先预览再执行；使用 `workflowRunId` 查询状态，通过 `resumeWorkflowRunId` 恢复已保存的运行，无需重贴另一份脚本。
- **产物优先审核**：任务与最终交付必须满足格式、来源及产物合同。修复文件重新进入审核，不靠强制改状态完成。
- **可见进度**：看板、Graph、任务详情和日志展示持久化任务/工作流状态、并行进展、阻碍、恢复与交付物。

KSwarm 管项目编排，Xiaok 与外部智能体 runtime 执行任务，随包 renderer 生成正式报告和幻灯片，Intent Broker 传递任务与回复。各层的健康和完成状态分别验证。

---

## 设计理念

### 1. 意图优先的任务交付

先理解交付目标，复用现有技能和材料，在授权范围内持续执行。多步任务保持进度准确，简单问题直接回答。最终回复说明交付了什么、在哪里、验证了什么。

### 2. 精简且分层的系统提示词

当前结构用简明规则与运行时上下文替代旧的“7 层”描述：

| 入口 | 稳定规则 | 运行时附加内容 |
|---|---|---|
| CLI | 身份、执行、授权、工具、沟通、计划、验证和阶段交接 | 权限模式、技能目录、延迟工具、工作区约定、记忆、CLI 专用分派策略 |
| Desktop | 执行与证据、提醒/定时任务、材料、知识、项目边界和交付格式 | 当前模型、技能目录、材料、受管 SubAgent 策略与上下文 |

技能仍按目录发现、按需加载。工作区内容与记忆提供上下文，不增加权限。提示词不能替代 service 权限检查与工具参数校验。对应实现见 [CLI prompt assembler](src/ai/prompts/assembler.ts) 与 [Desktop 基础规则](desktop/electron/desktop-system-prompt.ts)。

### 3. 安全优先

| 层次 | 边界 |
|---|---|
| 权限模式 | `default` 按需询问，`auto` 放行低风险操作但保留高风险检查，`plan` 禁止写入与 Bash |
| Bash 分类 | `block`、`warn`、`safe` 分类配合权限检查；未命中危险规则不等于无条件安全 |
| 工具执行 | 校验输入、执行当前允许集、不能换工具绕过用户拒绝 |
| Agent mutation | 根据调用者和数据所有权约束控制/写入操作，分派不能扩大权限 |
| 交付 | 核验产物与结果；“closed”本身不证明执行和资源已真正结束 |

Computer Use 使用独立的权限与运行路径，仅支持 macOS，不能改用 shell 截图或桌面控制绕行。

### 4. 分阶段上下文管理

持久保存 intent ledger，同时聚焦当前阶段。压缩过大的工具结果，保留溢出文件引用，通过明确产物交接，并在压缩后恢复相关记忆。易变状态重新查询，不把旧摘要当实时快照。

### 5. 类型化记忆

CLI 记忆区分 `user`、`feedback`、`project`、`reference`。Desktop 还提供持久笔记本与本地知识库，用于文档、来源和检索。记忆属于背景上下文；用户要求保存的个人信息才持久化，每日助理候选由用户采纳。

### 6. 非侵入多 Agent 协作

| 机制 | 适用场景 |
|---|---|
| SubAgent | 当前对话内有明确边界的独立工作 |
| KSwarm 项目 | 持久计划、任务派发、独立审核、恢复与最终交付 |
| Intent Broker / Room | 不同智能体 runtime 之间的协作，以及带成员和消息历史的持久会话 |

权限允许时，SubAgent 工具有 `spawn_agent`、`send_message`、`wait_agent`、`list_agents`、`followup_task`、`interrupt_agent`、`close_agent`。续轮复用实例；用户禁止分派、要求先问、工具限制和数据所有权边界持续有效。

交互式 CLI 可以就重要分派选择提问。无交互 CLI 与当前 Desktop agent loop 尚无该交互式问答通道：只影响可选分派时由主 Agent 完成；缺少关键决定时先说明，不启动未获授权的工作。

---

## 安装

### 环境要求

- **CLI**：Node.js **22 或更高版本**。
- **完整源码栈**：Node.js **22.22 或更高版本**，满足 KSwarm 的 engine 要求。
- **已发布 Desktop 安装包**：macOS Apple Silicon 与 Windows x64。正常使用安装版无需单独安装 Node.js。
- Computer Use 需要 macOS 及对应辅助功能/屏幕权限。模型和外部服务凭据按实际使用能力配置。

### npm 安装

```bash
npm install -g xiaokcode
xiaok login
xiaok
```

npm 包名是 `xiaokcode`，命令是 `xiaok`。使用 `xiaok update` 更新。

> **npm ≥ 11.16 用户**：npm 默认拦截依赖包的 install/postinstall 脚本。若安装时出现 `install scripts not yet covered by allowScripts` 警告，请改用：
>
> ```bash
> npm install -g --allow-scripts=nodejieba,onnxruntime-node xiaokcode
> ```
>
> `onnxruntime-node` 的脚本用于放置本地 embedding 推理所需的原生二进制，`nodejieba` 用于中文分词。脚本被拦截时 CLI 仍可正常启动，但这两项能力会静默降级（embedding 关闭、中文按整段索引）。也可以全局一次性放行：`npm config set allow-scripts=nodejieba,onnxruntime-node --location=user`。`xiaok login` 提供 provider 选择、隐藏 key 输入和可选实时验证；首次交互式聊天没有配置 provider 时，也可进入同一引导。

### 源码安装（开发用）

```bash
git clone https://github.com/kaisersong/xiaok-cli.git
cd xiaok-cli
npm ci
npm run build
node dist/index.js
```

以上可用于 CLI 开发。Desktop 源码构建还依赖同级关联仓库，见[关联项目](#关联项目)和[开发](#开发)。重新构建后启动新进程，已运行进程不会自动替换已加载模块。

### 配置

默认配置：`~/.xiaok/config.json`；`XIAOK_CONFIG_DIR` 可覆盖配置根目录。项目设置位于 `<repo>/.xiaok/settings.json`，快捷键默认位于 `~/.xiaok/keybindings.json`。

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
    },
    "firecrawl": {
      "type": "first_party",
      "protocol": "firecrawl",
      "apiKey": "",
      "baseUrl": "https://api.firecrawl.dev"
    }
  },
  "models": {
    "anthropic-default": {
      "provider": "anthropic",
      "model": "claude-opus-4-7",
      "label": "Anthropic Default",
      "capabilities": ["tools"]
    },
    "kimi-default": {
      "provider": "kimi",
      "model": "k3",
      "label": "Kimi K3",
      "capabilities": ["tools", "thinking"],
      "runtimeOptions": {
        "contextLimit": 262144,
        "reasoningEffort": "high"
      }
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

v1 配置在加载时迁移。可使用登录、配置命令或 Desktop 设置管理 provider 与模型：

```bash
xiaok login --provider kimi
xiaok config set model kimi/k3
xiaok config get providers
xiaok config get models
xiaok doctor --check-keys
```

#### Kimi K3

内置精确 profile 使用 `k3` 和 `k3-256k`。当前默认配置是 262,144 token 上下文与 `high` reasoning effort；可选上下文与思考档位取决于具体模型/profile。

CLI 与 Desktop 仅在任务内的 provider 对话内存中保留 K3 `reasoning_content`；原始推理不进入持久会话/任务历史、用户事件、普通日志或工具上下文。已有 assistant turn 的持久化历史不能直接 resume/continue/fork，会返回 `KIMI_K3_DURABLE_RESUME_UNSUPPORTED`；此 profile 应开启新会话。

Kimi 显式 `prompt_cache_key` 默认关闭。`XIAOK_EXPERIMENTAL_KIMI_PROMPT_CACHE=1` 仅用于诊断，不代表已证实的性能收益。切换模型或 reasoning effort 需要新的 provider 对话。实现见[模型 harness profile](src/ai/providers/model-harness-profile.ts)。

---

## 桌面版

Desktop 是基于 Electron 与 React 的主要图形工作台。主进程 service 持有持久状态并执行任务，renderer 展示结构化状态，通过有限的 preload / IPC API 发起请求。

### 下载

从 [GitHub Releases](https://github.com/kaisersong/xiaok-cli/releases/latest) 获取当前正式版。`desktop-v1.5.2` 已列出：

- `xiaok-1.5.2-arm64.dmg` — macOS Apple Silicon 安装包。
- `xiaok-1.5.2-arm64-mac.zip` — macOS Apple Silicon 压缩包。
- `xiaok-setup-1.5.2.exe` — Windows x64 安装程序。

自动更新使用 `latest-mac.yml` 与 `latest.yml`。本文标记为近期源码的改动，需要源码构建或后续正式发布后使用。

### 功能特性

- **对话与 Goal Mode**：任务历史、提示词导航、持久目标、暂停/恢复和可见进度。
- **SubAgent 面板**：当前源码中的受管协作，提供稳定星座代号、分工、活动、消息与结果。
- **预览 / Canvas**：HTML、Markdown、PDF、报告和幻灯片预览，产物编辑、修订与任务来源；部分高级界面仍受功能开关控制。
- **项目与 Room**：从对话经用户确认创建项目，提供看板、工作流 Graph、审核门禁与恢复。
- **自动化**：定时 AI 任务、提醒、用户 Loop、诊断、运行历史和输出预览。
- **知识与录音**：本地文档入库/检索、笔记本、录音转写和可编辑纪要；ASR 能力取决于配置的 provider 或已安装本地模型。
- **插件**：MCP 工具、随包报告/幻灯片/画布/会议能力、受管运行时就绪检查、组件重试及 macOS Computer Use。
- **设置与访问**：模型/provider、技能、通道、插件配置，中英文界面、主题、更新与可选移动端 companion。

### 开发构建

先准备关联仓库和依赖，在根目录执行：

```bash
npm ci --prefix desktop
npm run build --prefix desktop
npm run dev:all --prefix desktop
```

仅构建不会替换已安装应用。未签名本地打包与发布前置条件见[开发](#开发)。

---

## 使用方式

### 基本命令

```bash
xiaok                              # 交互式聊天
xiaok login                        # 配置 provider/key
xiaok -c                           # 恢复上次会话，需模型支持
xiaok --resume <session-id>         # 恢复指定会话
xiaok "审查当前工作区改动"           # 执行任务
xiaok doctor --check-keys           # 诊断凭据解析
xiaok update                       # 更新 npm CLI
xiaok daemon status                # 查看本地 daemon
xiaok plugin search                # 浏览插件
xiaok transcript <session-id>      # 检查执行历史
xiaok yzjchannel serve             # 可选云之家网关
```

### 会话内命令

```text
/exit                         退出聊天
/clear                        清屏并重新显示欢迎页
/compact                      压缩较早对话上下文
/context                      查看已加载的仓库上下文
/mode [default|auto|plan]     查看或切换权限模式
/models                       切换模型
/goal <objective>              创建持久目标
/goal status|pause|cancel      查看、暂停或取消目标
/goal resume [newTurnLimit]    恢复，可指定新的轮次限制
/goal replace <objective>      替换当前目标
/reminder <natural language>  创建通知提醒
/reminder list                列出提醒
/reminder cancel <id>         取消提醒
/settings                     查看 CLI 设置
/skills-reload                重载技能
/yzjchannel                   连接内嵌通道
/help                         查看帮助
/<skill-name> [args]          调用技能
```

权限模式与用户意图分开：`auto` 不替用户回答待定问题，也不覆盖“分派前先问我”。

### 终端按键与内联图片

- **Esc** 请求中断当前执行轮次，同时保留草稿与排队输入。
- **Ctrl+O** 在空闲时用 `$PAGER`（默认 `less -R`）查看完整 transcript；私有 ANSI 临时文件退出后删除，不支持的环境回退到 scrollback。
- 支持的终端通过 kitty 或 iTerm2 协议显示提交的图片；tmux 等不支持的环境显示占位提示。
- SubAgent 代号使用统一强调色；中文斜体取决于终端字体回退，ANSI 样式本身不保证字形倾斜。

### 云之家 IM 命令

```text
/help                    查看帮助
/bind <cwd>              绑定工作区
/bind clear              清除工作区绑定
/status [taskId]         查询任务状态
/approve <approvalId>    批准待处理操作
/deny <approvalId>       拒绝待处理操作
/cancel <taskId>         取消运行中任务
/skill <name> [args]     调用技能
```

云之家属于可选适配器，本地 CLI / Desktop 使用不依赖它。

### 典型工作流

```bash
xiaok init
xiaok "实现这项改动并完成相关验证"
xiaok review
xiaok commit
```

复用文档能力时安装对应插件并调用技能；独立调查任务直接说明交付物与约束，由运行时选择有价值的 SubAgent 分工。持续目标使用 `/goal`，重复工作使用 Desktop 自动化，正式多智能体项目交付使用经用户确认的 KSwarm 项目。

---

## 功能特性

### 核心功能

- Anthropic、OpenAI、Kimi、DeepSeek、GLM、MiniMax、Gemini 与自定义端点的共享 provider 目录。
- 精简系统规则、按入口注入上下文、工具校验、权限模式与有范围约束的 Agent 控制。
- 文件/搜索/编辑/shell、网页搜索与抓取、LSP、持久目标和会话诊断。
- 区分执行状态、逻辑关闭和资源清理；取消未结束时如实展示，不伪报资源已释放。

### 技能系统

- 内置、全局、项目和插件技能目录，依赖解析与按需加载。
- `allowed-tools` 执行时约束，安装/卸载后刷新目录。
- `required-references`、`required-scripts`、`required-steps`、`success-checks` 结构化合同。
- strict skill 的执行 bundle、产物证据、完成检查和遵循度评估。

### 内置 Agent

| Agent | 分工 | 声明工具 |
|---|---|---|
| Explore | 只读调查代码库 | read、grep、glob、bash、tool_search；提示词把 Bash 限制为只读检查 |
| Plan | 架构与实现规划 | read、grep、glob、tool_search |
| Verification | 对抗式验证 | read、grep、glob、bash、tool_search |

无需预建命名 Agent 才能分派；内联 SubAgent 可直接接收有界任务与明确工具允许集。预设指令、可见工具和运行时权限是不同层次。

### LSP 代码智能

`lsp` 支持 `goToDefinition`、`findReferences`、`hover`、`documentSymbol`。结构大纲用于指导局部读取；语法回退不能代替语义级定义与引用查找。

### 会话管理

自动持久化、session ID、受支持的恢复、记忆重注入及明确的取消语义保持工作连续性。具体模型的历史约束仍有效，特别是严格 Kimi K3 profile。

### 性能与大负载可靠性

- 增量读取 JSONL transcript，支持显式 gzip 归档：`xiaok transcript <session-id> --gzip --older-than-days 7`。
- 带校验和的任务 journal 与 checkpoint，避免每个事件都重写全量快照。
- Desktop 窗口可交互后再推进受管 Python / 插件就绪工作。
- 合并 renderer 流式更新，有界工具输出保留产物引用。
- 缩短固定系统文本，同时保留技能、工作区约定、权限边界和分派策略。

### 本地 Daemon 与提醒

用户级 daemon 提供 SQLite 持久提醒、恢复和重试，多个 CLI 会话可共享。daemon 可用性与 chat 启动相互独立。通知提醒不执行 AI 任务。

### 云之家 IM 集成

内嵌 `/yzjchannel`、WebSocket/webhook 入站、工作区绑定、任务状态、批准转发与取消，把可选 IM 入口连接到运行时。

### Intent Broker 集成

生命周期 hook 注册会话与项目上下文，发布 work-state，区分可执行任务/问题和信息通知，支持事件重放与受控续跑。消息送达不代表任务执行成功。

### 评估系统

定向单测与合同测试覆盖提示词、工具、权限、历史、取消及交付。CLI 进程/TTY 测试使用本地 SSE 服务；Desktop 覆盖 main service、IPC 与 renderer。真实模型评测与确定性桩测试分开。

可使用 `npm run eval:intent-delegation`、`npm run eval:skill-quality`、`npm run eval:skill-adherence` 及 `scripts/evals/` 中对应脚本。历史自主性 benchmark 不代表当前模型之间的性能保证。

---

## 架构概览

```text
xiaok-cli/
  src/
    ai/              模型、提示词、技能、工具、Agent、权限、记忆
    commands/        CLI 命令与 chat/goal 入口
    platform/        Runtime registry、MCP/LSP、worktree、后台执行
    runtime/         Task host、目标、daemon、提醒、证据与诊断
    ui/              终端 transcript、输入、进度与 SubAgent 展示
    channels/        可选消息通道适配器
  desktop/
    electron/        主进程服务、任务/Agent 执行、store、IPC 与 sidecar
    renderer/        对话、SubAgent 面板、项目、知识与产物
    shared/          Desktop 共享合同
  data/              内置技能、Agent 与领域资源
  tests/             CLI 单测、合同测试、进程/TTY 测试
```

### 关联项目

| 仓库 | 职责 | 与 Xiaok 的边界 |
|---|---|---|
| [kswarm](https://github.com/kaisersong/kswarm) | 持久项目/任务/工作流状态、派发、评审、恢复与产物门禁 | Desktop 主进程启动并调用 sidecar，agent runtime 执行任务 |
| [intent-broker](https://github.com/kaisersong/intent-broker) | participant、代号、事件、任务交接、批准、Room 与重放 | 传递协作事实，不伪造任务结果，不持有 KSwarm 项目状态 |
| [kai-xiaok-plugins](https://github.com/kaisersong/kai-xiaok-plugins) | 技能、MCP server、随包渲染与转写资源 | 提供能力；Xiaok 管理激活、权限、任务状态与用户交付 |

当前插件集合包括 report `2.3.0`、slide `3.3.0`、infinity canvas `0.2.0`、meeting assistant `0.1.0`、Computer Use `0.2.1`。会议插件提供 Whisper 回退与总结，麦克风采集及其他 ASR 集成由 Desktop 管理。Computer Use 仅支持 macOS。

Desktop 源码开发要求关联仓库同级放置：

```text
projects/
  xiaok-cli/
  kswarm/
  intent-broker/
  kai-xiaok-plugins/
```

```bash
git clone https://github.com/kaisersong/kswarm.git
git clone https://github.com/kaisersong/intent-broker.git
git clone https://github.com/kaisersong/kai-xiaok-plugins.git
```

在 `xiaok-cli` 的父目录执行以上 clone，联动更新兼容版本。[发布 workflow](.github/workflows/desktop-release.yml) 将三个关联仓库固定到 `desktop-v1.5.2`；本地源码更新不会自动更新这些发布标签。[electron-builder.json](desktop/electron-builder.json) 定义实际打包的服务与插件资源。

---

## 开发

在 `xiaok-cli` 中执行：

```bash
npm ci
npm run build
npm test
npm run test:full
npm run test:skill:fast
npm run test:skill:release
npm run dev -- --help
```

默认测试先编译到 `.test-dist`，再执行 sandbox 配置与评估。`test:full` 包含 sandbox 排除的子进程测试；socket / 子进程测试需要允许相关操作的环境。

准备 Desktop 与 sidecar 依赖：

```bash
npm ci --prefix ../kswarm
npm ci --prefix ../intent-broker
npm ci --prefix ../kai-xiaok-plugins/plugins/kai-report-creator/mcp-servers/report-renderer
npm run build --prefix ../kai-xiaok-plugins/plugins/kai-report-creator/mcp-servers/report-renderer
npm run build:bundle --prefix ../kai-xiaok-plugins/plugins/kai-report-creator/mcp-servers/report-renderer
npm ci --prefix desktop
npm run test --prefix desktop
npm run typecheck --prefix desktop
npm run build --prefix desktop
```

Python runtime、wheels 和其他插件组件依赖必须符合目标平台与 manifest。按插件仓库构建说明和 release workflow 准备，不能直接复制另一平台的 wheelhouse。

macOS **未签名本地打包**（先完成构建与插件准备）：

```bash
cd desktop
CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --dir \
  --config electron-builder.json \
  -c.mac.identity=null \
  -c.win.signAndEditExecutable=false
```

关联仓库改动还需验证各自边界：

| 改动 | 对应检查 |
|---|---|
| KSwarm 项目/runtime/工作流 | 在 `kswarm` 跑 `npm test` 与 `npm run test:all` |
| Broker participant/adapter/协作 | 在 `intent-broker` 跑 `npm test` 与 `npm run verify:collaboration` |
| Report renderer | 在对应 package 构建、bundle，并做 MCP initialize 冒烟 |
| Slide/Python 插件 | 插件测试、目标平台 wheels 与 runtime 校验 |
| 进入打包的关联资源 | Desktop packaging contract、构建并检查 unpacked app |

回到 `xiaok-cli` 根目录运行 Desktop 打包合同测试：

```bash
npm run test --prefix desktop -- --run \
  tests/main/kswarm-contract.test.ts \
  tests/main/deploy-bundled-plugins.test.ts \
  tests/main/e2e-plugin-bundling.test.ts \
  tests/main/e2e-plugin-rendering.test.ts
```

构建新鲜度报错时，定位并重建对应 owner 的生成物，不反复重试同一打包命令。正式发布还需匹配且已 push 的关联仓库快照、适用的签名/公证，以及发布后的 `npm run desktop:verify-release -- desktop-v<version>`。

---

## 兼容性

| 平台 | CLI | 已发布 Desktop | Computer Use |
|---|---|---|---|
| macOS Apple Silicon | 支持 | DMG / ZIP | 授权后支持 |
| macOS Intel | CLI / 源码使用 | 本次核实的最新 release 无 Intel 产物 | 仍需满足 macOS runtime 要求 |
| Windows x64 | 支持，终端/hook 细节有差异 | 安装程序 | 不支持 |
| Linux | CLI / 源码使用 | 有 build target，本次核实的最新 release 无安装包 | 不支持 |

| Provider / 协议 | 运行时支持 |
|---|---|
| Anthropic | 流式、工具、受支持模型的图片与缓存 |
| OpenAI-compatible | 流式、工具调用、自定义端点与模型能力 |
| OpenAI Responses | 为已配置 profile 提供原生 Responses adapter |
| Kimi K3 | 严格的任务内推理/历史合同，存在持久恢复限制 |

能力取决于所选模型和端点。列出 provider 不代表所有型号都支持相同图片输入、思考档位、上下文或续会话行为。

---

## 版本日志

### v1.5.4 — 发布准备，2026-09-10

- 协作空间支持管理员自选工作目录、冻结工作说明、文件交接，以及带持久授权与恢复的 KSwarm 项目映射。
- 外部 Qoder 与 Xiaok CLI 成员可通过已支持路径参与纯讨论；Kiro 和 Windows 外部 CLI 讨论当前不可用。
- 执行健康跟踪区分模型、工具与取消阶段；CLI 修复中断退出确认、Windows 控制台隔离、输入交接和 shell 引号处理。
- Desktop 更新安装交接失败时保留恢复信息并提供重试反馈。
- 三个内置关联仓库均固定到可复现的 `desktop-v1.5.4` 标签。

### v1.5.3 — 发布准备，2026-09-09

- 默认不设轮次上限；Desktop 主任务和子任务不再因固定 10/28/30 分钟运行时限被终止。显式限制、用户取消、单次审批过期与有限交付检查仍有效。
- 主任务发起的追加任务可在同执行组推进，等待未来轮次不再反复空转；可恢复状态与实际保留的会话一致。
- 本地 Codex 接入标准 Desktop 任务；CLI 包含模型断流恢复、交互式 sudo，以及提醒显示在输入区上方的修复。
- 不改写或自动重跑历史失败任务；本地测试通过不代表所有真实模型任务均已成功验收。
- 未改动的关联服务继续固定到可复现的 `desktop-v1.5.2` 标签。

### v1.5.2 — 发布准备，2026-09-08

CLI 与 Desktop 的 package metadata 均为 **1.5.2**。本次准备发布以下改动：

- CLI/Desktop 子任务启动、通信、等待与生命周期控制，使用稳定的星座代号展示。
- 任务 / SubAgent / 画布复用一个浮窗，修复滚动、输出可读性，并增加首页协作提示词。
- 前后台独立执行槽位，明确展示排队、等待授权与执行状态。
- 符合条件的汇总断流可进行一次有界、禁用工具的续接，保留子任务结果，不重放工具；已失败的历史任务不会自动重跑。
- registry 与后台任务生命周期修复、系统提示词精简。不响应取消的进程内任务仍须如实显示待清理，直到资源真正结束。
- CUA 会话恢复保留逐调用取消能力，重试点击/输入前必须重新观察；更新内置 Fantasy Rainbow 幻灯片布局。

构建、签名、公证与发布产物校验分别验收，实际构建结果见 [GitHub Actions](https://github.com/kaisersong/xiaok-cli/actions/workflows/desktop-release.yml)。

### 已发布基线 — v1.5.1

登录引导、Room/Gate 协作、托管 Room 历史读取、自动化与项目状态恢复、可复现关联仓库打包。安装包与 npm 元数据已于 2026-09-07 核实。完整发布产物与记录见 [GitHub Releases](https://github.com/kaisersong/xiaok-cli/releases)。

<details>
<summary>早期版本记录</summary>

以下为历史发布摘要，不代表当前版本的测试或性能结论。

| 版本 | 主要变化 |
|---|---|
| 1.5.0 | Room-first 协作与用户确认的项目创建。 |
| 1.4.32 | 对话导航、Goal 控制、模型目录和证据恢复。 |
| 1.4.31 | 持久化 Goal Mode 与可见的项目 agent runtime 恢复。 |
| 1.4.28 | 用户主动启用的每日助理与项目智能组队。 |
| 1.4.27 | 基于真实语料与查询测量修复知识检索。 |
| 1.4.26 | 结构化工具失败在 runtime 归一化后仍保持失败。 |
| 1.4.25 | 权限拒绝被明确记录为失败的工具调用。 |
| 1.4.24 | Kimi K3 harness profile 与任务内推理/历史合同。 |
| 1.4.23 | 任务归属明确的 Canvas 产物工作区与预览布局。 |
| 1.4.22 | 中文优先的录音流程与 Computer Use 恢复。 |
| 1.4.21 | 知识库本地 AI 录音入口。 |
| 1.4.20 | Loop 输出预览与任务完成集成。 |
| 1.4.19 | 显式持久化 Loop 合同。 |
| 1.4.18 | 成本可见性、MCP 恢复与分阶段 skill 诊断。 |
| 1.4.17 | 产物持久化与发布一致性。 |
| 1.4.16 | 产物编辑与 Loop Engineering 证据。 |

**v1.4.9** — 知识库与自动化完善版本：新增本地优先的个人知识库，采用 Collection/Source/Chunk 模型，支持 PDF/docx/pptx/xlsx 提取、结巴中文分词搜索和 Agent KB 工具（kb_search、kb_get_source、kb_list_collections、kb_create_collection）；自动化面板支持循环编辑/删除；产物预览全屏切换、iframe allow-scripts 渲染和"发送到对话"按钮；消息中文件路径可点击（Finder/Explorer）；粘贴路径检测修复；工作流状态条裁剪修复；task_completion 通用循环；cult-ui 组件基础设施；方向感知 tabs 动效；Kimi for Coding 兼容；以及启动时 KSwarm 残留进程替换。

**v1.4.8** — 自动化与 Loop Engineering 版本：把用户 loop、定时任务、诊断、运行历史和输出预览统一放到 Desktop 自动化入口；新增可重复运行的用户 loop 模板，支持定时绑定、自动创建输出目录、跨 Windows/macOS 的输出文件名校验、点击打开输出目录，以及复用产物预览查看输出文件。定时任务对话现在会隐藏注入的系统元数据，只展示真实用户 prompt，并增加轻量的计划/实际执行时间提示，方便用户区分调度时机和任务内容质量。Desktop 同时加固 timeout 分类、旧版 KSwarm 服务替换，以及通过轻量 manifest + `skillFetchAssets` 按需读取 skill 资源的链路。

**v1.4.6** — Loop 可靠性追修版本：加固真实桌面启动链路中的 KSwarm / Intent Broker 边界，让 KSwarm service start 共用同一个启动 promise，避免 stream bridge 关闭异常 socket 时递归触发 error，把编译后的 completion-evidence runtime guard 打入 `dist/`，并配套 Intent Broker replay 修复，容忍缺失 `taskId` 的 approval/lifecycle 事件。发版门禁覆盖 KSwarm desktop 聚焦测试、CLI completion-evidence/task-host 聚焦测试、Intent Broker 全量测试、desktop build、KSwarm/broker live health、Computer Use live smoke，以及 `desktop-v1.4.6` release workflow。

**v1.4.5** — Loop 可靠性版本：新增内置 KSwarm Service Health Loop，把服务启动和 health-check 失败分类成结构化 diagnostics；设置页展示建议处理动作和日志路径；重复异常通知保持克制；本地 artifact evidence 增加 workspace containment 与 symlink escape 防护。发版门禁覆盖 desktop 全量测试、CLI sandbox 全量测试、desktop build/typecheck、intent/skill structured eval、Computer Use live smoke，以及 `desktop-v1.4.5` release tag workflow。

**v1.4.2** — A2UI 看板与中断版本：Desktop 可以在对话中直接回放安全的只读 A2UI 看板产物，支持指标、列表、表格和结论 section，并用 `/Applications/xiaok.app` 已安装应用 E2E 覆盖自然语言看板需求，不在用户路径中暴露内部工具名。用户可见 tool step 现在显示为 `dashboard [A2UI]`，原始看板 payload 保持 redacted，section validator 支持常见 alias，并避免有效看板请求触发"未知 section"。终端 streaming turn 也可用 `ESC` 中断，同时保留 draft 和 queued input，并把本轮记录为 user-aborted 而不是 failed。Model adapters、runtime core、compact runner、subagents 和 tool execution 共享 abort signal，不会 retry 真实 `AbortError`；Desktop KSwarm handoff 会透传取消 signal，并把用户中断暴露为 `task_cancelled`。

**v1.4.1** — 桌面端产物预览修复：项目交付物（Markdown、HTML、纯文本）现在可在桌面预览面板中正确加载。引入专用原始文本 IPC 代理（`kswarmProxyGetText`）用于产物内容请求，替换此前导致所有非 JSON 产物类型出现"fetch failed"错误的 JSON-only 代理。同时修复了 macOS 应用打包改用 `ditto` 安装 bundle 的问题。

**v1.4.0** — 多任务并行执行与中断恢复：桌面端 Worker agent 现可同时并行执行最多 3 个任务（可在 设置 > 通用 > 任务并发 中配置 1-10），消除此前的单任务串行瓶颈；通过 Electron powerMonitor 检测系统休眠/唤醒，优雅暂停任务并自动刷新 lease 恢复执行；崩溃安全的原子状态持久化；网络中断后 agent 重连的 20 秒宽限延迟恢复；卡住运行 watchdog 容忍时间提升至 5 分钟以适应休眠转换；集成 KSwarm v0.9.0 并行调度策略。

**v1.3.14** — 流式与动态工作流可靠性版本：Anthropic、OpenAI Chat Completions、OpenAI Responses 适配器把 `ERR_STREAM_PREMATURE_CLOSE`、`ECONNRESET`、`ETIMEDOUT`、`EPIPE`、`Premature close`、`socket hang up`、`terminated`、`fetch failed` 识别为可重试传输错误，但只要本次尝试已经向消费端产出 chunk 就禁止重试，避免向用户重复输出；OpenAI Chat 路径还新增 5 分钟单次流超时与 AbortController。`InProcessTaskRuntimeHost.recoverTask` 在进程重启后会对仍然标记 `running` 但无活跃执行的任务做抢救，转为 `failed` 并写入 `stale_running_task_recovered` 抢救摘要。桌面端 `runKSwarmRuntimeTextTask` 现在会在传输类故障下重试一次，并暴露真实失败原因。新增 `render_report_artifact` 工具，把完整 `.report.md` IR 渲染为动态工作流最终报告 HTML 产物；Worker / final-output / generic 节点 prompt 强制使用 renderer，不再读取插件内部文件或手写 HTML。AGENTS.md 公开了适用于 xiaok-cli、kswarm、intent-broker、kai-xiaok-plugins 的跨平台兼容规则，覆盖 path 拼接、macOS / Windows 平台守卫、`child_process` shell 语法限制等。

**v1.3.13** — 并行动动态 workflow 加固版本：动态 workflow script 现在可以在同一个 KSwarm run 上复用已完成 primitive 输出继续执行，也可以通过只读状态查询工具从 KSwarm snapshot 汇总 run / node / parallel group / checkpoint / gate / delivery 状态。专业 `report_final_review` E2E 会产出 HTML/PDF，并验证 workflow run、gate decision、项目 deliverable、artifact provenance 和任务看板一致。KSwarm 会为成功的 script workflow 写入 passed gate decision；设计和对抗性评审文档也记录了自动 job replay、durable user-input pause/resume 的后续边界。

**v1.3.12** — 并行动动态 workflow 基础版本：可信模型生成的 script 可以使用 thunk 形式的 `parallel()`，并在 KSwarm 中持久化 `parallelGroups`、分支元数据、script checkpoints、后台执行状态和项目 workflow 可见性。内置 `report_final_review` 模板展示了第一条专业并行 workflow 形态，并补齐 script parser、runtime、KSwarm controller 和 desktop bridge 的聚焦测试与 eval。

**v1.3.10** — 项目级 workflow 版本：高质量执行现在会在项目 scope 创建一个 `po-generated-project-workflow`，由 workflow 统一负责计划、任务派发、复核和最终汇总交付。快速执行/智能选择/高质量执行会贯穿 KSwarm dispatch。workflow 交付改成 artifact-first：finalize 会拒绝缺失、不可读、工作区外或非文件型产物，并从提交文件重建 evidence refs 后才允许项目交付。Desktop 的工作流审批和复核诊断弹窗做了加固，workflow run 会显示可读的运行中/已完成/失败状态。

**v1.3.9** — 任务级 dynamic workflow 版本：项目任务卡片可以为当前任务创建 `po-generated-task-workflow` proposal，并在 dispatch 前展示源任务、预算硬上限、权限和验收标准。工作流详情新增 hard budget、最近实质进展、阻塞失败、run 内已保存节点结果和恢复方式。PO-generated 路径使用 validated workflow IR，不执行 raw JavaScript，继续保持 KSwarm 是控制层、agent runtime 是执行层。

**v1.3.8** — 基础版 dynamic workflow 版本：KSwarm 项目现在具备持久化 workflow run、内置快速诊断，以及 agent-backed 复核诊断链路；后者按 Worker 诊断、Reviewer/PO 对抗性复核、gate reducer 归约推进。Desktop 统一成“运行工作流”菜单，同时项目活动仍归在“日志”tab 下，`Workflow` 与 `Swarm` 事件进入同一条时间线，并过滤重复 raw workflow activity event。配套设计文档明确后续动态工作流引擎的分阶段路线：预算确认、subagent 结果缓存、progress 聚合和 reviewer fleet。

**v1.3.7** — Slide renderer 热修复：Desktop 正式安装包现在会把陈旧的内置插件 symlink 备份并替换为安装包内的 `kai-slide-creator`，避免旧开发目录或错误平台 wheelhouse 继续导致 `slide-renderer` MCP 启动失败。

**v1.3.6** — Auto 模式与 Computer Use 加固版本：`/mode auto` 自动批准低风险工具调用，但高风险 Bash 命令仍需确认，灾难性命令继续硬阻断；Desktop 不再以 Xiaok TCC 归因运行 `cua-driver doctor`；CUA 自启动/自修复、录屏、鼠标键盘自动化、驱动 UI 的 AppleScript 等 shell fallback 会被拒绝；交互式 shell handoff 能正确暂停和恢复终端 UI。

**v1.3.4** — Swarm 项目可靠性版本：小K种子 PO/Worker 任务改走完整 Desktop agent runtime，不再用能力残缺的 sidecar worker；KSwarm 任务交接改为文件化 handoff 和 artifact-first result manifest；本月/最近类调研门禁按当前日期与来源证据校准，不再用拍脑袋条数；保留用户原始目标/要求，把细化内容放进计划；最终交付物使用正式文件名，提交用产物不混入评审/修订过程说明；修复项目任务状态、时间显示、人工推进循环、产物预览/下载/导出，以及 KSwarm、Intent Broker、bundled plugins 的 release 打包同步。

**v1.3.2** — 桌面恢复版本：修复 `electron-updater` CJS/ESM 导入回归导致“检查更新”静默无反应的问题；左下角设置按钮旁新增清晰的升级/下载/安装提醒；修复定时任务在 `nextRunAt` 缺失或删除后仍被主进程调度状态影响的问题；KSwarm 重新制定计划会修复旧 PO 归属，异常时改派到当前最合适的 Xiaok PO，并发送完整 `assign_po` 项目上下文；发布门禁会校验 GitHub Latest 以及 macOS/Windows 更新元数据和安装包资产。已经安装受影响桌面版 `0.5.6` 或 `1.3.1` 的用户需要手动安装一次 `1.3.2`，后续版本才能走修复后的应用内更新。

**v1.3.1** — Desktop + KSwarm 可靠性版本：为 CLI agent 增加 runtime 探测和健康冷却，加入卡住运行 watchdog telemetry，失败重试重新走能力路由；PPTX/HTML/Markdown 任务进入 PO 验收前做强交付物校验，为显式 PPTX 演示任务提供确定性本地执行器兜底，修复 PO 制定计划中断后项目无法继续的问题，并修复 desktop release workflow 在 CI 中未 checkout KSwarm 导致打包失败的问题。

**v1.2.0** — KSwarm 蜂群式多智能体项目交付（对话中直接创建项目），持久化长期记忆（notebook_write/notebook_read 工具 + 设置界面管理），Agent 设置面板（人格/Spawn Profile/Provider 配置），模型配置增强（协议选择、高级 JSON），TaskPanel 分步进度上报实现多步骤自主任务追踪。

**v1.0.0** — 首个正式大版本：桌面版全量中英文国际化与运行时语言切换，KSwarm 多智能体协作编排与状态监控，项目管理看板与智能体分配，cron 定时任务系统，MCP 插件安装/卸载/启用/禁用，桌面版 v1.0.0 全功能集成。

**v0.7.4** — 终端鼠标跟踪修复与工具结果溢出：禁用 raw mode 入口处的鼠标跟踪序列防止 Ghostty/iTerm2 污染输入栏，完整消费未识别的 CSI 转义序列，大型工具结果溢出到磁盘而非静默截断，以及桌面版提醒处理优化。

**v0.7.3** — 并行任务执行与桌面版 v0.5.5：多 Thread 任务并发运行互不干扰，桌面版 MCP 插件集成、Skill 自动匹配、多轮上下文，以及通过 GitHub Actions 构建 Windows 安装包。

**v0.6.21** — 终端 stdout EPIPE 恢复与第二轮输入栏保持：从用户本机 transcript 复现已安装包失败，`[xiaok] UI 输出已停用：stdout_stream_error (Error: write EPIPE)` 会结束 scroll region，导致后续输入后的 `Thinking` 只以内联形式输出，输入栏/状态栏消失。现在 stdout EPIPE 只切换到原始 stderr 输出，不再停用 TUI；补充红绿验证的 injected-EPIPE chat runtime 回归、短视口 `file:///... report-creator` follow-up 测试、26 场景 tmux E2E，并在 bugfix 文档中记录之前错误的测试方式为什么漏掉这条路径。

**v0.6.20** — 终端 footer fallback 顺序与真实 TTY 不变量加固：修复非 scroll-region 的 `TerminalFrame` 路径，当 footer lines 是 `[summary,status]` 时 completed `Intent` 会错误渲染到输入栏下面；现在统一渲染为 `summary -> 两行空白保护 -> prompt -> status`。新增该顺序的红灯回归测试，并加严 tmux E2E：任何 `Intent` 出现在 prompt 下方、或 status 不是紧贴 prompt 下方的截图都会失败；同时在 bugfix 文档中记录这是第 12 轮 footer/input 修复，以及前 11 轮为什么没有覆盖这个 fallback 路径。

**v0.6.18** — 终端软换行补丁与路径开头 intent 修复，补齐 0.6.17 footer 回归遗漏：先用真实 tmux 复现用户反馈的窄终端失败，再修复 `MarkdownRenderer.flush()`，确保 streamed pending 行在真实终端软换行成多行时，会先清掉所有占用的物理行再渲染最终 Markdown；同时修复 `/Users/... 生成报告，然后生成幻灯片` 这类以本地绝对路径开头的工作请求被 intent planner 当成 slash control command 的问题，并补上 markdown、planner、chat-runtime 与 E2E 回归测试。

**v0.6.17** — 终端 footer/input 间距闭环与真实 TTY 回归加固：修复 activity 刷新时可能先出现 `Finalizing response` 但没有输入栏/状态栏的中间帧，提高 footer 安全间距，修正 wrapped Markdown 内部换行的 cursor 计数，把过长 footer 状态限制为单行，并用 scroll-region 聚焦回归和 23 场景真实 tmux E2E 锁住截图同类失败。

**v0.6.14** — Skill 执行可靠性与发版分层验证：把 strict skill 从“只靠提示词”升级为带 required references/scripts/steps 与 success checks 的结构化合同，引入 execution bundle、运行时 evidence 与 completion gate，持久化 adherence 结果用于后续调优，并把 skill 验证拆成日常快速套件与发版专用慢套件，分别覆盖 inline 与 fork 的 strict 执行路径。

**v0.6.8** — Windows tmux 终端稳定性与配置路径一致性：通过更保守的 footer 宽度预算和更严格的权限流重绘断言，修复真实 Windows tmux 下 pending/permission 阶段的 prompt、activity、status 错位；让自定义 agents 与 skills 从当前生效的 `xiaok` 配置目录解析，而不是写死 `~/.xiaok`；同时规范 Windows / npm 全局安装场景下的安装来源识别，并补强 Windows smoke test 的临时目录清理重试。

**v0.6.7** — 权限确认 transcript 保留与命令摘要修正：修复 renderer 权限确认前后最近工具输出行容易被覆盖的问题，统一权限菜单选项文字样式避免粗细不一致，并让 generic bash 的 `Ran` 卡片保留具体命令，而不是退化成“执行本地命令”。

**v0.6.6** — 安装来源识别与 update 准备：统一 npm 全局安装、源码 checkout 和链接构建的来源分类，供后续更新路径使用。

**v0.6.5** — 权限提示清理、runtime 控制面准备与崩溃记录：修复退出审批后残留或误擦 transcript；在 adapter 构造前解析 provider/model/auth；提取 session-store 接口并加入 SQLite + FTS5 基础。

**v0.6.4** — 终端 transcript 保留与输入布局：修复真实 tmux 换轮时上一轮尾行被覆盖，补充多行回复回归，并调整提交输入块和 footer 背景。

**v0.6.3** — resume transcript 与终端 UI 打磨：隐藏 session resume 回放中的内部 thinking 内容，修复 resume 后首轮输入会插进历史中间而不是接在末尾的问题，稳定权限弹窗持久化与 overlay 重绘行为，并继续打磨终端表现，让内容区提交块文字垂直居中、输入栏底色更深以提升对比度。

**v0.6.2** — chat slash 收口与 reminder 入口统一：把 reminder 的创建、列表、取消合并成单一 `/reminder <自然语言> | list | cancel <id>` 命令，移除本应保留为顶层 CLI 的陈旧 slash 入口，并补强交互测试，确保 slash 菜单、`/help`、重定向提示和 transcript 渲染始终一致。

**v0.6.1** — 验证体系加固与终端/运行时 bugfix：修复 OpenAI 兼容模型在 `thinking -> tool_use -> replay` 历史回放时丢失 `reasoning_content` 的问题，保证内容区上一条回答和下一条输入之间保留空白分隔行，并补齐 reasoning 字段 contract fixture 与 daemon 多实例隔离测试。

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

</details>
