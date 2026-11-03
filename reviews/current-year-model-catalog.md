# 2026 官方模型目录

用户选择：清理目录，旧配置仍可用。此策略针对内置目录、默认值及由其派生的 CLI/Desktop 新建推荐；已保存的模型、自定义模型和外部渠道的手动导入继续可用。

设计：显式维护 MODEL_CATALOG_YEAR=2026 与各可选型号 releaseYear。将2025及以前型号移入仅供wire元数据解析的兼容表，getProviderProfile/listProviderProfiles不展示该表；resolve/find仍查询兼容表。新建OpenAI默认GPT-5.5，Gemini默认3.1 Pro Preview（官方2026-02，1,048,576输入）。旧schema-v1隐式OpenAI/Gemini默认固定历史wire和协议；所有first-party旧wire按自身元数据迁移。2027年通过维护目录升级支持年，运行时不按系统日期突然禁用模型。

对抗性设计评审（gpt-6-astra）：旧v1隐式默认、旧wire元数据串号、Gemini工具签名三项必须解决。Gemini3.x OpenAI兼容需回放extra_content.google.thought_signature，限定同模型/官方Google transport，不泄漏至其他模型。

官方依据：
- https://developers.openai.com/api/docs/changelog （GPT-5.5 2026-04-24）
- https://www.anthropic.com/system-cards （Haiku4.5 2025-10；Opus4.7 2026-04、Opus/Sonnet4.6 2026-02）
- https://ai.google.dev/gemini-api/docs/deprecations （3.1 Pro Preview 2026-02-19）
- https://ai.google.dev/gemini-api/docs/models/gemini-3.1-pro-preview （wire及精确窗口、工具与图片）
- https://ai.google.dev/gemini-api/docs/openai （Chat Completions协议）
- https://z.ai/blog/glm-5 （2026-02-12，4.x为上一代）
- https://z.ai/blog/glm-5.2 （2026-06-16）
- https://z.ai/blog/glm-5.3 （2026-08-14）
- https://z.ai/blog/glm-5.3-flash （2026-08-26）

本次按 K2.8 PR #154 叠放分支，新增PR只审年份清理增量；先合入 #154，再合入本PR。

## 验证与评审

目录/迁移/推荐由 root Codex 实现，gpt-6-astra 独立静态评审；Gemini签名由gpt-6-astra实现，root Codex逐项阅读production diff与16项生产路径回归后评审。两处P1设计风险（旧隐式默认与Gemini签名）和推荐loader字段错误均已修正。不会把他人实施的测试转称自己实测；以下日志来自root本轮实测。

- 新catalog suite先11失败2通过，修复后13通过（`/tmp/model-year-red.log`、`model-year-first-green.log`）。
- `npm run test:sandbox:build`：通过（`/tmp/model-year-test-build.log`）。
- sandbox provider/registry/normalize/control-plane/login/Gemini签名/OpenAI/session-store 8文件384通过（`/tmp/model-year-sandbox.log`）。
- Desktop main model-focused及renderer 23通过（`/tmp/model-year-desktop.log`）；推荐loader补充后renderer独立3通过（`/tmp/model-year-renderer-tests.log`）。
- CLI `npm run build:release`、Desktop `npm run build:main`、`npm run build:renderer`、`npm run typecheck`：通过，renderer有现存大bundle提示（对应`/tmp/model-year-*-build.log`、`model-year-typecheck.log`）。
- `npm run governance:check`、`npm run architecture:check -- --changed`：0新违规（`/tmp/model-year-governance.log`、`model-year-architecture.log`）。
- 扩展config/model-selector 91通过2失败（`/tmp/model-year-extra.log`）；同为DeepSeek旧名称/退役展示断言，前任务在相同干净基线50533d61重测同样91通过2失败（`/tmp/kimi-k28-baseline.log`），本轮未更改该无关断言。
- 首次Desktop测试与CLI build并行触发fixture的输入变化保护（`fresh_protection_worker_input_changed`），构建结束后独立重跑通过；不修改fixture安全门禁。早期治理发现renderer直读registry的层级违规，已改读main既有snapshot后通过。
- 未做真实厂商请求、安装包交互、发布、完整测试套件或合并前独立质量复验。hygiene开工已跑，既有主checkout/sibling改动导致非绿，未动这些改动。
- 测试runner均已退出，没有启动常驻服务；本任务无需清理常驻进程。已有source-backed测试规则覆盖本次复盘经验；新增真实snapshot loader回归作为执行机制。
