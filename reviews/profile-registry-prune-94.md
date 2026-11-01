# #94 登记清理与容量设计

登记锁内先完成既有冲突判定和重绑历史合并，再用 isStaleOrdinaryProfileSource 扫描其他行。仅缺失或 identity 变化删除；其他 IO 异常保留。当前 namespace/source 的冲突检查保留既有拒绝语义。

sources 顺序作为登记使用顺序（最旧在前），成功登记移到末尾；已经在末尾且内容未变时保留原 no-op/generation 语义。读取不更新顺序。旧文件没有使用时间，因此首次按已有顺序初始化，不引入字段或版本。容量以现有序列化器生成的实际 UTF-8 字节为准（包括 compact fallback），逐个淘汰最旧的非当前行。每次实际写入仅递增一次 generation，失败不写。

对抗性自审：不能先删当前 namespace，否则重绑丢失 componentHistory；sourceId 冲突旧行仍按既有路径合并历史；扫描异常不能视为 stale；容量异常可能来自 serializer 而非 byteLength，必须同时处理；不能吞 schema 异常；单条过大要终止，不能删当前行；generation 溢出不能通过淘汰修复。读取超大文件仍拒绝，在 identity 前缀后补路径和处理方法。锁、原子写与最终 identity/route 检查保持。

回归先于生产改动，覆盖循环临时目录、IO 异常、重绑、LRU、不可容纳、旧格式。此改动是 discovery inventory 维护，不改变授权或配置选择。

## 验证记录（2026-11-01）

所有 vitest 命令均使用 `registry_test_home=$(mktemp -d)`，并在命令前设置：
`HOME="$registry_test_home" XDG_CONFIG_HOME="$registry_test_home/config" XDG_DATA_HOME="$registry_test_home/data" XDG_CACHE_HOME="$registry_test_home/cache"`。
测试框架原有 profile-account setup 继续隔离账户 home。

- 生产代码未改时：`npx vitest run tests/runtime/verification/ordinary-profile-source-registry-prune.test.ts`，6 failed / 0 passed；原始日志 `/tmp/fix94-red.log`。循环目录用例在第二次登记发现两行；LRU 抛裸 capacity；错误提示断言失败。
- 最终：`npx vitest run tests/runtime/verification/ordinary-profile-source-registry*.test.ts tests/runtime/verification/ordinary-registry-*.test.ts`，8 files / 63 passed / 0 failed；日志 `/tmp/fix94-all.log`。包含旧 v1/v2、compact v3、身份冲突、历史合并、锁与 fsync 等原有检查。
- compact 容量测试的合成行现提供匹配的 stat 观测，保持原有完整人口及无丢失断言，避免不存在的 fixture 被清理后绕过容量覆盖。
- `npm run build`：exit 0，日志 `/tmp/fix94-build.log`；构建产生的 dist/build-info 变更已清理，不提交产物。
- `npm run governance:check`、`npm run architecture:check -- --changed`：exit 0，0 new violations；日志 `/tmp/fix94-governance.log`、`/tmp/fix94-architecture.log`。
- `npm run hygiene:check`：exit 1，环境缺少 `/workspace/kswarm`、`/workspace/intent-broker`、`/workspace/kai-xiaok-plugins`，未更改 baseline。

限制：旧文件无真实时间戳，首次以既有顺序作为 LRU 初值；读取本身不视为登记使用。已超过读取字节上限的文件继续拒绝读取，给出备份/移除 discovery registry 后重试的提示，不自动解码超限文件。不涉及源数据删除。未做 Windows/macOS 实机验证。未启动持久后台服务，测试子进程由既有 teardown 回收。
