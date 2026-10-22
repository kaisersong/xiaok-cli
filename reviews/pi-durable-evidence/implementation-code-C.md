# 独立席 C：实现代码审查

最新复审票：**APPROVE**，针对文末 Responses 补修后的 diff `19cac7ac…`，此前票的版本身份不得替代当前票。以下首轮 **BLOCK** 原始发现及证据保留。本票针对读取到的工作区实现，不把实施设计 APPROVE 当作代码验收。未读其他席票；未修改源码或测试，仅写本审查文件。

## 范围与证据

完整阅读生产 diff、新增 compaction-response collector、两份新增 completion tests、既有测试改动及关键真实 adapter 调用链。设计 SHA256 核为 `3d883cdd658bfbfdadac4bea28dc4e0d80e253ae121d8a38ff7f9fc74f3a33f8`。本次发现对应 Claude 源码 SHA256 为 `b5d584691db02f0bb1b1e631fb8177493e2171d6b55da8e8ffab3357cae1f9f8`；collector 为 `1bfc7fe84fa448f0300bcbaa240e51485bdefbc5bd81380797c7ea0e688c6971`。工作区正在补测试，后续版本必须重新核验，不能复用本票作最终 HEAD 结论。

已读 `root-focused-v1.log`（SHA256 `640dcd2417e5565e67e2152cfe8cb3028f3800511a00b903833ac680415693e9`）、`desktop-focused-v2.log`（`164c8c44f4b759ebd285e44f54a595bbceec93440d3a540e859702aebcd1a2f1`）及 completion 红测日志。原始日志支持当时 root 331、Desktop 48 passed；这些日志不自动验证读取后新增的测试或最终完整 HEAD，也不证明容量/缓存准入。

## 必改 C-CODE-1：Claude 未闭合的工具块可被隐藏成成功摘要

位置：`src/ai/adapters/claude.ts:256` 的工具缓冲建立，以及 `:305` 的最终完整性判断。

严格摘要路径只在 `content_block_stop` 时把缓冲工具转为 normalized `tool_use`；若 provider 提供工具 start/arguments，却缺 block stop，最终合法 stop_reason + message_stop 仍然放行。collector 看不到该工具，最终把正文当成有效摘要。这违反本批“无工具、完整后才安装”的核心契约。

本席使用真实 ClaudeAdapter → provider conversation wrapper → CompactRunner，以本地受控 SDK iterator 只读执行下列顺序，未调用外部 provider：

1. text_delta：`summary before tool`；
2. content_block_start，index=1，type=tool_use，id=t，name=write；
3. input_json_delta，index=1，partial_json=`{"path":"x"}`；
4. message_delta，stop_reason=end_turn，output_tokens=7；
5. message_stop，随后 EOF；没有 content_block_stop。

原始命令输出：`ACCEPTED summary before tool`，exit 0。该 fixture 是不完整 provider 协议的可证伪反例，不宣称真实付费模型发生过这次返回。

最小修复：严格摘要一旦观察到任何 tool_use start 就标记失败（继续排干原 usage/迟到原异常）；至少最终不能在工具缓冲仍非空时发 done。新增真实 ClaudeAdapter + CompactRunner 回归，断言上述缺 block stop 的轨迹拒绝、只发送一次、原 usage 能继续观察，且不影响未启用严格摘要的普通工具流。不要在 collector 重建 provider 工具状态机。

## 其余判断与剩余验证

生产改动规模小，内部 option 未成为公开配置或 durable owner；真实默认截断路径进入 typed failure，原普通对话分支保持。collector 排干晚 usage、拒绝缺 done/工具/空摘要及晚正文，Desktop 空白 no-op 与异常时不改历史的路径已有针对性测试。现有失败 fixture 能在基线红测，具有可证伪性。

当前新增 tests 已覆盖真实 adapter → CompactRunner；真实截断 adapter → AgentRuntime 的“不安装局部摘要、fallback/compact_failed 保留”链仍须按设计补齐并提交原始新日志。主笔已明确正在补该链，本票不把旧 mock fallback 测试冒充此项完成。

P0 缓存 inventory 没有被宣传为收益；容量和缓存仍 unknown 且没有相关产品改动，停止项合法。该批只可报告压缩完整性子批及实际执行的回归；P3、新容量门、缓存收益、实际 UI/平台/安装包和最终 HEAD 验收不得由本票或这些 focused logs 代替。

无其他已证实的代码阻断。修复 C-CODE-1 并完成本批必要回归后，应对新实现重新审查。

## 修复后独立复审

已重新阅读最终生产 diff、collector、真实 adapter completion tests、AgentRuntime 集成链、strict Kimi 新测试与 CI 变更，未读取其他席票。当前不存在首轮阻断。

冻结身份：设计仍为 `3d883cdd658bfbfdadac4bea28dc4e0d80e253ae121d8a38ff7f9fc74f3a33f8`；此时 `git diff --binary` SHA256 为 `b3da68a6e0664fad2e69954f034cf6a2f8c0ad03332196ef8b4308bb85bec2d6`。该 diff 不含尚未 tracked 的新增文件，故同时核对新增 collector `3de449b53918a06f1a4273f16bbe9417518c28d5e007f084c9c4055c2fe9723b`、root completion tests `3e950a303b3bdca97f93e73c35c53679cda0b581e0ec1fbb84f981dcc5b275b2`、Desktop completion tests `746eadf03afdff32a4fbe12b002957c339d0f602e182b30e11973263184c85fc`。构建生成物和 Windows helper 删除已从最终 diff 移除。

C-CODE-1 关闭：Claude 严格摘要在任何 tool_use start 就记录不完整，最终同时检查非空工具缓冲；原 usage 仍排干。新增真实 adapter → CompactRunner 缺工具闭合事件的回归，先在 `review-findings-red.log` 明确失败，再通过修复后的 focused suite。collector 同时优先抛出 caller cancellation，Responses 严格路径缺 usage 时不再生成零 usage；相应可证伪红测与新绿测均已读取。

AgentRuntime 证据补齐：真实 Claude SDK 首次摘要返回 max_tokens，第二次普通请求正常；测试断言实际调用两次、事件依次 compact_failed/compact_triggered、安装确定性 fallback、MUST_NOT_INSTALL_PARTIAL 未进入会话。它实际覆盖本批失败误报修复及 fallback 兼容，未仅在测试中重写摘要状态机。strict Kimi 经真实生产授权的 8 个新用例覆盖 stop、length、过滤、工具、EOF 与晚文本/重复终态/晚异常；普通 adapter 既有回归保留。

已读原始日志，确认：root focused v3 为 369 passed；Node22 root 369、Desktop 48；compiled CI 命令本地执行为 384 passed；Desktop 原 focused 为 48。Node22 日志哈希分别为 `0d25b66f20ea1ad0a0c7a1f7fa2138ee0d0e8f0719f50b3ea0dfe74bdcc238dc`、`b8cdfe996bda422ba26644d6a6836a7eb4bdff26550216b673f08b07fa6f9883`；compiled CI 日志为 `3cc8d8dbe85eee73498f34b7ad3e9219b7c9ac1b8a1b61f78688f3aa4fd95704`。构建、governance 和 architecture 增量日志已读，治理新增违规为 0；本席额外执行 `git diff --check` 通过。CI 已加入 Linux/Windows/macOS、Node22.14/24 的相关回归，配置存在及本地命令通过不等于远端平台 job/安装包实际已通过。

P3 的隔离审计脚本和原始日志明确报告 malformed_active_index → [] 的现存缺口；本批没有修改 store 协议，不能把这项审计记为修复或故障契约通过。按已冻结补充，最小专项修订与复审应另行开展，不把未获审的新协议混入本次压缩完整性补丁。

最终结论：**APPROVE** 当前上述 diff 与新增文件；无剩余必改代码项。仅认可本批压缩完整性实现及已实际运行的回归。完整请求容量门和缓存资格继续 unknown，P3 缺口继续未修复；本票不宣称父方案整体完成，也不代替后续最终提交 HEAD、实际日用入口或发布产物验收。首轮 BLOCK 及其反例保留。

## Responses 补修后的最终复审（替代前一 diff 的当前票）

已重新阅读 Responses strict JSON decode/结构预校验与真实 Desktop + Responses 新测试，没有沿用前一 diff 的批准。当前 `git diff --binary` SHA256 为 `19cac7acd4c606ba89287977ea2f3f56eb45793ccc5ac46377b517b296766846`；Responses 源码 SHA256 为 `7cdb80057b04e4ae04f5066111d0f23fc402e9a16ca28597d9b598d9a47d4310`。新增 Desktop completion tests 为 `89012e796780fe01a52785e6f9f7876f7fdf209f0c009b288eed591bfe3bfc5f`；新增 collector、root completion tests 保持上一节各自哈希。`git diff --check` 再次通过，最终 scope 不含构建生成物或 Windows helper 删除。

补修使严格摘要在发 normalized 正文前校验 completed、output array、message content、function_call/refusal；JSON 解码失败及完整性错误成为 typed failure，已有 usage 先排干，避免 Desktop 将不完整响应当作首 chunk 前普通网络异常而 historySnip。普通 chat 未启用 strict 时保持原处理分支。本席未发现新增必改代码项。

已读三条真实 Desktop → Responses 的红测原始日志 `desktop-responses-red.log`（SHA256 `b6a01501248bab4e59b9faa1346b0be066e896dd59295ad330f6b98bb71b8ae4`）：function_call 缺 id、坏 JSON、output object 均先前错误 resolve；修复后测试明确要求 typed rejection 与 20 条原历史 JSON 完全相同，具有可证伪性。

最终新原始绿日志已读：`root-final-node22.log`、`root-final-node24.log` 各 402 passed；`desktop-final-node22.log`、`desktop-final-node24.log` 各 51 passed。四文件 SHA256 依次为 `1d0c7f742944debdee93e18af6f96cfeb526dc8b5a12ba326d1e516beb3ef7b6`、`76c449f2a2c78048a14c0b349718449db6e5175e46bb0c733abc098cc0214e5d`、`92ffd2186e0fab52b3c4d9c59d899aea94c9dc53429641a10933a343e55bf2e1`、`72b1f5c9b9713f63bdd68a88259a8ab929a0396b5bcb2cb378202b75c95de75d`。更新后的 compiled CI 本地日志为 384 passed；新 typecheck、governance 日志支持类型检查清洁及 0 新违规。构建成功记录仍仅证明本地对应构建，不替代跨平台安装包。

`hygiene-final.log` 并非全通过：明确保留 intent-broker 落后 upstream 1 commit 及 tracked WIP；本席不批准覆盖这些独立任务状态，也不将其隐去。本批独立 worktree 的生产修改未触碰该 sibling。

**当前最终票：APPROVE** 上述新 diff 和新增文件，无剩余必改项。仍仅完成本批压缩完整性子批与列明回归；预算/缓存 unknown、P3 已发现缺口未修复及其他父验收边界保持不变。其他后续源码变化或最终 HEAD 必须重新核验。
