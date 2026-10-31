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
