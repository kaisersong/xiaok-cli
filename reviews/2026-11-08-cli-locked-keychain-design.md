# CLI 启动不依赖钥匙串解锁

症状：1.6.2 chat 初始化调用 loadConfig，完整 hydrate 全部 keyring 引用，任何锁定即 fatal；另有 getDevAppIdentity 的重复 strict read。

方案：保留 strict read/save/worker。增加只读公开配置快照，启动不 hydrate、不迁移、不写盘。绑定快照 digest；只有选中 provider transport 真正创建网络客户端时解析其 API key 和敏感 headers，环境 key 可以替代 API key。每次解析前后核对 digest，避免旧 endpoint 使用新 key；完整性错误继续拒绝。legacy 明文在首次使用时走现有加锁迁移，不作明文回退。

适配器保持原 concrete 实例、harness identity、capabilities/preview/clone；客户端创建延迟，失败不缓存以便解锁后重试。CLI 的开发者身份不在启动阶段解密。显式 observation policy 保持 strict，因为其授权需要凭证信息。

只读快照不直接 save。generic saveConfig 在无 strict receipt 时不得省略已有受保护字段（覆盖 spread/JSON/structuredClone）；模型切换提供版本绑定且只改公开模型字段的 semantic mutation，保留原 refs。原有 strict 完整快照可显式删 key。

对抗审（gpt-6-astra）：有条件通过；必须覆盖 partial clone 删除、provider headers 丢失、env key 被无关 key 阻断、endpoint/key 混版本、首次 login 误触、锁定后恢复以及 concrete harness/clone。设计细化为原 adapter 内延迟 client 创建，避免 wrapper 破坏 WeakMap 所有权。

回归先于 production：公开读取不调用 backend；本地 CLI help/settings 可用且无登录；模型首次使用失败仅限本轮、无请求；解锁重试；选中 provider/env/header；损坏/错绑/digest 变更拒绝；partial 四种 clone 保存拒绝且原字节不变；模型选择保 refs；strict 删除/迁移/CAS 保持。构建与治理检查后，在本机真实锁定 profile 验证启动。测试仅清理本任务 PID。

## 实现复核与验证

编码：Codex；独立安全评审：gpt-6-astra。设计审通过后先新增失败回归再实现。评审关闭：不完整快照的空串/null 删除、schema2 明文重写、缺失配置的模型切换、首次登录旧快照、Kimi headers 覆盖、欢迎页误提示。

最终 10 个相关源码文件组合 SHA-256：`b07657b6d41179a47f58ff7f30c1cc190293707565ec203731861292a40098be`。评审结论：无剩余 P1 blocker。独立执行 protected-json/runtime-config/login-bootstrap 42/42；三种真实 adapter 在首次成功后撤销凭证均拒绝第二请求，计数保持 1，并验证 Kimi Anthropic 自定义 headers。

本任务执行：

- `npx vitest run tests/ai/models.test.ts tests/ai/adapters/claude.test.ts tests/ai/adapters/openai.test.ts tests/ai/adapters/openai-responses.test.ts tests/ai/adapters/openai-responses-native.test.ts tests/ai/runtime/model-harness-identity.test.ts tests/ai/agents/subagent-executor.test.ts tests/commands/chat-login-bootstrap.test.ts tests/utils/runtime-config.test.ts tests/utils/protected-json.test.ts tests/utils/config.test.ts --reporter=dot`：395/395 通过。
- `npx vitest run tests/commands/chat-interactive-runtime.test.ts -t 'keeps local chat commands available|sets permission mode through|preserves history across repeated' --reporter=dot`：4 通过，68 未选择。
- `npm run build`、`npx tsc`、`npx tsc -p tsconfig.tests.json`：通过。
- `npm run governance:check`、`npm run architecture:check -- --changed`：通过，0 新违规。
- `npm run test:sandbox:build`：prepare:types 以 `sqlite-types: symlink-component` 退出（隔离 worktree 复用 node_modules 符号链接）；随后直接完整 tests tsc 已通过，未声称 sandbox 流程通过。
- `chat.test.ts` 的既有 K3 crash-report 源码字符串断言失败；主 checkout 同一断言独立复现，非本改动引入，其余 40 项通过。未改断言或产品逻辑掩盖存量失败。

本机安装为 1.6.2 的局部补丁，不发布 npm、不改 CLI symlink、不把 worktree npm link 到全局。只替换本轮 17 个 JS/声明文件，先备份再核对 before/after SHA-256。补丁、逐文件备份、终端脚本和原始证据保留在任务 artifacts 中。终端验收仅读取真实配置的隔离副本，启用 file memory、关闭后台自动任务，未发送外部模型请求。Windows 实机与完整发行包未验收。
