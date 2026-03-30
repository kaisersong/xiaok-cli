# xiaok 设计思路：从零构建一个面向企业开发者的 AI 编程 CLI

> 本文记录 xiaok 在每一层的技术决策和实现细节。xiaok 是一个面向金蝶云之家开发者的垂直场景 AI 编程助手。

## 为什么要做 xiaok

起点很简单：云之家开发者需要一个懂业务的编程助手。

通用 AI CLI（Claude Code、Cursor、Aider）对云之家 API、金蝶苍穹开发、轻应用 Webhook 配置这些场景一无所知。每次都要手动贴文档、解释上下文、纠正幻觉。xiaok 要解决的就是这个问题——把云之家的领域知识内置进系统提示，让模型从第一轮对话就知道怎么调 `/v1/message/send`、怎么配 OAuth 2.0、怎么写工作流触发器。

技术栈选择：纯 TypeScript，依赖极少。运行时只依赖 `@anthropic-ai/sdk`、`openai`、`commander`、`fast-glob` 四个包。52 个源文件，不到一万行代码。

## 整体架构

在写任何代码之前，先在脑子里跑通一个最小循环：

```
用户输入 → 组装请求 → API 调用（流式） → 解析响应
→ 根据 stop_reason 决定分支：
    text → 输出到终端，结束本轮
    tool_use → 执行工具 → 将 tool_result 追加到 messages → 下一轮迭代
```

这个循环画清楚，架构就定了。

### 目录结构

```
src/
├── commands/       CLI 命令入口（auth / config / chat）
├── ai/
│   ├── adapters/   模型适配层（Claude / OpenAI）
│   ├── agent.ts    Agent Loop 核心
│   ├── tools/      内置工具（read / write / edit / bash / grep / glob）
│   ├── skills/     Skill 系统（斜杠命令）
│   ├── agents/     自定义 Agent 加载器
│   ├── context/    System Prompt 构建（云之家上下文）
│   ├── permissions/ 权限管理
│   ├── runtime/    消息块定义与 token 管理
│   └── mcp/        MCP 工具命名空间
├── ui/             终端 UI（Markdown 渲染 / 状态栏 / 输入交互）
├── auth/           云之家 OAuth 认证
├── runtime/        事件系统与 Hooks
├── utils/          配置加载与通用工具
└── types.ts        全局类型定义
```

层之间的依赖是单向的：`agent.ts` 不依赖 `ui/`，`tools/` 不依赖 `skills/`。UI 层只负责渲染 Agent 产出的流式数据。

## 多模型适配：一个接口，三条路径

xiaok 从第一天就支持多模型，这不是锦上添花，而是企业场景的刚需——有的团队用 Claude，有的用 GPT，有的跑本地 Ollama。

核心抽象是 `ModelAdapter` 接口：

```typescript
interface ModelAdapter {
  stream(
    messages: Message[],
    tools: ToolDefinition[],
    systemPrompt: string
  ): AsyncIterable<StreamChunk>;
}
```

所有模型适配器只需实现这一个方法。`StreamChunk` 是统一的内部事件类型：

```typescript
type StreamChunk =
  | { type: 'text'; delta: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'usage'; usage: UsageStats }
  | { type: 'done' };
```

Agent Loop 完全不感知 API 格式差异。

### Claude 适配器

用官方 `@anthropic-ai/sdk`，走 `messages.stream()` 拿 SSE 事件流。关键细节是 tool_use 参数的流式缓冲——模型不会一次性返回完整 JSON，而是通过 `input_json_delta` 事件逐块发送。适配器维护一个 `Map<index, { id, name, jsonBuffer }>` 按 content block index 缓冲，`content_block_stop` 时解析完整 JSON 并 yield `tool_use` 事件。

支持自定义 `baseURL`（通过 `ANTHROPIC_BASE_URL` 环境变量或配置文件），兼容第三方 Anthropic 兼容 API。

### OpenAI 适配器

格式差异不小。OpenAI 的 system prompt 是 messages 数组的第一条 `{ role: 'system' }`，不是独立参数。工具调用结果用 `{ role: 'tool' }` 消息，不是嵌在 user 消息的 content block 里。适配器在 `stream()` 入口做一次完整的格式转换，把内部 Message 数组翻译成 OpenAI 格式。

tool_call 参数的缓冲逻辑类似但更简单——OpenAI 的 delta 里直接有 `tool_calls[].function.arguments` 增量字符串，在 `finish_reason` 触发时统一 flush。

### 自定义端点（Ollama / LM Studio）

复用 OpenAI 适配器，只改 `baseURL`。部分本地模型暴露 OpenAI 兼容接口，事件格式相同。配置方式：

```bash
xiaok config set model custom --base-url http://localhost:11434/v1
```

**为什么用官方 SDK 而不自己实现 SSE 解析**：SSE 解析看起来简单，但 edge case 不少（重试、超时、部分写入），官方 SDK 替你踩过的坑比自己写的代码多。维护成本是选择依赖的核心考量。

## Agent Loop：有上限的 while 循环

Agent Loop 是整个系统的心脏。代码在 `src/ai/agent.ts`，核心是一个最多 12 轮迭代的 for 循环（原文用 25 轮，xiaok 用 12 轮——云之家开发场景的工具调用链普遍更短，12 轮足够覆盖"读文件 → 分析 → 修改 → 验证"的典型流程）。

每轮迭代的流程：

1. **检查是否需要 compact** — 估算 messages 数组的 token 数（字符数 / 4），超过上下文限制的 85% 触发压缩
2. **发起流式请求** — 调用 adapter.stream()
3. **实时处理事件流** — text 事件直接透传给 UI 回调，tool_use 事件缓冲到 assistantBlocks
4. **检查是否有工具调用** — 没有则结束（模型认为任务完成），有则执行工具
5. **执行工具并收集结果** — 通过 ToolRegistry 分发，结果作为 tool_result 追加到 messages
6. **进入下一轮迭代**

```typescript
for (let iteration = 0; iteration < maxIterations; iteration += 1) {
  // compact check
  if (shouldCompact(estimateTokens(this.messages), contextLimit, compactThreshold)) {
    this.messages = compactMessages(this.messages, compactPlaceholder);
  }

  // stream + collect blocks
  for await (const chunk of this.adapter.stream(...)) { ... }

  // no tool calls → done
  const toolCalls = assistantBlocks.filter(b => b.type === 'tool_use');
  if (toolCalls.length === 0) return;

  // execute tools → append results → next iteration
  for (const tc of toolCalls) {
    const result = await this.registry.executeTool(tc.name, tc.input);
    toolResults.push({ type: 'tool_result', tool_use_id: tc.id, content: result });
  }
  this.messages.push({ role: 'user', content: toolResults });
}
```

### Context Compact

当 messages 数组膨胀到接近上下文限制时，`compactMessages` 做一件简单的事：保留最近 2 条消息，前面的全部替换为一条 `[context compacted]` 占位消息。

```typescript
function compactMessages(messages: Message[], placeholder: string, keepRecent = 2): Message[] {
  if (messages.length <= keepRecent) return messages;
  return [
    { role: 'assistant', content: [{ type: 'text', text: placeholder }] },
    ...messages.slice(-keepRecent),
  ];
}
```

这比"发起独立 API 调用生成摘要"的方案更简单粗暴。xiaok 的判断是：在短链路的企业开发场景下，精确摘要的收益不值得额外的 API 调用成本。直接截断，让模型基于最近上下文继续工作，实践中效果足够好。

### AbortSignal 支持

Agent Loop 在每个关键点检查 abort signal，支持外部中断：

```typescript
private throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error('agent aborted');
}
```

这为未来的超时控制和用户取消留出了接口。

## 工具系统：7 个内置工具 + 动态扩展

工具系统由 `ToolRegistry` 统一管理。每个工具实现 `Tool` 接口：

```typescript
interface Tool {
  definition: ToolDefinition;  // JSON Schema，模型通过这个知道怎么调用
  permission: PermissionClass; // 'safe' | 'write' | 'bash'
  execute(input: Record<string, unknown>): Promise<string>;
}
```

### 7 个内置工具

| 工具 | 权限 | 说明 |
|------|------|------|
| `read` | safe | 读文件，支持 offset/limit 分页，加行号前缀 |
| `write` | write | 写文件，自动 mkdir -p |
| `edit` | write | 精确字符串替换，old_string 必须唯一出现 |
| `bash` | bash | 执行 shell 命令，30s 超时，跨平台（sh/cmd） |
| `grep` | safe | 正则搜索文件内容 |
| `glob` | safe | 按模式匹配文件路径 |
| `skill` | safe | 按名称加载 Skill |

加上 `tool_search`（查询 deferred 工具的 schema），共 8 个注册到 ToolRegistry 的工具。

### Edit 工具的设计哲学

Edit 的核心约束是 `old_string` 必须在文件中唯一出现，否则报错：

```typescript
const occurrences = content.split(old_string).length - 1;
if (occurrences === 0) return 'Error: old_string 在文件中不存在';
if (occurrences > 1) return `Error: old_string 在文件中出现了 ${occurrences} 次，必须唯一`;
```

这个设计迫使模型提供足够精确的定位字符串，避免错误修改。写入使用 tmp 文件 + rename 的原子操作模式，防止写入中断导致文件损坏。

### Bash 工具的安全边界

Bash 执行使用 `spawn` 而非 `exec`，30 秒超时，超时后先 SIGTERM 再 SIGKILL。跨平台处理 Windows（cmd /c）和 Unix（sh -c）。所有 Bash 调用都标记为 `bash` 权限级别，在默认模式下需要用户确认。

### Deferred Tools

低频工具不放入每次请求的 tools 数组，而是注册为 deferred。模型需要时通过 `tool_search` 工具按关键词查询：

```typescript
searchDeferredTools(query: string): ToolDefinition[] {
  // select:name1,name2 — 精确选择
  if (query.startsWith('select:')) { ... }
  // 否则按名称和描述模糊匹配
  return [...this.deferredTools.values()].filter(tool =>
    tool.name.includes(query) || tool.description.includes(query)
  );
}
```

这个机制将每次请求的 tools 数组体积降低，减少输入 token 开销。

### 工作区路径约束

Read、Write、Edit 工具都经过 `assertWorkspacePath` 校验，默认限制在 cwd 内操作，防止模型读写任意路径。通过 `allowOutsideCwd` 选项可放宽限制。

## 权限系统：三种模式，渐进信任

权限是 agentic CLI 的安全核心。设计不当要么让用户一直点确认直到放弃，要么给模型太多自主权造成不可逆损坏。

### 三种模式

| 模式 | 行为 | 适用场景 |
|------|------|----------|
| `default` | safe 工具自动执行，write/bash 需确认 | 日常交互 |
| `auto` | 绕过所有确认，deny rules 仍生效 | CI/CD、批量任务 |
| `plan` | safe 放行，write/bash 静默拒绝 | 先看方案再执行 |

```typescript
async check(toolName: string, input: Record<string, unknown>): Promise<PermissionDecision> {
  // deny rules 优先级最高，永远生效
  if (this.matches(this.denyRules, toolName, input)) return 'deny';
  // plan 模式下写操作被拒绝
  if (this.mode === 'plan' && ['write', 'edit', 'bash'].includes(toolName)) return 'deny';
  // auto 模式放行一切
  if (this.mode === 'auto') return 'allow';
  // safe 工具始终放行
  if (['read', 'glob', 'grep', 'skill', 'tool_search'].includes(toolName)) return 'allow';
  // 其余需要用户确认
  return 'prompt';
}
```

### 规则匹配

allow/deny rules 支持 glob 模式匹配，作用于工具的关键参数（command / file_path / path）：

```
bash:npm *     → 允许所有 npm 命令
write:/tmp/*   → 允许写 /tmp 下的文件
```

### 运行时提权

用户在交互中输入 `y!` 可以将当前会话切换为 auto 模式，避免后续每次确认：

```typescript
enableAutoMode(): void {
  this.permissionManager.setMode('auto');
}
```

**为什么不用两阶段分类器**：xiaok 的工具集只有 7 个，权限矩阵用规则就能覆盖，不需要额外的模型调用做判断。如果未来工具数量增长到 20+，会考虑加入 LLM 辅助判断。

## System Prompt：静态身份 + 动态上下文

System Prompt 的构建逻辑在 `src/ai/context/yzj-context.ts`。这是 xiaok 与通用 AI CLI 最大的差异点——内置了云之家的领域知识。

### 分段架构

```
[1] 角色定义（静态）
    "你是 xiaok，面向金蝶与云之家开发者的 AI 编程助手。
     你擅长金蝶苍穹、云之家开放平台 API 集成、轻应用开发、Webhook 配置等场景。"

[2] 会话上下文（动态）
    当前工作目录、登录企业 ID、开发者应用 appKey

[3] Skills 列表（动态）
    可用的内置和扩展 skills

[4] 自定义 Agents 列表（动态）
    用户定义的 agent 名称、模型、工具子集

[5] 云之家 API 概览（静态，内置文档）
    认证方式、消息 API、组织架构 API、Webhook 事件、工作流 API

[6] yzj CLI 帮助（动态，运行时探测）
    如果用户安装了 yzj CLI，加载其 --help 输出
```

### Token 预算管理

System Prompt 有 token 预算限制（默认 4000 tokens），超出时按优先级裁剪：

```typescript
// API 概览优先，yzj CLI 帮助次之
const reserveForYzj = yzjHelp ? 100 : 0;
const maxApiTokens = Math.max(0, remaining - reserveForYzj);
apiSection = truncateToTokens(apiOverview, maxApiTokens);
```

这个设计确保核心的 API 文档不会因为动态内容膨胀而被挤掉。

**Prompt Caching 待优化**：目前 system prompt 作为单字符串传入，没有做分段缓存。当对话轮数增多后，缓存命中率会显著影响成本。后续计划将 system prompt 拆分为 block 数组，静态段打上 `cache_control`。

## Skill 系统：参数化的 Prompt 模板

Skills 是比工具更高层的抽象——本质是参数化的 prompt 模板，通过 `/commit`、`/review` 这样的斜杠命令触发。

### 加载优先级

```
内置 skills（data/skills/*.md）
  ↓ 被覆盖
全局 skills（~/.xiaok/skills/*.md）
  ↓ 被覆盖
项目 skills（.xiaok/skills/*.md）
```

项目级可以覆盖全局，全局可以覆盖内置。

### Skill 文件格式

每个 Skill 是一个带 YAML frontmatter 的 Markdown 文件：

```markdown
---
name: commit
description: 分析变更并生成规范化 commit message
---

分析当前 git diff，生成符合 Conventional Commits 规范的提交消息...
```

frontmatter 解析不依赖 yaml 库，用简单的 `key: value` 行解析。content 是 frontmatter 之后的全部内容，作为 prompt 注入当前对话。

### 执行流程

用户输入 `/commit` 时：

1. `parseSlashCommand` 解析出 `{ skillName: 'commit', rest: '' }`
2. 查找对应 Skill
3. `formatSkillPayload` 将 Skill 元信息和内容序列化为 JSON
4. 包装为用户消息提交给 Agent Loop

```typescript
const userMsg = slash.rest
  ? `执行 skill "${skill.name}"，用户补充说明：${slash.rest}\n\n${skillPayload}`
  : `执行 skill：\n\n${skillPayload}`;
await agent.runTurn(userMsg, onChunk);
```

### 热重载

每轮交互前自动重新加载 Skills：

```typescript
const refreshSkills = async () => {
  skills = await skillCatalog.reload();
  inputReader.setSkills(skills);      // 更新输入补全列表
  agent.setSystemPrompt(await buildPrompt(skills));  // 更新系统提示
};
```

用户编辑了 `.xiaok/skills/` 下的文件后，下一轮对话立即生效，无需重启。

## 自定义 Agent 定义

用户可以在 `~/.xiaok/agents/` 或 `.xiaok/agents/` 下放置 Markdown 文件定义自定义 Agent：

```markdown
---
model: claude-sonnet-4-6
tools: read,grep,glob
max_iterations: 8
---

你是一个专注于代码审查的 agent，只使用只读工具...
```

加载器解析 frontmatter 提取 `model`、`tools`、`max_iterations` 元信息，正文作为 system prompt。这些 Agent 定义被注入主 Agent 的系统提示，使其知道可以委派哪些子任务。

## 终端 UI：流式 Markdown 渲染

### MarkdownRenderer

行缓冲的流式 Markdown 渲染器，接收 text delta 事件，逐行渲染 ANSI 格式化输出：

- 代码块：检测 ``` 围栏，跟踪语言标识，调用 `highlightLine` 做语法高亮
- 标题：`# → bold`
- 列表：`- → •`，有序列表保留数字
- 行内格式：`` `code` → cyan ``，`**bold**`，`*italic → dim*`
- 引用块：`> → │` 前缀

关键设计是 pending 行的处理——流式输出时，当前行可能还不完整，直接写到 stdout；下一个 newline 到来时，先 `\r\x1b[2K` 清除当前行再重新渲染完整行。这样用户看到的始终是格式正确的输出，不会出现格式闪烁。

### 输入交互

`InputReader` 是完整的 raw mode 输入处理器：

- **光标移动**：左右箭头、Home/End
- **历史记录**：上下箭头翻阅历史输入
- **斜杠命令补全**：输入 `/` 自动弹出命令菜单，支持 Tab 补全、上下键选择、Esc 关闭
- **菜单渲染**：在输入行下方渲染命令列表，选中项高亮

### 状态栏

固定在终端底部，显示模型名称、运行模式、token 消耗、session ID。通过 ANSI 滚动区域控制实现——`\x1b[1;${rows-3}r` 设置滚动区域，状态栏在滚动区域外，不会被内容推动。

### 欢迎界面

双列布局的 box drawing 界面，左侧 ASCII logo + 版本信息，右侧快速指南。使用 `displayWidth` 函数正确处理中文字符的显示宽度（中文占 2 列）。

## MCP 支持（预留）

`src/ai/mcp/client.ts` 实现了 MCP 工具命名空间的基础设施：

```typescript
function prefixMcpToolName(server: string, tool: string): string {
  return `mcp__${server}__${tool}`;
}
```

将 MCP 服务器的工具 schema 标准化为内部 `ToolDefinition` 格式。完整的 MCP JSON-RPC 通信层是下一步的计划。

## 事件系统与 Runtime Hooks

`createRuntimeHooks()` 返回一个类型安全的事件发射器，支持按类型订阅和全量订阅：

```typescript
type RuntimeEvent =
  | { type: 'turn_started'; sessionId: string; turnId: string }
  | { type: 'turn_completed'; sessionId: string; turnId: string }
  | { type: 'tool_started'; sessionId: string; turnId: string; toolName: string }
  | { type: 'tool_finished'; sessionId: string; turnId: string; toolName: string; ok: boolean };
```

Agent Loop 在关键节点发射事件（turn 开始/结束、工具执行前后），外部代码可以订阅这些事件实现日志、监控、自定义行为。

这个设计为插件系统留出了扩展点——future hooks 可以在工具执行前后注入自定义逻辑（审计、限流、告警），而不需要修改 Agent Loop 的代码。

## 认证：OAuth + 开发者应用

xiaok 支持两种身份：

1. **用户身份** — 通过云之家 OAuth 2.0 登录，credentials 存储在 `~/.xiaok/credentials.json`
2. **开发者应用身份** — 配置 appKey/appSecret，用于调用云之家开放平台 API

两者独立管理，可以同时存在。Agent 的系统提示会根据当前身份状态动态调整——有企业 ID 时模型知道该用哪个企业的 API 端点，有 appKey 时知道可以直接调用应用级接口。

## 核心结论

做了 xiaok 之后，最深的体会是：**核心难点在于 Harness Engineering**。

调用 API 是十行代码的事。但把工具调用结果正确地反馈给模型、在流式输出中间插入用户交互、处理权限检查的异步中断、在上下文快满时做正确的压缩决策——这些才是真正的工程量。

xiaok 在这个基础上加了一层：**领域知识的工程化注入**。不是简单地在 system prompt 里贴一段文档，而是设计预算管理、优先级裁剪、动态探测（yzj CLI 是否安装）、分层覆盖（内置 → 全局 → 项目）。让模型在每一轮对话中都恰好拥有它需要的上下文，不多不少。

这就是垂直场景 AI CLI 的价值所在。
