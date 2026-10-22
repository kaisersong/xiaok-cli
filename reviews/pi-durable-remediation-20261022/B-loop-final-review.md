# 最终本机签名 Loop 八场景

`B-loop-final-node24.log/json`：完整 **8/8 通过**，Node24.16，exit0/reaped，PID/PGID63591 实际无成员。测试 SHA83582426…f4e6，production host SHA79650281…a3858；完整源哈希、原始日志 SHA 与全部阶段见 `B-loop-final-node24-analysis.json`。

| 原完整场景 | 实际耗时（秒） |
| --- | ---: |
| terminal | 13.561 |
| lost-dispatch | 13.336 |
| publication-lost-ack | 14.071 |
| full-projection | 46.282 |
| desktop-service | 54.555 |
| timed-pending | 55.714 |
| timed-expired | 29.857 |
| output-consumer | 164.408 |

output-consumer 原完整正向 fresh 读取、独立导航前后检查与到期拒绝全部执行；body164.398秒、finally164.408秒。之前60秒运行中 pending!=already_completed 的原断言失败保留，当前完整同断言已实际通过，不能把旧失败从历史抹去。B10 的真实 published_artifact_payload 缺陷至此由唯一 trusted host 适配与原签名完整人口闭环，本机四整文件65也在24与最低22.22分别通过。

预算修订明确是测试运行预算：simple30秒、四 ordinary consumer120秒、output300秒；原59 expect、5次业务时间推进、产品期限、资格、SQL census/fresh read、默认 hook10秒均保留。并非性能优化。原30/60失败与有效红、真实4秒强制超时→原 promise join→下一原场景通过的独立隔离诊断均保留。短诊断不是完整八场景验收。

最低22.22 的签名完整8待真实 GitHub Ubuntu/mac矩阵；本票不冒称本机已跑该版本，也不将 Desktop 四 recipe 资格文件128案例宣称通过。

`B-owned-groups-after-final-loop.json` 同次实际扫描39个 B runner，没有 owned 活组。旧 usage-red PID44203 已被更晚启动的 Apple ContextStoreAgent 复用，原run已在07:57:51回收、系统进程09:03:35才启动；数字碰撞与实际命令/时间一并保留，未向其发信号。823全量也已reaped，B当前无测试worker。
