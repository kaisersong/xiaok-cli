# SSH 输入栏缩放残影修复

## 现状与范围

`src/ui/scroll-region.ts:updateSize` 用高度差/历史行数估算旧 footer 的位移，宽度变化没有真实位置来源；清理和重画均用缓存绝对行号。DGX 用户级安装包另有未集成源码的 Ghostty hotfix，但当前交互进程 TERM=xterm-256color、没有 TERM_PROGRAM，安装包调用实测 redrawablePrompt=false，不查询光标。此任务将通用 reflow 校正纳入源码与 CI，不修改用户环境、配置、权限或默认安装入口。

## 方案

在普通 footer/overlay 写出前，先预留正文空间，再用 DECSC 保存正文末尾的真实位置。满宽末行锚点放到下一空行，避免 erase-to-end 擦末字。终端先 resize、SIGWINCH 后到达时，在 POSIX raw TTY 恢复此锚点并读取 CPR，按返回的真实行/列投影正文，擦除锚点后的旧 chrome，再画新的 footer/overlay。保留所有正文历史、draft/cursor、activity、overlay 类型和 owner。

查询短时、同步、有时间与字节上限，使用私有 DSR/CPR（避免普通 F3 键歧义），读到的非 CPR 字节原样追加到 stdin 既有缓冲之后（不改变 raw-mode 或按键 owner）。不支持/断开/Windows/多路复用器/非 TTY/超时保留现有回退。首次没有锚点和正文 streaming 时不使用旧锚点；外部进程和 end/begin 重置锚点。已发出的迟到响应解析继续保留到完整响应/EOF，不随输入 owner 切换丢掉。查询无需终端品牌，SSH 的 xterm-256color 可以使用。tmux/screen 通过既有 TMUX/STY 识别并保留原几何路径：实测 tmux 的保存槽在60→24行缩放后把 row53 直接裁到24，不能作为正文锚点。SSH 合并事件后尺寸可能回到原值，仍需校正实际位置。

## 实现前对抗检查（作者自审，不冒称独立评审）

- 不能把光标查询仅绑定 Ghostty 环境变量，否则 SSH fallback 仍复发：采用真实增强 ESC 能力确认 + TTY 边界。
- 不能从输入行查询后按单一 delta 推算所有 reflow 行：保存正文边界，用 ED 从实际边界清残影。
- ESC7/ESC8 保存槽可能被 legacy 菜单借用：只在 ScrollRegionManager 拥有 rich footer 时设置；renderer overlay 每次刷新锚点，end/外部命令/streaming 使旧锚点失效。
- CPR 分片、混合中文/控制键不能丢：按字节保留，先单测分片、异常、超时和回放顺序；查询使用独立 /dev/tty fd，不接管 stdin listener；超时后的私有响应由临时 stdin.push 封装在所有 data owner 之前解析。
- 同步等待不能无界阻塞 resize：总预算固定，不等待用户回答；超时后保持被动解析，未完成的私有响应不因500ms期限失去上下文，缓冲上限64字节；不按时间猜测 ESC 归属：只有实际观察到 CSI27u 且仍有键盘协议 owner 后才发查询；确认前 legacy ESC 原样处理。待收报告的 ESC 前缀等待足够字节，完整增强 ESC 即时通过；64字节缓冲上限。旧请求未结束时不重复发查询，完整响应/EOF释放封装。
- 保存位置不代表任意终端一定保留正文 reflow anchor：必须原生 Ghostty 加宽/变窄与 height-only 实测；失败不得用 tmux 通过替代。
- 测试替身以前忽略宽度：新增 @xterm/headless 的真实 VT 重排/CPR 回归及原生验收，保留历史与下一次精确输入断言。

## 验证

先写失败测试，再写实现。覆盖 CPR/parser 及超时回放、宽度变化真实锚点、旧 footer 清理、末行、draft、busy/permission/question、无查询回退和生命周期失效。跑 UI、输入与交互入口回归，release/sandbox build、governance/增量架构。真实独立 tmux socket 和自有 Ghostty 窗口验收；收尾只清理自记 PID/窗口。

最终提交只含本任务源码、测试、设计/CI；不提交重建 dist/build-info，不合并 master。PR 列出最终完整 SHA 与已跑/未跑项。

## 实测补充

新增真实 VT 回归在旧生产实现上复现双草稿；修复后六轮列/高度变化通过。真实 tmux 最初失败，回退原源码同用例通过，诊断确认保存槽被裁到末行而非跟随正文。新增 multiplexer 守卫后复验；该环境识别按仓库要求由不同模型 GPT-6-astra 独立评审，结论另记。

## 独立评审 R1（GPT-6-astra）

结论 BLOCK，两项 P1 已真实复现：标准 CPR 与修改键 F3 冲突；跨同步超时的 CPR 半包进入输入引擎后取消任务并污染草稿。已改私有 CPR，新增 terminal-replies 层在所有 stdin data owner 下保持晚包解析，不因500ms固定期限丢掉上下文；多个读取尝试的用户字节一次有序追加。对应新增单元、真实 PTY 的650ms分片/UTF-8/控制键验收。R2 正在独立复核，未冒称通过。

原生协议依据：[Ghostty DECSC](https://ghostty.org/docs/vt/esc/decsc)、[Ghostty DSR](https://ghostty.org/docs/vt/csi/dsr)、[xterm control sequences](https://invisible-island.net/xterm/ctlseqs/ctlseqs.html)。

## 提交范围与未完成项

R2 发现30ms裸ESC猜测仍可能误取消；已删除该定时器，采用真实 CSI27u 证据门控。未改变键盘模式请求，不采用25u首键探测。legacy/未知能力保持旧路径，第一次实际增强ESC后才启用位置校正。**因此首次尚未确认能力的冷启动缩放仍未修复，本次仅作为有明确边界的草稿PR，不关闭原始缺陷。**

Mac 锁屏使原生 Ghostty 验收无法启动（两次同样断言），不以 tmux 或 xterm 通过冒称原生已验。后续要覆盖冷启动，需完成独立的终端能力协商/完整输入路由设计及原生验收。

## 输入交接修正

pending 响应持有独立 keyboard lease；共享 stdin hook 把完整增强控制键归一化后交给当前 owner。permission/adopt-rule、ask-question、model/channel selector 同步归一化已排队的控制键，保证 pending 结束后仍能拒绝/取消。新增真实 BusyCapture→permission 测试先失败后通过。

sudo 交互和 transcript pager 在释放 stdin/raw/键盘 owner 前，最多等1秒让已发响应排空；未完成则不启动外部程序并提示稍后重试。占用标志在 await 之后同步检查与设置，避免并发启动。**若终端支持增强ESC但永远不回私有CPR，本会话会维持 pending，外部终端交接会继续被拒绝；重新启动会话可重置。** 本阶段不宣称消除这一兼容边界。

## 独立评审最终结论

GPT-6-astra：阶段 PASS，可提交 Draft PR。此前两个协议 P1、输入 owner 交接及外部占用竞态已逐项修正；中英文提示使用 CLI 既有 getUiCopy。独立执行139项相关测试通过。本结论不代表原始缺陷关闭或原生 Ghostty 通过；最终完整 HEAD 的验证结果记录在 PR。
