# GLM/Kimi 模型错误原因与恢复提示

## 证据与范围

用户只看到“模型连接中断，2 秒后自动续接”，无法判断额度、限流或 xiaok 异常。当前 ModelRecoveryNotice 只有 attempt/delayMs/remainingMs，AgentRuntime 原样转发，chat.ts 写死连接中断文案。共享恢复器把所有 429 视作可恢复；Kimi 安全 wrapper 仅认识 insufficient_quota 等有限 code，GLM 1308 等业务码缺席。GLM 的 SDK 内部还会自行重试 429。

官方来源（本次已通过 ego-browser 阅读）：
- https://docs.bigmodel.cn/cn/api/api-code ：1113 欠费；1302 速率；1305 模型繁忙；1308/1310/1316–1321 额度；1309/1314 套餐失效；1311 权限；1313 风控；1315 Key 产品范围；1261 上下文；1301 安全过滤。部分 SSE 错误通过 finish_reason 返回。
- https://www.kimi.com/code/docs/en/kimi-code/error-reference.html ：同为 429 的 5 小时/周/月额度、余额、企业限额不能当网络故障重试；concurrent request limit 是风控限制，与普通 too many requests/engine overloaded 区分。

## 设计

1. 新增共享、仅数据的 ModelFailureDiagnostic：来源（provider/connection/xiaok/unknown）、固定 provider 枚举、固定原因类别、合法 HTTP 状态、白名单业务/传输/内部码、最多 24 小时的 Retry-After、严格校验的供应商额度重置日期。仅在内存读取有限长度错误文本用于匹配官方原因；不保留 raw message/body/headers/cause/key/思考。输出使用固定中文原因与代码，不把无依据的 429 猜成额度耗尽。
2. 分类遍历有界 cause 链，去重；取消、永久业务码/鉴权/明确 retryable=false 优先于外层 network/503/429。GLM 业务码只在明确 GLM 绑定下解释；generic provider 不套用 GLM 规则。未知 code 不直接回显。Kimi 原安全错误类型/code 保持，追加共享诊断；GLM/Kimi 非 strict 的 SDK API 错误在实际 API 入口转成安全结构。
3. 第一方 GLM/Kimi 的 SDK maxRetries=0，让业务码分类先于重试。保留既有 adapter 有界瞬断恢复和 Kimi 一次 reasoning admission 恢复；永久错误立即穿透。存在 Retry-After 的错误直接交给共享恢复 owner，避免 adapter 先按 1 秒重试供应商要求等待的请求。其它 provider SDK 行为不变。
4. recoverModelStream 保持原物理读/return/取消 owner，只增加安全失败 DTO 到 notice。自动重试等待不短于 Retry-After；若等待时间超过剩余恢复窗口，立即停止并显示最后一次原因。恢复窗口耗尽也保留最近失败原因。额度、余额、套餐失效、权限/鉴权、风控、无效请求、协议错误不自动重试，不重放已完成工具。
5. 模型读取中的未知本地异常通过 WeakMap 关联安全诊断，保持原 Error 身份/原异常语义；其它工具异常不改分类。最终 normalizeRuntimeError 输出明确来源与原因，Kimi 协议错误保留原固定诊断码及解释。HTTP 错误是供应商返回、网络失败无 HTTP 状态、本地内部错误无供应商错误码，分别表述。
6. ModelRecoveryNotice/AgentRuntimeEvent 增加可选 failure DTO。CLI 用纯 formatter 显示供应商、原因、HTTP/业务码、等待时间、尝试次数与窗口；日志只写再次校验的 DTO。print/json 不新增 stdout 文案。共享事件的其它消费者保持兼容，不新增 IPC/持久化格式或恢复 owner。
7. GLM sensitive/network_error 及标准 content_filter 等错误终止帧不能当普通 done；返回结构化原因，不执行未提交的工具。正常 length 保持原有截断/专用 memory 语义，不误报套餐额度。

示例：`GLM 套餐额度已用尽（HTTP 429，业务码 1308，供应商重置时间 …），已停止自动重试。`；`Kimi 请求频率受限（HTTP 429），60 秒后自动续接 …`；`xiaok 模型调用内部错误（TypeError，未收到供应商错误码）。`

## 实施前对抗检查与验收

- 同一个 429 下 quota vs rate、GLM 1308 vs 1302、Kimi concurrent-risk vs ordinary concurrency、余额/套餐/权限均覆盖，未知 429 保持 rate-limit 且不伪造 quota。
- HTTP 与真实 SDK/SSE 都覆盖；SDK 内层、adapter、共享恢复及最终分类贯穿同一永久语义，cause 的永久错误不能被外层 transient 覆盖。
- Retry-After 秒数/HTTP-date/无效/超大边界，取消等待与恢复窗口不足；原物理 owner 读/return/异步 notice 回归保留。
- Canary 覆盖 key、raw body、headers、私有思考、任意 message/code 与调用者 getter；错误及 cause 不进入 notice/UI/日志。固定模板、状态/业务码和经过验证的时间提供可行动原因。
- 测试先 RED，再修改 production；调用真实 classifier/adapter/recoverModelStream/CLI 入口，不在测试重实现分类。CLI 真实 PTY验证额度立即终止、短期限流显示真实原因与等待并恢复，已完成工具只执行一次。
- 用不同于 Codex 的模型独立审查设计与最终代码；失败或超时不记通过。提交独立分支/PR，写完整 HEAD 与实际测试证据，不自行合并或发版。

## 对抗评审补充（实施前）

DeepSeek-V4-Flash 首轮提出 4 项 BLOCK，逐项收敛如下（Kimi 周额度 429 和 GLM 1310 阻止其评审调用，不计作通过）：

- 工具恢复点沿用现有 AgentRuntime：完成的工具结果在下一 iteration 前 appendUserToolResults；recoverModelStream 仅重开当前 iteration 的模型读取，重试时清空 currentAssistantBlocks，丢弃未提交工具，session 中已提交结果继续携带。不新增执行或重放路径。既有 agent-model-recovery 与 real-SDK SSE completed-effect 回归保留，新 429/Retry-After 用例同样覆盖该路径。
- SDK 入口只有 OpenAIAdapter constructor 创建 client，两个 withOptions 派生路径继承 maxRetries（semantic 路径显式 0）；新增真实 SDK 测试核对 constructor、普通/严格 Kimi、GLM、disclosure 派生请求只产生一次 quota HTTP/SSE 请求。SDK 分类边界为 create 与 next 两处。
- API 边界只抛无 cause/body/headers 的安全 wrapper。WeakMap 只用于本地模型读取异常与已有固定协议错误，保留 Error 身份；recoverModelStream 不记录 raw error。AgentRuntime run_failed 及 facade 使用 normalizeRuntimeError；CLI 仅接收 facade 的固定安全消息。测试运行真实 Runtime + logger，覆盖 Error message/cause/body/header 全部 canary。未知内部异常只显示固定错误类型及来源，不显示任意 message。
- 优先级明确：用户取消 > 永久码/明确 retryable=false/永久状态 > Retry-After > 退避。永久错误即使有 Retry-After 也零次重试；延迟元数据不能使错误变为可恢复。

第二轮评审继续提出 SDK 的可验证性与超大等待值：以真实 OpenAI SDK 构造+真实 JSON/SSE Response 的请求计数证明 maxRetries=0 生效，不用 mock SDK；额度同时携带 Retry-After 仍为永久。合法 Retry-After 超过 24h 不截短也不忽略，记录固定 retryAfterTooLong=true，adapter 直接交恢复 owner，owner 立即报告窗口不足并停止。Kimi wrapper 的 retryable 属性和关联 DTO 同时由共享分类覆盖，消除旧属性仍可重试的可能。

## 最终实现与验证

- 编码模型：Codex。独立评审：DeepSeek-V4-Flash（真实已配置接口，最终正文完整 `finish_reason=stop`）。先后提出并修复永久语义覆盖、超长 Retry-After、Kimi 模糊 quota type、诊断 sink getter 等缺口；整体代码审查及最后两项 P1 修复复核均 APPROVE。一次未产出正文/终止帧的评审未计为通过。Kimi/GLM 评审调用自身分别遇到周额度 429 和 GLM 1310，仅用于确认错误形状，不计为评审通过。
- 真实 Runtime 测试发现 run_failed 曾持有原始 Error，改为仅向事件发布安全新 Error，仍向 owner 抛原 Error；非 Error 模型拒绝在模型读边界转安全 Error，工具异常路径保持原语义。SDK 自己的 timeout Abort cause 与用户取消分开处理，保留既有 missing_finish 瞬断恢复。
- RED：原版真实 SDK 的 4 个 GLM/Kimi 用例失败（SDK maxRetries=3；额度被重试直至测试信号超时）；新分类模块缺席时新 suite 无法加载。未用 mock SDK 结果当真实接口证据。
- 最终本地 Node 22.14.0（macOS arm64，官方归档 SHA-256 已核对）编译后 12 个 focused suites **419/419** 通过：model-failure、model-failure-runtime、openai-provider-errors、model-stream-recovery、model-stream-integration、provider-request-error、openai、openai-provider-sse-error、agent-model-recovery、abort-error-discrimination、agent-runtime、runtime-facade。
- 额外 CLI 交互/工作流回归：`npm run test:sandbox:run -- .test-dist/tests/commands/chat-interactive-runtime.test.js .test-dist/tests/commands/chat-workflow-wiring.test.js`，72/72 通过（其中包含登录交接、Esc/取消、队列和 footer 的既有路径）；连同上述 419 和 Desktop 3，合计 494 个不同测试。
- `npm run test:sandbox:build`、`npm run build`、`npm run governance:check`、`npm run architecture:check -- --changed` 通过，未更新 baseline。
- `cd desktop && npm test -- --run tests/main/desktop-provider-stream-lifecycle.test.ts`：3/3 通过；此项是共享流生命周期回归，不是 Desktop 安装包/UI 验收。
- Node 22.14.0 运行 `python3 tests/e2e/provider-errors.py --cli-entry dist/index.js`：真实 tmux TTY 中 GLM/Kimi 额度各只有 1 次请求；普通限流各 2 次请求，实际等待 **3006/3006ms** 后恢复，显示供应商/HTTP/业务码与等待原因，所有输出/日志均无 canary。最后将 fixture 日期改为纯合成日期，相关 3 suites 62 项及这组 TTY 已重跑通过，生产代码未再变更。
- 同一 Node 22 运行 `python3 tests/e2e/kimi-error-recovery.py --cli-entry dist/index.js`：部分输出后恢复、已完成工具只执行 1 次、后续 HTTP401 不重试、无私有正文/凭证泄露。最终 TTY 共启动 3 个 CLI，记录的 3 个 pid 均确认退出（remaining=0）。
- 新测试与 Linux/macOS TTY 已接入 Model request recovery 的 Node 22.14.0/24、Linux/Windows/macOS 矩阵；Windows 跑单测，TTY 明确只跑 Linux/macOS。远端 CI 结果以 PR 为准，未合并或发版，未在用户 Ubuntu 安装此候选。
- 全仓 `hygiene:check` 仍受既有 sibling 工作影响：intent-broker master 有 tracked WIP、kai-xiaok-plugins main 有其它报告 HTML 未跟踪；本任务未改动它们。功能工作树已更新到当时 origin/master（50533d61）。

执行机制：`.github/workflows/model-recovery.yml` 必跑真实 SDK/HTTP/Runtime 分类与取消回归、诊断隐私回归及真实终端 quota/rate 用例；不得将 unknown 429/type 推断成 quota，也不得重新启用 GLM/Kimi SDK 内层自动 429 重试。
