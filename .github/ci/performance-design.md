# Actions 提速设计（2026-11-02）

基线：master a07d7774，最近50次运行原始证据在任务 evidence/；不把取消或 macos14 退役造成的耗时纳入收益。当前 required checks 为 governance 的 Ubuntu/Windows/macOS15 三个名字。

## 保持的边界

- PR 使用 workflow+PR编号组并取消旧运行；其它事件使用 run_id 唯一组，防止 pending 被替换。
- 每个现有平台/Node组合、测试文件、用例、真实TTY/native/packaging断言保留；不改已知非阻断测试的阻断性或超时。
- 不修改安全权限、分支保护、发布/部署行为。发布工作流只同步runner和缓存键，不触发发版验证。
- 只移植 PR130 的 macos14→15 YAML变更；不带入其产品修复，不修改其分支；不带入PR131 pool变更。

## 实施

1. 所有workflow加PR专属取消、非PR唯一组。master原有push paths限制移除，保证每提交完整检查；其它无branch限制的测试push限定master，避免同一PR push/PR重复执行；tag发版不变。
2. governance无顶层paths限制。独立changes job用git diff --no-renames -z与保守README/docs Markdown白名单判定，取diff失败/空diff/未知都全跑。required矩阵always运行且显式拒绝changes失败。docs-only PR在Ubuntu轻量完成原三个稳定check名，不安装依赖；merge_group、master及dispatch全量。源代码下三平台governance回归及全仓扫描完整保留。
3. 其余PR workflows保持既有触发范围，补充锁文件、编译/测试配置及共用CI action/script触发，不对运行时Markdown做全局忽略。
4. setup-node继续使用npm下载缓存，需root+desktop的job补齐两把锁。不缓存node_modules、编译产物或无关Rust/Go。native工具保持现有锁定预编译来源，不改授权/校验。
5. Terminal重用原26文件命令，去掉慢chat文件后在shard1运行其余25文件；慢chat及registration原Intent whole通过Vitest public collect API收集结构化祖先名、原始skip模式和身份（不用会省略skip的list JSON），拒绝重复及canonical碰撞，再确定性分为3片，各OS/Node不变。新用例自动进入一个且仅一个分片，原skip不变。每片独立blocking收集与audit，写inventory、selected和实际JSON报告，空片、收集失败、报告缺失/名称不匹配均失败；只有原Intent测试失败继续非阻断，调度/证据错误阻断；每OS/Node另加汇总门禁验证精确SHA/config、各片inventory一致、并集完整无重复；artifact含run_id/attempt/shard。不使用passWithNoTests。TTY只shard1避免重复，同Node/OS原覆盖不变。registration九个blocking whole只shard1，其余分片只跑原非阻断Intent whole，原continue-on-error/15分钟步骤上限不变。
6. 不移除windows packaging-gate的needs（传递真实产物）。发版create-release是外部副作用控制依赖，保留。仓库无Dockerfile、无go install/cargo install，不引入这些工具链。

## 验证

先针对classifier和分片分配写测试，包括真实git rename/delete、配置/lockfile/运行时Markdown、空diff、非PR、分片全集和重复全名。增加真实Vitest夹具验证嵌套、正则字符、换行、参数化、skip及重名拒绝，再实现；现有治理检查与新增回归都跑。分片属于需实测候选：按完整文件A/B检查逐用例结果及afterAll诊断清理；实际端到端收益不足5%则撤回。两次相同输入build:release测得6.876s/6.597s：clean-cli-build显式清dist/.tsbuildinfo是避免已跟踪陈旧产物进入发布的有意门槛，不为暖构建数字删除此校验；另测原本支持增量的test:sandbox:build两次。推送后按精确SHA追踪、收集并第二轮复查，报告墙钟及runner总分钟分别列示。

## 首轮实测后的第二轮设计

首轮SHA f007c57c6f6764b12576dcdf27ac1862406ca9e3。Windows原单job843/863s，新三片252–409s；保留三片。Ubuntu24原411s，新三片runner合计497s、整组最后完成775s；Linux回完整单片。macOS共享队列575–818s以上且三片重复准备，Terminal回完整单片。Registration macOS候选2片，仍覆盖22 runnable+1自然skip；须按首轮逐用例实测总时长估计11例片最大耗时，在原15min上限内留余量再决定。Linux仍3片。

聚合显式指定每OS/Node期望分片数，拒绝0/NaN/重复group/重复index及多缺artifact；单片仍执行完整收集、退出回执和audit。原OS/Node组合展开后集合不变。Desktop相关workflow仅补齐已使用的lock/config/setup输入触发，不缩减原路径。首轮全部终态后才推第二轮，避免取消首轮污染比较。

首轮registration两片实测时长投影：macOS22.14.0最大702.394s，加入20%波动及30s开销为872.872s；macOS24最大649.523s，同口径809.428s，均低于保留的900s步骤上限。因此第二轮试验macOS两片，实际CI验收，若超时不放宽上限。
