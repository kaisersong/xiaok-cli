# SoL-Pi P0a 本地元数据盘点

这是离线盘点入口，**不是性能准入器**。不改变 xiaok 模型请求或工具行为。

```sh
node scripts/evals/sol-pi/inventory.mjs \
  --cli-dir <CLI-session-directory> \
  --desktop-dir <Desktop-task-snapshot-directory> \
  --scope-manifest <authorized-local-scope.json> \
  --out <new-report.json>
node --test tests/evals/sol-pi-inventory.test.mjs
```

输出父目录必须已存在，不能位于输入目录内；已有报告不能覆盖。输入只读取 scope manifest 明确列出的直属 JSON，manifest 示例：

```json
{
  "schemaVersion": 1,
  "purpose": "sol-pi-p0a-local-metadata",
  "cli": ["sess_example.json"],
  "desktop": ["task_example.json"]
}
```

清单仅记录本地盘点授权范围，不是任务原验收或新增权限授予。不要把未经授权的任务列入清单。报告不包含正文、会话/任务ID、文件名、原文件指纹、私有 reasoning。原始输入仍可能含私有内容；请在受控本地环境执行，不把它上传给评审者。

CLI `usage` 混有最近请求、保留旧值和压缩估算，只报告保存值分布，绝不相加为历史 token 总量。Desktop 快照若带 journal 则不可用；未覆盖 managed child/任务类型桶、请求前正文及真实费用时，报告保留缺失项。扫描前后目录变化则该面统计不计入报告。

所有输出均为 `admission: inconclusive` 和空 `approvedCandidates`。记录数不是独立样本数，工具结果字节P95不是任务耗时P95；这些统计不能证明任何优化达到5%收益。正式准入仍遵循 [v15方案](../../../docs/design/2026-09-16-sol-pi-harness-adoption-plan.md)；实现细则见 [P0a契约](../../../docs/design/2026-09-18-sol-pi-p0-implementation.md)。

## P0b：运行时元数据采集

生产入口现支持宿主环境变量 `XIAOK_METRICS_DIR`，默认关闭。目录须预先创建且仅当前用户可访问；不合格目录、ACL、写盘失败仅放弃指标，不重放任务或改变其错误对象。Windows 等无法验证 UID 的平台关闭本批采集。

```sh
metrics_dir="$(mktemp -d)"
XIAOK_METRICS_DIR="$metrics_dir" node --import tsx src/index.ts chat --auto -p \
  '只调用一次 bash 执行 printf SOLPI_PROBE，然后原样回复工具输出并结束。'
```

四类 owner 为 CLI、CLI child、Desktop main loop、Desktop managed child。指标包含 bash pipe 字节、registry cap 前/最终返回、内存 history_result、授权后的 adapter 调用和原始 usage chunk；不存正文/命令/路径/私有 reasoning。`bytes` 是 UTF-8 字节，`units` 是 UTF-16 单元，usage chunk 不可盲目相加。

该开关只用于受控采样。业务先启动，验证并行；任务末尾清理最多等待50ms、发布最多250ms，外部wall time须包含这些开销。原子JSON发布失败或进程提前退出可能没有工件；不能把缺文件算作零开销或成功。`complete` 仅指本批采集覆盖完整，不是任务验收；`adapter_request` 不是实际HTTP尝试；`history_result` 不是Desktop落盘快照。所有报告仍为 `admission: inconclusive`，不能签发性能准入。

实施说明与原始实测：[P0b状态](../../../docs/analysis/2026-09-18-sol-pi-p0b-runtime-status.md)。尚缺网络与费用计量、完整初态/模型快照、独立任务验收和正式配对；这些继续作为实施项处理。

## 基础工程 eval（macOS）

```sh
node scripts/evals/sol-pi/baseline-run.mjs .eval-runs/sol-pi-baseline-<unique-name> --prepare-only
node scripts/evals/sol-pi/baseline-run.mjs .eval-runs/sol-pi-baseline-<unique-name> --execute-prepared
node --test tests/evals/sol-pi-baseline.test.mjs
```

包含 QA/只读探索、金额函数修复并验证、长日志诊断、工件交接四类任务；Desktop main、Desktop managed child、CLI main、CLI child 合计14桶，每桶3次，共42次。四类任务合并为3个来源簇，均为作者可见的工程发现任务，不能冒充真实用户分布或独立密封holdout。

prepare 创建新目录，复制实际生产源码、Node与安装依赖，置只读并记录hash；execute自动委派冻结Node/runner。配置只在内存传递，prepare/execute间变化会拒绝；只记录model/profile/capabilities白名单和带salt的配置变更指纹。每次新进程、新材料目录，固定seed顺序，严格JSON和语义判分。代码任务执行真实生产工具，生成函数只在Seatbelt+独立子进程中运行；隐藏评分12向量由宿主判断primitive返回值，模型不能修改测试。

输出 `manifest.json`、`snapshot-files.json`、42项 `ledger.json`、逐任务 `result.json`/metrics、`summary.json`/`summary.md`。已有轮不得重放。中断后确认runner和worker均退出，再执行：

```sh
node scripts/evals/sol-pi/baseline-run.mjs .eval-runs/sol-pi-baseline-<unique-name> --finalize-interrupted
```

闭账只对账，不补跑；活跃、已完成和已闭账轮拒绝覆盖。正式比较必须核对任务/评分器/runner、预算、首次实际adapter输入hash及模型配置条件，保持原始桶和失败分母。记录wall time、process wall time、adapter调用、各stage工具结果字节以及usage缺失；provider chunks不盲目相加，不用这些元数据冒充真实费用。provider修订号、缓存及负载不可完全固定，异时差异仅为描述性结果；`admission` 始终 `inconclusive`。

设计与评审：[基础eval契约](../../../docs/design/2026-09-18-sol-pi-baseline-eval.md)。生产边界由实际AgentRuntime、Desktop loop、managed child执行；Desktop main/child复用同一个生产50000字符投影函数。不是完整UI产品测试，原方案的真实任务/外部状态/审批取消/独立holdout桶仍待后续补齐。
