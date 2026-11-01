# Assistant 六格 CI 共性失败修复（实现前）

实测 Node v22.14.0 的 DatabaseSync 没有 isTransaction。相同来源在本机 Node 24 通过，但最低版本真实跑 assistant-derived-lineage/loop-store/knowledge 三文件出现事务门禁误拒绝和回滚遗漏。不是把失败归为 runner 慢，也不提高 engines 或删测试。

设计：新增窄 isSqliteTransactionActive 兼容读。原生 boolean 存在时直接读；旧 Node 同步执行固定 BEGIN，若成功立刻 ROLLBACK 并返回 false；只把准确的 SQLite “cannot start a transaction within a transaction”/ERR_SQLITE_ERROR/errcode=1 当作 true，其余错误原样抛出。BEGIN 为 deferred，不修改数据，不跨 await；失败的嵌套 BEGIN 不改变外层事务。所有现存 isTransaction 判定统一调用，覆盖 LoopStore/Completion/诊断 owner 回滚、KB 内外事务、lineage 必须外层事务、native migration 和 metadata 只读 guard，不只修一处。

对抗自审：外层 BEGIN/SAVEPOINT 不能被回滚或释放；无事务的探针不能留下事务；未知/关闭/锁错误不可被解释成“无事务”；原生 getter 抛错不吞。真实 SQLite 测试覆盖这些边界，并在实际 22.14 与当前 Node 运行原集成回归。兼容 helper 不授予 protected/native authority，不改变用户数据路径或 actor。

CI 装配：显式 checkout 固定 SHA 的 kswarm/intent-broker，并安装实际 fixture 依赖；不依赖本机 sibling WIP。Windows 在普通源测试前编译并安装既有 Windows installation-absence 原生 helper，使真实 fixed-path reader 能判断 ordinary；缺 helper 的拒绝边界仍保留测试。不能把 production fail-closed 改为 default ordinary，也不以 mock/skip 掩盖 Windows。

仍需分组核查 Windows 原生 durable barrier 试验与普通源测试的夹具、路径语义。涉及 POSIX-only 保护能力的用例必须保留真实 Windows unsupported 断言，不能用成功替身宣称平台已支持；可移植普通能力需真跑。

Windows native Goal journal 的 requireDirectorySync 在产品中明确 unsupported。既有完整 native mutation 竞态套件仅在 Linux/macOS 验证该 POSIX 能力；Windows 改为实际 createGoal 拒绝、无 native RPC、无 Goal/任务写入的回归，不使用伪造成功 writer。纯输入校验/普通线程用例仍跨平台执行。
