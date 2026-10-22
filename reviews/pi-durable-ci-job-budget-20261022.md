# CI job总上限：保留安装与完整原验收的执行机会

基线c7c7837576b567cf68737c9570e2ba825164337e，仅提议.github/workflows/model-recovery.yml的recovery job timeout-minutes从15改为30，一次有界修订。原9leg、最低22.14/22.22与24、3OS、fail-fast:false、原checkout固定源码、npm flags、全部tests/build/worker命令、step顺序、资格及断言不动。不得自动再次增额；依赖或业务仍失败/到30min须保留非绿。额外最大消耗是该矩阵每个未结束job至多再15分钟，不取消任何验收。

## 真实证据

c7 run39712807459，Win22.22 job119607869149于02:42:02开始、02:57:07结束cancelled；ci-c7-win22-cancelled-annotations.json实际GitHub annotation明确“The job has exceeded the maximum execution time of 15m0s”。raw ci-c7-recovery-win22-22-cancelled.log最后停在第二次npm ci --ignore-scripts --prefix desktop，SQLite七文件/build/worker均skipped；这是未验，不是runtime93又失败。其它cancelled腿须按各自API/annotation单列，不靠此一腿推所有根因。

同源码Win24 job119607869125成功。其root npm ci02:42:20–02:47:25、desktop npm ci02:48:11–02:53:15各约5分钟，已占10分多；七文件02:53:24–02:53:52全部93/93，真实8native与memory false，job02:54:39完成。actual synthetic ac15dd99bd23578072e6a0559fec895ffd1820ec树dab3a1bf87378f3fb08659ab0b2308f4778115d0与c7完整树相同，父节点为677主干与c7。不能把该Win24绿用作Win22.22绿。

此处没有npm timing/CPU/网络证据，不能断言audit、registry故障、磁盘或宿主调度根因。没有更改npm audit/安装脚本/依赖版本/cache接受语义；30min只给此前被基础设施上限截断的原操作一次完整机会。不是性能收益，不声称>=5优化，也不更改Loop产品10s/hook10、原case30/120/300、CLI退出新10s或Windows活动120。

## 评审与验证门

root先核真实workflow、原raw与API annotation；A/B只读对抗评审此一行/资源预算/未验口径。配置涉及不同模型，合并C退出等待最终实码包给明确路由的不同模型审查。设计票齐后才改这一行；YAML parse与移除此一行后的整workflow逐字比对、git diff --check，原git source冻结绑定当前变化。公开保旧cancel/旧七红/新真实93，完整最终HEAD质量检查。

新完整HEAD重新跑原9leg；必须逐个实际执行并通过相应最低资格/完整原测试/build/worker，才能关闭其验收。无真实run则pending，cancelled/timeout/skip不得绿。Desktop20min及独立diagnostic10min job目前不在该修订；若它们另有实际jobcap证据，须单独补案/评审，不在本案凭假设一起增加。

## 实际20分钟截断后的独立补案（前三段15→30票不自动覆盖本案）

c7 Desktop run39712807575的Ubuntu22.22 job119607869552已于03:02:20 cancelled。GitHub实际annotation（ci-c7-loop-linux22-cancelled-annotations.json）明确exceeded20m0s；job API记录root npm02:42:16–02:49:17、desktop npm02:49:17–02:56:21，共约14分钟，原full8只获02:56:21–03:02:17约6分钟就被job总上限中止。raw保留runner当场清理其npm/Vitest/esbuild子进程；不能把截断输出拼为完整8。

同轮Ubuntu24 job119607869683完整完成原8，实际2通过6失败、suite826.72秒，原30/120/300 runner失败及pending断言完整保留。20min总上限与14min实测setup相加，不足以容纳原完整8的最坏有界870秒及收尾；提高job总上限只保证取得完整原结果，不能使这些case超时转绿。

仅补改.github/workflows/desktop-cross-platform.yml的loop-controller-tests timeout20→35，原2OS×2Node矩阵/全部8/--maxWorkers1/npm flags/原case30/120/300/产品10/hook10均保持。35min取14min已见setup+14.5min原8最大runner预算+约6.5min checkout/transform/cleanup余量，每leg至多额外15min，仍一次有界；超过35min或原case失败照常非绿，不自动续增。

同时结束713新增的临时loop-controller-macos-diagnostic job，未来commit不再重复采集已取得的CPU profile。713实际worker3542完整profile SHA db5cfe39a6604468c4ef8e1a7c5a711d7c22bc6252c6cc653ce26115d59f3bcd、23MB、46399samples及144源码核对结果已下载本机留档，其原单项1F/7filter和所有后续失败永久保留。删除仅此额外取证job，不删除三个原job或其中任一原8验收；当前c7已启动的job继续运行、保原结论，不手动cancel。后续最小RPC追踪已独立设计/审查，本机一次诊断不能作full8资格，是否需要真实CI另按新证据设计。

补案源验证：从新workflow反向恢复35→20并插回逐字归档的该额外job，应与原18259862全文件一致；三原job对象除唯一loop timeout属性外应全等。原CPUjob源/日志/模型票等历史冻结不改，当前矩阵失败不受删除未来取证job影响。A/B/root需先批准本补案，再生成实码；不同模型在新的实际workflow SHA上追加审查，不复用只读过6231 recovery一行的旧票。源域仍原81中的两配置变更，加C的4域外路径，共85；若TTY兄弟另扩，单独计域，不把新增纳冻结误说git新增文件。
