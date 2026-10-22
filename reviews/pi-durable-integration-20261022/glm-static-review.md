实际模型：GLM-5.3；静态附件评审，未执行测试。

## 独立评审结论：APPROVE（无阻断必改项）

以下仅基于附件材料（转引的 diff 与文件内容，未运行任何工具或测试）。

### 核心变更是否成立

**1. empty → `settled`（semantic-compaction-owner.ts:156）——成立，无伪造。**

- `collectCompactionResponse`（compaction-response.ts:22-42）的检查顺序保证：`empty` 抛出前必然已通过 `failure` 检查与 `!terminal` 检查。即 empty 隐含：流已完全排干、有 terminal、无 tool_use、无 terminal 后追加内容。此时 transport 事实确实已知，“settled” 是诚实的结算，不是把 unknown 洗白。
- 结算为 settled 不会产生 commit：commit 只在 `applySemanticPlan` 成功路径经 `commitSemanticSummarySnapshot` 写入（owner.ts:170），empty 在 summarizePrefix 即 throw（owner.ts:157），永远到不了 commit。`commitSemanticCompaction`（ledger.ts:136-142）虽然只校验 reservation status==='settled'，但 commit 事实的写入入口唯一，无伪造路径。
- 无退款：ledger.ts:73-76 对同一 grantId 的所有 reservation（含 cancelled/unknown）计费，empty→settled 不复活预算。测试 155-165 行验证 charged 后第二次 run 得 `summary_budget_exhausted`，且 ledger 不变。
- 删除 census（compound-deletion-census.ts:25）只放行 `settled|cancelled_before_dispatch`；若 empty 结算为 unknown，由于 transitions（ledger.ts:32）中 `unknown` 是终态，删除会被永久阻断。settled 恰好解锁删除且不扩大任何权限。修复方向正确。

**2. 其他终态失败 → unknown、取消优先、结算失败传播——与原语义一致。**

- owner.ts:156 `if(!input.signal.aborted)` 保持取消优先，abort 不做结算。
- `settle` 内部失败置 `persistenceFailed` 并在 owner.ts:175 重新抛出，传播保持。
- throw 本身继续向上（owner.ts:157），零 summary commit、不退款、不重发，与描述一致。

**3. collector 本身——正确。**

- 排干原流（含 late error/usage）后才校验，符合“先排干再安装”的注释。
- `content_after_terminal` 捕获 done 后追加内容；`unexpected_tool` 捕获工具调用；`missing_terminal` 捕获截断/EOF。测试场景（truncated/missing-terminal/late-error/tool-response）断言为 `unknown` 并阻断删除（test 149、161），轨迹自洽。
- Abort 三处 `throwIfAborted`，abort 永远以 AbortError 优先于 CompactionResponseError 抛出，不会把取消误分类为失败。

### 建议（非必改）

1. `Failure` 联合类型中的 `'provider_incomplete'`（compaction-response.ts:3）在 collector 中没有任何赋值路径，是死成员；若它对应 adapter 层抛出的错误，应删除或注明来源。
2. `CompactRunner` 被非 semantic（threshold/native_failure）路径共用。此补丁后，原来“截断但静默提交部分摘要”的行为变为 throw 并落入 `applyPlan(plan, undefined)` 兜底（portable-compaction-executor.ts:119-131）。这是收紧而非放松，方向安全，但属于超出 PR74 最小范围的行为变化，建议在 PR 描述中说明并确认 threshold 路径对 `undefined` summary 的处理有测试覆盖。
3. `onProgress` 现在跳过 usage chunk（compaction-response.ts:27），如果 onProgress 曾被用作“有心跳”信号，usage-only 阶段不再触发，影响极小。

### 未核实项

- 修复后全 17 项回归“进行中”，我没有运行也未见到通过结果，不能视为已验证。
- `requireCompleteResponse: true` 的 adapter 侧行为、`finishSemanticSummaryAttempt` 的 CAS 实现未随附件提供，以上按注释与调用契约采信（转引、未核实）。

**结论：APPROVE。** empty→settled 的分类依据（排干+terminal+无失败）在代码中可验证成立，且不引入披露、预算或删除所有权的扩张；无阻断缺陷。
