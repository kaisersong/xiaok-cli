# xiaok CLI — 设计规范

**日期：** 2026-03-29
**状态：** 已批准

---

## 概述

xiaok 是面向云之家（yunzhijia.com）开发者的 AI 编程 CLI，相当于云之家开发者生态中的 Claude Code / Codex。它与 **yzj CLI**（相当于 `gh` 的平台资源管理工具）配合使用，并将其作为工具之一调用。

| 工具 | 类比 | 职责 |
|------|------|------|
| xiaok CLI | Claude Code / Codex | AI 编程助手 |
| yzj CLI | GitHub CLI (gh) | 平台资源管理 |

---

## 目标用户

所有类别的云之家开发者：
- 在云之家开放平台上开发应用的外部 ISV / 集成商
- 开发云之家功能的金蝶内部开发者
- 为本企业定制云之家应用的企业 IT 开发者

---

## 核心设计决策

- **语言：** TypeScript / Node.js — AI 辅助开发体验最佳，Claude Code 和 Codex 生成的 TypeScript 代码质量最高，`npm install -g xiaok` 分发便捷
- **模型支持：** 多模型可配置（Claude、OpenAI、自定义端点）
- **身份认证：** 浏览器 OAuth 2.0（`xiaok auth login`），通过 `~/.xiaok/credentials.json` 与 yzj CLI 共享凭据
- **架构：** 内部模块化的单体 CLI — 单个 `xiaok` 命令入口，无需插件安装

---

## 架构

### 目录结构

```
xiaok-cli/
├── src/
│   ├── index.ts                  # CLI 入口，命令注册
│   ├── auth/
│   │   ├── login.ts              # OAuth 2.0 浏览器授权流程
│   │   ├── token-store.ts        # Token 存储（读写 credentials.json）
│   │   └── identity.ts           # 开发者应用身份（appKey、appSecret，用于云之家开放平台）
│   ├── ai/
│   │   ├── agent.ts              # AI Agent 主循环
│   │   ├── models.ts             # 多模型适配层
│   │   ├── tools/
│   │   │   ├── bash.ts           # Shell 命令执行（含 yzj CLI 调用）
│   │   │   ├── read.ts           # 文件读取
│   │   │   ├── write.ts          # 文件写入
│   │   │   ├── edit.ts           # 精确文件编辑（字符串替换）
│   │   │   ├── grep.ts           # 内容搜索
│   │   │   └── glob.ts           # 文件模式匹配
│   │   └── context/
│   │       └── yzj-context.ts    # 云之家 API 文档 + yzj CLI 帮助注入到系统提示
│   ├── commands/
│   │   ├── auth.ts               # xiaok auth login/logout/status
│   │   ├── chat.ts               # xiaok / xiaok chat（交互式 Agent）
│   │   └── config.ts             # xiaok config get/set
│   └── utils/
│       ├── config.ts             # 配置文件读写（~/.xiaok/config.json）
│       └── ui.ts                 # 终端渲染（流式输出、Markdown）
├── package.json
└── tsconfig.json
```

### 核心数据流

```
用户输入
  → 构建 messages（系统提示 + 历史记录 + 用户输入）
  → 调用模型 API（流式）
  → 解析 tool_use → 执行工具
  → 将工具结果追加到 messages
  → 循环，直到模型返回纯文本（无工具调用）
  → 输出结果，等待下一轮输入
```

---

## 命令

### Phase 1（核心骨架，除 auth 外全部实现）

```bash
# 身份认证（Phase 1 占位，完整 OAuth 流程在 Phase 2 实现）
xiaok auth login          # 浏览器 OAuth 授权，存储 token
xiaok auth logout         # 清除凭据
xiaok auth status         # 显示当前账号和企业

# AI Agent（核心功能，Phase 1 完整实现）
xiaok                     # 启动交互式 Agent（默认）
xiaok chat                # 同上，显式写法
xiaok "任务描述"           # 单次任务模式
xiaok chat --auto         # 非交互模式，无需确认（适用于 CI/脚本）
xiaok chat --dry-run      # 打印工具调用但不执行（用于测试/调试）

# 配置
xiaok config set model claude-opus-4-6
xiaok config set model openai/gpt-4o
xiaok config set model custom --base-url https://... --api-key ...
xiaok config set api-key <key>                     # 设置当前模型提供商的 API Key
xiaok config set api-key <key> --provider claude   # 设置指定提供商的 API Key
xiaok config get model
```

### Phase 2+（平台资源管理，通过 yzj CLI）

所有平台操作（消息、应用、组织架构、工作流、日志）均由 **yzj CLI** 负责，xiaok 的 AI Agent 通过 `bash` 工具调用。xiaok 本身不重复实现这些命令。

---

## 模块说明

### 1. 身份认证模块

> **Phase 1 状态：** 实现基础 OAuth 流程（登录/登出/状态查看）。OAuth Scope 支持在 Phase 2 完善。

**OAuth 2.0 流程细节：**
- 回调服务器：绑定随机可用端口（49152–65535），授权时将实际端口包含在 `redirect_uri` 中发送给 OAuth 服务器
- 云之家 OAuth 应用注册支持动态 redirect URI（`http://localhost:*`）
- 使用 PKCE（RFC 7636）— xiaok 是公开客户端，二进制中不存储 secret
- 请求的 Scope：Phase 1 仅使用 `openid profile`，Phase 2 再根据 yzj CLI 需求扩展
- Token 刷新：懒刷新策略——收到 401 响应时触发刷新；在每次请求前检查 `expiresAt`，若 token 将在 5 分钟内过期则主动刷新
- **Schema 所有权：** xiaok 拥有 `credentials.json`，yzj CLI 是只读消费方，永不写入此文件

**Token 存储：**
- `~/.xiaok/credentials.json` 以**明文 JSON** 存储（Phase 1 不加密）
- 在 Unix 上设置文件权限为 `0600`（仅所有者可读写）；在 Windows 上存储于 `%APPDATA%\xiaok\credentials.json`，通过 ACL 限制为当前用户
- 设计理由：操作系统级文件权限足以保护开发者 token；加密需引入密钥派生方案，复杂度与收益不成比例
- 未来：Phase 2 迁移至操作系统密钥链（macOS Keychain、Windows Credential Manager）

**与 yzj CLI 共享凭据：**
- yzj CLI 只读取 `~/.xiaok/credentials.json` 中的 `accessToken` 和 `enterpriseId` 字段
- Token 刷新由 xiaok 负责；yzj CLI 遇到 401 时，提示用户运行 `xiaok auth login`
- Phase 1 无需文件锁（刷新频率低；yzj CLI 只读）

**开发者应用身份（`identity.ts`）：**
- 与登录身份不同，代表开发者在云之家开放平台注册的自有应用（appKey + appSecret），用于生成以应用身份调用云之家 API 的集成代码
- 存储在 `~/.xiaok/config.json` 的 `devApp: { appKey, appSecret }` 字段下
- 注入系统提示，使 AI Agent 在生成集成代码时了解开发者的应用上下文

### 2. AI Agent 模块（核心，Phase 1 完整实现）

- 交互模式：流式输出、Markdown 渲染、多轮对话
- 对话历史**仅保存在内存中**——Phase 1 不持久化。Ctrl-C 或 EOF 后历史丢失。Phase 2 添加会话持久化。
- 单次任务模式：`xiaok "写一个调用云之家消息 API 的脚本"`
- **信号处理：** 收到 SIGINT（Ctrl-C）时：
  - 若工具正在执行：向子进程发送 SIGTERM，等待最多 2 秒后发送 SIGKILL；不回滚文件（工具自行负责原子写入）
  - 若无工具运行：干净退出
  - 已写入文件的内容保留原样；用户自行检查未提交的变更
- **`--dry-run` 标志：** 将每次工具调用（名称 + 参数）打印到 stdout，不实际执行。模型 API 调用正常进行，仅工具执行被跳过。

**工具权限模型：**
- **安全工具**（从不提示确认）：`read`、`grep`、`glob`
- **写入工具**（默认模式下提示，`--auto` 下自动执行）：`write`、`edit`
- **Bash 工具**（默认模式下始终提示，`--auto` 下自动执行）：所有 bash 命令均视为潜在危险操作，不解析 bash 意图
- **会话内"全部同意"：** 用户在任意确认提示处输入 `y!`，当前会话切换为 `--auto` 模式，无需重启

### 3. 多模型适配层（Phase 1 完整实现）

**TypeScript 接口：**

```typescript
interface ModelAdapter {
  // 流式聊天补全；随到随发
  // systemPrompt 单独传递以匹配 Claude 的顶层 system 参数；
  // 使用消息式 system 的提供商（如 OpenAI）在内部将其前置
  stream(
    messages: Message[],
    tools: ToolDefinition[],
    systemPrompt: string
  ): AsyncIterable<StreamChunk>;
}

type StreamChunk =
  | { type: 'text'; delta: string }
  // tool_use 在每次工具调用时发出一次，包含完整组装的 input。
  // 适配器必须缓冲增量参数 delta（Anthropic input_json_delta /
  // OpenAI tool_calls[].function.arguments），在完整 JSON 组装并解析后再发出。
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'done' };

interface Message {
  role: 'user' | 'assistant' | 'tool_result';
  content: string | ToolResultContent[];
}

interface ToolResultContent {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>; // JSON Schema
}
```

每个提供商适配器（Claude、OpenAI、自定义）实现 `ModelAdapter`，Agent 只依赖此接口。

**流式规范化：** 每个适配器将提供商特定的 SSE 事件映射到 `StreamChunk` 联合类型。工具调用解析差异（Claude 的 `tool_use` 块 vs OpenAI 的 `tool_calls` 数组）完全封装在各适配器内部。适配器必须缓冲增量工具参数 delta，在完整 `input` JSON 组装并解析后才发出单个 `tool_use` chunk。

**限流与重试：** 每个适配器处理自身的重试逻辑（429/5xx 指数退避，最多 3 次）。Agent 循环层不负责重试。

**各提供商 API Key 优先级：**

```
环境变量（XIAOK_CLAUDE_API_KEY、XIAOK_OPENAI_API_KEY 等）
  > ~/.xiaok/config.json models[provider].apiKey
  > 报错：需要提供 API Key
```

不支持无前缀的 `XIAOK_API_KEY`——使用各提供商专属形式，避免多模型配置时产生歧义。

无内置免费额度——用户必须提供 API Key。未配置时，xiaok 退出并给出明确提示：`运行: xiaok config set api-key <key>`。

**多模型配置 Schema：**
```json
{
  "schemaVersion": 1,
  "defaultModel": "claude",
  "models": {
    "claude": { "model": "claude-opus-4-6", "apiKey": "sk-ant-..." },
    "openai": { "model": "gpt-4o", "apiKey": "sk-..." },
    "custom": { "baseUrl": "https://...", "apiKey": "..." }
  },
  "devApp": { "appKey": "...", "appSecret": "..." },
  "defaultMode": "interactive",
  "contextBudget": 4000
}
```

### 4. 云之家上下文注入（Phase 1 完整实现）

系统提示在会话启动时组装，包含以下内容：

1. **内置云之家 API 概览**（约 2000 tokens）：精心整理、随 xiaok 版本发布的云之家开放 API 摘要。运行时不动态拉取，通过发版更新。

2. **yzj CLI 参考文档**（若已安装）：会话启动时运行 `yzj --help` 和已知命令组的 `yzj <command> --help`。每条命令超时 3 秒；yzj CLI 未安装或超时时静默跳过。

3. **当前会话上下文**：已登录的企业 ID、开发者应用名（来自 identity.ts）、当前工作目录。

**Token 预算：** 上下文注入总量上限为 4000 tokens。超出时优先截断 yzj 帮助文档，再截断 API 概览。可通过 `xiaok config set context-budget <tokens>` 覆盖默认值。

### 5. 内置工具集（Phase 1 完整实现）

| 工具 | 权限类别 | 说明 |
|------|---------|------|
| `bash` | 始终提示（或 `--auto`）| 执行 Shell 命令，含 yzj CLI 调用 |
| `read` | 安全 | 读取文件内容 |
| `write` | 写入 | 写入/创建文件 |
| `edit` | 写入 | 精确字符串替换 |
| `grep` | 安全 | 正则表达式内容搜索 |
| `glob` | 安全 | 文件模式匹配 |

---

## 错误处理

| 场景 | 处理方式 |
|------|---------|
| Token 过期 | 懒刷新；刷新失败则提示运行 `xiaok auth login` |
| 模型 API 429/5xx | 适配器内指数退避，最多重试 3 次，超限后向上报错 |
| 工具执行失败 | 将错误文本返回给模型，由模型自行纠正 |
| yzj CLI 未安装 | 跳过 AI 上下文注入；bash 工具仍可正常使用；显示一次安装提示 |
| 未配置 API Key | 立即退出，提示：`运行: xiaok config set api-key <key>` |
| stdin 非 TTY（CI 环境）| 隐式视为 `--auto` 模式并打印警告 |

---

## 测试策略

- **单元测试：** 各模型适配器、Token 存储读写、配置读写、工具权限逻辑
- **集成测试：** Mock 云之家 OAuth 端点、Mock 模型 API 流式响应
- **E2E 测试：** 真实 Agent 循环配合 `--dry-run` 标志，验证工具调用序列，无副作用

---

## 配置文件

`~/.xiaok/config.json`（schema 版本 1）：
```json
{
  "schemaVersion": 1,
  "defaultModel": "claude",
  "models": {
    "claude": { "model": "claude-opus-4-6", "apiKey": "sk-ant-..." },
    "openai": { "model": "gpt-4o", "apiKey": "sk-..." },
    "custom": { "baseUrl": "https://...", "apiKey": "..." }
  },
  "devApp": { "appKey": "...", "appSecret": "..." },
  "defaultMode": "interactive",
  "contextBudget": 4000
}
```

`~/.xiaok/credentials.json`（xiaok 拥有，yzj CLI 只读）：
```json
{
  "schemaVersion": 1,
  "accessToken": "...",
  "refreshToken": "...",
  "enterpriseId": "...",
  "userId": "...",
  "expiresAt": "2026-03-29T12:00:00Z"
}
```

**Schema 版本控制：** 两个文件均包含 `schemaVersion: 1`。启动时 xiaok 检查版本号；若读取到未知版本，将旧文件重命名为 `*.bak` 后重新开始。版本间自动迁移在未来阶段实现。

---

## 开放问题 / 前置条件

以下问题已解决，无需阻塞实现：

| # | 问题 | 决策 |
|---|------|------|
| 1 | 云之家 OAuth 是否支持动态 redirect URI？ | 是，支持 `http://localhost:*` 动态端口 |
| 2 | yzj CLI 需要哪些 OAuth Scope？ | Phase 1 仅用 `openid profile`，Phase 2 根据需求扩展 |

---

## Phase 1 范围外

- GUI / Web 界面
- 插件安装系统
- 内置平台资源命令（委托给 yzj CLI）
- 本地模型推理
- 对话历史持久化（Phase 1 仅保存在内存中）
- 操作系统密钥链集成（Phase 1 使用明文文件 + `0600` 权限）
- 配置/凭据 Schema 版本自动迁移
- OAuth Scope 扩展（Phase 2 实现）
