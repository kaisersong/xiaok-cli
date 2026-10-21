# pi durable v3 本批实施与验收记录

本批修复压缩摘要的完成边界：截断、过滤、缺终态、工具响应以及迟到异常不再被安装为成功摘要。CLI 使用原确定性 fallback，并先发 `compact_failed`；legacy Desktop 不完整响应拒绝且保留历史。普通聊天不启用新策略。

基线为已合并 master `dc221f9bac84d939b8fb543d4795396693fdc9b8`，独立分支 `feat/pi-durable-optimization-20261021`。不合入 U/C 未合并工作树。父设计与多方评审见 [mydocs PR #8](https://github.com/kaisersong/mydocs/pull/8)；本批冻结补充见 [implementation](pi-durable-optimization-implementation.md)，SHA256 `3d883cdd658bfbfdadac4bea28dc4e0d80e253ae121d8a38ff7f9fc74f3a33f8`。

本记录只声明本批完成，不声明父方案全部完成或 release ready。

## 改动与真实调用边界

- `src/ai/runtime/compact-runner.ts:37` 和 `desktop/electron/context-manager.ts:131` 在原授权 wrapper 内设置内部 `requireCompleteResponse`；不是公开配置或 IPC 字段，不发送给 provider。
- `compaction-response.ts:16` 排干响应后检查 done、正文、工具和 terminal 后内容；迟到原异常保留，取消优先。仅 legacy Desktop 允许完整空白 no-op。
- Claude 要求正常 stop_reason 与 message_stop，任何工具块（含未闭合块）拒绝；OpenAI legacy/strict Kimi 要求 stop 并继续读取 usage trailer，拒绝 length、EOF 及第二终态；Responses 要求 completed、合法正文结构，拒绝工具、拒绝内容和损坏 JSON。Responses 没有 usage 时不伪造零。
- CLI 实际 `AgentRuntime → CompactRunner → ClaudeAdapter` 受控 SDK 截断回归验证：不安装局部摘要，产生 `compact_failed`，原 deterministic fallback 仍成功。
- legacy Desktop 实际 `compactConversation → OpenAIResponsesAdapter` 受控 HTTP 回归验证：畸形工具、损坏 JSON、非数组 output 均拒绝，20 条原历史逐字节不变。
- five wrappers 清单在 `provider-conversation-authorization.ts:74–98`：CLI chat、subagent、compaction、Desktop task、stateless side call。新策略只在上述两条摘要入口启用。
- legacy `compactConversation` 在普通 Desktop 中只有 import（`desktop-services.ts:104`）；当前生产策略在 `desktop-services.ts:7912`、`desktop-managed-agent-session.ts:106` 为 disabled/no-op。其 export 测试不能充作普通 Desktop 用户流程验收。

## 保留的父门槛与审计发现

| 项目 | 本批裁决与证据 |
|---|---|
| 完整 serialized request 预算门 | qualification_unknown。未集成 U 的容量资格契约，默认/名称/catalog/runtimeOptions 来源不能证明 token 上界；未新增容量拒绝器。 |
| 缓存回收 | unknown。实际快照元数据 50 文件、10,936,366 bytes、48 个 session/thread 分组，均 completed；缺实际浏览/多窗口/订阅访问轨迹，无法冻结代表性 workload/holdout，不以合成测试声称 >5% 收益。见 [inventory](pi-durable-evidence/p0-inventory.json)。Host/cache 未改。 |
| P3 存储 | 审计发现缺口：真实 `FileTaskSnapshotStore.getActiveTasks()` 对损坏 active index 返回 `[]`。源头 `snapshot-store.ts:278` 的 catch-all；[探针](pi-durable-evidence/p3-audit.mts)、[输出](pi-durable-evidence/p3-audit.log)。按冻结设计需另案明确损坏/缺失/恢复规则并复审，本批不修改 store 协议。原 checkpoint/journal 故障测试 18 项仍通过。 |
| prompt-cache 请求投影 | 读取 `agent-runtime.ts:239,599` 与 `claude.ts:164,230` 可见摘要请求复用 invocation promptCache，并优先取其 messages/systemPrompt。此既有投影语义未修改；本批真实 runtime 测试按首个 SDK 请求注入截断，不假称已验证模型摘要质量。 |
| Responses 超时 | 既有 timer 在响应 headers 后清理，JSON body 阶段没有新增完整超时边界。本批不声称验证真实网络挂起恢复。 |

## 先红、修复、对抗复审

1. 冻结实施补充在 production code 之前由 A/B/C 三席独立 APPROVE。
2. 旧基线真实 adapter + CompactRunner 回归 **18 failed / 2 passed**：[原始红测](pi-durable-evidence/completion-red-v2.log)。
3. 首轮代码审查 BLOCK：未闭合 Claude tool block 被隐藏、iterator 异常绕过取消优先、Responses 缺 usage 制造零值。补反例后先红：[日志](pi-durable-evidence/review-findings-red.log)（4 failed，其中另一个失败是新 AgentRuntime SDK 夹具的请求识别错误，随后按真实请求顺序修正；不计为产品缺陷）。
4. 下一轮 A 再 BLOCK：Responses 畸形 function_call 在首 chunk 前抛普通错误，导致 Desktop snip。补真实 Desktop+Responses 三项反例 **3 failed / 7 passed**：[日志](pi-durable-evidence/desktop-responses-red.log)，再修 typed 错误分类及 payload 校验。
5. 每条阻断修复后重新独立复核。完整票保留 BLOCK 轨迹，见本目录 evidence 下 A/B/C 代码票；最终三席同意仅本批边界。三席为独立 Codex agent，不充作不同模型的安全评审。

## 实际验证

所有结果来自本机 macOS。本次没有付费模型调用；真实 adapter 的外部 SDK iterator/HTTP 被注入受控响应，授权 wrapper、parser、collector、runtime/历史处理使用生产代码。

| 命令/范围 | Node | 结果与原始输出 |
|---|---|---|
| root 11 个相关 source suites | 22.14.0 | 402/402，[日志](pi-durable-evidence/root-final-node22.log) |
| 同上 | 24.16.0 | 402/402，[日志](pi-durable-evidence/root-final-node24.log) |
| desktop 两个 context/completion suites | 22.14.0 | 51/51，[日志](pi-durable-evidence/desktop-final-node22.log) |
| 同上 | 24.16.0 | 51/51，[日志](pi-durable-evidence/desktop-final-node24.log) |
| `npm run test:sandbox:build` + CI 的 10 个 emitted JS suites | 24.16.0 | 编译通过；384/384，[日志](pi-durable-evidence/ci-command-local.log) |
| `npm run build` | 24.16.0 | exit 0，[日志](pi-durable-evidence/cli-build.log) |
| desktop `npm run build:main` / `npm run typecheck` | 24.16.0 | exit 0；0 diagnostics，[构建](pi-durable-evidence/desktop-main-build.log)、[类型](pi-durable-evidence/desktop-typecheck.log) |
| `npm run governance:check` / `npm run architecture:check -- --changed` | 24.16.0 | exit 0，0 新违规，baseline 未改，[治理](pi-durable-evidence/governance.log)、[增量](pi-durable-evidence/architecture-changed.log) |
| `npm run hygiene:check` | 24.16.0 | exit 1，既有 sibling intent-broker behind 1 / tracked WIP；未修改他人工作，[日志](pi-durable-evidence/hygiene-final.log) |

root source 实际命令（Node 22 使用 `npx --yes --package=node@22.14.0 node` 替换开头 `node`）：

```sh
node node_modules/vitest/vitest.mjs run \
  tests/ai/runtime/compaction-completion.test.ts \
  tests/ai/runtime/compact-runner.test.ts \
  tests/ai/runtime/agent-runtime.test.ts \
  tests/ai/runtime/portable-compaction-executor.test.ts \
  tests/ai/adapters/claude.test.ts \
  tests/ai/adapters/openai-responses.test.ts \
  tests/ai/adapters/openai.test.ts \
  tests/runtime/task-host/snapshot-store.test.ts \
  tests/ai/runtime/model-stream-recovery.test.ts \
  tests/ai/runtime/abort-error-discrimination.test.ts \
  tests/ai/runtime/provider-request-error.test.ts
# 从 desktop/ 执行：
node node_modules/vitest/vitest.mjs run tests/main/context-manager.test.ts tests/main/compaction-completion.test.ts
```

CI 精确 emitted suites 命令见 [workflow](../.github/workflows/model-recovery.yml)。矩阵保留 Linux/macOS/Windows × Node 22.14.0/24，加入实际三 adapter、完整性/fallback 与 Desktop 相关回归。GitHub 结果须在 PR 最终完整 HEAD 上另核，不能用本机通过替代 CI 或安装包验证。

归档日志替换本机路径前缀并清理行尾空白，计数/失败内容未改；原始与归档 SHA 见 [manifest](pi-durable-evidence/log-manifest.json)。源码/测试/CI 的 13 文件完整内容 SHA 见 [快照](pi-durable-evidence/implementation-snapshot.sha256)，快照清单自身 SHA256 `03b892bace079adc838ff406756d46389391d38aa26b7d6f787db3cc92e699e6`。构建产物、build-info 和 Windows native 文件已恢复，不提交。未启动常驻 daemon/开发服务器；全部 owned runner 已退出，遗留后台任务 0。

未跑：真实 provider 计费请求、真实用户日用入口、Windows 安装包/ASAR、打包/签名/发布、缓存 >5% benchmark、P3 新协议验收。PR 不自动合并。
