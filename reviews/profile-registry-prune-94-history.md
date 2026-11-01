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

## 第二轮设计与对抗自审

M1：恢复内容相同且 sweep 无删除时早退，不因数组位置重写；LRU 仅代表最近实际持久化登记顺序。M2：一次编码 compact 行，分别累计 flat/compact UTF-8 行字节及 envelope 开销，选择同时满足 storage/decoded 限额的最短淘汰前缀；最终完整 validator/serializer 各一次。M3：仅成功写入后通过现有 logger warning 输出淘汰条数及 registry 路径。

对抗自审：容量必须同时考虑 flat 可直接落盘与 compact fallback、逗号及 envelope 字节、decoded 上限和 generation 位数；当前行恒为尾行，最多淘汰前 N-1 行；IO 保留不能吞编程异常；失败写盘不能发成功淘汰提示；现有 identity/uid/nlink/symlink 校验不得放宽。存量超限自愈需同时调整 codec 的 compact admission/decoded budget，扩大持锁解析攻击面；本轮保持读侧 512KiB 硬限并明确报告限制，避免仅放宽 fs 读限却仍被 codec 拒绝。

### 第二轮逐条回应（最终行为以本节为准）

- **M1 已处理**：`ordinary-profile-source-registry.ts:152` 删除“必须处于末尾”条件。内容相同且未清理任何行时保留文件字节、generation 和顺序；取舍是 no-op 不刷新 LRU，只有实际持久化的登记移至尾部，避免热保存路径的原子重写。新增非末尾行的 bytes/generation 回归，并修正原 LRU 测试的预期。
- **M2 已处理**：codec 的 `ordinaryProfileSourceEvictionCount` 一次编码并逐行计算 flat/compact UTF-8 字节，包含 envelope、逗号与 generation，累计确定最短淘汰前缀；同时遵守 decoded 上限。登记随后只做一次完整 parse 和一次 serializer 调用，不随淘汰条数重复。2000 行 compact 满表回归由原 HEAD 的 **437 次序列化**降为严格断言 **1 次**，当前行始终保留。
- **M3 已处理**：成功原子写入、目录同步和最终 identity 检查后，现有 `createLogger('profile-source-registry').warn` 记录淘汰条数与 registry 路径；不记录 source 内容、目录列表或数据库名。独立回归验证 warning 的完整参数，失败登记无 warning。
- **minor 文案/异常已处理**：单条当前源超限提示“current source itself exceeds”，明确删除 registry 不能解决；codec capacity 用 `startsWith`，测试追加 `: context`；sweep 仅保留带字符串 `code` 的 IO 异常，TypeError 照抛且文件不变。
- **minor 测试补齐**：compact v3 prune/evict、sqlite database 文件 EACCES/EIO 保留、2000 行未超限不淘汰、多行满表当前行保留均调用真实生产登记入口。合成 stat 只替代不便建立的超长路径/大人口，不替代淘汰逻辑。
- **存量 >512KiB 仍拒读，不做自动自愈**：`ordinary-profile-source-registry.ts:118` 保持原文件硬限，codec 的 `decodeOrdinaryProfileSourceStorage` 同时限制 compact 原始大小与 decoded 大小。持锁加到 8MiB 不能独自解决 codec admission，还需要单独设计有界恢复解码及其攻击性测试；本轮不扩大该入口。uid/nlink/O_NOFOLLOW、fd/path identity、symlink、跨进程锁及最终源 identity 检查保持。用户仍需按错误提示先备份 discovery registry 再移除重建。

### 第二轮实测证据

每条命令前均创建 `TASK_HOME=$(mktemp -d /tmp/fix94-XXXXXX)` 并设置
`HOME=$TASK_HOME XDG_CONFIG_HOME=$TASK_HOME/config XDG_DATA_HOME=$TASK_HOME/data XDG_CACHE_HOME=$TASK_HOME/cache`；测试内 HOME/config/XDG 也独立。未访问真实 `/home/box/.xiaok`。

1. **原 HEAD da9d5b955c5708e973f593d7830727bb0480d8a8 红测**：
   - `./node_modules/.bin/vitest run tests/runtime/verification/ordinary-profile-source-registry-prune.test.ts`：5 failed / 8 passed，exit 1；日志 `/tmp/fix94-round2-red.log`。失败为 no-op LRU 语义、单源文案、非末尾 no-op、编程错误被吞及大表 437 次序列化。
   - 为独立确认 warning 与错误前缀，将两个生产文件临时还原为原 HEAD（finally 恢复本轮内容）后执行同命令加 `-t 'warns with only|recognizes capacity'`：2 failed / 13 skipped，exit 1；日志 `/tmp/fix94-round2-red-extra.log`，分别是 warning 调用 0 次和 capacity 上下文未被识别。
2. **最终 registry 全部核心套件**：`./node_modules/.bin/vitest run tests/runtime/verification/ordinary-profile-source-registry*.test.ts tests/runtime/verification/ordinary-registry-*.test.ts`：8 files / 72 passed，exit 0；日志 `/tmp/fix94-round2-all.log`。
3. **全部直接消费端扩展检查**：`./node_modules/.bin/vitest run $(rg -l 'ordinary-profile-source-registry' tests --glob '*.test.ts') tests/runtime/verification/ordinary-registry-*.test.ts`：13 files passed / 8 failed，155 passed / 3 failed / 218 skipped，exit 1；日志 `/tmp/fix94-round2-consumers.log`。6 个 captured-* 文件的 beforeAll 与 native-profile-registry-custody 的 2 项因 `spawnSync clang ENOENT` 受阻；profile-account-home-symlink 的 NUL 诊断 1 项失败，原 HEAD 上用 `-t 'escapes NUL'` 复现同样失败，日志 `/tmp/fix94-round2-baseline-account.log`。因此不宣称消费端全绿；最终更严格的“序列化恰好 1 次”断言在本次扩展运行中通过。
4. `npm run build`：exit 0，日志 `/tmp/fix94-round2-build.log`。`./node_modules/.bin/tsc --noEmit`：exit 0，日志 `/tmp/fix94-round2-tsc.log`。构建产物及 build-info 均已还原/清理，不提交。
5. `npm run governance:check`、`npm run architecture:check -- --changed`：exit 0，0 new violations，日志 `/tmp/fix94-round2-governance.log`、`/tmp/fix94-round2-architecture.log`。
6. 开工 `npm run hygiene:check`：exit 1，分支较 upstream 落后 2 提交，三个预期 sibling repo 路径缺失；按用户指定 HEAD 继续，未拉取或改 baseline。
7. `git diff --check`：exit 0。未启动持久后台服务；会话中的 vitest/build/tsc/治理子进程均已退出，收尾 `/proc` 核对工作目录下仅宿主 Codex/MCP 服务，测试进程残留 **0**，未清理其他任务进程。

本轮为 Codex 编码和对抗自审；输入报告分别为 ds-clean 不通过（3 major）和 glm-clean 通过（minor），不将它们表述为对本轮最终 HEAD 的独立放行。未做 Windows/macOS 实机、CI 或最终 HEAD 独立质量复验；未合并、未 push、未发布。全表 lstat 仍为 O(N)，本轮消除了逐行淘汰的 O(k*N) 校验/序列化，未引入持久时间字段。新增经验已落实在本文件和生产入口回归：no-op 必须覆盖非末尾位置，大表容量回归约束调用次数并验证当前行保留；尚未关闭缺陷/发版，不改外部台账状态。

