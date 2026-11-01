# 最终接线增量独立复审

编码模型 Codex GPT-6；独立评审 Kimi CLI 2.2.0，配置别名 `kimi-code/k3`（实际模型 k3）。评审为静态源码审查，没有声称由评审模型执行测试。本文件增量票与先前 launch/transport/coverage/periodic 票共同使用，不代表真实人工质量或交办试点通过。

## 实际账本与独立通知事实

原始票：`/tmp/openduet-launch-review-20261101/budget-facts-final-output.jsonl`；完成元数据：`/tmp/openduet-launch-review-20261101/budget-facts-final-completion.json`。

当前源码漂移：[]。

- `src/runtime/assistant/digest-facts.ts` SHA256 `23c31d65d904cb1d5e48040394bf26bdc710edad85f5d48e67723e954e4d4599`
- `desktop/electron/assistant-analysis-budget.ts` SHA256 `b9bd927ea517570e1bde5c668dc0072b90668cb2e53b3766abf0b64f8bf1b086`

**结论：APPROVE**（基于所供两份文件的实现级评审；未验证的边界在文末明确列出，不作为已核实事实）。

**声明项核验（均属实）**
- `budgetAdmitted` 确由持久台账派生：`digest-facts.ts` 经 `assistant_analysis_runs JOIN assistant_analysis_attempts` 按 `intent.source_run_id` 取 attempt，要求 `state==='settled'`、token 安全整数、`input<=48000`/`output<=6000`、`providerContract===policy.analysisContract`、`charged<=reserved`，且 slots 窗口 1..2/24h、4h 不重叠。与 reserve 侧窗口上限一致。
- 超收 breach：`settleAssistantAnalysis` 按实际 usage 记账（unknown 按全额预留），`reserveAssistantAnalysis` 扫描全部 attempt，`chargedInput>inputTokens` 即 `assistant_budget_provider_breach` 永久阻断后续预留。方向 fail-safe。
- 授权：`source()` 仅放行 `user|scheduler`，`agent` default deny；`assertAnalysisRun` 绑定 loop 白名单 + `status='running'` + `active_run_id` 一致性；`attempt↔run` 冲突检查存在。幂等重试与 occurrence UNIQUE 处理正确。
- 时钟：`clock()` 取 max 防回拨，窗口无法靠过去时间重置。

**非阻断发现（P2，建议修复，不构成 BLOCK）**

1. `digest-facts.ts` `budgetAdmitted` 的滚动窗口锚定 `intent.committed_at`，仅查 `Number.isSafeInteger`，未与读取时刻 `now` 比对。若 delivery 行写入方可控 `committed_at`，选取 30 天前的时间戳可使窗口内只有自己（slots=1、无 overlap）绕过限频。当前写入方为 main 可信路径故不阻断；建议加 `committedAt<=now+5min && committedAt>=now-24h`。修复位置：`const committedAt=Number(intent.committed_at);` 后一行。

2. `assistant-analysis-budget.ts` 顶层导出的 `reserveAssistantAnalysis` 等裸函数接受外部 `now`；逻辑钟取 max 意味着单次未来时间戳（>24h）会让 `recent` 清空、窗口重置。所供 class 用 `Date.now` 注入是安全的，但裸导出不得经 IPC 暴露给 renderer/scheduler 入参。此为调用点约束，非本文件漏洞。

3. `digest-facts.ts` 未校验 `intent.profile_id===envelope.profileId`（`SELECT *` 取到但未比对），跨 profile 混淆仅靠 scope_hash 与 source run 的 profile_id 查询间接挡住；建议显式比对一行。

4. `settle` 对 usage 无上界校验：超报由 breach 兜底（已覆盖）；低报本地不可检测，属 provider 诚实假设，建议文档化为残余风险。

5. `state==='sent'` 未 settle 的 attempt 占窗口位 24h（轻量 DoS）；slots 计数包含未被 admit 的 delivery 行。均为 main-only 写入面，低危。

6. scope_hash 用 `JSON.stringify(JSON.parse(...))` 非规范序列化，依赖写入方键序一致；失配方向 fail-closed，可利用性无。

**明确未验证（不断言）**：LoopStore 事务封装、IPC/preload 暴露面、WeakMap qualification 校验器、`readCurrentAssistantQualityAssessment`/`readInstalledCurrentOwner` 实现、committed_at 写入路径。以上均不在所供文件内，本评审不对其作"安全"结论；若后续文件显示裸函数或 `now`/`committed_at` 被 renderer 入参直达，第 1、2 条升级为 P1 需重审。

准确率/人工标注相关表述与"两阶段风险+action review、无准确率声明"一致，未发现越界声称。

## 人工评估组合与保守错误计费

原始票：`/tmp/openduet-launch-review-20261101/quality-product-usage-delta-output.jsonl`；完成元数据：`/tmp/openduet-launch-review-20261101/quality-product-usage-delta-completion.json`。

当前源码漂移：[]。

- `desktop/electron/assistant-quality-product.ts` SHA256 `f7b9860d1e33e82fa0143f25c4cfb6c68989a8f2f6ca5fcd64a55a9a363f300d`
- `desktop/electron/assistant-quality-predictions.ts` SHA256 `2eaaa7fc2eaaffbe1553a7c5d709f31dd083c006b7bd955709e5cba439d88009`
- `desktop/electron/assistant-analysis-budget.ts` SHA256 `b9bd927ea517570e1bde5c668dc0072b90668cb2e53b3766abf0b64f8bf1b086`
- `desktop/tests/main/assistant-quality-predictions.test.ts` SHA256 `b034beb97925ce8f16bce804ee7ca89c1b1352fc15b13397980f2b4f9eb8fe09`

# 独立安全评审结论（Kimi k3 评审，作者 Codex GPT-6)

**裁定：APPROVE** — 本 composition delta 内未发现实际可利用的 P0/P1。

## 上一轮 P1 复核（settle 污染）

确认不成立。`assistant-analysis-budget.ts` 的 `settleAssistantAnalysis` 在任何写库前先校验 `Number.isSafeInteger && >=0`，非法 usage 抛 `assistant_budget_usage`,write 未执行；且 predictions 中 `budget.settle(...)` 抛错时 `settled` 仍为 false,catch 分支以 `'unknown'` 重 settle，落账为全额预留（测试 3 断言 chargedInput=100/chargedOutput=1000，与代码路径一致）。无 NaN/负数落账路径。

## 本轮修复逐项核验

1. **任意 error.usage 零值少收** — 已修复。catch 中仅当 `error.code==='ASSISTANT_ANALYSIS_PROVIDER_CONTRACT_BREACH' && 'usage' in error` 才取数值 usage，否则 `'unknown'` 全额计费；且该数值仍过 settle 的 safeInteger 校验，畸形时降级 unknown（双层 try/catch)。测试 2(transport failure 带 `usage:{0,0}`）断言落账 100/1000，路径一致。
2. **超标 usage 按实际计费并持久封禁** — 符合 parent 要求。成功路径先 `settle(usage: output.usage)`（无 cap，按实际），再抛 `budget_breach`;`reserveAssistantAnalysis` 的 `all.some(charged>reserved)` 检查使后续预留永久 fail-closed，封禁持久化于 attempts 表，符合「charged ACTUAL then durable blocked」。
3. **budgetAdmitted 硬编码** — 本 delta 中预算准入全部由 durable ledger(reserve/send/settle 状态机 + 滚动窗口 + breach 检测）派生，未见硬编码放行。
4. **导出 singleflight** — `exporting` 标志覆盖整个 async 体，并发导出抛 `assistant_quality_export_busy`，不再返回错误 run。
5. **requestSource** — budget `source()` 显式拒绝 `'agent'`，仅 user/scheduler；符合 default deny。

## 残留观察（P2，不阻塞）

- **重试死锁**：transient 失败（如第 3/6 批网络错误）后，deterministic attemptId + `already_sent` 检查使同 digest 的 `recordPredictions` 永久无法重试，需 workflow 重新 freeze 换 digest 才能恢复。属可用性权衡（防重放），建议 workflow 侧确认有 re-freeze 路径。
- **预留泄漏**：reserve 后 crash(state='reserved'）的 attempt 永久占位 attemptId,24h 逻辑窗口后不再计费但 ID 不可复用。保守方向，可接受。
- **settlement 冲突假阳性**:`JSON.stringify(usage)` 对 key 顺序敏感，provider 重试时键序不同会误报 `settlement_conflict`。概率低，影响限于该 attempt。
- **breach 封禁无恢复通道**：一旦发生 `charged>reserved`，本产品内无任何解除路径，质量预测永久关闭。fail-closed 可接受，但应在产品文档中明示。
- `quality().currentBinding()` 闭包返回 ready 快照，失效后可能返回陈旧 binding；校验语义属 workflow（未提供），按指示不就未提供边界下结论。

## 边界声明

仅评审了所提供的 4 个文件构成的 delta;workflow、population、analysis port 等 owner 实现未提供，未核验、不声称其已验证。测试红绿日志（/tmp/openduet-review-20261101/) 按作者陈述采信，未独立重跑。

## 裁决记录

旧 composition 票缺少 settle 实现，把 NaN/负 usage 未校验判为 P1；实际 helper 写库前验证 safe integer/非负，抛错发生在 settled=true 之前。新票含完整 helper 和实际测试后更正。没有采用把超额实际计费截断至预留量的建议，避免反而少记真实成本。有效发现“任意 error.usage 零值少收”已先红后绿修复；只有明确 native contract-breach code 取实际数值，其余 unknown 全额预留。

重复手工检查不同 occurrence 在一个已排队刷新之后显式 busy，不把另一个 run 错挂给调用者；真实 provider promise 完全归属既有 owner，abort 不提前释放。native breach 在账本中按实际收费，后续 reserve 持久阻断。评估中途未知失败不重发同 digest，用户可废弃本轮后重新导出风险包，已有共享预算不清零。
