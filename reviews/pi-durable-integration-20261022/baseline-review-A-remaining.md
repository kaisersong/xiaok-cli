# A 席：root remaining 分区监测与基线对照

本文件已完成本轮 remaining 监测和七批 baseline 对照，**不是全量通过报告或最终完整 HEAD 批准票**。原始 `root-full-node24.log` 的六个已知失败文件与 `root-full-remaining-node24.log` 的新失败分别统计；suite-only 失败（即使所有 case 显示 skipped）不得漏记。初始94文件统计已在下文更正为raw95，保留parser漏记的事实。

## coverage 核验（初始快照及最终 raw 更正）

初始读取 `root-full-coverage-partition.json` 并用实际 `tests/**/*.test.ts` 核对时，该**初始 parser**登记1136 = 94个已report + 2个blocked + 1040个remaining，登记集合互斥并覆盖 source universe。但原文“raw恰94”判断不准确：随后审计发现 scroll-region 文件行前拼有 stdout，旧行首 `^` 正则漏记了它。**原 raw 实际95个文件已report**；remaining因此又跑了scroll-region一次，不能双计。

20:02:34 UTC 时222个header只是中途快照，不是通过总数。最终本席已读 remaining raw summary 与JSON：**14 files failed / 998 passed / 28 skipped（1040）**；**51 tests failed / 10116 passed / 207 skipped（10374）**，exit1且reaped=true。其中helper的suite-only失败已计入14个失败文件。

20:10:39 UTC，本席独立用非行首正则复核两份原log（没有执行会改写主笔JSON的coverage脚本）：原run95 + remaining1040 - scroll-region重叠1 = **1134个distinct已report**，仅下述2个blocked文件未有完成header。重叠的scroll-region两次都是125/125通过，只保留一次。按distinct文件header合计：**13638 = 13310 passed + 71 failed + 257 skipped**。此为去重的分区实报统计，不伪装成一条全量干净退出的summary，也不把诊断/基线/聚焦重跑叠加进去。

两个 blocked 文件为：

- tests/runtime/intent-delegation/verification-host-controller.test.ts
- tests/runtime/verification/intent-publication-dependencies.test.ts

主笔负责其有界诊断/收尾及当前 root worker；本席不向 root 的 PID29590、其 worker 或 inspector 发信号，不 poll/terminate 主笔 tool session。

## 原 run（初始parser94、raw审计95）：六项已知失败文件

原始 `root-full-node24.log` 已读到以下文件 header；不混入 remaining 新发现：

| 文件 | 原 run header |
|---|---|
| tests/ai/tools/mcp-per-call-cancellation.bdd.test.ts | 31 tests / 1 failed |
| tests/runtime/conversation-activity/owner-process.test.ts | 6 / 4 failed |
| tests/runtime/conversation-activity/storage-permissions.test.ts | 12 / 4 failed |
| tests/commands/chat-finalization-process.test.ts | 52 / 2 failed |
| tests/runtime/verification/installed-metadata-target-prepare.test.ts | 14 / 8 failed |
| tests/commands/chat.test.ts | 41 / 1 failed |

本席前轮对照详见 `baseline-review-A.md`。不得把原 full 两个 hook finalization 失败重写为稳定通过或已证明 baseline：此前 baseline 全52通过，而主笔告知的双侧精确2case通过仅属于孤立复核，不撤销原始 full 失败事实。

## remaining 新失败与独立 baseline

baseline 始终为干净 detached master `3b4061489a612337fdb2fc1eb92e96c1d4fbe9a1`，目录为同父级 `xiaok-cli-master-baseline`；使用其独立 dependency clone 与自身 `.test-dist`。全部通过本目录 `run.py` 精确记录 argv/PID/PGID/exit/reaped，**串行批次，每批至多2 workers**。不修改源、测试、断言、deadline、资格或共享服务。

| remaining 文件 | remaining 观察 | baseline 实际结果 | 裁决边界 |
|---|---|---|---|
| tests/runtime/verification/installed-metadata-capacity-integration.test.ts | 10项3项12000ms timeout | 同10项3项同名timeout，7通过 | baseline 可复现；不修改时间限制 |
| tests/runtime/isolated-execution/artifact-export.test.ts | 7项1fail artifact_tar_path（PAX Unicode） | 同1fail、6通过、同错误 | baseline 可复现 |
| tests/runtime/verification/artifact-export-helper.test.ts | suite标记❯，40项全skip | **suite FAIL，40项全skip**；beforeAll缺 pinned Go archive | 不能记为40个正常skip或suite通过 |
| tests/platform/runtime/registry-lifecycle.test.ts | 7项2fail | 同2fail、5通过，disposed/authorization changed错误不符 | baseline 可复现 |
| tests/runtime/verification/loop-application-receiver-fence.test.ts | 2项2fail、约24s | **2/2通过** | 未复现原timeout，不判定已归因baseline |
| tests/runtime/loop/published-candidate-controller.test.ts | 1项12000ms timeout | 同1项12000ms timeout | baseline 可复现 |
| tests/runtime/conversation-activity/owner-launcher-exit.test.ts | 17项9fail | 同17项9fail、8通过：同七项12000ms timeout、两项config mismatch | baseline 可复现，已比失败名称/报错而非仅计数 |
| tests/platform/runtime/mcp-owner-fencing.test.ts | 4项1fail：旧MCP实例权限等待后返回next | 同1fail、3通过，实际next而非tool authorization changed | baseline 可复现；不据此改权限断言 |
| tests/runtime/verification/loop-publication-set.test.ts | 13项中11项18s timeout | batch6选原11失败变体：5timeout、6pass，2filteredskip | 仅五项复现，另外六项不能归因baseline；未改deadline |
| tests/runtime/verification/publication-operation.test.ts | 30项中public-client-near-limit一项300s timeout | batch6只选该case，282793ms通过；29filteredskip | 原timeout未复现，其余29项不充作本席baseline通过 |
| tests/ai/runtime/kimi-builtin-tool-context.test.ts | 5项中两个bash子进程import src/ai/tools/bash.js失败，三项K3实际runtime通过 | baseline只选原2失败项：同2fail，3filteredskip | baseline可复现，不凭路径猜测标已归因 |
| tests/runtime/verification/application-own-data-adversarial.test.ts | integration全1199项中16fail | baseline精确原16失败names：16fail，1183filteredskip | baseline子集不充作全1199通过/失败 |
| tests/runtime/verification/installed-blackbox-command.test.ts | 1项12s timeout | baseline该case10619ms通过 | 原timeout未复现，不推断只因负载 |
| tests/runtime/sol-pi/desktop-owner-boundary.test.ts | 7项1fail：预期HANDOFF，实际desktop_local_business_and_model_cleanup_failed | baseline仅原失败case同1fail，6filteredskip | baseline可复现，以实际source运行而非无diff推断 |

suite-only helper 的原始 baseline 错误：

```text
FAIL tests/runtime/verification/artifact-export-helper.test.ts
Error: ENOENT: no such file or directory, open '.../xiaok-cli-master-baseline/.artifacts/solpi-build-tools/go1.27.1.darwin-arm64.tar.gz'
```

没有下载/伪造该 pinned archive 或改跳过条件。只声明当前环境 suite 未通过，不据此宣称所有 helper 行为失败。

## 已完成 batch 的原始证据

同名 `.log/.json` 在本目录，完整 argv 以 JSON 为准：

- `remaining-baseline-A-1`：source metadata-capacity + isolated artifact-export，`--maxWorkers=2`；**4 failed / 13 passed（17）**，exit1，PID/PGID62176，reaped=true。
- `remaining-baseline-A-2`：source helper + registry-lifecycle + loop-receiver-fence；**2 failed / 7 passed / 40 skipped（49）**，**2 files failed / 1 passed**，exit1，PID/PGID68983，reaped=true。这里的两个失败文件包括没有 case-failed 的 helper suite。
- `remaining-baseline-A-3`：source published-candidate-controller；**1 failed（1）**，exit1，PID/PGID70135，reaped=true。
- `remaining-baseline-A-4`：source owner-launcher-exit；**9 failed / 8 passed（17）**，exit1，PID/PGID71442，reaped=true。原始 log 与 remaining 的九条失败名称和错误一致（时间耗时不要求相同）。
- `remaining-baseline-A-5`：source mcp-owner-fencing；**1 failed / 3 passed（4）**，exit1，PID/PGID85380，reaped=true。该路径相对完整3b基线 diff 为空。保留实际返回next的事实，不将它淡化成已修复或无影响。
- `remaining-baseline-A-6`：source loop-publication-set + publication-operation，以精确 regex 只选11个原失败Loop变体与1个public-client-near-limit，`--maxWorkers=2`；**5 failed / 7 passed / 31 filtered skipped（43）**，exit1，PID/PGID91501，reaped=true。实际执行12项，不是完整43项。保留原18s与300s case deadline，没有因长CPU使用中断。Loop复现timeout仅为current/expired/different-run/duplicate/guard-write；其余nonoverlap/guard-ddl/late-transition/closed/abort/wrong-peer六项通过。
- `remaining-baseline-A-7`：source Kimi builtin、application own-data adversarial、installed blackbox、Desktop owner四文件，按integration原失败leaf names精确筛20项；**19 failed / 1 passed / 1192 filtered skipped（1212）**，3 files failed/1 passed，exit1，PID/PGID4148，reaped=true。四文件选择数依次2/16/1/1，日志实执行数合计20，与选择人口吻合。未把1192个按名称过滤的case算为通过。

以上 baseline 复现不等于根因已确定，也不把当前集成剩余失败归入“无关所以通过”。未复现的 full timeout、未完成文件和 suite-only 初始化错误均保留为未通过/未覆盖项。

## 后续观测

20:05:53 UTC，remaining 已有424个唯一文件header，仍无runner终态；新增 mcp-owner-fencing 后共8个失败suite。此处继续把 suite-only helper 计入失败文件，不用“case failed=0”过滤。所有本席 baseline 比较固定使用完整3b SHA；移动中的 origin/master 不作对照基线。

20:08:10 UTC，remaining 已有852个唯一文件header，仍无runner终态。后续失败包括 Loop publication-set、publication-operation、Kimi builtin、application own-data adversarial、installed blackbox，均逐一排入冻结baseline对照；不是重新把原run中的六个失败文件计入新增。

## 最终 baseline 对照边界

对remaining原51个failed case按文件/完整case名作多重集核对：**41个在baseline仍失败，10个未复现**；另helper的suite-only失败在baseline同样由缺pinned archive触发，不能藏入case skip。

十个未复现case为：Loop receiver fence的competing publication false/true两项；Loop publication-set的nonoverlap、guard-ddl、late-transition、closed、abort、wrong-peer六项；publication public-client-near-limit；installed blackbox。它们在本轮baseline通过，不撤销原integration timeout，也不能未经证据推断只是负载或间接集成无回归。

本席七批owned runner均已有exitCode与reaped=true。最终按这七个记录的PGID只读查询，存活组内进程0；未执行模糊kill或操作root worker。baseline仍为完整3b SHA且git status干净。所有源码比较固定3b，不使用后来移动的origin/master。
