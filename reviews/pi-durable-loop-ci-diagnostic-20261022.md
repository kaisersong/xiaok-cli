# macOS Loop：先取真实 CI worker profile，不修改产品或预算

当前 eade 对应的实际 CI checkout 是 synthetic merge65b1f375ccd95fe2a1aad282924ebed5cdf6f4b5。macOS14.8.9/arm64：Node24.20 为原8场景5通过3失败；Node22.22为4通过4失败。原两完整raw与逐阶段取证保留，不能用本机8绿或Ubuntu绿覆盖。

Node24的desktop-service与timed-pending分别在108.310/115.175秒完成fresh-view，随后在原120秒附近失败；publication_pending来自保守completion-reader false路径，但原raw未保留其内部错误，不认定必然是同一个取消根因。output-consumer在root-publication-current前38.314秒被真实published-candidate第35行的独立10秒期限拒绝，尚未进入output分支，300秒外层不是这条失败原因。Node22.22另外出现terminal30秒、desktop独立10秒、timed120秒、output300秒；output已到236.705秒的workspace-mutation-refused再触300秒，不能把两版统一简化为单个timeout。

当前没有该CI的CPU/RSS/IO实测，不能归因为硬件慢、APFS/fsync、资源争用或Node版本。旧本机真实Loop profile中intrinsics与SQL热点只作调查方向，不当CI比例/收益证明；已经否决的descriptor微改、事务scope候选不重做。产品5次fresh logical读取与每次controller.identity+业务两轮实际签名RPC、10秒期限、FULL/DELETE持久化和全部安全/取消边界均不动，不缓存或删检查。

## 最小第一步：仅 workflow 新增独立诊断 job

- 在当前已推送HEAD之后做独立增量。只改 `.github/workflows/desktop-cross-platform.yml`：保留原Ubuntu/macOS、22.22/24完整8矩阵、原命令、原20分钟job预算，正常矩阵不启profiler。既有Loop测试、fixture与所有production字节保持不变。
- 新增一个独立 `macos-14`/Node24诊断job，使用同一checkout/setup-node和两份lock的原 `npm ci --ignore-scripts`，不额外安装或改依赖。只运行同一个原测试文件 `--maxWorkers=1 --reporter=verbose -t 'output-consumer$'`；保留原300秒case、默认10秒hook及产品10秒。其余7项是明确名称过滤，仅诊断，绝不当8项验收或新增通过人口。
- 用原Node入口 `node --cpu-prof --cpu-prof-dir=<本job专用目录> node_modules/vitest/vitest.mjs ...`。已读实际Vitest3.2.4 coverage.DL5VHqXY.js:3334–3336：fork会保留process.execArgv中的cpu-prof参数。因此同时获得launcher与真正worker profile，不能只挑一个文件便声称worker；用PID/profile filename/CPU节点和实际metadata匹配。先只取这一份profile，采样开销明确记为诊断扰动，不能用其耗时充当无profiler性能基线。
- 新诊断job独立上限10分钟，不增加原8矩阵或任何case/hook/产品期限；足够容纳安装、原300秒case与有界回收/上传，但不是承诺所有运行必完成。诊断失败原样保留exitCode，不用 `|| true` 或最后tee成功覆盖真实退出。
- 可用workflow内小型Node进程owner包装（不新增测试/产品逻辑）：创建本job专用artifact目录，spawn一次上述固定命令，记录PID/独立PGID、版本/平台/架构、实际checkout SHA和原test/locks/关键reader哈希；tee原stdout/stderr到本目录及joblog，wait/reap并保留原exitCode。只回收该次实际记录的自有进程组，不按名字查杀；未确认退出则metadata明确unknown并使step失败，不报0。不得改共享服务、数据库模式或清理其他job/本机目录。
- `always()`上传只限本job目录的原log、metadata和cpuprofile，短保留期；无profile/中断/不完整必须如实标记，不虚构CPU证据。profile不含参数值；不打印请求Buffer、payload、keys、ticket、nonce或环境全量。硬取消若来不及上传则报告缺证据，不把缺artifact当“没有热点”。

本次不为trace改测试body，也不跑本机完整8或新CPU实验。A/C/root先审此案→root/B确认workflow编辑归属→最小实际diff再审（含不同模型配置复审）→新完整HEAD真实CI。无profiler原8结果仍是验收；单caseprofile只是根因诊断。

## 证据门与第二步触发

先用真实worker profile判断CPU集中在纯计算、SQL/native/系统等待，还是采样不足；不能相加重叠inclusive成本或仅凭CPU profile断言磁盘原因。对已拒ROI不翻案。只有新的具体候选与同等安全边界、实际至少5%端到端收益证据齐全才另开production优化设计；本案没有授权产品改动。

若profile无法确定独立10秒花在哪个RPC/同步checkpoint，再单独审一个fixture leaf被动trace增量：原roundTrip同Buffer/同signal/只调用一次/原Promise及原错误透传；原server invoke亦只观察原返回promise，记录method、单调耗时、CPU区间与caller/test abort先后，logger失败吞掉且不记录payload/keys/nonce。每逻辑方法先identity再业务；server invoke不含identity，因此数量不得强行一一对应。客户端验签/snapshot、同步current检查不在server span内，须结合真实profile。该第二步当前不实施、不扩scope。
