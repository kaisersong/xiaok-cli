# Desktop main失败修复：B席方案与执行台账

2026-10-22。起点HEAD `d0e35e73014add369748de77fe2a868a62777f13`。原全量225失败/45失败文件是待修事实，已在冻结master复现不是修复完成。仅当前worktree，最多1worker，不提交；原始失败/基线日志不覆盖。证据写`.xiaok/evals/pi-durable/remediation-20261022/B-*`。

## 约束与归属

已读根AGENTS、CONTEXT及desktop/cross-platform/verification/evidence-and-design/packaging专项；台账强调真实入口、每数字有raw、自己PID/PGID回收、资格不可削、不能用baseline失败充当关闭。repo无.codegraph。开工hygiene按原命令实跑exit1，原log/JSON保存；不更新baseline。

排除C负责的13文件（含四renderer），不触renderer。B持有以下第一批共享fixture：`desktop/tests/fixtures/desktop-post-seal-verifier-contract.ts`、`desktop/tests/support/owned-workflow-normal-case.ts`；C持有`owned-workflow-network-fixture.mjs`的真实file URL修正，保留forward/ownership边界。artifact-export-helper由root按锁构建，B不伪造current.json/资格、不改builder、不pack/sign/install。

root确认model-stream-recovery/physical-owner/AgentRuntime当前无人修改，B继续调查C11；如需改它们，须先补具体方案/红例再评审。生产安全/auth/config最终另模型由root组织。

## 第一批确认根因及最小改法

### B1：临时编译模块丢失真实依赖解析根

原`desktop-post-seal-facts`38失败、另input-errors/verifier-policy/IO失败，首因在临时`delivery-verifier.mjs`内真实生产`storage-budget.ts`的`createRequire(import.meta.url)('better-sqlite3')`。`compileVerifierEntry`把bundle放OS tmp，而native依赖位于repo root node_modules。此前显式NODE_PATH使facts38/38绿只证明原因，不作为最终修法。

拟将这个test-only编译临时根放到repo-owned `.artifacts`下自建mkdtemp目录，使模块按照普通Node父链解析root native依赖；保留真实生产源码bundle、真实Worker、全部断言、deadline/IO预算及清理。现有loadActualLegacyCollectors已经用同一repo-owned模式。禁止全局NODE_PATH、mock sqlite、改生产createRequire或忽略import失败。新增/既有回归必须在未设置NODE_PATH条件调用真实compiler，确认artifact位于ownedroot且加载真实verifier成功；随后跑完整facts/input-errors/verifier-policy/IO四文件及process。

### B2：owned workflow私有服务身份误用symlink别名

`owned-workflow-normal-case.ts:15-19`把sibling symlink路径设置为KSWARM_SERVER_PATH；真实私有server health报告物理路径，生产`checkKSwarmHealthServiceIdentity`严格比较resolve路径，得到entry_path_mismatch。原finalization两项/services/workflow限制测试因此没进入真实被测逻辑。此拒绝是正确的owner边界，不修改生产身份校验。

拟仅对fixture自己所启server入口用realpathSync，expected与该私有子进程实际入口一致。保留forwardedFetch仅4400/4318→fixture随机私有端口；不真的连接4400，不adopt共享服务；foreign spawn/kill仍抛错；fixture.close仍只停自己child并等待close。添加实际正常链/已有拒绝链回归，记录服务PID/端口和close；完整services/finalization及workflow相关文件重跑。C已初步认可该根因方向，正式票以实际diff为准。

### B3：256 checkpoint准备人口未计新增请求开始事件

owner-boundary C15准备253个usage，旧预置2事件凑255，等待取消flush第256事件；当前新增真实task_execution_started，预置变256，红在开始断言，尚未触达目标故障注入。初查误将它当作AgentRuntime的model_request_started；B-cancellation-details-red实际Desktop持久事件序列已纠正为task_started、understanding_updated、task_execution_started，不能混用两套runtime事件。

拟把仅用于触达同一256 checkpoint的输入校准为252个usage，明确断言1个task_execution_started、252个usage事件、usage累计252/252、总数255；保留取消flush第256事件、原write/rename故障、原错误对象、once publication/index、后续terminal/usage顺序的全部断言。不得只放松长度、接受255或256、跳过新增事件或改存储checkpoint。先针对C15两case红，再fixture修改后完整owner-boundary回归。

## 后续批次：根因未闭环，先调查并逐批补案

- cancellation C11晚usage：普通model read在abort后被detach，physical owner仍持有raw；要核实际late usage是否走既有owner事实/持久事件。保留17/19累计、原terminal once/receipt快照、原历史、无重发断言。若是生产丢事实，不能靠fixture提前release变绿。
- watchdog/lease、buffered timer、multiagent/ancestor：核等待在哪个真实边界，真实请求资格、drain和timer顺序；不延deadline、改fake clock掩盖协议问题或削断言。真实recipe缺失须真实安装资格/远端原测试，不伪造计数器。
- history-publication与Desktop semantic：先核profile/account bootstrap，不能由ENOENT直接跳到资格结论。现已读history测试直接把homedir/.cache下路径交给createDesktopProductObservationBinding，后者进入trustedEnvironment；默认profile-account隔离home没有.cache且默认vitest未装配已有registered-recipe config。本机原生/Users/kk/.cache下注册root确实不存在，不能新造metadata或改trustedEnvironment容忍。仓库已有严格snapshotOfficialRecipe/installOfficialRecipeSnapshot及单独config，应在真实已注册环境执行原人口，不能拿root17场景替代Desktop独立用例。
- Main冻结source-binding fixtures（MCP、Python lifetime、rejected bridge）：先比真实Main与被冻结候选，验证关键AST/callback receiver/close顺序仍符合原契约，再决定是产品缺陷还是合法源码演进导致旧证明失效。不得动态把当前源码当期待值自证，不盲刷snapshot/hash或删除绑定断言。
- room-field-classification：按实际所有字段逐项分类，保留编译期key equality与运行期完整人口，不简单把新字段删去或放宽断言。
- workflow旧伪service capability：必须改fixture走真实issued capability/私有服务，不能放宽生产default-deny。设计manifest路径必须采用可核文档来源/固定哈希，不能跳过设计门。
- artifact-export-process missing current.json：等待root真实builder产物，完整原人口验证，不能手造helper资格；artifact-export-package已被合入冻结main的fixture修复且39+1skip实跑，保留该证据，不重复改源码。
- loop execution controller和approval wire budget：保留签名owner/调用人口/排队限制；先定位精确反例，再补方案，不归因为机器慢就扩timeout。

## 执行门

第一批B1/B2/B3先向root与C交叉评审→保留targeted红测试→最小fixture更改→完整相关文件绿。任何发现的新生产根因先补本文件具体轨迹、最小方案、兄弟路径与红测试，再写production code。新失败如实加入台账，不能用之前baseline通过替代当前回归。最终做相关Desktop main build/typecheck及治理/增量架构，不更新baseline；全部owned runner和其测试child回收后报清单。

## B4补案：取消之后真实usage的唯一消费owner

### 反例与根因

`B-cancellation-details-red`原C11真实路径：只调用一次OpenAIAdapter；任务取消已持久terminal、host仍inFlight；随后放行同一原provider read，产出17/19 usage；host.drain后usage仍0/unknown且没有usage_recorded。原取消/terminal前缀未变，说明丢的是晚到事实，不是任务应该恢复。

实际Desktop使用`streamDesktopTaskRecovery`而非AgentRuntime。其内层source直接await原provider read，physical scope正确持有直到return；外层recoverModelStream在abort的0ms outward race后detach，内层后来yield的usage没有消费者。现`desktop-services`主tool loop仅在外层for-await捕获usage，所以原始IO虽正确drain，费用事实遗失。

### 最小方案与兄弟路径

不改共享model-stream-recovery/physical-owner或abort deadline。给Desktop task stream增加仅Main内部的可选usage consumer回调（usage+该次实际invocationId），在原provider source得到usage后、yield给outward consumer之前await它。物理source的next/return仍由既有physical owner持有，故异步usage提交也在drain内。非usage在signal取消后仍拒绝，禁止继续取新model turn、恢复文本或运行tool。

主tool loop把现有usage累计、ctx.onUsage（包含真实MA recordUsage及emitUsage）搬入该唯一回调，for-await的usage分支只continue，防止正常未取消路径双记。root对初案指出了真实兄弟缺口：streamDesktopToolLoopFinalization同样通过outward for-await捕获usage，也会在取消后丢失。因此同时将其现有input.onUsage原样透传给request，在source内消费，外层只continue；摘要只重试路径固定当次request invocationId。不得把该入口留在旧不安全路径。

同级readiness probe没有usage consumer或任务账本，不把它误称已具计费持久化；此方案不新增其计费产品契约。legacy desktop-summary-stream原来直接await原provider read，未用recover outward abort race，保持已有实现并测试其消费语义，不无差别迁移。

同权限兄弟入口`project-agent-model.ts`：默认分支透传给task stream；selected-model缓冲分支也必须在原provider read拿到usage时await同回调并保持原yield契约，否则主loop移除重复消费会让选定模型丢usage。回调使用当前prepared request的固定invocationId，不读取后来retry改写的外部变量。

消费/持久化错误必须保留原对象，绝不能成为provider网络重试或selected-model fallback的理由：task stream以单独consumer-failure状态关闭shouldRetry，selected-model分支区分该状态直接抛出；原provider-return失败如同时发生仍保留现有双失败聚合。实际factory的onUsage目前只把emitUsage promise加入pendingUsageWrites，需同时await该原promise，使physical source的原next/return持有真实异步提交；列表留给原runner统一收尾。主loop旧非mailbox catch会warn后吞consumer错误，须保留warn但重新抛原错误，才能使取消后晚提交失败进入sticky physical drain失败；这是显式变更的异常行为，不能伪装完全不变。权限/预算/default-deny不变，也不得把失败记成usage成功。

### 红绿验证

保留已有C11红且不改原17/19、terminal一次、receipt最终快照、late event index、一个model call断言。先补真实task stream原read阻塞→abort outward返回→lateusage落回调的红例，及正常usage一次、消费者原错误对象不重试；补selected-model与默认模型两条相同契约，以及真实finalization/summary取消晚usage红例，测试真实生产入口不重写调度。补取消后异步usage提交失败负例：outward仍是原取消，physical drain必须reject且原consumer failure可达；不得只检查outward的AbortError而漏掉费用写失败。修改production后完整write-failures、owner-boundary、task-stream-recovery、project-agent-model及physical-lifetime文件回归；负例验证late text/tool不恢复、取消仍快速outward、原始drain未提前、消费失败不变成功。全部maxWorkers1，deadline不变。

实际summary回归使用既有Vitest loader把同一次完整production source的私有streamDesktopToolLoopFinalization暴露为__testFinalization，不复制其逻辑。输入外部physical scope与真实original provider generator；等实际outward Abort返回才放行raw usage，确保不是0ms race偶然通过。初次新增host夹具没真正到finalization、只有timeout，已判无效并删除，不将其算summary红；有效B-finalization-controlled-red在原finalization外层消费块下两case均consumer0次红。其后恢复已审callback并跑完整family。

## B5：真实注册recipe的独立远端分区计划

root已授权沿既有kai-mbp连接，且要求不把本机无资格人口删掉后声称全绿。此处仅修执行装配，不降低任何产品资格或断言。

1. 先只读检查远端Node24实际可执行路径、darwin/arm64/native依赖与真实注册recipe。不得重用已删除的上次临时目录或假定旧Node软链还在；不读取/打印凭证。
2. 用远端自己mkdtemp的专用目录装最终当前精确source；本机冻结源码文件SHA清单，复制后逐项比对，测试后再核。包括src、Desktop electron/shared/tests/config、scripts、根test support、package/locks及相关新文件；不会拷贝旧dist或把旧产物冒作当前source。仅复制依赖到该专用目录的真实私有目录，Node24/native ABI用实际version与load探测；不更新共享依赖或profile、不操作sibling WIP。
3. 用现有`vitest.registered-recipe.config.mjs`，global setup只读真实注册环境，通过产品注册manifest哈希验证并复制原metadata至自建隔离account；绝不创建伪recipe、改环境注册表、放宽trustedEnvironment或加skip。counter/qualification全走生产recipe，记录manifest文件/语义SHA；snapshot安装本身qualification:false不能冒充已获资格。
4. 完整执行history-publication-basis、Desktop semantic-product-runtime、desktop-multi-agent-service三个原文件，maxWorkers1、原case timeout/资格均不改，数字对应完整raw；如发现同族还需真实recipe的原文件，一并列清后执行。生产HTTPS只能由测试已有受控HTTPS/SDK夹具接管，无真实provider计费，不发凭证。远端是否满足受控网络断言先读源码，发现会实际发送即停止该项并报原文，不能用换fixture绕过。
5. 本地SSH runner及远端runner都记录自身PID/PGID、cwd、argv、exit/reaped；仅按记录核回收，必要只清自己组。先拷回raw/JSON/source/Node/recipe哈希及结果，再确认全部测试已回收才删除仅自己mkdtemp目录，symlink dirs不跟随；不操作共享4400、不改本机既有recipe。
6. 远端全执行通过也不能改写本机默认全量的资格初始化失败；最终按明确全人口分区报告，825文件清单不能漏或把缺资格case消失。Node22本机由root独立deps协调，本席不重建共享.test-dist。


## B6：剩余 Main 夹具的精确边界迁移

原红 `B-remaining-main-v1.log/json`：12文件中10失败，50 failed /21 passed /191 skipped；services 在收集期编译失败，191 未执行，不能算通过。design gate 与 approval budget 原完整文件已过。Goal/Review 两文件交 A；四 stored-restrictions 交 C；不重叠编辑。

1. **C21 checkpoint**：和已审 C15 同根因，新增 durable `task_execution_started` 占一格。将预置 usage 253 改 252，显式断言 started=1、usage事件=252、合计255、token累计252/252。保留真实50ms timer、256 checkpoint EIO、取消等待、原 error identity、index255 一次 publication、failed terminal 全部原约束。
2. **services 编译**：C 的生产 bounded-glob 现使用 lexical import.meta.dirname；fresh native protection Worker bundler 的旧 AST 保真插件只接受 url 因而拒绝。仅扩展 fixture lexical dot dirname，替换值为当前 emitted input 文件的 dirname；url 仍是该 input 的 fileURL。字符串/注释不动，computed/optional/bare/env 一律仍拒绝。补带空格/#路径的真实 lexical dirname 用例及原全量 Worker/跨文件 compile 检查，production、资产定位和 noCheck=false 不改。
3. **post-seal marker transaction**：现 production 使用已认证 frozen mutation port 的 body，实例 putRootBinding override 不再触达真实写；旧 fixture 停机点失效。改在该 fixture 自己 SQLite db 的 exec(COMMIT) 前，使用同一连接 SELECT 证明当前事务已有 delivery marker 且 isTransaction=true，再输出 marker-transaction 并同步停住。实际 UPDATE 仍执行，COMMIT 尚未执行；父进程原 readOnly 连接必须看不到 marker、真实 SIGKILL 后原恢复断言完整保留。绝不增加生产 hook、绕过 writer fence 或复制 port/body。

以上改动仅测试/夹具；先 root/C 对抗审后执行。watchdog 两case仍需独立定位，当前5s原 timeout保留，不以扩大预算掩盖。

## B7：watchdog/lease 测试隔离独立时钟竞争（待交叉审）

被动诊断 `B-B6-diagnostic-red.log/json` 保留原两项 5s 超时。真实 timer/monotonic 均从0推进60000，真实 host watchdog 已调用 decideHostCancellation(task_watchdog_timeout)，watchdog 配置确为60000；但 binding 已 settled/failed。生产 computeRunnerDeadlineMs(60000)=60000-min(120000,30000)=30000，Desktop 使用 Date.now 的 model deadline 已先触发，root seal 之后拒绝晚 host cancellation 是现有权限边界。因此不能把此红归因 host timer失效或修改生产取消门。

原三个 case 要检验 host watchdog 与28分钟lease谁先赢，旧 fixture 同时推进 Date 使独立 runner deadline 先赢而未到待测分支。拟在三项竞争 case 中显式把 Date.now 固定为 provider入场的 wall值（系统时钟回拨/停滞情形），仅推进 setTimeout 与 monotonic。独立 wall model deadline保持原30000且持续重新检查剩余时间，真实 host monotonic60000到期优先。原 watchdog-terminal/watchdog-signal/lease 三项全部终态、单terminal、salvage、singlemodel、leasephysical持有/释放断言和5s不变；不 mock cancel decision/abort、不替换 production runner。

增加第四个完整一致双时钟 case，保留原诊断实际揭示的 runner先赢：advance Date+monotonic30000，等待真实 binding settled/failed；冷host快照尚未终态且physical仍在占用。再到60000，核真实 watchdog调用且禁止已seal root取消、context signal不新增abort；释放provider原IO并drain后核冷失败reason为deadline、模型1次、terminal1次、ticket最终释放。此为明确新契约场景，不删除原竞态人口，不扩大deadline或放松资格。若实证 reason不同则先查明，不把预期改到实际值。

C 首轮反对正确指出先前45000为错误算值，已按真实 RUNNER_DEADLINE_RESERVE_MS=120000 更正为30000；raw仅证明到60000时已settled，未单独测得最初触发时点。第四case将核实际30000边界与冷失败reason。expire()不嵌套移除外层freeze spy，而保存/恢复前一mock值；禁止时钟控制被mockRestore误撤销。


## B8：Node22.22 非 authorizer 场景的无关清理失败

`B-final-related-node22-22.log/json` 完整11file95：92通过3失败；3个均是multi-agent-activity-failure.ts:47无条件cleanup setAuthorizer(null) TypeError。实际完整阅读后纠正初步猜测：unknown SQLite physical case早已使用标准真实TEMP TRIGGER RAISE(ABORT)，并不调用setAuthorizer；其他两项为取消/销毁真实持有，亦没有安装authorizer。不能把无关cleanup提升为Node24资格，也不能新增skip或shim API。

最小只将该cleanup注册限定本fixture已检测的nativeAuthorizer能力存在；现有sqliteFault函数与其真实native fault资格完全不变，不降级注入，不修改任何case/断言/时限。Node24原cleanup照常，Node22无需撤销从未能安装的回调。原3红保留；A/C审后重跑同完整95，实际source/emitted entry2也覆盖cleanup顺序修后的新版本。production7无变。


## B9：Loop 有界测试预算与真实取消/收尾（新批准方法，保留原红）

规则溯源及独立票见 `B-loop-runner-budget-provenance-review.md/json`，主笔完整修订见 `reviews/failure-remediation-root.md` 末节；A/B/C均已APPROVE该test-only方案。原“不扩任何runner timeout”是本轮主笔自加方法边界，未找到用户/AGENTS永久禁令。历史设计明确原5s→30s为测试装配；SDK原10s与所有业务逻辑期限继续保留。原30s trace是超时后失败收尾，不是完整成功；受控事务ROI候选继续否决，不改安全核心。

仅原Loop一个file的完整8mode：前三simple仍30s；五个完整consumer mode有界60s。原body不复制新实现，真实it.for接TestContext；controller caller/server信号与ctx信号合并，不冒称取消等于回滚。原scenario只创建一次、onFinished等待同一outcome和finally。setup/inner/outer所有资源close按依赖尝试，原body+cleanup错误均可达，真实host/server/fixture结束后才恢复全局Date/profile/marker，hook默认10s不改。原59个expect(...)与5个f.setTime(...)经TypeScript AST逐字比较不变，见 `B-loop-budget-static-audit.json`；此静态证据不替代实际执行。

验证分列：先原八例全部执行，无profiler；60s仍红则保留失败不自动扩时。随后仅自有精确诊断副本，将第一原simple强制短timeout、下一原simple保持30s，预期1fail1pass，并记录真实ctx取消、RPC断连未知、实际owner close/spy恢复/原scenario join在下一case前完成。诊断不称八例验收绿；结束按SHA归档并精确删除副本、核ownPGID。原source改动再交A/C及主笔GLM实码delta审。生产7文件保持冻结。

## B10：真实 user-template payload 与严格内容 decoder 的边界适配（待独立审）

原 B-loop-budget-full-node24 完整8实际7pass/1fail，output-consumer 58102ms报 published_artifact_payload，非60s timeout；raw/exit1/reaped/PGID空保留。实际链：loop-business-publication-host.ts:180 把 readCurrentLoopPublishedCandidate 的完整 wrapper 暴露为 payload，wrapper 有 binding/application 等8字段且 bytes 是返回副本的自有getter；loop-output-service.ts:50 原样交 readPublishedArtifact，其严格入口只接受 PublishedPayload 的6个 own-data 字段，application-value-data.ts:95因多字段拒绝，即使删额外字段仍会因getter拒绝。这是两生产接口适配缺陷，严格decoder及own-data规则本身正确。

拟仅修改 `desktop/electron/loop-business-publication-host.ts` 的私有 readUserTemplateOutput 消费回调：所有原 full project/current/set/task/SQL 验证原样执行后，先 current()；从仅由实际固定 readCurrentLoopPublishedCandidate 返回并在本次 project 内持有的对象，逐一拷贝 owner/businessRevision/operationId/fullTupleHash/payloadHash，以及读取一次 bytes getter所得独立Buffer，创建 Object.freeze 的恰好6字段自有data `Readonly<PublishedPayload>`；再 current() 后返回原 binding + 新 payload + 原 assertCurrent。类型明确改成 PublishedPayload，不能仅cast原wrapper。不给任意renderer/DTO提供sanitize入口，不将复制视作授权/写ticket，不改固定reader的getter/原历史bytes或解码器接受域。

字节/身份：getter由固定reader闭包产生独立Buffer，单次适配只取一次，输出不再含getter/binding/application额外字段。Buffer属于本次消费快照（只冻结外层，不伪称冻结typed-array内容）；消费者修改它不应影响reader捕获的历史bytes或下一次独立读取。owner/operation/revision/tuple/payloadHash逐字段保持，无重算身份、无重新签名。严格decoder仍自行复制校验hash/owner/sections/application等，原 public getter/Proxy/extra/symbol拒绝测试保持。

current/TOCTOU：不得缓存这个快照当continuously-current；适配前后均执行原 current()，保留caller ctx/业务signal和lifetime，getter读取期间取消/route或store vector变化必须拒绝，不暴露成功。业务层每次 list/preview/open 仍 fresh host读取并执行原 assertCurrent/check；open 的导航前、后原独立fresh读取不合并，不减少publisher/application/current checkpoint，不改变外部文件变更拒绝。此快照不提供主机写入能力，历史/账本/退款/重发没有改动。

兄弟：同一host输出被 preview/open 的 readPublishedArtifact 和 list 的 readLoopArtifactPage→readPublishedArtifacts共同消费，统一在这个唯一受信输出边界适配，避免只修preview。纯readLoopArtifactSelection仍接其明确的PublishedPayload，不宽化签名或decode。readAssistantOutput、project/inspect/prepareCompletedRun及write ticket不改。需查全部实际调用者，当前rg仅loop-output-service调用readUserTemplateOutput。

红/绿验证：已有完整实际签名controller output-consumer是有效生产红；新增原loop-business-projection测试中实际host/private store +固定reader叶回归，明确它不是签名网络全链：仿真原固定reader wrapper getter，验证恰6 data fields、单次getter读取/返回Buffer隔离/身份不变；getter内触发真实abort或route变更时拒绝，既有output.assertCurrent在后续变化仍拒绝，非法requestSource仍零read。先新测试红，再最小prod；原完整8、loop-output-consumers、loop-published-artifacts/严格reader相关完整file重验，最低22.22不能用早95代替。A/C实码及GLM新prod delta另审。

原60s预算不在此修法中自动增加。output-consumer当前第一个成功preview前就已58.1s，余下多次独立fresh list/task/open仍未执行；这说明后续可能仍需单独实测预算校准，但不能以此红自动宣布60s不足或改期限。若后续触界，保留该红并由主笔对明确output-only预算新案审批；全部产品10s逻辑期限不变。

823本机full正在独立1worker运行，新适配/新case会产生source drift，记录起/终完整manifest并对影响的完整file后补最终源重验；不把跨源全量直接称最终freeze全绿。root已明确允许精确Loop红/绿另1worker并行，总并发事实入报告，不运行profiler。

根兄弟入口补充：`tests/runtime/verification/captured-sqlite-loops.test.ts:157/166/338` 动态import同一host，A旧完整112已pass但绑定旧host输入。新prod后必须whole112重跑，替换原分区证据，不重复累计112；B负责归入最终相关完整回归。

影响范围更正：A进一步实际runtime静态closure得到根8file，详 `A-root-desktop-dependency-closure.json`，不能因root2148未漂移就宣称输入相同。主笔已接管协调这8完整source fresh回归并替换原A分区对应项，B持Loop targeted/full823；前段“仅whole112/B负责根回归”的分工被此最新精确闭包更正，不将旧112双计或视为全部root输入覆盖。

## B11：D6 真FIFO前提与subject预算修订（独立source审APPROVE）

已完整读取A-D6-fifo-design-review.md、原owner/passive trace/process三文件及真实delivery-verifier exit→evaluate→原fs.open/trackPending链，B独立APPROVE；C亦正式APPROVE。full823原D6真实red保留：原taskWatchdog100从runner计时，runner/spawn/body/seal/flush后verify只余24.8ms；worker仅online未message/facts/自然exit即正确deadline终止，原FIFO根本未调用。不能据此改生产或以online替rawIO。

本项明确只把D6 fixture subject taskWatchdog100→harness既有2000，D7病理CPU实际100保留；这不是runner校准，也不再声称D6逻辑数值100保持。默认case5s与所有生产不变。不是进入FIFO后重启deadline，不伪造clock。若2000仍无法在原绝对deadline前建立rawopen，明确setup red，不自动扩。

被动observer在Reflect.apply原fsPromises.open(exact pending.pdf,'r')返回原Promise之后才记fifo-open-submitted，保持该原Promise/原settlement跟踪；owner推送对应事件及本次actual verify deadline。同一trace须CPUmessage/exit先于submitted，submitted在原deadline前且尚未resolve/reject。父先等submitted，再等真实delivery_timeout持久报告；不靠sealed/online/任意sleep猜。可再等原verifier outward reject（500ms grace真实到达）后检查，以证明物理持有不是只处于outward grace。原heartbeat<200/native Worker1start1exit、inFlight true、业务completed/hostDelivery unknown/cleanupPending true全部保留。真实host提前drain或目标边界未到一律红。

另自有精确副本在全部原predicate之后才启动独立owned writer子进程，只打开/关闭真实FIFO写端、不写伪PDF；配对成功、原open迟到resolve、原FileHandle close调用及settlement、host实际drain/inFlight false必须实证，主case仍原own SIGKILL且不writer。诊断不替代主case/不算原人口，结束按SHA归档删副本，writer/owner runner各own PID清理。原whole17以及B6相关兄弟完整回归按实际impact验证，原旧221绿不覆盖本次full red；full823对process/fixture输入漂移明确最终wholefile替换。

## B12：完整调用人口下的一次有界 runner 预算修订（待A/C/主笔审，不自动应用）

B-loop-adapted-full-node24 原完整8在host79650281实际6pass2fail：simple15.082/14.732/16.143s，full-projection50.803、timed-pending58.964、timed-expired34.119s通过；desktop-service60.239与output-consumer60.237均60s runner timeout，同时保留超时后pending!=already_completed/controller_ipc_aborted_unknown等原断言失败；这些原断言仍未通过，不能仅贴timeout标签抹平，也不能在缺少独立证据时另定性新产品回归。新完整原断言通过前不关闭该红。原第1轮desktop56.773仅3.227s余量，不能作为跨机器预算。此轮实际并发为A full+B full+A根8+B本8共4个Vitest单worker，无profiler，不归因为资源耗尽或新prod变慢。原30/60红永久保留。

新案是一次按完整链人口校准：原3simple仍30s；full-projection/desktop-service/timed-pending/timed-expired四个consumer模式改120s；output-consumer单独300s。都是测试runner上限，不重置任何任务/SDK10s、IPC、业务expiry、f.setTime、predicate或default hook10s。不是性能优化，也不是将output先前58.1/60.2当完整成功耗时，更不承诺任何机器都能过；新固定预算若仍红，保留失败重新定位，不自动继续加时。

来源按实际source逐调用核对：四个普通consumer模式有两candidate；full-projection保留原native root/stage链、business.project、views、dedupe runner各完整fresh read，desktop-service再有独立inspect，timed-pending还有真实completion/current路径，不能按单一project耗时定整个case。实测最大已到60.2s且其后仍有验收，120s提供整链约2倍已观测成本的明确余量，不再按3s余量小幅猜增。

output-consumer有三candidate与两个真实stage，成本不等同其余4模式。原source中完整positive读取共10轮：business.project1；preview/list/task各1；被污染workspace的open1；恢复文件后的open3（初读、导航前fresh、导航后fresh）；openPath里推进信任clock的late-open2（初读、导航前fresh）。late-open后还有一次预期拒绝fresh，最后expired的list/preview/task/open共4次拒绝读取，原全部保留。每个positive full host read内部仍逐3candidate fixed-current及完整set/current检查，没有合并/缓存。原58.1s仅到第一个preview处就因payload shape失败，原60红不能提供其后9轮完整成功耗时。按已观测前置root+2stage约30s及每轮3candidate读取约14–16s，完整positive人口估算170–190s；300s提供约50%以上余量给native/Node/OS与当前并发差异，并保持有限失败边界，避免60→75→90逐步猜。该估算明确是试验预算来源，不冒称已实测全链；真实完整阶段耗时在下一次运行记录后替代估算。

为可核实真实执行人口，拟仅在原test加被动performance.now阶段记录（不换原body、不yield/改返回值、不profiler）：fixture ready/root publication current/stage publication ready/business projection/每次真实output操作完成/finally drained。原59 expect和5 f.setTime逐字AST检查继续保持。原10轮fresh调用仍由原service/host执行，logger只记mode/stage/elapsed，不采集大对象、不修改授权/数据。若不需要持久console，可将同样阶段记录置于精确自有诊断副本后归档，但不得把过滤单case当完整8绿。

验证：先本机Node24原完整8与真实阶段日志；最低支持22.22原完整8再独立实跑，不复用旧95。实际mac/Node资格及跨平台未实跑必须分别标明，预算设计不替代平台证明。原短timeout诊断已证ctx取消/join/恢复隔离，若仅预算/日志改动可复用其输入不变路径证明，并由A/C实际delta审；若改了生命周期则重新短timeout诊断。root最终GLM审完整test delta+新增host prod。D6/AF/root23按主笔统一worker槽调度，不额外开profiler或暗增并发。
