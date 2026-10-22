# C9 native 关闭回执实际代码复审（B）

最终结论：修后 **APPROVE**，见末节。首 BLOCK 原文保留。

当前 **BLOCK**，仅一项新测试 cleanup guard 必改。六源 SHA 已逐个复算，与 C9-final-code-manifest.json 相同；fixture eeafb32c…99b0、factory ad15fa22…2298。

原 fulfilled-but-blocked 及 release-before-cleanup 两门漏洞已在实际实现中关闭：fixture 捕获原 db 的 own nonconfigurable native isOpen getter，以同一 receiver 调用，明确 false 与原 fulfilled/同 coordinator active0/runtime blockedfalse 合取。未知先 retain 后报红，无新 close/unblock/re-dispose，原错误身份/allcleanup 策略保持。

已核 C-root-gate-red 实际2fail/16过滤：两条真实 lease 时序所有前置谓词通过后才在精确保护的 rm 叶失败，旧红没有真删活 journal。父 forensics JSON 对两 exact root 在 PGID/worker 退出后核原 stat/nonce 再删除。AF not-completed 原断言移至 dispose 之前合理，其他4源不漂移。此处不把过滤案例或旧130pass1fail算新验收。

**B-C9-CODE-2（必改）**：factory120–125 新负例的 `await activityFixture(actions)`、`await acquireLease`、lstat/realpath 位于 try 外；该 describe 没有 afterEach。若上述 setup 失败，已注册的 actions、真实 owner、spy/env 的 cleanup 和 forensic root 记录均被跳过。最小将 try 覆盖从 activityFixture 起的全部资源分配，原 ticket 可选并在 finally 释放，partial setup 也执行 cleanupActivityCase(actions)。不改原 body、断言、门或预算。

修后新 SHA 再核即可；五完整文件24/22.22仍需实际最终日志，不提前称通过。

## setup guard 修后最终票

逐个重算六源，fixture eeafb32c…99b0 不变，factory **a10a9d3afeaf5babca461ae9a6a3ffc25483146304292680cd3e946499e60966**。实际125行 try 已覆盖 activityFixture、lease 和 stat/realpath 所有分配；ticket 可选。finally 依次独立尝试原 ticket release、所有 actions、restore、syncESM；清理也失败时聚合原 body/setup 首因与清理错误，没有 finally 覆盖原失败。既有全部谓词、native关闭回执及预算不改。

B-C9-CODE-2 关闭；前两关闭事实漏洞也已由当前 native getter gate 关闭，当前六源无必改，最终 **APPROVE（代码）**。此票限实际源码和已读有效红，待两版本五整文件实际结果另归档，不提前称成功。

## 实际最终结果已到齐

已独立读取两最终 verbose raw/metadata、逐文件133人口与最终六源 manifest：Node24 五整文件133/133通过；最低22.22同五文件17通过/116原 nativeAuthorizer 条件跳过，零失败。不能把116跳过记为通过。最终源码六 SHA 未漂移。

两个 `.forensics-cleanup.json` 与其各自真实 raw 的固定前缀记录完整集合相同，PID/PGID、workerPPID、nonce 和原 stat 逐个一致；两组已退出，Node24精确11个、22.22精确2个 root 全晚删，未知/global错误空。精确身份核验已由分区生成器逐项拒绝空集合/错run/错nonce/缺stat，未借别轮 cleanup 证据。

最终五文件替换原130人口，新增cleanup未知失败1条与真实lease时序2条，共133，不双累计。当前代码与该范围实际结果均闭环；它仍不是全产品或四 recipe 资格文件通过票。
