# Kimi K2.8 独立对抗性评审

日期：2026-11-03。评审席：`kimi_k28_review`；模型：`gpt-6-astra`（主流程确认由 spawn 参数显式指定，身份依据为调度记录）。本席未调用外部模型，未修改 production code。

结论：修订后的最小兼容方案静态审查通过，未发现阻断缺陷。测试执行结果由主流程另行记录，本席未运行测试、构建或真实厂商请求；官方规格为主流程提供的已核实依据，本席未独立联网复核。

## 已关闭的设计风险

原方案将 `kimi-for-coding` 加入严格 wire allowlist，会改变既有历史恢复行为。`src/ai/runtime/session-store/store.ts:112` 和 `:135` 按 wire 判定，只要存在 assistant 消息就拒绝 durable resume；`src/ai/runtime/agent-runtime.ts:149` 的 `setAdapter` 合成迁移仅覆盖进程内切换，不能据此宣称升级后的冷启动存档迁移已覆盖。

最终方案保留严格 allowlist、harness profile、rollback 和 durable gates，仅新增 `isKimiCodingRuntimeModel` 用于目录元数据。`kimi-for-coding` 保持 generic transport，因而本次不引入上述历史恢复回归，也不授予 custom/proxy 严格身份。

## 核对范围与依据

- `registry.ts` 保留 wire `kimi-for-coding` 及既有默认 K3；只更新 K2.8 标签、图片能力、1,048,576 默认窗口、high 默认强度和 low/high/max 限制。
- `control-plane.ts:67`、`normalize.ts:84`、CLI config/chat 与 Desktop 的目录筛选同步使用新的 runtime predicate；显式 runtime options 继续在 catalog 之后覆盖。
- `model-runtime-options.ts` 保持不变，K28 正常绑定依靠自身 catalog 获取 1M，不依赖 K3 fallback。
- `openai.ts:869` 的 generic 分支已回放 `reasoning_content`；`:980` 通过实际身份和目录计算支持的 effort，独立于 strict profile。`model-reasoning-effort.ts:29` 限制 first_party、OpenAI legacy 与官方 endpoint，custom、其他协议及代理不获得官方 effort。
- 新测试调用实际 binding、harness、durable guard 和 Desktop provider conversation 入口，SDK 请求端仅用 stub 截获请求。Desktop service 测试扩展至 K28 并验证保存和更新窗口/强度。

## 测试建议已覆盖

已再次读取最终 `tests/ai/providers/kimi-k28.test.ts`：unsupported identity 用例新增 `getSupportedModelReasoningEfforts` 空数组断言；实际 SDK 请求用例参数化 low/high/max，并断言对应的 wire 字段，同时保留图片、工具历史和 reasoning_content 断言。两项建议均已落实到生产入口回归，虚构的严格 profile 测试变量也已删除。

主流程报告上述测试已通过；本席未亲自运行或读取原始执行日志，因此不在本报告复述测试数量、构建状态或基线失败统计。完整执行证据由主流程记录。本次源码审查无剩余阻断项。

本席未启动后台测试进程，需回收数量为 0。评审只写入本文件，保留其余协作者改动。
