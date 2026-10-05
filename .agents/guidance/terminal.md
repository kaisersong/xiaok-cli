# 专项规则

仅在根 AGENTS.md 对应任务触发时读取。本文件中的项目路径以仓库根目录为基准，命令从其注明目录执行；关联项目位于仓库同级。

## Terminal Frontend 说明

- Terminal E2E verification 使用 `tests/e2e/tmux-e2e.py`，它会启动本地 OpenAI-compatible SSE server 和真实 tmux TTY。
- 首次提交输入后，startup welcome card 应保持在输入上方，直到正常 terminal scrolling 将其滚走；不要在首次 submit 时清空 content region。
- `Thinking`、`Working` 等 live activity 使用正文与 input footer 之间已有的预留区；默认布局为正文上界 B、B+1 空行、B+2 activity、B+3 空行、输入框。活动和正文之间、活动和输入框之间均保留空白。
- 不要通过缩小正文 scroll region 或插入 transient 滚动给 activity 上方腾空行。2026-06-24 的两种方案均导致 24 行终端正文丢失/多工具累积滚动，详见 `docs/bugfix/2026-06-24-terminal-activity-transient-lead-gap-design.md`。2026-09-18 改用已有 footer gap 下移 activity，不移动正文；保持 `getScrollBottom()` 和 content cursor 不变，详见 `docs/bugfix/2026-09-18-cli-output-spacing.md`。
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
