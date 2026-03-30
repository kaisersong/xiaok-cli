# xiaok Clio Adoption Wave 1 Runtime and Tools Design

**Context**

本设计以 `D:\projects\clio\README.md` 的 `Features` 与 `Tools` 为参考来源，但不是做一比一克隆。目标是在保留 `xiaok` 现有 CLI、YZJ channel、skills、runtime layer 的前提下，把最能立刻提升单机 agent 体验的运行时与工具能力优先引入。

当前基线以已合并代码为准：

- `xiaok chat` 已有 runtime layer、streaming、skills、基础 status bar、MCP schema 归一化、custom agents
- YZJ 已具备 remote agent surface 与 async task control plane
- 默认测试入口已切为 sandbox-safe 的 `npm test`

## Goal

第一轮聚焦“把 `xiaok chat` 变成一个更完整的本地 agent shell”。优先补齐会话持久化、上下文治理、非交互模式、上下文自动加载、基础 web 工具，以及现有文件类工具的分页/截断能力。

## In Scope

本轮覆盖以下 Clio 能力：

- Sessions
  - 自动保存会话
  - `--resume <id>`
  - `--fork-session <id>`
- Print mode
  - `-p` / 非交互输出
  - JSON 友好的稳定输出模式
- Model-aware context
  - 按模型动态 context limit
  - 统一 compact 策略
- Prompt caching
  - system prompt / tool schema / message history cache metadata
  - 先对支持的 adapter 生效
- Context auto-load
  - 向上遍历加载 `CLAUDE.md` / `AGENTS.md`
  - git branch / status / recent commits 注入系统提示
- Tools
  - `WebFetch`
  - `WebSearch`
  - `Read` offset / limit / line numbers 强化
  - `Glob` head_limit / offset 分页
  - `Grep` output_mode / head_limit / context / glob/type filter
  - `Bash` 输出截断规则统一
- Image input
  - CLI 中粘贴本地图片路径，转换为多模态输入块

## Explicit Non-Goals

- 不做 Cost Tracking
- 不做 background agents / teams / plugin system / LSP
- 不做 plan mode / task tools / ask user
- 不做 git workflow 命令
- 不做 sandbox policy 重写

## Design Principles

1. 先收敛 `chat` 主路径，再扩展外围能力。
2. 优先补“上下文、工具、会话”这些会直接影响 agent 成功率的基础设施。
3. 复用现有 runtime layer，不回退到把所有逻辑重新塞回 `Agent`。
4. 新功能优先对 CLI 有用，同时不阻碍未来复用到 YZJ remote task 执行。

## Feature Mapping

### 1. Session Persistence

新增 session store，把 `AgentSessionState` 的消息历史、usage、model、cwd、时间戳持久化到本地目录，例如 `.xiaok/sessions/` 或全局 `~/.xiaok/sessions/`。`chat` 命令新增：

- `--resume <id>`：加载已有会话状态并继续
- `--fork-session <id>`：复制会话状态，生成新会话 id

这层只持久化 runtime state，不持久化 shell process 或 tool side effects。

### 2. Print Mode

新增非交互执行模式，与当前“传入 initialInput 执行一次”区分开。目标是让脚本调用时输出稳定、可管道消费。

最低要求：

- `xiaok chat -p "task"` 输出纯 assistant 文本
- `--json` 时输出结构化结果，至少包含 `sessionId`、`text`、`usage`
- 非交互模式下禁用交互输入 UI、spinner、菜单、status bar 动态渲染

### 3. Context Governance

把 context budget 从固定值扩展为“配置默认值 + adapter/model 覆盖值”。compact 触发点不再只依赖单个 budget，而是：

- 从 adapter 侧声明模型能力
- runtime 根据 `modelContextLimit * threshold` 决定 compact
- compact marker、保留最近消息数、是否保留工具结果可配置

### 4. Prompt Caching

在 adapter 层引入 cache metadata 抽象，而不是把 Anthropic 特性直接写死在业务逻辑中。

设计方式：

- runtime 负责把 system prompt、tool definitions、history 划分为 cacheable segments
- adapter 决定如何映射到底层 provider payload
- unsupported provider 忽略该元数据，不影响功能正确性

### 5. Context Auto-Load

当前 `buildSystemPrompt()` 已注入部分 cwd / budget / skills / agents 信息，本轮补：

- 向上查找 `CLAUDE.md`、`AGENTS.md`
- 限制总注入大小，避免文档本身炸 context
- 注入 git branch、dirty 状态、最近若干 commit subject

### 6. Tool Surface Expansion

新增 `WebFetch` 与 `WebSearch`，并把现有工具改成统一的“截断与分页语义”。

统一约束：

- 所有大输出工具都有上限
- 所有文件/搜索工具都有 offset/head_limit
- 所有结果都对模型友好，避免一次灌入大量冗余文本

### 7. Image Input

CLI 输入层识别本地图片路径，读取并封装为 image block。适配器若支持 image input 则传递；不支持则在入口处明确报错。

## Architecture

新增以下运行时单元：

- `src/ai/runtime/session-store.ts`
  - 负责序列化/反序列化 session
- `src/ai/runtime/model-capabilities.ts`
  - 定义各 provider/model 的 context limit、是否支持 image、是否支持 prompt caching
- `src/ai/runtime/context-loader.ts`
  - 负责向上遍历 prompt docs 与 git context
- `src/ai/tools/web-fetch.ts`
- `src/ai/tools/web-search.ts`
- `src/ai/tools/truncation.ts`
  - 抽出工具输出截断与分页规则

已有文件的职责变化：

- `src/commands/chat.ts`
  - 增加 resume/fork/print/image 输入路径
- `src/ai/agent.ts`
  - 继续保持 facade，不直接承载会话持久化细节
- `src/ai/runtime/agent-runtime.ts`
  - 增加 session lifecycle、context policy、cache segment 组装
- `src/ai/models.ts` / adapters
  - 暴露 model capabilities，接收 cache/image payload
- `src/ai/tools/index.ts`
  - 注册新工具，统一工具选项

## Testing Strategy

- runtime session persistence tests
- chat resume/fork/print mode integration tests
- context loader tests
- model capability tests
- web tool tests
- truncation/pagination tests
- image path parsing tests

## Exit Criteria

- `xiaok chat --resume <id>` 能恢复上下文继续对话
- `xiaok chat -p "task"` 可稳定用于脚本调用
- `WebFetch` / `WebSearch` 能在 CLI agent 中可用
- Read/Glob/Grep/Bash 的截断分页行为有测试覆盖
- context limit 不再硬编码为单一预算
- prompt docs 与 git context 自动进入 system prompt

