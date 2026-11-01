# Independent Kimi k3 reviews

Coding: Codex GPT-6. Static reviews only; reviewer did not run tests. Earlier calendar budget BLOCK was fixed and delta approved. Source manifests remain in /tmp/openduet-launch-review-20261101.

## launch-final

结论：**APPROVE**

P0/P1 发现：**0**。仅基于你粘贴的片段做静态评审，未运行测试，也未把声明外范围纳入结论。

核对到的关键点与所述边界一致：

- 用户入口收敛：`prepare/prepareFollowUp/confirm/get/list/resolve` 均强制 `requestSource==='user'`；`observeTask` 限 `user|scheduler`，`recover` 限 `scheduler`。
- 启动授权链路闭合：`confirm` 重读 draft 并校验旧 operation 幂等；`dispatch` 在 `allocate/claim/ensure/consumeAssistantLaunchStart` 前后反复 `assertDomain`、`source.isCurrent()`、`isSourceLaunchable`；`consumeAssistantLaunchStart` 要求 `preparing`、未过期、`sourceVector` 匹配，并在写 `start_committed` 前后同步 guard。
- reservation/actor/domain 未下放：task identity 只由 main 侧 `reserveAssistantTaskIdentity/reserveTaskIdentity` 产生，`TaskIdentityReservation` 经 WeakMap/AsyncLocalStorage 绑定到 admission scope；`reservationFor` 校验 open、threadId、prompt、无 `executionScope`、`permissionMode==='default'`。
-  ordinary/local 限定成立：`assistantDomain` 在 `codexTasks.selected()` 时直接拒绝；workspace 做 realpath/stat、root/home/multiAgentCwd 校验；存在 authorization 时要求 `executionAllowed && persistenceState==='confirmed'`。
- 未知任务未强制释放：只按 `workItemIdentity/operation_id` 认领；终态才删除 `assistant_active_work_claims`；`recover` 对无 taskId 仅置 `blocked/reconfirmation_required`，未见释放未知任务路径。
- `start_committed` 后的 source 变化不追溯本次运行：commit 只落在 operation/digest/threadBinding 已固定的身份上，后续 source 变化按独立用户工作处理。

非阻塞提醒，不计入本次结论：继续确保公开 IPC 只暴露 `ASSISTANT_LAUNCH_SUMMARY_SCHEMA`/ID/revision/text，不把 full operation 的 `instruction/domain/sourceVector` 或 reservation/control 对象返给 renderer。

## calendar-budget-final

# 独立安全评审结论：BLOCK

（仅静态审阅所贴代码，未运行任何测试，不引用他人结论）

## P1（阻塞项）

**1. 预算台账逻辑时钟信任调用方 `now`，24h 窗口可被重置 —— `assistant-analysis-budget.ts: clock()` / `reserveAssistantAnalysis()`**

- `clock()` 取 `max(存储值, observed)`，对 `observed` 只校验 safe integer，无墙钟上界。任何能影响 `input.now` 的调用方（含未来接入 reserve 的调度/IPC 路径）传入远未来值即可：
  - 一次性清空预算窗口：`recent = filter(logicalAt > logicalAt - 86400000)`，历史记录全部被滤除，6 次/48k/6k 限额重置；
  - 由于时钟单调只进不退，传入递增的 `now` 可反复重置；
  - 逻辑时钟被永久顶高、不可回退，且无告警。
- 修复（改动很小，应在台账启用前完成，建议现在做）：`now` 不进入外部输入契约，main 内统一取 `Date.now()`；或至少 clamp 为 `|now - Date.now()| ≤ N` 并拒绝/告警异常值。修复前 `AssistantAnalysisBudget` 不得对任何非可信 `now` 来源开放。

## P2（不阻塞合并，需建项跟进）

2. **二进制校验与执行存在 TOCTOU —— `assistant-calendar-native.ts` `verifyYzjCalendarBinary()` / `createNativeCalendarRead()`**：哈希校验发生在读取时刻，但后续 identity→list→identity 三次 `execFile` 都重新读磁盘路径，校验与执行之间、以及每次 exec 之间文件可被替换。建议将已验证二进制复制到 main 独占的 0700 临时目录执行，或每次 exec 前重校验。

3. **`assistant_analysis_attempts` 无清理无上限**：`reserve` 每次全表扫描并逐行 `JSON.parse`，随时间线性增长拖慢 main 进程；且一旦存在历史 `charged>reserved` 行，`assistant_budget_provider_breach` 将永久拒绝所有新预约（可用性自锁）。建议加保留期清理，breach 改为隔离告警而非全停。

4. **`collect()` 单飞共享首个调用方的 signal**：先调用方取消会让后续并发调用拿到已中止的运行；每次 `AbortSignal.timeout(30000)` 创建的计时器未在结束后显式清理（旧 Node 版本会延长事件循环）。健壮性问题，非安全边界。

5. **未核实声明**：硬编码 `DARWIN_ARM64_018` 是否真来自官方 0.1.8 release manifest，本次审查无法独立验证（转引代码注释、未核实）。发布前须对着官方 manifest 复核并留档。

## 已确认到位的防护（抽查认可）

- 二进制：lstat 拒符号链接、大小上限、basename 白名单、`shell:false`、`killSignal:'SIGKILL'`、不记录 stderr；
- grant 生命周期：epoch 乐观并发、读前后 accountId/epoch 双校验、consent 不从 IPC 取、disable/revoke 清空 binary+account_hash 并删除全部派生事件；
- 数据边界：200 条 / 1MB / title ≤160 / id ≤512 上限、schema parse、时区经 `Intl` 白名单验证、永远 `partial` 不推进 watermark；
- 台账：attempt 幂等重试字段一致性校验、occurrence 唯一约束、settle `'unknown'` 按全额保守计费、settlement 冲突检测、预约 600s 过期。

## 结论

日历只读链路（连接/epoch/采集）在本范围内未发现实际 P0/P1，设计保守、边界清晰。**整体 BLOCK**，唯一阻塞项是 P1 #1：预算时钟的 `now` 信任边界是真实设计缺陷而非理论问题，修复成本极低，必须在 P3 启用前（建议随本 PR）修掉。P2 #2–#4 建 follow-up 即可。

## delta

## Verdict: APPROVE

Independent review of the delta only (code as presented; no tool runs, no test claims). No P0/P1 found.

### What I verified in the code

**Reconfirmation binding (prepare + commit, both fail-closed)**
- `prepareReconfirmation` (assistant-launch-service.ts delta) is user-gated (`this.user(input)`), validates uuid, and refuses unless the operation is `blocked` with `taskId===null` — unknown/allocated work cannot reconfirm, matching the claim that dispatch CAS never occurred.
- `prepareAssistantLaunchDraft` computes `reconfirm` requiring `state==='blocked'`, `taskId===null`, `proposalId` match, and `requestDigest===expectedOperationDigest`; any reconfirm attempt that fails binding leaves `recommendation` undefined and hits `(input.reconfirmOperationId&&!recommendation)` → `assistant_launch_proposal_conflict`. No path mints an unbound reconfirm draft.
- `confirmAssistantLaunch` re-checks the same conditions against the *current* stored operation (`previous.requestDigest!==draft.expectedOperationDigest`, `source.sourceVector!==draft.sourceVector`) and requires the recommendation to still exist by `assistantWorkItemIdentity` in the live source. The new `requestDigest` rebinds profileId/proposalId/revision/sourceVector/instruction/domain/threadBinding, so the reconfirmed operation is a new commitment, not a replay of the old digest.

**CAS / no duplicate dispatch**
- All store functions (`confirmAssistantLaunch`, `write`, reads) are synchronous on `node:sqlite` in the main process; the state check → history insert → write sequence has no await point, so single-threaded serialization gives effective CAS. A second confirm re-reads state, sees `accepted`, and is denied or idempotent-replayed.
- Idempotent replay (`old` lookup at function top) returns the existing operation without re-writing; combined with `assistant_active_work_claims.operation_id UNIQUE`, a replayed confirm cannot mint a second claim/dispatch. Same pattern as the previously approved ordinary path.
- `assistant_launch_draft_links` preserves old draft aliases; `readAssistantLaunchOperation(by='draft_id')` resolves both old and new drafts to the one operation, so the alias surface doesn't create a second dispatch handle.

**History**
- Old operation payload is archived to `assistant_launch_confirmation_history` before the upsert; `write()` updates `draft_id` on conflict so the operation row points at the new draft while the link table keeps the old alias.

**Sibling / gate symmetry**
- Reconfirm reuses the existing `confirm` service entry and IPC channel family; the new `prepareReconfirmation` channel gets the same `authorize(event)` check, strict tuple input schema, output schema, and risk tags as `prepareLaunch` in assistant-typed-ipc.ts. `requestSource:'user'` is hardcoded main-side; renderer supplies only `draftId`.
- Pilot gate stays env-based (`XIAOK_ASSISTANT_LOCAL_LAUNCH_PILOT==='1'`, default OFF) in the composition closure; source data cannot influence it. The reconfirm commit flows through the same launch path that was previously approved, so the commit-side gate posture is unchanged; prepare only mints a display draft, no dispatch capability.

**Analysis budget (the prior BLOCK)**
- `AssistantAnalysisBudget` now stamps `now` from an injectable main clock defaulting to `Date.now`; `reserve`/`sent`/`settle` accept `Omit<…,'now'>`, so caller/renderer-supplied time is structurally excluded from the public service input. This resolves the caller-controlled-clock finding.

**Source guards**
- `readMorningActionSource` captures the profile JSON into `isCurrent()`, enforces the evidenceRef→dataScopes requirement map, and `listMorningSuggestions` v2 legacy path re-derives from the same `readMorningActionSource` guard rather than a parallel trust path. Instruction/workspace fields cross IPC only as display data inside the strict draft schema; no reservation/control/actor semantics appear in the IPC contract.

### Residual observations (not P0/P1, no action required for approval)

- The history insert and the operation upsert in `confirmAssistantLaunch` are not wrapped in an explicit transaction; a crash between them leaves an orphan history row with the operation still `blocked`, which is retry-safe. Consider `db.exec('BEGIN')`/`COMMIT` for tidiness.
- `expectedOperationDigest` is validated as length-64 string, not hex; drafts are main-minted so this is cosmetic.
- The trailing `current(source)` after the reconfirm `write()` is unreachable-failure (fully synchronous block, deterministic with earlier checks) — benign redundancy.

Out of scope per instructions, not assessed: real pilot behavior/quality, package acceptance.

## cancel

# Independent Review — Cancellation Delta (Kimi k3, reviewing Codex GPT-6)

**Verdict: APPROVE — no P0, no P1 found.**

Reviewed the four hunks against the four mandated properties. Analysis below, all conclusions drawn from the code as presented in scope.

## Cancel vs commit race — clean

The race is closed by serialization plus a guard on the commit side:

- `consumeAssistantLaunchStart` refuses commit unless `op.cancelRequestedAt===null` and `state==='preparing'` (`assistant-launch-store.ts`). LoopStore wraps both helpers in `BEGIN IMMEDIATE`, so cancel-request and start-commit cannot interleave inside a transaction.
- If cancel lands first: `requestAssistantLaunchCancel` re-reads the op inside its transaction, sets `cancelRequestedAt`, and any later `consumeAssistantLaunchStart` throws `assistant_launch_start_denied`. A cancel arriving while still `preparing` therefore **blocks the source commit**, satisfying the parent requirement.
- If commit lands first (`start_committed`, `taskId` set): the `proven` predicate `!op.taskId && ['accepted','blocked'].includes(op.state)` is false, so the store keeps state, stamps `cancel_pending`, and the service escalates to `port.cancel(requested.taskId)` — it **asks the original host** rather than self-declaring cancellation.

## No false cancellation / no unknown-outcome claim release — clean

- State `cancelled` is only written on the `proven` path: no `taskId` and state in `accepted|blocked`, i.e., admission recorded but no host task can exist (host task creation happens at `start_committed` via `consumeAssistantLaunchStart`). The `DELETE FROM assistant_active_work_claims` runs only on this same proven path — claim release is impossible once a host task exists.
- Post-commit failure of `port.cancel` maps to `state:'outcome_unknown', errorCode:'cancel_pending'` — never `cancelled` — and does not touch claims. Matches the parent's "forbids forced release unknown".
- `reconcile` only marks terminal from an actual host snapshot, and only after binding verification (`operationId`, `requestDigest`, `threadId`, `context.threadId`, `prompt` vs `op.instruction`). Any mismatch or missing snapshot degrades to `outcome_unknown/manual_repair`, again without claim release.
- The late-observation guard is sound: after the `await port.lookup`, everything from the `latest` re-read through the final `updateAssistantLaunchObservation` is synchronous (digest via `createHash` is sync), so the compare-then-write is atomic on the main-process event loop. A concurrent terminal/result write wins.

## Siblings user-only / no arbitrary task ID — clean

- Wire is a strict tuple `[{draftId:uuid}]`; the IPC registrar enforces `authorize(event)===true` and arity 1 for `cancelLaunch`. Public input carries no actor and no task ID.
- Service enforces `this.user(input)` and `z.string().uuid().parse(input.draftId)`; the task ID comes exclusively from the durable operation row (`readAssistantLaunchOperation(...,'draft_id')`), and the port is the private admission instance calling `host.cancelTask(taskId,'user_cancelled')`. No caller-selected host, no source/permission escalation. Sibling methods in the same registrar list were covered by the earlier approved deltas and this delta doesn't alter their authorization path.

## Non-blocking observations (not P2 gating, informational only)

1. `cancel()`'s `catch` swallows errors from both `port.cancel` and the awaited `reconcile`, collapsing both to `cancel_pending`. Direction is conservative (never falsely terminal), so acceptable, but a reconcile-internal error becomes indistinguishable from a host-cancel failure in telemetry.
2. Repeat `cancelLaunch` while already `cancel_pending` re-invokes `port.cancel`. Idempotent in effect; relies on `host.cancelTask` tolerating duplicate cancels, which the wire states it does.
3. `JSON.stringify` equality as the freshness guard depends on stable key ordering from the store read; safe today since both objects come from the same reader, but brittle to future schema-field reordering. A monotonic `updatedAt`/version compare would be more robust — optional hardening, not a defect.

**APPROVE.** The delta satisfies: cancel-before-commit blocks commit, cancel-after-commit delegates to the original host and waits for actual terminal state, claims are released only on provably-never-started operations, and no caller-supplied task identity or non-user source can reach the mutation.
