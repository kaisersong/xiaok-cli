# OpenDuet 中断恢复与最终候选验证（2026-11-01）

## 下午继续实施与最终候选

用户已授权完成开发验证后提交 GitHub。当前已整合主线至 624c43c4，保留 assistant 与 Kimi admission；唯一内容冲突是 desktop-services 的 imports，合并后保留双方导入。主线两份文件触发本机单文件令牌门禁，评审文档按历史/当前方案分文件，registry 只压缩注释，不修改逻辑。PR #116 最终完整 HEAD 和对应远端结果以 PR 说明为准，不把旧轮成功带到新 HEAD。

本轮实际执行，原始日志均在 .artifacts/openduet-followup-20261101/：

- 完整 workflow collector（新增真实 compiled protection Worker 入口后 86 文件）：679 passed / 7 条件跳过；final-with-emitted-worker.log。默认六个 counter 环境用例另以实际官方资源全量执行，31 passed / 0 skipped；final660-official-counter.log，使用已有 synthetic-counter-config，无产品模型调用或真实配置改写。
- Root 先 test:sandbox:build 再 emitted 九文件（原六文件 + project handoff、Kimi K3.1、profile registry）：204 passed / 7 既有跳过；final-root-build.log、final-root-green.log。新主线 profile 2000 行夹具最初在 macOS 长 temp 前缀下超出原容量，修复虚拟路径长度后保留全部 2000 行/512 KiB 门槛通过。
- Node22.14 的 Goal attachment/workspace 与 KB 持久三文件：95 passed，node22-goal-green.log。SQLite helper/lineage/LoopStore/KB 四文件：44 passed，node22-final-helper.log。原始 red/diagnostic 全部保留；没有提高 engines、删除断言或无条件跳过 Windows。
- 新主线交接与最终交付物跨层七文件：60 passed，merged-upstream-tests.log。正式 foreground 两个限定场景：2 passed / 193 名称未选中，foreground-final.log，不称整文件全绿。Windows copier/source target 八项：8 passed，windows-absence-final.log。
- Desktop main/renderer 完整构建与 raw typecheck、完整治理通过，未更新 baseline；merged-build.log、emitted-worker-typecheck.log、emitted-worker-governance.log。增量架构在干净 HEAD 扫描 0 文件，不替代完整治理。

Windows ASAR key 读取分隔符、清理夹具命名导出、最低 Node 两个真实 Worker 装配、fresh 编译预算及验证过的 Windows helper emitted 装配均记录在 assistant-ci-repair-design.md。独立 GLM-5.3 票据见 artifacts/openduet-followup-20261101/，包括真实 HTTP 状态、model、finish_reason、source hashes 与未删的 P2/P3；首张 emitted Worker 票的矛盾 P1 没有冒充闭环，后续完整上下文最终票单列。

最新产品源码在 660a61ed 完整 unsigned macOS arm64 包上复验：1,471 个 dist 文件 mismatch=[]，closure 二次 copied=[]，archiveUnchanged=true、helper bytes 相符，全部 afterPack 门禁通过。打包前后 source/dist/resourceInputs/siblings 均 unchanged；followup-660a61ed/ 与 final660-package-* 日志。后续改动仅测试夹具、CI 清单、评审证据，不更换产品模块。没有正式签名或发布。

**本轮 GUI 尚未通过。** 三次私有配置/OS policy 启动在 Electron browser DevTools 握手前超时；sample 实际显示主线程在 NSApplication.finishLaunching → _NSPersistentUIEstablishTalagentCommunication → _send_to_talagent 的同步 IPC 中等待。Node inspector 可访问，Chromium HTTP 超时，无助理业务表初始化。忽略持久 UI 恢复的单次实验也未解除阻塞；不修改或结束用户系统 talagent，不把旧 GUI 通过当本轮通过。原始 result/trace/sample 留在 final660-packaged-gui*、gui-timeout-sample.txt、final660-ignore-persistence-gui/。每轮按自有 PID/独立 cwd 补查，remaining=[]，private root 已删除；没有接管既有服务。

真实 P1/P2/P3 与 Windows 安装包门槛仍按下文保留；hygiene 对 sibling intent-broker 既有 tracked WIP/上游落后仍失败，不整理或提交别人的改动。mydocs 的过期“未实施”状态已在独立文档 PR kaisersong/mydocs#18 更新。

## 桌面恢复后继续复验

用户确认桌面恢复正常后，原隔离驱动仍在 GUI 启动前超时。另经实际 GLM-5.3 静态复核的 ignored 诊断副本采用真实 account HOME、全部业务根仍独立私有目录，并保留 OS 外联/写入限制、增加敏感路径读拒绝与真实 canary 读写拒绝探针；不将 CLI 的 global-plugin flag 当 Desktop 隔离证据。原始全文件代码票曾因输出预算耗尽未产生 verdict，不当作批准；修复 closeError 原文残留并增加实际 main 全部根环境断言后，最终 HTTP200/stop/APPROVE、无 P0/P1，P2/限制原文保留。票据中的模型自述身份不作为模型证据，以原始 API responseModel=glm-5.3、响应 hash 为准。

诊断实际执行 account-home-bounded-gui/result.json：OS canary readDenied/writeDenied=true、子进程已回收；Electron launch 再次 TimeoutError，未到 main 环境断言、renderer、UI 或 SQLite 审计，因此不能声称 GUI/defaults 已验收。正常 OS GUI bookkeeping 被明确接受，未修改或结束系统 talagent，也未进一步放宽沙箱。原始 stdout/stderr、错误文本没有留存；只写固定诊断错误码。原版重试与诊断版均按独立 private cwd/PID 补查并回收，具体结果见各自 cleanup manifest。当前 GUI 阻塞保留。

最低 Node 的相邻 Desktop cross-platform 原完整 23 文件清单实跑 281 passed / 1 条件跳过；cross-platform-scope-local.log/json。afterPack/copier/runtime 三文件 45 passed / 1 条件跳过；afterpack-chain-green.log。远端原 Windows 和 macOS 同一旧顺序夹具失败已复现修正，不用无关 baseline 归因掩盖。最终 CI/test-only 静态票 final-ci-wiring 为实际 GLM-5.3 HTTP200/stop/APPROVE、无 P0/P1；精确两名称已保证不能少跑一项，193 项本就是名称未选中，故不采纳票中 numPendingTests=0 的建议；其余非阻断 P2 保留。

## 前轮历史记录

继续原分支 feat/openduet-assistant-20261101、原草稿 PR #116。恢复起点为 9e237f85（原实现 93992a44 加 upstream 集成），没有重写或重放真实交办。设计 v3 已从 mydocs GitHub 原路径重新读取；不覆盖主 docs checkout 的其他 WIP。

本轮补 CI 覆盖、验证记录，并修复人工复核文件增长时的读取上限与内部祖先关联的撤权依赖。设计、真实文件先红后绿与不同模型复审分别留证。最终完整 HEAD、远端 CI 状态以 PR 说明为准。原始命令/PID/退出码/日志在已忽略的 .artifacts/openduet-recovery-20261101/；不使用对话摘要补数字。

## 本机重新执行

命令从本任务 xiaok-cli 工作树根执行。

| 检查 | 实际入口 | 结果与原始日志 |
| --- | --- | --- |
| Desktop 功能与正式准入 | 最终 workflow 84 文件完整清单 | 668 passed / 6 counter 环境跳过；lineage-final-desktop-tests.log |
| 相邻持久 owner、持续持有只读工具 | Desktop loop-store、completion-evidence-store、automation-overview、desktop-readonly-audit-retained 四文件 | 50 passed；desktop-store-brothers.log |
| 真实 foreground 准入 | Desktop desktop-services 文件，名称过滤 assistant admission 或 assistant workspace replacement | 2 passed / 191 未选中；foreground-admission.log，不算整文件全通过 |
| Root emitted | npm run test:sandbox:build，再运行 workflow 六个 root 文件 | 140 passed / 7 既有跳过；root-compile.log、root-tests.log |
| 实际官方离线 counter | 本任务 synthetic config 和已下载官方资源，provider/resources/counter 三文件 | 31 passed / 0 skipped；official-counter.log。无生产模型调用或真实配置写入 |
| 编译与类型 | npm run build --prefix desktop；npm run typecheck:raw --prefix desktop | exit 0；lineage-final-build.log、lineage-final-typecheck.log；原大 chunk 提示保留 |
| 治理 | npm run governance:check；npm run architecture:check -- --changed | exit 0，零新增违规，不更新 baseline；lineage-final-governance.log |

Root 首次命令额外带了两个不存在的 root store 路径，Vitest 实际只运行上述六文件；已按真实日志计数。store 回归另在正确 Desktop 路径运行，未冒称运行八个 root 文件。

另增生产抽样/两阶段导入回归：200 事实先抽样成 100，再导出风险包及行动包并导入成功，10 项该文件回归全过（quality-population-adjudication.log）；它用于核实审查假设，不是人工质量证据。

CI 补入 root model identity、Desktop identity revocation、retained readonly、三个相邻 store/overview 文件及 foreground 两项选定回归；新增助理 feature 分支 push 触发。保留 Node 22.14.0/24 × Linux/Windows/macOS 六格，无 skip/continue-on-error。Windows 结果只由远端作证。

## 最新 unsigned 包与真实 GUI

最终两项修复 fresh build 后，依次执行 manifest-inputs.py before、frozen-repack.py recovery-lineage-final --fresh-dist、inspect-success.cjs recovery-lineage-final、manifest-inputs.py after。全部 exit 0；1,468 个 dist 文件逐一匹配，差异 0，闭包二次复制 0，helper bytes 匹配，前后 source/dist/resources/siblings 一致。ASAR SHA256：a64bdff24b050546a9a3d067fe31ff54c3f743a0242d7d6146f856e89e6ef6a3。

GUI 首次在启动前被 4318 EADDRINUSE 拒绝，没有接管现有服务。核实监听 PID 17288 的命令来自首轮 recovery-final app、cwd 正是首轮唯一私有 od-gui root：这是本任务快速脱离的 broker，漏过旧脚本 250ms 子树采样。已先核实该专用目录归属再按 PID/启动身份回收；不按名称/端口杀进程，不碰其他服务。

重新运行现有已审 smoke 脚本，lineage-final-packaged-gui 通过：真实 main/preload/SQLite/UI，page/console errors 为空；默认未授权、周期/通知关闭、日历未连接、模型未配置，三个分析/交办/claim 表均为 0。没有模型/日历调用或真实配置写入。脚本捕获的 PID 集剩余 0 之后，另用原生 lsof 按本次唯一私有 cwd 补查，发现并回收 1 个同类 detached broker，复查剩余 0，删除其重建的专用临时目录。原脚本的零残留只覆盖其采样集，补充证据明确保留这个边界。

包/inspection/manifest/cleanup：.artifacts/openduet-package-validation/recovery-lineage-final/。GUI 和二次 cwd/PID 补查：.artifacts/openduet-recovery-20261101/lineage-final-packaged-gui/；首次端口拒绝也保留。目录补查/清理驱动及 PID/start/cwd 原始 manifest 留在同一 ignored evidence 根。小型[证据摘要](openduet-recovery-evidence.json)提交 Git，完整产物不进 Git。

沿用已审 smoke 的外层 OS policy；测试进程 no-sandbox/single-instance disable 不代表 Chromium sandbox/singleton 验收。本机仅 macOS arm64 unsigned app，不代表 Windows 安装包或 release ready。

## 尚不能宣布完成的真实验收

- P1：10 个真实案例 A/B/C 对照和 20 次完整真实交办未过门槛，直接启动 pilot 默认关闭。准备/恢复、合成回归和 API 耗时不能替代。既往真实 morning 累计 1 次，usage unknown fence 保留，本轮无新增产品模型请求。
- P2：云之家只读 list/get 完整分页、取消、全天、循环场次契约仍未证明，保持 partial，不伪造完整 checkpoint/delta。不改真实日程，不邀请或通知他人。
- P3：无真实人工标签/质量资格，保留 100/30、precision ≥90%、recall ≥95%、严重漏报 0、unknown ≤10% 原门槛，测试标签不能启用周期/通知。
- sibling intent-broker 原 tracked WIP 且落后上游导致 hygiene 失败；保留别人的改动。未合并、签名、发布或安装正式 app，未宣称全仓全绿。
- [独立复审状态](openduet-review-status.md)：身份、workflow 和组合已限域批准；内部祖先修复及 authority 指控裁决的复核被 Kimi 明确 429 额度阻塞，等待用户按台账 #48 授权换模型。超时/额度错误无批准票。远端六格正在排队/部分运行，未宣称通过。
