# 2026 模型目录独立评审

日期：2026-11-03。评审模型：gpt-6-astra（调度记录）；目录、迁移及推荐实现：root Codex。

范围：registry、legacy-models、normalize、CLI 目录消费路径、Desktop 推荐 helper 及其调用方。签名实现由本席编写，明确不纳入本席独立批准范围；root Codex 对签名实现另行评审。

## 审查发现

P1，已关闭：推荐 loader 曾使用错误的 main snapshot 字段。`desktop/renderer/src/lib/model-recommendations.ts:18` 曾将 `snapshot.providers` 传给目录 helper；`desktop/electron/desktop-services.ts:5257` 的 providers 是已保存的连接列表，不含默认型号及可选目录，真正目录在 `providerProfiles`。这会使推荐集合包含 undefined，自动推荐全部落空。原测试手工构造正确 profile 输入，未覆盖 loader，不能发现该问题。

最终复核已确认 loader 改读 `snapshot.providerProfiles`；新增 loader 回归采用 main snapshot 的真实字段形状，同时放入旧 gpt-4o 已配置模型和当前官方 providerProfiles，断言只推荐 gpt-5.5。另有读取失败返回空集合的回归，保证不会再自动选任意外部旧型号。

## 已核对的兼容边界

- 支持年为显式 2026，目录条目与默认值写明 releaseYear；运行时不按系统日期自动禁止模型。当前保留同年多个代际，未将“仅今年”偷换为“仅最新版”。
- 旧目录元数据封装在独立 legacy-models 模块；getProviderProfile/listProviderProfiles 不返回兼容表，resolveProviderModelVariant/findCatalogModel 在当前目录未命中时按 wire 查询兼容表。
- schema-v1 OpenAI 隐式默认固定 gpt-4o；Gemini 隐式默认固定 gemini-2.5-pro 和既有 openai_responses 协议。所有 first-party 显式旧 wire 查询自己的元数据，避免继承新默认模型的窗口和能力。
- schema-v2 读入仍复制既有 provider/model 配置；CLI buildModelOptions 先列已配置模型，再列当前目录，因此已有旧模型和自定义模型仍可选择。
- control-plane 与 adapter clone 的 first-party gate 保留，custom provider 不因撞名继承官方兼容元数据。新建 Gemini 使用官方 OpenAI legacy endpoint；旧 Gemini 协议继续保留，不把此兼容策略说成修复旧 transport。
- Desktop onboarding 去掉旧推荐 pattern 与任意前两项 fallback；两处批量导入自动启用从旧 gpt-4o-mini 模式转为当前官方集合，外部渠道的手工选择继续允许。

## 证据与限制

本次为源码独立评审；本席未独立重跑目录测试、Desktop 构建、类型检查或治理，主流程另行保存命令与日志。厂商发布日期以主流程在设计文档中记录的官方核实依据为准，本席未逐项联网复验。既有 DeepSeek 测试失败仅获主流程转引，未在此报告认定为独立验证结果。

最终结论：目录、迁移与推荐范围静态评审通过，无剩余阻断项。签名实现不由本席自审批准；root 已另行通知完成独立阅读签名 diff 和针对测试，认为精确 endpoint、source wire gate、opaque schema、visible projection 与存档回放无阻断。该签名结论为 root 的独立评审记录，完整测试与构建结果仍由主流程归档。

## 叠放分支最终差异复核

已只读复核提交 `917f3c5e79d6688912407e76106e2da0f310a4c3` 相对 K2.8 基线 `ab599da8` 的冲突解决及关联测试，结论通过。normalize 同时保留 K2.8 的 `isKimiCodingRuntimeModel` 元数据门禁、所有 first-party 按 wire 查兼容元数据，以及 Gemini 历史默认/协议；registry 的 K2.8 条目保留标签、图片能力、1M 窗口和 low/high/max，仅补 releaseYear=2026。K2.8 的独立严格 allowlist 未扩大，既有 generic/durable 兼容测试及保存 256K 优先断言保留；normalize 的 K2.8 1M/high 断言与当前年份目录测试也均保留。本席未重跑叠放后的测试，完整 HEAD 验证由主流程执行并归档。
