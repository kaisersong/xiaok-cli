# 独立席 C：两个未完备 root 文件的完整重跑

最终状态：**两个完整文件均已报告；结果 FAIL，不是全绿**。本次总计 39 tests：27 passed、11 failed、1 原 opt-in skipped；正常 exitCode 1、reaped true，未触发原 1800 秒外层上限。下方运行中记录及首次中断证据保留，最终逐项结论见文末。

## 原始事实保留

首次 `root-full-node24.json` 记录 npm run test:full -- --maxWorkers=2，PGID 24448，exitCode 1、reaped true；原日志保留 `Error: Channel closed` / `ERR_IPC_CHANNEL_CLOSED`。原 `blocked-worker2-intervention.json` 记录 receiver-self 超原 60000ms 后诊断/采样并对 owned PID 6497 发 SIGTERM；`blocked-worker1-intervention.json` 记录父进程退出后回收残余 owned PID 13188，case 为 actual signed controller routes full original payload pages…。

上述原日志、只读诊断、sample 与干预 JSON 没有被本席修改或覆盖。后来单 case/完整重跑即使有结果，也不能抹去首次中断记录。

## 本次执行

严格等到 `blocked-controller-integration.json`、`blocked-publication-integration.json` 两条单 case 对照都记录 reaped true 后才启动，没有与它们重复并发；未触碰另行运行的 root remaining1040 runner。

使用原 owned run.py，label `root-blocked-files-retry`；启动前确认外层保持默认 1800 秒、SOLPI_INTENT_POPULATION 未开启，未改源码、测试断言、内部 timeout、资格或 NODE_PATH。命令为：

```text
node node_modules/vitest/vitest.mjs run
  tests/runtime/intent-delegation/verification-host-controller.test.ts
  tests/runtime/verification/intent-publication-dependencies.test.ts
  --maxWorkers=2
```

runner PID 69440，测试主 PID/PGID 69441；worker PID 69474/69475。完整 argv、启动时间和最终退出/回收状态以 `root-blocked-files-retry.json` 为准，原输出为同名 `.log`。只允许按这些本次自有 PID/PGID 清理，不接管或 kill 任何共享服务。

## 运行中诊断边界

持续高 CPU、暂时没有 suite summary 不足以判死锁。主笔的只读 `blocked-retry-worker1-current.json` / `worker2-current.json` 显示两个 worker 已推进到 receiver-lost-prepare（60000ms）与 foreign subject and caller-selected inventory…（40000ms），并记录 inspector listeners 已关闭。本席据此继续完整执行，没有自行 kill，也没有把整个文件墙钟耗时误当某个 case 越限。若后续确认单 case 超其原内部期限且仍忙循环，本席先报告主笔，由主笔决定处置。

以上为运行中记录，最终结果与残留检查见文末。

## 已有精确单 case 对照（不等于两个文件完整结果）

已独立读取四条 runner JSON 与原始日志，基线固定为 `3b4061489a612337fdb2fc1eb92e96c1d4fbe9a1`，不依赖后来移动的 origin/master。

| 精确 case | 同冻结 master 基线 | integration 单 case | 当前结论 |
|---|---|---|---|
| Intent signed controller actual material and independent recipe: receiver-self | `blocked-controller-baseline`：1 passed、15 filtered skipped，49617ms，exit 0/reaped | `blocked-controller-integration`：1 failed、15 filtered skipped；原 60000ms timeout，另报 controller_ipc_aborted_unknown，exit 1/reaped | 存在未归因差异，不能写成基线同错或“只是负载” |
| actual signed controller routes full original payload pages and last complete dependency observation through fixed reader | `blocked-publication-baseline`：1 passed、22 filtered skipped，70711ms，exit 0/reaped | `blocked-publication-integration`：1 failed、22 filtered skipped；原 75000ms timeout，exit 1/reaped | 同上；filtered skip 不能计入通过 |

本席不会再启动这两个文件的完整 baseline，也不自动重复本次 1800 秒完整重跑。

主笔第二次只读 current-case 记录进一步显示在推进：`blocked-retry-worker1-later.json` 为 receiver-project-parent，原 timeout=380000；`worker2-later.json` 为 actual invocation-only append retains complete parent graph: missing-parent，原 timeout=40000。两份记录都明确 inspector listeners 已关闭。因此本次高 CPU 不能仅凭整文件墙钟归为新卡死；遵照主笔指示继续原上限，不再采样或干预。

## 已完成文件：intent-publication-dependencies

完整重跑日志现已报告该文件：23 tests、10 failed、1 skipped（即 12 passed），901699ms。原 near-limit population opt-in 仍 skip，未开启。原先被中断/单 case 超时的精确 RPC case 本轮为 **passed，74110ms**；其原单 case 75000ms timeout 和首次中断事实仍保留，不能因这次通过而删除。

本轮 10 个失败均为其他 case 的原始 timeout，见下表。没有这些 case 的完整同名 baseline 对照，不把它们当作基线同错、已修复或“只是负载”。

| 完整失败 case 名 | 原始首因 |
|---|---|
| actual original Intent dependency observation derives empty first-stage and whole parent inventory from native receipts | Test timed out in 45000ms |
| late expiration of an earlier dependency cannot be spliced into an otherwise-current parent set | Test timed out in 40000ms |
| foreign subject and caller-selected inventory cannot redefine original native dependencies | Test timed out in 40000ms |
| no qualified callback occurs after the final qualified authority clock in the dependency result | Test timed out in 40000ms |
| final authority clock expire still fences the result without a wrapper callback | Test timed out in 45000ms |
| final authority clock close still fences the result without a wrapper callback | Test timed out in 40000ms |
| whole graph read refuses actual sibling registration drift even for empty dependencies | Test timed out in 30000ms |
| actual invocation-only append retains complete parent graph: missing-sibling-edge | Test timed out in 30000ms |
| actual invocation-only append retains complete parent graph: extra-edge | Test timed out in 30000ms |
| actual invocation-only append retains complete parent graph: parent-noncanonical | Test timed out in 30000ms |

该段记录时 controller 与 runner 尚未结束；以下补充其实际最终结果，不覆盖原运行中事实。

## 最终完整文件结果

`root-blocked-files-retry.json` 最终 recorded：startedAt=`2026-10-21T20:02:00.777885+00:00`，finishedAt=`2026-10-21T20:25:33.411585+00:00`，exitCode=1、reaped=true，没有 timedOut 标记。Vitest summary 为 **2 failed files，11 failed / 27 passed / 1 skipped（39），Duration 1412.32s**。未加限时、未扩 case timeout、未打开 near-limit opt-in、未自行提前终止 worker，也没有自动再重复这轮完整验证。

| 完整文件 | 实际结果 | 文件运行时间 |
|---|---|---:|
| tests/runtime/intent-delegation/verification-host-controller.test.ts | 16 tests：15 passed、1 failed | 1409201ms |
| tests/runtime/verification/intent-publication-dependencies.test.ts | 23 tests：12 passed、10 failed、1 原 opt-in skipped | 901699ms |

controller 唯一失败的完整 case 名为 **Intent signed controller actual material and independent recipe: receiver-project**，case 报告耗时 111282ms，首因是 **controller_ipc_timeout_unknown**，栈指向 `src/runtime/verification/controller-ipc.ts:96:43`。它不是 Vitest case timeout，不能改写成“receiver-self 仍卡住”。没有这个 case 的完整同名 baseline 结果，归属继续未裁决。

原 receiver-self 本轮完整文件内通过（46157ms）；原 publication RPC case 本轮通过（74110ms）。先前同冻结 master 单 case 分别通过、integration 单 case 在原 60/75s 失败、首次 full 中断等事实均继续保留；本轮通过不能删去这些历史失败，也不足以给出“只是负载”的根因解释。

publication 当前 10 个失败的完整名字和首因已列上表，全部保留未归因。补充日志呈现细节：`final authority clock close…` 的逐 case 行是 40000ms timeout，源码原配置也是 40000ms；末尾 grouped failure section 将 expire/close 并组显示 45000ms。报告沿用逐 case 原始值，不以分组呈现覆盖它，原日志整体保留。

16 个 controller case 都有实际结果：normal、lost-dispatch、lost-prepare、lost-stage、receiver、receiver-lost-prepare、receiver-lost-ack、receiver-sqlite、receiver-self、receiver-route-switch、receiver-project-sqlite、receiver-project-parent、receiver-project-parent-sqlite、receiver-project-parent-recovery-route、receiver-project-parent-retry-route 为 passed，仅 receiver-project failed。原 380000/385000 等长 case 按原配置等待，没有因为高 CPU 表象删项或提前跳过。

这两个文件先前“尚未完成/未报告”的缺口现已补成完整运行结果；仍然有 11 个失败及 1 个未启用的明确 opt-in，不能将执行完备表述为测试通过。**本席不出具全量测试通过或发布完成票；11 个失败未归因，不据此自动认定 PR74 独有回归，也不写成基线同错。** 按任务边界，本席不再启动新的完整 baseline 或第二轮 30 分钟重跑。

## 最终回收与原始证据

本席已收取 owned runner 的最终输出；只读检查 PGID 69441 无残留进程，计数 0，无需额外 kill。没有检查、接管或终止其他 runner/共享服务。原首次 full 的 ERR_IPC_CHANNEL_CLOSED、两份 SIGTERM intervention、diagnostic/sample 文件均未动。

SHA256：

- root-blocked-files-retry.log：`626e5b0dc6918bdea9cddf6e3e4de4c234dfeb80abd147e9f285e439a056f526`。
- root-blocked-files-retry.json：`31ca17d8f12150eb68712312237ebd453f4df675bc375a0558851648c8020eb0`。
- blocked-controller-baseline.log：`9a956d337072d3e24737103bd303976285caef42f9b59f54f5218dfa87c3f423`。
- blocked-publication-baseline.log：`4061e3f8b5265e52e1eb36fe75f24312e13dea7faf3bb8c0812f655e7c224430`。
- blocked-controller-integration.log：`1eb7dfbe4a29e50064eb7a906943cbdce907ae5515ad345b0162c7572b371f5f`。
- blocked-publication-integration.log：`380788cdbefc4fc257f2a25f024eff83305fdb3ba55a2ddbbffa0e9d1706a317`。
- 原 root-full-node24.log：`c415b90dcc0b13d33ed70907aa01f7d02b4312feeef01b7f58d2b2d2b2bda547`。
- 原 blocked-worker1-intervention.json：`beba10010249e6cb57eeddff33a694876efa419eef61ecdc8e935fb92e45c402`。
- 原 blocked-worker2-intervention.json：`e6a42e5cd45668b70325cf22de1c4042893abb19acd51eb57cad51e0e1036101`。
