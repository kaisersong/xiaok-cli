# DeepSeek 旧 Vision 型号退出可选列表

## 设计

- 官方 Vision 文档确认 `deepseek-flash` 原生支持图片，旧 `deepseek-v4-flash-vision-exp` 已退役并转到最新 Flash：https://api-docs.deepseek.com/guides/vision/ （2026-10-30 核对）。
- 变更前 `src/ai/providers/registry.ts` 的 DeepSeek `availableModels` 展示旧 Vision 型号；Desktop provider profiles 和 CLI selector 均读取此列表。
- 删除该可选条目，保留新版 Flash (1017)。不改用户已保存的配置。
- 旧 Vision wire 仅在 registry 查询时作为兼容别名解析，继承当前 Flash 的图片能力及 1M 窗口，保持原 wire/modelId；不再出现在公开列表。

## 对抗性评审（实现者自审，低风险目录整理）

- 直接删除会使旧配置丢失 catalog 窗口：因此兼容查询必须同时覆盖 `resolveProviderModelVariant` 与 `findCatalogModel`，不能只覆盖新配置。
- 默认模型与可选模型共用 wire，不能造成元数据歧义：沿用默认 Flash 元数据，仅替换旧别名的身份字段。
- custom provider 与官方同名时不能额外获得能力：沿用 control-plane 既有 first-party gate，不更改权限或传输逻辑。
- 选择器仍只能看到公开 availableModels；存量已配置的用户条目不自动删除。

## 独立代码评审

- 编码：Codex（GPT-6 系列）；独立复核：GLM-5.3-Flash，APPROVE，见 `deepseek-vision-glm-code-review.md`。
- DeepSeek 首轮静态评审 BLOCK 原文保留于 `deepseek-vision-code-review-r1.md`，未当作通过。其 custom 越界与 unknown wire 误匹配主张，经 GLM 读取生产调用方和精确 wire 条件后证实不成立；另补 unknown wire 的直接负例断言。
- `control-plane.ts` 与 `cloneWithModel` 保持既有 first-party gate；本轮不修改用户配置、认证或 endpoint。静态目录查询返回公开元数据，不等同于运行时能力授予。

## 回归计划

- 先改现有 registry 测试，要求旧 Vision 不在可选列表，同时查询仍返回原身份、图片能力及 1M 窗口。
- 生产 control-plane 入口验证旧 Vision 配置的 wire、能力和窗口；现有 Flash 视觉测试保持。
- 定向测试、TypeScript 编译、governance 与 architecture changed；不打包、不重启 Desktop。

## 实际验证

- RED：修改测试后运行 registry/control-plane，95 项通过、2 项因旧 Vision 仍在可选列表失败。
- `npm run test:sandbox:build`：通过（编译实际生产源码与测试）。
- `npm run test:sandbox:run -- .test-dist/tests/ai/providers/registry.test.js .test-dist/tests/ai/providers/control-plane.test.js .test-dist/tests/ai/providers/normalize.test.js .test-dist/tests/ai/runtime/model-capabilities.test.js .test-dist/tests/ai/models.test.js`：5 文件、129 项通过。
- `npm run governance:check`、`npm run architecture:check -- --changed`、`git diff --check`：通过，无新增违规，未更新 baseline。
- `npm run hygiene:check`：失败，原因是 intent-broker 已有 tracked 改动与 kai-xiaok-plugins 已有未跟踪报告；保持原状。
- 提交前补 unknown-wire 负例后再次执行同一编译与定向命令，129 项通过；治理、增量架构、diff 检查通过。
- 这五个生产目录/绑定测试文件已加入 `model-recovery.yml`，并补齐 providers/models 的 PR 触发路径；CI 是否通过以实际运行结果为准。
- 本项未进行真实远端图片调用、Desktop 打包或安装验证，按独立 PR 提交，不发布正式版本；未启动后台服务，需回收的自建后台服务数为 0。
