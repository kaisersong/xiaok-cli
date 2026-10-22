# 完整测试失败修复：root 批

基线为 d0e35e73014add369748de77fe2a868a62777f13，保留 integration-20261022 原失败日志；本轮新日志在 ignored `.xiaok/evals/pi-durable/remediation-20261022/`。所有原 case、assertion、资格、逻辑时限保留。原基线也失败仍需修复。

## 已确认根因及拟修复

1. `artifact-export.test.ts` 的 macOS `/usr/bin/tar --format=pax` 把 APFS 新建文件的 `com.apple.provenance` 加为 `._report-中文.txt` AppleDouble 附加成员，并带扩展 xattr PAX key。生产解析器拒绝额外成员是正确行为。fixture 应关闭 macOS metadata/xattrs，保持真实 tar/PAX Unicode 与额外成员拒绝断言。不得放松生产 TAR 解析器。
2. `installed-metadata-target-prepare.test.ts` 本地 fixture 的 allowed UID、enrollment peer 固定501，但 source capture 使用实际 `process.getuid()`；当前主机 UID 不同导致真实 closure 的 profile binding 拒绝。统一测试 principal/peer/allowed UID 为当前测试OS身份，继续覆盖跨profile、pending profile、未知account与最终CHECK；不改变生产身份闸门。
3. own-data 对抗性 source worker 经 tsx 的 keepNames 转换注入 `__name`，其 `Object.defineProperty(fn,'name',{value,...})` descriptor 在 poison Object.prototype.get/set 后触发getter。已直接捕获堆栈：`poison → defineProperty → __name(application-value-data.ts:1:64) → readApplicationOwnDataField:49`。生产 TypeScript emitted JS 无该调用。测试应在隔离目录用现有 TypeScript 编译语义执行实际 production/support 模块，保持原1199人口、独立进程、poisonCalls=0和恢复等价；禁止修改生产逻辑迎合转换器，也不能读旧dist蒙混。具体编译方式须评审后确定，编译输出不得污染共享.test-dist或提交。
4. 原生 helper 缺少锁定的 Go1.27.1 archive 与构建current.json：按现有lock从官方地址获取，校验完整size+SHA，再调用真实builder。官方metadata已核对与lock一致。只准备本worktree产物，不修改资格、不使用其它Go版本或伪造manifest。Desktop B复用同产物。

## 待完成根因调查

metadata-capacity growth三项、Loop receiver/publication、candidate-controller、publication near-limit、installed-blackbox、intent controller/dependencies、chat-finalization。逐项trace真实入口中的CPU/IO/IPC边界，已有红测试是最低回归；无证据不得归因为负载或增加deadline。性能改动先保存真实基线并证明收益超过5%，同时保留全部安全校验、事务和完整数据人口。每个新增生产修复先追加根因与方案并独立对抗评审，涉及权限/配置/安全最终再用实际GLM-5.3复审。

## 验证与交付

分组红→绿，后续完整CLI/Desktop source suites、emitted tests、构建/typecheck/governance/changed architecture，禁止更新存量baseline。记录命令/PID/PGID/exit/回收，仅清理本轮owned进程，不操作shared KSwarm4400或sibling工作区。完整HEAD复核后精确暂存，更新PR74，不自行合并。

## 首批结果与否决的性能实验

- root-data-red：原三文件25 failed /1195 passed，保留完整原始红证；对应16个tsx命名辅助副作用、8个UID错配、1个macOS AppleDouble。
- root-fixture-green早期name selector误用了operation而非case ID，只有3项实际执行，不把过滤的1199项记通过。
- root-data-green：四完整文件1253 passed /7原平台skip（1260），其中own-data原1199项全执行，无人口削减；metadata-target14/14；TAR7/7；helper实际33pass/7原平台skip，包含独立APFS卷。所有runner exit0/reaped。
- 原metadata-capacity三个growth变体在原12s限制、单worker的CPU profile复验均通过（10165/4470/10608ms），尚未撤销原full失败。
- CPU profile发现registration-intrinsics检查成本；实验把逐descriptor读取替换为批量读取，隔离真实源码variant的7轮5000次基准显示中位96.65ms→293.22ms，反而慢约3倍，明确否决，未改变production guard。原全部intrinsics/current/身份闸门保留。

source/emitted相关回归与长时容量/Intent/完整CLI+Desktop仍须继续，不以以上聚焦结果当最终full pass。

## Desktop 开发运行时最低版本契约

C原Node22.14完整18文件实跑暴露真实兼容边界：node:sqlite的DatabaseSync.isTransaction缺失（BEGIN前/中/后均undefined），导致KB嵌套/回滚和Loop回滚断言失败；本机types标注该API自22.16加入。另真实KSwarm runtime guard要求22.22。不得改这些断言或让权限/事务逻辑容忍缺失API。

实际本机Electron通过ELECTRON_RUN_AS_NODE读取：Electron39.8.10嵌入Node22.22.1、SQLite3.51.2，符合实际产品所需能力；root CLI package已声明>=22.14，Desktop package未声明engines、README开发工具仍写22.12，确为开发环境契约错误。拟只把Desktop开发/测试engines与README准确声明为>=22.22.0；root CLI原最低支持点保留。CI recovery矩阵追加22.22.0，原22.14纯CLI/compaction单元人口继续，Desktop实际SQLite回归在22.22.0及24执行，新增完整KB/loop-assistant套件不在旧22.14缺API环境冒称产品支持。

保留C22.14原完整失败及能力探针，不以换Node重写成通过；同18原人口在实际22.22.0及24完整重验，加已安装Electron运行时实证。此项是准确声明并持续验证既有真实Desktop运行能力，不新增API shim或改变事务/权限实现，不改变KSwarm sibling。配置变更另经独立方案审与最终GLM安全审。

CI 装配独立审发现两项阻断，均保留原拒绝/测试人口后修正：model-recovery 必须为真实 Desktop generator 提供其实际读取的 KSwarm 源码，故 checkout 经 GitHub API 核实存在的固定 `16c3ed14c5493a82d000d69d34e4b1c933187433` 至 CI 自有目录，由 `KSWARM_SOURCE_ROOT` 交真实 generator；不跳 generator、不修改 sibling。新增 Desktop emitted worker 断言不能强加给仅构建 CLI 的既有 glob-search 门，因此 CLI 原3项保留原入口，Desktop2项拆独立测试入口，双构建 recovery 门明确执行全5项。此为执行装配修正，不减少测试条件；拆分后按新文件布局重新实跑。

C 独立审后补最小 renderer/Room CI：在原 Desktop path job 的 Windows/macOS 两平台，明确 Node22.22.0，新增原真实 intl-formatter-reuse、collaboration-rooms-page、conversation-activity、room-field-classification 四完整文件；两事件路径加入实际 sensitivity producer。原九个 path 文件和 renderer build 保留，manual packaged smoke 不改。这些测试不要求 sibling runtime；其最小 Node 命令另保留原始实跑记录。

## Loop 原预算失败：只做隔离事务实验，未批准生产修订

C 对真实 full-projection 的单项原30s诊断已证明：完整原 fixture 约2.5s，根当前publication读取14.23s，第二stage链22.00s，实际 business.project 到30.28s，views到38.69s，随后原10s finished-hook亦超时。后段框架恢复spy后的断言不是新的产品回归证据；原五红未关闭。真实Loop CPU profile中全intrinsic人口检查约31%自采样，native fingerprint current整个子树约1.6%，故descriptor小改不具≥5%端到端证据，不做。

现有 `registration-census-database.schema()` 已有只在当前真实 SQLite 事务中触发的 `transactionMetadata` 批处理；它保持全量schema/function/counter/current证据，只减少同一锁定普通表元数据批次中重复的SDK构造检查和columns读取。它明确不自行开事务。拟先做自有诊断实验：在原真实 `createRegistrationCensusDatabase` 的测试spy边界，仅把同一个原 `collectFixedRegistrationData` 调用置于真实 `db.transaction(...).deferred()`，已有事务时直接调用原函数；不改原函数、结果、SQL人口、guard、断言、原8模式或30s，默认task setup不删。测试spy只用于受控测试测ROI，绝不当安全生产实现（public db.transaction未建立生产捕获边界）。先运行一项原full-projection并记录真实transaction是否生效/返回后为false、实际结果/原完整断言、wall/CPU及profile；达到≥5%并有希望进原30s，才考虑全8同实验。实验副本只在自有临时路径，结束回收自有group、归档再删精确副本，不并发B全量、不动root2长测/原source。

该实验不构成开启生产事务的许可。若ROI成立，必须另写生产方案并独立对抗：私有captured native begin/end方法与完整fingerprint；新scope仅当原本无事务才拥有rollback/commit；DELETE journal读锁/并发writer、WAL变更、SQL callback提前commit/rollback/reentry、异常清理和busy失败、原caller已有事务、原schema/数据/total_changes ABA检测、freshness每个checkpoint和所有安全兄弟反例；不缓存authority/current/poison结果，不扩大期限或更改原注册人口。若这些语义无法保持，否决事务修法并保留原失败，不靠“实验通过”直接上线。

## Loop 测试运行预算的溯源与修订（新方案，取代本轮先前绝对不调 runner 的方法约束）

此前为防止以放宽条件掩盖问题，本席给子任务统一加了“不增加任何测试 timeout”的工作约束。重新逐字核对用户指令、根 AGENTS、verification/evidence-and-design 指导和工程台账后，没有发现用户要求永久冻结该测试 runner 预算；本文件原要求是“逻辑时限保留”与“无证据不得…增加deadline”。历史 `docs/design/2026-09-25-sol-pi-loop-current-views.md:55` 明确记载：真实controller扩大读取后，从默认5s设为有界测试30s。它是测试运行预算，不是产品30s SLO。台账36要求先区分慢/挂/失败、不靠提高timeout猜，并有按真实平台等待预算校准的先例。

已有两次同原代码的被动阶段证据：business.project分别30.279s/30.653s、views分别38.69s/39.135s才完成，证明当前完整验收链尚未执行完就触及旧30s runner 上限；后续hook亦到10s，框架恢复spy后原async继续的结果已受污染，**41.2/41.5s不是完整成功链耗时**。事务快路径候选真实收益近零且WAL有已证freshness风险，已否决；native fingerprint占比不足也不做。不能为了保持本席自加的方法限制而无收益改动安全核心。

新最小方案仅测试：保留原8个模式、所有fixture/SQL/材料/注册人口、所有断言、所有产品与模拟逻辑时限/expiry、原schema与授权拒绝。前三个单链模式仍30s；full-projection、desktop-service、timed-pending、timed-expired、output-consumer五个完整consumer模式先用明确有界60s测试运行预算。60s是基于已观测38–39s仍有后半验收的上界试验，尚不保证所有五种模式足够；若仍超时，保留失败并重新定位，不能自动继续加时或称通过。此项是测试装配校准，**不是生产性能优化或产品期限放宽**，原30s失败日志永久保留。

同时使用真实 `it.for` TestContext：原scenario promise只创建一次；入口注册onTestFinished等待该原promise/原finally完全settle；原controller IPC roundTrip合并调用者signal与test context.signal，使测试超时能取消自己原RPC，并由原host/server/f清理完成后再允许下一case复用全局leaf/spy。不给hook提高预算，不mock owner可用，不吞独立清理错误。参考同仓 root verification-host-controller 已有的真实context/outcome/join模式，保留原首因。先由A/B/C对新方案独立审批，再最小改test，完整8实跑；另用自有强制短超时诊断验证真实timeout后join/回收与下一原case隔离，诊断失败不能算业务验收绿。最后GLM审具体diff与budget来源；生产7文件保持冻结。

CI执行机制：在既有Desktop workflow新增独立Loop原8完整文件job，Ubuntu/macOS × Node22.22.0/24，maxWorkers1、有界15分钟、真实源码fixture；根/desktop `npm ci --ignore-scripts`，不伪造OS资格、不跳case。Windows未加入此新job，来源是 `controller-public-daemon.ts:29` 委托的 `controller-ipc.ts:24` 明确关闭Windows public-peer认证，不把受控叶测试当Windows已资格；既有Windows path/formatter/Room job与manual packaged smoke保持。两on新增实际verification/loop及三个原controller support输入路径，确保未来同契约修改会真跑原8，而非只记录手工命令。具体CI实码由独立agent与最终GLM复核；最终需实际GitHub运行结果，不按YAML推断跨平台绿。

## Intent dependency 九分支运行预算与setup取消隔离（C新案，等待A正式审）

原无profiler完整23的root-intent-dependencies-final.log/json已exit1/reaped，18通过、4原30秒超时、1原opt-in skip；主笔确认PGID50742空后才允许修改。本次实证分别为registration31.994s、missing-sibling-edge31.167s、extra-edge33.012s、parent-noncanonical31.798s；同fixture兄弟noncanonical/subject/mandatory为33.042/32.729/33.295s，valid/missing-parent33.819/32.222s在原40秒内通过。因此仅两组共9case统一该组已有的runner40000ms，原5个40不动、4个30→40；其余14的budget/原23人口/99stage opt-in/逻辑钟/expiry/SQL/原全部predicate不动。此为测试装配校准，不是产品SLO/生产优化；不冒称旧30已绿。

A初案BLOCK接受：fixture自身准备约30秒，只在返回后检查ctx无法防止setup超时后20余秒继续运行，并会超过默认10秒hook。因此改为fixture(afterQuery?, options={}, large=false, testSignal?:AbortSignal)；仅新9case传真实ctx.signal，其余14不传，保留默认独立signal叶及原normal/large/profile逻辑。不得只给末observe/work加signal。

具体fixture生命周期：

1. 整个setup纳入try/catch。await verifiedOperationFixture原bootstrap（约2.5秒）成功返回后，先登记其真实close，再throwIfAborted；receiver同样成功返回后先登记close再检查。不能先check丢掉已返回句柄；不改sharedfixture或资格。内部尚未返回的producer异常不谎称拿到了句柄；原helper自身清理契约保留。
2. completion.prepare-owner/authorize-owner实际public.invoke接受第四signal，在每次原调用传入testSignal（有值时），并在原await前后阶段check；同步prepare/registration/SQL边界也前后check。保留每个原owner、native enrollment、invocation和两stage，不跳任何实际调用。其余无testSignal调用仍走原API与原新建signal行为。
3. application.prepare同步前后check；authorize、material.prepare/authorize/stage、operations.prepare/dispatch、publication.approve均使用真实testSignal或原signal()，原await前后检查，publication.prepare同步前后检查。receiver原实际transport由原publication的signal传播，不伪造取消receipt。原large模式的yield/profile逻辑与opt-in保留，不自动使它参与本次9case。
4. 任一setup错误/取消，按依赖序尝试每个已取得的application/receiver/f close，不能一个close失败跳过后续；应用scope自身原body错误与close错误均保留、外层保留最初setup错误与所有独立cleanup错误。正常fixture.close同样全尝试且可重复调用的同一cleanup promise，先receiver再f；不关闭他人owner或shared4400，不把取消当rollback/未执行。默认hook预算不提高。

两组9case改it.for取得实际TestContext，创建一次原scenario promise并同步登记onTestFinished等待同一个settled outcome及原finally完成。原body只搬入具名函数或原closure，不复刻生产逻辑；每个observe/work原completion await均传testSignal、阶段检查。SQL变更/拒绝断言、owner graph与原expect保留。case返回fixture后的finally也全尝试关闭并保留body+cleanup失败，不吞context以外原异常；超时仍失败，下一case只能在实际joined后开始。

验证：先A正式审本新案→最小改唯一tests/runtime/verification/intent-publication-dependencies.test.ts；用真实TS AST比对原/新expect与SQL/expiry/opt-in人口，普通完整23由主笔在slot释放后起，本席不先重跑9filter浪费分母。另自有精确短timeout副本：第一原9之一在setup中强制短预算（如4000ms，须trace证实f返回而stage preparation尚未结束），下一原case仍40000；预期前项超时失败、实际receiver/f全部close+root删除+同raw joined在后项前完成，后项执行原完整谓词。诊断只有原两个case不作完整23绿；默认hook10s不增，若仍超时保留红并停止扩大，不自动加预算。

并发：当前A/B长批仍占slot，允许设计/编码/静态审，短diag与主笔完整23都等明确slot，不另起第五Vitest worker。结束保存source SHA/原始log/argv/owned PID PGID/exit/reaped，查询自有组空后归档并只删精确副本，刷新根test文件集合。原所有失败日志、A初案BLOCK和方法修订沿革保留，最终GLM审本test-only delta；生产一律不改。

## Activity 10,000 progress storm 的默认 runner 预算（新增待审案）

完整 Desktop 823 的原 `conversation-activity-store.test.ts` 中，`bounds a 10000-progress storm while retaining the critical terminal and replay cursor` 实际 6665ms 超过隐式默认5000ms。该文件此前没有为这一压力场景声明专门预算；原 case 同步执行真实 SQLite 10,000 次 ingest、最后的 completed、重开与 replay。标题及全部谓词验收的是保留上界、critical terminal 与 cursor，不含5秒产品SLO；生产时钟固定1000，没有依 elapsed wall 改写业务期限。本轮不把无栈的超时当作已经成功执行全部断言，也不从并发运行估计性能收益。

拟只对这一原case明确15000ms有界runner预算，保留原10,000+1事件、全部五个expect、真实数据库/重开/duplicate/sequence=10001/completed及其它case原预算；不新增yield、不批量化SQL、不放宽retention/权限/收敛条件、不改production。15秒是对已观察6.665秒未获完整通过结果的有界试验和平台余量，不是承诺；若仍红，保留并定位，不能自动加时。该case没有异步body，原同步close/rm teardown保持，不用新context掩盖后台任务。

先独立A/C审→单一case timeout参数最小diff→完整原文件fresh实跑；本机24及22.22最小验证。为将执行机制挂到实际CI，在现有Windows/mac Node22.22的 formatter/Room step中追加这个完整activity-store文件，原四file和原九path文件/renderer build/manual smoke保留。两事件 source filter将现有精确sensitivity.ts扩为实际整个 `src/runtime/conversation-activity/**`，确保实际store producer变化必跑这组。该配置也纳入最终GLM审与GitHub实际结果；未跑CI不称跨平台绿。原full的5秒失败不覆盖或删除，该完整file最终fresh结果替换原分区，不重复累计。
