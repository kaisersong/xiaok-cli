# Kimi K2.8 Preview 支持

官方依据（2026-11-03）：https://www.kimi.com/code/docs/en/kimi-code/models.html
K2.8 Preview 的 wire ID 仍是 `kimi-for-coding`，窗口 1,048,576，支持图片、工具和 low/high/max 思考强度。

设计：更新现有目录项，不创造 kimi-k2.8 wire，不更换默认 K3。默认 high 遵循 model-effort-policy.md 中的中档策略；显式保存的窗口与强度优先。旧 schema-v1 的未指定模型继续使用 kimi-for-coding，但随官方别名升级获得 K2.8 元数据，不写回磁盘。
独立对抗评审发现：共享 strict wire 表还控制 durable resume，直接加入 K2.8 会拒绝含 assistant 的存量会话，setAdapter 的迁移检查不覆盖冷启动恢复（P1）。采纳评审：保留 K2.8 的 generic harness、授权和存储路径，仅新增 runtime 元数据 predicate，复用既有 generic reasoning_content、工具、图片与思考强度传参。custom/proxy 不继承官方思考档位。

评审模型：gpt-6-astra；编码模型：Codex 当前会话。先红回归已复现目录、请求能力缺失。修正设计后测试生产 binding、实际 request、legacy durable resume gate 和 Desktop 保存/读回。最终评审与验证结果待填。

## 验证结果

原始日志保存在 `/tmp/kimi-k28-*.log`。本次未调用真实厂商 API、未安装或发布。

- 初始新增集成测试在旧实现失败，确认缺失目录与请求能力（`kimi-k28-red.log`）。
- `npm run test:sandbox:build`：通过。
- `npm run test:sandbox:run -- .test-dist/tests/ai/providers/{kimi-k28,kimi-k31,registry,normalize,control-plane,model-runtime-options,model-reasoning-effort}.test.js .test-dist/tests/ai/adapters/openai.test.js .test-dist/tests/ai/runtime/session-store.test.js`：9 文件 399 通过（`kimi-k28-green.log`）。K28 12 项含三档真实请求参数、图片/工具/思考回放、配置不变、旧窗口/显式强度、旧durable gate兼容和unsupported effort空数组。
- `npm run test:sandbox:run -- .test-dist/tests/ui/model-selector.test.js .test-dist/tests/commands/config.test.js`：91 通过、2 失败（`kimi-k28-extra.log`）。两条均断言旧 DeepSeek Vision Exp 名称；用未修改的 origin/master（50533d61）在 `/tmp/xiaok-kimi-k28-baseline` 跑原始两个suite，同样91通过2失败（`kimi-k28-baseline.log`），没有修改无关断言。
- Desktop：`npm run test -- --run tests/main/desktop-services.test.ts -t 'catalog capabilities and native runtime choices'`：3 通过、191 未选中（`kimi-k28-desktop.log`）。
- `npm run build:release`、Desktop `npm run build:main`：通过（`kimi-k28-cli-build.log`、`kimi-k28-desktop-build.log`）。本worktree编译产物已清除，未改本机安装入口。
- `npm run governance:check` 和 `npm run architecture:check -- --changed`：通过、0 新违规（`kimi-k28-governance.log`、`kimi-k28-architecture.log`）。
- hygiene 开工已跑，因原checkout已有分支落后，以及intent-broker既有未提交/落后远端而非绿；保留既有改动。
- 没有手动启动常驻服务；测试由runner退出，未留下本任务常驻进程。

本次是模型能力更新，无新增缺陷复盘经验；已有“元数据按实际wire解析”和“先核对真实结果”规则覆盖。
