# OpenDuet 个人助理实现交付记录

2026-11-01 中断恢复后的重新验证见[当前验证记录](openduet-recovery-verification.md)。下列旧运行记录不替代新日志；真实试点与质量门槛仍保留。

分支 `feat/openduet-assistant-20261101`，隔离工作树 `/Users/kk/projects/.worktrees/openduet-20261101/xiaok-cli`。依据 2026-10-28 v3 设计；用户后续决定首个日历改用云之家 CLI，Google 延后；没有真实人工标签，先交付人工复核流程。实现、合成回归、真实只读读取、真实交办试点和人工质量验收分开记录。

## 实现范围

| 范围 | 当前实现 |
| --- | --- |
| P1 覆盖与建议 | 五个原内部来源独立 availability/completeness、持久 coverage、分页和大小界限；严格 v2 action/ref/hash 绑定，旧输出可读；处置 revision CAS、暂缓、忽略、预填不覆盖现有输入。 |
| P1 正式交办 | 持久 draft/operation/task binding、main 分配线程、原 foreground Room/Project/Goal/TaskHost 准入；真实既有会话选择和 Goal 二次明确确认，共享原目标预算/条件；同步最终提交 guard、未知只查询、不重复执行、取消/重启恢复、原任务结果导航。 |
| P2 只读日历 | 固定云之家 CLI 0.1.8/profile/account 校验，仅身份和日程 list/get；窗口观测变化持久化，缺失不宣称取消；真实采集进入晨间受控准备建议。日历场次/取消/全天/分页完整性不明时保持 partial，不推进完整 watermark。 |
| P2 独立记忆授权 | main 固定 owner/profile、默认关闭的独立设置；只读取原人工采纳且内容/作用域/ordinary evidence 仍可证明的记忆；原始来源及继承摘要持久 lineage，同一实时 gate 遮蔽失效 run/stage/candidate/evidence/context。 |
| P3 真实计量 | 单独显式选择支持的已配置模型，不改用户默认模型；官方冻结计数资源/下载 hash/实际协议计量与强制输出上限、startup 只读 restore。模型或凭据变更立即失效，不自动 fallback。 |
| P3 调度及通知 | 复用 TimedActionScheduler 和既有 activity/OS owner；user opt-in 默认关闭；共享持久 6 次/输入 48000/输出 6000 预算、unknown 保守计费、实际 breach 计费并阻断；通知差集、2 次/24h、4h 间隔，独立 owner 读取真实质量/预算/来源事实。 |
| 人工质量复核 | 冻结实际完整来源总体和抽样；先导出无预测风险包，人工风险标注导入后才计费预测，再导出两人行动复核包；原始来源引用、冻结明文规则、严格字段/ID/digest 与 native 人工确认；导入后可导出原始计数/Wilson 报告，撤销即时失效。 |

## 真实验收与默认关闭范围

直接启动仍有 main-only 本地 pilot 开关 `XIAOK_ASSISTANT_LOCAL_LAUNCH_PILOT=1`，默认关闭。protected/native 缺共同提交证明时明确 unsupported，不能回退 local。10 个案例 A/B/C 和 20 次完整真实交办仍以实际试点收据为准，不能把 fixture、后端准备/恢复、API 耗时当真人 UX 或完整执行。详见 `evals/assistant-handoff/RUN-20261101.md`。

云之家真实 production source 已只读读取 19 条日程（`/tmp/openduet-yzj-inspect/source-production-read-check.json`），状态 partial；未证明完整分页、取消、全天、循环场次，因而不声明这些语义已经验收。原始私人响应已删除，只留汇总，登录 profile 保留。

真实人工评估仍未完成。至少 100 真实案例、30 需行动、精确率 >=90%、召回率 >=95%、严重漏报 0、人工 unknown <=10% 是原门槛；报告保留原始计数与 Wilson 区间，不擅自换门槛。测试标签全部是合成数据，不安装生产资格；没有人工资格时自动检查/通知保持不可用。参见 `reviews/assistant-quality-workflow-implementation.md`。

## 本轮实际验证

- Desktop 完整相关功能：62 文件，403 通过、6 个真实计数环境用例默认跳过，0 失败；`/tmp/openduet-review-20261101/complete-feature-rerun.log`。包括实际既有会话原准入、独立记忆 IPC/UI、持久 lineage、完整两阶段质量组合/6 次真实预算 owner 调用/报告导出/撤销（合成输入）。
- 真实官方资源测试另行配置执行：provider/resources/counter 31 项通过、0 跳过；`.artifacts/assistant-analysis-kimi-delta-green.log`。实际官方计数、prepare/restore/manifest crash 恢复，无生产模型调用或用户配置改写。
- Root emitted TaskHost/正式 binding/通知鉴权/质量/物理 promise drain/敏感性：174 通过、7 原有跳过；`root-final-feature.log` 和 `root-final-brothers.log`（同 `/tmp/openduet-review-20261101/`）。
- 相关 LoopStore/CompletionEvidenceStore/AutomationOverview 兄弟入口：49 通过；`final-store-brothers.log`。
- Desktop main + renderer 实际构建成功：`current-complete-build.log`。raw typecheck 成功：`final-types-current.log`；治理 0 新违规：`final-governance.log`，没有更新 baseline。renderer 原有大 chunk 提示保留。
- unsigned 包/实际隔离 app smoke、最终独立模型复审和远端 CI 结果在收尾后补入；先前已实际排除 cross-spawn 依赖闭包遗漏并完成 unsigned mac arm64 打包，参见 `reviews/openduet-package-validation.md`。不把旧 dist 的成功当最终包证明。

## 独立评审与已知环境限制

编码 Codex GPT-6，独立评审 Kimi `kimi-code/k3`。早期 coverage、transport、launch/cancel、P3 budget/notification 限域接缝均有对应批准记录；后续真实 provider、人工复核、Goal 和 lineage 扩展按新 source hash 单独复审。超时无 verdict 不算批准；最终结论以对应文件 manifest 为准。

广泛 conversation-activity 34 文件旧回归曾有 18 失败，不能称全仓全绿；其中 17 项在未改动基线独立 worktree 实际复现，另一次 owner 进程退出未在目标重跑复现。原始记录：`p3-activity-suite.log`、`p3-baseline-tests.log`、`p3-baseline-launcher.log`。没有削弱断言或更新 baseline。

仓库卫生检查因 sibling intent-broker 既有 tracked WIP 且落后 1 提交失败；保留其他项目改动。当前不声明 release ready，不自行合并、签名、发布或安装到用户正式应用。

## 用户工作环境约束

云之家仅只读。不得修改、删除、取消已有日程；本任务没有创建测试日程、添加参与人、邀请同事、预订会议室或通知他人，没有使用日历写命令。将来创建个人日程也必须来自用户明确交办且不邀请他人。临时验证进程仅按本任务记录的 PID 清理。
