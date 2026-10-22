最新裁决见末节：第三轮 **APPROVE**。以下保留首轮及第二轮 BLOCK 的原始轨迹。

独立代码席 A，首轮：**BLOCK**

基线 HEAD：`dc221f9bac84d939b8fb543d4795396693fdc9b8`。设计冻结 SHA：`3d883cdd658bfbfdadac4bea28dc4e0d80e253ae121d8a38ff7f9fc74f3a33f8`。本票针对当前未提交实现，不复用设计批准票。

本席已读 git diff、完整新 `compaction-response.ts`、两份新 completion 测试、CLI/legacy Desktop 实际摘要入口，以及 OpenAI generic/strict Kimi、Claude、Responses 的终态/usage/retry 相关实现。普通对话新增分支基本均由 requireCompleteResponse 隔离；五 wrapper 保留 options/授权流转。没有读取别席票，没有修改产品或测试，没有清理任何别人的进程。

以下三项均已通过 `node --import tsx --input-type=module` 的内存脚本调用真实生产实现复现。只使用本地受控响应，无网络模型请求；没有将测试替身中的重写状态机作为证明。

## 必改 A-CODE-1：Claude 未闭合工具块被批准为完整摘要

级别：P1。定位：`src/ai/adapters/claude.ts:256`、`:270`、`:305`。

轨迹：正常 text block 产生 summary，随后 content_block_start(tool_use) 没有对应 content_block_stop，再收到 message_delta(stop_reason=end_turn) 和 message_stop。toolBuffers 仅在 block_stop 时发出 tool_use；终态检查没有发现缓冲区或“出现过工具块”事实。因此 collector 只看到正文/usage/done，实际返回成功 summary，违反摘要无工具及完整响应要求。

进一步复现并非只在 mock SDK iterator：本席实例化实际 `@anthropic-ai/sdk` Anthropic client，仅用其自定义 fetch 注入上述完整 SSE（含 message_start 与已闭合 text block），再调用真实 ClaudeAdapter→CompactRunner，SDK 同样未拒绝该轨迹。原始输出：

```json
{"case":"actual-anthropic-sdk-unclosed-tool","accepted":true,"summary":"summary"}
```

最低修订：requireCompleteResponse 路径在看到任何工具块时记录失败，继续排干可得 usage；最终明确拒绝未闭合工具块。至少补实际 ClaudeAdapter+CompactRunner 的 tool_start 无 tool_stop 反例；普通工具任务保持原行为。

## 必改 A-CODE-2：iterator 抛错绕过取消优先

级别：P2。定位：`src/ai/runtime/compaction-response.ts:23` 至 `:32`。

轨迹：真实 CompactRunner 消费 adapter 的 text→done；iterator 下一次继续时先 signal.abort(cancelReason)，随后抛原 lateSdkError。for-await 直接异常退出，末尾 throwIfAborted 不运行，collector 拒绝 lateSdkError 而非已胜出的取消原因。当前测试只覆盖 abort 后正常 EOF，没有覆盖 abort 与原错误同时到达。

原始输出：

```json
{"case":"cancel-vs-late-error","isCancel":false,"isLate":true}
```

最低修订：覆盖 iterator 消费异常的 catch，在 signal 已取消时先抛原 signal reason，否则保留原错误对象；仍不提前安装摘要。增加真实 CompactRunner 的 done→abort→throw 同时到达回归。该问题没有被本席夸大为当前已安装摘要或重复副作用，必改依据是冻结设计的明确“signal 取消优先”契约。

## 必改 A-CODE-3：Responses 完成但无 usage 时仍制造零 usage

级别：P2。定位：`src/ai/adapters/openai-responses.ts:197` 至 `:203`。

轨迹：受控 HTTP JSON 为 status=completed、非空 output_text、不带 usage。requireCompleteResponse=true 时仍落入原无条件 yield usage 分支，通过 `?? 0` 产出 inputTokens/outputTokens 都为零。失败 status 新分支已正确避免无 usage 时伪造，但成功分支没有落实同一摘要契约。

实际 ResponsesAdapter 消费原始输出：

```json
{"case":"responses-missing-usage","chunks":[{"type":"text","delta":"summary"},{"type":"usage","usage":{"inputTokens":0,"outputTokens":0}},{"type":"done"}]}
```

最低修订：只在 strict 摘要路径的真实 payload 存在 usage 时发 usage；不必改变正常 chat 的历史兼容行为。补 completed/no-usage 回归，保留正文成功及真实 usage 输出。冻结设计明确“缺失 usage 不编造为零或已结算”，现有正常路径旧行为不构成新增摘要契约的豁免。

## 其他检查结论与范围

- OpenAI 新分支会排干 usage trailer，并检测 terminal 后非空 delta/新 finish_reason；没有发现明确的普通 chat 回归。strict Kimi 原 EOF/tool 兼容在 requireCompleteResponse 下被提前拒绝，不能替代摘要 stop 终态。
- collector 保留迟到原错误对象、拒绝工具/空白/缺 done 的主路径成立，但上述异常取消路径仍需修正。
- Desktop 已通过 receivedChunk 与 CompactionResponseError/isAbortError 分离原网络 snip 和不完整失败；本席未据独立 export 推导普通 Desktop 实际流程已验收。
- Responses 原有 headers 后清 timer 的 body timeout 限制仍在，本票不把它误报为本次引入的新缺陷，也不据单测宣称实际 body drain 永不挂住。
- root/desktop suite 的主笔数字不作为本席亲自执行结果。本席仅报告上述本地原始复现输出，不声称真实 provider、安装包、完整 wire 预算或缓存收益验收。

本轮复现时三个相关文件 SHA256：

```text
1bfc7fe84fa448f0300bcbaa240e51485bdefbc5bd81380797c7ea0e688c6971  src/ai/runtime/compaction-response.ts
b5d584691db02f0bb1b1e631fb8177493e2171d6b55da8e8ffab3357cae1f9f8  src/ai/adapters/claude.ts
d5d4b7f2167f2bf586ffd00396715d2df2cf94842c66d4b889c8b4771d491313  src/ai/adapters/openai-responses.ts
```

最终：**BLOCK**。三项修订完成及最终 diff 冻结后须重新独立核验，不能将本票改记通过。

## 第二轮复核：三项关闭，新增 A-CODE-4，当前仍 BLOCK

已重新阅读当前完整产品/测试/CI diff，并独立重跑首轮反例。A-CODE-1/2/3 均关闭：

```json
{"case":"cancel-vs-late-error","isCancel":true,"isLate":false}
{"case":"actual-anthropic-sdk-unclosed-tool","accepted":false,"reason":"provider_incomplete"}
{"case":"responses-missing-usage","chunks":[{"type":"text","delta":"summary"},{"type":"done"}]}
```

本席实际运行 `node node_modules/vitest/vitest.mjs run --no-cache tests/ai/runtime/compaction-completion.test.ts tests/ai/runtime/compact-runner.test.ts tests/ai/adapters/openai.test.ts`，3 files、231 tests passed（32+12+187），exit 0。已检查首红 `review-findings-red.log`，其中首轮三个反例确实先失败；其额外一项为 AgentRuntime 测试夹具方法错误，不冒称产品缺陷。已读取主笔 `root-focused-v3.log` 的 369/369 原始结果，但不冒称该批均由本席执行。

CI 改动加入 Windows/macOS/Linux 与 Node 22.14/24 的相关 adapter/摘要测试及 Desktop 两套测试。静态命令/路径与当前测试文件匹配；配置加入不等于远端 matrix 已实际运行。先前构建污染的 Windows native 删除和 build-info 时间写入已经通知主笔，主笔随后确认恢复；它们不属于本批实现批准范围。

新必改 A-CODE-4，级别 P1：`src/ai/adapters/openai-responses.ts:179` 的 malformed function_call 普通 Error 会被 `desktop/electron/context-manager.ts:140` 的零 chunk fallback 当作原网络失败处理，破坏原历史且返回成功。

轨迹为真实 ResponsesAdapter+真实 compactConversation：受控 JSON `status=completed`，首个 output 为 `{type:'function_call',name:'write',arguments:'{}'}`（缺 call_id），附真实 usage；输入是 20 条交替 user/assistant 历史。adapter 在发任何 chunk 前抛普通 Error；Desktop 未识别为完整性错误，historySnip 删除了 12 条，Promise resolve。原始输出：

```json
{"case":"desktop-malformed-response-tool","rejected":false,"beforeCount":20,"afterCount":8,"unchanged":false}
```

这不是假设网络故障，也没有重写生产 fallback；违背冻结设计第 6 项的不完整拒绝、不删原历史。最低修订：requireCompleteResponse 路径将 malformed function_call 标为 CompactionResponseError，或者在严格摘要路径更早识别任何工具项并保留可得 usage 后拒绝；普通 chat 的原错误行为不必改变。补上述足够长历史的真实 Desktop+Responses 回归，避免只有单条历史时 snip 恰好不删导致测试假通过。

本轮相关源码哈希：

```text
3de449b53918a06f1a4273f16bbe9417518c28d5e007f084c9c4055c2fe9723b  src/ai/runtime/compaction-response.ts
2ac88d1e0c7674a240f85da9134e41ee717ad769b727f87b2f67ace14bfcc328  src/ai/adapters/claude.ts
1a6a1dc298934e955fc4691ec5f25230f6e2150d2f6bf3006e043431167dfc47  src/ai/adapters/openai-responses.ts
cd33fbbaf26c30912fdea5f57eb607c5d89ec7d8c8f7b67773b1f9e3e82fd86b  src/ai/adapters/openai.ts
7cfd48cfd71aa36c09278affe8d3c435f445a500f8541dc89a40cbab5ce0a5f7  desktop/electron/context-manager.ts
ae978ffafb4102da7f6d810856ff6a2a4d6a97e1dfa37834943c5c0d804efa28  .github/workflows/model-recovery.yml
```

第二轮最终：**BLOCK**。首轮三项已关闭，但 A-CODE-4 修订前不能批准当前代码。

## 第三轮最终复核：APPROVE

本轮重新读取最后 Responses diff 与实际 Desktop 回归，A-CODE-4 已关闭：strict 摘要 JSON decode 错误、无 completed/不合法 output 数组及任意 function_call/refusal 都归入 CompactionResponseError，能在 Desktop 首个 chunk 之前阻断 snip；可得 payload usage 先观察再拒绝。正常 chat 的旧分支保留。没有通过删测试、只用一条不会被 snip 的历史或改变原异常断言换取通过。

已阅读 `desktop-responses-red.log` 原始日志：malformed function_call、损坏 JSON、output 非数组三项先失败，7 项通过。随后本席独立运行当前修复：

```text
node node_modules/vitest/vitest.mjs run --no-cache tests/ai/runtime/compaction-completion.test.ts tests/ai/adapters/openai-responses.test.ts
2 files passed; 40 tests passed (32+8); exit 0

# 以下在 desktop/ 执行
node node_modules/vitest/vitest.mjs run --no-cache tests/main/context-manager.test.ts tests/main/compaction-completion.test.ts
2 files passed; 51 tests passed (41+10); exit 0
```

结合第二轮本席独立执行的 231/231（含实际 OpenAI/strict Kimi/CompactRunner）及三条原始反例复核，四项发现均已实际关闭。AgentRuntime 回归调用真实 ClaudeAdapter，首个摘要请求截断经 compact_failed→确定性 fallback，原半截正文未安装；测试不重写预算或生产状态机。当前完整源码/测试/CI diff 没有新的必改项。git status 本轮检查只有本批源码/测试/设计/CI，前述无关 dist/Windows native/build-info 污染已恢复。

最终审定的设计与全部实现/测试/CI文件 SHA256：

```text
3d883cdd658bfbfdadac4bea28dc4e0d80e253ae121d8a38ff7f9fc74f3a33f8  reviews/pi-durable-optimization-implementation.md
3de449b53918a06f1a4273f16bbe9417518c28d5e007f084c9c4055c2fe9723b  src/ai/runtime/compaction-response.ts
39421ffc2591e656c812a1300ff21986c91ff2a38ba9e7c3751bfba45c26abc9  src/ai/runtime/compact-runner.ts
b63013265e70163a5579985d251ae10bcf875951b51b6195fba91a0614e13f45  src/ai/runtime/model-capabilities.ts
2ac88d1e0c7674a240f85da9134e41ee717ad769b727f87b2f67ace14bfcc328  src/ai/adapters/claude.ts
7cdb80057b04e4ae04f5066111d0f23fc402e9a16ca28597d9b598d9a47d4310  src/ai/adapters/openai-responses.ts
cd33fbbaf26c30912fdea5f57eb607c5d89ec7d8c8f7b67773b1f9e3e82fd86b  src/ai/adapters/openai.ts
7cfd48cfd71aa36c09278affe8d3c435f445a500f8541dc89a40cbab5ce0a5f7  desktop/electron/context-manager.ts
ae978ffafb4102da7f6d810856ff6a2a4d6a97e1dfa37834943c5c0d804efa28  .github/workflows/model-recovery.yml
3e950a303b3bdca97f93e73c35c53679cda0b581e0ec1fbb84f981dcc5b275b2  tests/ai/runtime/compaction-completion.test.ts
f18bd91b0e55f048c362a4a0e2fe0129ec382e0874f342ae98cec8330cf2f54d  tests/ai/runtime/compact-runner.test.ts
879701f598e1d4c32c5d29e2864ec887a48825af8a7f6a776cf96fc16cdc90d9  tests/ai/adapters/openai.test.ts
89012e796780fe01a52785e6f9f7876f7fdf209f0c009b288eed591bfe3bfc5f  desktop/tests/main/compaction-completion.test.ts
078476d63b9094b7d65adc7dbd6ae88fcb9b4cc4749492ffd8b26d91f9c3bbc4  desktop/tests/main/context-manager.test.ts
```

非阻断边界保持：Responses 原 body timeout 限制未由本批消除；promptCache 复用逻辑未改；P3 malformed index 审计问题须作为独立后续问题处理。本批不宣称全 wire 预算、缓存收益、真实 provider、Windows 安装包/ASAR或普通 Desktop 日用入口已经验收。CI 文件内容审查通过不等于本席实际执行了远端 OS 矩阵；本票没有转引主笔运行数字作为本席运行结果。

第三轮最终票：**APPROVE**。批准上述精确源码/测试/CI哈希所对应的压缩完整性实现；首轮、第二轮 BLOCK 原始轨迹保留，未改写为历史通过。
