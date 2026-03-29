# 本地 codex 项目的 Agent / Tools 架构分析

日期：2026-03-30

## 结论

本地 `codex` 项目和 `clio`、`xiaok-cli` 不是一个量级。

如果说：

- `xiaok-cli` 是 Phase 1 agent CLI
- `clio` 是较成熟的 agent runtime

那么 `codex` 更接近“协议化、平台化的本地智能执行引擎”。

它的重点已经不是单纯的“模型调用 + 本地工具”，而是：

- 线程/会话/任务/回合的协议建模
- 审批与 sandbox 的制度化
- tool routing 与多种 tool payload 的统一分发
- 多 agent 控制面
- MCP server / client 双向能力
- 可被 TUI、CLI、debug-client、MCP client 复用的统一后端

## 本次分析依据

主要阅读了以下内容：

- `codex-rs/docs/protocol_v1.md`
- `codex-rs/docs/codex_mcp_interface.md`
- `codex-rs/core/src/tools/router.rs`
- `codex-rs/code-mode/src/description.rs`
- `codex-rs/code-mode/src/runtime/mod.rs`
- `codex-rs/core/src/agent/control.rs`
- `codex-rs/plugin/src/load_outcome.rs`
- `codex-rs/app-server-protocol/schema/json/CommandExecutionRequestApprovalParams.json`

## codex 的核心特点

### 1. 先有协议，再有 UI

`codex-rs/docs/protocol_v1.md` 明确把系统拆成：

- Model
- Codex
- Session
- Task
- Turn
- SQ / EQ

这和 `clio`、`xiaok-cli` 最大的区别是：

`codex` 不是“终端里跑的一个 agent”，而是“一个可以被不同前端驱动的 agent engine”。

它天然支持：

- CLI / TUI
- app server
- debug client
- MCP client

这让它的扩展性和可测试性都远高于单体 CLI。

### 2. Tool routing 是独立中间层，不和 agent loop 直接耦合

`codex-rs/core/src/tools/router.rs` 展示了一个更成熟的工具分发层：

- `ToolRouter` 基于配置构建 tool specs 与 registry
- 区分 model-visible specs 与完整 specs
- 统一处理：
  - function call
  - MCP tool call
  - custom tool call
  - local shell call
  - tool search call

相比之下：

- `xiaok-cli` 还停留在静态工具数组
- `clio` 虽然功能更丰富，但工具分发仍偏向“大文件 dispatcher”

`codex` 的优点是“工具输入形态统一进入路由层”，后续扩展空间更大。

### 3. code mode 把工具调用提升成可编程 runtime

`codex-rs/code-mode/src/description.rs` 和 `runtime/mod.rs` 非常关键。

这里不是简单地让模型调用某个工具，而是：

- 给模型一个隔离的 JS 运行时
- 通过 `exec` / `wait` 两个外层工具驱动
- 把所有嵌套工具暴露到全局 `tools` 对象上
- 支持 `store/load/notify/yield_control`
- 支持长时间运行 cell 的 `wait`

这和 `clio/xiaok-cli` 的差异在于：

- 后两者是“模型直接发起工具调用”
- `codex` 在部分模式下已经是“模型写一段程序，程序再调工具”

这对复杂多步任务、并行等待、状态保存特别有利。

### 4. 审批和 sandbox 是协议级对象，不只是 UI 提示

`CommandExecutionRequestApprovalParams.json` 说明 `codex` 的审批不是简单的 yes/no。

它支持的决策包括：

- `accept`
- `acceptForSession`
- `acceptWithExecpolicyAmendment`
- `applyNetworkPolicyAmendment`
- `decline`
- `cancel`

并且审批请求可携带：

- 附加文件系统权限
- 附加网络权限
- prefix rule
- 网络主机上下文

这比 `clio` 的 permission manager 更“制度化”，也远强于 `xiaok-cli` 当前的布尔式确认。

### 5. 多 agent 是控制面能力，不是附属功能

`codex-rs/core/src/agent/control.rs` 可以看出：

- agent 有独立 thread id
- 有 registry 和状态管理
- 有 spawn slot 限制
- 可以 fork 父线程历史
- 可以继承 shell snapshot 和 exec policy

这和 `clio` 的 sub-agent 相比，层次更高。

`clio` 更偏“在当前 CLI 里再拉一个子 agent 干活”；
`codex` 更偏“创建新的受控线程节点并纳入统一控制面”。

### 6. MCP 不只是接第三方工具，也能把 Codex 自己暴露为 MCP 服务

`codex-rs/docs/codex_mcp_interface.md` 说明：

- `codex` 支持管理外部 MCP server
- 同时也能以 MCP server 形式对外暴露自身能力

它对外暴露的是：

- `thread/*`
- `turn/*`
- `account/*`
- `config/*`
- `model/list`
- `collaborationMode/list`
- approvals
- live event stream

这已经不是单纯的“工具生态接入”，而是“让自身成为平台节点”。

### 7. plugin load outcome 关注的是能力聚合，而不是简单注入

`codex-rs/plugin/src/load_outcome.rs` 展示的重点是：

- plugin 激活态判断
- skills roots 聚合
- MCP servers 聚合
- apps 聚合
- capability summary 提供给 prompt/runtime

这比 `clio` 的插件系统更偏“平台级能力汇总”。

## 和 clio 的对比

## codex 比 clio 强的地方

### 1. 协议化更彻底

`clio` 主要仍是终端 CLI 的内聚实现；
`codex` 则是 engine-first，UI 是可替换层。

### 2. 审批/权限/sandbox 更系统

`clio` 已经有不错的 permission manager，但本质仍是 runtime 逻辑。
`codex` 则把审批决策、附加权限、网络策略修订都上升到了协议层。

### 3. 多 agent 管理更像控制面

`clio` 的 sub-agent 很实用，但仍以任务代理为主；
`codex` 的 agent control 已经接近线程树和协作系统。

### 4. code mode 更强

`clio` 目前没有与 `codex` 的 JS runtime 对等的一层。
`codex` 在复杂工具编排上明显更强。

## clio 比 codex 更轻巧的地方

### 1. 更容易读懂和改造

`clio` 的结构更像“高级 CLI 应用”，上手成本更低。

### 2. 更适合做单机版快速迭代

如果目标是快速补功能、快速验证交互，`clio` 的复杂度更合适。

### 3. 心智负担更小

`codex` 的协议、线程、审批、MCP、code mode、app server 都会拉高维护门槛。

## 对 xiaok-cli 的启发

`xiaok-cli` 不应该直接追 `codex` 的完整形态，但可以吸收它的几个关键思想。

### 建议借鉴 1：先建立稳定的事件/状态模型

在做更多工具和 agent 之前，先把以下概念明确化：

- Session
- Turn
- ToolCall
- ToolResult
- ApprovalRequest
- Interrupt

不一定马上做成跨进程协议，但内部模型应先稳定。

### 建议借鉴 2：把审批从 UI 行为提升为结构化对象

不要只保留 `onPrompt(name, input) => boolean`。

建议逐步演进为：

- 审批原因
- 当前 sandbox 上下文
- 附加权限申请
- session 级缓存
- prefix rule 持久化

### 建议借鉴 3：把 ToolRouter 独立出来

未来 `xiaok-cli` 一旦接入：

- MCP
- sub-agent
- custom tools
- skill runtime

就需要类似 `ToolRouter` 的分层，而不是继续让 `ToolRegistry.executeTool()` 承担全部调度责任。

### 建议借鉴 4：sub-agent 不只是“再开一个 agent”

如果后续要做多 agent，建议从一开始就想清楚：

- 是否有 agent id
- 是否有状态
- 是否能恢复/等待
- 是否能继承上下文
- 是否需要深度限制

`codex` 在这方面的设计比 `clio` 更值得借鉴。

### 建议借鉴 5：插件能力要以“能力清单”方式聚合

未来如果 `xiaok-cli` 做插件，不要只想“把文件读进来注册一下”。
更好的方式是像 `codex` 一样汇总：

- skills
- MCP servers
- app connectors
- capability summaries

这样 system prompt、工具可见性、用户提示都更容易统一。

## 不建议 xiaok-cli 现在就照搬 codex 的部分

### 1. 不建议马上做 code mode

`exec/wait + JS runtime + nested tools` 非常强，但复杂度太高。
对 `xiaok-cli` 当前阶段来说，明显超前。

### 2. 不建议马上做完整协议层

`codex` 的线程/任务/事件协议很强，但实现成本也很高。
`xiaok-cli` 先把进程内 runtime 设计好更现实。

### 3. 不建议马上做双向 MCP 平台化

先做 MCP client 接入外部工具就够了；
把 `xiaok-cli` 自身暴露为 MCP server 不是当前优先级。

## 建议给 xiaok-cli 的落地路线

### 第一层：借 clio

先补齐：

- runtime guardrail
- permission manager
- tool registry
- custom agent / sub-agent
- MCP client

### 第二层：局部借 codex

再逐步吸收：

- approval object 化
- tool router 分层
- agent control 元数据
- capability summary

### 第三层：暂缓 codex 级平台能力

暂时不做：

- code mode runtime
- 完整 app-server / protocol
- 双向 MCP 平台

## 总结

`codex` 的价值不在于“可抄很多功能”，而在于它证明了几件事：

- agent 系统最终会走向协议化
- tools 最终会走向路由化
- approvals/sandbox 最终要结构化
- 多 agent 最终要有控制面

对 `xiaok-cli` 来说，最现实的策略不是“直接追 codex”，而是：

1. 先按 `clio` 补齐一层成熟 CLI runtime
2. 再按 `codex` 的思路提升内部抽象边界

这样实现路径最稳，也最符合当前项目阶段。
