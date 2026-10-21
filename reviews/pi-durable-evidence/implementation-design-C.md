# 独立席 C：实施补充评审

评审对象：`reviews/pi-durable-optimization-implementation.md`。

本票针对更新后的当前版本重新完整阅读全文，不沿用上一哈希的票。实际 SHA256：`3d883cdd658bfbfdadac4bea28dc4e0d80e253ae121d8a38ff7f9fc74f3a33f8`，与指定值一致。未读其他席票。当前 worktree HEAD 为 `dc221f9bac84d939b8fb543d4795396693fdc9b8`；所读生产文件无 tracked 修改。未调用模型、运行产品测试或访问用户任务正文，仅写本票。

## 已读证据

- P0 metadata：`.xiaok/evals/pi-durable/p0-inventory.json`，SHA256 `a6f1e3feb4afa6e32f5ec2168824cb2753e876506faa846e60a8de18ded24093`。记录 50 文件、10,936,366 bytes、50 completed、48 session/thread，无浏览/订阅访问轨迹，未复制用户原始 payload。该记录支持本批 inventory 描述，不支持缓存内存收益或访问代表性。
- master 的真实 `CompactRunner`、Claude/OpenAI legacy/Responses adapter、System One 相关响应处理、五个 provider conversation wrapper、portable compaction fallback 与 Desktop legacy `compactConversation`。
- 源码核对：CompactRunner 当前只收集 text 后返回；Claude 截断拒绝、OpenAI length 拒绝及 Responses 非 completed 拒绝均受显式 maxOutputTokens 条件限制。OpenAI 普通 EOF 已有异常，不能把所有 EOF 都报告为新增缺口；Claude 缺 terminal 及其他真实失效路径仍须分别红测证实。Desktop legacy 当前 catch 会 historySnip，补充方案已明确区分新完整性失败与原网络 fallback。
- 本次所读主要文件 SHA256：CompactRunner `97e57eea1fefb67a895631ab0ff2f4240a91b0a2423b47b9e461782a374c16eb`；Claude `f9f4c365218b82565c442fe7c7cdbb921d4bf757a10733b310b8e93439cd6978`；OpenAI `0e6dfed91450c046ea3dabd58f801c9ca7f884c994043b247e4e94616a1ce22b`；Responses `8cf8ae3f30be830ccefc140aeff0827e86f13e54544888b37c007934beca80e0`；Desktop context-manager `f2568321a1514585129a2f8cdbc96e173ed8cdb93da7c2debb61ee881fcde7dd`。未混用 U/C 文件或行号。

## 必改阻断及最小修订

无。

本批压缩完整性修复符合父 v3 “实际把失败误报成成功”的独立 P1 准入方向，无需虚构完整 wire 容量资格或缓存性能收益。先通过真实 adapter → provider wrapper → CompactRunner 的受控 SDK/HTTP 回归证实缺口，再修改生产代码，是明确且可执行的准入；本票不声称红测已经运行。

P2 缺真实访问 trace，维持 unknown 并停止缓存改动，符合父方案。50 个实际任务且全部 completed 不能替代浏览/活跃订阅分布与 holdout，补充没有作此替代。预算资格在 master 缺完整契约，维持 qualification_unknown，未以名称推断窗口制造超限事实。正确性缺口不适用“性能不足 5% 不做”的性能准入门；缓存门仍保留。

新契约只在摘要消费者启用，原普通对话、工具流、strict Kimi 授权和显式 output limit 行为保留；无新增 durable owner、schema 或全局故障封闭服务。真实截断不得安装局部摘要、CLI 保留确定性 fallback，usage/迟到异常/取消继续排干与结算现有事实，这些要求没有因范围收窄而删除。

当前版本进一步保留 legacy Desktop 的完整空白 no-op，且已有 chunks 后的迟到原错误/取消及不完整响应拒绝而不 snip；只有未收 chunk 的原网络等请求异常保留既有 snip。这项细分避免完整性失败又落入原 catch 从而删除历史，符合补充的最小修复目的。

完成边界明确将完整预算门、缓存、P3 新协议及 U/C 待集成能力列为未完成；真实 provider、Windows/ASAR/安装包和日用入口不由单测冒充。父验收继续待验，属于合法分批，不等于全案完成或发布资格。

## 非阻断建议

最终验收报告按每个真实 adapter 列出红测触发条件、修复后结果与调用次数，区别已有拒绝路径、新修复路径及未覆盖路径；不将 OpenAI 已有 EOF 拒绝计为新增收益。System One 无终态字段时的完整 JSON、空正文和工具响应，可通过其真实 HTTP adapter 加最小回归，确认共享 collector 的兼容性。

## 最终票

对 SHA256 `3d883cdd658bfbfdadac4bea28dc4e0d80e253ae121d8a38ff7f9fc74f3a33f8`：**APPROVE**。

仅批准该实施补充进入其明确的红测与最小实现流程；不代替最终源码、完整 HEAD、真实运行入口或发布产物验收，不宣称父方案全部完成。
