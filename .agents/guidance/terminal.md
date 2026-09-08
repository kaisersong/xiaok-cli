# 专项规则

仅在根 AGENTS.md 对应任务触发时读取。本文件中的项目路径以仓库根目录为基准，命令从其注明目录执行；关联项目位于仓库同级。

## Terminal Frontend 说明

- Terminal E2E verification 使用 `tests/e2e/tmux-e2e.py`，它会启动本地 OpenAI-compatible SSE server 和真实 tmux TTY。
- 首次提交输入后，startup welcome card 应保持在输入上方，直到正常 terminal scrolling 将其滚走；不要在首次 submit 时清空 content region。
- `Thinking`、`Working` 等 live activity 渲染在 input footer 上方的 activity row，activity 和 `❯` 之间保留一行空白 gap。
- 不要尝试在 live activity row **上方**（activity 与 transcript 内容之间）加空白 gap。已于 2026-06-24 完整尝试并失败：activity 本身是"覆盖最底行、不移动内容"的 overlay，而要在其上方留空行必然要滚动/移动 transcript 内容；静态预留和 transient 滚动两种实现都会在 24 行终端上把内容挤出可见区，且 transient 方案在多工具一轮内跨多次 activity 累积滚动把 transcript 走飞，破坏 `tests/commands/chat-interactive-runtime.test.ts` 的"换轮后上一轮尾行可见"等内容保留回归。结论：activity 上方留 gap 与"activity overlay 不移动内容"是结构性冲突，除非有全新的不移动内容的机制，否则不要再做。详见 `docs/bugfix/2026-06-24-terminal-activity-transient-lead-gap-design.md`。
- activity line 不应重复 footer status fields，例如 model、mode、tokens、project。
- 忙碌/streaming 状态下按 `ESC` 是当前 turn 的用户中断请求，不是失败态；`AbortError` 必须沿 runtime 原样冒泡到 chat 层处理，不能被 normalize 成普通 tool/model failure。
- ESC 中断必须保留用户 draft 和 queued input，不能清空输入缓冲；`XIAOK_NO_ESC_INTERRUPT=1` 时应退回旧行为。
- abort 后的 Stop/auto-continue 路径不能继续消耗 aborted turn；broker/runtime 事件应使用 `turn_aborted` + `turn_stop(reason: 'user_aborted')` 表达用户中断。
- terminal frontend focused 验证示例：
  ```bash
  npm run build
  npm run test:sandbox:build
  npm run test:sandbox:run -- .test-dist/tests/ui/scroll-region.test.js .test-dist/tests/ui/tool-explorer.test.js .test-dist/tests/ui/permission-prompt.test.js
  python3 tests/e2e/tmux-e2e.py --project-dir ../xiaok-cli
  ```
