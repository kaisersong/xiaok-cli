# C席失败修复方案与台账

2026-10-22，仅当前任务worktree，不提交。范围为 baseline-review-C 的13文件（9 main、4 renderer），以及实际根因所需的 bounded-glob、两处 Intl。先设计交叉评审、保留红测、最小实现，再完整相关文件回归。每次最多1 worker；不延timeout、不改baseline、不削断言、不操作共享4400或sibling。已读根AGENTS/CONTEXT和desktop、cross-platform、agent-tools、verification、packaging、evidence-and-design专项与台账；无.codegraph。涉及React生产使用并已宣布react-best-practices技能。

开工原命令hygiene exit1/reaped，原始 `.xiaok/evals/pi-durable/remediation-20261022/C-hygiene.log/json` 保留，不修sibling存量。所有后续证据同目录 C-*，runner记录自己PID/PGID/exit/reaped。root正在构建.test-dist，C未读写其产物，待通知再验证emitted。

## C1 Node模块相对URL被Vite改写为浏览器资源URL

`bounded-glob.ts`实际Worker与`owned-workflow-network-fixture.mjs`实际fileURLToPath均使用静态 `new URL('literal', import.meta.url)`。Desktop jsdom/Vite把它误当浏览器asset，转换为 `/@fs/...` 或 `/tests/...`，触发非file scheme；现有 inherited-native-readonly 一项与close/provenance两套件已红。已只读核本机Vite `assetImportMetaUrlPlugin` 的明确 `@vite-ignore` 分支，真实transform输出证实fixture根竟被解析为package dist/index.js，而不是其目录。

最终改法：仓库engines当时声明Node>=22.14.0且该版本支持dirname，使用原生 `import.meta.dirname`。glob仅改为 `pathToFileURL(join(import.meta.dirname,'glob-worker.mjs'))`，保持模块邻接；fixture以及两suite用resolve(import.meta.dirname,'../../..')定位根、相邻preload路径，两个suite的expected私有server入口realpathSync使其与自己child实际health身份一致。无cwd/本机硬编码、无任意路径fallback、不增加通用resolver、不接受http Worker。worker资产复制策略不改，heap、扫描/结果预算、timeout、取消后exit才释放槽、maxWorkers所有逻辑保留。fixture保留随机私有port、仅4400/4318到自有服务转发、foreign spawn/kill拒绝与close。

调查轨迹：第一轮仅加官方插件支持的`@vite-ignore`阻止asset转换，但真实Glob仍scheme错误，已证伪并保留 C-owned14-green-v1 失败日志；最终没有保留此无效改法。dirname修复后实际source Glob已绿。两个纯Node HTTP/owner main suites缺少同fixture其他suite已有的`// @vitest-environment node`，jsdom下一层拒绝加载确实存在的sibling broker模块；补显式Node环境后真实完整2+1人口绿，而非仅collection。root与B分别APPROVE了这两个修订。

验证：完整 inherited-native-readonly、close/provenance；root bounded-glob全15项Node22/24，实际Node worker返回文件、活动槽归零。tests/package/glob-worker.test.mjs增加CLI/Desktop实际emitted邻接资产字节相同、异cwd搜索实际非空expected.txt、已回收slot，另分别复制真实编译模块至隔离.app布局并移除邻接asset，要求稳定拒绝而非fallback到source。后者只证明资产缺失fail-closed，不冒称已打包/安装.app运行。


## C2 新权限契约下修复KB真实调用夹具

kb-integration13项与loop-assistant4项首先败在 createCollection 缺 requestSource。生产 kb-store-sqlite 已在写入前强制 `requireKbRequestSource(undefined)` default-deny；同测试addSource已有显式user。仅在代表用户创建/写入的fixture createCollection和insertChunks调用补显式'user'，不改任何生产权限。保留真实SQLite→addSource/extract→实际kb_search/read路径，禁止复刻检索逻辑。额外核缺来源/不允许来源不写入，保留agent允许、scheduler拒绝的既有门。完整两文件回归。

## C3 契约演进的独立完整人口

- bundled-mcp：原注释定义“至少不低于最后固定Desktop版本”，却exact-pin report2.4.0/slide3.4.0；当前实际bundle report2.5.1。保留旧minimum floor，改为稳定数值语义版本不降级且同major契约（0.x保持同minor），拒绝非法/预发布/未评审major（不把expect更新为当前版本），并保留协议、timeout、隔离能力检查；用既有真实部署比较契约证明新版本可升级、旧版本不可覆盖，禁止修改sibling manifests。
- memory-ipc：旧round3是ipc.ts artifact18；新conversation-activity-ipc.ts也合法注册round3共12。将旧18检查限定原sourceFile，同时显式枚举新增12通道，验证round3严格等于两域并集、唯一metadata；原round1=8、round2=2、memory round4精确16及各项risk/output/assertion全留。不能简单18改30。
- capability-migration：冻结main295/closure307/union310原文和JSON不动。独立列出已合入conversation activity/MCP的11个preload扩展，关联实际channel/type契约；实际preload keys与FULL_PRELOAD_KEYS必须精确等于冻结310+显式11，无重复/任意额外键。旧310 snapshot继续约束旧union，禁止改为321或重写冻结JSON。

## C4 真实GET返回的artifact是绝对宿主路径

dynamic-workflow脚本生产链已在KSwarm `server/index.js` 的 enrichProjectTaskArtifacts→artifact-record.js enrichArtifactRecordFromFile，把经过containment且真实存在的文件映射为绝对path、project URL、mime/size。测试却对GET result期待原提交relativepath。仅修该旧表示契约：基于测试自己创建时realpathSync规范化的workspace构建精确绝对html/pdf路径（红诊断明确Mac /var与/private/var别名差异），仍精确两件且顺序不变；增加实际stat/content/同project URL核对，保留candidate不是delivered/closed、deliverable null、任务done及broker replay。禁止只sort/substr/忽略额外产物。先保留actual/expected诊断红，再迁移，原服务ownPID回收。

## C5 renderer旧fixture补齐当前真实契约

- chat done：actual recoverTask('done','thread-A')是当前单task legacyPrompt修复契约，title取真实threadData.title。fixture title即thread-A；改为精确两参数，保留completed snapshot、最终response和拒绝陈旧progress/result/terminal全部检查，不改production。
- voice：meetingListModels旧fixture缺cacheDir/path/packageId/packageType/packageState/manifestTrusted/runtimeAutoDownloadAllowed，当前MEETING_MODELS_OUTPUT_SCHEMA拒绝后UIunknown，不能显示旧标题。补齐符合实际manifest状态的DTO并用真实schema检查fixture；保留base downloaded/medium incomplete/punctuation missing对应标题、下载/卸载行为。再加malformed DTO unknown不伪造成功边界；不放宽schema或伪造runtime auto download资格。
- drafts：真实ChatModelPicker新增api.getModelConfig，旧api mock缺该函数产生第二个合法alert。给fixture提供真实MODEL_CONFIG_RESULT_SCHEMA可解析的正常snapshot，使本case专注goal拒绝；仍要求唯一alert是multi_agent_permission_revoked、草稿未丢、createGoal只一次、不自动重试。单独保留model GET失败显示错误的现有覆盖，不改getByRole为getAllByRole掩盖错误。

## C6 两处Intl同调用点重复构造

ConversationActivityPanel每report的ago新建RelativeTimeFormat，CollaborationRoomsPage每render新建DateTimeFormat。用useMemo按locale构造并在所有条件return前调用hook；format参数/locale选取不变，无模块级无界cache。原失败是既有react-doctor-low-risk-optimization.test.ts要求js-hoist-intl诊断为空，C-owned13-red.log实际列出这两个调用点。此次满足原构造资源复用契约；另以实际组件固定rerender工作负载计数验证同调用点构造消除，只报告该构造指标，不作为工程ROI规则的豁免，也不证明真实生产wall/heap整体改善，红测试constructor spy保留原format实现并实际呈现文本，候选应同locale一次、locale切换新建且文案更新、unmount无残留。跑两组件实际交互/成本相关文件以及react-doctor原命令，其他lint门保持。

## 验收与停止

全部13文件每个都必须实际执行，不以CI/build替代，不仅name-filter绿。新增root worker边界和两renderer真实构造测试单独记录；Node24优先修到全绿，再Node22全相关源测试，root协调emitted/build/typecheck/治理。新失败保留，未执行/缺资格/未完成不得算通过。若代表性或版本契约证据不成立，先停止该项、补设计评审，不能改expect迎合当前值。最终仅关闭这些已报告失败，不冒称全产品容量/缓存/P3或release-ready；root统一GLM5.3独立模型最终审。

### C6真实兄弟回归补案：系统时区变化

C-ui-node22扩大到既有组件完整回归，73通过/1失败：原collaboration-rooms-page.test的系统TZ变化后下一render应刷新，locale-only memo将UTC12:00错误保留，实际Shanghai应20:00。这是本次生产改动回归，不能说基线/负载，也不能删原断言。原始红保留。

拟最小补充DateTimeFormat依赖：以全部当前room的真实timestamp和各自 `new Date(timestamp).getTimezoneOffset()` 的有序映射生成fingerprint。不能仅取当前时间offset（历史/DST会错），不能只取offset集合（不同时间offset互换会错），必须包含timestamp（新数据变更时不能误复用旧zone）。formatter仍不显式固定UTC/时区，fingerprint改变时重建当前系统zone；不变化则相同numeric年月日时分输出必相同，无须每render再构造一个Intl探测器。按locale+fingerprint useMemo，原TZ测试和同locale构造人口均须通过，另补跨DST两room/date变化边界。此方案会按输入日期变化重建一次，不宣称仅locale是唯一失效条件，也不宣称全局耗时收益。

## 当前证据（持续追加，不覆盖红）

- C-owned13-red：原13文件26失败/135通过，两suite加载失败，exit1/reaped。
- C-intl-red：首个activity fixture遗漏projection，属于新增测试夹具错误，保留日志；纠正fixture后的C-intl-red-valid才是有效反例，两个真实组件same-locale构造11/12次，均因次数断言红。
- C-owned14-green-v1：5文件失败/9通过，11失败/160通过，首轮无效URL修法与insertChunks漏来源等保留；C-owned14-green-v2：3文件失败/11通过，1失败/172通过，纯Node环境及Mac路径别名尚未闭环。文件编辑与首轮运行曾交叠，故v1只诊断，不作为最终冻结通过证据。
- C-dynamic-contract-diagnostic：actual path为/private/var/...，fixture workspace为/var/...；只规范化自建root，不改变产品path containment或sort产物。
- C-owned14-green-v3：14文件176/176，exit0/reaped；后加精确artifact18人口断言尚需后续最终重跑，不能拿v3替代该新增断言。
- C-glob-source-node24/22：各15/15，exit0/reaped；heap/OOM、扫描/结果上限、取消/slot与原生产入口全部保留。
- Intl真实same-locale构造11→1、12→1，减少90.9%/91.7%；locale切换各新增一次且实际文案等价、unsubscribe一次。仅该构造分配计数，不外推整体耗时/heap或生产代表性收益。

- C-ui-node22原扩大回归73通过/1失败：本批locale-only memo引入系统TZ回归；C-timezone-red完整19项16通过/3失败，原TZ和新增历史/data换日期均精确旧时间；修复fingerprint后的C-ui-node22-final九文件76/76，exit0/reaped。此Node22点为22.14，UI通过不代表事务/外部服务支持。
- C-source-node24-final第一轮18文件205通过/1失败：C新增显式artifact18枚举误用了desktop:operation前缀，真实固定契约是desktop:artifactWorkspace:operation。只纠正新增断言前缀，不改生产/旧断言；C-source-node24-final-v2十八文件206/206 exit0/reaped。
- C-node22-sqlite-probe：22.14原root/desktop依赖真实SELECT1各通过，但这不能证明node:sqlite事务能力。C-source-node22-final同18人口195通过/11失败（7 loop事务语义，3实际KSwarm子进程被其22.22 floor拒绝，1动态E2E私有server未就绪）。不称Node22.14全绿，不改资格刷绿。
- C-node22-transaction-api与C-node24-transaction-api：实际BEGIN前/中/后，22.14 isTransaction缺失，24.16分别false/true/false。本地@types/node/sqlite.d.ts明确此属性since22.16。C已上报主笔处理运行时支持契约；C不擅改engine/事务owner/sibling guard。新增22.22矩阵点只能确认兼容边界，不能抹除22.14红。
- C1因果边界：实际transform确认asset路径误写，@vite-ignore单独修法已证伪；未直接测得import.meta.url本身为http，不把早先这句推断当已证事实。最终dirname修法规避转换路径并由真实worker证明。

## C7新增交接：四个stored-restrictions main套件

root从B明确移交 `workflow-stored-restrictions-{denials,effects,held,partial-denial}.test.ts`，原9+4+4+2=19人口。B-remaining-main-v1真实日志逐项显示expected entry是worktree sibling symlink，私有子进程health报告物理canonical entry；source hash相同但entry不同，生产正确拒绝。B的normal-case realpath只修其helper，这四套件各自又覆盖KSWARM_SERVER_PATH，所以未受修复。共享network fixture已经只forward4400/4318到自己随机私有端口；日志提4400不能当连接/采纳共享进程的证据，必须核forward target。

最小方案仅在这四文件：expected入口对fixture实际自启sibling server执行realpathSync；保留纯Node环境、原全部19语义断言、8s内部deadline、真实issuer/HTTP/model/tool入口及close。无需修改已冻结C18源码或共享network fixture，B持有normal-case不触碰。增加明确私有base/forward target断言与原HTTP路径证据，不能把泛owner失败冒称权限拒绝。

新增一个独立权限负例（可置denials同文件）：真实私有server健康响应仍只容许其真实entry+source hash；使用存在于自己temp root的不同server入口时，实际服务factory/request/read-port拒绝，provider保持0、原文件不变，foreign spawn/kill回调不执行；fixture.forwardedFetch拒绝不属于4400/4318映射的origin，全部已转发请求的ownedTarget只能是fixture.base/brokerBase。该负例不允许实际连接/杀共享4400，不把不同entry realpath成同一owner。

执行：先完整四文件原红C-stored-red→方案root/B交叉审→新负例与最小fixture修→四文件原19+新增1全人口在Node24与22.22通过；每次仅1worker，全部owned PID/PGID回收。原C18冻结成果保留并单列本次四文件增量；若后续证据要求改共享fixture，须明确刷新C18对应矩阵，不能偷用旧绿。

## C8 CI真实装配发现的package测试分区修订

实际审root新增CI时发现：原glob-search workflow只构建CLI，却执行C扩大的glob-worker.test.mjs；将Desktop两个case放同文件会强制读取不存在的Desktop产物。另model-recovery新增真实Desktop build没有KSwarm generator源码输入会直接失败。C已BLOCK并由root接受，后者由root补固定commit真实checkout及KSWARM_SOURCE_ROOT，不跳生成器。

root明确授权C仅拆测试：原glob-worker.test.mjs保留原CLI生产tool字节/执行case及新增CLI邻接/缺资源两case，共3；Desktop邻接/缺资源两case移至desktop-glob-worker.test.mjs，公共body放tests/package/support/glob-worker-contract.mjs。无skip/env资格开关，原断言/15000外层child预算和真实Worker不变。旧glob-search原命令仍完整CLI3，model-recovery在实际fresh CLI+Desktop build后同时明确跑两文件5人口；root负责两workflow的paths和装配。拆分后Node24/22.22/Electron重新运行完整5，不能把先前单文件5的绿直接引用为新布局绿；新manifest记录此授权的C18测试布局漂移，17其他源/测试保持不变。

C6表述更正：先前“按用户特别授权”是C把父任务中的“Intl可证明阻止同调用点重复构造”误读为用户允许性能规则特殊豁免，已删除该无依据归因。实际原失败来源是既有React Doctor js-hoist-intl空诊断契约；原红C-owned13-red和两点诊断、新动态构造红C-intl-red-valid均保留。只修复该既定资源复用回归并报告构造计数，不宣称用户特别授权、不用synthetic fixtures外推生产整体收益。


## C9：真实usage消费失败后的严格测试契约与完整清理（待A/B/root独立审；生产不改）

有效原红为B full823的AF2b和A12 mailbox。C两精确副本诊断C-usage-contract-diagnostic.log/json实际2fail/27名称过滤skip，exit1/reaped/PGID53776实核0，原测试未修改。AF body-end实际到达，随后原afterEach index3的dispose拒绝AggregateError(agent_model_physical_drain_unconfirmed)，其errors[0]与实际recordUsage的原SQLite错误是同一对象（诊断id1）；旧cleanup在此停止，root与spy/env restore未执行。只有在group0之后C才清本诊断root，两个副本已归档精确删除，Desktop828恢复。mailbox真实loop聚合为desktop_local_business_and_model_cleanup_failed，errors/cause保留原usage Error对象id1与physical失败，onSeal原调用恰一次failed；旧toThrow只看顶层message失配。生产本轮B4明确要求consumer error进入sticky physical失败，这两红是旧测试异常契约遗漏，不能修生产吞drain或重新声称费用落账成功。

最小test/fixture改法：
1. fixture提供严格的单一dispose owner：首调保存services.disposeMultiAgent返回的原Promise，body与cleanup都等同一原Promise，不再调用第二次实际dispose。正常默认cleanup仍传播全部错误。仅新增fixture内部assertFailedDisposal(assertion)：等待这一个实际原Promise拒绝，若成功则明确测试失败；执行调用者的完整断言，只有断言全部通过后才记录“这个精确错误对象已被显式验收”。cleanup再遇同一对象方可不重复报告；不同对象、未验收、断言失败一律报错。该能力只在测试fixture，不影响production/状态/票据，不按message泛吞drain。
2. 原AF2b参数化两case/body谓词/barriers不动。仅usage分支用Vitest普通spy观察真实recordUsage的原返回Promise（不替代实现），断言恰一次真实消费拒绝，保存实际SQLite原Error对象。原body完成后新增严格dispose断言：顶层真实AggregateError/message，唯一errors叶与原usage Error对象toBe同一，runtime blocked；root执行inactive但resourcesReleased=false/cleanupPending=true；任务不得成功，原child abort/无文件效果保持。recordRuntimeEvent兄弟不标记任何预期dispose错误。
3. mailbox A12仅把旧顶层字符串断言改成更强结构/身份验收：同一真实原loop拒绝必须是业务+physical双失败Aggregate，cause及业务errors[0]严格toBe原usage Error；physical子Aggregate名称与其叶也严格toBe同一原usage Error。usage consumer和provider各一次，不到usage之后text（被动count）、onSeal仍原恰一次failed、没有completed/seal success。保留真实provider/loop/mailbox和原onUsage rejected Promise，不放宽断言为任意throw/message regex。
4. 共用activity fixture的factory/service/boundaries/admission四suite具有相同早停cleanup风险。新增共享fixture cleanup函数，按原reverse依赖顺序尝试全部action，再无论前错均尝试vi.restoreAllMocks/vi.unstubAllEnvs，最后AggregateError保留所有未知错误原对象。四suite只迁移afterEach到该函数，原body/人口/时限不动。补精确cleanup回归在既有factory文件：两个cleanup错误按原顺序全可达、后续action照执行、spy与env确恢复；不测试生产假入口或以吞错刷绿。

执行门：先A/B/root评审本案→保留上述原两红→最小测试/fixture实现→A/B实码审；只当前worktree、不动7prod或B Loop/D6。原factory+mailbox及共用fixture四suite全文件在Node24/最低22.22完整实跑，名称过滤诊断不代替全文件。原Node22.22不支持nativeauthorizer的既有资格按原runIf保留，绝不伪造setAuthorizer。默认runner/hook及所有产品逻辑时限/原predicate不改。新真实失败如实保留，不扩预算或更新baseline。root组织最终GLM和full分区替换，不双计原人口。


### C9 lifecycle修订：失败owner journal只保留，父进程退出后才收取（取代原未明确root删除边界的旧案）

B独立阻断成立：production services.disposeMultiAgent在真实MA dispose拒绝后有意不走store.close，不能因错误已验收就在活worker中删除journal。A原批准/root原方向票保留为旧案轨迹，本修订重新审；不采用强关store、重复dispose、清sticky error或假称owner释放。实际Desktop Vitest3.2.4 cli-api的9906行global teardown先于9912行pool.close（root Vitest3.2.6则是9916→9922，二者独立核对；Desktop执行依据为3.2.4），因此借既有profile-account teardown删root也不成立，明确否决。nested Vitest child会加入冷启动/transform与原5s竞跑且扩大生命周期，本案不做。

主笔明确允许最小forensics保留方案：
- fixture在root创建时捕获规范realpath及原lstat的uid/dev/ino/birthtime，登记这是本case mkdtemp的专用xiaok-activity-bdd-目录。服务constructor之前标记owner可能已存在；只有没有服务owner或同一实际dispose成功履约后，原root删除action才可删除。任何dispose未成功（包括已验收sticky failure、未知错误、setup抛错后所有权不明、未完成）均不得rm root/强关journal。
- 该root action改为输出受限的固定前缀JSON forensic record：canonical root、创建时stat、workerPID、UID（无业务ownerId/凭证）。可附本owned runner的可选nonce作归属证据；不引入任何按任意path删除的生产/fixture API。即使错误未验收，root同样保留，原未知cleanup错误仍最终Aggregate并报红。正常fixtures仍原成功dispose后删除。
- 其余cleanup和mock/env restore仍按原逆序全部尝试。“全尝试”不代表owner已released；AF严格断言继续要求runtime blocked/resourcesReleased=false/cleanupPending=true，不作成功drain声称。已验收失败只让同一原dispose错误不重复报告，不放宽root保留门。
- 标准npmtest/raw Vitest若触发这一故障case，会明确留下故障forensics journal；这是有意保留，不声称teardown已删除。CI临时VM生命周期结束后处理其临时文件，不为此修改全局Vitest执行器/期限或业务资格。
- 本轮owned父runner在原Vitest以及其完整PGID真实退出且相关workerPID也不存在之后，才核对本次raw固定记录、canonical path为真实temp目录中的精确mkdtemp子目录且不是symlink、UID/dev/ino/birthtime与记录一致。仅删除这个已确认owned的具体root，落原stat/退出检查/删除结果JSON。任一归属/身份/退出条件不能确认就保留并报告未回收，绝不宽泛扫描删除。该清理只在ignored evidence owned脚本，不进入生产或通用CI权限。

修订后最小source仍仅4suite afterEach/共享fixture/factory强断言/mailbox强结构断言；另1条纯cleanup回归放原factory nativeAuthorizer guard外，证明两个未知失败都可达、后续action和spy/env restore均执行，非生产资格替身。原4suite/mailbox正文谓词/预算/原资格均保留。先A/B/root复审此完整修订，再实施；完整相关24/22.22后按每次raw/owned退出核只回收本批保留root。


### C9 root删除gate增量：必须与真实services2927相同（仅fixture，待A/B增量审）

当前19c6fixture的fulfilled判据不足：真实services.disposeMultiAgent在await multiAgentService.dispose之后，仅当同一个executionCoordinator.snapshot().active===0且!multiAgentService.runtimeStatus().blocked时才close store。实际disposeOwned在tryShutdownQuiescence=false时block后可fulfill，故fulfilled不证明journal已闭合。原130pass/1fail的五完整24 raw保留，不能当新gate最终绿。

最小增量：fixture只读实际service持有的options.coordinator与runtimeStatus；不注入新coordinator、不用runtimeactive代替、不填默认0。来源证明是services1005创建executionCoordinator、1060把同一引用传给new DesktopMultiAgentService、该类278以private readonly options保存原options，2927再用原executionCoordinator。root仅在同一原dispose已fulfilled+上述actual active===0+blocked===false时删。任何缺失、非有限/非整数active、非boolean blocked、门读取异常均先登记retainroot再以原错误/明确fixture门错误报红；已知active>0或blockedtrue则retain，不强关不清状态。构造尚未完整或dispose未履约仍原retain，正常三门都成立保留原rm。

有效新负例不复制生产：用这个真实fixture、真实原coordinator公开acquireLease持有一个ordinary ticket，直接调用fixture缓存的原dispose（只向测试返回已有dispose closure），断言两次调用是同一个原Promise且实际fulfill；原coordinator真实active=1，原SQLite store SELECT1仍可用，证明services2927确实未close store。随后运行真实fixture cleanup，必须retainroot。这是fulfilled-but-active反例，不冒称已实测fulfilled-but-blocked；blocked条件按同一production gate源码明确保留，未知门值不默认许可。未引入测试配置/生产期限变化。

为红测试不在活owner上真的rm journal，负例仅保护叶fs.rmSync：精确本case root若被尝试删除则先记录同一原root/stat/workerPID/PPID/runNonce、抛出专有sentinel，别的path全调用原rmSync；最终断言此删除尝试计数必须0，cleanup必须无未知错误。原旧gate会在此真实边界红而不会真删活journal；新gate不会触及保护叶。ticket最终只由其真实owner release，不修改gate/snapshot/blocked，不提前删root；父仍等整个owned组退出后stat核实晚收。

同轮修正首24新失败：no-success task snapshot检查移到dispose之前原body完成后，随后才显式验收失败dispose；原异步回收器在dispose前段已正常close Codex DB，不能在dispose后再调用recoverTask。保留并不削弱not-completed断言及原strict SQLite/physical identity/blocked/root资源断言。旧red与afterEach正确重复报告未验收error原始日志均保留。

新负例先红→唯一fixture删除gate修复→A/B actualdiff审→五完整file24/22.22重新执行。新fixture/factory hash刷新，其他4file及7prod不改。原firstwhole24 forensic root已在PGID72479与worker76210都不存在后按nonce/PPID/canonical/stat验证精确删除，原cleanup JSON作为实证保留。


#### C9 gate 第二轮：关闭证据不可由事后coordinator状态推断（替代上一小增量的充分性结论）

A新的BLOCK成立并保留：普通ticket在dispose时active1使services2927跳store.close，但service自有tryShutdownQuiescence本身不看ordinary active，故实际dispose可fulfilled且blockedfalse；随后ticket release变active0，cleanup事后active/blocked全满足仍不证明journal已close。B上一增量APPROVE仅旧方案轨迹，当前不实施该不充分gate。

新必要关闭receipt：fixture已持有真实store私有原DatabaseSync实例db；从已取得的这个真实db自身的Object.getOwnPropertyDescriptor(db,'isOpen')捕获原own native getter（真实实例为nonconfigurable own accessor，prototype无此项），并以同一个db为receiver调用。只有其明确boolean false，才有实际连接已关闭证据；不得只看store.isClosed（该方法旗标可先置、db.close再抛）或事后普通状态。getter缺失/调用抛/非boolean均retain且保留原错误或明确fixture证据未知错误；不主动close、不用spy结果/默认false伪造。A已独立实证最低Node22.22与Node24该真实API open true→原close后false，当前版本支持但仍保守处理未知。

root删除必要条件现为：同一原dispose fulfilled、实际同引用coordinator active===0、runtimeStatus.blocked===false、原db native isOpen===false。actualactive非非负安全整数或blocked非boolean视未知retain+报错；已知active>0/blockedtrue/dbOpen true均保留，不宣称released。创建/partialsetup未知仍保留，正常确实原nativeDB已close才维持rm。

新负例按真实release-before/after-cleanup两参数分别执行，重点反例为release-before-cleanup：同一真实ordinary ticket active1，缓存原dispose两次严格同Promise且实际fulfill；断言真实service blockedfalse、真实db.isOpentrue和SELECT1可执行。然后原ticket.release→actualactive0、仍blockedfalse/dbOpen true，再运行cleanup。必须保留root且从未触及精确root rmSync保护叶。这个轨迹使“只事后重读2927”也先红，关闭证据修订后才绿；无资格/期限/生产改动。释放ticket后不重试dispose、不手动closeDB，父等真实worker退出后才核stat晚删。其它unknown/callback/原错误/none-completed断言修订保持上一小案。新正式A/B票后先红再唯一helper gate修复，最后完整五file两个Node版本重验。


### C9 最终实际闭环

最终helper eeafb32c…99b0、factory a10a9d3a…0966及其余四源按C9-final-code-manifest.json复核无漂移；A/B最终实码APPROVE，历轮BLOCK保留。Node24原五完整文件133/133通过；Node22.22同五文件17通过/116原nativeAuthorizer资格skip，二者exit0/reaped，原资格/期限未变。133=原130+未知cleanup1+实际lease时序2。retained journal分别11/2个，父在run/组/worker实际退出后逐nonce/PPID/canonical/stat校验精确晚删，无清理错误；不在活owner中删journal、不称sticky失败已释放。原两usage红/首完整新断言位置红/两lease红与所有审查阻断沿革保留。详细逐file结果及raw/父晚清理见ignored证据C9-final-results.json与C-final-closure.md。主笔持有quiet Intent23和最终全仓/GLM/构建整合，本节不冒称全仓或发布完成。
