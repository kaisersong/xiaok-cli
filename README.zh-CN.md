# xiaok-cli

> xiaok-cli 是一个本地优先的 AI 任务交付工作台。它会把用户意图收成可执行的 skill 运行链路，在执行中持续纠偏，并尽量把事情真正做成。代码任务、文档整理、报告/幻灯片生成，以及云之家这类可选 channel 入口，都运行在同一套 runtime 上。

一个面向代码与文档密集型工作的、本地优先的 AI CLI。

[English](README.md) | [简体中文](README.zh-CN.md)

---

## 效果展示

**基准测试结果：**

| 指标 | xiaok v1.0.0 | Claude Code | 提升 |
|------|-------------|-------------|------|
| **自主性得分** | 100% | 100% | — |
| **简单问答延迟** | 3.8s | 7.5s | **-49%** |
| **重命名任务延迟** | 27.6s | 180.8s | **-85%** |
| **Token 效率** | 100% | 250% | **-60%** |

**v1.3.4 新特性：**

- **Swarm 项目可靠性加固**：KSwarm 项目里的小K种子 PO/Worker 现在进入真正的 Desktop agent runtime，不再交给能力残缺的 sidecar worker；模型、工具、MCP、web-search、report/slide renderer 能力保持一致
- **文件化任务交接**：大上下文、任务要求、证据合同和产物合同通过 handoff 文件传递，不再用超长 broker 文本硬塞，降低截断风险，也方便恢复和审计
- **带证据的计划与验收**：本月/最近类调研任务会带当前日期、外部来源证据和更合理的质量门禁，PO 不再要求未来数据或拍脑袋的固定条数
- **面向用户的正式交付物**：最终文件名按项目/目标生成，提交用产物里不出现评审回应、修订说明、第二轮定稿等过程痕迹；报告/演示文稿优先走对应 renderer
- **项目界面可解释性修复**：项目卡片、任务看板、产物列表、HTML 预览、临时定时恢复任务和 agent 状态显示更清楚，失败原因、时间点和可恢复动作可见
- **发布打包同步**：Desktop release 构建会把当前 Xiaok、KSwarm、Intent Broker 和 bundled plugins 一起 checkout、构建和打包

**v1.3.2 新特性：**

- **桌面更新链路恢复**：修复 `electron-updater` CJS/ESM interop 导致“检查更新”静默无反应的问题
- **主动升级提醒**：当发现新版桌面端时，左下角设置 icon 左侧会显示清晰的升级/下载/安装提醒
- **定时任务恢复**：Desktop 定时任务会修复缺失的 `nextRunAt`，自动执行结果会关联回任务 Thread，删除任务也会同步移出主进程调度状态
- **KSwarm 重新制定计划改派 PO**：“重新制定计划”现在会检查项目里保存的 PO 是否缺失、归档、角色不对、启动失败或仍是旧 `xiaok` 单体；异常时会改派到当前最合适的 Xiaok PO，并带完整项目上下文重新发起规划
- **发布门禁**：desktop release CI 会把桌面 tag 标记为 GitHub Latest，并校验 `latest-mac.yml`、`latest.yml` 和安装包资产一致后才算发布有效
- **一次性手动恢复**：桌面版 `0.5.6` 和 `1.3.1` 可能已经带着本地 updater loader 缺陷，受影响用户需要手动安装一次 `1.3.2`；之后才能通过修复后的应用内更新继续升级

**v1.3.1 新特性：**

- **KSwarm 可靠性版本**：新增 runtime 健康探测、卡住运行 watchdog、按能力路由，以及对“在线但 CLI 不可执行”的 agent 自动降级/冷却
- **项目规划可恢复**：如果 Xiaok/Desktop 或 PO agent 在制定计划阶段中断，项目详情页会显示“重新制定计划”，项目不再卡死
- **交付物合同校验**：显式要求 PPTX/HTML/Markdown 的任务会在进入 PO 验收前校验产物类型，Markdown 不再能冒充幻灯片交付
- **本地执行器注册表**：当没有健康 agent 具备 PPTX 输出能力时，明确要求 PPTX 的演示任务可以使用确定性的注册执行器兜底
- **桌面配置保持**：Desktop 启动与发布流程统一使用真实用户 HOME，模型、skill、plugin、channel 配置不会因为隔离 HOME 消失
- **发布打包刷新**：macOS 与 Windows 桌面产物统一从 1.3.1 源码和插件 bundle 基线构建

**v1.2.0 新特性：**

- **KSwarm 蜂群式项目交付**：在对话中创建多智能体协作项目 — Agent 自动选择 PO + 成员，分发任务，团队协作交付高质量成果
- **长期记忆**：Agent 跨会话记住用户偏好、姓名、习惯，通过 `notebook_write`/`notebook_read` 工具持久化
- **记忆管理界面**：在设置面板中查看、新增、删除持久化记忆条目
- **Agent 设置面板**：配置 Agent 人格、Spawn Profile、LLM Provider 绑定
- **模型配置增强**：Provider 设置支持协议选择和高级 JSON 配置
- **更智能的任务交付**：TaskPanel 分步进度上报，Agent 自主规划和追踪多步骤工作

**v1.1.0 新特性：**

- **产物 Canvas 修订**：HTML 预览中点击"修订"标注元素，携带完整 DOM 上下文向 Agent 发送修改指令
- **预览自动刷新**：Agent 修改产物文件后 Canvas 预览自动重新加载
- **产物卡片**：Claude 风格文件卡片，带类型图标、标题和"打开"按钮，产物一目了然
- **欢迎页改版**：个性化打字机问候语，面向企业场景的快速提示词
- **个人资料设置**：通用设置中可编辑显示名称和头像（localStorage 存储，系统用户名降级）
- **插件打包方案**：完整的桌面端插件生命周期设计文档（esbuild + Python venv）

**v1.0.0 新特性：**

- **完整 i18n 支持**：桌面版全量中英文国际化，支持运行时语言切换
- **KSwarm 多智能体**：多 AI 智能体协作执行复杂任务，状态实时监控
- **项目管理**：看板、需求跟踪、智能体分配、活动时间线、产物视图
- **定时任务**：支持 cron 表达式的周期任务，可暂停/恢复/手动执行
- **插件系统**：从 GitHub 或本地安装、管理 MCP Server 插件
- **桌面版 v1.0.0**：原生 macOS/Windows 应用，侧边栏、Canvas 预览、设置界面、自动更新

**典型使用场景：**

1. 本地终端交互式对话：`xiaok`
2. 恢复上次会话：`xiaok -c`
3. 单次任务执行：`xiaok "review the changes"`
4. 通过已安装 skill 生成报告、brief 或幻灯片
5. 启动本地 daemon：`xiaok daemon start`
6. 可选的云之家 / 移动端接入：`xiaok yzjchannel serve`、`/yzjchannel`

---

## Swarm 项目

xiaok Desktop 内置 KSwarm 项目交付能力，适合需要计划、并行执行、质量验收和最终汇总的工作。一个项目包含人类审批过的计划、PO agent、worker agents、任务看板、产物和最终交付物。

v1.3.4 的 Swarm 路径重点把职责边界理清：

- **KSwarm 负责项目生命周期**：项目状态、计划审批、阶段派发、任务状态、重试、评审记录、交付清单和恢复决策。
- **Agent 负责真实执行**：小K种子 PO/Worker 走完整 Desktop agent runtime；Claude、Codex、Qoder 等外部 agent 通过各自 broker adapter 执行。
- **Renderer 负责正式输出**：用户要求报告或演示文稿时，优先生成 renderer-backed HTML 产物；只有用户明确要求 Markdown 或 PPTX 时才强制对应格式。
- **Artifact 是事实来源**：任务完成必须提交真实文件或可解析的产物引用，不能只在摘要里说“已生成”。
- **质量门禁按任务语境生效**：硬门禁只覆盖缺产物、格式不对、缺来源证据、renderer shell 无效等客观合同；“本月产品动态要几条才够”这类内容要求应来自项目类型知识，而不是全局硬编码。

这让 Swarm 项目更适合调研报告、产品分析、技术大会演讲准备、文档生产等多步骤交付场景：用户能看到进度，也能在中断后恢复。

---

## 设计理念

### 1. 意图优先的任务交付

xiaok 的目标是让用户感觉“AI 在做事”，而不是“我在操作一个流程系统”。

- 重要请求会被视作带交付物的 intent，而不是普通聊天 turn。
- skill 会按当前意图和阶段去匹配，并结合运行时证据做轻量重排。
- 多阶段工作主要在内部编排，用户看到的是进展和结果，不是模板流程。
- 最终输出应该更像交付结果，而不是状态回执。

### 2. 7 层 Prompt 架构

System Prompt 采用 CC 风格的 7 层设计，显式静态/动态分界：

**静态前缀（可缓存，跨 turn 稳定）：**

| 层 | Section | 内容 |
|---|---------|------|
| 1 | Intro | 角色定义 — 任务交付型 AI skill 工作台；苍穹/云之家属于擅长场景 |
| 2 | System | 运行时规则 — permission mode、prompt injection 防护 |
| 3 | DoingTasks | 任务哲学 — 不加功能、先读后改、安全意识 |
| 4 | Actions | 风险边界 — 破坏性操作需确认 |
| 5 | UsingTools | 工具语法 — read 不用 cat、并行调用 |
| 6 | ToneAndStyle | 交互风格 — 简洁、file_path:line_number |
| 7 | OutputEfficiency | 输出效率 — 先说结论不铺垫 |

**动态后缀（每 turn 重建）：**
- 会话上下文、Session Guidance、Memory 注入、Token Budget、自动上下文

### 3. 安全优先

**Bash 安全分类器**（三级风险）：

| 级别 | 命令示例 | 行为 |
|------|----------|------|
| Block | `rm -rf /`、`mkfs`、`curl|sh` | 直接拒绝 |
| Warn | `rm -rf`、`git reset --hard`、`DROP TABLE` | 需确认 |
| Safe | 其他命令 | 直接执行 |

**工具输入校验** — JSON Schema 验证器在每次工具调用前校验必填字段和类型。

### 4. 分阶段上下文管理

长任务不应该无限堆成一个越来越飘的大上下文。xiaok 会把完整事实保存在会话状态里，但尽量只把当前阶段需要的内容投影给模型：

1. **微压缩** — 工具结果超过 8000 字符自动截断
2. **阶段交接** — 阶段完成后可把 artifact 交接到新的上下文，而不是把整条历史硬拖下去
3. **记忆回注** — compact / handoff 后把相关记忆重新注入会话

### 5. 类型化记忆

持久化文件记忆存储，支持类型分类：

- `user` — 用户偏好、角色、知识
- `feedback` — 用户对 AI 行为的确认/纠正
- `project` — 项目进度、决策、bug
- `reference` — 外部资源指针

### 6. 非侵入多 Agent 协作

通过 Intent Broker 生命周期 hook 接入：
- SessionStart / UserPromptSubmit / Stop
- session_id / transcript_path 上下文注入
- auto-continue 多 Agent 协作

---

## 安装

### npm 安装

```bash
npm install -g xiaokcode
```

更新到最新版本：

```bash
npm update -g xiaokcode
```

安装后直接运行：

```bash
xiaok
```

npm 包名是 `xiaokcode`，但 CLI 命令仍然保持 `xiaok`。

### 源码安装（开发用）

```bash
git clone https://github.com/kaisersong/xiaok-cli ~/.xiaok-cli
cd ~/.xiaok-cli
npm install
npm run build
```

源码安装路径只用于参与 `xiaok-cli` 开发，或需要保留本地 git 仓库的场景。

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

## 桌面版

xiaok Desktop 是一个原生 macOS 应用，为 xiaok 运行时提供图形界面。它与 CLI 共享同一套后端，但提供侧边栏浏览任务历史、Canvas 预览生成的文件、以及设置管理界面。

### 下载

从 [GitHub Releases](https://github.com/kaisersong/xiaok-cli/releases) 下载：

- **xiaok-1.3.4-arm64.dmg** — macOS DMG 安装包（Apple Silicon）
- **xiaok-1.3.4-arm64-mac.zip** — macOS ZIP 包（Apple Silicon）
- **xiaok-setup-1.3.4.exe** — Windows 安装包（x64）

### 功能特性

- **任务侧边栏**：浏览最近任务，切换时显示选中高亮
- **Canvas 预览**：自动打开生成的文件（HTML、MD、PDF）在侧边面板
- **项目管理**：看板拖拽、智能体分配、活动时间线
- **KSwarm 多智能体**：从界面创建、审批、恢复、验收和交付多智能体项目
- **定时任务**：创建周期任务（每小时、每天、每周、cron）
- **插件系统**：安装和管理 MCP Server 插件，支持启用/禁用
- **国际化**：完整中英文支持，运行时切换语言
- **设置界面**：配置模型提供商、技能、消息通道、MCP 服务器
- **自动更新**：新版本发布时自动通知更新，并在设置按钮左侧显示升级提醒

### 开发构建

本地构建桌面版：

```bash
cd desktop
npm install
npm run build
npx electron-builder --mac --arm64
```

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
xiaok yzjchannel serve
```

### 会话内命令

```text
/exit                         退出会话
/clear                        清屏
/compact                      压缩当前会话上下文
/context                      查看当前仓库上下文
/mode [default|auto|plan]     查看或切换权限模式
/models                       切换模型
/reminder <自然语言>          创建提醒
/reminder list                查看提醒列表
/reminder cancel <id>         取消提醒
/settings                     查看当前生效配置
/skills-reload                重新加载已安装 skill
/yzjchannel                   连接嵌入式云之家 channel
/help                         显示帮助
/<skill-name> [args]          调用 skill
```

### 云之家 IM 命令

```text
/help                    显示帮助
/bind <cwd>              绑定工作区
/bind clear              清除工作区绑定
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

**云之家集成（可选 channel 适配器）：**

```bash
# 配置
xiaok yzjchannel config set-webhook-url "https://..."

# 启动网关
xiaok yzjchannel serve

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
- **结构化 skill 合同** — 支持 `required-references`、`required-scripts`、`required-steps`、`success-checks`
- **严格执行可靠性** — execution bundle、evidence 记录、completion gate 和 adherence eval

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
npm test            # 默认 sandbox + eval 套件
npm run test:skill:fast     # 日常快速 skill 回归
npm run test:skill:release  # 发版前 skill 执行套件
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
