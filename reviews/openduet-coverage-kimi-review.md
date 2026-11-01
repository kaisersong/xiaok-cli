# 评审结论：APPROVE（基础切片范围内，附 P1/P2 跟进项）

模型身份：编码模型 Codex GPT-6；本评审为独立 Kimi（与编码不同模型，满足双模型要求）。评审仅依据 `/tmp/openduet-review-20261101/bounded-review.txt` 单次读取；「99 项测试通过、main/renderer 构建、typecheck、治理通过」为作者陈述，按约定接受编译器证据，本人未独立重跑（转引、未核实）。本结论只覆盖该切片，不代表 OpenDuet 全文完成；无 Windows/安装包实测。

## P0：无

切片未引入新的授权/发布/执行能力，凭证零接触，权限边界与既有 `getOverview` 持平。

## 已核实的正确性要点（支持 APPROVE）

- **旧协议保留**：`getOverview` 频道、schema、preload key 原样保留，v2 走新频道 `getActionOverview`（assistant-typed-ipc.ts 附件行417；assistant-ipc-contract.ts 附件行684-686）。
- **只读 IPC**：`getActionOverview` 无输入、无 mutation 分发，risk tags 与既有只读 `getOverview` 相同（附件行425-426、433-436）；renderer 仅渲染（AssistantCoverage.tsx 全文无写调用）。
- **持久化归属正确**：复用 LoopStore 既有连接与事务边界，迁移为 `CREATE TABLE IF NOT EXISTS` 纯增量（loop-store.ts 附件行455-466；assistant-source-store.ts:7-12）。
- **LLM 前记录、失败独立**：`recordCollection` 在 `complete()` 前 awaited（assistant-loop-executor.ts 附件行368-370）；catch 内 `finishAnalysis('failed')` 单独 try 包裹，不覆盖原始失败（附件行380）；`finishAssistantSourceAnalysis` 对缺行静默返回、终态冲突抛错（assistant-source-store.ts:26-31），executor 端已兜底。
- **幂等与 fail-closed**：同 runId 同 payload 重放为 no-op、异 payload 抛冲突（assistant-source-store.ts:17-18）；legacy 数组端口映射为 `not_checked` 而非 `checked`（assistant-desktop-snapshot.ts 附件行334-336），方向保守，无已知 checked 误报的实证路径。
- **无内容泄漏**：新表只存 coverage 元数据（`recordCollection` 只 parse coverage 字段，assistant-runtime.ts 附件行399-402），快照正文不入库；coverage 以 non-enumerable 挂在有界 payload 之外（附件行302），注释意图一致。

## P1（建议在集成前书面确认，不阻断本切片）

1. **3/5 数据源的「完整」是声明而非推导**。`listTimedActions`/`listMeetingMetadata`/`listKnowledgeSourceMetadata` 直接包 `completeAssistantSource(...)`（desktop/electron/main.ts 约 1326/1340/1349 行，对应附件行 513/524/535；定义在 assistant-source-ports.ts:8-10）。若 `timedActionService.getActions()`、`knowledgeBaseStore.listMeetings()/listSources()` 内部存在任何截断/上限，UI 会显示 `checked`/`coverageComplete` 而实际不完整——这正是本切片要防的 checked 误报，需作者确认这三个 getter 为全量枚举。
2. **窗口成员判定用 `updatedAt` 代理**。会议按 `meeting.updatedAt` 过滤窗口（main.ts 附件行525-531），timed_actions 按 dueAt/updatedAt 混合（附件行514-520）：窗口内发生但近期未更新的记录会被漏掉，而 coverage 行仍标 `checked`。语义缺口沿用自旧代码，但现在被升级为「覆盖完整」声明，建议确认或降级。

## P2（记录跟进，不阻断）

1. assistant-task-source.ts:12：snapshots 目录不存在返回 `available/complete`——dataRoot 配错时会误报「完整空」，建议区分「未初始化」与「目录缺失」。
2. assistant-desktop-snapshot.ts 附件行 295-298：`activityIdentity` 用 `[scope,kind,id]` JSON 做 Set，源内身份碰撞（同 id 重复活动）可使 `includedCount === expected.size` 而实际有 dropped，`checked` 不降级；理论路径，建议加注释或计数对账。
3. assistant-desktop-snapshot.ts 附件行 224 + contract 附件行 6：`requestedWindow: {...query}` 配 `.strict()`，若 `AssistantSnapshotQuery` 日后增加字段，`recordCollection` parse 抛错导致整轮失败（fail-closed，但 noisy）。
4. assistant-source-store.ts:21-22：`pending` 行永不清理；记录在 LLM 前、进程崩溃残留 pending 会无限累积（量小，两次/日）。
5. assistant-ipc-contract.ts 附件行 674 + WelcomePage.tsx 附件行 652：v2 超 256KB refine 时 IPC 直接 reject，renderer 的 `??` 只在 API 缺失时回退 v1，负载超大场景 v1 可用而 v2 硬失败。
6. assistant-controller.ts 附件行 169：只读 IPC 内调 `bootstrap()`，其幂等/无副作用未在切片内证实。
7. assistant-desktop-snapshot.ts 附件行 302：若 `enforceFinalByteLimit` 返回冻结对象，`defineProperty` 会抛错；测试通过表明当前未冻结，建议加一行防御或注释锁定该假设。

## 台账核对

未见用合成数据断言实际准确率或执行幂等；未把本切片表述为全文完成；失败路径均向 unknown/unavailable 收敛，无「未知当成功」。Windows/安装包未实测已如实声明，切片未触及启动/子进程/原生模块路径，风险可接受。
