**评审结论：APPROVE（静态只读复审，独立 Kimi 模型）**

评审身份与范围：本结论由独立 Kimi 模型基于 `/tmp/openduet-action-review-20261101/bundle.txt` 单次通读作出，纯静态审查，未执行任何命令、未运行测试；作者（Codex GPT-6）报告的编译与测试证据按约定视为「未经本人核实」。覆盖范围仅限：v2 action 结构/证据引用校验、正式 Loop body 哈希覆盖、main-current 观测投影入现有 Loop SQLite、user-only dismiss/snooze/CAS、草稿预填不发送。整体设计并未完成（无 Start、launch journal、host admission，`startAvailability` 恒为 `unavailable`），本结论不暗示 P1a 之外任何部分已就绪。

逐项核查（均通过，无 P0/P1）：

- **授权与兄弟入口**：写路径只有 `decide`，强制 `requestSource==='user'`（assistant-action-service.ts:22）；IPC dismiss/snooze 硬编码 `requestSource:'user'` 且走既有 `authorize(event)` 准入；`list` 允许 scheduler 但只做投影派生写，不触达用户决策。无旁路写入口。
- **过期源复制**：`readMorningActionSource` 的 `isCurrent` 闭包同时校验 run 仍最新、observation 仍 current、ordinary 路径证据条目 JSON 逐字一致；`guard` 在投影/决策写前后各调一次，配合 `LoopStore.transaction` 包裹，过期即抛错回滚。
- **事务回滚**：projection/decide 均经 `loop-store.ts` 的 `transaction()` 包裹，尾部 guard 抛错在事务内，可回滚。
- **v1/v2 精确形状**：v2 顶层仅允许 `schemaVersion,recommendations`，recommendation 经 `parseAssistantActionRecommendation` 精确键校验（含 action 四键、kind 枚举、evidenceRefs 1–20 条且逐条精确键）；v1 路径形状不变，`schemaVersion` 非 2 即拒。
- **文本哈希覆盖**：所有字符串有长度+字节上限，无多余键可逃逸，绑定哈希与 `publicationJson(normalized)!==publicationJson(copied.output)` 规范化等价校验保证哈希对象即展示对象。
- **未知确认**：CAS 失配/状态非 open|snoozed 返回 `conflict`，渲染层有 `actionConflict` 提示；IPC 异常落入既有 `operationUnknown` 横幅。
- **输出上限**：16KB/1024 节点捕获上限、≤3 条建议、reasonCode 600、instruction 4000 等均有界；服务侧对投影条数二次兜底。
- **草稿预填**：`onPrepareAssistantDraft` 仅在输入框为空时 `setPrompt`，无任何 submit 调用，且有 `draftPreparedNotice` 提示，符合 NO sending。

非阻塞观察（P2 级，不要求本 PR 处理）：
1. `decideAssistantAction`/`projectAssistantActions` 的尾部 guard 安全性依赖调用方事务包裹；目前生产路径均有包裹，建议后续避免被事务外直接调用。
2. expired 状态的 proposal 无法 dismiss（decision 须为 open/snoozed），属产品取舍而非缺陷。
3. preload 侧 `dismissAssistantAction` 等包装未含在 bundle 中，但 main 侧已完成全部鉴权与入参校验，preload 缺失最坏结果为功能不可用，不构成提权面。

未发现需要 BLOCK 的 P0/P1 证据，故 APPROVE。Windows 与安装包验证按作者说明未做，本复审同样未覆盖。
