# 输入栏在终端重排后重复

## 当前证据与方案

主干 `9804fd21` 已使用 EL 填色。真实 Ghostty VT 内核（社区 C ABI WASM 绑定，非原生窗口）调用生产 ScrollRegionManager，先物理 resize 再 updateSize，六轮后草稿从 1 份累积至 5 份。原生 Ghostty CUA 明确拒绝访问，不能绕过或宣称原生验收。

历史 #55 仍为 Draft；以首次实际增强 ESC 为光标查询前提，无法覆盖冷启动，且迟到报告和外部程序交接扩大输入风险。本次先验证不查询 stdin 的方案：为临时 footer/overlay 的每一行使用 OSC 133 prompt 标记，正文写入前结束 prompt 作用域，使支持该协议的终端在物理重排时先移除可重绘的临时区域。保留现有颜色和布局，不清 scrollback，不改键盘/权限协议。旧终端忽略 OSC，保留既有几何路径。没有终端品牌环境变量的 SSH 也须覆盖。

## 实现前对抗检查（作者自审，非独立评审）

- 只给首行标记不够：height shrink 可能裁掉首行，续行也必须标记。
- 不得将模型正文标成 prompt；正文、图片、submitted input、streaming、activity 切换均需审计。
- 不得以单一灰带证明安全：全部历史、长行满宽末字、下一次实际输出、草稿光标、busy/overlay 必须保留。
- 原缓存清理可能擦除被 reflow 移来的正文；回归必须逐次核对全部历史及回答末尾，发现则不能交付候选方案。
- 首行先 CUP 到第 1 列，再发 A;redraw=1，避免 A 隐式换行；续行使用 P;k=s。显式 redraw=1 也覆盖没有 shell integration 的 Ghostty VT/SSH。不使用光标查询，因此没有待收报告、ESC 歧义或输入吞键路径。
- 非 TTY 不发标记；忽略 OSC 133 的终端沿用原几何回退。multiplexer 用真实独立 socket 回归，Windows 由新增 CI 用例覆盖，本轮未在 Windows 实机执行。

## 验证门槛

先记录旧生产实现的失败回归，再修改生产代码。用真正的 Ghostty VT parser/reflow 测试冷启动、重复/合并 resize、正文及 scrollback、下一次输出；运行现有 TUI/交互及独立 tmux TTY 回归、build/governance/增量 architecture。原生与 DGX 未验须单列，不能关闭原始缺陷或声称已更新正在运行的用户会话。

## 本轮结果

用户确认来自本机 Ghostty，在缩放或切回后出现；本轮不以 DGX 作为交付目标。

- 最终 11 个 Ghostty VT 用例在旧生产实现上有 6 个失败；候选全部通过。覆盖实际 RGB=68 背景单元（含空白行与 scrollback），不依赖会漏掉纯背景的文本 formatter。
- `npm run build`、`npm run test:sandbox:build` 成功；最终 emitted 的 10 个相关文件、384 项回归通过，含完整 chat 入口与输入/菜单/授权既有行为。
- `node tests/e2e/ghostty-vt-footer.mjs`：真实生产 CLI + node-pty + Ghostty VT，6 次物理重排，75 行历史/单一灰色输入栏/草稿编辑/下一次模型请求与持久化原文全部通过；CLI、专有 daemon 与 SSE 收尾有记录。
- `python tests/e2e/footer-return.py`：独立 tmux socket 的原有 6 轮几何、完整历史、草稿和下一轮原文通过。
- governance 与增量 architecture 无新增违规。
- 失败证据保留在本机 `/tmp/xiaok-reflow-vt-20261030/`：初次 `/var` 临时目录触发主干 writer fence 的符号链接拒绝，改用 canonical TMPDIR 后同一回归全部通过；未更改生产 fence 或 baseline。
- 已将内核回归与真实 PTY 测试接入 Terminal UI CI；尚未取得本 PR 的远端 CI 结果。原生 Ghostty CUA 明确拒绝该 app，未绕过；VT/PTY 证据不冒充原生 GPU/窗口验收。

最终实现后自审：正文写出、图片、streaming、activity 与 end 均退出 prompt 语义区域；首行位置在写入标记前固定列零。键盘协议、stdin owner、scroll region 大小、颜色 tokens 和草稿状态保持现有 owner。未新增 CPR 查询，也未继承 #55 的首次 ESC 门槛。
