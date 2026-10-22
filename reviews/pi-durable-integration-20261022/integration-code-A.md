# A 席：PR73/PR74 实际集成代码复审

结论：**APPROVE** 本文件列明的 CompactRunner 集成与 semantic empty 窄修订。此前 semantic 空白持久化状态阻断正式关闭；本票不把尚在进行的全量验证或未提交完整 HEAD 提前记为通过。

集成双方：PR74 旧 HEAD `292936ce80da8b5acb7b8dbb254e91dd788beb3c`；已合并 master `3b4061489a612337fdb2fc1eb92e96c1d4fbe9a1`。

## 实际代码与边界核验

- 已读双方 CompactRunner、实际冲突解法、semantic-compaction-owner、semantic-summary-attempt、OpenAI builder/stream 重试和 disclosure/capacity guard 相关路径。最终解法保留 master prepareRequest 与 structuredClone，run 使用 prepared messages/systemPrompt，再接原 collector 和 requireCompleteResponse。
- 内部 flag 不进入 provider body；options 展开保留 signal、providerDisclosure、semanticSummaryAttempt、semanticSummaryOutputTokens。新测试实际比较 adapter request preview 与 SDK 参数，并验证原输入/原 options 不变。
- semantic scope 仍绑定实际 bodyDigest/destination/invocation，single-request transport 和 SDK maxRetries=0、外层 semantic 不重试的原门均未改；当前窄修订没有重新签发能力、退款或增加调用。
- 旧阻断轨迹是完整 stop/EOF 且空白→collector empty→owner 一律 unknown；真实 master 的 deletion census 会对该 unknown 拒绝删除。仅把旧 settled 断言改成 unknown 会掩盖新行为，故本席曾要求保留该断言并修 owner。
- 当前 owner 只在非取消分支遇到内部 CompactionResponseError(reason=empty) 时结算 settled，然后继续抛错。collector 只有完整排干、无其他失败、见终态后才产生 empty；因此这是请求结果已知但无可用摘要，不是安装成功。截断、缺终态、工具、迟到异常仍 unknown；取消 guard 与持久化失败传播保持。
- 已读真实 semantic-product-runtime 场景：保留 empty 原 settled 断言，新增 truncated/missing-terminal/late-error/tool-response，并断言单次实际 HTTPS、max_tokens=128、全额 charge 保留、无 commit、下一 invocation 不重派。空白通过实际 deletion census，unknown 路径仍被 census 拒绝，没有放宽其权限或原断言。

## 原始运行证据核验

本席读取本目录 remote-semantic-red.log/json：真实注册 recipe 下受控 HTTPS 的生产链，8 个选定场景中 1 failed / 7 passed，另 9 个按名称过滤 skip；唯一失败为 empty 的 unknown!=settled。JSON 为 exitCode=1、reaped=true。它不是无资格环境的 skip，也不是重新实现业务逻辑的测试模型。

本席随后读取 remote-semantic-green.log/json：同隔离目录、复制的 `./node24` 执行全 17 场景，**17 passed、0 skipped**，exitCode=0、reaped=true。完整覆盖 success/compound/compound-intent/archived/tool-boundary/named-child/pricing-unavailable/automatic/empty/truncated/missing-terminal/late-error/tool-response/stale/revoke/settlement-failure/commit-failure。没有改 deadline、注册资格或旧断言来换取通过。

这些远端运行由主笔的受控 runner 执行，本席独立检查源码与原始日志/JSON，不冒称亲自执行远端命令。未启动、清理远端进程或修改远端注册环境。

本轮核对 SHA256，与审阅时一致：

```text
afab32ff721459c49e9b7ff85be50f9df9ebab5b321b5b02958d04bba7a6d5ea  src/runtime/sol-pi/semantic-compaction-owner.ts
4b5c5a5282b3c5475acc48d341b32b10e27658727c80814a8470f894606c2587  tests/runtime/sol-pi/semantic-product-runtime.test.ts
523c5b7762507acf16dd1ae3127880875f11f1a949c83233f28b7a01d9ec5a1e  src/ai/runtime/compact-runner.ts
```

当前上述范围无必改项，**APPROVE**。本票不替代最后完整 HEAD 的质量核验；root/Desktop 全量失败须保留真实 baseline 对照和未归因项，不能将基线失败、真实 provider、安装包或父预算/缓存门槛记为已通过。
