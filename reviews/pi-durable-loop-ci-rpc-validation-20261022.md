# Loop 手动诊断实现及 489fe 实际 CI

本增量承接“解决失败问题”。`489fe6057be511fd36e73a9ab6777de44550398d` 的实际 CI 已全部结束：32 SUCCESS、2 FAILURE、1 原有 SKIPPED。成功与失败均保留，Loop 尚未关闭。完整提交及提交后独立质量结论写入 PR #74；本记录按源码 SHA 绑定，不把该历史 CI 当作后续 HEAD 的运行结果。

## 已关闭的实际失败

Linux Node22.14 和24的两条 permission job 均真实通过：原六个 Python 入口在同一 shell 中全部执行成功，原 JS 人口及11项退出观察守门也成功。此前本机仅为六入口成功 union；本次同 shell 证据另列，不回写旧记录。

Windows Node22.22 和24的 recovery job 均 SUCCESS。两版分别完整执行原七文件93/93，真实关闭回执为八个 native `isOpen=false` 及一个 memory=false，构建和 emitted worker 检查均成功。此前安装阶段取消的22.22作业没有被追认通过。

Windows path job 先通过九文件106/106，再通过五文件68/68，renderer build 成功。activity 原16项文件耗时84.640秒，超过此前失败文件的65.219秒，仍正常退出且无未处理错误。这支持 runner ACK 屏障修复了该次真实 Windows 超时；不据此保证所有任意负载。原同步10000事件、循环、断言和120秒用例期限均保留。

CI 实际 checkout 是合并提交 `eaaea670f17c3c775beb3fc213d8d78d89613c6c`，父提交为主干677009和完整489fe；整个 tree `82e7d5ee6d1b55860d6ee545d6bcd6b2e4c36953` 与完整489fe相同，而非只比较选定源文件。

## 剩余 Loop 失败

| 原矩阵 | 完整八项 | Vitest 总时长 |
|---|---|---:|
| Ubuntu / Node22.22 | 1通过7失败 | 834.52秒 |
| Ubuntu / Node24 | 8通过 | 710.38秒 |
| macOS14 / Node22.22 | 8通过 | 669.22秒 |
| macOS14 / Node24 | 4通过4失败 | 810.30秒 |

两条红作业均有原 runner 30/120/300秒到界；其后取消错误或 `publication_pending` 断言不能另算新增失败用例。新日志未出现 c7 的 `loop_publication_read_timeout`，这不证明该产品10秒问题已根治。同平台、同原测试既有红又有绿，不把 Node版本、地域或 runner 负载当成已证根因。完整日志 SHA、精确阶段分析和实际 counts 见独立[证据增量](pi-durable-loop-ci-rpc-evidence-20261022.json)。

## 一次手动诊断代码

实现遵循[已审设计](pi-durable-loop-ci-rpc-diagnostic-20261022.md)。workflow 输入默认false，push、PR、默认手动原 recovery 九腿不变。仅显式 manual true 运行 macOS14/Node22.22 原 output-consumer；原300秒用例、产品10秒、hook10秒和全部业务断言保留。正常八项矩阵不改，不在每次 PR 自动诊断。

专用 observer 从实际协议冻结62方法（含11个连字符），九处插入可逆恢复原测试 SHA `83582426fda875e785ddf75b03ebdb2a7a1b528e1c861c5008fa8052912ef4e6`。既有实际 TS AST 验证59个 expect、5处 f.setTime、原预算 factory 和八模式不变；它只证明语法及这些静态约束，没有运行场景。wrapper 保持原 this/args/Promise/异常对象，只记录有限方法、时序、CPU及opaque原因；observer额外 Promise reaction 的扰动仍需在真实证据中说明。

首轮 owner `04db…` 在超时异常路径会重新开启一次清理等待。A 实码审查 BLOCK，root 四项原回归3失败1通过，保留了重复 signal 和假时钟21.05/16.05/20.25秒原红。首轮不同模型 APPROVE 已明确被实际反例推翻，不能放行当前实现。

修复后的 owner `ba763146269b063affb2bf6716e62ad97acfd9492e3d069891ccb6bbf34f0f29` 共用唯一绝对 `started+budget+10` 期限，首次 shutdown/kill 时间不重置；观察消耗同一剩余预算，TERM/KILL分别至多尝试一次。未知物理退出继续失败并保留目录。原四项由 root 独立复验4/4通过，假时钟11/10/11/10.2秒，runner真实exit0且已reap。此回归替换进程/时钟叶子，既未启动真实child或signal，也不是430秒墙钟或平台资格测试。

新 workflow 和四份 support 源码共五输入经 A 及实际不同模型 gpt-5.6-sol 重新实码审查，均 APPROVE；旧票及 BLOCK 保留。五输入SHA、原红/新绿、完整票及模型路由观察写入证据增量。源码冻结为历史89中88不变、仅model-recovery workflow改变，另纳入四份 support，共93；旧129记录、79/80/81/89冻结和生产源码不改写。治理检查通过，0新增违规。

本提交尚未实际 dispatch 或运行专用诊断。提交并独立核完整 HEAD 后只执行一次，结果无论通过、未复现、失败或unknown均停止，不自动换平台或重试；若 feature ref/input 被 GitHub 拒绝，只保留拒绝并停止。原始结果与诊断质量分别记录；未知方法、丢失配对、未清listener、强制结束或物理owner未知均保持非零。

历史 CLI13456通过/225原skip、Desktop本机10159通过/8原skip保持；跨版本93、68、owner4及Python变体不追加到历史总数。kai-mbp最近真实有界SSH仍超时，严格四文件128项仍未获得远端资格。Loop和该资格未关闭前，不宣称全绿、merge-ready或release-ready。
