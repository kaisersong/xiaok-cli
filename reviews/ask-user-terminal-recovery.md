# ask_user 输入与取消恢复（2026-10-01）

## 证据

JEV 会话首次 ask_user 参数是 `_raw`：模型把两个问题对象拼成非法 JSON，required question 校验失败。第二次参数合法，用户选择 Other；日志随后出现独立 readline 回显，工具未返回，SIGTERM 卡在等待实际 tool 结束，磁盘 session 一直没有消息。

当前源码与安装产物同时存在：tool_started 在校验前暂停 busy capture；Other 绕过 InputReader 和 scroll-region footer，切到 cooked mode 并另开 readline；两个工具都未将 context.signal 传给交互等待。当前源码没有解决这些问题。

## 设计

仅修提问 UI 和取消，不改 JEV/provider/session schema。非法 JSON 仍拒绝，不推断用户答案。

- tool_started 仅记录问题工具；校验后执行的回调才接管 stdin，finally 恢复正常输入。
- 两种提问工具共用 InputReader 自由输入和 footer，askQuestion 的独立调用也用 InputReader，移除额外 readline。
- InputReader 等待接受 signal，abort/EOF 后移除监听并返回 null；宿主抛原 abort reason；ask_user 不将 AbortError 格式化为失败文本。
- 菜单独占监听，确认只执行一次；提交、取消、abort、EOF 和渲染异常均清理。Windows handoff 用既有 pauseInputForHandoff 保留 raw session。

## 实施前对抗性评审

- schema 校验早于 execute，不能靠 execute finally 补救 tool_started 的提前接管。
- Other 文本读取前必须移除菜单监听，避免 Enter 双提交；不允许 Promise.race 留下幽灵 reader。
- abort 必须使实际 tool settle，否则退出 drain 会永远等待；空回答/取消不是 approval。
- 预先取消、绘制失败、EOF 和重复确认都应清理；两个提问入口都要接入 signal。
- 自由输入需保留问题提示、footer、中文解码及下一轮输入；测试调用真正 CLI/registry/UI，禁止重实现输入逻辑。

## 回归

旧代码新增六个测试全部失败（取消/EOF超时、错误吞掉 AbortError、未透传 signal/host reader）。修复后再验证独立 UI、InputReader、两种工具、Windows handoff，以及 CLI 的非法参数→有效问题→Other 中文回答→下一轮和菜单/文本中断。

安装版本 chat runtime 与当前 checkout 不同，四个交互模块在修复前字节一致；仅更新四个已验证模块与 chat 对应的窄片段，备份原文件，避免覆盖无关 runtime。

## 提问历史与工具分组间距（2026-11-01）

对应 terminal frontend architecture §13.1。选择完成后，问题历史直接写 stdout，前面没有空行；chat 的问题工具分支提前返回，保留先前 Ran 分组，后续命令继续在同一竖线下显示。

- 外部 footer overlay 清理后，问题历史前补一个空行。独立菜单首次绘制已预留空行，提交时复用，不重复插入；导航重绘不增加空行。
- 真实 TTY 基线还发现已选答案被后续正文覆盖：直接 stdout 没有更新 ScrollRegionManager 的内容光标。给 askQuestion 增加可选 writeTranscript 回调，两个 CLI 提问入口均传入现有 writeAtContentCursor；独立调用仍写 stdout。问题和所选答案作为一个历史块提交；Other 继续先提交问题，再用原宿主 reader 输入。
- chat 进入 ask_user / AskUserQuestion 时重置 ToolExplorer；后续同类工具重新显示分组标题及正常间隔，折叠计数随之重置。
- 保持问题原文、中文标点、答案、取消和输入 ownership；不添加 ANSI、移动光标或改变 scroll region。
- 检查边界：独立菜单不能双空行，footer 问题历史不能紧贴工具；两个提问入口均覆盖，后续命令不得沿用旧分组或旧折叠预算。
- 回归调用 askQuestion 生产函数，并用独立 tmux socket + 本地 SSE 驱动完整 CLI，检查历史空行、分组标题、答案及下一轮输入。

验证：新增 footer 回归在旧实现上失败（行差 1，预期 2）；旧 CLI 的真实 TTY 同样在提问前空行断言失败。修复后 build、sandbox build、5 suites / 135 tests、governance（0 new）、增量 architecture（0 new）通过。`question-transcript-spacing.py` 覆盖两个工具 × 80×24 / 48×16，共 4 场景、32 次本地 SSE 请求，空行、选项答案、后续 Ran 新标题及精确下一轮输入通过；CI Linux 接入同一脚本。fixture 关闭无关 conversation activity，独立 socket 的 pane PID 均已退出，SSE 已关闭；先前试跑及交互单元创建的 owner 按本 worktree 的精确入口回收。Windows / 原生 Ghostty 未验证；未更新安装入口。
