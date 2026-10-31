# Kimi 终止帧与中断恢复

真实项目恢复时，运行时在 5 个已完成的资料读取之后以 `KIMI_REASONING_TERMINAL_BOUNDARY_REQUIRED` 失败。当前同一错误字符串覆盖缺少 finish 帧及非法/截断 tool JSON，历史日志无法区分，不能据此断言上游具体形状。

已读实际 adapter，存在可复现缺陷：`if (!choice.delta) continue` 会丢弃带 finish_reason、没有 delta 的终止帧，使合法响应被误判为 EOF。另一个缺口是已有模型读取恢复 owner 不认识官方 reasoning 已准入后的无终止帧 EOF。

## 有界修复与自审

- 将有 choice 的空 delta 视为空对象，仍处理 finish_reason；不放宽官方 reasoning 准入、工具参数校验和权限边界。
- 终止边界错误保留原消息/code，并附固定、无正文的 kind、是否观察到官方 reasoning 和工具缓冲数量。不得记录 reasoning、工具参数、用户文本或供应商原文。
- 仅官方 reasoning 已准入、无工具缓冲且没有 finish 的 EOF 可由现有 recoverModelStream 恢复；非法/截断工具 JSON 和未准入 reasoning 继续失败，不伪造 done，不执行不完整工具。
- 该错误的 adapter 不再自行重试，由现有模型读取 owner 和任务 deadline/window 控制；调用者取消、授权/准备失败、物理读关闭失败仍优先。已经执行的工具留在 history，不重放 task/tool loop。
- 自审反例：空 delta 但未观察到官方 reasoning 必须继续失败；有 delta 但 JSON 损坏不能归类为网络瞬断；错误属性不得携带 JSON 残片；恢复不能重试整个项目或已完成的工具。

本文件为实施者对抗性自审，未冒充独立质量通过。本次不改授权、IPC、用户配置或长期持久化格式；仅复用现有读取恢复 owner。测试先复现元数据终止帧误拒、恢复缺失及非法 JSON 的固定诊断，然后改生产代码；验证真实 adapter、Desktop 工具循环、取消及 lifecycle。

## 本地验证

- 新增 6 项 adapter 回归在旧代码上全部失败；修改后整个 openai adapter 文件 186/186 通过。
- `./node_modules/.bin/vitest run tests/ai/adapters/openai.test.ts tests/ai/adapters/openai-stream-lifecycle.test.ts tests/ai/runtime/provider-conversation-authorization.test.ts tests/ai/runtime/model-stream-recovery.test.ts`：4 suites，213/213 通过。此次为 unrestricted 本机 source 测试，未遇到 sandbox EPERM。
- `cd desktop && npm run test -- --run tests/main/desktop-tool-loop-recovery.test.ts tests/main/desktop-task-stream-recovery.test.ts tests/main/desktop-provider-stream-lifecycle.test.ts`：18/18；真实 production loop 保留已完成工具结果且只执行一次，缺 finish 恢复、非法工具参数永久拒绝，取消/准备与物理关闭行为保留。
- `cd desktop && npm run build:main`、`npm run typecheck`、根 `npm run governance:check`：通过，未更新 baseline。
- 全部诊断只含固定 code/kind、布尔值及计数；原始供应商正文、工具参数及用户资料不进入 PR 或测试。当前真实错误的历史形状因原日志未区分而未知，本补丁不把任一合成形状冒充历史根因。
- 安装与真实项目完成需另验；不将源码回归、无工具模型探针通过等同于长任务已完成。

## 第二轮：持续输出仍被固定时限截断

安装后真实任务再次失败，新增诊断明确为 invalid_tool_call。时间与 adapter 自身每次调用的固定 5 分钟 abort 相合。只读接口探针使用同一已配置模型和实际 adapter，未执行任何工具：一次合法 write 参数（11782 字符、6600 个增量片段）需要约 4 分 35 秒，finish_reason=tool_calls、JSON.parse 成功。这不是该次失败的原始响应，但证明正常工具参数本身会接近固定 5 分钟上限。

已读生产路径：adapter 的 timer 只从调用开始计时；OpenAI SDK 的流在 abort 后可能以 EOF 结束。streamOnce 没有在 next 返回后核对组合 signal，随后把未完成的参数当永久 invalid_tool_call。外层 recoverModelStream 的 idle 计时也看不到缓冲中的参数片段。

### 设计与实施前对抗性自审

- 将 adapter 的 5 分钟限制改为实际模型增量的空闲时限：非空 reasoning/text 或工具参数可刷新；空 delta/usage 心跳不延期。调用者原 deadline 和取消信号仍拥有总执行时限，不扩大任务的 10 分钟预算。
- 读取之前及 next 之后核对组合 signal；内部空闲超时使用固定 TimeoutError/code，优先于 abort 导致的 EOF/未完成参数误诊。仅现有 read recovery owner 决定重试，adapter 不再自行重试自己触发的 abort。
- 添加不含参数、工具名或正文的 tool_input_progress stream 事件（非空参数增量最多每秒一次）。它仅传递进度，刷新已有 read recovery 的 idle；不是 tool_use、不是 reasoning、不是完成证据，不进入 assistant history 或执行工具。所有消费面维持只接受完整 tool_use 的现有执行路径。
- 对抗反例：空心跳不能维持运行；进度不能满足官方 reasoning 准入；真正完整但 JSON 损坏的参数仍永久失败；调用者取消/任务 deadline 不可被活跃片段刷新；内部超时后 SDK EOF 不能伪造 done；进度不能作为参数或工具执行；清理仍归原物理资源 owner。
- 回归覆盖真实 adapter、SDK clean EOF、长于 5 分钟的活跃参数、recoverModelStream idle、caller cancel、空心跳、既有无 reasoning 与非法 JSON 和物理读关闭。先 RED，再 production；保持最终 HEAD 质量复验未完成状态。

第二轮回归暴露一个必须保留的边界：合法 finish 后只等待 usage/EOF 的停滞不能恢复重试。新增终止边界标记只影响 adapter 自己的空闲超时分类，保持 finish 后不可重试；既有该项 contract 必须继续通过。

### 第二轮验证

- 新增长响应、实际 SDK abort→EOF 和恢复 idle 回归：旧实现 4 项 RED（调用者取消原本已正确）；修复后全部通过。新增实际 SDK finish 后 EOF 超时的不可重试检查。
- 最终 adapter / stream lifecycle / authorization / read recovery：219/219；Desktop production loop / task recovery / provider lifecycle：18/18。工具输入进度不进入 assistant history，也不会重复执行已完成工具。
- Desktop build:main、typecheck 通过；governance:check 无新增违规，未变更 baseline。
- finish 后的空闲错误现在保留固定 OPENAI_STREAM_IDLE_TIMEOUT 诊断，retryable:false；finish 前才可由现有 read owner 恢复。没有增加 task/tool 重试状态机，没有延长任务 deadline。
