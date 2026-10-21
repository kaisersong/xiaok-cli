> 首轮 BLOCK 原票保留如下；最终复审裁决见文末，针对新源码快照独立作出。

# 独立席 B：实施代码对抗审查

日期：2026-10-21。当前工作树审查票：**BLOCK**。本票不沿用实施设计 APPROVE，不代表主笔随后新增测试或修复已经复核。

## 审查对象与证据

worktree：`$WORKTREE`；HEAD `dc221f9bac84d939b8fb543d4795396693fdc9b8`；无 `.codegraph/`，未建立索引。

已完整复核设计 SHA `3d883cdd658bfbfdadac4bea28dc4e0d80e253ae121d8a38ff7f9fc74f3a33f8`。审阅当前全部生产 diff、新 collector、新 root/Desktop completion tests、原 CompactRunner/portable executor/Session apply/AgentRuntime 压缩路径、三 adapter 与 System One 基线、provider authorization wrapper，以及 abort helper。

本票现场源码哈希：

- `src/ai/runtime/compaction-response.ts`：`1bfc7fe84fa448f0300bcbaa240e51485bdefbc5bd81380797c7ea0e688c6971`
- `src/ai/adapters/claude.ts`：`b5d584691db02f0bb1b1e631fb8177493e2171d6b55da8e8ffab3357cae1f9f8`
- `desktop/electron/context-manager.ts`：`7cfd48cfd71aa36c09278affe8d3c435f445a500f8541dc89a40cbab5ce0a5f7`

只读执行两组内存中受控复现，无网络模型、无用户历史、无测试文件改动。Claude 另使用安装的真实 `@anthropic-ai/sdk` 的 `MessageStream.fromReadableStream` 解析 JSON event 流，接实际 ClaudeAdapter 和 CompactRunner，避免仅凭重写的测试状态机判断。`git diff --check` 无输出。主笔报告 root331/Desktop48 通过不被本票冒充独立执行结果。

检索日志时一次宽范围 rg 意外匹配到其他席设计票少量文本；未主动打开，也未采用其判断。上述问题由本席源码轨迹与独立实跑得到。

## 必改阻断

### B-CODE-1：Claude 未闭合 tool block 可被接受成完整摘要（P1）

位置：`src/ai/adapters/claude.ts:256` 与 `:304`。

当前 tool_use 只在 `content_block_stop` 才向 collector 输出；strict 最终判断只看 message_stop/stop_reason/incompleteSummary，不看残留 toolBuffers。具体轨迹：

1. message_start，合法 text block，正文 `partial summary`；text block 正常 stop。
2. content_block_start(index=1, tool_use id=unclosed, name=write)，缺该 block_stop。
3. message_delta(stop_reason=end_turn, usage=7)，message_stop，EOF。
4. 实际 SDK 没有拒绝未闭合块，ClaudeAdapter 没有输出 tool_use，collector 收到 text+usage+done，因此 CompactRunner 返回 `partial summary`。

现场结果：`{"case":"sdk_unclosed_tool","accepted":true,"result":"partial summary"}`。

这违反冻结补充第2/3/5条的“无 tool_use/完整响应才安装”。真实 CLI 正常 apply 路径会把该文本当成功模型摘要，既不触发 deterministic fallback，也不报告 compact_failed；Desktop 也可插入该 boundary。

最小改法：strict 摘要路径在 raw tool_use block_start 即记录不可接受（继续排干 usage），或最终至少拒绝 `toolBuffers.size > 0`；不改变普通工具流。用真实 SDK MessageStream→ClaudeAdapter→CompactRunner 补上述轨迹回归，并确认既有完整 text 成功、完整工具拒绝及晚 usage 保留。

### B-CODE-2：iterator 抛错时越过取消优先检查（P2，明确契约缺口）

位置：`src/ai/runtime/compaction-response.ts:23`，结尾取消检查 `:32`。

for-await 没有 catch；若 next() 抛错，控制流不会到结尾 throwIfAborted。轨迹：text→done→controller.abort(reason)→iterator 抛 lateError。现场通过实际 CompactRunner 调 collector：

`{"case":"abort_and_late_error","isAbortReason":false,"isLateError":true}`。

冻结补充第2条要求 signal 取消优先。portable executor 随后会再次检查 signal，所以当前 AgentRuntime 不会因此安装摘要；但 CompactRunner/collector 的取消边界直接违约，并把取消误报为迟到传输错误。

最小改法：在 collector 的迭代异常边界先检查 signal，若未取消则原样重抛原 error；不读取/包装任意原错误。补 abort+lateError 同时发生的回归，断言 reason 对象 identity；无取消时仍断言 lateError identity、usage drain。

## 已确认合理的边界与非阻断建议

- Desktop catch 现已以 any chunk、CompactionResponseError、AbortError 拒绝，historySnip 仅留给首 chunk 前的旧异常；完整空白 no-op 保留。建议其历史不变测试用足够长、可被 snip 的历史，当前一条消息 fixture 即使误走 snip 也未必变化，难以证明保护有效。
- CLI portable executor 原 abort 检查、structuredClone 前缀、Session revision/stale/no_gain 和一次 deterministic fallback 保留；未见修改 store schema/Host pin 或引入后台 drain。
- 本次新测试尚未发现真实 adapter 截断→AgentRuntime fallback 的新增端到端断言；该项是冻结补充必要回归，主笔正在补测，最终验收须核其真实入口结果，不能只用 CompactRunner rejects 与既有 mocked summary failure 两者拼成证明。
- P0 inventory JSON 的 50 文件/10,936,366 bytes 与补充一致，只支持磁盘 metadata；缺访问trace时 P2 保持 unknown 合理。本 diff 没有缓存变更。P3 没有 store 新协议实施，仍只能审计，缺陷需新修订；完整预算门未获资格，未冒称完成。
- 未运行安装包/Windows/ASAR 或真实 provider，源码测试不能替代这些项。未清理任何非本席进程。

## 结论

**BLOCK** 当前代码快照。B-CODE-1 与 B-CODE-2 修复并回归后，须对最终变更重新核验；本票不对未来修复预投 APPROVE。


# 修复后最终独立复审

日期：2026-10-21。最终票：**APPROVE** 当前源码/测试/CI diff，已关闭本席首轮两项阻断。

## 冻结对象

设计仍为 SHA256 `3d883cdd658bfbfdadac4bea28dc4e0d80e253ae121d8a38ff7f9fc74f3a33f8`。HEAD 仍为 `dc221f9bac84d939b8fb543d4795396693fdc9b8`；针对未提交 diff 及新增源码，不能用 HEAD 本身代表本票对象。

当前 `git diff --binary` SHA256：`b3da68a6e0664fad2e69954f034cf6a2f8c0ad03332196ef8b4308bb85bec2d6`。

源码/测试/CI/设计文件联合快照 SHA256：`e142d892cb6fee274ea70bf98b26d3dd235f5c9998937b53259e1d32847d6889`。算法：对包含 head、diffSha256、以下路径→文件 SHA256 的对象，以 JSON sort_keys、紧凑逗号/冒号序列化后取 SHA256；新增未跟踪源码和测试也纳入。

```json
{
  ".github/workflows/model-recovery.yml": "ae978ffafb4102da7f6d810856ff6a2a4d6a97e1dfa37834943c5c0d804efa28",
  "desktop/electron/context-manager.ts": "7cfd48cfd71aa36c09278affe8d3c435f445a500f8541dc89a40cbab5ce0a5f7",
  "desktop/tests/main/compaction-completion.test.ts": "746eadf03afdff32a4fbe12b002957c339d0f602e182b30e11973263184c85fc",
  "desktop/tests/main/context-manager.test.ts": "078476d63b9094b7d65adc7dbd6ae88fcb9b4cc4749492ffd8b26d91f9c3bbc4",
  "reviews/pi-durable-optimization-implementation.md": "3d883cdd658bfbfdadac4bea28dc4e0d80e253ae121d8a38ff7f9fc74f3a33f8",
  "src/ai/adapters/claude.ts": "2ac88d1e0c7674a240f85da9134e41ee717ad769b727f87b2f67ace14bfcc328",
  "src/ai/adapters/openai-responses.ts": "1a6a1dc298934e955fc4691ec5f25230f6e2150d2f6bf3006e043431167dfc47",
  "src/ai/adapters/openai.ts": "cd33fbbaf26c30912fdea5f57eb607c5d89ec7d8c8f7b67773b1f9e3e82fd86b",
  "src/ai/runtime/compact-runner.ts": "39421ffc2591e656c812a1300ff21986c91ff2a38ba9e7c3751bfba45c26abc9",
  "src/ai/runtime/compaction-response.ts": "3de449b53918a06f1a4273f16bbe9417518c28d5e007f084c9c4055c2fe9723b",
  "src/ai/runtime/model-capabilities.ts": "b63013265e70163a5579985d251ae10bcf875951b51b6195fba91a0614e13f45",
  "tests/ai/adapters/openai.test.ts": "879701f598e1d4c32c5d29e2864ec887a48825af8a7f6a776cf96fc16cdc90d9",
  "tests/ai/runtime/compact-runner.test.ts": "f18bd91b0e55f048c362a4a0e2fe0129ec382e0874f342ae98cec8330cf2f54d",
  "tests/ai/runtime/compaction-completion.test.ts": "3e950a303b3bdca97f93e73c35c53679cda0b581e0ec1fbb84f981dcc5b275b2"
}
```

当前 git status 已无 dist/build-info/native 删除或构建残留；没有 store/Host schema 或协议变更。`git diff --check` 无输出。

## 原阻断关闭与独立复现

- **B-CODE-1 已关闭**：Claude `:257` 在任一 raw tool_use start 标记 strict 摘要不完整；`:306` 最终同时检查残留 toolBuffers。继续排干原始流/usage 后再拒绝，不影响普通工具流。重新以真实 SDK `MessageStream.fromReadableStream`→ClaudeAdapter→CompactRunner 运行首轮相同未闭合工具轨迹，结果为 `accepted=false, code=compaction_response_incomplete`。这次没有接受 `partial summary`。
- **B-CODE-2 已关闭**：collector `:33–35` 的迭代异常边界先检查 signal，未取消才原样抛原错误。本席重跑 text→done→abort(reason)→lateError，结果 `isAbortReason=true,isLateError=false`。无取消的迟到原错误对象 identity 仍保留。
- **Desktop 额外独立核验**：用20条可实际被 snip 的历史，分别在 text 或 usage 后抛错，均 `rejected=true,sameError=true,unchanged=true`；首 chunk 前 AbortError 也同样原样拒绝且历史不变。首 chunk 前网络异常则保持旧 snip，结果 `rejected=false,length=8`。完整空白 no-op 与成功安装仍由既有/新增回归覆盖。这样补足了首轮关于短历史 fixture 难以证明 snip 保护的证据弱点，不要求重复添加镜像测试。
- Responses strict 已完成但无 usage 对象时不再输出虚假零 usage；失败状态保留已存在 payload usage 后再拒绝。没有把该消费链声称为新的 durable 结算 ledger。

## 真实入口回归与范围复核

已阅读全文新增实际 adapter 回归及8项 strict Kimi production authorization 测试。AgentRuntime 新回归使用实际 ClaudeAdapter，通过受控 SDK 边界固定第一次请求默认 max_tokens 截断，随后普通请求成功：断言两次请求、`compact_failed` 在 `compact_triggered` 前、安装 deterministic fallback、局部模型文本不在最终 session。该测试调用真实 executor/Session apply，而不是把它们重写在测试里；正确性闭环现有直接证据。

已读 `review-findings-red.log`：32项中4失败。该日志保留其实际失败，不把其中最初 SDK 请求识别不对的 AgentRuntime fixture 错误称为产品缺陷；当前 fixture 固定首请求为摘要，后续成功日志覆盖修正后的真实路径。

已核对日志数字：`root-focused-v3.log` 与 `root-node22.log` 均369/369，`desktop-final-node24.log` 与 `desktop-node22.log` 均48/48，`ci-command-local.log` 为编译JS入口384/384。属于本席检查已有日志，并非本席独立重跑整套；独立执行仅上文列出的无网络反例与20条历史核验。构建/类型/治理日志已读；治理记录0 new violations。CI YAML保留 Ubuntu/Windows/macOS 和 Node22.14/24 矩阵并增加对应摘要/Desktop套件；本地日志不等于远端矩阵已执行。

P3 审计脚本只创建并清理自己 mkdtemp 根；实际 malformed active index 经真实 store 得到 `[]`。日志明确标缺口、未改 store 协议，符合先审计再另案修订的冻结边界。此缺陷**未修复**，不能算P3完成；它不是本次摘要局部 patch 引入的问题，也没有以本票批准新的熔断/恢复协议。

P2仍unknown且无缓存/Host pin变更；50文件/10,936,366字节仅与metadata inventory相符，未伪装真实访问trace或收益。完整wire预算契约仍qualification_unknown，U/C未合并机制未被拼接。没有自动恢复/重放、用户数据迁移、新存储owner或清理其他进程。

## 最终结论与限制

**APPROVE** 上述联合快照；无剩余必改阻断项。本票仅对当前完整性子批源码、测试与CI改动的审查通过，不能称父v3方案完成、P2有收益、P3已修复或安装包/ASAR/Windows/真实provider/日用入口验收完成。后续代码变化必须重新核对，不复用本票哈希。


# Responses 零 chunk 失败分类补修后的独立复审

日期：2026-10-21。以下为新增代码快照的独立裁决，不复用上一个联合 SHA 的 APPROVE。前文首轮 BLOCK 与上轮复审均保持历史原样。

**当前代码票：APPROVE**，无新增必改阻断项。当前HEAD仍为 `dc221f9bac84d939b8fb543d4795396693fdc9b8`；冻结实施设计SHA仍为 `3d883cdd658bfbfdadac4bea28dc4e0d80e253ae121d8a38ff7f9fc74f3a33f8`。

当前 `git diff --binary` SHA256：`19cac7acd4c606ba89287977ea2f3f56eb45793ccc5ac46377b517b296766846`。
联合快照 SHA256：`153fbf1c7420009ed10c72cf9e82ab30f16d443b92e13a9255d2f466f8c793c8`，算法与前次复审相同；完整路径SHA如下，包含新增未跟踪源代码、测试与设计文本：

```json
{
  ".github/workflows/model-recovery.yml": "ae978ffafb4102da7f6d810856ff6a2a4d6a97e1dfa37834943c5c0d804efa28",
  "desktop/electron/context-manager.ts": "7cfd48cfd71aa36c09278affe8d3c435f445a500f8541dc89a40cbab5ce0a5f7",
  "desktop/tests/main/compaction-completion.test.ts": "89012e796780fe01a52785e6f9f7876f7fdf209f0c009b288eed591bfe3bfc5f",
  "desktop/tests/main/context-manager.test.ts": "078476d63b9094b7d65adc7dbd6ae88fcb9b4cc4749492ffd8b26d91f9c3bbc4",
  "reviews/pi-durable-optimization-implementation.md": "3d883cdd658bfbfdadac4bea28dc4e0d80e253ae121d8a38ff7f9fc74f3a33f8",
  "src/ai/adapters/claude.ts": "2ac88d1e0c7674a240f85da9134e41ee717ad769b727f87b2f67ace14bfcc328",
  "src/ai/adapters/openai-responses.ts": "7cdb80057b04e4ae04f5066111d0f23fc402e9a16ca28597d9b598d9a47d4310",
  "src/ai/adapters/openai.ts": "cd33fbbaf26c30912fdea5f57eb607c5d89ec7d8c8f7b67773b1f9e3e82fd86b",
  "src/ai/runtime/compact-runner.ts": "39421ffc2591e656c812a1300ff21986c91ff2a38ba9e7c3751bfba45c26abc9",
  "src/ai/runtime/compaction-response.ts": "3de449b53918a06f1a4273f16bbe9417518c28d5e007f084c9c4055c2fe9723b",
  "src/ai/runtime/model-capabilities.ts": "b63013265e70163a5579985d251ae10bcf875951b51b6195fba91a0614e13f45",
  "tests/ai/adapters/openai.test.ts": "879701f598e1d4c32c5d29e2864ec887a48825af8a7f6a776cf96fc16cdc90d9",
  "tests/ai/runtime/compact-runner.test.ts": "f18bd91b0e55f048c362a4a0e2fe0129ec382e0874f342ae98cec8330cf2f54d",
  "tests/ai/runtime/compaction-completion.test.ts": "3e950a303b3bdca97f93e73c35c53679cda0b581e0ec1fbb84f981dcc5b275b2"
}
```

## 新变化与独立证据

已阅读当前 Responses 全部新增 diff、Desktop completion 测试全文及 `desktop-responses-red.log`。该红日志为真实ResponsesAdapter→Desktop的3项失败、7项通过；原三项断言曾 resolved 而非 reject，当前补修针对同一生产消费链，没有用测试重写解析状态机。

新增代码在 `openai-responses.ts:161–177`：strict 摘要请求的 JSON decode 失败转为有界 `CompactionResponseError`，识别取消的原异常继续保留；成功JSON必须 completed、output为数组，拒绝任意function_call（包括缺call_id的畸形工具）、message content形状错误、refusal及非字符串output_text。只在requireCompleteResponse启用，普通chat原处理不变。已有payload usage先输出再typed reject；无usage对象不伪造0。由此零chunk的完整性失败不会落入Desktop首chunk前普通网络异常historySnip路径。

本席独立执行了真实ResponsesAdapter→compactConversation，使用20条足以被snip的历史并在HTTP边界受控返回以下payload：

- completed但function_call缺call_id；
- 200状态但JSON损坏；
- completed但output为对象；
- message含正文后又含refusal。

四项均得到 `rejected=true,code=compaction_response_incomplete,unchanged=true,calls=1`；未删除原历史、未安装boundary、无自动重派。另以畸形function_call+真实usage运行实际adapter，输出先含 `inputTokens=3,outputTokens=7`，随后同一typed reject，验证拒绝不吞已知usage。

前轮两个阻断的修复、真实Claude截断经AgentRuntime deterministic fallback、取消reason identity及20条Desktop网络/late-error边界没有被这次补修修改。P3仍只有malformed index→[]审计发现，没有store协议变更或修复完成声明；P2仍unknown、无缓存回收，完整预算门仍qualification_unknown。

## 验证限度

本次批准是对当前源码/测试/CI diff的代码审查结论及上述独立受控复现。前文369/48/384等日志属于各自当时运行快照，**不冒充本次新增Responses改动后的最终Node22/24、构建或CI结果**；主笔正在重跑时应在最终结果账本对应新快照列明。没有据本票宣称Windows/ASAR/安装包、真实provider、日用入口、P2收益或父方案全部完成。

只有本评审文件发生写入，未改生产代码/测试或用户数据。最终后续源码如变化，需重新核对本票联合SHA。


## 最终矩阵日志确认（新增 Responses 修复后）

重新核对当前源码/测试/CI联合快照仍为 `153fbf1c7420009ed10c72cf9e82ab30f16d443b92e13a9255d2f466f8c793c8`，`git diff --binary` SHA仍为 `19cac7acd4c606ba89287977ea2f3f56eb45793ccc5ac46377b517b296766846`；与本轮代码裁决对象一致，没有用上一个快照的结果续票。

已实际读取最终日志：

- `root-final-node22.log`、`root-final-node24.log`：各11文件、402/402通过。
- `desktop-final-node22.log`、`desktop-final-node24.log`：各2文件、51/51通过。
- 更新后的 `ci-command-local.log`：编译JS本地原命令10文件、384/384通过。
- CLI build、Desktop main build、Desktop typecheck日志已核对；typecheck明确Electron clean、Renderer baseline 0 current。governance与architecture-changed均记录0 new violations。主笔报告上述命令exit0；本席未重跑全部命令。
- `hygiene-final.log`仍保留intent-broker落后upstream1提交及tracked WIP错误。本席没有修改/重置该独立仓库以换取通过；它是已存在的整体验收限制，不能把本票写成全部仓库hygiene通过。

**最终票维持 APPROVE 当前联合快照**。本轮摘要完整性代码没有剩余必改阻断项；前文“新增改动后的最终矩阵待测”现由上述对应日志补足。远端CI矩阵、发布安装包/ASAR/Windows实机及真实provider仍不由这些本地测试代替。父v3、完整预算门、P2缓存收益与P3审计发现的索引缺口仍不可宣称完成。
