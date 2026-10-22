# A补批：Main完整字节绑定的已审演进

对象：B明确交接的五文件：mcp-registration-main-ownership、mcp-registration-actual-main、mcp-registration-promise-admission、python-preparation-main-lifetime、rejected-bridge-gateway-ownership及它们的专用fixture。B未修改，A不触生产Main或B4文件；room-field-classification未接手。

## 红证与根因

`A-main-binding-red`原五文件完整source命令，maxWorkers1：41failed1passed/42，5files failed，原始log/runner在remediation目录。首因全字节绑定r324/r334/office_python NOT_READY；未进入真实callback时序测试，不是已证明的生产泄漏。

旧r299 candidate为106859 bytes、SHA256 `9c874df44ea458ed7f780355081e5b2b0fa788970393c8d19b20f03895df377f`。当前Main为107337 bytes、SHA256 `f25ac6d5034918fef0d3207780429bd7773adc1b7e932b0dc3707e4d8c1d5d40`，来自已提交d0e的Main（最近改动2e155c72），不是本轮WIP。

已逐行完整diff核验，差异只有：

1. 导入并创建activity owner一次提示；KSwarm启动失败回调发提示和日志。
2. 新增local-memory自有lifetime disposer。
3. activity project event/connection observer从void/floating改为返回原Promise，让实际owner跟进原异步工作；取消独立swallow warning。

这些是既有主干已提交演进，不能还把旧r299完整文件作为当前运行源。它们不改MCP/Python/bridge测试实际选取的ownership函数/receiver/callback顺序。`A-main-source-audit.json`独立AST与byte审计19项全相等：startOwnedMcpRegistration、assertMcpRegistrationPromiseAmbient、registerLifetimeDisposerStep；六份Promise witness常量和desktopShutdownCoordinator初始化；八份bridge/MCP状态与owner声明；Python标记至EOF整段。没有动态以当前源码作为运行时期待值。

## 最小修法与冻结边界

保留所有历史r299/r324 BEFORE与candidate文件及原SHA，不能改写历史证据。新增单独完整静态快照`desktop/tests/fixtures/remediation-20261022-main-reviewed.txt`，内容就是本次已逐行审定的107337 bytes；把当前POST验证指向新快照和上述固定literal SHA。不是运行时自动拷贝、自动算期待hash、fallback旧golden或只绑定AST子集；actual Main仍须与静态快照完整bytes相等且SHA正确，之后编译执行同一次actual read的源码。

受影响位置只有两个共享fixture、mcp-main-ownership的candidate选择/固定SHA、rejected-bridge的完整bytes+SHA绑定；actual-main/promise/Python各行为case不改期望。历史before分支继续旧快照。新增source evolution audit回归：新完整bytes绑定先通过，再对旧r299与新reviewed快照执行上述关键函数/状态/Python tail精确文本不变检查。原普通/final callback顺序、reservation/writer先注册、method receiver、original Promise identity、same raw failure、zero producer、getter0/species/constructor/then negative population等42原case保持原样。

任何后续Main改动仍应使固定byte/hash绑定先红；不能以“无关源码演进”为理由取消full binding。若绿测出现新的semantic failure，保留原错并另行调查，不能改expect迎合当前输出。

## 实施和验证门

先root/B/C任一独立对抗审批本设计，再写上述新静态快照与fixture绑定。原五文件42项全部跑，不仅选BIND；新增audit另计。每次maxWorkers1、原case deadline/资格不动。由主笔统一main build/typecheck/governance/architecture与最终GLM5.3复审；本批不更新baseline、不提交、不操作shared服务或sibling。PID/PGID与log/SHA保存A-*。
