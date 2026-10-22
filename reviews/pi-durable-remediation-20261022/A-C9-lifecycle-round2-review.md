# A C9 lifecycle 修订新票

APPROVE（仅当前完整修订设计；实码与全文件运行另验）。方案SHA256: d045abcba00b828ee86da350bf333aadfe06b540d98b09ba82df3c7fd201ec0f

完整重读旧C9与新lifecycle末节；保留旧A批准遗漏root rm动作、B有效BLOCK轨迹。新案在服务constructor前即视owner可能存在，任何dispose未成功（包括未知/未完成/setup不明/断言失败）均retain原journal，不强关store/重复dispose/清sticky或伪造released；只有无owner或同一实际dispose成功才原样删除。expected错误只在所有严格identity/state断言完成后免同对象重复，所有未知仍红，其它cleanup和restore全尝试。

root已正式接受标准npm/raw Vitest有意保留failure-forensics root，不声称删除；无需扩大为全局wrapper或nestedchild。原期望任务失败、原child无副作用、runtime blocked/resourcesReleased=false/cleanupPending=true保持。受限记录创建时canonicalroot/uid/dev/ino/birthtime/workerPID与本轮关联，无业务凭证。仅本轮父runner在original Vitest reaped、完整原PGID0、相关worker不存在后，重新核exact临时mkdtemp目录无symlink且identity一致才删除；变更/归属不明条目保留并报告，不扫描删除、不删父目录。父脚本须提供原始退出/stat/删除证据，不拿本设计票冒称已回收。

实际独立核Desktop Vitest3.2.4 cli-api:9906 global teardown先于9912 pool.close，root3.2.6另9916→9922；新文已正确区分，globalteardown删journal捷径否决。nested只是本案未选，不宣称实测无法运行。

原四suite/mailbox人口/预算/nativeAuthorizer资格保留，另原factory guard外1条cleanup错误全尝试回归合理。须24/22.22完整file、actualdiff/原错误identity和父晚清理证据；方案当前无必改项。
