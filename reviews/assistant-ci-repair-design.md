# Assistant 六格 CI 共性失败修复（实现前）

实测 Node v22.14.0 的 DatabaseSync 没有 isTransaction。相同来源在本机 Node 24 通过，但最低版本真实跑 assistant-derived-lineage/loop-store/knowledge 三文件出现事务门禁误拒绝和回滚遗漏。不是把失败归为 runner 慢，也不提高 engines 或删测试。

设计：新增窄 isSqliteTransactionActive 兼容读。原生 boolean 存在时直接读；旧 Node 同步执行固定 BEGIN，若成功立刻 ROLLBACK 并返回 false；只把准确的 SQLite “cannot start a transaction within a transaction”/ERR_SQLITE_ERROR/errcode=1 当作 true，其余错误原样抛出。BEGIN 为 deferred，不修改数据，不跨 await；失败的嵌套 BEGIN 不改变外层事务。所有现存 isTransaction 判定统一调用，覆盖 LoopStore/Completion/诊断 owner 回滚、KB 内外事务、lineage 必须外层事务、native migration 和 metadata 只读 guard，不只修一处。

对抗自审：外层 BEGIN/SAVEPOINT 不能被回滚或释放；无事务的探针不能留下事务；未知/关闭/锁错误不可被解释成“无事务”；原生 getter 抛错不吞。真实 SQLite 测试覆盖这些边界，并在实际 22.14 与当前 Node 运行原集成回归。兼容 helper 不授予 protected/native authority，不改变用户数据路径或 actor。

CI 装配：显式 checkout 固定 SHA 的 kswarm/intent-broker，并安装实际 fixture 依赖；不依赖本机 sibling WIP。Windows 在普通源测试前编译并安装既有 Windows installation-absence 原生 helper，使真实 fixed-path reader 能判断 ordinary；缺 helper 的拒绝边界仍保留测试。不能把 production fail-closed 改为 default ordinary，也不以 mock/skip 掩盖 Windows。

仍需分组核查 Windows 原生 durable barrier 试验与普通源测试的夹具、路径语义。涉及 POSIX-only 保护能力的用例必须保留真实 Windows unsupported 断言，不能用成功替身宣称平台已支持；可移植普通能力需真跑。

Windows native Goal journal 的 requireDirectorySync 在产品中明确 unsupported。既有完整 native mutation 竞态套件仅在 Linux/macOS 验证该 POSIX 能力；Windows 改为实际 createGoal 拒绝、无 native RPC、无 Goal/任务写入的回归，不使用伪造成功 writer。纯输入校验/普通线程用例仍跨平台执行。

第二轮最低版本实测：Goal attachment/workspace 两个既有真实 host 夹具仅映射 delivery Worker，遗漏了同一交付流程的 protection-read Worker。Node 24 可直接执行该 TS，22.14 在 snapshot 阶段拒绝、真实 receipt 为 snapshot_read_failed，不能当 runner 慢。夹具统一复用现有 compileProtectionWorkerEntry（实际 typecheck/emitted entry、原模块 URL、输入 hash 审计），只映射固定 Worker 地址，保留真实线程与全部 IO/退出/原断言；不改生产 protected reader。两个 Goal 文件及 KB 持久回归在 Node22.14 实跑 95 项全过。KB 外层事务断言改为实际嵌套 BEGIN 拒绝，独立证明外层仍活着，不再依赖该版本没有的属性。红绿日志分别为 node22-goal-red.log、node22-goal-diagnostic.log、node22-goal-green.log。

Windows 实跑的下一层：copier 在 ASAR list 后把内部 key 规范为 POSIX，但 @electron/asar 的 getNode 按宿主 path.sep 分段，随后 statFile/extractFile 接收到 `/` 会找不到嵌套项。修复只在调用 ASAR API 的边界使用 path.normalize(key)，内部 manifest/map/依赖 identity 保持 POSIX，不改变访问范围；原四个实际 archive/Electron/缺依赖/版本拒绝回归保留，并归一化其独立 ASAR 读取断言。Windows fixture 清理改调用 setup 既有 default fs.rmSync wrapper；不全局改变生产 named binding，不吞业务断言或改变产品文件清理语义。普通源 2000 行容量夹具另使用宿主盘根下短的虚拟路径（全部经过既有 lstat/realpath mock、实际 registry 仍位于独立临时目录），避免 macOS temp 前缀长把“低于容量”前提破坏，保留 2000 行和 512 KiB 原门槛。

远端 660a61ed 的 Linux/macOS 失败已精确收敛为两个 beforeAll 的 10 秒默认预算，不是用例执行超时：新补的 fresh protection Worker 必须真实 tsc/typecheck、source audit 后再运行。为此只将这两个及同夹具 foreground 的编译 setup 上限设为 60 秒，同时给实际 tsc 子进程设 45 秒 timeout（execFile 回调等到物理 close 后才结算，失败沿原 catch 清理 root），留下 bundle/audit/teardown 余量。产品 deadline、取消/撤权断言、测试用例 timeout 均未放宽；不设 noCheck、不 skip、不复用旧产物。原始失败日志 ci-660-ubuntu24.log、ci-660-mac24.log；修复后本机三个文件的 4 项所选关键场景通过，275 项未选中，完整最终 CI 另验。

Windows emitted reader 的 import.meta.url 指向 fresh 编译目录，不能只给 TS source 目录装 helper。编译夹具先确认实际 emitted windows-installation-absence.js 存在，再用原 verifyArtifact 校验固定 data/verification/windows 的 SDK 产物、拷贝两个固定文件到同一 emitted module 的 native 子目录、再次验证。原生 helper 缺失/错误仍 fail closed。CI 加入现有完整编译入口/真实普通读取/物理退出回归；本机该文件 6 项通过，完整 collector 679 项通过、7 条件跳过。GLM 首票虽写 APPROVE 却列两项 P1，不计为无阻断批准：第一项增加 emitted reader 明确存在性 guard；第二项关于外部 .d.ts 的假设由实际 tsconfig 仅 include src/**/* 排除。补齐完整 Worker/store 源码后，GLM 最终票明确 APPROVE、无 P0/P1；两票均保留，见 artifacts/openduet-followup-20261101/emitted-worker*。

Windows 00320a29 原始逐案例日志另显示 factory/material 的完整夹具需 4.6–9.1 秒，8 项触发 5 秒默认测试总预算；macOS/Linux 四格已全部通过。只给 readiness 的原 each、material revision 的两个原 each、attachment 同 ID 旧回执单项增加 Windows 20 秒总预算，其他平台仍 5 秒。内部 gate/revoke/regrant、500ms 响应、模型/任务副作用计数和等待断言原样保留；不把产品动作时间上限改成 20 秒，不改变 beforeAll 编译预算，也不全局放大 timeout。三文件本机全部 81 项通过，windows-fixture-budget-mac.log；Windows 最终是否通过由新完整 HEAD 六格作证。补充完整 Node22.14 collector 首次从 root 误用 --root 导致 15 个 cwd 路径错误，保留日志，改为和 CI 一致的 desktop cwd 后 679 passed / 7 条件跳过（head272-full-node22-desktop-cwd.log），不将错误调用算产品回归。

事务修复的相邻 owner 覆盖补齐到 CI：loop-database-owner、loop-native-schema、loop-artifact-export-journal、kswarm-health-capacity 四文件。最低 Node 首跑 7 处旧测试直接读取不存在的 db.isTransaction 失败，业务断言其余 41 项通过。改为独立实际 SQL 证明：应已回滚时 BEGIN;ROLLBACK 必须成功，应保留原事务时嵌套 BEGIN 必须拒绝；全部原始行、容量、foreign_keys 和故障恢复断言保留，不在测试重写事务探测 helper。Node22.14 与 Node24 各实跑 48 项全过，原始 transaction-brothers-node22-red.log 与两个 green.log 保留。测试清单增至 90 文件，未削减原 86 文件。
