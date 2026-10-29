# Harness² v46：P0a 实施边界与对抗性检查

后续进展：用户要求本机推进后，已按[工程补充](harness2-d0-local-design.md)实现 D0 核心底座。
本文保留 P0a 时点的停止结论；真实研究资格仍未验证，不等于工程代码尚未开发。

依据：mydocs `74e9fb7` 中的
`xiaok-cli/design/2026-10-20-harness2-opt-in-optimization-design.md` v46，
冻结正文 SHA-256 `d9dbd2b4d88ebcfb0c744ea8a530f9e0a10dd95b5a543669a55e1778aec4f8dc`。
实施基线：xiaok-cli `dc221f9b`，独立 worktree。

## 先实现 P0a

§10.1 / §11 要求先以零模型调用证明当前 V 下 B全支配任意 C。
实现只提供离线研究检查命令，不接 Desktop、CLI 聊天、配置或任何模型 adapter。
固定三个操作；枚举所有参考缺口集合与候选选择，包括空集、伪造事实及越权。
V 只统计真正未满足项的命中，不惩罚单纯过选。另列过选成本反例，
明确该反例不是本版指标，也不开放 reflect。

调用现有 `diagnoseTraceBundle` / `diagnoseProjectSnapshot`，以合成 trace
核对实际结构化类别/动作的 NO_ENTRY 映射。未知类别/动作保留 mapping_unknown，
不得猜测标题/自然语言或把 empty_artifact 等同章节检查。
读取本仓指定源码，输出文件哈希、核对入口及职责，盘点已有 memory lifecycle、
CLI 注入、Desktop 组装、生产 verifier 和离线 scorer。
这是静态代码盘点，不是用户真实材料盘点或 D0 的 E_target 证明。

## D0 前置条件

§11 明确任何 D0 基础设施实现前必须先验证真实数据支撑的可达性。
目前未验证目标 workspace / 已选 skill / 真实报告失败分桶 / 历史 provider、
transport、usage、hazard 数据 / 成本与联合功效协议 / 冻结窗口及应用量。
离线命令固定报告 D0 not_started，逐项列明待提供证据；合成算例不能生成资格。
不得因为用户要求实现而假造这些数据或先搭建 D0 绕过门槛。

不新增设置、研究 manifest、预算服务、终态 observer、reflect 调用或正式实验。
后续确定性路线在实际前置材料齐备并过门后，继续按原方案 D0 → P2a → P2b。
P0a 结果不覆盖其余 49 个验收子项，也不声称新增质量或节省 token。

## 实现前对抗性自审

本节为 Codex 作者自审，不冒充独立模型评审；本批没有产品权限/配置变更。

- BLOCK：把“全部三操作”误写成每次均得分 1。处理：R 为空时 B、C 均为 0。
- BLOCK：反例指标进入默认 V 或接受自定义 metric。处理：固定函数与枚举；反例只在报告独立字段。
- BLOCK：只测试恰选单项，漏掉组合、空集、违规 C。处理：穷举 8×8×4 个状态，验证所有 D≤0。
- BLOCK：复制诊断逻辑到测试。处理：直接调用现有两条生产诊断入口；映射仅识别结构化 code。
- BLOCK：把源码/离线 scorer 当目标运行面的实际注入证据。处理：库存标签明确 offline_eval，D0 始终未启动。
- BLOCK：源码缺失时仍输出完整盘点。处理：读取失败命令失败，不伪造有效报告。
- BLOCK：离线工具意外读用户配置/发请求或覆盖证据。处理：只读取固定 repo 文件；测试封锁网络入口，输出文件独占创建。
- BLOCK：新增工具给未来阶段开许可。处理：无授权入口、不接受外部 manifest、模型、预算或 metric 参数。

先写回归、观察缺模块失败，再实现离线命令。验收覆盖 T15 静态公式与既有诊断盘点部分，
其余阶段保持未验证。CI 运行相同真实命令，覆盖三平台和最低 Node 22.14.0。

## kai-mbp 只读盘点

用户指示查 `kai-mbp` 后，以 SSH 只读查看 v46 原文、R46 工件、
`~/.xiaok/desktop/tasks/snapshots`、日志及项目既有 eval 目录。
远端方案哈希与本地冻结稿一致，远端代码 HEAD 为
`ed87a5066e647e2f89ae6fefbedecb2dba5b050a`。

逐文件 SHA、字段计数及盘点时间保存在本 worktree 忽略目录
`.xiaok/evals/harness2-static/kai-mbp-existing-evidence.json`，不复制提示词、
消息正文、原始 provider 错误或凭据。此为非原子历史盘点，不是正式冻结数据集。
已检查快照的 usage_recorded 事件只有 inputTokens/outputTokens/type；
invocationId 出现在 goal_tool_finished/goal_tool_fact，是工具调用证据。
不能把它们当作 provider 每 HTTP attempt 的分母、重试/usage 缺失率或版本证明。
按 prompt 关键词选中的任务也没有三操作质量标注；completed/failed 不等于报告质量。
既有项目 eval 目录为 ahe-lite 与 graphiti-knowledge，不能冒充本案真实报告效果实验。

结论仅限已检查材料：尚未取得符合 §11 的质量缺口/MDE、全链可靠性、
目标义务对照、冻结成本/寿命及研究 manifest，D0 保持 not_started。
没有启动研究、修改远端配置或运行远端模型。

## 本批验证

- `npm run eval:harness2:static:test`：Node v24.16.0，8/8 通过，原始日志
  `.xiaok/evals/harness2-static/test-node24.log`。
- `npx --yes --package=node@22.14.0 node --import tsx --test tests/evals/harness2-static.test.mjs`：
  最低 Node v22.14.0，8/8 通过，原始日志 `test-node22.log`、版本 `node22-version.log`（同目录）。
- `npm run eval:harness2:static -- --output .xiaok/evals/harness2-static/p0a-final.json`：
  成功生成报告；256 个唯一公式状态，最大 D=0，16 份源码哈希；D0 not_started。
- `npm run governance:check`：0 新违规，日志 `governance-final.log`（同目录）。
- `npm run architecture:check -- --changed`：本批没有触及架构扫描的生产代码，
  增量扫描 0 文件、0 新违规，日志 `architecture-final.log`（同目录）。
- 两个新脚本 `node --check`、workflow YAML 解析及 `git diff --check` 通过。
- 已配置三平台/两 Node 版本 CI；远端 CI **未运行**。未运行产品构建、安装包、
  真实 provider 或 D0/P2 产品测试；本批仅改离线研究命令及配套测试/文档/CI。
- 开工 `npm run hygiene:check` 未通过：intent-broker 有既有落后远端和 tracked WIP，
  原始结果见本会话开工工具记录；未修改该 sibling 或更新治理 baseline。
- 检查没有启动后台服务；同步测试子进程及 SSH 检查均已退出。

代码与研究门没有以“整案完成”交付；后续须先补齐原方案真实 D0 前置证据。
