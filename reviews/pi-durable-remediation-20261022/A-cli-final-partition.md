# CLI 最终证据分区

精确1136个源码测试文件：1107通过、29按原条件跳过。逐项终态共13681项：13456通过、0失败、225跳过。分区互斥，重复运行不额外加人口。

| 完整文件来源 | 文件 | 通过 | 失败 | 跳过 |
| --- | ---: | ---: | ---: | ---: |
| A完整补集（已整文件替换新host依赖8文件） | 1134 | 13418 | 0 | 224 |
| 原CPU profiler批次中单独提取的host-controller | 1 | 16 | 0 | 0 |
| 最终正常quiet dependencies完整23项 | 1 | 22 | 0 | 1 |
| 合计 | 1136 | 13456 | 0 | 225 |

A补集原始run为1134完整文件，13418通过/224跳过；新host依赖闭包8文件另完整331/331，以同人口整文件替换原对应项，未再加331。起终host输入一致。两处授权根source drift为包MJS测试拆分与补集明确排除的Intent test；不声称2148全部不变或跨输入full等于一次最终freeze。

host16来自带`--cpu-prof`的原两文件39项批次；原整批exit1及其dependencies两红保留。这里只取实际host16，不能改写为正常完整39绿。

最终quiet dependencies源SHA为`142106c194b5ef8e21d58636f2daaa28aed52d718709a727234f3e3098723479`，正常完整23项、无profiler/筛选、原opt-in未开启。原runner exit0/reaped，Vitest808.81s。未修改的最终clock分支保持40000ms，本次实际35370ms通过；原40010ms失败留存。一次quiet通过不能证明并发因果、性能提升或稳定性保证。

旧13677的按文件union已将helper40项按suite失败头记为跳过；本次首次成功收集后为33通过/7原平台跳过，不另增加40项。四个新增根case使实际总人口为13681。所有平台/recipe/opt-in跳过保留，未将其算通过。

本机source回归证据不代表真实provider、已安装recipe、全部平台CI或release ready。最终146 runner记录审计无未回收自有group；发现的1个号码复用外部进程未发信号，非完整瞬时出生普查。A主run孤儿11525曾按精确身份单PID回收，独立原始记录保留；最终quiet组亦已核空。

逐文件精确人口、原始证据SHA、实际source hashes、分区来源和覆盖限制见相邻JSON。JSON只在最终序列化替换worktree/home路径；所有输入判定与原始raw SHA使用未改值。
