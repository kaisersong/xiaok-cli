# xiaok-cli 工作规则

## 工作方式与完成标准

- 始终用中文回复。当前重心是 xiaok desktop；根据任务定位相关代码，不把 yzj channel/webhook/websocket 混入无关变更。
- 用户要求实现或修复时，持续完成范围内的实现、运行、检查和必要修复；只做分析的请求保持只读。完成说明区分已完成、阻塞和未验证，并给出实际证据。
- 先确认现有实现是否已解决问题。新功能、行为变更及高风险修复按“设计 → 对抗性评审 → 回归测试 → production code”推进；根因不明或曾回归的修复视为高风险。设计与评审的篇幅随风险调整，不把它们变成等待用户确认的默认停点。
- 纯文案、格式、注释和不改变产品行为的指令整理，做对应检查即可。运行与改动相关的测试和构建；通过后，只有新改动、失败或未解风险才扩大或重复验证。测试调用真实生产入口，不在测试中重实现被测逻辑。
- 保留其他任务的改动；协作时先确认工作归属。worktree 只用于隔离实现，不将 feature worktree `npm link` 到全局；需要验证本地 xiaok 命令时先确认主 checkout 和实际入口。worktree 是否活跃以 `git worktree list` 为准，集成后再清理本任务 worktree。

## 架构与不可省略的边界

- 术语定义与 Avoid 反例统一见 [CONTEXT.md](CONTEXT.md)。开工运行 `npm run hygiene:check`；修改代码后运行 `npm run governance:check`，架构增量查看用 `npm run architecture:check -- --changed`。正常检查不更新存量 baseline。

- Electron main 是 filesystem、SQLite、后台执行、调度、通知、子进程、服务和窗口生命周期的本地事实来源；preload 只提供白名单语义 API；renderer 管展示和局部 UI 状态，不持有 durable state 或后台事实。一个业务轮询只能有一个 owner。
- reminder 是到点通知，scheduled task 是自动执行。变更 IPC 时同步 main handler、preload API/实现、renderer types 和 contract tests。
- agent mutation service 必须显式接收 `requestSource: 'user' | 'agent' | 'scheduler'`，在 service 内按来源与所有权 default deny、allowlist 放行，并有越权拒绝测试。工具描述写“只能/严禁”的边界，避免引导自动取消或删除。安全修复同时审查同权限兄弟入口，不能只堵可零成本绕过的一路就宣称修复。
- 路径用 `path.join` / `path.resolve`；renderer 文件 URL/文件名用 `lib/file-path.ts`。不硬编码本机路径；兼容 Windows 盘符、UNC、大小写和分隔符。Windows 不直接无 shell spawn `.cmd` shim；后台 Node sidecar 用 `process.execPath` 与 `ELECTRON_RUN_AS_NODE=1`。
- CUA 支持 macOS 与 Windows desktop 原生 x64；Windows CLI、ARM64 和其它平台保持关闭。资格 gate 必须早于动态导入 CUA manager 和注册 wrapper；Windows 缺失 CUA 时仍应能启动。改启动/子进程/原生模块/路径相关逻辑时验证 Windows 分支。
- renderer 用户可见字符串全部用 `t.*`，同步 `locales/index.ts`、`zh.ts`、`en.ts`；纯函数接收 labels，带变量用函数 key。AI prompt、技术标识符和注释除外。
- 发布涉及真实 sibling repo 内容：有未提交、未 push、过期 bundle 或缺平台 wheels 时不能称 release ready。本地验证打包禁止签名；只有正式发布才允许签名。

## 关联项目与文档位置

关联 repo 在当前仓库同级，先检查实际路径与状态，不使用历史用户名路径：

| 改动领域 | 同时检查 |
|---|---|
| project/task/deliverable、workflow、artifact handoff、recovery | `../kswarm` |
| participant、协作事件、adapter、broker lifecycle、queued/progress/approval | `../intent-broker` |
| report/slide、MCP/bundled plugins、打包与 runtime path | `../kai-xiaok-plugins` |

用户要求拉取更新时，以上项目一起检查更新；要求提交代码时一起处理相关改动，若只提交一部分，最终说明原因。desktop 打包从 sibling repos 取资源，发布 CI 必须显式 checkout 它们。

`docs` 可能为 symlink，先解析实际目标；其 design/superpowers/analysis/bugfix 均属本任务文档范围，必要编辑不用因 symlink 另行确认。文档改动的 Git 状态在实际文档 repo 中检查。

## 按任务读取专项规则

只读取本次触及的行；一次任务可以匹配多行，不通读整个表。

| 触发条件 | 必读规则 |
|---|---|
| 改 desktop 架构、生命周期、IPC、调度、KSwarm 或 renderer 行为 | [.agents/guidance/desktop-architecture.md](.agents/guidance/desktop-architecture.md)：按领域继续定位设计文档 |
| 改路径、子进程、CLI/runtime startup、CUA、原生依赖 | [.agents/guidance/cross-platform.md](.agents/guidance/cross-platform.md) |
| 新增/修改 agent tool、权限校验、用户 store 写入、外部副作用 | [.agents/guidance/agent-tools.md](.agents/guidance/agent-tools.md) |
| 修改可执行代码并选择测试/构建；排查 sandbox 测试失败 | [.agents/guidance/verification.md](.agents/guidance/verification.md) |
| sibling 资源、构建产物新鲜度、packaging/release/CI | [.agents/guidance/packaging.md](.agents/guidance/packaging.md) |
| `src/ui/**` 或 `src/commands/chat.ts` 中直接影响 TUI 的代码 | [.agents/guidance/terminal.md](.agents/guidance/terminal.md) |
| 新方案、竞品借鉴、安全/性能/检索优化、复杂修复 | [.agents/guidance/evidence-and-design.md](.agents/guidance/evidence-and-design.md) |

性能/token 优化先测真实基线，收益不足 5% 不做（安全动机除外）。检索改动先用真实语料量噪声与失败案例、冻结判定规则和查询分桶，再比较 Hit@K/MRR/NDCG 与无答案误召；保留原验收条件，不能通过缩范围把它们裁掉。

## 开工前读台账

- 开工前读工程经验台账：`kaisersong/mydocs` 仓库的 `xiaok-cli/quality/lessons-ledger.md`（<https://github.com/kaisersong/mydocs/blob/master/xiaok-cli/quality/lessons-ledger.md>）。台账以该文件为准，下面只摘录与本仓库直接相关的规则。
- 派子任务给其他 agent/subagent 时，把台账中相关条目写进任务说明；子任务的个人记忆互相看不到，共用文档才是共同来源。
- 缺陷关闭或发版复盘后，如有新经验，补进台账。每条必须挂「执行机制」（CI 检查、自动化测试、发版清单里的一行、PR 模板里的一项、或本文件里的一条规则），机制为空不算记录完成。

台账中与本仓库相关的规则（摘自台账，修改以台账为准）：

- 「CI 是绿的」不能当证据：发版前相关测试必须在 CI 里真跑过并通过；发版门槛要在已发布的安装包和 tgz 上复验，不按源码推断。
- CI 矩阵必须包含 `engines` 声明的最低版本。
- 发版范围由质量对着「发版门槛」逐项确认；提前发版时当场出「已知未覆盖项」。
- tmux 只用独立 socket（`tmux -L <自己的名字>`），只关自己的会话，不用 `tmux kill-server`。
- 测试收尾必须回收自己起的后台进程并报数量。
- 权限收紧只作用于自己创建的专用子目录，不递归改共享目录权限，不跟随链接。
- 模型调用异常先直接调接口看错误码和返回原文再定性；额度类错误码要立刻提示并切换模型，不无限重试。
- 汇报「已完成」「文件已放好」「评论已发」之前，先核对结果真的存在。
- 修改定时任务前先取到完整原文并留档；读取和修改不放在同一批并行调用里。
- 报告里的每个数字必须对应一份原始日志；机器恢复后不能用对话摘要当证据，要重测。
- 只按自己记录的 pid 或自己的工作目录路径清理进程，不按命令名批量杀；起进程时把 pid 记到自己的文件里。
