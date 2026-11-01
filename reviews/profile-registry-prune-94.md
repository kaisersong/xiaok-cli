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

## 第三轮设计（取代前两轮 LRU / eviction 行为）

全表 sweep 与原有冲突、历史合并顺序保持；仅 stale 删除，IO 异常保留。清理后的完整候选一次校验/序列化，不再裁剪活记录。容量失败时只在内存中序列化当前 merged 单行一次用于分类：单源超限沿用专用提示；否则提示 registry 路径、候选活跃记录数及清理不再使用项目目录后重试。失败不写文件，sweep 删除也不部分提交。成功只递增一次 generation；no-op 仍先 sweep。

对抗性自审：IO 未知记录仍占容量，不能为腾空间删除；过期清理后仍超限须保持整个原文件；compact 与 decoded 两种预算均交由现有 codec 判断，不能按行数猜测；单源分类必须保留合并历史；错误后追加 context 仍识别前缀；成功一次、容量失败最多两次序列化，次数与表大小无关。保留所有 identity、锁、原子写边界。本轮仅 discovery 清理策略，不修改权限、环境变量或配置选择。

### 第三轮逐条回应与证据

1. 不再按 LRU 删除活记录。满表容量失败回归核对完整 DTO（含全部原行与 generation）及原始文件字节。
2. 全表 stale sweep 保留；ENOENT/identity 变化清理，EACCES/EIO 保留。满表 stale 后新增成功和 no-op 登记清理均覆盖。
3. 清理后候选超限整次拒写，保留 `profile_source_registry_capacity`；文案给 registry 路径、清理后已有活跃记录数（不含本次当前源）、清理不再使用的项目目录后重试。失败不持久化部分清理。
4. 删除活记录 eviction、warning 和 `ordinaryProfileSourceEvictionCount` 导出；对应测试改为拒写断言，保留无 warning 断言。
5. M1 无变化不重写保持；M2 正常成功完整序列化一次，容量失败至多两次（第二次仅分类当前单源），大表测试约束上界；no-op 先 sweep。
6. 先补测试再改生产。在 `cd26ff6cdb01c27e05b78c490937f93ce099969a` 生产代码上执行 `./node_modules/.bin/vitest run tests/runtime/verification/ordinary-profile-source-registry-prune.test.ts`：exit 1，2 failed / 14 passed；两项失败均为满表活记录仍成功、未抛 capacity。日志 `/tmp/fix94-r3-red.log`。超长合成路径明确注入 ENOENT 模拟 stale，避免系统 ENAMETOOLONG 被正确当作 IO 保留而误判用例。

全部运行前 `TASK_HOME=$(mktemp -d /tmp/fix94-r3-XXXXXX)`，设置 `HOME=$TASK_HOME XDG_CONFIG_HOME=$TASK_HOME/config XDG_DATA_HOME=$TASK_HOME/data XDG_CACHE_HOME=$TASK_HOME/cache`。测试内部继续独立 HOME/XIAOK_CONFIG_DIR/账户 home，不读写真实 `/home/box/.xiaok`。

最终验证命令与结果：
- `./node_modules/.bin/vitest run tests/runtime/verification/ordinary-profile-source-registry tests/runtime/verification/ordinary-registry-`：8 files / 73 passed，exit 0；`/tmp/fix94-r3-all.log`。
- `npm run build`：exit 0；`/tmp/fix94-r3-build.log`。恢复构建的 dist 和 src/build-info.ts，不提交产物。
- `npx tsc --noEmit -p .`：exit 0；`/tmp/fix94-r3-tsc.log`。
- `npm run governance:check`：exit 0，0 new violations；`/tmp/fix94-r3-governance.log`。
- `npm run architecture:check -- --changed`：exit 0，0 new violations；`/tmp/fix94-r3-architecture.log`。
- `npm run hygiene:check`：exit 1，upstream/master 落后和三个 sibling repo 缺失；按指定 HEAD 工作，未更新分支或 baseline。
- `git diff --check`：exit 0。

Codex 编码与对抗自审，未声称独立模型质量放行。未运行 Windows/macOS 实机或 CI；原有超限文件读取仍拒绝，O(N) 全表扫描仍保留。本轮不改权限或配置路径。测试/build/tsc/治理命令均退出，未启动持久服务；工作目录进程核对仅宿主 Codex/MCP，测试残留 0（`/tmp/fix94-r3-processes.json`）。缺陷尚未独立质量关闭，不修改外部台账状态。不 push、不合并、不发布。

### 第三轮补充：容量拒写诊断（基于 2b36331a57b97a2521d52d5e6ff4084f2ff9459f）

本次仅补充写入容量失败的两条提示。共同包含上限 `524288 bytes (512 KiB)`、清理失效记录后的既有 registry 序列化 UTF-8 字节数、既有活跃记录数和 registry 绝对路径。当前占用保留既有 generation/version，不含本次新增或合并后的源；全部失效时计算空 sources 的 envelope 字节。提示明确“删除或移走不再使用的项目目录后重试，失效记录会在下次写入时自动清理”和“也可以用编辑器打开该文件删除不再使用的项目条目（先备份）”，不建议删除整个 registry；单源超限仍额外提示缩短路径或减少元数据。

对抗自审：不拿磁盘旧文件大小或待写候选大小冒充清理后的当前占用；拒写后的 stale sweep 不部分落盘；沿用真实 codec 的 flat/compact 选择。容量失败多一次既有记录序列化，生产调用上界从 2 调整为 3，仍与人口数量无关；测试辅助函数另一次计算期望占用，因此大表断言总计最多 4 次。成功、no-op、身份检查、锁、活记录保留及 generation 行为不改。本次不改权限、配置选择或环境处理代码。

全部验证使用 `task_env=$(mktemp -d /tmp/fix94-extra-env-XXXXXX)`，创建 `$task_env/tmp`，设置 `HOME=$task_env TMPDIR=$task_env/tmp XDG_CONFIG_HOME=$task_env/config XDG_DATA_HOME=$task_env/data XDG_CACHE_HOME=$task_env/cache`；未访问真实 `~/.xiaok`。

- 测试先行，未修改生产时执行 `./node_modules/.bin/vitest run tests/runtime/verification/ordinary-profile-source-registry-prune.test.ts`：4 failed / 13 passed，日志 `/tmp/fix94-extra-red.log`。
- 修改后执行 `./node_modules/.bin/vitest run tests/runtime/verification/ordinary-profile-source-registry tests/runtime/verification/ordinary-registry-`：7 files passed / 1 failed，72 passed / 2 failed，日志 `/tmp/fix94-extra-all.log`。失败为原有 `recovers a retained registry lock only after the actual owning process exits` 和 `merges two actual process observations under the original registry lock without losing either`，均 15000ms 超时；未断言其根因或声称全部通过。
- 额外补齐“全部记录失效”边界后，重新执行 prune 套件：18 passed，exit 0，日志 `/tmp/fix94-extra-prune-final.log`。
- `npx tsc --noEmit -p .`：exit 0，日志 `/tmp/fix94-extra-tsc.log`。
- `npm run governance:check`：exit 1，Oxlint 执行被 `spawnSync /usr/local/lib/nodejs/node EPERM` 阻塞，日志 `/tmp/fix94-extra-governance.log`；未更新 baseline。
- `npm run architecture:check -- --changed`：exit 1，`spawnSync git EPERM`，日志 `/tmp/fix94-extra-architecture.log`。
- 开工 `npm run hygiene:check` 未通过：freshness 无法核实、upstream 落后 3 提交及三个 sibling repo 缺失；日志 `/tmp/fix94-extra-hygiene.log`。按指定 HEAD 工作，未拉取。
- 未启动持久服务；运行命令均退出，`/proc` 按工作目录核对测试残留 0，需额外清理进程 0，记录 `/tmp/fix94-extra-processes.json`。

Codex 编码与自审；未做独立质量放行、Windows/macOS 实机或 CI，不 push、不合并、不发布。本次只提交生产提示、回归断言和本评审记录，不提交 dist。

提交阻塞：已按要求检查 diff 并显式列出三个文件执行暂存和指定身份/消息的 commit；Git 无法创建 `/workspace/xiaok-cli/.git/worktrees/fix94/index.lock`（Read-only file system），暂存及提交均未成功。改动保留在工作区，未 push。

### 第三轮评审修订设计与对抗自审（4be3abfd）

设计：sweep 将同路径同 inode 的 device 重编号视为活跃，目录和 SQLite 文件均保留，仍删除缺失/换 inode 的行。复用设备重编号的物理身份判定，不修改登记冲突或历史合并规则。单源超限单独提示；读取超限给出文件实际大小和备份后编辑建议；诊断序列化异常退回磁盘字节数。

对抗自审：无关登记和 no-op 都必须保护其他活记录及历史；未知 IO 保留，换 inode 仍删除；所有容量失败均不得部分提交 sweep；兜底不增加序列化重试，正常拒写最多三次序列化。minor-4、minor-6 按要求不改。

### 第三轮评审修订结果

- major-1：抽出并复用 device 重编号物理身份判定，sweep 对同 inode 的 dev 变化保留；登记冲突仍保持原有严格判断。新增 A/B 后登记 C 和 A no-op 两例，B 为带 componentHistory 的 SQLite 记录；核对记录、历史和 no-op 原始字节。
- minor-1：当前占用断言改读 `readFileSync(registry).length`，不再调用生产 codec 计算期望值。清理后单源超限走专用提示，核对拒写字节不变。
- minor-2：删除 logger mock、state.warn 及全部 warning 断言。
- minor-3：单源超限仅提供上限、该源 expanded JSON 字节数及缩短路径/元数据建议；断言不含删除目录或编辑 registry 的建议。
- minor-5：读取超过 512 KiB 的文件，提示上限、实际文件大小、路径及先备份再用编辑器删除不再使用项目条目；不建议删除整个 registry。
- minor-7：existingBytes 序列化加 try/catch，异常退回磁盘字节数；注入第二次序列化失败，验证 capacity 前缀、完整诊断和原始文件不变。codec 调用上界仍为 3，与记录数无关；单源大小计算额外一次 JSON 序列化，仍为常数次数。
- minor-4、minor-6：按 CTO 要求保持不变。

验证（HOME/TMPDIR/XDG_CONFIG_HOME 均使用 mktemp 专用目录，未使用真实 ~/.xiaok）：
- 生产修改前 `npx vitest run tests/runtime/verification/ordinary-profile-source-registry-prune.test.ts`：7 failed / 14 passed，`/tmp/fix94-review-red.log`。minor-1/2 属测试纠正，不伪造必须失败的产品断言。
- 修改后 prune：21 passed，`/tmp/fix94-review-green.log`。
- `npx vitest run tests/runtime/verification/ordinary-profile-source-registry tests/runtime/verification/ordinary-registry-`：首次 74 passed / 4 failed，`/tmp/fix94-review-all.log`；其中两项是长临时路径使 2000 行 fixture 文件自身超过 512 KiB。改用 `mktemp -d /tmp/f94-XXXXXX` 且 TMPDIR 为其 t 子目录重跑：76 passed / 2 failed，`/tmp/fix94-review-all-short.log`。剩余两项为原有真实子进程锁恢复和并发历史合并测试，各 15000ms 超时；未核实根因，不声称全通过。
- `npx tsc --noEmit -p .`：exit 0，`/tmp/fix94-review-check-0.log`。
- `npm run governance:check`：exit 1，Oxlint 的 spawnSync node EPERM，`/tmp/fix94-review-check-1.log`。
- `npm run architecture:check -- --changed`：exit 1，spawnSync git EPERM，`/tmp/fix94-review-check-2.log`。
- `npm run hygiene:check`：远端 freshness 无法核实及三个 sibling repo 缺失，未通过；未修改 baseline。
- `git diff --check`：exit 0。未启动持久服务，测试命令均退出；按本工作目录检查测试进程残留 0，额外清理 0，`/tmp/fix94-review-processes.json`。

Codex 实现和对抗自审，未做独立模型质量放行、CI 或 Windows/macOS 实机验证；未关闭缺陷或发布，不修改外部台账。不 push、不合并，不提交 dist。

提交阻塞（本轮实测）：检查 diff stat 后显式暂存上述三个文件，Git 无法创建 `/workspace/xiaok-cli/.git/worktrees/fix94/index.lock`：Read-only file system。按要求不重试；未暂存、未执行 commit，工作区修改保留，未 push。
