# 周期检查最终独立复审

作者 Codex GPT-6；独立评审 Kimi k3。初审原票和裁决见 [初审历史](assistant-periodic-kimi-review-history.md)。以下为原限域接缝最终复审，不替代后续真实 provider/人工流程接线增量票。

## p3-final-runtime

# 独立安全/设计评审结论：APPROVE

对四个文件（`assistant-periodic-runtime.ts`、`assistant-analysis-budget.ts`、`quality-qualification.ts`、`analysis-port.ts`）做了并发、撤销、持久 no-resend、预算、隐私五个维度的代码级审查。**未发现残余 P0/P1**。以下是逐项核验与仅存的 P2 级观察。

## 前次 BLOCK 修复核验（代码证据）

**同一事务源记录 + 写入前检查运行存在**：`commitOrdinaryAssistantCheck` 在任何写入前先校验 `getLoopRun(runId).loopId===ASSISTANT_CHECK_LOOP_ID` 且无 `getLoopRunPublicationBasis`；预算 run helper 经 `assertAnalysisRun`（`assistant-analysis-budget.ts` 中校验 loop_id、status==='running'、active_run_id 一致）才允许 reserve/sent。发布后经 `getLoopRun(runId)?.status!=='success'` 复核，失败即抛。✓

**只读 facts 回调缺省即不合格**：`readiness()` 中 `this.options.quality&&readAssistantQualityQualification(...)` —— quality 未注入时短路为 falsy，返回 `quality_unverified`；`current()` 闭包内含 `this.readiness().available`，运行中途撤销 qualification 会使 `current()` 变 false，发布路径在 `commitOrdinaryAssistantCheck` 首行 `isCurrent()` 处 fail-closed。生产无 provider ⇒ 永远无法走到 publish，封闭 seam 成立。✓

**损坏 receipt 严格解析**：`dataSchema.parse(raw)` 全 strict，binding 亦 `.strict()`；`readAssistantQualityQualification` 对 `currentBinding` 重新 parse 并做 JSON 深等比较，任何篡改/变形返回 undefined。✓

## 父级裁决逐条核验

1. **不抛弃存活物理工作**：`check()` 中 `this.active` 同步赋值且单线程无交错窗口；`close()` 返回 `this.active.work` 等待其 settle；provider 收到 `AbortSignal.any([lifetime, abort, input.signal, timeout(60000)])`（deadline+abort 齐备）。挂起的 provider 使该 occurrence 永久 `outcome_unknown`，无第二并发请求 —— 可用性限制已文档化，非授权绕过。✓
2. **reserved 崩溃 fail-closed**：崩溃后 `budget.read(attemptId)` 返回 `state==='reserved'` → `blocked/analysis_unavailable`；`sent` 后崩溃 → `attempt_already_sent`。无自动重发/重绑定，预算保留。`sendAssistantAnalysis` 的 10 分钟预留过期同样使尝试永久卡在 reserved —— 保守方向正确。✓
3. **来源透传**：`reserveForRun/sentForRun/settle` 均携带 `input.requestSource`，`triggerSource` 持久化进 payload；manual 与 scheduled 共享同一 24h 预算窗口（6 次 / 48000 输入 / 6000 输出），符合父级显式要求，未拆分额度。✓
4. **质量判定点估计**：`passed` 使用 `precision.value>=.9 && recall.value>=.95`（点估计），Wilson lower/upper 经 `proportion()` 计算并随报告输出；100/30 仅作最低门槛（`cases.length>=100 && needsAction>=30`），未被替换为统计泛化判据。✓
5. **binding window 为历史冻结评估窗口**：`readAssistantQualityQualification` 要求 `JSON.stringify(entry.binding)===JSON.stringify(bindingSchema.parse(currentBinding))`，account/epoch/window 三元身份相等才放行；无任何生产 token 铸造路径（唯一 issuer 是 main-private 的 `issueAssistantQualityQualification`，WeakMap 键不可伪造、不可经 IPC 序列化）。✓

## 并发与撤销路径深查（无新发现）

- `check()` 的 `active` 检查与赋值之间无 await，单线程安全；`finish` 用 `this.active?.work===work` 防误清；`new Promise` executor 同步执行，resolve/reject 无 TDZ 窗口。
- settle 与 `sent=false` 之间无 await，无双结算竞态；catch 中 `if(sent)` 的补偿 settle 带内层 try，幂等冲突（`settlement_conflict`）不会逃逸。
- `AbortSignal.any` 抛错时 reject 后 `finish` 仍经 `work.then(finish,finish)` 清理 active，无泄漏。
- 预算不变量（`chargedInput>inputTokens` 全表扫描拒绝）在 reserve 时强制执行，provider 超报用量会被 `budget_contract_breach` 拒绝且污染后续 reserve —— fail-closed。

## 仅存 P2 观察（不阻塞，建议记录）

1. **queuedManual 合并语义**：active 期间第二个不同 occurrenceId 的 manual 请求被静默并入第一个 queued 的 work，调用方收到与其 occurrenceId 不对应的结果。当前 manual occurrence 为随机 UUID 且结果仅作状态展示，影响限于语义混淆。建议在返回中携带实际执行的 occurrenceId，或拒绝第二个排队请求。
2. **发布原子性窗口**：`commitOrdinaryAssistantCheck` 的 upsertExpectation → insertEvidence → completeOwner → finishSuccess 四步非单事务；崩溃可在「evidence 已持久、run 非 success」状态留下孤儿 evidence。缓解已存在（发布前 `getLoopRunPublicationBasis` 检查 + 发布失败标 run failed），但建议长期改为单事务，或在（未来真正的）notifier 侧要求 run status==='success' 才投递。当前无 notifier/provider，seam 显式关闭，故非 P1。
3. **queued 请求 signal 已 aborted** 时 `throwIfAborted` 使 work 以 AbortError reject 而非优雅返回 skipped —— 仅调用方体验问题。

## 结论

**APPROVE**。在该封闭门控实现范围内（生产 CLOSED：无合格 provider、无真实人工评估 token、IPC 不可注入 qualification/provider/clock/actor），前次 BLOCK 项均已按声明修复，五条父级裁决均在代码中有对应落实，未发现残余 P0/P1。上述三条 P2 建议记入后续真 provider/quality 集成时一并处理。父级完整 P3 在真实人工评估与合格 provider 就位前维持 CLOSED —— 本评审不构成任何试点放行主张。

Source SHA256 manifest:

```json
{
  "desktop/electron/assistant-periodic-runtime.ts": "4c116ef925b3e62a6b8662c39e17eb8d504b6e763ccc4fdb297ab0f526c8e8ca",
  "desktop/electron/assistant-analysis-budget.ts": "b9bd927ea517570e1bde5c668dc0072b90668cb2e53b3766abf0b64f8bf1b086",
  "src/runtime/assistant/quality-qualification.ts": "90f20fab89749ff489c1c64a75767f346a63207343fdf6d4097b972cba597479",
  "src/runtime/assistant/analysis-port.ts": "8f6df201619525c5c58ac8e96da0ac033305a687ae8572da908755390c2f9242"
}
```

Process completion: {"exitCode": 0, "timedOut": false}

## p3-final-notification

# Verdict: APPROVE

Independent re-review of the pasted implementation, within the stated gate (production CLOSED, no qualified provider, no real human-evaluation token). I find **no remaining P0 and no remaining P1** in the security/durability properties in scope. The previously adjudicated items hold against the code as pasted; remaining observations are P2 hardening, listed with exact fixes.

## Verification of the claimed P3 fixes

- **Source-unknown ledger burn**: fixed correctly. In `prepareAssistantDigest` the `assistant_source_runs ⋈ loop_runs` existence check (`analysis_status='complete'`, `loop_id='personal-assistant-transaction-check'`, `r.status='success'`) executes before any write (clock upsert, deliveries insert, ledger insert). The `isCurrent()` callback is checked before the writes and again after, with rollback-by-throw inside the same BEGIN IMMEDIATE transaction.
- **Scheduler-only prepare**: `prepareDigest` rejects any `requestSource!=='scheduler'` before touching the store; the store-level `prepareAssistantDigest` has no source parameter at all, so no IPC-reachable value can influence it.
- **Live qualification**: `readAssistantDigestFacts` takes the optional main-private callback; absent ⇒ `qualificationCurrent=false` ⇒ `assistantNotificationSuppression` returns `'stale_policy'` before the OS call. `configure` additionally refuses `enabled:true` without a qualification callback (`assistant_periodic_quality_unverified`), and `syncSchedule` pauses the loop when qualification is absent or mismatched. The closed seam is real in code, not a comment.
- **Corrupt receipt JSON**: `assistantDigestReceiptSchema` is `.strict()` and every read path (`getAssistantDigestDelivery`, `getAssistantDigestReceipt`, `finishAssistantDigestDelivery` via read) parses through it. Corrupt rows throw instead of being reinterpreted.
- **Adjudication (1)**: `enqueueAssistantDigest` registers the real deliver() promise via `this.own(...)`; `close()` seals synchronously via `dispose()` then drains the live `drainWork` snapshot with `allSettled` — no Promise.race abandonment, no fabricated drain ACK. A hung `owner.notify()` blocks exactly that one owned work item; the claim row stays final, so no second OS request can start. Consistent with the documented availability limit.
- **Adjudication (3)**: single shared budget confirmed — `prepareAssistantDigest` is the only mint path for `assistant_digest_deliveries`, and its rolling-24h/4h-window check counts all deliveries regardless of trigger. No split allowance was introduced.
- **Adjudications (4)/(5)**: nothing in this code mints tokens, substitutes Wilson bounds, or treats `binding.window` as expiry; provenance stays with trusted main. No conflict.

## Property checks

- **Durable no-resend**: two-layer claim (`assistant_digest_deliveries.dispatch_state` pending→sent via guarded UPDATE; `assistant_digest_receipts` insert before the OS call). Recovery (`sent` state + NULL/unknown receipt) goes through provider `lookup` only — never a blind re-send. Crash after claim leaves `unknown` and stays silent, matching the documented fail-closed choice.
- **Concurrency**: failed claim recurses at most once (state can only be `pending`→`sent`); the recursion lands in the lookup branch and cannot ping-pong. Duplicate `notifyPending` entry is harmless because `claimNotification` is the per-activity guard. Watch revalidation after claim compares status/preference/generation against a fresh read — the TOCTOU window is closed.
- **Revocation**: policy revision bump makes in-flight envelopes `stale_policy` at both the service gate and the OS-adjacent gate; disable is honored at prepare, dispatch, and notify time; the activity owner has no await between the final suppression computation and `owner.notify()`.
- **Privacy**: envelope and receipts carry only 64-hex identity/revision hashes; facts reading is fixed-path, no caller-selected SQL or path, and proposal/coverage payloads are used only for gating booleans, never forwarded.
- **Fail-closed posture**: every parse/open/read failure in the facts reader and owner path resolves to `undefined` → suppression, never to notify.

## P2 observations (non-blocking, fix before pilot enablement)

1. **Recovery sweep lacks per-item isolation** — `recoverDeliveries` awaits `dispatchDigest` in a bare loop. One poisoned row (corrupt stored envelope/receipt, or provider/local receipt divergence causing `assistant_digest_ack_conflict`) throws and aborts the sweep; since recovery is `ORDER BY committed_at`, the earliest poisoned row starves all later deliveries permanently. Fix: wrap each iteration in try/catch, route to `onError`, continue; optionally bound retries per delivery.
2. **`budgetAdmitted` is hardcoded `true`** in `readAssistantDigestFacts`, making the `budget_exhausted` branch in `assistantNotificationSuppression` dead code. Today this is sound because budget is admission-controlled at the single mint path, but it is a latent bypass if a second delivery-creation path is ever added. Fix: either compute it from `assistant_digest_deliveries` in the facts reader, or delete the field and the dead branch so the layering is explicit.
3. **Receipt finish last-wins window** — `finishAssistantDigestDelivery`/`finishAssistantDigest` check-then-UPDATE without a `WHERE receipt status='unknown'` guard; two concurrent finishers (send path + lookup path) that both read pre-final state can silently overwrite instead of raising conflict. Reachable only with an inconsistent trusted provider. Fix: add the status guard to the UPDATE and treat `changes===0` as conflict.
4. **Mislabeled suppression on dispose** — the owner persists `suppressed('stale_policy')` when the real cause is service disposal; also note this makes that digest final (never retried), which differs from the crash-leaves-`unknown` semantics used elsewhere. Pick one semantics and label it accurately.
5. **Brittle equality via `JSON.stringify`** in `claimAssistantDigestDispatch`/`finishAssistantDigestDelivery` — currently safe only because both sides are zod-parsed through the same schema. Fix: canonicalize (stable stringify) or compare a stored `envelope_hash` like the receipts table already does.

## Scope caveats (not re-adjudicated)

`own`/`drainWork` internals, the actual IPC surface for `prepareDigest`/`enqueueAssistantDigest`, the loop-store crash-stop behavior of adjudication (2), and the injected-callback test's notify-count-0 result are asserted by the parent but not visible in the pasted code — accepted as parent-attested, not independently verified. No tools were run and no test claims are made. The feature remains correctly unreachable in production: absent a real qualification provider, every notify path terminates in suppression, and no fix here should be read as pilot approval.

Source SHA256 manifest:

```json
{
  "desktop/electron/assistant-periodic-policy.ts": "4ed0619b1805d6859c5a8aae10ade56ae89dafd4957226b447accd928709f2eb",
  "src/runtime/assistant/digest-facts.ts": "0b33c671285314c97a0c0032b08502bf482a16e1879ce8368e6a84f1fd1d540d",
  "src/runtime/assistant/digest-receipts.ts": "9b1239eb91158759ca0f31848f2e86790bb5b8fc991d82b396d91ab78c454711",
  "src/runtime/assistant/notification-policy.ts": "6d151c63d63297acd3d6f7d36fa2087c49c04ec5d73378070faf57c9f6f30947"
}
```

Process completion: {"exitCode": 0, "timedOut": false}
