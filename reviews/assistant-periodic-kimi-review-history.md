# P3 independent review evidence

Author: Codex GPT-6. Reviewer: Kimi CLI kimi-code/k3. Static review only; no claimed reviewer test execution. Final APPROVE applies to CLOSED code seams, not real provider/quality/pilot acceptance.

## p3-runtime

# 独立评审结论（Kimi，评审者；Codex GPT-6 代码）

**裁定：BLOCK**（无 P0 —— 生产 CLOSED、默认关闭、无 provider/token 安装，攻击面未激活；但有 5 个 P1 必须在 pilot 启用前修复）

已核实的设计优点（不计入问题）：attempt 状态机（reserved→sent→settled）+ run 绑定在同一 BEGIN IMMEDIATE 事务内，durable no-resend 成立；budget 逻辑时钟取 max(stored, observed) 抗回拨；`current()` 在 LLM 调用后、publish 前重检 readiness/policy/profile/globalEnabled，中途吊销能阻断发布；`check()` 只放行 user/scheduler，agent 被拒；reserve 时即按全额预扣，usage 超限有 contract_breach 兜底。

## P1-1：provider/IO 挂起会永久楔死 runtime（并发 + 可用性）

`assistant-periodic-runtime.ts` 中 `port.complete`、`collect`、`publish` 只通过 `AbortSignal.timeout(60000)` / `input.signal` 传取消，**没有 Promise 层硬超时**。若 port 实现不响应 signal（bug、流挂起），`perform` 的 Promise 永不 settle → `this.active` 永不清除 → 后续所有 scheduler 检查返回 `busy`、queuedManual 永不执行、`close()` 的 `this.active?.work.then(...)` 永不 resolve。

**修复**：对三个 await 统一包一层不可取消的超时竞速：

```ts
const raced=<T>(p:Promise<T>,ms:number,label:string)=>Promise.race([p,new Promise<never>((_,no)=>setTimeout(()=>no(Error(label)),ms))]);
const output=await raced(port.complete({...}),70000,'analysis_deadline');
```

并在 `finish` 外加兜底：active 超过 lease（30min）未 settle 时强制清 `active` 并按 failure 关闭 run。

## P1-2：reserve 与 settle 之间崩溃 → 该 occurrence 永久楔死（durable no-resend 过度）

崩溃后 attempt 停在 `reserved`：重试时 `perform` 放行（`previous.state==='reserved'`），但 `reserveForRun` 命中 `assistant_analysis_runs` 旧 run_id → `assistant_analysis_run_conflict`；即使清掉 run 绑定，`sendAssistantAnalysis` 的 `now-old.logicalAt>600000` → `reservation_expired`。该 occurrence 永远 `outcome_unknown`，无任何恢复路径。`reserved` 状态**从未发给 provider**，拒绝重试不服务于 no-resend 目标。

**修复**：在同一事务内允许 `state==='reserved'`（未发送）的 attempt 换绑新 run 并以原参数重新 reserve（参数一致即幂等）；或 attemptId 派生加 retry epoch，仅当旧 attempt `state==='reserved'` 时允许。`sent`/`settled` 保持永久拒绝不变。

## P1-3：user 手动检查被硬编码记为 `scheduler`（审计归属伪造 + 预算 DoS）

`perform` 中 `reserveForRun({...requestSource:'scheduler'},runId)` 与 `sentForRun`/`settle` 全部硬编码。后果：(1) budget 台账把用户触发的调用伪记为 scheduler，来源审计失效（而 `source()` 本身允许 user，说明设计意图是区分的）；(2) 手动与定时共享 6 次/24h 全局窗口，用户侧（或被诱导的 UI 入口）连点即可耗尽当天定时检查额度。

**修复**：三处改为 `requestSource:input.requestSource`；并在 `reserveAssistantAnalysis` 按来源分桶计数，或对手动来源设更低上限（如 2 次/24h）。

## P1-4：质量门槛用点估计，Wilson 区间算了不用（qualification 统计效力）

`evaluateAssistantQuality` 计算了 `proportion` 的 lower/upper，但 passed 判定用 `precision.value>=.9`、`recall.value>=.95`、`unknown.value<=.1`。n=100、needsAction=30 时 recall 点估计 0.95 的 Wilson 下界约 0.83 —— 即真实召回 0.85 的 pipeline 也有不小概率"通过独立评估"。qualification token 是整个 LLM 通路的唯一启用门槛，点估计使其显著弱于声明的标准。

**修复**：改为 `precision.lower>=0.9 && recall.lower>=0.95 && unknown.upper<=0.1`，并据此反推最小样本量（当前 `sampleSize` 下限 100 在下界判据下不够，需提高到满足下界的最小 n，写进 schema 校验）。

## P1-5：qualification token 无有效期执行（吊销缺口）

`binding.window.{from,to}` 仅在 issuance 时校验 `to>from`，之后 `readAssistantQualityQualification` 只比对 binding 相等性。评估窗口过期后 token 依然有效；只有 grantEpoch/binding 变更才吊销。窗口语义因此是装饰。

**修复**：`readAssistantQualityQualification(token,currentBinding,now)` 增加 `now>=binding.window.from && now<=binding.window.to`（now 由 main 注入，不可用 token 自带数据）；另建议加最大有效期上限（如 90 天）强制周期性复评。

## P2（记录，不阻断）

- `reserveAssistantAnalysis` 每次全表扫描 + JSON.parse，且 attempts 表永不清理 —— O(N) 随历史增长；加 `logical_at` 索引并只取 24h 窗口行。
- `check()` 中第二个 manual 请求静默搭车既有 `queuedManual`，拿到的是**别人 occurrenceId** 的 runId；应在 occurrenceId 不同且已有排队时返回 `{status:'skipped',reason:'busy'}`。
- `withinWorkingHours` 对非法 `policy.timeZone` 抛 RangeError，且调用点在 try 之外 → check() 以裸 rejection 暴露；构造 policy 时校验 timeZone 或此处 try/catch 转为 `{status:'blocked'}`。
- `settle` 幂等比对 `JSON.stringify(usage)` 对 key 顺序敏感，重试同值不同序会误报 `settlement_conflict`；改为规范化比较。
- `current()` 用 `JSON.stringify(policy.status())` 全量比对，若 status 含易变字段（时间戳/lastRun）会假性 `source_stale`；确认 policy.status() 字段稳定性。
- `runner()` 的 `captureLoopRunContext(context!)` 非空断言：context 缺失时变裸 rejection，应显式返回 skipped。
- LLM 输出的 `action.instruction` 是注入面下游：validate 后仍须由 UI 按不可信提案渲染并限制长度，不得进入任何自动执行路径（此处无法核实下游，转列）。
- 残余已接受风险（声明即可）：`issueAssistantQualityQualification` 无密钥，main 内任何代码可用合成数据铸 token —— "真实独立评估"纯靠流程保证，代码无法区分；逻辑时钟前进（改系统时间）可重置 24h 预算窗口，但受害者是用户自己，可接受。

P1-1/2/3 修 runtime 与 budget，P1-4/5 修 qualification；全部修复并完成对抗性复审前，不得安装真实 token 或启用 pilot。

Source SHA256 manifest:

```json
{
  "desktop/electron/assistant-periodic-runtime.ts": "f08fa915886a641a242dea4fd183f5b8649a491bf62466d7af396b49829cae01",
  "desktop/electron/assistant-analysis-budget.ts": "484bee2b9f8ef67e157af41b71e3de04bd23186e419ea417f5e55a08a9a33dad",
  "src/runtime/assistant/quality-qualification.ts": "90f20fab89749ff489c1c64a75767f346a63207343fdf6d4097b972cba597479",
  "src/runtime/assistant/analysis-port.ts": "8f6df201619525c5c58ac8e96da0ac033305a687ae8572da908755390c2f9242"
}
```

Process completion: {"exitCode": 0, "timedOut": false}

## p3-notification

# Independent Review — Assistant Periodic Digest

**Verdict: BLOCK** — no P0, two P1s. The qualification/deny-by-default posture, fixed-owner facts re-read, monotone logical clock, and claim-before-notify ordering are sound. Two durability/revocation holes remain.

---

## P1-1 — Ledger burn via unvalidated `runId` in `prepareAssistantDigest` (durable no-resend subverted)

`prepareDigest` accepts `requestSource: 'user'`, and `prepareAssistantDigest` writes `assistant_notification_revision_ledger` rows for any caller-supplied `runId` + revisions that pass only the 64-hex format check. Nothing verifies the run exists. The activity-owner gate (`readAssistantDigestFacts`) then requires `assistant_source_runs` / `loop_runs` rows and `originRunId` matches for that `runId` — a fabricated or stale `runId` can never satisfy that, so the delivery is suppressed as `stale_policy` **forever**, while the ledger rows are already committed. Result: those real `(workItemIdentity, notifiableRevision)` pairs are permanently marked notified and will never be digested again — silent, durable notification loss, triggerable from the user/IPC path without any producer credential.

**Exact fix** — validate the source run inside the same transaction before any ledger/delivery write, in `prepareAssistantDigest` after the policy gate:

```ts
const source=db.prepare("SELECT 1 FROM assistant_source_runs WHERE run_id=? AND profile_id=? AND analysis_status='complete'")
  .get(input.runId, policy.profileId);
if(!source) throw Error('assistant_digest_source_unknown');
```

(Defense-in-depth alternative: defer ledger inserts to the first successful dispatch claim instead of prepare time. Do at least the existence check.)

## P1-2 — Revocation does not reach the OS-notify gate

The authoritative gate on the only OS-notify path — `assistantNotificationSuppression` + `readAssistantDigestFacts` — never consults live `qualification()`. It only checks the digests **stored in the policy row**. After quality-token revocation, those stored digests remain until a user re-runs `configure`, so suppression depends entirely on `syncSchedule` having run to pause the loop (facts then fail via `loopActive`). Nothing in the reviewed code guarantees `syncSchedule` fires on revocation, and even if it does, there is a window where queued/claimed digests still notify against a revoked token. `dispatchDigest` checks live qualification; the owner gate must too — a gate that two paths enforce differently is not a gate.

**Exact fix** — thread the trusted qualification snapshot (from the fixed main service, never IPC) into the facts read and check it in suppression:

```ts
// readAssistantFacts signature: (dataRoot, raw, qualification: {qualityDigest:string;analysisContract:string}|undefined)
const qualificationCurrent=!!qualification
  &&qualification.qualityDigest===policy.qualityDigest
  &&qualification.analysisContract===policy.analysisContract;
// expose as facts.qualificationCurrent
```

```ts
// assistantNotificationSuppression, before quiet-hours:
if(!facts.qualificationCurrent) return 'stale_policy';
```

Fail-closed: absent qualification ⇒ suppression, matching the production-CLOSED default.

---

## P2 (fix before or shortly after pilot, not blocking)

- **Quiet-hours footgun** (`notification-policy.ts`): `start===end` is treated as 24h quiet — the common "00:00–00:00 = off" convention silently disables all digests while the policy reads enabled. Reject `start===end` in `assistantPeriodicPolicySchema` via `.refine`, or define it as no-quiet.
- **Unvalidated casts** (`digest-receipts.ts`): `getAssistantDigestReceipt`/`claimAssistantDigest` return `JSON.parse(...) as AssistantDigestReceipt` without zod parsing, unlike every other read path. Parse with `assistantDigestReceiptSchema` (fail-closed on corrupt row).
- **Budget accounting**: suppressed deliveries (including quiet-hours suppression) consume the 2-per-24h / 4h-gap slots, since budget counts `committed_at` at prepare. With quiet hours 22:00–08:00 and 2 slots/day, a quiet-hours suppression can starve the day. Deliberate fail-closed is acceptable, but state it in the design doc or exclude `suppressed(quiet_hours)` rows from the count.
- **`dispatchDigest` recursion** on failed claim: terminates today only because `dispatch_state` has exactly two values. Replace with a loop so a third state can't become unbounded recursion.
- **`enqueueAssistantDigest`** catch path returns `getAssistantDigestReceipt(...)!` — the non-null assertion can return `undefined` against the typed contract; return `suppressed('platform_unavailable')` or throw instead.
- **Split-brain watch item (not a finding given the stated wiring)**: `assistant_digest_deliveries.dispatch_state` and `assistant_digest_receipts` are two independent claim domains, and `enqueueAssistantDigest` does not check `dispatch_state`. This is safe only while `delivery.send` provably routes through the activity owner's claim. Pin that with a contract test asserting the service's `delivery` adapter is the owner path, so a future refactor can't open a double-send.

## Passes

- **Concurrency**: BEGIN IMMEDIATE serialization of prepare/budget, atomic CAS on `dispatch_state='pending'`, claim-before-notify with crash-leaves-unknown recovery, facts re-read after claim (TOCTOU mitigation), no await between policy gate and OS call in the owner.
- **Durable no-resend**: `source_run_id UNIQUE` idempotent prepare, receipts monotonic (`unknown`→terminal, conflict on divergence), recovery does `lookup` rather than blind re-ring.
- **Clock**: monotone `logical_now`, clock rollback cannot extend budget.
- **Privacy**: envelope carries only 64-hex identities; no calendar bodies, no writes; facts read is read-only/immutable against the fixed data root with no caller-supplied SQL or path; WAL-without-SHM refusal is a correct anti-stale-read guard.
- **Authorization**: `requestSource` checks on every mutation entry; IPC cannot supply qualification/clock/actor; schema validation is strict throughout the IPC-facing surfaces.

Re-review after P1-1 and P1-2 land with the ledger-burn and post-revocation regression tests.

Source SHA256 manifest:

```json
{
  "desktop/electron/assistant-periodic-policy.ts": "de8dce35a5a1420f77857c1c46edbd9d0c739a5da0170a7f2ffcfe91b4e58bd2",
  "src/runtime/assistant/digest-facts.ts": "8e8db9f9ac485dcf76190d680469884ad6f37da51a884cc71445f45b76a2c69a",
  "src/runtime/assistant/digest-receipts.ts": "8dc2492aa05e7725e02c99d187fb4ed840bbc30f89ba7930bcde3cd18f50ed94",
  "src/runtime/assistant/notification-policy.ts": "29ac4b2dd703eeb760fd786388205ef68aad377414e55ed2128d2c0da485db78"
}
```

Process completion: {"exitCode": 0, "timedOut": false}
