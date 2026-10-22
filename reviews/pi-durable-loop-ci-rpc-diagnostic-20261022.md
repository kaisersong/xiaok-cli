# Loop：一次手动 CI RPC 边界诊断

本案只定位仍未关闭的真实超时。c7 的 macOS14/Node22.22 原 output-consumer 在109.849秒以 `loop_publication_read_timeout` 失败；原八项为2通过6失败。此前本机terminal诊断的方法表漏了带连字符的方法，质量为 `PARTIAL_METHOD_IDENTITY_UNKNOWN`、exit1，原记录不改写。完整CPU profile只是热点归因，没有兑现≥5%收益；本案没有生产优化授权。

业务观察遵循已审 `B-loop-next-single-experiment-design.md`（SHA `7e5e0b93bf30eec0ca4405f7dae07a635d807e9d5ae7fec229f715a004added3`）。仅一次 macOS14/Node22.22 原 output-consumer，原300秒用例、产品10秒、hook10秒、全部业务体和断言、实际SQLite/签名/authority均保留，无profile。通过、未复现、失败或质量unknown都停止，不自动换平台或重跑。

## 手动布线

在已存在且默认分支已有 `workflow_dispatch` 的 `.github/workflows/model-recovery.yml` 加一个可选 boolean 输入 `loop_rpc_diagnostic`，默认false。原 recovery job 仅在手动输入为true时不执行；push、pull_request和默认手动调用的原九腿、全部命令与30分钟job上限保持。新增独立诊断job仅手动true执行，平台macos14、Node22.22、Python3.13，安装原root/desktop依赖，单worker运行专用owner。该job总上限30分钟含安装和清理，只是外层资源界限，不增加用例/产品期限。Desktop正常原八项矩阵不变。

使用此现有手动workflow，可以在feature ref明确启动一次诊断；不在每次PR push重复收集，不触发Windows打包/signing job，也不修改仓库设置。实际dispatch前仍核完整HEAD、最终代码票及唯一执行记录。若GitHub拒绝feature ref或输入，只记录拒绝，不改主干注册workflow或自动转用其它触发方式。

## 代码及执行边界

专用测试诊断owner/模板只从当前完整原测试生成可逆副本，原测试源码必须仍为 `83582426fda875e785ddf75b03ebdb2a7a1b528e1c861c5008fa8052912ef4e6`。逐处精确匹配插入透明观察，反向重建逐字相同；临时副本不加入原全量人口，config明确只选该副本和原output名称过滤，正常八项命令不改。

只观察原server invoke、client roundTrip和ctx/caller/server首次取消；每次原函数一次、原this/args/signal/Promise/异常对象不变，无新增业务await、SQL、census或重放。方法名从实际协议所有字面量冻结，必须包含带连字符completion；不事后猜名，unknown或配对歧义明确非零。方法、seq、有限CPU/wall数字和安全opaque reason即可，不记录payload、票据、owner key或用户内容。捕获启动native readers，observer任何异常封闭但质量红，不覆盖原业务异常。重叠client/server区间不相加，CPU/wall不同不推磁盘或宿主根因。

父owner记录自己启动的PID/PGID、原始退出、signal、reap、worker/组状态及每份输入SHA。原300秒case之后给固定420秒外层观察上限和有界TERM/KILL，仅针对自己真实记录的组；强制结束不能称正常退出。fixture根和临时文件记录创建时canonical/stat/nonce、归属和内容SHA。只有实际worker/group均消失且原身份匹配才能精确删除；未知保留取证并报非零，不通扫tmp或杀共享进程。原业务退出和诊断质量分别保存，任一失败整体失败。原journal由实际fixture提供，不把close Promise当物理关闭证明。

只上传该专用输出目录，原stdout、输入/临时源码快照、源SHA、有限观察、原结果、质量及清理身份保留。artifact上传失败也是job失败，不能覆盖原结果文件。实际diff、方法完整表、原测试可逆证明及owner清理须独立agent和不同模型审查后方可启动；本设计不代表已执行或已修复。
