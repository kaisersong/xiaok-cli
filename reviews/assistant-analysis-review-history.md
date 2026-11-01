# Assistant analysis 独立评审历史

[返回 provider 入口](assistant-analysis-provider.md)。本文件按原二级标题拆分，保留各阶段已核实记录；历史scope不自动扩展至后续改动。

## Kimi delta：selected modelId 与缺 manifest 的 crash 恢复（实现前设计/自审）

主线程处理Settings选择revision+modelId+identity匹配；bootstrap只新增实际local modelId返回值，readCurrentModel仍返回identity，不混淆类型。

仅显式prepare允许恢复rename成功、manifest尚未发布的leaf：确认leaf不是symlink，只有lstat(manifest)的ENOENT才进入恢复；完整wheel/tokenizer hash、整环境inspect/freeze和fixture=7校准全部成功后，在最终leaf路径生成manifest并原子发布。已有损坏/目录/symlink manifest绝不覆盖。restore维持只读，不恢复、不下载。缺文件/改包/错误解释器/取消时不发布manifest。不会在stage生成含stage绝对路径的manifest。

对抗自审：新manifest先写专属随机临时文件、sync/close，再hard-link到不存在的manifest.json（不覆盖竞态出现的目标），最后只清理自己的临时文件；这样不会再引入“最终manifest写到一半”的crash窗口。初装和恢复共用此发布逻辑。异常不删除原有leaf；原有未知/坏内容不靠“修复”晋升。测试使用复制到测试专用目录的真实官方资源，不更改已交付资源或用户配置；断言restore缺manifest拒绝且无写入，显式prepare成功、零网络、路径为最终leaf，损坏/符号链接manifest与不完整leaf仍拒绝。

### Kimi delta 验证结果与source hashes

- bootstrap现在返回实际local const `modelId`，与wire model分开；readCurrentModel仍返回identity。新增测试用configuration ID `p3-explicit-selection`、wire `deepseek-v4-flash-vision-exp`断言，避免同字符串假阳性。
- 红测 `.artifacts/assistant-analysis-kimi-delta-red.log`：6项中2断言失败、4通过，分别为缺manifest显式恢复和缺modelId返回值。
- 绿测 `.artifacts/assistant-analysis-kimi-delta-green.log`：完整3文件31项通过、0跳过；真实官方资源复制到独立测试目录，缺manifest的restore无写入/无网络，prepare完整重验校准后恢复，再restore通过；损坏manifest、symlink和不完整leaf均拒绝。没有改已交付资源、用户配置或调用真实模型。
- 治理 `.artifacts/assistant-analysis-kimi-delta-governance.log`：exit0，零新增违规。
- main build `.artifacts/assistant-analysis-kimi-delta-build.log`：exit2，共享 `desktop/electron/desktop-services.ts:8179` TS2322（ModelInvocationOptions不接受maxOutputTokens），没有本轮owned文件错误；未修改该共享文件。此次不能沿用前轮build通过结论。
- 本轮自有测试/build进程均已结束，测试专用复制目录已由afterEach清理。

供主线程delta复核的固定SHA256：
- desktop/electron/assistant-analysis-provider.ts：`f6950b63b648a35c37a7f521c42090aa8ca5ae4f5ee4064600eb55a2c7edf375`
- desktop/electron/assistant-analysis-resources.ts：`8e46e1cb13cd9c9e9693b8439276195e04c9550434535a861d9cc057ac6ede49`
- desktop/tests/main/assistant-analysis-provider-counter.test.ts：`049410334db4cd15fb94bc94caa2a0c399e04ed2cec2d01e508ccdba0a94dcc5`

这些变更等待主线程Kimi delta审，不把本轮自审/本地测试等同独立安全评审通过。原来“已有资源损坏不修复”的约束现在仅加一条明确用户prepare的ENOENT manifest恢复例外；已有任何manifest均不覆盖，startup restore仍无写入。

## 独立 Kimi 最终 scoped delta（含主线程 settings identity 修复）

编码模型Codex GPT-6；独立评审Kimi CLI 2.2.0 / kimi-code/k3，使用既有managed:kimi-code配置，未打印/发送用户配置、密钥或数据，未调用产品推理模型，未修改main。评审纯静态，Kimi没有自行执行测试。

主评审APPROVE、无P0/P1；确认bootstrap返回configuration modelId，settings按modelId/revision/current identity与pinned identity比较、异常清除不隐式复活，显式prepare的ENOENT manifest恢复完整重验和校准后从最终leaf原子发布，restore只读。主票冻结期间发生两个预期CI测试变更及摘录中无关dialog文案变化，故原票标记appliesToCurrentSnapshot=false，未冒充当前批准。随后独立CI delta复核Windows junction/dir、真实counter supported-platform gate、精确main settings composition；APPROVE、sourceDrift=[]。最终汇总再核对全部生产/test哈希和精确摘录，结论APPROVE。

证据目录：reviews/artifacts/assistant-analysis-kimi-delta-20261101/。manifest.json/verdict.json为主票，ci-delta/manifest.json/verdict.json为补充票；final-manifest.json和final-verdict.json为最终交付入口。两轮原始output.jsonl、stderr.log、prompt/bundle、run.json（runnerPid/pid/pgid及reaped=true）均保留，两轮退出0，自有评审进程已回收。

最新本地验证33通过/0跳过（含真实offline counter与settings），.artifacts/assistant-analysis-ci-junction-tests.log；main build exit0，.artifacts/assistant-analysis-review-current-build.log，取代上一轮共享类型错误阻塞状态；治理exit0、零新增违规，.artifacts/assistant-analysis-review-final-governance.log。Windows目录symlink测试改为显式junction（其它平台dir），基本拒绝/无网络测试未跳过；真实counter仅在显式配置资源且macOS arm64时执行。未声称本机执行过Windows CI。

保留三项P2，不是零发现批准：settings.prepare catch把所有失败归resources_unavailable；settings.current catch把store/transport异常也归config_changed；link成功到unlink前crash可能留下无害.manifest临时文件。未照抄按通配符清理同uid文件的建议，避免在本次审查任务中另引入未经评审的清理变更。root跨重启环境key身份仍为主线程grant层的明确待办，Kimi作为更大范围限制记录，并未宣称修复。
