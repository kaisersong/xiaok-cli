# Code review

Model: deepseek-flash; HTTP 200; finish: stop; bundle SHA256: 8e197db5ba4df783746595bfc52f8ad83990c126551275754af9a6dd9a7aeb24

**审查结论：BLOCK**

发现 P0/P1 问题，必须阻止。

**P0：取消路径下错误分类错误，可能误报重试**
`openai.ts` 的重试条件在 `options.signal.aborted` 时已经排除，这本身没问题。但 `emittedOutput` 只追踪“已 yield 的输出 chunk”，而 `streamOnce` 内部在抛 `KimiReasoningAdmissionError` 前已经 `pendingAdmissionText` 非空（`sawContent: true`），这部分内容已被消费但未发布。问题在于：如果 `streamOnce` 在抛错前已经向 `attemptState` 写入了 `outputChars`/`latestProviderUsage`，重试时**没有重置 `attemptState`**，而是复用同一个 `attemptState` 对象继续累加。二次尝试的 usage 会与首次合并，而测试 `expect(chunks.filter(c=>c.type==='usage')).toEqual([首, 次])` 依赖两次独立上报——但代码里首次失败时若 `bufferedUsage && attemptState.latestProviderUsage` 为真会先 yield 一次 usage 再 `continue`，第二次成功后又 yield 一次；而 `streamOnce` 的 `extractUsage` 若按累计处理会重复计入首轮 token。这不是“有界一次重试且不重放已完成操作”的干净语义：**usage 在失败 attempt 上被提前发布，违反“失败不泄漏”精神**（虽然只是数字，但属于 attempt 产物泄漏）。

**P1：`hasStartedProjectHandoff` 与 `isDeliveryPlanComplete` 的短路顺序被 gate 覆盖**
`runDeliverableGate` 在 `hasStartedProjectHandoff` 为真时直接返回 `true`，跳过 `gateFunction`。这等于把“项目创建交接完成”当作“本任务交付完成”放行，而 prompt 明确要求“gate 只承认本任务真实交接且不把项目产物标完成”。补丁的 `planningStart.sent === true` 只能证明后台启动信号发出，不能证明后台任务已被 host 接收并进入 running；测试 `project-handoff-delivery.test.ts` 里用 `emitRuntimeEvent` 伪造 `post_tool_use` 加 `receipt_emitted`，但没有验证 `snapshot.status` 的迁移是由真实 host 状态机驱动、且 `progress_plan_reported` 的 `delivery` 步保持 `running` 不被 gate 改写成 completed。实际 `runDeliverableGate` 返回 true 后调用方是否会把 plan 标 completed，补丁未展示——这正是“不把项目产物标完成”的关键断点，无法确认。

**P1：`createKimiReasoningAdmissionError` 挂载 `sawContent/sawTools/terminal` 到 Error 上**
`isKimiReasoningAdmissionError` 用 `instanceof Error && code === ...` 判定，`normalizeRuntimeError` 只返回固定 message，测试 `expect(JSON.stringify(failure)).not.toContain('PRIVATE_CANARY')` 成立是因为 message 固定。但 `sawContent` 等字段可被外层 logger 序列化——本补丁未审查 `usageLogger.warn` 之外的日志路径是否序列化整个 error。属于潜在泄漏面，需确认。

**P1：`admissionRetries` 与 `attempt` 解耦**
`admissionRetries` 独立于 `attempt`，重试 admission 后 `attempt` 不变。若第二次 admission 失败，进入通用重试分支时 `attempt >= MAX_RETRIES` 判断仍用原值，可能允许额外 `MAX_RETRIES` 次普通重试，总重试次数为 `1 + MAX_RETRIES`，与“有界一次重试”表述不完全一致。虽不重放已完成操作（`emittedOutput` 为 false 时 admission 不允许在客户端可见输出后触发），但重试预算语义需澄清。

**未验证项**
- 未运行任何测试（无 `pnpm test`/`vitest` 执行记录）。
- 未验证 `openai-stream-error` 的 `OPENAI_STREAM_TEXT_LIMIT_EXCEEDED` 是否在 `streamOnce` 内被 `isRetryableError` 归类为不可重试（测试只断言 `create` 调用 1 次并 throw，未断言不被外层 `recoverModelStream` 重试）。
- 未验证 desktop 测试里 `requests[1]` 与 `requests[2]` 相等是否真能证明“不重放已完成操作”——第 1 轮 tool call 已执行（`executed=['completed']`），第 2 轮丢弃，第 3 轮 fresh，第 4 轮文本；这依赖服务端按请求序号返回固定内容，测试断言 `requests[1]===requests[2]` 只证明请求体一致，不证明第 3 轮未重放第 1 轮工具结果，实际是靠 `executed` 数组顺序间接证明，尚可但脆弱。

**结论**
- P0 级 usage 泄漏面 + P1 级 gate 语义不满足“不把项目产物标完成”的可证实性。
- 必须 BLOCK。

BLOCK
END_REVIEW
