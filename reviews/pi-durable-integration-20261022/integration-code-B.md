# B席：#73 主干集成代码独立复审

2026-10-22。**APPROVE 当前审阅的集成代码**；不是全量测试、PR整体质量或发布放行票。既有2026-10-21票归档未修改，本票另立。

## 对象与证据

集成目标master `3b4061489a612337fdb2fc1eb92e96c1d4fbe9a1`，PR74旧head `292936ce80da8b5acb7b8dbb254e91dd788beb3c`。本轮审阅实际merge后的工作树，不能用旧HEAD替代新源码。集成plan SHA256：`df2104aad91d86ab0ce4e85fb0d01b5381ca71f12c8103bcf6c016a393908215`。

已读冲突stage2/3、实际CompactRunner实解、相对master adapter/disclosure/StreamOptions差异、semantic owner/attempt/ledger/executor/deletion census真实调用链，新增prepare/run clone及实际OpenAI preview→SDK body测试、远端semantic红/绿日志与runner JSON。

关键当前文件SHA256：

```json
{
  "src/ai/runtime/compact-runner.ts": "523c5b7762507acf16dd1ae3127880875f11f1a949c83233f28b7a01d9ec5a1e",
  "src/ai/runtime/compaction-response.ts": "3de449b53918a06f1a4273f16bbe9417518c28d5e007f084c9c4055c2fe9723b",
  "src/runtime/sol-pi/semantic-compaction-owner.ts": "afab32ff721459c49e9b7ff85be50f9df9ebab5b321b5b02958d04bba7a6d5ea",
  "src/ai/runtime/portable-compaction-executor.ts": "209bc96a8a89cb6d88bf2c16f823579acd82cfb69ffa1a26d6de796c89c56d50",
  "src/ai/runtime/session-store/compound-deletion-census.ts": "ebecf259c08658621393baeeb77208d589fe6394670f7a64042b6c0f9656b02f",
  "tests/ai/runtime/compact-runner.test.ts": "9e37b69c030bc9b0708ceb655a0eb03ab63a1cce53adc2a189ee20c5ed1ea070",
  "tests/ai/runtime/compaction-completion.test.ts": "a925a4ad5affb158be3af668aae7f1c9c480747876de5e6711a3a885f719f6e0",
  "tests/runtime/sol-pi/semantic-product-runtime.test.ts": "4b5c5a5282b3c5475acc48d341b32b10e27658727c80814a8470f894606c2587"
}
```

## 审查结论

1. CompactRunner保留master `prepareRequest` 的defensive clone和实际planning接口，run从prepared.messages/systemPrompt发送；同时保留PR74 collector、requireCompleteResponse及原signal。原options浅拷贝保留disclosure/semantic attempt的opaque引用，flag不进provider body；新增实际OpenAI body对照不是测试重写builder。
2. semantic失败不落入普通CLI deterministic fallback；语义专属apply先由master持久owner完成CAS/anchors验证后安装。普通CLI threshold保留原fallback，取消在collector/executor边界仍优先，晚usage/错误不因done提前返回被吞。
3. 本席最初建议empty可以改unknown只调测试，**该建议错误，已撤回**。亲读并实跑真实 `holdCompoundDeletionCensus`：同一合法ledger settled允许census，unknown抛`session_delete_semantic_unsettled`。因此改变empty持久状态会新增删除阻断，settled也不等于摘要安装成功。
4. 当前owner仅在非取消catch对 `instanceof CompactionResponseError && reason==='empty'` 记settled，随后仍抛原错误。该typed empty来自collector完整排干、终态/工具/late content检查及signal检查后；恢复“已结束但无可用摘要”的master结算事实，不把无效摘要安装成功。其他不完整/迟到失败仍unknown、不退款、不重放；persistenceFailed传播和lease最终drain保留。
5. 旧empty→settled断言保留；新增实际生产semantic链断言失败结果、无commit/安装、真实删除census允许，其他失败unknown仍拒绝删除、budget ledger保留、下一invocation预算耗尽且不再发摘要。没有把测试改成接受两种状态，也没有放宽recipe或扩时。

## 远端原始证据

`remote-semantic-red.log/json`：受控HTTPS、实际SDK/builder/注册recipe/持久CAS的生产链；名称筛选8例，唯一empty失败为unknown!=settled，7通过、9项被名称过滤。exit1；runnerPid40470、child/PGID40473、reaped=true。没有将过滤跳过说成资格通过。

`remote-semantic-green.log/json`：同一远端隔离根，argv使用`./node24`，全17项均通过、无skip、exit0；runnerPid83126、child/PGID83127、reaped=true。包括empty、截断、缺终态、late-error、tool-response、revoke、settlement/commit failure及原成功/compound等路径。当前owner/test SHA与该轮交付冻结值相同，本席检查日志而非冒充亲自在远端运行。

据此关闭本轮empty结算兼容阻断；无剩余代码必改项。

## 完备测试与范围限制

本机Desktop全量仍有失败，本席正按指定runner在同master detached基线重跑5个文件；**该基线尚未完成时不将失败全部归因、不宣称全绿**。host/store未改本身不是既有故障证据，后续须逐名/原错误/数量比对。不得通过adopt共享4400 KSwarm、修改配置/资格、扩时、削断言或更新baseline刷绿。

P2缓存、完整预算门、P3新store故障协议不因合并master获得本批额外授权；P3既有审计缺口未在本批修复。此票不代替Windows/macOS完整CI、安装包/ASAR、真实provider/日用入口验证。

本席只读源码；仅创建本轮独立评审交付文件，不修改产品、测试、共享依赖、配置、服务或既有票。
