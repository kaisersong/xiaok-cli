## 审查范围与材料充分性

本附件实际包含八个变更生产文件的全文/diff：`desktop/electron/context-manager.ts`、`src/ai/adapters/claude.ts`、`src/ai/adapters/openai.ts`、`src/ai/adapters/openai-responses.ts`、`src/ai/runtime/compact-runner.ts`、`src/ai/runtime/compaction-response.ts`（新增）、`src/ai/runtime/model-capabilities.ts`、`src/runtime/sol-pi/semantic-compaction-owner.ts`；另附 semantic 结算/CAS/physical drain/ledger/deletion census/store 全链关键文件全文（`semantic-summary-attempt.ts`、`semantic-compaction-ledger.ts`、`compound-deletion-census.ts`、`store.ts`、`file-store.ts`、`sqlite-store.ts`、`execution-authority.ts`、`single-request-https.ts`、`portable-compaction-executor.ts`、`session.ts`、`semantic-snapshot.ts`、`provider-conversation-authorization.ts`）、AgentRuntime L240–355 真实调用片段及测试 diff 与 17 场景全文。材料对声明范围（摘要入口完成性 + semantic complete-empty 结算修订）充分。局限：`usage.js`（planCompaction/applyCompactionPlan）、`session-graph.ts`、`agent-runtime.ts` 其余部分、`abort-utils.ts`、`semantic-policy.ts` 等未附全文，凡涉及其内部行为之处我按调用方契约推断，不宣称完整审查。

## 核心链分析

**typed empty 的必要条件（compaction-response.ts:20-42）**：`empty` 只在以下全部成立后抛出：流完整 drain（循环正常退出）、无 `failure`（无 tool_use、无 terminal 后内容）、`terminal` 已见 `done`、循环内每个非 usage chunk 前后均 `throwIfAborted`（25/37 行）、且 trim 后为空。因此 `CompactionResponseError(reason==='empty')` 必然蕴含"完整 drain + 合法终态 + 无 tool/refusal/malformed + 未取消"。任何 tool、截断、缺终态、late 内容、取消都落入其他 reason 或原样重抛。该判定与规约一致。

**semantic owner 结算（semantic-compaction-owner.ts:148-159）**：catch 中仅 `error instanceof CompactionResponseError && reason==='empty'` 才 `settle('settled')`；取消路径由 `!input.signal.aborted` 守卫跳过 settle（reservation 停留 dispatched，census 在 compound-deletion-census.ts:25 会以 `session_delete_semantic_unsettled` 拒绝删除，保守正确）；其余失败 settle('unknown')，ledger 转移表（ledger.ts:30-34）dispatched→settled/unknown 均合法且单向。settled 后仍抛错 → executePortableCompaction（portable-compaction-executor.ts:119-131）走 summaryModelFailed 分支，semantic trigger 下**不会**调 applyPlan（applySemanticPlan 未被调用），即不安装、不 commit、不退款（reservation 已 dispatched 计费，merge 语义 ledger.ts:72-76 保证不复活预算）。持久化失败：settle 内 `finishSemanticSummaryAttempt` 抛错 → persistenceFailed 记录，owner.ts:175 在 finally 之前 rethrow persistenceError，传播链闭合。CAS 陈旧：`commitSemanticSummarySnapshot`（semantic-summary-attempt.ts:128-141）用 sourceHistoryDigest + storeRevision CAS，`installCommittedSnapshot`（session.ts:252-260）再校验 revision/digest，未见陈旧覆盖窗口。

**单次物理发送**：`resolveSemanticSummaryAttempt` resolved 一次性置位（attempt.ts:90-91），guarded fetch `claimed` 同步置位拒绝二次调用（96-97），底层 `createSingleRequestHttpsFetch` 另有独立 `claimed`（single-request-https.ts:31-33）。双层防重发，且 `requireCompleteResponse` 不会进入请求体（model-capabilities.ts:37-38 声明为内部契约，测试亦断言 body 无该字段）。

**适配器层**：Claude（claude.ts:248-322）在 requireCompleteResponse 下延迟 done、校验 terminal/stopReason∈{end_turn,stop_sequence}/无残留 toolBuffers，message_stop 后仅容忍 message_delta；旧 memory_output_incomplete 语义对非 compaction 路径保留（313 行）。OpenAI（openai.ts:1026-1182）finish_reason 后继续 drain usage，二次 finish 或非空 delta 置 incompleteSummary，EOF 无 finish_reason 抛 provider_incomplete（不再走旧 ERR_STREAM_PREMATURE_CLOSE 分支路径下的误装）；`length` 截断在 compaction 模式改为 provider_incomplete 而非 memory_output_incomplete——对 semantic 而言两者均落 unknown，语义等价。Responses（openai-responses.ts:174-190）对 malformed JSON、非 completed、refusal、function_call、非字符串 text 全部拒绝且先 yield usage 再抛，late usage 被消费。

**Desktop fallback**（context-manager.ts:129-144）：仅"零 chunk 且非 CompactionResponseError 且非 abort"才 historySnip；`receivedChunk` 经 onProgress 对包括 usage 在内的任何 chunk 置位。这意味着"仅收到 usage 后网络错误"会从旧的 snip 路径转为 rethrow。旧代码任何错误都 snip，严格说这是行为收窄，但与 CLI 侧"已产出 chunk 不得重试/得 fallback"的既有原则一致（防止半安装摘要），且规约只要求"未收到 chunk 的旧网络 fallback 保持"——usage chunk 算已收到可辩护。列为观察项而非必改。

**取消优先级**：collectCompactionResponse catch 内 `throwIfAborted`（34 行）保证 abort 原因胜过迭代器原发错误；Desktop 端 isAbortError 优先 rethrow 不 snip。测试中 "preserves cancellation before the first chunk" 与 "does not commit text after cancellation won at terminal" 覆盖了这两个时点。

## 可执行反例搜寻结果

我尝试构造以下反例均未成功：
1. "drain 中途取消但被误判为 empty→settled"：25/34/37 行三重 throwIfAborted 阻断，且 owner 侧 `!input.signal.aborted` 再守卫一次。
2. "thinking-only 完整响应被误判"：thinking chunk 非空、有 done、无 tool → 归入 typed empty。若模型只回 reasoning 无正文，semantic 会 settled+failed 且不安装——与规约"完成传输事实≠已安装"一致，不构成绕过。
3. "Claude message_stop 后 message_delta 携带新 stop_reason 逃逸"：claude.ts:298-301 terminal 时置 incompleteSummary，被拒。
4. "openai usage-only 尾块被误判 content_after_terminal"：collect 侧 usage 直接 continue（27 行）；适配器侧空 choices 数组 `some` 为 false（openai.ts:1027-1028）。
5. "settled 后再 commit 空摘要"：empty 抛错使 applySemanticPlan 不可达；commitSemanticCompaction 虽允许 settled reservation 配 commit，但无 commit 写入方。
6. "double settle"：finishSemanticSummaryAttempt `ALREADY_FINISHED` 拒绝；catch 与成功路径互斥（catch 必 rethrow）。

## 结论

**APPROVE**。无必改项。次要观察（不阻塞）：Desktop 端 `receivedChunk` 把仅 usage 的错误流从 snip fallback 改为 rethrow，属行为收窄而非回归引入的绕过；openai.ts compaction 模式下 `length` 的错误类型从 `memory_output_incomplete` 变为 CompactionResponseError，对 AgentRuntime 普通阈值压缩路径经由 CompactRunner 同样生效——原 CLI 确定性 fallback（agent-runtime 对 portable_summary_failed 仅发 compact_failed 事件，历史不动）仍保留，与"原普通CLI确定性fallback保持"的规约相符。测试通过不作为本结论依据，结论基于上述静态链分析。
