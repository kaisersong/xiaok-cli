# Assistant analysis provider：实现、接线与证据

作者 Codex（GPT-6）。已完成独立 Kimi CLI kimi-code/k3 静态主评审及CI补充delta，scoped结论APPROVE；最终记录见文末，历史待审指先前阶段。已实现真实 provider、专用资源 prepare/restore，供主线程独立显式模型选择接线，不再是初版始终拒绝的 gate。没有真实外部模型调用，没有改用户配置或全局 Python。


文档索引：[资源与安全解压](assistant-analysis-resources.md)、[验证证据](assistant-analysis-verification.md)、[独立评审历史](assistant-analysis-review-history.md)、[有效模型身份与持久撤销修复](assistant-model-identity-revocation.md)。历史评审中未完成的环境身份项正由后一修复闭合；不要把旧票当作新增identity改动的批准。

## 主线程 API（按最终归属更新）

本任务只交付 provider factory/resources/newtests；曾新增的 selection service 及其专属测试已按主线程要求删除。模型选择持久化/UI/IPC归主线程的 assistant-analysis-settings.ts 和 shared contract，不在这里重复实现。

```ts
// 同步配置兼容检查，无默认fallback，无资源准备。
checkDesktopAssistantAnalysisProviderSupport(config, modelId)
// {supported:true, provider, model, modelId} | {supported:false, reason}

const resources = await prepareAssistantAnalysisResources({dataRoot, pythonCommand, signal?});
// 仅明确用户按钮触发；下载/验hash/安全解压/正式counter校验。
const reused = await restoreAssistantAnalysisResources({dataRoot, pythonCommand, signal?});
// 启动恢复：只验证已有资源；不下载、不创建、不改配置。

const result = await bootstrapDesktopAssistantAnalysisProvider({
  modelId, // 必填，明确选择；不拿全局默认fallback
  dataRoot: resources.dataRoot, // 返回的叶目录，不是main传给prepare的父目录
  pythonExecutable: resources.pythonExecutable,
});
```

bootstrap 返回 `{port, identity, readCurrentModel, contractHash, counterManifestSha256}`。主线程 LoopStore settings在prepare/bootstrap成功后保存modelId，恢复时先restore。没有选择或当前模型不支持，展示unavailable；不要自动扫描另一个可用模型。主线程先调用同步support检查，拒绝不支持模型后才准备资源。

资源API的dataRoot是已存在的main-owned父目录；仅写入其 assistant-analysis-provider/recipe-0.1.1 子目录。支持macOS arm64，其余unsupported。bootstrap的dataRoot则是该资源叶目录。路径/命令仅main内部，不能从IPC接收任意filepath/command。

Python优先使用既有getManagedPythonCommand()在managed runtime完成初始化后返回的值；早期还没有Python时保持unavailable并在初始化完成后恢复，不把cwd当解释器路径。也可以主线程传既有resolvePythonCommand()返回的python3名称或绝对路径。资源helper对简单命令名只做PATH文件查找并realpath，不走shell、不解析参数；返回实际绝对pythonExecutable。需要已有Python>=3.10，不自动安装Python、不执行pip、不写其global site-packages。本机系统/usr/bin/python3为3.9.6，不能作为已验证runtime；3.11已通过，用户指定的3.13另有验证日志。

核心factory `createDesktopAssistantAnalysisProvider({config,modelId,counter,timeoutMs?})`仍可用于main已持有正式opaque FrozenDeepSeekCounter的场景；不能注入arbitrary callback/test counter。正常bootstrap使用现有inspect/freeze从真实固定config reader+本地正式资源构造。

port.measureInput为Promise<number>；analysis-port.ts按用户授权升级为number|Promise<number>，主线程runtime必须await。complete沿用共享参数/返回类型。底层现有recipe校验/计数仍同步执行，async API不代表已移入worker；本轮不宣称主线程计数性能优化。

## contract 与实时 identity

主线程直接使用返回的 `identity/readCurrentModel`，来源是 root-owned `readAssistantModelConfiguration()`；本模块不重复生成 modelEpoch/configFingerprint。reader 同步重新读实际配置，并私下比较 resolveRuntimeModelBinding 后的完整实际 binding，包括环境变量解析后的凭据/headers；变化即拒绝，原文/密钥/密钥hash不输出。guarded port 在测量及调用前后检查 identity 和 binding；配置、key、model 漂移不能继续发布旧结果。

核心 contract.id 为 `assistant-analysis-v1:` + SHA256(JSON.stringify({provider,model:wireModel,modelId,protocol,destination,tokenizer,thinking:'disabled'}))，字段顺序见源码。bootstrap 的最终 contract.id 再绑定 manifest：同前缀 + SHA256(JSON.stringify({contract:核心contract,counterManifestSha256}))。`contractHash` = SHA256(JSON.stringify(最终contract))。主线程保存返回值，不硬编码本轮 hash，不自己拼接猜测。quality context 的 analysisContract 使用最终 `port.contract.id`；modelEpoch/configFingerprint 使用返回 identity。

root reader 负责持久配置身份；本模块额外的 binding 比较解决环境凭据变化而文件字节不变的拒绝。不同资源叶目录/解释器导致完整 manifest 改变，因此最终 contract.id/hash 也改变，必须重新质量资格化。

## 真实支持范围与官方依据

仅 DeepSeek first_party + openai_legacy，官方 `https://api.deepseek.com` 或 `/v1`，明确配置的 `deepseek-flash`、`deepseek-v4-flash`、`deepseek-v4-flash-vision-exp`。后两者来自官方明确的同模型映射，实际请求保持原 wire model，只在本地 recipe 转换时将 model 字段映射到 canonical deepseek-flash。只允许文本、空 tools、thinking disabled、输出 1..8192 tokens。

本机只读探测：当前默认 custom spark-c294 / qwen3.8-flash-next 不支持；deepseek-default / deepseek-v4-pro 不支持；已有 deepseek-v4-flash-vision-exp 可显式选择。旧 expires 别名、GLM/智谱、自定义兼容端点、Anthropic 目前拒绝。没有打印 credentials 或完整配置，也没有自动改用其它模型。

本轮仅取官方来源：
- https://api-docs.deepseek.com/quick_start/pricing/ ：deepseek-flash 为 V4.1 Flash 1017；两个旧 V4 Flash 名称由同一模型服务。
- https://api-docs.deepseek.com/api/create-chat-completion/ ：max_tokens、thinking disabled、finish_reason、usage。
- https://github.com/deepseek-ai/deepseek-recipe/tree/8cadfede7063c896b944e7bae05daa3549ae97ea ：固定官方整请求转换/模板/分词源码。
- https://github.com/deepseek-ai/deepseek-recipe/blob/main/docs/tokenizer.md ：包含模板控制 token 的完整 render/encode；特殊 token 字面文本与实际协议 token 有不同处理。
- https://platform.claude.com/docs/en/build-with-claude/token-counting ：Anthropic count_tokens 是 estimate，含系统优化额外 tokens，未给有限误差上界；不能设置精确 protocolOverheadMeasured。

复用现有 `deepseek-capacity-profile.ts` 和 `capacity-admission.ts` 的 official-deepseek-recipe 资格，不把字符/4、任意 callback 或 context 窗口当计数器。计数对象是 adapter preview 的完整实际请求，包括 system/user/模板协议；实际 SDK body 必须逐字等于 preview。实际 usage 超过测量/输出限额抛 `ASSISTANT_ANALYSIS_PROVIDER_CONTRACT_BREACH` 并携带安全的数值 usage；主线程必须记录更高 actual、禁用该 contract，不退款或重试。本轮真实离线 fixture 只证明固定官方 recipe 路径可运行，不是线上任意隐藏变换的数学证明，未执行真实服务兼容性采样。

## 调用、授权、finish、usage、abort 与 no retry

只从既有 `createAdapterFromBinding` 构造独占 adapter，继续走 `streamStatelessSideCallProviderConversation`。不另建 SDK，不 raw fetch 模型，不绕 Kimi conversation authorization，不复用其它业务 grant。generic DeepSeek 是现有 authorization 的正常分支；Kimi 本轮不支持。

对独占 SDK client 使用 withOptions(maxRetries:0)，拦截该实例现有 create 调用验证完整 body，并缓冲原生 chunks；异常先 abort 传给现有 adapter 的 signal，再抛安全错误，从而禁止应用层重试。第二次 create 拒绝。没有修改共享 root provider adapters。缓冲上限 4MiB；请求 preview 上限 1MiB；owner timeout 默认30秒。

原生 stop 才 complete，length 为 truncated；工具/拒绝/推理/非允许的响应模型/缺失原生 terminal 失败关闭。完整读取 SDK 流，避免既有 adapter 在 finish_reason 返回而漏掉单独的最终 usage。只使用 terminal 后且完整流 drain 的原生 final usage；不读 adapter 的 fallback estimate，不累加累计快照，不重复加缓存/推理。缺失/非法 usage 为 unknown。超时/用户取消不发布文本，分别 timeout/cancelled；中途失败的 usage 不冒充最终 usage。attempt ID 在发送前消耗，同实例失败后不能重放；主线程 durable ledger 仍必须防跨重启/跨实例重放。

错误只带固定本地 code、允许的数字 HTTP status；不带 provider 原文、headers、prompt、key 或 cause。quota/402/429/5xx/断流均不重试。未知 usage、发送后失败保持最坏预算。主线程仍拥有 reserve/sent/settle、质量/权限/scope 门禁和独立通知 owner。

## 专用资源与安全解压

本节完整记录见 [assistant-analysis-resources.md](assistant-analysis-resources.md)。

## 设计自审与验证记录

本节完整记录见 [assistant-analysis-verification.md](assistant-analysis-verification.md)。

## 最终范围与交付证据

本节完整记录见 [assistant-analysis-verification.md](assistant-analysis-verification.md)。

## Kimi delta：selected modelId 与缺 manifest 的 crash 恢复（实现前设计/自审）

本节完整记录见 [assistant-analysis-review-history.md](assistant-analysis-review-history.md)。

## 独立 Kimi 最终 scoped delta（含主线程 settings identity 修复）

本节完整记录见 [assistant-analysis-review-history.md](assistant-analysis-review-history.md)。
