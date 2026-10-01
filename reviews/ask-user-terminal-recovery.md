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
