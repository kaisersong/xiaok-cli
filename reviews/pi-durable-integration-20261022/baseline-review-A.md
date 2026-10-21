# A 席：activity 全量失败的独立 baseline 对照

结论：**不能归因为仅 source/emitted 混用；同一干净 master 的 source 与 emitted 均复现相同 8 项失败。** 这两套失败不是本批压缩完整性集成独有的回归，但仍须公开为未通过项，不能把全量测试宣称全绿。

基线目录：`<master-baseline>`。
实际 detached HEAD：`3b4061489a612337fdb2fc1eb92e96c1d4fbe9a1`。前后 `git status --short` 均为空。未改任何生产源、测试、断言、资格或超时；未触碰主笔 worktree 的 `.test-dist`。

## 环境隔离与原始执行

第一次按指定 runner 执行 `baseline-testcompile` 时，实际 baseline/node_modules 是指向主笔本任务 node_modules 的 symlink，prepare:types 安全检查返回 `sqlite-types: symlink-component`，exit 1。保留该原始 `.log/.json`，没有覆盖它。

随后只将 baseline 自有这条 symlink 换为同一依赖目录的独立 APFS clone（549M 的源依赖目录未修改）。重新以 `baseline-testcompile-cloned` 编译，prepare:types 为 `sqlite-types: exact`，compile/copy-test-assets 成功，exit 0。没有跳过或修改 prepare:types。

全部命令通过本任务绝对路径 `integration-20261022/run.py` 执行，保存独立 log/JSON，Node 为本机 v24.16.0：

| label | 命令 | 结果 |
|---|---|---|
| baseline-testcompile | npm run test:sandbox:build | exit 1，symlink-component，runner/child reaped |
| baseline-testcompile-cloned | npm run test:sandbox:build | exit 0，runner/child reaped |
| baseline-activity-source | node node_modules/vitest/vitest.mjs run tests/runtime/conversation-activity/owner-process.test.ts tests/runtime/conversation-activity/storage-permissions.test.ts --maxWorkers=1 | 8 failed / 10 passed，2 files failed，exit 1 |
| baseline-activity-emitted | npm run test:sandbox:run -- .test-dist/tests/runtime/conversation-activity/owner-process.test.js .test-dist/tests/runtime/conversation-activity/storage-permissions.test.js --maxWorkers=1 | 8 failed / 10 passed，2 files failed，exit 1 |

上述同名 `.log/.json` 都在本文件同目录。source 与 emitted 的两份 JSON 均有 `reaped: true`；四个子进程 PID 依次为 88315、91000、93054、94234，均由 runner 等待退出，没有执行非本任务 PID 清理。最终按 baseline 的精确 `.test-dist/...owner-entry` 路径只读检查进程，剩余 0。

## 失败内容与可证明的归因边界

`owner-process` 两种模式均为 6 项中 4 failed、2 passed：

- legacy empty/completed：期望 generation=3，实际 undefined。
- previous-generation empty/pending：期望 replaced/reused_pending，实际 hints=[]。
- 其余两个通过。

本轮没有修改源码插探针，也没有把 retire 失败的具体原因臆断为 module identity、超时或权限问题；这 4 项的底层原因仍待后续独立调查。当前实验证明其在 master 自身的两种 harness 中都存在，不能仅凭 source 测试引用 emitted 文件就断言混用是根因。

`storage-permissions` 两种模式均为 12 项中 4 failed、8 passed。四种 umask 子进程均明确报同一错误：

```text
const notices = createActivityStartupNotices({ configDir: root }); notices.queueStarted(); notices.take().markShown();
TypeError: notices.queueStarted is not a function
Node.js v24.16.0
```

本席已读 master `tests/runtime/conversation-activity/storage-permissions.test.ts:52` 的子进程脚本和 `src/runtime/conversation-activity/cli-loader.ts:103` 起的实际接口/工厂：测试还调用 queueStarted，但当前工厂只提供 queueOwnerReplaced/queueLegacyReplaced/queueLegacyPending 等方法，没有 queueStarted；emitted 工厂也一致。因此这是明确的同基线测试/接口不匹配，不是仅 TS source 与 emitted 导致的方法身份差异。此处只归因这四项，不将结论外推到 owner-process 的另四项。

主笔集成 worktree 相对 master 的下列四路径 `git diff` 为空：两个 activity 测试、owner-retire、cli-loader。基线读取 SHA256：

```text
c16e68add4213674023b868d7d41db9afcb3c65a97661fceb147021ab7102997  tests/runtime/conversation-activity/owner-process.test.ts
cff5b08f50d34af9710a6ccb8f19ff153541067bf0f50e91f01116a2721b1f15  tests/runtime/conversation-activity/storage-permissions.test.ts
a0fd9d31af16d4c92640550b3d33eb092da8a298937d4ee45b99d2fac489c646  src/runtime/conversation-activity/owner-retire.ts
ac24510d088e139ecdad9254538f97f64d3c300740dba5e637b698b498f8b192  src/runtime/conversation-activity/cli-loader.ts
```

这份对照不替代最终完整 HEAD 的质量票，不批准修改旧断言或延长时间，也不把已知 baseline 失败记为通过。

## 后续三套 source 基线对照（root-extra-baseline）

继续使用同一个干净 detached master、独立依赖 clone 和已编译 baseline `.test-dist`，通过同一 owned runner 执行：

```text
node node_modules/vitest/vitest.mjs run tests/commands/chat-finalization-process.test.ts tests/runtime/verification/installed-metadata-target-prepare.test.ts tests/commands/chat.test.ts --maxWorkers=2
```

原始 `root-extra-baseline.log/.json` 在本目录。实际结果 **9 failed / 98 passed（107）**，2 files failed / 1 passed，exitCode=1。JSON 记录 pid/pgid=5600、reaped=true，没有修改断言/超时/资格。baseline HEAD 仍为 `3b4061489a612337fdb2fc1eb92e96c1d4fbe9a1`，git status 干净。

| 文件 | baseline 结果 | 与集成全量对照 |
|---|---|---|
| chat-finalization-process（52） | **52/52 passed** | 没有复现集成全量中的两个 hook-sync/hook-async kill EPERM→退出1而非143；这两项不能记为已归因 baseline。 |
| installed-metadata-target-prepare（14） | **8 failed / 6 passed** | 与集成全量同八项及同报错：七项 installed_metadata_closure_profile，另一项 metadata_source_profile_unknown。 |
| chat（41） | **1 failed / 40 passed** | 与集成全量同 stable K3 durable-resume source-text 断言失败：expected -1 to be greater than 229744；本次不修改原断言。 |

本席对照了集成 `root-full-node24.log` 的实际失败名称/报错，不只比总数。当前集成相对 master 的这三个测试文件以及 hooks-runner/chat.ts 的 diff 均为空；这只说明相关路径未直接改，不能单独证明没有间接集成回归。

其中两个 finalization 全量失败仍待复核：建议在当前集成孤立运行该真实 52 项，并保留既有全量失败。若孤立通过，也只能记录负载/时序敏感或暂未复现，不能未经证据直接定性“只是机器负载”或改为全量已绿。

本轮三个测试文件 SHA256：

```text
8d0d4b185d3cecf2709bfe4b5dfe39825d7323242e9475a19e8cc4a6255483d5  tests/commands/chat-finalization-process.test.ts
501f23ed36b424f298e561439dfd451e3663c7dd5206d1746baabd8c3dca80d9  tests/runtime/verification/installed-metadata-target-prepare.test.ts
ae5b46bcfc9cb6d874e1cc4aa4f8e02a41396c5eedb7feef0836976488aa7b2d  tests/commands/chat.test.ts
```
