# xiaok-cli 与 clio 的 Agent / Tools 架构对比

日期：2026-03-30

## 结论

`xiaok-cli` 当前已经具备可工作的 Phase 1 核心骨架，尤其是多模型适配层方向是对的；但在 `agent runtime`、工具治理、权限/安全、扩展机制这几层，和 `clio` 还有明显差距。

一句话总结：

- `xiaok-cli` 更像“能跑起来的最小 agent CLI”
- `clio` 更像“已经形成运行时平台的 agent CLI”

## 本次对比依据

主要阅读了以下实现：

- `src/ai/agent.ts`
- `src/ai/adapters/openai.ts`
- `src/ai/adapters/claude.ts`
- `src/ai/tools/index.ts`
- `src/ai/skills/*.ts`
- `src/commands/chat.ts`

对照 `clio` 的以下实现：

- `src/core/agent.ts`
- `src/tools/index.ts`
- `src/core/permissions.ts`
- `src/tools/subagent.ts`
- `src/tools/mcp.ts`
- `src/commands/custom-agents.ts`
- `src/plugins/index.ts`
- `src/core/system-prompt.ts`

## xiaok-cli 当前做得对的地方

### 1. 模型适配层边界清晰

`xiaok-cli` 通过 `ModelAdapter` 抽象掉 Claude/OpenAI 差异，这一点设计是健康的。

- `src/types.ts` 定义统一 `stream(messages, tools, systemPrompt)` 接口
- `src/ai/adapters/claude.ts` 处理 Claude 的 `tool_use`
- `src/ai/adapters/openai.ts` 处理 OpenAI 的 `tool_calls`

这比把协议差异直接写进 agent 主循环更容易演进。

### 2. 工具定义和执行层相对简单

`ToolRegistry`、`buildToolList()`、各工具文件的拆分方式易读，适合 Phase 1 快速推进。

### 3. skills 已经打通了最基本的调用路径

目前已经支持两种入口：

- `/skill-name` 斜杠命令
- `skill` 工具调用

这说明 `xiaok-cli` 后续往“能力扩展”方向走是有基础的。

## 与 clio 的主要差距

### 1. Agent 主循环还是最小实现，缺少 runtime 级保护

`src/ai/agent.ts` 当前是一个 `while (true)` 循环，只要本轮没有 tool call 就退出。

缺失项包括：

- 最大迭代数限制
- `AbortSignal` / 中断控制
- token usage 统计
- context window 估算
- 自动 compact
- 多类 content block 的统一表示

而 `clio` 的 `src/core/agent.ts` 已经有：

- `MAX_ITERATIONS`
- 上下文估算与自动 compact
- usage 统计
- thinking / text / tool_use / tool_result 的 block 级消息处理
- hooks、deferred tools、permission、checkpoint 的串联

这意味着 `xiaok-cli` 一旦遇到模型反复调用工具、上下文变长、或用户想中断，当前 runtime 会比较脆弱。

### 2. OpenAI 路径不是真流式

`src/ai/adapters/openai.ts` 现在先把流收集到 `rawChunks`，再回放生成文本和工具调用。

这会带来几个问题：

- 首字延迟偏高
- 内存占用随输出增长
- 不利于中途打断
- 行为和 Claude 路径不一致

`clio` 的流式处理是边收边处理，runtime 体验明显更成熟。

### 3. 消息模型过于扁平

`xiaok-cli` 的 `Message` 结构当前是：

- `user`
- `assistant`
- `tool_result`

其中 assistant 主要靠 `content: string` 加 `toolCalls?: ToolCall[]` 补充。

这在 Phase 1 足够，但后续接入以下能力时会很快受限：

- thinking blocks
- 多段文本和工具混合输出
- MCP tool result 的结构化内容
- sub-agent / collab agent 事件
- richer UI event stream

`clio` 已经是 block-based message model，这一层扩展能力更强。

### 4. Tool registry 还是静态数组，不是 runtime capability system

`xiaok-cli` 现在是固定工具列表：

- `read`
- `write`
- `edit`
- `bash`
- `grep`
- `glob`
- `skill`

但 `clio` 的工具系统已经形成 runtime 平台能力：

- deferred tools + `ToolSearch`
- MCP 工具自动发现
- sub-agent
- team messaging
- task management
- plan mode
- hooks
- plugin 注入 skills / agents / commands / mcp / lsp

差距不只是“工具数量”，而是“工具是否可发现、可分层、可增量扩展”。

### 5. 权限模型偏弱，安全边界还不够清晰

`xiaok-cli` 当前权限判断逻辑基本是：

- `safe` 不提示
- 非 `safe` 且非 `auto` 时提示确认

问题在于：

- `bash` 和 `write` 没有真正分级处理
- 没有 allow / deny rule
- 没有 path sandbox
- 没有 plan mode
- 没有基于命令 pattern 的自动分类
- 没有“工具级”和“路径级”联合判断

再看工具实现本身：

- `read.ts` / `write.ts` 对工作区没有限制
- `bash.ts` 是直接执行 shell 命令

相比之下，`clio` 已经有：

- `default / auto / plan` 模式
- allow / deny patterns
- bash safe/dangerous pattern 分类
- workspace path 限制
- MCP 工具权限匹配

### 6. skill 与 slash command 目前是“两条路径”

现在 `/skill-name` 由 `chat.ts` 直接把 skill 内容拼进用户消息；
而 `skill` 工具则是运行时返回 skill 原文。

这会带来几个问题：

- 相同能力有两种注入方式
- 行为不完全一致
- 后续难以统一审计和缓存
- 不利于把 skill 当作真正 capability 来治理

`clio` 的方向更统一：skill 是 registry 中的能力，由系统提示、工具、插件共同组织。

### 7. 缺少 sub-agent / custom agent / MCP / plugin 这一整层扩展机制

这是 `xiaok-cli` 和 `clio` 最大的结构性差距。

`clio` 已经具备：

- 自定义 agent 文件加载
- 内置 Explore / Plan agent
- background agent
- worktree isolation
- team 协作
- MCP server lifecycle
- 插件系统注入 skills / agents / commands / mcp / lsp

而 `xiaok-cli` 目前还是“单 agent + 单进程 + 固定工具集”。

## 建议的修改方向

## P0：优先补 runtime 与安全，不要先追功能表

这是最值得先做的一层。

### 建议 1：给 Agent 加硬边界

建议新增：

- `maxIterations`
- turn/agent 级 abort
- usage 统计
- context 估算
- 超阈值 compact

理由：

- 这些能力属于 runtime 基础设施
- 不补这一层，越往后加工具，问题越多

### 建议 2：把 OpenAI 路径改成真流式

目标：

- 不再先缓存 `rawChunks`
- 边接收 delta 边输出 text
- 在 finish_reason 或流结束时统一 flush tool call buffers

这会直接改善交互体验，也会让 Claude / OpenAI 两条路径更一致。

### 建议 3：把消息结构升级为 block-based

建议引入统一的内容块类型，例如：

- `text`
- `tool_use`
- `tool_result`
- `thinking`

先不要追求一步到位，但建议把后续扩展能力留出来。

## P1：把 tools 从静态表升级成可扩展 registry

### 建议 4：引入 `registerTool()` 与 discoverable tools 概念

第一步不必直接照搬 `clio` 的 `ToolSearch`，但至少要做到：

- 工具注册不只依赖静态数组
- tool metadata 可被枚举
- runtime 能区分 model-visible tools 与 internal tools

### 建议 5：先做 deferred tools，再做 MCP

推荐顺序：

1. 静态工具注册
2. deferred tools / schema search
3. MCP server lifecycle

原因：

- 先解决“工具太多时 prompt 怎么控体积”
- 再引入外部工具生态

## P1：重做权限模型

### 建议 6：引入独立 `PermissionManager`

建议支持：

- `default`
- `auto`
- `plan`

并且加入：

- allow rules
- deny rules
- bash command pattern 分类
- file path 限制

### 建议 7：把工作区 sandbox 变成显式能力

当前工具实现默认可操作任意路径，风险太高。

建议至少支持：

- 限制在 cwd 内
- 显式 allow outside cwd 开关
- 写操作与读操作分开校验

## P2：统一 skills / agents / plugins 体系

### 建议 8：统一 skill 的注入方式

建议收敛成一种主路径：

- slash command 只是显式触发方式
- 最终仍走 skill runtime 注入

这样后续才容易：

- 记录调用链
- 做缓存
- 做 plugin skill 注入
- 做 skill 权限/可见性控制

### 建议 9：补 custom agents 与 sub-agent

推荐最小版本：

- 自定义 agent markdown 文件
- allowed tools / model / max_iterations frontmatter
- 内置 `Explore` / `Plan`

先不做 team，也先不做 worktree。

### 建议 10：最后再做 plugin system

plugin 是放大器，不是地基。

推荐在以下都稳定后再做：

- tool registry
- permission manager
- custom agents
- skill runtime

## 推荐实施顺序

### 第一阶段：先稳 runtime

1. `Agent` 增加 `maxIterations`、abort、usage
2. `OpenAIAdapter` 改为真流式
3. 消息结构升级为 block-based

### 第二阶段：再稳工具治理

1. 引入 `PermissionManager`
2. 加 workspace/path sandbox
3. registry 改成可注册、可枚举
4. 预留 deferred tools

### 第三阶段：再做扩展能力

1. 统一 skill runtime
2. custom agents
3. sub-agent
4. MCP
5. plugin

## 不建议直接照搬 clio 的部分

`clio` 的能力很全，但 `src/tools/index.ts` 已经偏“大一统调度器”。

`xiaok-cli` 更适合借鉴其能力边界，而不是照搬其文件组织方式。建议保持以下分层：

- `adapter`
- `agent runtime`
- `tool registry`
- `permission manager`
- `extensions (skill / agent / mcp / plugin)`

## 当前最重要的改动建议

如果只做三件事，建议优先做：

1. OpenAI 真流式 + Agent 最大迭代/中断
2. 独立 PermissionManager + workspace sandbox
3. block-based message model + extensible tool registry

这三件做好之后，后续再加 MCP、sub-agent、plugin，成本会低很多。
