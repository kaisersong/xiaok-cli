## 结论：批准

我已审查了完整的内联差异（生产环境、fixtures、测试、CI）以及七个冻结的生产文件。我没有发现证据支持阻塞性代码缺陷。发现的问题列表及验证限制如下。

### 生产代码变更 — 已验证合理

- **后期用量的物理所有权** (`desktop-task-stream.ts:44-53`, `project-agent-model.ts`): `captureDesktopTaskUsage` 在提供程序源中消耗 `onUsage`，在任何外部中止竞争分离之前，通过 `physicalRun.observeReturn(work)` / `noteReturnFailure(error)` 将异步提交保留在物理运行中。错误身份得以保留：同步消费者抛出通过 `noteReturnFailure` 重新抛出，异步拒绝被追踪为粘性拥有者失败。`shouldRetry: () => prepared && !usageConsumerFailed` 正确地防止了网络形状的消费者失败（例如 `ECONNRESET`）触发模型重试，否则这些错误会被 `recoverable()` 分类为瞬态错误。`project-agent-model.ts` 中的选定模型分支区分了 `usageConsumerFailed`（直接抛出消费者错误，不回退），并在 `closingFailure` 存在时依赖现有的双重失败聚合 —— 当关闭和业务失败同时发生时，消费者错误通过 `closingBusiness` 到达 `checked()` 包装器，因此不会丢失任何内容。
- **无重复消耗**：外部 `for await` 循环（主循环 ~L6690，终结 L6074）现在对 `usage` 执行 `continue`；终结转发 `input.onUsage` 到请求中，因此每个分支（普通/选定项目模型/终结）都只有一个消耗点。
- **行为变更已披露**：非邮箱 `catch { warn; throw }`（之前是吞掉）是声明的更改，并且与排空失败契约一致 —— 当消费者错误发生时，物理范围关闭会以原始失败拒绝。测试 `desktop-task-usage-drain.test.ts` 覆盖了 null/undefined/Error 消费者返回、诊断失败和物理排空拒绝。
- **Bounded glob** (`src/ai/tools/bounded-glob.ts`): `pathToFileURL(join(import.meta.dirname, 'glob-worker.mjs'))` 保留了模块邻近性，未能关闭（缺少资源 → `glob_worker_failed`，直接在新的契约文件中测试），并且发出的字节数据在 CLI 和桌面构建中都与源相等。
- **Intl memoization**：两个组件都遵守 Hook 规则（所有 Hook 都在任何条件返回之前）。`CollaborationRoomsPage` 的指纹包括每个时间戳及其偏移量，这确实是正确的失效键 —— 它既捕获了历史 DST 偏移差异，也捕获了具有相同偏移值的新日期，并且两个新的渲染器测试完全执行了这些边界。当指纹为空时，`formatTime!` 非空断言是安全的，因为渲染路径仅在 `timestamp` 为真时才对其进行解引用。
- **敏感度表**：所有 41 个新添加的 `Room` 字段均已分类；`publishedBy`、`contextScope`、`workspaceId`、`originHostId`、`hostPrincipal`、`acquireDigest`、`terminationEvidence`、`commit/confirmationTicketId` 被禁止访问，这与 `intent-broker/src/room/workspace-service.js` 中引用的生成器源代码（L254, L336, L354-362）一致。Getter-canary 测试确认了 `getOwnPropertyDescriptor` 读取永远不会触发敏感的 getter。
- **Main 字节/哈希绑定**：新 fixture 对 `remediation-20261022-main-reviewed.txt` + 字面量 SHA `f25ac6d5…` 绑定实际 Main，加上旧→新 AST 保存测试；这不是动态自证明。旧的 `r299` 快照和 SHA 原样保留。
- **CI**：`model-recovery` 获取固定的 kswarm 提交，并通过 `KSWARM_SOURCE_ROOT` 构建真实的 CLI + 桌面 main，然后再运行发出的 worker 测试；glob 契约拆分为 CLI/桌面测试文件，这与仅构建 CLI 的 `glob-search` 门一致。引擎版本 `>=22.22.0` 与记录的 `DatabaseSync.isTransaction`（Node ≥22.16）和 kswarm 防护要求相符，并且恢复矩阵增加了 22.22.0，而不是删除 22.14。
- **Darwin TAR fixture**：`--no-mac-metadata --no-xattrs` 仅限于 darwin；额外的成员/链接/截断拒绝断言未变。

### 小观察（非阻塞）

1. `tests/ai/tools/mcp-per-call-cancellation.bdd.test.ts`: `expect(callTool.mock.calls[1]![2]).not.toHaveProperty('executionContext.taskId', first.taskId)` 很弱 —— 第二个调用的 `executionContext` 没有 `taskId`，因此无论如何都会通过。上面的精确 `toEqual` 断言才承载了权重；这无害。
2. `goal-attachment-ipc-contract` fixture 调用 `Reflect.apply(handler, undefined, [event, input])`，剥离了 `this` —— 仅在关闭感知包装器忽略 `this` 时才安全；间接测试断言 (`gate.outstanding === 0`) 将捕获回归。
3. `bundled-mcp` 部署测试修改了 `process.resourcesPath` 并依赖于 `deployBundledPluginFiles` 读取 `XIAOK_CONFIG_DIR`；对这些环境变量的清理已正确恢复。

### 验证限制（与代码正确性分开说明）

- 我无法执行任何操作；全量套件运行仍在挂起中，且四个已注册配方的桌面文件正在等待离线 kai-mbp。我没有看到它们通过的证据，也没有声称它们已通过。
- 有几个测试引用了我无法从此差异中确认存在的导出/契约：`desktopServices.__testFinalization`、`INVOKE_CHANNEL_BY_KEY`、`MEETING_MODELS_OUTPUT_SCHEMA`、`MODEL_CONFIG_RESULT_SCHEMA`、`computeKSwarmServiceSourceHash` / `checkKSwarmHealthServiceIdentity` / `getKSwarmWorkflowReadPort` / `sealAndDrainKSwarmServiceInstance`，以及 `queueOwnerReplaced` 通知 API。这些是测试端的依赖项；如果其中任何一个不存在，其运行将简单地显示为失败，而不是潜在的安全回归。
- 新的 `activityChannel` 枚举（`memory-ipc-registry`）和 e2e 工件 `url`/`size` 契约断言了我没有内联拥有的生产文件；我将它们视为未经证实但合理。

此处的批准仅涵盖对比 `d0e35e73` 的补救差异，而非整体的发布就绪或全绿声明，后者仍受限于上述待处理的运行。
