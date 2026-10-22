# Loop terminal：一次最小被动RPC诊断设计（尚未执行）

目标是确认**原单terminal**路径各实际RPC区间、原错误/ctx取消先后与process CPU/wall事实，不是优化、不替代原完整8或平台资格。当前原test SHA83582426fda875e785ddf75b03ebdb2a7a1b528e1c861c5008fa8052912ef4e6；production、原test、配置与锁均不落改动。先root/B独立审设计→构造隔离copy/实码审→主笔仅授权一次本机Node22.22单worker原terminal。当前只写文档，未生成或运行harness。

## 装配与范围

选择系统tmp下mkdtemp的自有0700目录，包含instrumented source copy、临时Vite配置、manifest及缓存。**不在tests目录创建新test文件，也不替换原磁盘source**：临时配置import原desktop/vitest.config.ts，完整继承原setup/globalSetup/alias/private-finalization loader，新增一个pre-load插件，仅对原test的精确canonical文件ID生效。插件先核原文件bytes/SHA，返回临时copy文本，模块URL仍为原文件，所有相对imports/vi.mock/实际依赖身份不变。其它所有ID原样由原loader处理；cacheDir只指本tmp。配置从实际Desktop Vitest3.2.4的dist/config.js引入mergeConfig，不误用root3.2.6。include仍为该一个原test路径，CLI精确名称过滤terminal。

原8 modes/scenarios、it.for、30/120/300固定参数、59 expect调用与5 f.setTime（实际构建时AST逐项再核）、ctx.signal传播、onTestFinished的原same-scenario settledOutcome、原业务body/顺序/返回值均保留。临时copy除下列observer包裹/声明、stage有界资源字段与明确的日志保留安全例外外，能反向整字节还原83582426原文件。构造时若替换出现0次/多次或AST人口/断言字节不等，禁止运行。当前CLI1136/Desktop828源人口不变；单file收集仍8，实际1执行/7名称过滤，不能写成full8绿。

输入manifest记完整HEAD、原test/临时copy/配置/observer代码SHA、原8production、两锁及直接fixture/reader/client/routing依赖SHA，运行起终逐项核。原fixture支持ef333a58…verifiedOperationFixture与7107f957…installedControllerFixture、原desktop config0bd7611d…需保全值核验；任何漂移先停。Node使用已存在的实际22.22二进制（先记录version/execPath与二进制SHA），不npx下载、不伪造recipe/env资格，不build/compile共享dist、不profile。

## 唯二RPC包裹及原Promise/错误保真

1. 原startPublicController参数中的`async invoke(method,payload,peer,serverSignal){原body}`整体作为原函数交给test-local透明wrapper：wrapper用捕获Reflect.apply(original,this,args)调用**一次**，原payload/peer/serverSignal/this与实际body字节保持，直接返回该次原返回对象/Promise。原body内所有application/material早return、opRouting await、dispatches/publicationApprovals、lost错误分支均不改。不得用一个新async wrapper await再返回来替换原Promise。
2. 原leaf.factory的`roundTrip:(bytes,callerSignal)=>{ 原signal合并/throwIfAborted/callControllerIpc }`整体同样包透明wrapper。原Buffer与callerSignal、原AbortSignal.any调用及其结果、socket/timeout选项/原callControllerIpc调用只执行一次；直接返回原Promise。server wrapper不能另包actual路由/SQL对象，client wrapper不重新parse/reissue业务调用。

wrapper仅创建观察记录。对已知原native Promise，用捕获的原Promise.prototype.then附加两个**不抛出**的settlement handler，保留并返回原Promise；handler的派生观察Promise不参与业务返回且两分支均显式返回undefined，禁止unhandled rejection。同步throw只记录后`throw error`同对象；fulfill/reject记原值的opaque本地identity ID，不clone/freeze/读getter/改值。若原返回不是可观察native Promise或观察器失败，记observer-invalid，返回原结果不变，不能Promise.resolve任意thenable或调用新getter来“修正”。观察器不改变原实际调用/错误传播顺序；新增.then/日志的诊断扰动必须披露，不能拿耗时作性能基线。

每条事件只含mode、有限白名单method、独立seq、begin/end/throw/abort状态、monotonic数值、原值opaqueID/typeof与有界**自有data**错误message（若无安全data字段只记unknown）；禁止payload/请求Buffer/票据/key/nonce/完整result/stack/环境dump。client method只从本test实际生成wire做guarded有限JSON解析取method白名单；不记录或转发其它解析字段，解析失败只记unknownMethod，不把解析异常message输出。server method直接用现有实参。原method/Buffer不能为了trace重建。

controller.identity在daemon内部处理，不经过server.invoke；每个逻辑call原identity+业务两个roundTrip均记录。两边seq各自独立，只有同白名单method且唯一pending请求时记录关联，若存在并发/歧义则link unknown，不能按完成顺序强配或记录nonce消歧。

## 取消、CPU/wall与有界收集

原scenario的testSignal只加被动once abort listener，记录ctx首次abort时间及reason opaqueID；client每次观察原callerSignal与ctx、server每次观察原serverSignal与ctx的abort先后，reason只安全data字段/identity。listeners都在原work settlement时移除；scenario listener在该原scenario结算时移除。记录caller先于ctx只是事实，不能直接称inner10根因；若原reason安全data确含loop_publication_read_timeout可如实列出，仍不重新分类错误/改变返回。

每次RPC begin/end以及原stage mark附加捕获的process.cpuUsage()/resourceUsage()原快照：单调wall、user/system CPU微秒、maxRSS原生值；不创建timer、无额外SQL/authority/model。CPU差值是**该worker整个进程在区间内**的CPU，重叠RPC不能相加；maxRSS是高水位不是每请求峰值，原单位/平台写入metadata，不用sampling interval推CPU饱和。wall>CPU差值亦不能单凭此归因磁盘、宿主调度或外部等待。

事件只存有限内存，预置最多4096条、单字段长度160、无大对象；超限设置truncated并停止记新事件，诊断有效性为unknown。仅扩展原stage mark的JSON字段，stage名称/原elapsed字段不变；正常RPC不逐条console，避免console主导区间。附加一个same-scenario observer，在其settled后统一flush `A_LOOP_PASSIVE_TRACE`有限JSON；不改原finally/closeLoopResources或原onTestFinished join，不创建第二个scenario。即使原body/cleanup拒绝也flush；logger内部异常只计observerErrors且**不吞原业务/cleanup错误**。若console无法写出最终trace，原runner/log仍保，证据缺失不当通过。

不加census factory spy：实际owner-enrollment-authority.ts:47仅构造时调用createRegistrationCensusDatabase，次数不能测每open/每RPC的census倍率；它增加mock身份面且大多RPC差值0。若之后要内部census计数，需新案，不包frozen返回对象或private DB/fingerprint。

## 自有资源与未知journal

唯一额外安全差异须本轮评审显式批准：临时copy中已登记的fixture关闭从`f.close()`改为已有API `f.close(true)`。verifiedOperationFixture.close参数仅传给installedControllerFixture.close；原operations/installed close仍真实执行，正常返回/抛错不改，只禁止在活worker内删除fixture根。所有8mode同一关闭叶采用此诊断保留，不优化/跳过drain。否则原allclose虽然保错误，却可能在另一个资源close未知后由最后f.close删除整个root；不能靠POSIX可unlink或Windows会EPERM保证安全。该差异不属于业务断言或生产修改，但明确意味着本诊断不是原cleanup的逐字耗时基线。

f返回后立即记录其**实际**root的canonical/dev/ino/uid/birthtime、workerPID/PPID、本runner一次性32hex nonce。该root原installedControllerFixture创建前缀ia-，仅记录这次返回的精确根，不能按prefix扫描。若setup在f返回前失败，fixture-root未观测就报告unknown，不搜tmp/不猜路径/不清它。原fixture内部已有partial-setup清理逻辑本案不改，不宣称所有隐藏资源已发现。

原server/application/receiver/hosts/stores关闭、还原Date/profile/marker仍由原closes/restores以原依赖次序全attempt，原body+cleanup Aggregate及其身份保留。parent专用runner spawn一次Node，start_new_session=true记录launcher PID/PGID、进程身份起时/uid与child原exit/signal/reaped。原case30s/hook10s不变；独立owner外层60s只防整个runner不退出，TERM只本次仍未reaped的自有PGID，5s后仍未reaped才KILL，再5s仍未知就记录unknown/nonzero；不杀名字、不操共享服务、不在parent已reap后向可能复用group盲发信号。原错误/非零不被tee/metadata写入覆盖。

parent只有launcher真实reaped、whole PGID0、记录workerPID实际不存在，nonce/PPID与原runner严格相符、root是原实际tmp父目录直接child且无symlink、canonical/stat/uid/birthtime（在原run时间窗）逐一匹配后，才删除该**精确**fixture root；任何不符retain/report，不扩大扫描。诊断自己的temp config/copy/cache同样以parent创建身份/文件manifest验证，group0且所有生成物归档SHA后精确删除。日志/metadata留ignored证据目录。最终明确signals数量、own residual count与unknown边界，不把事后group0扩写为全时段进程出生census。

## 一次执行门与退出事实

B/root批准此设计后，先交临时配置/observer/注入diff、可逆原源SHA与AST审；尚未得到一次run授权不得执行。固定命令意图：实际Node22.22 + Desktop3.2.4 vitest入口，cwd原desktop，`run 原loop test --config 自有tmp配置 --maxWorkers=1 --reporter=verbose -t '^executes and recovers the original Loop verification through the signed controller: terminal$'`。仅一次，不因local pass/trace不全/timeout自动再跑或加预算。

结果报告原1实际case与7名称filter、原退出/所有错误/stages、实测logical RPC人口及identity轮次（不预设为5）、信号因果与CPU/wall区间。原case失败必须非零保留；原case通过但trace缺失/截断/监听未收尾/输入漂移则诊断有效性unknown，父交付不能称成功（返回非零）。即使本机未触inner10，也只证明本机trace装配可用，不能推CI根因/收益/完整8绿；后续真实CI相同trace需单独设计/审定，不自动扩大本轮执行。
