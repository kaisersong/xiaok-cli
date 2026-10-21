# B席：最终变更后Node22相关回归

日期：2026-10-22。结论：**本次Node22相关回归通过；不是本机全量或发布放行。**

## 对象与执行

工作树 `<worktree>`。当前HEAD `292936ce80da8b5acb7b8dbb254e91dd788beb3c`；按当前工作树源码SHA定位本次执行，不用旧HEAD替代未提交集成实解。关键文件运行前后SHA相同：

```json
{
  "src/ai/runtime/compact-runner.ts": "523c5b7762507acf16dd1ae3127880875f11f1a949c83233f28b7a01d9ec5a1e",
  "src/ai/runtime/compaction-response.ts": "3de449b53918a06f1a4273f16bbe9417518c28d5e007f084c9c4055c2fe9723b",
  "src/ai/adapters/claude.ts": "1e080c1f9e9f616831bc4f6b5996d98320e6cde257eb9120f3d64a371614406c",
  "src/ai/adapters/openai.ts": "edd139d2a76a0ae8fb75fff7400b5ae9d63d192fdd6737568e2a03b497af731b",
  "src/ai/adapters/openai-responses.ts": "92dbc809c41c0566f26fb11f9408057c9b98144c49a18d0b6adc51b792904770",
  "desktop/electron/context-manager.ts": "7cfd48cfd71aa36c09278affe8d3c435f445a500f8541dc89a40cbab5ce0a5f7",
  "src/runtime/sol-pi/semantic-compaction-owner.ts": "afab32ff721459c49e9b7ff85be50f9df9ebab5b321b5b02958d04bba7a6d5ea"
}
```

通过本任务绝对路径owned `run.py`逐条执行。`final-focused-node22` 的cwd和完整argv与首次 `focused-node22.json` **精确一致：true**，未删文件、改过滤、扩timeout或削断言：

```text
npx --yes --package=node@22.14.0 node node_modules/vitest/vitest.mjs run tests/ai/runtime/compaction-completion.test.ts tests/ai/runtime/compact-runner.test.ts tests/ai/runtime/agent-runtime.test.ts tests/ai/runtime/portable-compaction-executor.test.ts tests/ai/adapters/claude.test.ts tests/ai/adapters/openai-responses.test.ts tests/ai/adapters/openai.test.ts tests/runtime/sol-pi/provider-disclosure.test.ts tests/runtime/sol-pi/semantic-compaction-owner.test.ts tests/runtime/sol-pi/semantic-summary-attempt.test.ts tests/runtime/sol-pi/semantic-compaction-ledger.test.ts tests/runtime/sol-pi/capacity-admission.test.ts tests/runtime/sol-pi/deepseek-capacity-profile.test.ts tests/runtime/sol-pi/compaction-policy.test.ts --maxWorkers=2
```

该原命令不含Desktop两个摘要文件，因此额外运行现有纯context/completion测试，未修改测试或断言，也没有运行需Node24 native SQLite的实际semantic-product-runtime资格套件：

```text
cwd: <worktree>/desktop
npx --yes --package=node@22.14.0 node node_modules/vitest/vitest.mjs run tests/main/context-manager.test.ts tests/main/compaction-completion.test.ts --maxWorkers=2
```

另外同一Node选择命令执行`node --version`，`final-node22-version.log`原文为`v22.14.0`，exit0；不是仅凭文件名或主笔转述确认版本。

## 实际结果与覆盖

- `final-focused-node22.log`：**14文件通过，475 passed / 1 skipped / 476，exit0**。包括CompactRunner、collector经实际三adapter入口、AgentRuntime真实fallback、portable executor、provider disclosure、semantic owner/attempt/ledger、capacity/policy等原套件。新增prepare→run clone及实际OpenAI preview→SDK body测试位于本次实际执行的compact-runner/compaction-completion文件。
- 原命令唯一skip位于`deepseek-capacity-profile.test.ts`：`SOL_PI_DEEPSEEK_COUNTER_ENV`缺失时既有`skipIf(!environment)`资格回归（源码25–26行）；没有通过设置假recipe、改资格或删除skip把它算通过。
- `final-desktop-completion-node22.log`：**2文件通过，51/51，exit0**，其中completion 10项、context-manager 41项。覆盖不完整/坏Responses payload拒绝且历史保留、迟到原错误/usage、首chunk前取消、完整空白no-op，以及既有网络snip与正常成功路径。
- `git diff --check`无输出；冲突文件查询无输出。没有为本次运行修改源码、旧断言、baseline、timeout、生产配置、依赖或权限。

这里的475/51是当前Node22**实际日志**，不会套用主笔另一套Node24的484等数字。semantic empty→settled的实际注册recipe/受控HTTPS/持久CAS17场景由远端Node24绿色日志提供证据，本轮没有执行该native环境用例，也不把Node22 pure/unit相关通过冒充其资格验证。

## 原始证据与进程收尾

| label | runner PID | child PID/PGID | exit | reaped | 登记PGID当前剩余 |
|---|---:|---|---:|---|---:|
| `final-focused-node22` | 62409 | 62416/62416 | 0 | True | 0 |
| `final-desktop-completion-node22` | 63689 | 63716/63716 | 0 | True | 0 |
| `final-node22-version` | 64181 | 64190/64190 | 0 | True | 0 |

所有检查仅按上述记录PGID精确匹配；没有手动kill，也未查看/接管/重启共享4400 KSwarm，未干扰其他root全量runner。组内剩余0不等于对全机未知detached进程作保证。

- `final-focused-node22.log` SHA256 `8943b7d014bb3a59a6cd88d810f90cba4fa01405150ea5011856a0f30f9e537c`；`final-focused-node22.json` SHA256 `abd7338a492bc473aab695047bf83394d5f259be0a56d7ebaefccae31c16e348`。
- `final-desktop-completion-node22.log` SHA256 `8ee4981f21527925038568dabd3b8675510fd567ef46f7faf14e566122241a2c`；`final-desktop-completion-node22.json` SHA256 `ef13a449efac80701f11c627116482cdde1e63459df40e46576b7bf433abce9f`。
- `final-node22-version.log` SHA256 `7703fd79909af9b17df6395137bee2b07c3f3b27b6e96e18c909f433cce84f19`；`final-node22-version.json` SHA256 `57761210be21ccf3ea82b5dabf30886fd44f8653983737f8a9c0b69c3f5389c7`。

## 未覆盖与报告边界

本轮限定最低Node22摘要完成边界和相关原套件，未跑Desktop全量、原生semantic17、Windows/macOS远端CI或安装包/ASAR/真实provider。主笔全量和baseline归因中仍有失败/时序差异，不能因本轮相关回归全过称它们已关闭。本报告只记录本席亲自启动和检查的owned runner结果，数值均对应上述原始log/json；唯一写入为授权runner证据及本独立报告，既有归档票不改。
