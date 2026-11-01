# Independent code review

Model: glm-5.3-flash; HTTP 200; finish: stop; prompt SHA256: cd10bf8d20d261ee30a98d6e0f66c9ef111af197959b699b1d93cc44dd4e7b89

## 独立复核结论

逐条对照源码（不引用先前结论）：

**1. attemptState 每次迭代新建 — 真（无问题）**
`openai.ts` 中 `const attemptState: StreamAttemptState = { outputChars: 0 }` 声明在 `while (true)` 循环体内、`try` 之前，每次 `continue`/重试都会重新分配。admission 重试路径引用的 `attemptState.latestProviderUsage` 属于失败的那次尝试，语义正确。

**2. fail attempt usage 计费且不含私有正文 — 真（符合设计）**
admission 重试分支：`if (bufferedUsage && attemptState.latestProviderUsage) { reportUsageSource('provider'); yield { type: 'usage', ... } }`，只输出 token 数字，不含任何正文。非重试路径同样先 yield usage 再 throw。私有正文仅存于 `pendingAdmissionText`，任何路径都不 yield（测试 `retries a missing-reasoning response...` 断言两次 usage 且 `not.toMatch(/UNADMITTED_PRIVATE_CANARY|discarded/)` 佐证）。

**3. terminal retryable=false 生效 — 真**
`kimi-reasoning-admission.ts` 中错误对象固定 `retryable: false as const`；`runtime-errors.ts` 新增分支 `isKimiReasoningAdmissionError(error) → { code: 'model_failed', message: KIMI_REASONING_ADMISSION_CODE, retryable: false }`。第二次 admission 失败时本地重试条件（`admissionRetries === 0`）不满足，走通用路径被 `isRetryableError` 判 false 后直接 throw，不再进入指数退避。测试 `bounds missing-reasoning retries...` 断言 `create` 恰好 2 次、`onRetry` 未被调用，与该逻辑一致。唯一保留：`isRetryableError` 函数体未在上下文中展示，但其行为由 normalizeRuntimeError 映射和测试双重佐证，非矛盾。

**4. gate 只结算 foreground turn，running 计划保持 running — 真**
`deliverable-gate.ts` 的 `hasStartedProjectHandoff` 只要求最近一次 `create_project` 事件 `ok && created && planningStart.sent === true`，不检查项目交付物；补丁未触碰 KSwarm 或 project 状态写入路径。测试 `settles the real host exactly once...` 使用真实 `FileTaskSnapshotStore` + `InProcessTaskRuntimeHost`，断言 `recovered.status === 'completed'`、`runner` 只调用 1 次、最后一条 `progress_plan_reported` 仍是 `status: 'running'` 的 steps，且快照未被 gate 修改（`expect(s).toEqual(original)`）。与"create_project 回执是 project_update 而非后台最终文件"的产品期望一致——gate 只是把"本轮前台交接完成"定为 complete，后台计划继续。无效回执（`sent:false`/`ok:false`/`created:false` 等 7 种）均保持 blocked，最新失败事件使更早的成功失效（`does not use an earlier success...`），逻辑闭环。

**5. 脱敏结构无正文泄漏 — 真**
`createKimiReasoningAdmissionError` 只携带 `{ sawContent: boolean; sawTools: boolean; terminal: 'finish' | 'eof' }`；Error.message 是固定常量码。`pendingAdmissionText` 的长度仅用于 `sawContent: pendingAdmissionText.length > 0` 和限额检查，不进入错误对象。桌面测试断言 `JSON.stringify(events)` 不含 canary，单元测试断言 `JSON.stringify(failure)` 不含 `PRIVATE_CANARY`，与代码一致。

**备注（非阻断）**：`hasStartedProjectHandoff` 的中文正则白名单/黑名单属启发式，边界措辞可能漏判/误判，建议后续在文档中说明该 gate 仅为前台交接的保守豁免；`compactProjectCreationResponse` 假定对合法回执可解析，属实现契约。均为澄清级，不构成 P0/P1。

审查者未运行测试，以上判定全部基于所给源码与测试断言的静态一致性；无任何疑点被证为 P0/P1 缺陷。

**APPROVE**

END_REVIEW
