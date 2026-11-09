# #94：在现有快照 owner 内恢复只读历史 API

基准为 `5f564ef381fdc38a1c1096010e775fb2addb5cb5`。该版本 `src/runtime/task-host/snapshot-store.ts:912` 已有 uncached `readOriginalUserInput`，没有 `inspectPersistedTask` / `inspectPersistedInventory`。本片只在这个原 owner 增加两个异步 DATA 读取入口及私有负收尾；不替换原存储、写入队列、cache、prepare、source SDK、physical cut、protected observation 或关闭实现，不注册 Main/IPC/tool，不发 Source/Native 执行资格。

单任务读取沿原 `#readProtection` → 已进入的同任务 writer → 原 Source SDK checkpoint kind/alias 检查 → `#loadSnapshotState` → `#withProtection`。不补 execution cache、不观察执行完成、不修文件。身份语法与当前 `readOriginalUserInput` 一致，允许有效的 `task.one`，拒绝路径分隔符和前导点。目录读取沿原 `#sourceStat` 与 `#sourceSdk(names)`，纳入非 active 的终态任务；拒绝损坏、孤立 journal、非约定文件、symlink/junction 和多硬链接，不把部分读取称完整。POSIX 比较实际 uid；Windows不宣称 SID/ACL 证明。返回 DATA 不是跨文件原子快照，之后的权限 owner 必须自行重验当前源。

新私有 helper 在成功和失败时都等待原 `#joinSourceSync`；保留包括 undefined 在内的原错误，独立清理错误聚合，原 SDK unknown/failure latch 不清除。当前 `#sourceStat` 在传 context 时固定返回 BigInt metadata，因此 nlink 与 POSIX uid 按实际类型作精确比较，不去掉任何拒绝条件。

实施顺序：具体设计及对抗审 → 在旧类运行真实缺 API 红 → 加入方法 → 实际正负回归 → 类型/构建/旧相关 whole → 最终实际 diff 异模型审及正常 hook。新测试调用真实 FileTaskSnapshotStore 和 filesystem；覆盖 cache 旁路/不播种、删除、journal、终态 inventory、dots、损坏/orphan、临时文件、实际 hardlink/junction、protected 标记、真实 readFile 的 own-symbol 子尾，以及失败 stat 的 own-symbol 子尾。最后两项也检查没有提前完成或把 unknown 洗成 known。physical cut 必须按原协议先 `waitKnown()` 再 `assertKnown()`。

真实失败完整保留：旧类12F；首适配4P8F（新比较遗漏 BigInt，不能把4个负例假阳性当验证）；下一11P1F（测试新建 cut 后未先 waitKnown 的协议误用）。修后13项在 macOS Node24.16/22.14各通过，更多平台及完整最终 HEAD 另据实际日志确认，不迁旧票。新增独立 CI 在最低/当前 Node 与三OS编译真实 src/test graph 并运行原相关 emitted wholes；不改原测试预算、ignore 或 baseline。

评审记录保留原文：首轮指出 dots 兼容问题，已修。其 Promise 未 join、永久未完成 job 等结论在同篇被撤回；次轮的 readdir 持锁、stat 在 await 前、每次新建 context 与实际代码不符。实际 readdir 返回 names，stat 位于 pending writer await 后，ordinary context 原本缓存；后续以完整实际 diff 和真实负尾测试复核，不把无证模型标题当代码事实。
