# 独立席 B：压缩完成边界实施补充评审

日期：2026-10-21。仅评实施设计，不沿用父 v3 票，不表示代码实现或最终 HEAD 已验收。未读其他席意见。

## 快照与证据

已完整阅读最终 `reviews/pi-durable-optimization-implementation.md`，实算 SHA256：

`3d883cdd658bfbfdadac4bea28dc4e0d80e253ae121d8a38ff7f9fc74f3a33f8`

与本轮最新指定值一致。此前指定的 `cfb387...` 文本不是本票对象。

只读核验 worktree `$WORKTREE`，HEAD 为 `dc221f9bac84d939b8fb543d4795396693fdc9b8`，无 `.codegraph/`，未创建索引。当前尚无生产代码变更，本票不能代替实现后的独立源码审查。

已读相关实际源码与既有测试：

- `src/ai/runtime/compact-runner.ts` 全文；`portable-compaction-executor.ts` 全文；`agent-runtime.ts` 压缩调用及事件路径；`session.ts` plan/apply/revision 检查，`usage.ts` compaction/fallback 相关实现。
- `provider-conversation-authorization.ts` 全文及五种 wrapper/strict authorization 透传；`model-capabilities.ts` StreamOptions 契约。
- Claude 的 message_delta/message_stop；OpenAI legacy finish_reason、EOF、usage、SDK iterator 路径；Responses 请求/状态/usage；System One 请求、JSON、usage 与 done 路径。
- `desktop/electron/context-manager.ts` 全文及 compactConversation 调用点搜索；当前运行源码只发现 import，没有实际调用。
- CompactRunner、portable executor 的 abort/fallback/原错误脱敏测试；legacy Desktop 成功、网络 snip、空白 no-op 测试。

未触碰用户历史、缓存或数据库；未运行模型、产品测试或安装包验证。只写本票文件。

## 必改阻断

**无。** 当前新 SHA 的实施范围与 durable/取消/回退约束没有发现阻断性矛盾。

1. **局部摘要不能替换历史。** 现有 CompactRunner 仅聚合 text，adapter 的默认长度截断可被误当成功。补充第2–5条要求完整终态、无工具、完整排干后才返回文本；失败交给现有 portable executor，不能把已收到的半截文本作为 summaryText。现有 executor 克隆待总结前缀，并在 summary resolve/catch 后检查 abort；Session apply 仍检查 sourceRevision/sourceMessageCount，no_gain/stale/invalid 保持原契约。因此本批没有要求绕过原计划安装检查，也不需要新的 durable owner。
2. **取消优先于 fallback。** 真正取消时不能安装模型摘要，亦不能利用 summary failure 的确定性 fallback 安装变更。现有 executor 的 signal 检查及 AbortError 重抛已经支持这条边界；新 collector 的 done 后继续消费不能削弱它。保留原 signal/option 字段和 abort-after-done 回归是可执行约束。
3. **late usage/错误不能被 done 截断。** OpenAI 普通路径当前在 finish_reason 后 return，严格摘要路径改为排干原 iterator、使用原 timeout/abort，不创建后台 drain。Responses 失败状态须先保留已知 payload usage；Claude 保留实际 usage 后再验证终态。补充明确不编造缺失 usage、不声称新增 U 的结算 ledger；该范围诚实且不会批准 unknown 重放或自动重派。
4. **legacy Desktop 的 catch 不能把新验证失败改成 historySnip。** 当前 catch 是通用 snip；新 SHA 第6条明确：collector 不完整、收到 chunks 后迟到错误/取消拒绝且不改原历史，仅未收到任何 chunk 的旧网络类异常保留旧 snip；完整空白继续 no-op。此分类可实施，且解决了把局部输出错误落进旧 fallback 的风险。应以 messages 原字节不变验证拒绝路径，而不是只检查没有 boundary。
5. **strict authorization 不因新选项降级。** 新字段是内部响应契约；补充要求保留原选项且不修改调用方对象，五个 wrapper 继续传递，普通对话、工具和记忆不自动启用。没有授权改变 Kimi durable resume/授权、请求 body 或工具副作用规则。

## P0 / P2 / P3 边界

P2 维持 unknown 正当：文件数量与字节数只能说明持久数据规模，不能提供真实浏览、订阅、多窗口访问分布或独立 holdout。当前不改缓存、Host pin 或生命周期，符合父方案收益不足/资格未知不实施的停止门，不能用合成 workload 强行准入。

完整 wire 预算门维持 qualification_unknown 正当：本基线缺少完整 serialized request 上界/default-output/multimodal 资格契约。以默认截断被误当成功作为独立 P1 缺口，与“无证据不加容量门”不冲突；仍需先调用实际 adapter/CompactRunner 做受控截断失败回归，再最小修改。

P3 只审计可信读取/故障归属，发现缺陷另写修订。没有预先批准全局 SessionFailed、扩大故障域、迁移 schema、清用户数据或恢复重放。U/C 未合并机制保持待集成，不能算本基线通过；源码/本地测试也不能算 Windows 安装包或日用入口验收。

## 非阻断建议

后续 Desktop 回归显式加“第一个 chunk 前 signal 已取消/取消发生”和“仅收到 usage 后抛原错误”两例：取消应拒绝且不 snip，usage 也属于已经收到的 chunk。这样能防止实现按 `text.length === 0` 错判为可执行旧网络 snip。该要求是当前 signal 优先与 any-chunk 分类的测试具体化，不是本票附加许可条件。

## 当前票

**APPROVE** — 针对 SHA256 `3d883cdd658bfbfdadac4bea28dc4e0d80e253ae121d8a38ff7f9fc74f3a33f8`。

批准按该补充推进限定的受控复现与完整性子批实现；P2、完整预算门、P3 新故障协议仍未获实施准入。最终代码、实际回归及完整 HEAD 必须另行验收。
