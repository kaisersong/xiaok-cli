# 专项规则

仅在根 AGENTS.md 对应任务触发时读取。本文件中的项目路径以仓库根目录为基准，命令从其注明目录执行；关联项目位于仓库同级。

## Agent Tool 权限边界

设计任何会被 agent runtime 调用的 tool（特别是 write 类）时，必须按以下规则贯彻，否则会出现 agent 误删/误改用户数据的事故。

历史教训（2026-06-24）：`scheduled_task_cancel` 工具的 description 写"周期任务满足停止条件时必须调用"，导致 agent 在执行 daily 任务时把用户创建的 AI日报自己取消了。Service 层无权限校验，Tool description 引导主动取消，双重失守。

### 强制规则

- **Service 层显式权限参数**：所有 mutation 类 service 方法（`cancel*` / `delete*` / `update*` / `set*Status` 等）必须接收 `requestSource: 'user' | 'agent' | 'scheduler'` 参数，并在方法内部根据来源 + 数据所有权决定是否放行。**禁止**靠 caller 自觉。
- **Default deny**：默认拒绝 agent 跨域操作。允许的边界用 allowlist 显式列出（例：agent 只能 cancel `source === 'agent'` 且 `trigger.kind === 'interval'` 的临时任务）。
- **Tool description 写禁区，不写许可**：用 "**严禁** X" / "只能 Y" 的措辞，列出明确不能做的场景。**避免** "必须调用" / "应该调用" 这类引导性措辞——LLM 会找理由用。
- **Negative test 必备**：每个 agent tool 必须有"越权调用拒绝"的单测，与 happy path 同等地位。例：`scheduled_task_cancel` 调 user-created task 应返回错误且不修改数据。
- **Audit log（建议）**：mutation 类操作记录 `who / what / why / when`。出问题能在 timed_action_runs / activity log 类表里 5 分钟 trace 完。SQLite 已有 `timed_action_runs` 是好例子。

### 新增/修改 agent tool 的 checklist

- [ ] Service 层有 `requestSource` 参数？
- [ ] 默认 deny 还是 default allow？写了 allowlist 还是 denylist？
- [ ] Tool description 是否包含 "**严禁**" / "只能" 等明确边界？是否避免了"必须调用"这类引导措辞？
- [ ] 有没有 agent 越权调用的 negative test？
- [ ] 改了 durable state 有没有 audit log（即使是简单的 console.warn + run history record）？
- [ ] Renderer IPC 路径默认 `requestSource='user'`，agent tool 路径默认 `'agent'`，两路验证清楚？

### 高风险 tool 类型（必须套用上述规则）

- 取消 / 删除（cancel / delete / archive / soft-delete）
- 状态变更（status / approve / reject / pause / resume）
- 数据写入到用户拥有的 store（scheduled tasks、reminders、knowledge、project / task state、artifacts metadata）
- 涉及外部副作用（发送消息、推送通知、调用第三方 API）
