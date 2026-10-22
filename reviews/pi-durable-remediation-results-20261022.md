# PR #74 全量失败修复与验证

最新已完成的489fe实际CI及后续手动诊断实现见[独立增量](pi-durable-loop-ci-rpc-validation-20261022.md)：32项成功、2项Loop失败、1原有跳过；Linux同shell六入口、两版Windows原93及Windows106+68均实际成功。Loop两绿两红，仍未关闭。下面c7及新HEAD待验描述按当时历史保留，不能覆盖该增量的实际终态；后续完整HEAD状态以PR说明为准。

后续实际CI暴露KSwarm源码装配、Windows活动测试预算、Windows runtime fixture遗留SQLite句柄及Loop间歇超时。前两项历史80源增量见[CI修复记录](pi-durable-ci-remediation-20261022.md)；Windows完整owner关闭、原错误保留和81源绑定见[生命周期修复](pi-durable-windows-runtime-cleanup-20261022.md)及[实际证据](pi-durable-windows-runtime-evidence-20261022.json)。c7的真实Windows24恢复作业已成功，原七文件93/93且全部原native句柄关闭；Windows22.22作业在安装依赖时被原15分钟job上限取消，未运行这93项。

最新增量修复[TTY退出观察](pi-durable-permission-hook-exit-wait-20261022.md)及[四个相邻入口](pi-durable-permission-sibling-exit-wait-20261022.md)：用同一pane的真实正常退出回执替换固定1秒采样，保留全部业务断言、范围和命令变体，并完整保留业务及清理原错误。11项守门回归、真实permission场景在Node24/22.14通过；新增四入口在两版各完整8变体、15份stop前正常退出回执。和未修改yolo的已有成功组成六入口本机Node24成功union，并非同一shell六连跑。不同模型gpt-5.6-sol已实际审查初始四域及新增四域并APPROVE。外层[CI预算修订](pi-durable-ci-job-budget-20261022.md)只给安装和完整测试有界执行机会；原用例、产品和hook期限不变。新HEAD真实CI仍待验。

c7后续Windows路径106项、formatter/Room/activity68项断言通过，但Vitest内部onTaskUpdate超时导致作业失败。新增[runner确认屏障](pi-durable-vitest-storm-rpc-ack-20261022.md)只在原同步10000条事件前等待真实状态和注解RPC确认，并以原ctx信号阻止取消后迟到继续；循环内不yield、原终态/重开/replay/5断言和120秒Windows预算均不变。五完整文件在本机Node24/22.22各68项通过、exit0且无未处理错误，实码经独立不同模型APPROVE；新HEAD真实Windows仍待验，不能由本机快速storm外推Windows超60秒重现。

Loop在c7 Ubuntu24和macOS22.22各完整2通过6失败；macOS22输出场景另明确触发原产品10秒读取期限，macOS24及Ubuntu22被原20分钟job上限取消，未得到完整八项结果。完整原worker profile和一次本机被动RPC诊断保留；后者方法识别不全，不能称完整观测。无足够收益的descriptor微候选已拒绝实施。另案[一次手动CI调用边界诊断](pi-durable-loop-ci-rpc-diagnostic-20261022.md)只定位原实际超时，不授权生产优化或期限修订。旧绿或取消不能关闭这些失败，Loop与远端128项仍未完成。下列全量本机记录按eade的79项冻结保留，不重复累计新93、Python或跨版本重复。

本轮承接用户“解决失败问题”，不把此前基线失败当成结案。PR #73 已于 2026-10-21 合并；本分支已集成主干 `6770092945a42fb0e45ef0d68d0971bfc01b51a8`。本轮起点为 `d0e35e73014add369748de77fe2a868a62777f13`。原始失败记录保留在 [集成记录](pi-durable-integration-results-20261022.md) 和 [不可变失败清单](failure-remediation-ledger.json)。

本机可运行回归已完成：CLI1136文件为13456通过、0失败、225原skip；Desktop本机824完整文件为10159通过、0失败、8原skip。下面分别保留原始红、修复后完整文件替换及未验资格人口；四个远端文件和最终HEAD跨平台CI仍待验，不宣称全部资格通过或release-ready。最终完整提交及CI状态写入PR说明；本记录按源码SHA绑定验证，不将旧HEAD的CI当新HEAD证据。

## 实际修复

- Desktop 的迟到 usage 在原 provider 物理运行内捕获并等待提交；取消后仍归账真实成本，消费者提交失败保留原错误并停止模型重试/候选回退。普通 usage 只记一次。
- Loop 输出把固定读取器的内部 wrapper 转成恰好六个 own-data 字段的内容快照；预览、列表共用这一边界，前后 current 检查和导航前后的独立新鲜读取保留。严格解码器、授权和写入凭证没有放宽。
- 构建后的 glob worker 使用模块相邻真实资源；补齐 Room 字段分类；两个 renderer 组件复用 Intl formatter，并保留 locale、时区和历史 DST 变化的失效条件。
- 修正真实 Main/IPC、DTO、权限来源、私有服务身份、故障注入和原生依赖的测试装配。旧安全快照、原测试人口、资格要求及治理 baseline 保留；新增反例单列。

原 pi 借鉴本批仍是 [压缩响应完整性](pi-durable-optimization-results.md)；完整 wire-token 预算资格、缓存回收收益和存储损坏协议仍依父方案门槛处理，不能由本轮修复推断已经实现。

## 测试装配边界

完整链路耗时及超时后异步继续执行已分别实测。Loop 复杂流程使用有界、按模式设定的 runner 预算；Intent 九个同类分支统一既有 40 秒，其中四项由 30 秒修订。真实 context signal 贯穿 RPC/setup，finished hook 等待同一个原始 promise 完成清理。旧失败和强制短超时诊断保留，不把诊断中的下一项通过当作完整验收。

usage故障测试保留原SQLite错误对象，明确断言业务与物理清理错误树、无成功seal/后续模型文本和真实owner未释放；未知清理错误仍失败。fixture缓存同一个真实dispose promise。其fulfilled不能单独证明数据库关闭：真实ordinary lease可使dispose保留journal，随后lease释放到active0也不会补跑close。两条真实时序反例覆盖这一点；删除门必须同时核验原dispose成功、同一coordinator的active0、runtime未blocked及原数据库native isOpen getter明确为false。未确认时保留forensic root，直到本轮父进程确认runner已reaped、自有group和worker均消失，且nonce、父子关系、canonical路径、设备/inode/uid/birthtime匹配，才删除精确自有root。普通测试命令会明确报告留档路径，不把留档冒称成功drain。

D6 FIFO 的原 100ms 是测试传给真实 host 的 subject 参数；全量轨迹证明，原 CPU worker 尚未完成时就正确到期，实际 FIFO 读未开始。仅为 D6 使用既有 2000ms 有界参数，先建立真实 raw-open 提交，再等待同一真实 deadline 后检查原 in-flight、unknown、cleanup-pending 和 heartbeat。D7 的 100ms CPU 取消检查不变。此项是故障注入前提修订；实际三完整文件69/69通过，D6在3370ms内完成，late-writer诊断另证实内核FIFO读、后续resolve/close/host drain。不能描述为D6原数值100ms已通过。

Desktop 开发/完整测试最低 Node 准确声明为 22.22.0；实际 Electron 嵌入 22.22.1。CLI 原最低 22.14 保留。CLI-only 和 Desktop emitted worker 分别有独立入口；CI 提供固定 KSwarm 源码并运行真实 generator。

类型检查范围按实际配置声明：root生产`tsc --noEmit`和Desktop baseline typecheck已通过；`tsconfig.tests.json`原有`noCheck:true`，因此名为`root-intent-semantic-compile`的历史runner仅证明该编译命令退出0，不是测试源码完整语义类型检查。测试正确性以实际完整Vitest执行、独立实码审查和强制超时诊断为证，不把该标签当类型证明。

## 证据与未完成项

具体设计与逐轮阻断/修订见 [root](failure-remediation-root.md)、[A](failure-remediation-A.md)、[B](failure-remediation-B.md)、[C](failure-remediation-C.md)。选取的实际 runner、每文件结果、原始日志 SHA 与清理身份见 [证据清单](pi-durable-remediation-20261022/artifact-manifest.json)。原始大日志和 profile 位于被忽略的本机 eval 目录；不提交私有送审 packet。

为便于查阅，82份runner记录、7份结果摘要及72份选取日志按原文件名分别合入`runner-records.json`、`result-summaries.json`和`selected-logs.json`的`records`字典。条目保存脱敏后的逐字节UTF8文本，manifest的`consolidatedEntries`记录容器/键及原raw/saved SHA；重新UTF8编码即可核验原saved SHA，未删任何已选内容。独立最终分区、源码清单和审查票仍单列。

三席独立agent审查之外，已实际使用GLM-5.3完成不同模型审查：七个冻结生产文件的原始包、新Loop适配/fixture/CI的532839字节完整增量包（SHA a934cd15c4446cdb66c8e86d38600f3df831a8deb10033687d9435730b90f43f），以及最终factory setup清理15968字节补丁包（SHA 4fb9e81be2cfe1fcde092d465b2cea2ef88fb124f4ec377ec783b4818f585a55）均实际APPROVE。每次system init确认为GLM-5.3，工具调用0；输入/源码SHA、原始回复与执行身份留档。这些是静态审查，不能替代未完成的远端或CI运行。

[CLI最终精确分区](pi-durable-remediation-20261022/A-cli-final-partition.md)为1136文件：1107 pass file、29原skip file；13456 pass / 0 fail / 225原skip case，共13681项。其1134文件补集为13418/0/224；新Loop host的真实runtime闭包8文件331/331完整重跑已整文件替换，绝不再加331。另两个文件分别取host-controller原CPU-profile运行中的实际16项通过（原合跑39项exit1保留，不称正常整39绿），以及最终同SHA无profile的Intent完整23项22通过/1原opt-in skip，808.81秒。原40秒时钟项35370ms通过，原40秒失败保留；quiet结果本身不证明并发因果或稳定性。历史helper40原已计入旧union的skip，当前首次成功收集为33通过/7平台skip，不能再向旧总数加40；本轮根测试另新增4项。

Desktop823文件完整运行实际10144 pass / 4 fail / 8原skip；四红分别为D6注入前提、activity-store隐含runner预算和两条usage故障预期/清理契约。D6三完整文件69/69已复验；activity-store连同四个formatter/Room相关完整文件在Node24与22.22均68/68。usage五完整文件最终Node24为133/133通过；Node22.22同5文件17通过、116原nativeAuthorizer资格skip，新增两lease反例及cleanup反例不依赖该资格。两次分别11/2个forensic root经父进程严格身份门和worker/group0实证后逐个晚删，未发送清理信号。独立Loop原8模式已全部通过，output完整链164.408秒；最低版本相关Loop四文件65项在22.22及24均通过，最低版本完整8模式待GitHub矩阵实际执行。结果按精确、不重复的文件分区汇总；跨源运行保留起止SHA，并以新代码完整补跑替换受影响文件，不伪称每个全量批次都在最终冻结版本运行。

[Desktop最终精确分区](pi-durable-remediation-20261022/B-desktop-final-partition.md)实际合计824个本机完整文件（820 pass file、4原skip file），10159 pass / 0 fail / 8原skip case。算法先从823结果中移除11个完整旧文件，再放入新完整文件结果，最后只加一次Loop8；factory真实新增3项，host21原已收集不能再加6项。四个远端资格文件128项单列待验，未计为本机skip或通过；完整声明人口828文件保持。

四个依赖真实已注册recipe的文件（128项原人口，含1原skip）须在kai-mbp验证。最后一次受控SSH于01:36 UTC仍超时；没有伪造资格、放宽注册规则或增加skip。GitHub最终HEAD CI与上述远端四文件待验。自有进程审计覆盖146条runner身份记录，当前未解决残留0；1个已被更晚系统进程复用的PID/PGID未发送信号，A/B/C记录子进程另有关闭证据。232个tracked生成文件已恢复、28个精确自有untracked生成文件已删除，dist/build-info不入提交，79个已审源码/配置/测试SHA未变。intent-broker sibling既有未提交/落后状态保持，未发布、签名、安装或自行合并。
