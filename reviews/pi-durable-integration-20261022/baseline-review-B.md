# B席：Desktop 5文件同master基线独立归因

日期：2026-10-22。结论：**部分归因成立；不能声称这5文件或Desktop全量全绿。**

按任务指定命令在detached master `3b4061489a612337fdb2fc1eb92e96c1d4fbe9a1` 独立重跑5文件。原测试断言、timeout、资格和配置均未修改，未运行build/prepare，未修改共享依赖或连接/接管4400共享KSwarm。开始时读取Node为 `v24.16.0`。baseline root/desktop node_modules指向本任务owned依赖clone；5个测试文件逐字节与集成工作树相同。结束后baseline tracked工作树状态：`clean`。

## 实际执行

使用绝对runner：`<worktree>/.xiaok/evals/pi-durable/integration-20261022/run.py`，label `desktop-extra-baseline`，cwd `<master-baseline>/desktop`。

```text
node node_modules/vitest/vitest.mjs run tests/main/desktop-multi-agent-service.bdd.test.ts tests/main/desktop-compound-ancestor-followup.test.ts tests/main/desktop-post-seal-process.bdd.test.ts tests/main/desktop-post-seal-facts.bdd.test.ts tests/main/desktop-runner-finalization.test.ts --maxWorkers=2
```

runner记录：runnerPid `87446`，child PID/PGID `87457`/`87457`，exitCode `1`，reaped `True`；开始 `2026-10-21T19:46:13.593505+00:00`，结束 `2026-10-21T19:49:41.685148+00:00`。没有触发runner总timeout。结束后只按登记PGID `87457` 检查，组内进程0；未手动kill任何进程/服务，也不据此宣称全机或未知detached子进程残留0。

## 数量与对照结论

基线日志最终结果：5文件均失败，**68 failed / 111 passed / 179**。集成全量原日志已输出的这5文件对应**69 failed / 110 passed / 179**；这是选定文件的合计，不是整个Desktop套件最终数量。

| 文件 | 集成失败 | 基线失败 | 同名且逐项错误摘要原文相同 |
|---|---:|---:|---:|
| `desktop-multi-agent-service.bdd.test.ts` | 18 | 18 | 18 |
| `desktop-compound-ancestor-followup.test.ts` | 8 | 8 | 8 |
| `desktop-post-seal-process.bdd.test.ts` | 3 | 2 | 1 |
| `desktop-post-seal-facts.bdd.test.ts` | 38 | 38 | 38 |
| `desktop-runner-finalization.test.ts` | 2 | 2 | 2 |
| 合计 | 69 | 68 | 67 |

- multi-agent 18、ancestor followup 8、post-seal facts 38、runner finalization 2 全部同名同错误摘要复现；另post-seal process的marker-transaction同名同错误复现，共67项。可确认这些失败不要求本PR摘要完成边界改动才能发生，不能称为本轮新引入。
- 集成独有的两个失败：`D10/D18 actual OS crash at marker-committed...`、`...at snapshot...`，原文均 `Test timed out in 5000ms.`。本轮基线它们通过；**尚不能排除集成回归，亦不能仅凭同文件其他失败就归为既有**。需要保留失败并作受控配对复跑/更深证据，本轮未扩时。
- 基线独有：`D6 actual file:// PDF FIFO cannot block host heartbeat; raw IO keeps in-flight ownership after deadline`。说明并发/时序差异存在，不是两组完全相同；不能将它抵消集成独有失败。
- 同名同错是对原始Vitest逐项摘要中`→`错误文本的精确比较，附录保留每项及原日志行号；不把动态路径/完整stack或根因都宣称逐字节相同。对native依赖缺失/recipe环境/KSwarm entry_path_mismatch等类别的根因判断仍应以原完整输出为准。

## 环境与权限边界

`desktop-post-seal-facts`的38项均在两边报 `Cannot find module 'better-sqlite3'`。runner-finalization两项均复现安全拒绝：共享4400服务entry path与本worktree bundled entry不一致。本轮没有改配置去adopt该服务、没有重启或清理共享服务。multi-agent/ancestor的相同断言与120000ms timeout也如实保留；不通过改断言或延长timeout使其绿。

本报告不以“host/store没改”归因。采用同master实际运行结果，并将未匹配的两个集成timeout单列。其他Desktop文件、新出现失败和主笔先前另跑的取消/services基线不在本报告范围，不能把本报告67项外推成全部全量失败已关闭。

## 原始证据与哈希

- `desktop-extra-baseline.log` SHA256：`ea6186b56181ec7dc34d54e3e1010b541acaeb7dce33ebd144f32cf41dd9bdcc`。
- `desktop-extra-baseline.json` SHA256：`e06c6fe2521d055a5ad151a75189924dececf79352e1fab524d6e63c3f6f7585`。
- 本次读取时 `desktop-full-node24.log` SHA256：`5f54488f142f2617714c589a1735113c03b54a227cbd14e177970a68069dc392`。全量runner若仍追加，后续SHA会变化；附录行号定位本次实际对照输出。

本席只写本独立报告与授权runner生成的log/json，没有修改源码、测试、共享服务或既有归档票。

## 逐项对照附录

### desktop-multi-agent-service.bdd.test.ts

集成：`❯ tests/main/desktop-multi-agent-service.bdd.test.ts (114 tests | 18 failed) 153724ms`

基线：`❯ tests/main/desktop-multi-agent-service.bdd.test.ts (114 tests | 18 failed) 171101ms`

- **同名同错误摘要复现**：BDD: durable service uses the real shared coordinator > retains an actual product group owner and native history across two real root tasks with durable alias publication
  - 集成原日志行 705：`actual product capacity environment required`
  - 基线原日志行 117：`actual product capacity environment required`

- **同名同错误摘要复现**：BDD: durable service uses the real shared coordinator > uses the actual prepared Runtime and managed session before its first SDK send (product runner=closed-result-read)
  - 集成原日志行 671：`expected [ Array(1) ] to deeply equal []`
  - 基线原日志行 83：`expected [ Array(1) ] to deeply equal []`

- **同名同错误摘要复现**：BDD: durable service uses the real shared coordinator > uses the actual prepared Runtime and managed session before its first SDK send (product runner=compound-group)
  - 集成原日志行 673：`expected [ …(2) ] to deeply equal []`
  - 基线原日志行 85：`expected [ …(2) ] to deeply equal []`

- **同名同错误摘要复现**：BDD: durable service uses the real shared coordinator > uses the actual prepared Runtime and managed session before its first SDK send (product runner=compound-managed)
  - 集成原日志行 675：`expected undefined to be defined`；`expected [ …(2) ] to deeply equal []`
  - 基线原日志行 87：`expected undefined to be defined`；`expected [ …(2) ] to deeply equal []`

- **同名同错误摘要复现**：BDD: durable service uses the real shared coordinator > uses the actual prepared Runtime and managed session before its first SDK send (product runner=compound-managed-agent-followup)
  - 集成原日志行 690：`expected [ …(2) ] to deeply equal []`
  - 基线原日志行 102：`expected [ …(2) ] to deeply equal []`

- **同名同错误摘要复现**：BDD: durable service uses the real shared coordinator > uses the actual prepared Runtime and managed session before its first SDK send (product runner=compound-managed-agent-followup-busy)
  - 集成原日志行 692：`expected [ …(2) ] to deeply equal []`
  - 基线原日志行 104：`expected [ …(2) ] to deeply equal []`

- **同名同错误摘要复现**：BDD: durable service uses the real shared coordinator > uses the actual prepared Runtime and managed session before its first SDK send (product runner=compound-managed-close)
  - 集成原日志行 682：`expected undefined to be defined`；`expected [ …(2) ] to deeply equal []`
  - 基线原日志行 94：`expected undefined to be defined`；`expected [ …(2) ] to deeply equal []`

- **同名同错误摘要复现**：BDD: durable service uses the real shared coordinator > uses the actual prepared Runtime and managed session before its first SDK send (product runner=compound-managed-followup)
  - 集成原日志行 687：`Cannot read properties of undefined (reading 'id')`；`expected [ …(2) ] to deeply equal []`
  - 基线原日志行 99：`Cannot read properties of undefined (reading 'id')`；`expected [ …(2) ] to deeply equal []`

- **同名同错误摘要复现**：BDD: durable service uses the real shared coordinator > uses the actual prepared Runtime and managed session before its first SDK send (product runner=compound-managed-followup-ack-loss)
  - 集成原日志行 697：`Cannot read properties of undefined (reading 'id')`；`expected [ …(2) ] to deeply equal []`
  - 基线原日志行 109：`Cannot read properties of undefined (reading 'id')`；`expected [ …(2) ] to deeply equal []`

- **同名同错误摘要复现**：BDD: durable service uses the real shared coordinator > uses the actual prepared Runtime and managed session before its first SDK send (product runner=compound-managed-followup-cancel)
  - 集成原日志行 694：`Cannot read properties of undefined (reading 'id')`；`expected [ …(2) ] to deeply equal []`
  - 基线原日志行 106：`Cannot read properties of undefined (reading 'id')`；`expected [ …(2) ] to deeply equal []`

- **同名同错误摘要复现**：BDD: durable service uses the real shared coordinator > uses the actual prepared Runtime and managed session before its first SDK send (product runner=compound-managed-followup-close-preparing)
  - 集成原日志行 700：`Cannot read properties of undefined (reading 'id')`；`expected [ …(2) ] to deeply equal []`
  - 基线原日志行 112：`Cannot read properties of undefined (reading 'id')`；`expected [ …(2) ] to deeply equal []`

- **同名同错误摘要复现**：BDD: durable service uses the real shared coordinator > uses the actual prepared Runtime and managed session before its first SDK send (product runner=compound-managed-parallel)
  - 集成原日志行 685：`expected [ …(2) ] to deeply equal []`
  - 基线原日志行 97：`expected [ …(2) ] to deeply equal []`

- **同名同错误摘要复现**：BDD: durable service uses the real shared coordinator > uses the actual prepared Runtime and managed session before its first SDK send (product runner=compound-root-orphan)
  - 集成原日志行 703：`expected [ Array(1) ] to deeply equal []`
  - 基线原日志行 115：`expected [ Array(1) ] to deeply equal []`

- **同名同错误摘要复现**：BDD: durable service uses the real shared coordinator > uses the actual prepared Runtime and managed session before its first SDK send (product runner=false)
  - 集成原日志行 663：`expected [ Array(1) ] to deeply equal []`
  - 基线原日志行 75：`expected [ Array(1) ] to deeply equal []`

- **同名同错误摘要复现**：BDD: durable service uses the real shared coordinator > uses the actual prepared Runtime and managed session before its first SDK send (product runner=group-close-drain)
  - 集成原日志行 678：`Test timed out in 120000ms.`；`expected [ …(2) ] to deeply equal []`
  - 基线原日志行 90：`Test timed out in 120000ms.`；`expected [ …(2) ] to deeply equal []`

- **同名同错误摘要复现**：BDD: durable service uses the real shared coordinator > uses the actual prepared Runtime and managed session before its first SDK send (product runner=publication-persist-failure)
  - 集成原日志行 667：`expected [ Array(1) ] to deeply equal []`
  - 基线原日志行 79：`expected [ Array(1) ] to deeply equal []`

- **同名同错误摘要复现**：BDD: durable service uses the real shared coordinator > uses the actual prepared Runtime and managed session before its first SDK send (product runner=semantic-next-turn)
  - 集成原日志行 669：`expected [ …(2) ] to deeply equal []`
  - 基线原日志行 81：`expected [ …(2) ] to deeply equal []`

- **同名同错误摘要复现**：BDD: durable service uses the real shared coordinator > uses the actual prepared Runtime and managed session before its first SDK send (product runner=true)
  - 集成原日志行 665：`expected [ …(2) ] to deeply equal []`
  - 基线原日志行 77：`expected [ …(2) ] to deeply equal []`
### desktop-compound-ancestor-followup.test.ts

集成：`❯ tests/main/desktop-compound-ancestor-followup.test.ts (8 tests | 8 failed) 144898ms`

基线：`❯ tests/main/desktop-compound-ancestor-followup.test.ts (8 tests | 8 failed) 152353ms`

- **同名同错误摘要复现**：P2 actual managed ancestor followup > uses exact drained descendant resources for a fresh user turn: active-window
  - 集成原日志行 919：`expected 0 to be greater than or equal to 2`；`expected [ Array(1) ] to deeply equal []`
  - 基线原日志行 17：`expected 0 to be greater than or equal to 2`；`expected [ Array(1) ] to deeply equal []`

- **同名同错误摘要复现**：P2 actual managed ancestor followup > uses exact drained descendant resources for a fresh user turn: final-history-failure
  - 集成原日志行 922：`expected 0 to be greater than or equal to 2`；`expected [ Array(1) ] to deeply equal []`
  - 基线原日志行 20：`expected 0 to be greater than or equal to 2`；`expected [ Array(1) ] to deeply equal []`

- **同名同错误摘要复现**：P2 actual managed ancestor followup > uses exact drained descendant resources for a fresh user turn: final-history-failure-shutdown
  - 集成原日志行 925：`expected undefined to match object { executionActive: false, …(1) }`；`expected [ Array(1) ] to deeply equal []`
  - 基线原日志行 23：`expected undefined to match object { executionActive: false, …(1) }`；`expected [ Array(1) ] to deeply equal []`

- **同名同错误摘要复现**：P2 actual managed ancestor followup > uses exact drained descendant resources for a fresh user turn: own-effect
  - 集成原日志行 916：`expected 0 to be greater than or equal to 2`；`expected [ Array(1) ] to deeply equal []`
  - 基线原日志行 14：`expected 0 to be greater than or equal to 2`；`expected [ Array(1) ] to deeply equal []`

- **同名同错误摘要复现**：P2 actual managed ancestor followup > uses exact drained descendant resources for a fresh user turn: root-tail
  - 集成原日志行 928：`Test timed out in 120000ms.`；`expected [ Array(1) ] to deeply equal []`
  - 基线原日志行 26：`Test timed out in 120000ms.`；`expected [ Array(1) ] to deeply equal []`

- **同名同错误摘要复现**：P2 actual managed ancestor followup > uses exact drained descendant resources for a fresh user turn: success
  - 集成原日志行 907：`expected 0 to be greater than or equal to 2`；`expected [ Array(1) ] to deeply equal []`
  - 基线原日志行 5：`expected 0 to be greater than or equal to 2`；`expected [ Array(1) ] to deeply equal []`

- **同名同错误摘要复现**：P2 actual managed ancestor followup > uses exact drained descendant resources for a fresh user turn: unknown-resource
  - 集成原日志行 913：`expected 0 to be greater than or equal to 2`；`expected [ Array(1) ] to deeply equal []`
  - 基线原日志行 11：`expected 0 to be greater than or equal to 2`；`expected [ Array(1) ] to deeply equal []`

- **同名同错误摘要复现**：P2 actual managed ancestor followup > uses exact drained descendant resources for a fresh user turn: unpublished-ack
  - 集成原日志行 910：`expected 0 to be greater than or equal to 2`；`expected [ Array(1) ] to deeply equal []`
  - 基线原日志行 8：`expected 0 to be greater than or equal to 2`；`expected [ Array(1) ] to deeply equal []`
### desktop-post-seal-process.bdd.test.ts

集成：`❯ tests/main/desktop-post-seal-process.bdd.test.ts (17 tests | 3 failed) 48282ms`

基线：`❯ tests/main/desktop-post-seal-process.bdd.test.ts (17 tests | 2 failed) 52064ms`

- **仅集成失败，本轮基线通过**：R4 actual post-seal owner CPU/IO and crash boundary > D10/D18 actual OS crash at marker-committed uses committed marker truth and never replays
  - 集成原日志行 1080：`Test timed out in 5000ms.`

- **同名同错误摘要复现**：R4 actual post-seal owner CPU/IO and crash boundary > D10/D18 actual OS crash at marker-transaction uses committed marker truth and never replays
  - 集成原日志行 1078：`production host drained without required marker-transaction boundary`
  - 基线原日志行 383：`production host drained without required marker-transaction boundary`

- **仅集成失败，本轮基线通过**：R4 actual post-seal owner CPU/IO and crash boundary > D10/D18 actual OS crash at snapshot uses committed marker truth and never replays
  - 集成原日志行 1083：`Test timed out in 5000ms.`

- **仅基线失败，集成日志通过**：R4 actual post-seal owner CPU/IO and crash boundary > D6 actual file:// PDF FIFO cannot block host heartbeat; raw IO keeps in-flight ownership after deadline
  - 基线原日志行 380：`post-seal fixture boundary was not reached`
### desktop-post-seal-facts.bdd.test.ts

集成：`❯ tests/main/desktop-post-seal-facts.bdd.test.ts (38 tests | 38 failed) 2532ms`

基线：`❯ tests/main/desktop-post-seal-facts.bdd.test.ts (38 tests | 38 failed) 2562ms`

- **同名同错误摘要复现**：R4 raw facts preserve actual production collector and gate semantics > D13 builder refuses cumulative artifacts bytes before touching the next source item
  - 集成原日志行 1145：`Cannot find module 'better-sqlite3'`
  - 基线原日志行 242：`Cannot find module 'better-sqlite3'`

- **同名同错误摘要复现**：R4 raw facts preserve actual production collector and gate semantics > D13 builder refuses cumulative events bytes before touching the next source item
  - 集成原日志行 1141：`Cannot find module 'better-sqlite3'`
  - 基线原日志行 238：`Cannot find module 'better-sqlite3'`

- **同名同错误摘要复现**：R4 raw facts preserve actual production collector and gate semantics > D13 conditional retained assistant_delta exactly fills slot 256 without an off-by-one refusal
  - 集成原日志行 1197：`Cannot find module 'better-sqlite3'`
  - 基线原日志行 294：`Cannot find module 'better-sqlite3'`

- **同名同错误摘要复现**：R4 raw facts preserve actual production collector and gate semantics > D13 conditional retained canvas_tool_call exactly fills slot 256 without an off-by-one refusal
  - 集成原日志行 1189：`Cannot find module 'better-sqlite3'`
  - 基线原日志行 286：`Cannot find module 'better-sqlite3'`

- **同名同错误摘要复现**：R4 raw facts preserve actual production collector and gate semantics > D13 conditional retained canvas_tool_result exactly fills slot 256 without an off-by-one refusal
  - 集成原日志行 1193：`Cannot find module 'better-sqlite3'`
  - 基线原日志行 290：`Cannot find module 'better-sqlite3'`

- **同名同错误摘要复现**：R4 raw facts preserve actual production collector and gate semantics > D13 conditional retained goal_tool_fact exactly fills slot 256 without an off-by-one refusal
  - 集成原日志行 1185：`Cannot find module 'better-sqlite3'`
  - 基线原日志行 282：`Cannot find module 'better-sqlite3'`

- **同名同错误摘要复现**：R4 raw facts preserve actual production collector and gate semantics > D13 exact structural budget stops at artifact-id before reading the next field/item
  - 集成原日志行 1221：`Cannot find module 'better-sqlite3'`
  - 基线原日志行 318：`Cannot find module 'better-sqlite3'`

- **同名同错误摘要复现**：R4 raw facts preserve actual production collector and gate semantics > D13 exact structural budget stops at artifact-label before reading the next field/item
  - 集成原日志行 1225：`Cannot find module 'better-sqlite3'`
  - 基线原日志行 322：`Cannot find module 'better-sqlite3'`

- **同名同错误摘要复现**：R4 raw facts preserve actual production collector and gate semantics > D13 exact structural budget stops at file-path before reading the next field/item
  - 集成原日志行 1237：`Cannot find module 'better-sqlite3'`
  - 基线原日志行 334：`Cannot find module 'better-sqlite3'`

- **同名同错误摘要复现**：R4 raw facts preserve actual production collector and gate semantics > D13 exact structural budget stops at goal-invocation before reading the next field/item
  - 集成原日志行 1229：`Cannot find module 'better-sqlite3'`
  - 基线原日志行 326：`Cannot find module 'better-sqlite3'`

- **同名同错误摘要复现**：R4 raw facts preserve actual production collector and gate semantics > D13 exact structural budget stops at plan-step before reading the next field/item
  - 集成原日志行 1233：`Cannot find module 'better-sqlite3'`
  - 基线原日志行 330：`Cannot find module 'better-sqlite3'`

- **同名同错误摘要复现**：R4 raw facts preserve actual production collector and gate semantics > D13 exact structural budget stops at result-artifact-id before reading the next field/item
  - 集成原日志行 1245：`Cannot find module 'better-sqlite3'`
  - 基线原日志行 342：`Cannot find module 'better-sqlite3'`

- **同名同错误摘要复现**：R4 raw facts preserve actual production collector and gate semantics > D13 exact structural budget stops at result-summary before reading the next field/item
  - 集成原日志行 1241：`Cannot find module 'better-sqlite3'`
  - 基线原日志行 338：`Cannot find module 'better-sqlite3'`

- **同名同错误摘要复现**：R4 raw facts preserve actual production collector and gate semantics > D13 mixed fixed-schema JSON accepts exactly the wire limit plus -1 bytes, without omitting fields
  - 集成原日志行 1249：`Cannot find module 'better-sqlite3'`
  - 基线原日志行 346：`Cannot find module 'better-sqlite3'`

- **同名同错误摘要复现**：R4 raw facts preserve actual production collector and gate semantics > D13 mixed fixed-schema JSON accepts exactly the wire limit plus 0 bytes, without omitting fields
  - 集成原日志行 1253：`Cannot find module 'better-sqlite3'`
  - 基线原日志行 350：`Cannot find module 'better-sqlite3'`

- **同名同错误摘要复现**：R4 raw facts preserve actual production collector and gate semantics > D13 mixed fixed-schema JSON accepts exactly the wire limit plus 1 bytes, without omitting fields
  - 集成原日志行 1257：`Cannot find module 'better-sqlite3'`
  - 基线原日志行 354：`Cannot find module 'better-sqlite3'`

- **同名同错误摘要复现**：R4 raw facts preserve actual production collector and gate semantics > D13 non-retained assistant_delta after slot 256 is ignored without payload access or a false limit failure
  - 集成原日志行 1213：`Cannot find module 'better-sqlite3'`
  - 基线原日志行 310：`Cannot find module 'better-sqlite3'`

- **同名同错误摘要复现**：R4 raw facts preserve actual production collector and gate semantics > D13 non-retained canvas_tool_call after slot 256 is ignored without payload access or a false limit failure
  - 集成原日志行 1205：`Cannot find module 'better-sqlite3'`
  - 基线原日志行 302：`Cannot find module 'better-sqlite3'`

- **同名同错误摘要复现**：R4 raw facts preserve actual production collector and gate semantics > D13 non-retained canvas_tool_result after slot 256 is ignored without payload access or a false limit failure
  - 集成原日志行 1209：`Cannot find module 'better-sqlite3'`
  - 基线原日志行 306：`Cannot find module 'better-sqlite3'`

- **同名同错误摘要复现**：R4 raw facts preserve actual production collector and gate semantics > D13 non-retained goal_tool_fact after slot 256 is ignored without payload access or a false limit failure
  - 集成原日志行 1201：`Cannot find module 'better-sqlite3'`
  - 基线原日志行 298：`Cannot find module 'better-sqlite3'`

- **同名同错误摘要复现**：R4 raw facts preserve actual production collector and gate semantics > D13 non-retained progress after slot 256 is ignored without payload access or a false limit failure
  - 集成原日志行 1217：`Cannot find module 'better-sqlite3'`
  - 基线原日志行 314：`Cannot find module 'better-sqlite3'`

- **同名同错误摘要复现**：R4 raw facts preserve actual production collector and gate semantics > D13 retained fact 257 (artifact_recorded) refuses before reading its payload
  - 集成原日志行 1157：`Cannot find module 'better-sqlite3'`
  - 基线原日志行 254：`Cannot find module 'better-sqlite3'`

- **同名同错误摘要复现**：R4 raw facts preserve actual production collector and gate semantics > D13 retained fact 257 (assistant_delta) refuses before reading its payload
  - 集成原日志行 1181：`Cannot find module 'better-sqlite3'`
  - 基线原日志行 278：`Cannot find module 'better-sqlite3'`

- **同名同错误摘要复现**：R4 raw facts preserve actual production collector and gate semantics > D13 retained fact 257 (canvas_file_changed) refuses before reading its payload
  - 集成原日志行 1161：`Cannot find module 'better-sqlite3'`
  - 基线原日志行 258：`Cannot find module 'better-sqlite3'`

- **同名同错误摘要复现**：R4 raw facts preserve actual production collector and gate semantics > D13 retained fact 257 (canvas_tool_call) refuses before reading its payload
  - 集成原日志行 1177：`Cannot find module 'better-sqlite3'`
  - 基线原日志行 274：`Cannot find module 'better-sqlite3'`

- **同名同错误摘要复现**：R4 raw facts preserve actual production collector and gate semantics > D13 retained fact 257 (canvas_tool_result) refuses before reading its payload
  - 集成原日志行 1173：`Cannot find module 'better-sqlite3'`
  - 基线原日志行 270：`Cannot find module 'better-sqlite3'`

- **同名同错误摘要复现**：R4 raw facts preserve actual production collector and gate semantics > D13 retained fact 257 (goal_tool_fact) refuses before reading its payload
  - 集成原日志行 1165：`Cannot find module 'better-sqlite3'`
  - 基线原日志行 262：`Cannot find module 'better-sqlite3'`

- **同名同错误摘要复现**：R4 raw facts preserve actual production collector and gate semantics > D13 retained fact 257 (goal_tool_finished) refuses before reading its payload
  - 集成原日志行 1169：`Cannot find module 'better-sqlite3'`
  - 基线原日志行 266：`Cannot find module 'better-sqlite3'`

- **同名同错误摘要复现**：R4 raw facts preserve actual production collector and gate semantics > D13 retained fact 257 (progress_plan_reported) refuses before reading its payload
  - 集成原日志行 1153：`Cannot find module 'better-sqlite3'`
  - 基线原日志行 250：`Cannot find module 'better-sqlite3'`

- **同名同错误摘要复现**：R4 raw facts preserve actual production collector and gate semantics > D13 retained fact 257 (result) refuses before reading its payload
  - 集成原日志行 1149：`Cannot find module 'better-sqlite3'`
  - 基线原日志行 246：`Cannot find module 'better-sqlite3'`

- **同名同错误摘要复现**：R4 raw facts preserve actual production collector and gate semantics > D14 file-uri matches unmodified ordinary production helpers, not a test classifier
  - 集成原日志行 1121：`Cannot find module 'better-sqlite3'`
  - 基线原日志行 218：`Cannot find module 'better-sqlite3'`

- **同名同错误摘要复现**：R4 raw facts preserve actual production collector and gate semantics > D14 multiple-result-indices matches unmodified ordinary production helpers, not a test classifier
  - 集成原日志行 1109：`Cannot find module 'better-sqlite3'`
  - 基线原日志行 206：`Cannot find module 'better-sqlite3'`

- **同名同错误摘要复现**：R4 raw facts preserve actual production collector and gate semantics > D14 no-result matches unmodified ordinary production helpers, not a test classifier
  - 集成原日志行 1133：`Cannot find module 'better-sqlite3'`
  - 基线原日志行 230：`Cannot find module 'better-sqlite3'`

- **同名同错误摘要复现**：R4 raw facts preserve actual production collector and gate semantics > D14 null-result matches unmodified ordinary production helpers, not a test classifier
  - 集成原日志行 1137：`Cannot find module 'better-sqlite3'`
  - 基线原日志行 234：`Cannot find module 'better-sqlite3'`

- **同名同错误摘要复现**：R4 raw facts preserve actual production collector and gate semantics > D14 project matches unmodified ordinary production helpers, not a test classifier
  - 集成原日志行 1129：`Cannot find module 'better-sqlite3'`
  - 基线原日志行 226：`Cannot find module 'better-sqlite3'`

- **同名同错误摘要复现**：R4 raw facts preserve actual production collector and gate semantics > D14 repeated-plan-last-wins matches unmodified ordinary production helpers, not a test classifier
  - 集成原日志行 1113：`Cannot find module 'better-sqlite3'`
  - 基线原日志行 210：`Cannot find module 'better-sqlite3'`

- **同名同错误摘要复现**：R4 raw facts preserve actual production collector and gate semantics > D14 result-artifacts matches unmodified ordinary production helpers, not a test classifier
  - 集成原日志行 1125：`Cannot find module 'better-sqlite3'`
  - 基线原日志行 222：`Cannot find module 'better-sqlite3'`

- **同名同错误摘要复现**：R4 raw facts preserve actual production collector and gate semantics > D14 same-invocation-last-wins matches unmodified ordinary production helpers, not a test classifier
  - 集成原日志行 1117：`Cannot find module 'better-sqlite3'`
  - 基线原日志行 214：`Cannot find module 'better-sqlite3'`
### desktop-runner-finalization.test.ts

集成：`❯ tests/main/desktop-runner-finalization.test.ts (2 tests | 2 failed) 605ms`

基线：`❯ tests/main/desktop-runner-finalization.test.ts (2 tests | 2 failed) 448ms`

- **同名同错误摘要复现**：desktop runner finalization > runs a no-tool finalization turn at an explicit limit but does not report the exhausted task as completed
  - 集成原日志行 1276：`expected [Function] to throw error including 'desktop_task_failed' but got 'KSwarm service unavailable: failed to…'`
  - 基线原日志行 371：`expected [Function] to throw error including 'desktop_task_failed' but got 'KSwarm service unavailable: failed to…'`

- **同名同错误摘要复现**：desktop runner finalization > runs a no-tool finalization turn when the model returns an empty turn after tool results
  - 集成原日志行 1278：`KSwarm service unavailable: failed to kill stale kswarm service on port 4400: existing kswarm service on port 4400 is not the bundled service; reason=entry_path_mismatch; expectedEntryPath=<local-user>/projects/.worktrees/pi-durable-optimization-20261021/kswarm/src/server/index.js; actualEntryPath=<local-user>/projects/kswarm/src/server/index.js; expectedSourceHash=ba0829d54cfbbe9e87e47ad2362b7c860247969380ead088e179697f18cf9189; actualSourceHash=ba0829d54cfbbe9e87e47ad2362b7c860247969380ead088e179697f18cf9189`
  - 基线原日志行 373：`KSwarm service unavailable: failed to kill stale kswarm service on port 4400: existing kswarm service on port 4400 is not the bundled service; reason=entry_path_mismatch; expectedEntryPath=<local-user>/projects/.worktrees/pi-durable-optimization-20261021/kswarm/src/server/index.js; actualEntryPath=<local-user>/projects/kswarm/src/server/index.js; expectedSourceHash=ba0829d54cfbbe9e87e47ad2362b7c860247969380ead088e179697f18cf9189; actualSourceHash=ba0829d54cfbbe9e87e47ad2362b7c860247969380ead088e179697f18cf9189`



## 两个原集成独有timeout的单worker配对补测

按原断言、原5000ms timeout，先集成再同master基线，均`--maxWorkers=1`，仅名称筛选marker-committed/snapshot；未同时运行两组。

- `post-seal-paired-integration`：2 passed / 15 testNamePattern过滤skip，exit0；runnerPid15188、child/PGID15200/15200，reaped=True；登记PGID组剩余0。log SHA256 `7cb72420ee3b0c0cd03296f931a57565beab2a511dcaaf30bcc2b0c26e2756fc`，json SHA256 `94dd036dbaaae5427ea251ca8af6ca022db452a6e1341669f8ee152ab1fc3c33`。

- `post-seal-paired-baseline`：2 passed / 15 testNamePattern过滤skip，exit0；runnerPid16061、child/PGID16069/16069，reaped=True；登记PGID组剩余0。log SHA256 `080e9146ef4df997eacf7370283b3db8109bccf0db976086468bb49451ec7199`，json SHA256 `8c361261b1f2afd4ef25712c00ca6f8a76c5dbfba84398d5e4c093c296891f3a`。

两组均记录各自实际fixture ownerPid的SIGKILL、committedMarker=true和terminalCount=1。本次均未复现原集成全量的两个timeout；**单次通过不证明稳定性或根因已排除**。先前全量失败事实不删除、不改成通过，也不把15个名称过滤skip当作完成验证。

当前从主笔全量日志已输出32个失败/套件错误文件中，排除首批5、3个取消及services，共23个未覆盖文件已交给`desktop-new-baseline`原环境运行；其结果另附，不能用上面的2case通过代替。


## 第二批：23个新增失败/套件错误文件的master基线

从原全量日志当时已输出的32个失败/套件错误文件中排除首批5、3个取消及services后，冻结以下23文件运行；后续全量新增失败不包含在此批。23个测试文件与集成工作树逐字节相同。

使用同一绝对runner label `desktop-new-baseline`，baseline/desktop原环境、Node24、原文件/断言/timeout，`--maxWorkers=2`。完整argv见JSON，未设置NODE_PATH、未build/prepare或修改依赖。实际exit1：**22文件失败、1通过；118 failed / 78 passed / 33 skipped / 229**。

集成日志已输出的对应23文件计**119 failed / 77 passed / 33 skipped / 229**；其中artifact-export-process为suite启动错误而31条skip，不计成31条测试失败。

| 文件 | 集成测试失败 | 基线测试失败 | 同名同错误摘要原文 |
|---|---:|---:|---:|
| `artifact-export-package.test.ts` | 1 | 1 | 1 |
| `artifact-export-process.test.ts` | 0 | 0 | 0 |
| `semantic-product-runtime.test.ts` | 2 | 2 | 2 |
| `room-field-classification.test.ts` | 4 | 4 | 4 |
| `rejected-bridge-gateway-ownership.test.ts` | 6 | 6 | 6 |
| `python-preparation-main-lifetime.test.ts` | 11 | 11 | 11 |
| `loop-verification-execution-controller.test.ts` | 5 | 5 | 5 |
| `desktop-post-seal-io.bdd.test.ts` | 1 | 1 | 1 |
| `desktop-multi-agent-approval-wire-budget.bdd.test.ts` | 1 | 0 | 0 |
| `desktop-host-cancellation-buffered-timer-boundary.bdd.test.ts` | 1 | 1 | 1 |
| `desktop-post-seal-verifier-policy.bdd.test.ts` | 6 | 6 | 6 |
| `desktop-post-seal-input-errors.bdd.test.ts` | 7 | 7 | 7 |
| `desktop-history-publication-basis.test.ts` | 3 | 3 | 0 |
| `workflow-stored-restrictions-held.test.ts` | 4 | 4 | 4 |
| `workflow-stored-restrictions-denials.test.ts` | 9 | 9 | 9 |
| `workflow-stored-restrictions-effects.test.ts` | 4 | 4 | 4 |
| `mcp-registration-main-ownership.test.ts` | 13 | 13 | 13 |
| `goal-attachment-ipc-contract.bdd.test.ts` | 24 | 24 | 24 |
| `mcp-registration-actual-main.test.ts` | 6 | 6 | 6 |
| `mcp-registration-promise-admission.test.ts` | 5 | 5 | 5 |
| `workflow-review-mode.test.ts` | 3 | 3 | 3 |
| `workflow-stored-restrictions-partial-denial.test.ts` | 2 | 2 | 2 |
| `desktop-authorization-approval-design-gate.test.ts` | 1 | 1 | 0 |
| 合计 | 119 | 118 | 114 |

**114项**逐名及箭头错误原文相同。另4项非原文完全相同：设计gate1项只差checkout根路径，均缺同一`docs/design/2026-09-07-desktop-authorization-approval-joint-manifest.json`；history-publication-basis3项只差随机临时account目录，均ENOENT lstat该account的`.cache`。两边实际原文均在下面保留，不将路径归一化后的相似误称逐字节相同。

集成独有失败仍为 `desktop-multi-agent-approval-wire-budget.bdd.test.ts` 的AP6，原文`expected false to be true // Object.is equality`；本轮baseline该唯一case通过。不能仅凭本批其他项目复现，就认定它既有或已稳定通过。

artifact-export-process两边均suite失败+31skip；基线最终详情显示`.artifacts/artifact-export-helper/darwin-arm64/current.json`缺失，集成原全量尚未提供同一时点的最终suite FAIL stack时，保留因果未完全核对的限制。

### 显式NODE_PATH补充定位，不覆盖原环境失败

仅对首批`desktop-post-seal-facts.bdd.test.ts`另建两条runner：`env NODE_PATH=<worktree>/node_modules node node_modules/vitest/vitest.mjs run tests/main/desktop-post-seal-facts.bdd.test.ts --maxWorkers=1`，先baseline后integration。两边各38/38通过、exit0。这支持原38条`Cannot find module 'better-sqlite3'`由临时mjs helper的模块查找路径造成；并不证明生产包依赖已经完备，原环境失败日志不删除、不改成绿。

没有修改代码、生产包/权限、共享node_modules或4400服务。所有本席runner收尾只查登记PGID，不执行模糊kill。

### 本批runner与原始证据

- `desktop-new-baseline`：runnerPid17073，child/PGID17074/17074，exit1，reaped=True；登记PGID当前剩余0。log SHA256 `278842ad552f941a1020098f9b6140a8d069cdeb34365eb8a69a2bf0e094f24f`，json SHA256 `e3c5bada409f2e847793f1304cd78b55b052ee625bf258cb909f802953073d83`。
- `desktop-facts-nodepath-baseline`：runnerPid28505，child/PGID28513/28513，exit0，reaped=True；登记PGID当前剩余0。log SHA256 `4d1983f7879750c03ad10b10795671c2a9a8abc9f11b0590997f7185af78838a`，json SHA256 `a530e6312173afce0b0855ba929d612f13ee99a411f1a8e4d1425750bc7f6c8c`。
- `desktop-facts-nodepath-integration`：runnerPid28964，child/PGID28972/28972，exit0，reaped=True；登记PGID当前剩余0。log SHA256 `c3858023d3a9c6a124b85e791fafb5f0db2534f97044c5de8d72eea6a4313d28`，json SHA256 `c8201263e2158ff6a0b3c3842da38ed528fb292eec2a0f86a1dd501bc77878ef`。

本次读取原全量log SHA256 `945537748a93181e10a7a35b6fbfcd19e0fb634f1399be9fb6af442d79f42636`；若主笔runner仍追加，后续SHA与最终失败清单需重新核对。不能把本批结果外推为全部Desktop失败已归因。

### 第二批逐项mapping


### 新增对照：artifact-export-package.test.ts

集成：`❯ tests/main/artifact-export-package.test.ts (40 tests | 1 failed | 1 skipped) 258ms`

基线：`❯ tests/main/artifact-export-package.test.ts (40 tests | 1 failed | 1 skipped) 262ms`

- **同名同错误摘要**：the single afterPack entry retains both existing gates before the helper gate
  - 集成行2104：`The "path" argument must be of type string. Received undefined`
  - 基线行56：`The "path" argument must be of type string. Received undefined`

### 新增对照：artifact-export-process.test.ts

集成：`❯ tests/main/artifact-export-process.test.ts (31 tests | 31 skipped) 2ms`

基线：`❯ tests/main/artifact-export-process.test.ts (31 tests | 31 skipped) 3ms`

本文件为suite启动失败、31条skip；非31条测试失败。基线FAIL详情为缺`.artifacts/artifact-export-helper/darwin-arm64/current.json`，不以原全量尚未结束的缺最终stack材料推断完全同因。

### 新增对照：semantic-product-runtime.test.ts

集成：`❯ tests/main/semantic-product-runtime.test.ts (3 tests | 2 failed | 1 skipped) 3ms`

基线：`❯ tests/main/semantic-product-runtime.test.ts (3 tests | 2 failed | 1 skipped) 6ms`

- **同名同错误摘要**：actual managed group semantic boundary: new-input
  - 集成行2167：`actual product capacity environment required`
  - 基线行106：`actual product capacity environment required`

- **同名同错误摘要**：actual managed group semantic boundary: stable
  - 集成行2165：`actual product capacity environment required`
  - 基线行104：`actual product capacity environment required`

### 新增对照：room-field-classification.test.ts

集成：`❯ tests/main/room-field-classification.test.ts (19 tests | 4 failed) 677ms`

基线：`❯ tests/main/room-field-classification.test.ts (19 tests | 4 failed) 601ms`

- **同名同错误摘要**：Room field classification contracts > covers actual RoomWorkspaceArtifact keys at runtime
  - 集成行2781：`expected [ 'artifactId', 'bindingId', …(12) ] to deeply equal [ 'artifactId', 'bindingId', …(23) ]`
  - 基线行148：`expected [ 'artifactId', 'bindingId', …(12) ] to deeply equal [ 'artifactId', 'bindingId', …(23) ]`

- **同名同错误摘要**：Room field classification contracts > covers actual RoomWorkspaceClaim keys at runtime
  - 集成行2779：`expected [ 'agentName', …(7) ] to deeply equal [ 'acquireDigest', 'agentName', …(30) ]`
  - 基线行146：`expected [ 'agentName', …(7) ] to deeply equal [ 'acquireDigest', 'agentName', …(30) ]`

- **同名同错误摘要**：Room field classification contracts > covers actual RoomWorkspaceInstructions keys at runtime
  - 集成行2777：`expected [ 'candidateHash', …(6) ] to deeply equal [ 'candidateHash', …(12) ]`
  - 基线行144：`expected [ 'candidateHash', …(6) ] to deeply equal [ 'candidateHash', …(12) ]`

- **同名同错误摘要**：Room field classification contracts > type-level key equality assertions compile
  - 集成行2770：`expected [ …(3) ] to deeply equal []`
  - 基线行137：`expected [ …(3) ] to deeply equal []`

### 新增对照：rejected-bridge-gateway-ownership.test.ts

集成：`❯ tests/main/rejected-bridge-gateway-ownership.test.ts (6 tests | 6 failed) 6ms`

基线：`❯ tests/main/rejected-bridge-gateway-ownership.test.ts (6 tests | 6 failed) 9ms`

- **同名同错误摘要**：G1 actual Main starts gateway then relay/MCP before held raw join; prefix sees pre-registered final fallback
  - 集成行2794：`r324_actual_Main_source_binding_NOT_READY`
  - 基线行161：`r324_actual_Main_source_binding_NOT_READY`

- **同名同错误摘要**：G2 actual Main logs gateway original E once and retains exact E on group/final failure ACK
  - 集成行2796：`r324_actual_Main_source_binding_NOT_READY`
  - 基线行163：`r324_actual_Main_source_binding_NOT_READY`

- **同名同错误摘要**：G3 gateway E/log L plus relay S remain ordered original errors; relay throw still skips normal MCP and final fallback retires once
  - 集成行2798：`r324_actual_Main_source_binding_NOT_READY`
  - 基线行165：`r324_actual_Main_source_binding_NOT_READY`

- **同名同错误摘要**：G4 MCP rejects first while gateway held: actual group and final fallback still join original gateway before completing
  - 集成行2800：`r324_actual_Main_source_binding_NOT_READY`
  - 基线行167：`r324_actual_Main_source_binding_NOT_READY`

- **同名同错误摘要**：G5 actual stop waits every returned raw after one rejection; pending does not advance dependent closes
  - 集成行2802：`r334_actual_Main_binding_NOT_READY`
  - 基线行169：`r334_actual_Main_binding_NOT_READY`

- **同名同错误摘要**：G6 actual stop sync pre-effect throw can leave a client unsealed: no new dependent release; existing MCP fallback is not qualification
  - 集成行2804：`r334_actual_Main_binding_NOT_READY`
  - 基线行171：`r334_actual_Main_binding_NOT_READY`

### 新增对照：python-preparation-main-lifetime.test.ts

集成：`❯ tests/main/python-preparation-main-lifetime.test.ts (11 tests | 11 failed) 9ms`

基线：`❯ tests/main/python-preparation-main-lifetime.test.ts (11 tests | 11 failed) 12ms`

- **同名同错误摘要**：P1 real Main reserves the actual gate/lifetime before invoking prepare and retains the same lifecycle Promise until its provided raw settles
  - 集成行2807：`office_python_Main_source_binding_NOT_READY:post`
  - 基线行174：`office_python_Main_source_binding_NOT_READY:post`

- **同名同错误摘要**：P2 real Main owns the actual fallback registration raw and preserves its exact rejection reason on the lifecycle Promise
  - 集成行2811：`office_python_Main_source_binding_NOT_READY:post`
  - 基线行178：`office_python_Main_source_binding_NOT_READY:post`

- **同名同错误摘要**：P2a a genuine prepare raw rejection after gate closure remains the identical lifecycle reason instead of a successful retirement
  - 集成行2809：`office_python_Main_source_binding_NOT_READY:post`
  - 基线行176：`office_python_Main_source_binding_NOT_READY:post`

- **同名同错误摘要**：P3 gate closes while prepare is held: actual lifetime blocks close and no new register/provider starts after settlement
  - 集成行2813：`office_python_Main_source_binding_NOT_READY:post`
  - 基线行180：`office_python_Main_source_binding_NOT_READY:post`

- **同名同错误摘要**：P4 gate closes at the real registration await: no new deferred registration/provider is started
  - 集成行2815：`office_python_Main_source_binding_NOT_READY:post`
  - 基线行182：`office_python_Main_source_binding_NOT_READY:post`

- **同名同错误摘要**：P5 an already-started deferred registration remains in the real raw chain; closing then forbids a new provider
  - 集成行2817：`office_python_Main_source_binding_NOT_READY:post`
  - 基线行184：`office_python_Main_source_binding_NOT_READY:post`

- **同名同错误摘要**：P6 repeated actual Main segment calls register two independent retirements; repeated close waits both and memoizes the coordinator result
  - 集成行2819：`office_python_Main_source_binding_NOT_READY:post`
  - 基线行186：`office_python_Main_source_binding_NOT_READY:post`

- **同名同错误摘要**：P7 synchronous producer-prefix close sees the already-registered actual token/reservation and cannot complete before that raw
  - 集成行2821：`office_python_Main_source_binding_NOT_READY:post`
  - 基线行188：`office_python_Main_source_binding_NOT_READY:post`

- **同名同错误摘要**：P8 actual original default 5000ms cap expiring does not make a held Python raw quiescent or close stores
  - 集成行2823：`office_python_Main_source_binding_NOT_READY:post`
  - 基线行190：`office_python_Main_source_binding_NOT_READY:post`

- **同名同错误摘要**：P9 a previously closed real gate refuses this Main Python segment before any producer/lifetime allocation
  - 集成行2825：`office_python_Main_source_binding_NOT_READY:post`
  - 基线行192：`office_python_Main_source_binding_NOT_READY:post`

- **同名同错误摘要**：R306 prepare rejected while open, then close during the real fallback registration await: retain that original prepare reason
  - 集成行2827：`office_python_Main_source_binding_NOT_READY:post`
  - 基线行194：`office_python_Main_source_binding_NOT_READY:post`

### 新增对照：loop-verification-execution-controller.test.ts

集成：`❯ tests/main/loop-verification-execution-controller.test.ts (8 tests | 5 failed) 145803ms`

基线：`❯ tests/main/loop-verification-execution-controller.test.ts (8 tests | 5 failed) 148608ms`

- **同名同错误摘要**：executes and recovers the original Loop verification through the signed controller: desktop-service
  - 集成行2860：`application_client_owner_unavailable`
  - 基线行516：`application_client_owner_unavailable`

- **同名同错误摘要**：executes and recovers the original Loop verification through the signed controller: full-projection
  - 集成行2857：`Test timed out in 30000ms.`
  - 基线行513：`Test timed out in 30000ms.`

- **同名同错误摘要**：executes and recovers the original Loop verification through the signed controller: output-consumer
  - 集成行2867：`Test timed out in 30000ms.`
  - 基线行523：`Test timed out in 30000ms.`

- **同名同错误摘要**：executes and recovers the original Loop verification through the signed controller: timed-expired
  - 集成行2865：`application_client_owner_unavailable`
  - 基线行521：`application_client_owner_unavailable`

- **同名同错误摘要**：executes and recovers the original Loop verification through the signed controller: timed-pending
  - 集成行2862：`Test timed out in 30000ms.`
  - 基线行518：`Test timed out in 30000ms.`

### 新增对照：desktop-post-seal-io.bdd.test.ts

集成：`❯ tests/main/desktop-post-seal-io.bdd.test.ts (19 tests | 1 failed) 571ms`

基线：`❯ tests/main/desktop-post-seal-io.bdd.test.ts (19 tests | 1 failed) 763ms`

- **同名同错误摘要**：R4 explicit raw async IO and unchanged guard language > D6 actual CPU Worker exit plus two native FIFO opens keep the tracked physical drain pending after outward failure
  - 集成行3382：`Cannot find module 'better-sqlite3'`
  - 基线行22：`Cannot find module 'better-sqlite3'`

### 新增对照：desktop-multi-agent-approval-wire-budget.bdd.test.ts

集成：`❯ tests/main/desktop-multi-agent-approval-wire-budget.bdd.test.ts (1 test | 1 failed) 1385ms`

基线：`✓ tests/main/desktop-multi-agent-approval-wire-budget.bdd.test.ts (1 test) 1409ms`

- **集成独有失败，本轮基线通过**：BDD AP6: real store/sender pending metadata fits the existing wire budget > Given nine real default-mode waiters and a formerly legal near-limit snapshot, Then initial reply trims only its old agent page, live approval events stay bounded, and zero pending restores the ordinary page
  - 集成行3476：`expected false to be true // Object.is equality`

### 新增对照：desktop-host-cancellation-buffered-timer-boundary.bdd.test.ts

集成：`❯ tests/main/desktop-host-cancellation-buffered-timer-boundary.bdd.test.ts (1 test | 1 failed) 4661ms`

基线：`❯ tests/main/desktop-host-cancellation-buffered-timer-boundary.bdd.test.ts (1 test | 1 failed) 3194ms`

- **同名同错误摘要**：BDD: a real buffered timer already dispatched when cancellation drains its original failure > C21 cancellation consumes an in-flight timer flush failure without losing its already-committed runtime receipt
  - 集成行4557：`expected [ …(256) ] to have a length of 255 but got 256`
  - 基线行249：`expected [ …(256) ] to have a length of 255 but got 256`

### 新增对照：desktop-post-seal-verifier-policy.bdd.test.ts

集成：`❯ tests/main/desktop-post-seal-verifier-policy.bdd.test.ts (6 tests | 6 failed) 449ms`

基线：`❯ tests/main/desktop-post-seal-verifier-policy.bdd.test.ts (6 tests | 6 failed) 444ms`

- **同名同错误摘要**：R4 verifier internal policy preserves existing host switches and plan priority > artifactEvidence=false gates only owner artifact IO, not Worker plan facts
  - 集成行4564：`Cannot find module 'better-sqlite3'`
  - 基线行475：`Cannot find module 'better-sqlite3'`

- **同名同错误摘要**：R4 verifier internal policy preserves existing host switches and plan priority > artifactEvidence=true gates only owner artifact IO, not Worker plan facts
  - 集成行4560：`Cannot find module 'better-sqlite3'`
  - 基线行471：`Cannot find module 'better-sqlite3'`

- **同名同错误摘要**：R4 verifier internal policy preserves existing host switches and plan priority > artifactEvidence=undefined gates only owner artifact IO, not Worker plan facts
  - 集成行4568：`Cannot find module 'better-sqlite3'`
  - 基线行479：`Cannot find module 'better-sqlite3'`

- **同名同错误摘要**：R4 verifier internal policy preserves existing host switches and plan priority > incomplete plan with artifactEvidence=false starts no artifact IO after the real Worker
  - 集成行4576：`Cannot find module 'better-sqlite3'`
  - 基线行487：`Cannot find module 'better-sqlite3'`

- **同名同错误摘要**：R4 verifier internal policy preserves existing host switches and plan priority > incomplete plan with artifactEvidence=true starts no artifact IO after the real Worker
  - 集成行4572：`Cannot find module 'better-sqlite3'`
  - 基线行483：`Cannot find module 'better-sqlite3'`

- **同名同错误摘要**：R4 verifier internal policy preserves existing host switches and plan priority > incomplete plan with artifactEvidence=undefined starts no artifact IO after the real Worker
  - 集成行4580：`Cannot find module 'better-sqlite3'`
  - 基线行491：`Cannot find module 'better-sqlite3'`

### 新增对照：desktop-post-seal-input-errors.bdd.test.ts

集成：`❯ tests/main/desktop-post-seal-input-errors.bdd.test.ts (7 tests | 7 failed) 519ms`

基线：`❯ tests/main/desktop-post-seal-input-errors.bdd.test.ts (7 tests | 7 failed) 494ms`

- **同名同错误摘要**：R4 fixed verifier input errors remain distinct from malformed transport > D13 locally captured empty-task-id preserves verifier_input_invalid without starting a Worker
  - 集成行4585：`Cannot find module 'better-sqlite3'`
  - 基线行305：`Cannot find module 'better-sqlite3'`

- **同名同错误摘要**：R4 fixed verifier input errors remain distinct from malformed transport > D13 locally captured wrong-prompt-type preserves verifier_input_invalid without starting a Worker
  - 集成行4589：`Cannot find module 'better-sqlite3'`
  - 基线行309：`Cannot find module 'better-sqlite3'`

- **同名同错误摘要**：R4 fixed verifier input errors remain distinct from malformed transport > D7 a real fixed CPU Worker rejects malformed input, and the parent fences its unbound fallback request ID as protocol_error
  - 集成行4593：`Cannot find module 'better-sqlite3'`
  - 基线行313：`Cannot find module 'better-sqlite3'`

- **同名同错误摘要**：R4 fixed verifier input errors remain distinct from malformed transport > D7 malformed invalid-json reply remains verifier_protocol_error, not an input rejection
  - 集成行4601：`Cannot find module 'better-sqlite3'`
  - 基线行321：`Cannot find module 'better-sqlite3'`

- **同名同错误摘要**：R4 fixed verifier input errors remain distinct from malformed transport > D7 malformed unknown-key reply remains verifier_protocol_error, not an input rejection
  - 集成行4609：`Cannot find module 'better-sqlite3'`
  - 基线行329：`Cannot find module 'better-sqlite3'`

- **同名同错误摘要**：R4 fixed verifier input errors remain distinct from malformed transport > D7 malformed wrong-request reply remains verifier_protocol_error, not an input rejection
  - 集成行4605：`Cannot find module 'better-sqlite3'`
  - 基线行325：`Cannot find module 'better-sqlite3'`

- **同名同错误摘要**：R4 fixed verifier input errors remain distinct from malformed transport > D7 the parent preserves input_invalid in a controlled, correctly bound fixed error frame
  - 集成行4597：`Cannot find module 'better-sqlite3'`
  - 基线行317：`Cannot find module 'better-sqlite3'`

### 新增对照：desktop-history-publication-basis.test.ts

集成：`❯ tests/main/desktop-history-publication-basis.test.ts (3 tests | 3 failed) 12ms`

基线：`❯ tests/main/desktop-history-publication-basis.test.ts (3 tests | 3 failed) 14ms`

- **同名但原文路径不同**：actual Desktop full-history publisher retains its exact basis: host-failure
  - 集成行4717：`ENOENT: no such file or directory, lstat '/private/var/folders/qk/0759gskn77v_x22b9xqbk_f00000gp/T/xiaok-vitest-accounts-cLJiJx/account-ZqedXm/.cache'`
  - 基线行466：`ENOENT: no such file or directory, lstat '/private/var/folders/qk/0759gskn77v_x22b9xqbk_f00000gp/T/xiaok-vitest-accounts-DuSit8/account-MdEfjO/.cache'`

- **同名但原文路径不同**：actual Desktop full-history publisher retains its exact basis: other-writer
  - 集成行4719：`ENOENT: no such file or directory, lstat '/private/var/folders/qk/0759gskn77v_x22b9xqbk_f00000gp/T/xiaok-vitest-accounts-cLJiJx/account-ZqedXm/.cache'`
  - 基线行468：`ENOENT: no such file or directory, lstat '/private/var/folders/qk/0759gskn77v_x22b9xqbk_f00000gp/T/xiaok-vitest-accounts-DuSit8/account-MdEfjO/.cache'`

- **同名但原文路径不同**：actual Desktop full-history publisher retains its exact basis: success
  - 集成行4715：`ENOENT: no such file or directory, lstat '/private/var/folders/qk/0759gskn77v_x22b9xqbk_f00000gp/T/xiaok-vitest-accounts-cLJiJx/account-ZqedXm/.cache'`
  - 基线行464：`ENOENT: no such file or directory, lstat '/private/var/folders/qk/0759gskn77v_x22b9xqbk_f00000gp/T/xiaok-vitest-accounts-DuSit8/account-MdEfjO/.cache'`

### 新增对照：workflow-stored-restrictions-held.test.ts

集成：`❯ tests/main/workflow-stored-restrictions-held.test.ts (4 tests | 4 failed) 3894ms`

基线：`❯ tests/main/workflow-stored-restrictions-held.test.ts (4 tests | 4 failed) 3430ms`

- **同名同错误摘要**：actual issued writable policy tightens at 'actual_dispatch' before its effect
  - 集成行4879：`expected [] to have a length of 1 but got +0`
  - 基线行236：`expected [] to have a length of 1 but got +0`

- **同名同错误摘要**：actual issued writable policy tightens at 'next_model_turn' before its effect
  - 集成行4881：`expected [] to have a length of 1 but got +0`
  - 基线行238：`expected [] to have a length of 1 but got +0`

- **同名同错误摘要**：actual issued writable policy tightens at 'prepared_effect' before its effect
  - 集成行4877：`expected [] to have a length of 1 but got +0`
  - 基线行234：`expected [] to have a length of 1 but got +0`

- **同名同错误摘要**：actual issued writable policy tightens at 'queued_admission' before its effect
  - 集成行4883：`expected +0 to be 1 // Object.is equality`
  - 基线行240：`expected +0 to be 1 // Object.is equality`

### 新增对照：workflow-stored-restrictions-denials.test.ts

集成：`❯ tests/main/workflow-stored-restrictions-denials.test.ts (9 tests | 9 failed) 3141ms`

基线：`❯ tests/main/workflow-stored-restrictions-denials.test.ts (9 tests | 9 failed) 2476ms`

- **同名同错误摘要**：actual fresh restrictions deny 'cancelled' before allocating a provider
  - 集成行4908：`expected [Function] to throw error including 'workflow_stored_restrictions_denied' but got 'KSwarm service unavailable: failed to…'`
  - 基线行404：`expected [Function] to throw error including 'workflow_stored_restrictions_denied' but got 'KSwarm service unavailable: failed to…'`

- **同名同错误摘要**：actual fresh restrictions deny 'unknown_category' before allocating a provider
  - 集成行4892：`expected [Function] to throw error including 'workflow_stored_restrictions_denied' but got 'KSwarm service unavailable: failed to…'`
  - 基线行388：`expected [Function] to throw error including 'workflow_stored_restrictions_denied' but got 'KSwarm service unavailable: failed to…'`

- **同名同错误摘要**：actual fresh restrictions deny 'wrong_attempt' before allocating a provider
  - 集成行4896：`expected [Function] to throw error including 'workflow_stored_restrictions_denied' but got 'KSwarm service unavailable: failed to…'`
  - 基线行392：`expected [Function] to throw error including 'workflow_stored_restrictions_denied' but got 'KSwarm service unavailable: failed to…'`

- **同名同错误摘要**：actual fresh restrictions deny 'wrong_handoff' before allocating a provider
  - 集成行4898：`expected [Function] to throw error including 'workflow_stored_restrictions_denied' but got 'KSwarm service unavailable: failed to…'`
  - 基线行394：`expected [Function] to throw error including 'workflow_stored_restrictions_denied' but got 'KSwarm service unavailable: failed to…'`

- **同名同错误摘要**：actual fresh restrictions deny 'wrong_kind' before allocating a provider
  - 集成行4894：`expected [Function] to throw error including 'workflow_stored_restrictions_denied' but got 'KSwarm service unavailable: failed to…'`
  - 基线行390：`expected [Function] to throw error including 'workflow_stored_restrictions_denied' but got 'KSwarm service unavailable: failed to…'`

- **同名同错误摘要**：actual fresh restrictions deny 'wrong_node' before allocating a provider
  - 集成行4904：`expected [Function] to throw error including 'workflow_stored_restrictions_denied' but got 'KSwarm service unavailable: failed to…'`
  - 基线行400：`expected [Function] to throw error including 'workflow_stored_restrictions_denied' but got 'KSwarm service unavailable: failed to…'`

- **同名同错误摘要**：actual fresh restrictions deny 'wrong_participant' before allocating a provider
  - 集成行4900：`expected [Function] to throw error including 'workflow_stored_restrictions_denied' but got 'KSwarm service unavailable: failed to…'`
  - 基线行396：`expected [Function] to throw error including 'workflow_stored_restrictions_denied' but got 'KSwarm service unavailable: failed to…'`

- **同名同错误摘要**：actual fresh restrictions deny 'wrong_root' before allocating a provider
  - 集成行4906：`expected [Function] to throw error including 'workflow_stored_restrictions_denied' but got 'KSwarm service unavailable: failed to…'`
  - 基线行402：`expected [Function] to throw error including 'workflow_stored_restrictions_denied' but got 'KSwarm service unavailable: failed to…'`

- **同名同错误摘要**：actual fresh restrictions deny 'wrong_run' before allocating a provider
  - 集成行4902：`expected [Function] to throw error including 'workflow_stored_restrictions_denied' but got 'KSwarm service unavailable: failed to…'`
  - 基线行398：`expected [Function] to throw error including 'workflow_stored_restrictions_denied' but got 'KSwarm service unavailable: failed to…'`

### 新增对照：workflow-stored-restrictions-effects.test.ts

集成：`❯ tests/main/workflow-stored-restrictions-effects.test.ts (4 tests | 4 failed) 1971ms`

基线：`❯ tests/main/workflow-stored-restrictions-effects.test.ts (4 tests | 4 failed) 1225ms`

- **同名同错误摘要**：actual issuer/network/main/native effects permissions=null desiredReadonly=false
  - 集成行4936：`KSwarm service unavailable: failed to kill stale kswarm service on port 4400: existing kswarm service on port 4400 is not the bundled service; reason=entry_path_mismatch; expectedEntryPath=<local-user>/projects/.worktrees/pi-durable-optimization-20261021/kswarm/src/server/index.js; actualEntryPath=<local-user>/projects/kswarm/src/server/index.js; expectedSourceHash=ba0829d54cfbbe9e87e47ad2362b7c860247969380ead088e179697f18cf9189; actualSourceHash=ba0829d54cfbbe9e87e47ad2362b7c860247969380ead088e179697f18cf9189`
  - 基线行431：`KSwarm service unavailable: failed to kill stale kswarm service on port 4400: existing kswarm service on port 4400 is not the bundled service; reason=entry_path_mismatch; expectedEntryPath=<local-user>/projects/.worktrees/pi-durable-optimization-20261021/kswarm/src/server/index.js; actualEntryPath=<local-user>/projects/kswarm/src/server/index.js; expectedSourceHash=ba0829d54cfbbe9e87e47ad2362b7c860247969380ead088e179697f18cf9189; actualSourceHash=ba0829d54cfbbe9e87e47ad2362b7c860247969380ead088e179697f18cf9189`

- **同名同错误摘要**：actual issuer/network/main/native effects permissions=null desiredReadonly=true
  - 集成行4942：`KSwarm service unavailable: failed to kill stale kswarm service on port 4400: existing kswarm service on port 4400 is not the bundled service; reason=entry_path_mismatch; expectedEntryPath=<local-user>/projects/.worktrees/pi-durable-optimization-20261021/kswarm/src/server/index.js; actualEntryPath=<local-user>/projects/kswarm/src/server/index.js; expectedSourceHash=ba0829d54cfbbe9e87e47ad2362b7c860247969380ead088e179697f18cf9189; actualSourceHash=ba0829d54cfbbe9e87e47ad2362b7c860247969380ead088e179697f18cf9189`
  - 基线行437：`KSwarm service unavailable: failed to kill stale kswarm service on port 4400: existing kswarm service on port 4400 is not the bundled service; reason=entry_path_mismatch; expectedEntryPath=<local-user>/projects/.worktrees/pi-durable-optimization-20261021/kswarm/src/server/index.js; actualEntryPath=<local-user>/projects/kswarm/src/server/index.js; expectedSourceHash=ba0829d54cfbbe9e87e47ad2362b7c860247969380ead088e179697f18cf9189; actualSourceHash=ba0829d54cfbbe9e87e47ad2362b7c860247969380ead088e179697f18cf9189`

- **同名同错误摘要**：actual issuer/network/main/native effects permissions={ Object (toolCategories) } desiredReadonly=true
  - 集成行4940：`KSwarm service unavailable: failed to kill stale kswarm service on port 4400: existing kswarm service on port 4400 is not the bundled service; reason=entry_path_mismatch; expectedEntryPath=<local-user>/projects/.worktrees/pi-durable-optimization-20261021/kswarm/src/server/index.js; actualEntryPath=<local-user>/projects/kswarm/src/server/index.js; expectedSourceHash=ba0829d54cfbbe9e87e47ad2362b7c860247969380ead088e179697f18cf9189; actualSourceHash=ba0829d54cfbbe9e87e47ad2362b7c860247969380ead088e179697f18cf9189`
  - 基线行435：`KSwarm service unavailable: failed to kill stale kswarm service on port 4400: existing kswarm service on port 4400 is not the bundled service; reason=entry_path_mismatch; expectedEntryPath=<local-user>/projects/.worktrees/pi-durable-optimization-20261021/kswarm/src/server/index.js; actualEntryPath=<local-user>/projects/kswarm/src/server/index.js; expectedSourceHash=ba0829d54cfbbe9e87e47ad2362b7c860247969380ead088e179697f18cf9189; actualSourceHash=ba0829d54cfbbe9e87e47ad2362b7c860247969380ead088e179697f18cf9189`

- **同名同错误摘要**：actual issuer/network/main/native effects permissions={ toolCategories: [ …(2) ] } desiredReadonly=false
  - 集成行4938：`KSwarm service unavailable: failed to kill stale kswarm service on port 4400: existing kswarm service on port 4400 is not the bundled service; reason=entry_path_mismatch; expectedEntryPath=<local-user>/projects/.worktrees/pi-durable-optimization-20261021/kswarm/src/server/index.js; actualEntryPath=<local-user>/projects/kswarm/src/server/index.js; expectedSourceHash=ba0829d54cfbbe9e87e47ad2362b7c860247969380ead088e179697f18cf9189; actualSourceHash=ba0829d54cfbbe9e87e47ad2362b7c860247969380ead088e179697f18cf9189`
  - 基线行433：`KSwarm service unavailable: failed to kill stale kswarm service on port 4400: existing kswarm service on port 4400 is not the bundled service; reason=entry_path_mismatch; expectedEntryPath=<local-user>/projects/.worktrees/pi-durable-optimization-20261021/kswarm/src/server/index.js; actualEntryPath=<local-user>/projects/kswarm/src/server/index.js; expectedSourceHash=ba0829d54cfbbe9e87e47ad2362b7c860247969380ead088e179697f18cf9189; actualSourceHash=ba0829d54cfbbe9e87e47ad2362b7c860247969380ead088e179697f18cf9189`

### 新增对照：mcp-registration-main-ownership.test.ts

集成：`❯ tests/main/mcp-registration-main-ownership.test.ts (14 tests | 13 failed) 59ms`

基线：`❯ tests/main/mcp-registration-main-ownership.test.ts (14 tests | 13 failed) 59ms`

- **同名同错误摘要**：BIND actual Main equals frozen candidate; Python tail is byte-preserved and actual method/cleanup binding is present
  - 集成行4953：`expected 'import { registerKswarmStatusReadonly…' to be 'import { registerKswarmStatusReadonly…' // Object.is equality`
  - 基线行109：`expected 'import { registerKswarmStatusReadonly…' to be 'import { registerKswarmStatusReadonly…' // Object.is equality`

- **同名同错误摘要**：bridge callback error after raw success cannot erase the returned disposer or masquerade as raw failure
  - 集成行4976：`r324_actual_Main_source_binding_NOT_READY`
  - 基线行132：`r324_actual_Main_source_binding_NOT_READY`

- **同名同错误摘要**：closed-before-start denies producer; synchronous ordinary callback throw retains original closing reason
  - 集成行4969：`expected [Function] to throw error including 'mcp_registration_shutdown' but got 'r324_actual_Main_source_binding_NOT_R…'`
  - 基线行125：`expected [Function] to throw error including 'mcp_registration_shutdown' but got 'r324_actual_Main_source_binding_NOT_R…'`

- **同名同错误摘要**：closing raw failure stays identical on retirement and never starts fallback
  - 集成行4963：`r324_actual_Main_source_binding_NOT_READY`
  - 基线行119：`r324_actual_Main_source_binding_NOT_READY`

- **同名同错误摘要**：diagnostic error does not replace the original closing raw reason on lifetime
  - 集成行4978：`r324_actual_Main_source_binding_NOT_READY`
  - 基线行134：`r324_actual_Main_source_binding_NOT_READY`

- **同名同错误摘要**：early final fallback covers missing/failed normal cleanup without inventing a replacement callback
  - 集成行4972：`r324_actual_Main_source_binding_NOT_READY`
  - 基线行128：`r324_actual_Main_source_binding_NOT_READY`

- **同名同错误摘要**：failed lifetime registration invokes no producer and releases the already acquired writer
  - 集成行4967：`expected a thrown error to be Error: own lifetime registration failure`
  - 基线行123：`expected a thrown error to be Error: own lifetime registration failure`

- **同名同错误摘要**：historically handled open raw failure stays false with fallback and does not turn into a later close error
  - 集成行4961：`r324_actual_Main_source_binding_NOT_READY`
  - 基线行117：`r324_actual_Main_source_binding_NOT_READY`

- **同名同错误摘要**：normal cleanup keeps bridge-stop before MCP dispose; final fallback reawaits the same close
  - 集成行4959：`r324_actual_Main_source_binding_NOT_READY`
  - 基线行115：`r324_actual_Main_source_binding_NOT_READY`

- **同名同错误摘要**：pending registration is owned before producer; late close awaits exact callback once and releases writer independently
  - 集成行4955：`r324_actual_Main_source_binding_NOT_READY`
  - 基线行111：`r324_actual_Main_source_binding_NOT_READY`

- **同名同错误摘要**：producer-prefix closure sees reservation, prevents bridge activation, and still retires returned callback
  - 集成行4957：`r324_actual_Main_source_binding_NOT_READY`
  - 基线行113：`r324_actual_Main_source_binding_NOT_READY`

- **同名同错误摘要**：reentrant dispose observes the already memoized promise rather than invoking the callback twice
  - 集成行4974：`r324_actual_Main_source_binding_NOT_READY`
  - 基线行130：`r324_actual_Main_source_binding_NOT_READY`

- **同名同错误摘要**：returned dispose rejection is not rewritten as registration failure and is invoked once
  - 集成行4965：`r324_actual_Main_source_binding_NOT_READY`
  - 基线行121：`r324_actual_Main_source_binding_NOT_READY`

### 新增对照：goal-attachment-ipc-contract.bdd.test.ts

集成：`❯ tests/main/goal-attachment-ipc-contract.bdd.test.ts (26 tests | 24 failed) 289ms`

基线：`❯ tests/main/goal-attachment-ipc-contract.bdd.test.ts (26 tests | 24 failed) 381ms`

- **同名同错误摘要**：W2-P2 packaged Goal source transport > createGoal admits the canonical request id through the actual semantic IPC parser
  - 集成行5160：`promise rejected "Error: goal_task_mutation_sender_forbidden" instead of resolving`
  - 基线行277：`promise rejected "Error: goal_task_mutation_sender_forbidden" instead of resolving`

- **同名同错误摘要**：W2-P2 packaged Goal source transport > createGoal never admits a caller-defined source or predecessor
  - 集成行5178：`expected [Function] to throw error including 'invalid_goal_field:attachmentSource' but got 'goal_task_mutation_sender_forbidden'`
  - 基线行295：`expected [Function] to throw error including 'invalid_goal_field:attachmentSource' but got 'goal_task_mutation_sender_forbidden'`

- **同名同错误摘要**：W2-P2 packaged Goal source transport > createGoal preserves the existing omitted-id caller contract
  - 集成行5166：`promise rejected "Error: goal_task_mutation_sender_forbidden" instead of resolving`
  - 基线行283：`promise rejected "Error: goal_task_mutation_sender_forbidden" instead of resolving`

- **同名同错误摘要**：W2-P2 packaged Goal source transport > createGoal rejects malformed ids before entering the service
  - 集成行5172：`expected [Function] to throw error including 'invalid_goal_request_id' but got 'goal_task_mutation_sender_forbidden'`
  - 基线行289：`expected [Function] to throw error including 'invalid_goal_request_id' but got 'goal_task_mutation_sender_forbidden'`

- **同名同错误摘要**：W2-P2 packaged Goal source transport > replaceGoal admits the canonical request id through the actual semantic IPC parser
  - 集成行5162：`promise rejected "Error: goal_task_mutation_sender_forbidden" instead of resolving`
  - 基线行279：`promise rejected "Error: goal_task_mutation_sender_forbidden" instead of resolving`

- **同名同错误摘要**：W2-P2 packaged Goal source transport > replaceGoal never admits a caller-defined source or predecessor
  - 集成行5180：`expected [Function] to throw error including 'invalid_goal_field:attachmentSource' but got 'goal_task_mutation_sender_forbidden'`
  - 基线行297：`expected [Function] to throw error including 'invalid_goal_field:attachmentSource' but got 'goal_task_mutation_sender_forbidden'`

- **同名同错误摘要**：W2-P2 packaged Goal source transport > replaceGoal preserves the existing omitted-id caller contract
  - 集成行5168：`promise rejected "Error: goal_task_mutation_sender_forbidden" instead of resolving`
  - 基线行285：`promise rejected "Error: goal_task_mutation_sender_forbidden" instead of resolving`

- **同名同错误摘要**：W2-P2 packaged Goal source transport > replaceGoal rejects malformed ids before entering the service
  - 集成行5174：`expected [Function] to throw error including 'invalid_goal_request_id' but got 'goal_task_mutation_sender_forbidden'`
  - 基线行291：`expected [Function] to throw error including 'invalid_goal_request_id' but got 'goal_task_mutation_sender_forbidden'`

- **同名同错误摘要**：W2-P2 packaged Goal source transport > resumeGoal admits the canonical request id through the actual semantic IPC parser
  - 集成行5164：`promise rejected "Error: goal_task_mutation_sender_forbidden" instead of resolving`
  - 基线行281：`promise rejected "Error: goal_task_mutation_sender_forbidden" instead of resolving`

- **同名同错误摘要**：W2-P2 packaged Goal source transport > resumeGoal never admits a caller-defined source or predecessor
  - 集成行5182：`expected [Function] to throw error including 'invalid_goal_field:attachmentSource' but got 'goal_task_mutation_sender_forbidden'`
  - 基线行299：`expected [Function] to throw error including 'invalid_goal_field:attachmentSource' but got 'goal_task_mutation_sender_forbidden'`

- **同名同错误摘要**：W2-P2 packaged Goal source transport > resumeGoal preserves the existing omitted-id caller contract
  - 集成行5170：`promise rejected "Error: goal_task_mutation_sender_forbidden" instead of resolving`
  - 基线行287：`promise rejected "Error: goal_task_mutation_sender_forbidden" instead of resolving`

- **同名同错误摘要**：W2-P2 packaged Goal source transport > resumeGoal rejects malformed ids before entering the service
  - 集成行5176：`expected [Function] to throw error including 'invalid_goal_request_id' but got 'goal_task_mutation_sender_forbidden'`
  - 基线行293：`expected [Function] to throw error including 'invalid_goal_request_id' but got 'goal_task_mutation_sender_forbidden'`

- **同名同错误摘要**：W2-P2 typed Goal source transport > createGoal admits the canonical request id through the actual semantic IPC parser
  - 集成行5135：`promise rejected "Error: goal_task_mutation_sender_forbidden" instead of resolving`
  - 基线行252：`promise rejected "Error: goal_task_mutation_sender_forbidden" instead of resolving`

- **同名同错误摘要**：W2-P2 typed Goal source transport > createGoal never admits a caller-defined source or predecessor
  - 集成行5153：`expected [Function] to throw error including 'invalid_goal_field:attachmentSource' but got 'goal_task_mutation_sender_forbidden'`
  - 基线行270：`expected [Function] to throw error including 'invalid_goal_field:attachmentSource' but got 'goal_task_mutation_sender_forbidden'`

- **同名同错误摘要**：W2-P2 typed Goal source transport > createGoal preserves the existing omitted-id caller contract
  - 集成行5141：`promise rejected "Error: goal_task_mutation_sender_forbidden" instead of resolving`
  - 基线行258：`promise rejected "Error: goal_task_mutation_sender_forbidden" instead of resolving`

- **同名同错误摘要**：W2-P2 typed Goal source transport > createGoal rejects malformed ids before entering the service
  - 集成行5147：`expected [Function] to throw error including 'invalid_goal_request_id' but got 'goal_task_mutation_sender_forbidden'`
  - 基线行264：`expected [Function] to throw error including 'invalid_goal_request_id' but got 'goal_task_mutation_sender_forbidden'`

- **同名同错误摘要**：W2-P2 typed Goal source transport > replaceGoal admits the canonical request id through the actual semantic IPC parser
  - 集成行5137：`promise rejected "Error: goal_task_mutation_sender_forbidden" instead of resolving`
  - 基线行254：`promise rejected "Error: goal_task_mutation_sender_forbidden" instead of resolving`

- **同名同错误摘要**：W2-P2 typed Goal source transport > replaceGoal never admits a caller-defined source or predecessor
  - 集成行5155：`expected [Function] to throw error including 'invalid_goal_field:attachmentSource' but got 'goal_task_mutation_sender_forbidden'`
  - 基线行272：`expected [Function] to throw error including 'invalid_goal_field:attachmentSource' but got 'goal_task_mutation_sender_forbidden'`

- **同名同错误摘要**：W2-P2 typed Goal source transport > replaceGoal preserves the existing omitted-id caller contract
  - 集成行5143：`promise rejected "Error: goal_task_mutation_sender_forbidden" instead of resolving`
  - 基线行260：`promise rejected "Error: goal_task_mutation_sender_forbidden" instead of resolving`

- **同名同错误摘要**：W2-P2 typed Goal source transport > replaceGoal rejects malformed ids before entering the service
  - 集成行5149：`expected [Function] to throw error including 'invalid_goal_request_id' but got 'goal_task_mutation_sender_forbidden'`
  - 基线行266：`expected [Function] to throw error including 'invalid_goal_request_id' but got 'goal_task_mutation_sender_forbidden'`

- **同名同错误摘要**：W2-P2 typed Goal source transport > resumeGoal admits the canonical request id through the actual semantic IPC parser
  - 集成行5139：`promise rejected "Error: goal_task_mutation_sender_forbidden" instead of resolving`
  - 基线行256：`promise rejected "Error: goal_task_mutation_sender_forbidden" instead of resolving`

- **同名同错误摘要**：W2-P2 typed Goal source transport > resumeGoal never admits a caller-defined source or predecessor
  - 集成行5157：`expected [Function] to throw error including 'invalid_goal_field:attachmentSource' but got 'goal_task_mutation_sender_forbidden'`
  - 基线行274：`expected [Function] to throw error including 'invalid_goal_field:attachmentSource' but got 'goal_task_mutation_sender_forbidden'`

- **同名同错误摘要**：W2-P2 typed Goal source transport > resumeGoal preserves the existing omitted-id caller contract
  - 集成行5145：`promise rejected "Error: goal_task_mutation_sender_forbidden" instead of resolving`
  - 基线行262：`promise rejected "Error: goal_task_mutation_sender_forbidden" instead of resolving`

- **同名同错误摘要**：W2-P2 typed Goal source transport > resumeGoal rejects malformed ids before entering the service
  - 集成行5151：`expected [Function] to throw error including 'invalid_goal_request_id' but got 'goal_task_mutation_sender_forbidden'`
  - 基线行268：`expected [Function] to throw error including 'invalid_goal_request_id' but got 'goal_task_mutation_sender_forbidden'`

### 新增对照：mcp-registration-actual-main.test.ts

集成：`❯ tests/main/mcp-registration-actual-main.test.ts (6 tests | 6 failed) 5ms`

基线：`❯ tests/main/mcp-registration-actual-main.test.ts (6 tests | 6 failed) 6ms`

- **同名同错误摘要**：A1 actual Main normal lifetime awaits bridge stop before same returned MCP dispose, before later ordinary/final callbacks
  - 集成行5198：`r324_actual_Main_source_binding_NOT_READY`
  - 基线行197：`r324_actual_Main_source_binding_NOT_READY`

- **同名同错误摘要**：A2 actual Main held late registration blocks real gate drain; close then awaits that same returned dispose without starting a bridge
  - 集成行5200：`r324_actual_Main_source_binding_NOT_READY`
  - 基线行199：`r324_actual_Main_source_binding_NOT_READY`

- **同名同错误摘要**：A3 actual callsite owns real writer/final fallback before producer-prefix reentrant close and retains method receiver
  - 集成行5202：`r324_actual_Main_source_binding_NOT_READY`
  - 基线行201：`r324_actual_Main_source_binding_NOT_READY`

- **同名同错误摘要**：A4 actual callsite early final fallback survives omitted later normal-cleanup installation
  - 集成行5204：`r324_actual_Main_source_binding_NOT_READY`
  - 基线行203：`r324_actual_Main_source_binding_NOT_READY`

- **同名同错误摘要**：A5 actual kswarm lifetime stop rejection does not skip same MCP fallback in real independent step traversal
  - 集成行5206：`r324_actual_Main_source_binding_NOT_READY`
  - 基线行205：`r324_actual_Main_source_binding_NOT_READY`

- **同名同错误摘要**：A6 actual closing raw failure reaches real lifetime with identical memo reason and no invented disposer
  - 集成行5208：`r324_actual_Main_source_binding_NOT_READY`
  - 基线行207：`r324_actual_Main_source_binding_NOT_READY`

### 新增对照：mcp-registration-promise-admission.test.ts

集成：`❯ tests/main/mcp-registration-promise-admission.test.ts (5 tests | 5 failed) 4ms`

基线：`❯ tests/main/mcp-registration-promise-admission.test.ts (5 tests | 5 failed) 5ms`

- **同名同错误摘要**：N7 actual Main constructor admission invokes getter0 and callback effect0 before ownership/producer
  - 集成行5276：`r324_actual_Main_source_binding_NOT_READY`
  - 基线行502：`r324_actual_Main_source_binding_NOT_READY`

- **同名同错误摘要**：N7 actual Main global-accessor admission invokes getter0 and callback effect0 before ownership/producer
  - 集成行5270：`r324_actual_Main_source_binding_NOT_READY`
  - 基线行496：`r324_actual_Main_source_binding_NOT_READY`

- **同名同错误摘要**：N7 actual Main global-value admission invokes getter0 and callback effect0 before ownership/producer
  - 集成行5272：`r324_actual_Main_source_binding_NOT_READY`
  - 基线行498：`r324_actual_Main_source_binding_NOT_READY`

- **同名同错误摘要**：N7 actual Main species admission invokes getter0 and callback effect0 before ownership/producer
  - 集成行5274：`r324_actual_Main_source_binding_NOT_READY`
  - 基线行500：`r324_actual_Main_source_binding_NOT_READY`

- **同名同错误摘要**：N7 actual Main then admission invokes getter0 and callback effect0 before ownership/producer
  - 集成行5278：`r324_actual_Main_source_binding_NOT_READY`
  - 基线行504：`r324_actual_Main_source_binding_NOT_READY`

### 新增对照：workflow-review-mode.test.ts

集成：`❯ tests/main/workflow-review-mode.test.ts (3 tests | 3 failed) 92ms`

基线：`❯ tests/main/workflow-review-mode.test.ts (3 tests | 3 failed) 133ms`

- **同名同错误摘要**：actual workflow 'agent_task' reads reference and preserves its intended 'write' behavior
  - 集成行5300：`kswarm_workflow_read_instance_unknown`
  - 基线行444：`kswarm_workflow_read_instance_unknown`

- **同名同错误摘要**：actual workflow 'review' reads reference and preserves its intended 'edit' behavior
  - 集成行5298：`kswarm_workflow_read_instance_unknown`
  - 基线行442：`kswarm_workflow_read_instance_unknown`

- **同名同错误摘要**：actual workflow 'review' reads reference and preserves its intended 'write' behavior
  - 集成行5296：`kswarm_workflow_read_instance_unknown`
  - 基线行440：`kswarm_workflow_read_instance_unknown`

### 新增对照：workflow-stored-restrictions-partial-denial.test.ts

集成：`❯ tests/main/workflow-stored-restrictions-partial-denial.test.ts (2 tests | 2 failed) 907ms`

基线：`❯ tests/main/workflow-stored-restrictions-partial-denial.test.ts (2 tests | 2 failed) 1008ms`

- **同名同错误摘要**：real existing aggregate partial write denial wins over node permissions null
  - 集成行5332：`expected [Function] to throw error including 'workflow_stored_restrictions_denied' but got 'KSwarm service unavailable: failed to…'`
  - 基线行459：`expected [Function] to throw error including 'workflow_stored_restrictions_denied' but got 'KSwarm service unavailable: failed to…'`

- **同名同错误摘要**：real existing aggregate partial write denial wins over node permissions { toolCategories: [ …(2) ] }
  - 集成行5334：`expected [Function] to throw error including 'workflow_stored_restrictions_denied' but got 'KSwarm service unavailable: failed to…'`
  - 基线行461：`expected [Function] to throw error including 'workflow_stored_restrictions_denied' but got 'KSwarm service unavailable: failed to…'`

### 新增对照：desktop-authorization-approval-design-gate.test.ts

集成：`❯ tests/main/desktop-authorization-approval-design-gate.test.ts (1 test | 1 failed) 2ms`

基线：`❯ tests/main/desktop-authorization-approval-design-gate.test.ts (1 test | 1 failed) 3ms`

- **同名但原文路径不同**：authorization and approval joint design baseline > both complete source documents match the same pending revision and external hash manifest
  - 集成行5383：`ENOENT: no such file or directory, open '<worktree>/docs/design/2026-09-07-desktop-authorization-approval-joint-manifest.json'`
  - 基线行507：`ENOENT: no such file or directory, open '<master-baseline>/docs/design/2026-09-07-desktop-authorization-approval-joint-manifest.json'`
