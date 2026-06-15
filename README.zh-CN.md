# xiaok-cli

> xiaok-cli 是一个本地优先的 AI 任务交付工作台。它会把用户意图收成可执行的 skill 运行链路，在执行中持续纠偏，并尽量把事情真正做成。代码任务、文档整理、报告/幻灯片生成，以及云之家这类可选 channel 入口，都运行在同一套 runtime 上。

一个面向代码与文档密集型工作的、本地优先的 AI CLI。

[English](README.md) | [简体中文](README.zh-CN.md)

---

## 效果展示

**基准测试结果：**

| 指标 | xiaok v1.0.0 | Claude Code | 提升 |
|------|-------------|-------------|------|
| **自主性得分** | 100% | 100% | — |
| **简单问答延迟** | 3.8s | 7.5s | **-49%** |
| **重命名任务延迟** | 27.6s | 180.8s | **-85%** |
| **Token 效率** | 100% | 250% | **-60%** |

## Xiaok 中的 Loop Engineering

Xiaok 的核心方向是 **Loop Engineering**：不再只是 prompt 一个 agent 做一次事，而是设计一套系统，让它持续发现工作、运行工作、检查工作、记住进度，并决定下一步该做什么。

在 Xiaok 里，prompt 是一次请求，harness 是让一次请求更可靠的执行环境，loop 则是围绕重复 AI 工作建立的持久化运行系统。

| Loop 构建块 | Xiaok 中的落地 |
|-------------|----------------|
| **Automation** | Desktop scheduler、内置 loops、提醒、项目/workflow 触发器，给重复工作一个节奏，而不是每次靠人手动 prompt。 |
| **Work isolation** | KSwarm project、workflow run、task runtime host，以及代码任务里的 git/worktree 感知流程，避免并行工作互相覆盖。 |
| **Skills** | Skill 文件把项目约定、执行步骤、输入输出合同、复核标准写成可复用行为，不再靠每次临场写 prompt。 |
| **Connectors** | MCP 插件、内置 report/slide renderer、Intent Broker、KSwarm、文件系统和可选 channel，把 loop 连接到真实数据和真实产物。 |
| **Sub-agents** | KSwarm 的 PO/worker/reviewer 角色和动态 workflow 分支，把 maker 和 checker 分开；无人值守 loop 不能只依赖自检。 |
| **Memory** | SQLite store、broker event replay、project state、workflow checkpoint、loop run record 和 artifact manifest，让 loop 可以跨会话延续。 |
| **Evidence** | Completion guard、deliverable contract、artifact provenance 和 loop evidence store，让“完成”不是模型说完成，而是有可检查的产物证据。 |
| **Diagnostics** | 只读 loop diagnostics、evidence regression scan 和 KSwarm service health check 把 silent failure 提前暴露出来，避免后台悄悄坏一周。 |

第一批内置生产 loop 是 **Artifact Evidence Regression Loop** 和 **KSwarm Service Health Loop**。它们会定期扫描最近完成的任务与服务可用性，查找缺失 artifact、陈旧 run state、异常交付结果、服务未启动、health 握手失败、broker 不可用和版本/能力不匹配等问题，并写入结构化 diagnostics。这代表 Xiaok 正在走向的模式：人设计 loop，Xiaok 运行 loop，独立 evidence 判断工作是否真的完成。

最小可用的 Xiaok loop 可以很简单：

1. 写一个或复用一个 skill，定义工作内容和输出合同。
2. 加一个触发器，例如 scheduled task、project workflow 或手动运行按钮。
3. 把 memory 持久化到 project state、文件或 SQLite。
4. 加一个 checker，例如 reviewer agent、eval、artifact contract 或 evidence scan。
5. 让失败可见，例如 diagnostics、changelog 或通知。

### 用户循环

Desktop 用户现在可以在 **设置 > Loops** 中创建自己的 Markdown 输出循环。推荐验证路径是：

1. 打开 **设置 > Loops**。
2. 创建一个 Markdown loop，填写清晰 prompt、输出目录和输出文件名。
3. 先手动运行一次，再打开定时自动运行。
4. 在 loop 卡片里检查状态、输出目录入口和产物预览。
5. 只有当手动运行产出符合预期后，再启用 schedule。

每次用户 loop 运行都会落盘一个真实 Markdown 文件，并记录 `file_artifact` evidence。loop 卡片里的输出目录可以直接打开，输出文件复用项目交付物的 artifact preview 能力，用户不用离开 Loops 页面就能检查结果。如果模型已经产出有价值内容但没有按严格合同完成 artifact handoff，Xiaok 会写入一份诊断 Markdown 报告，而不是只留下一个失败卡片；如果没有可恢复的实质内容，运行仍会以 guard 原因明确失败。

Loop diagnostics 也迁移到 **设置 > Loops**。诊断内容支持中英文，会展示 anomaly kind、owner、seen count、建议动作和相关日志，方便区分用户 loop 输出问题、KSwarm 服务健康问题和 artifact evidence 回归。

**v1.4.7 新特性：**

- **用户 Markdown Loops**：设置 > Loops 现在支持用户创建 Markdown loop，包含手动运行、定时自动运行、输出目录选择和明确输出文件名合同。
- **Loop 卡片产物预览**：用户 loop 卡片新增可点击输出目录，并复用 artifact preview 展示生成的 Markdown 文件，用户可以直接在 Loops 页面检查产物。
- **严格 Evidence 恢复**：用户 loop runner 现在会自动创建缺失输出目录，请求 bounded Markdown handoff，在安全时恢复被截断的 handoff marker，写入精确输出文件，校验磁盘文件，并在成功前记录 `file_artifact` evidence。
- **可见失败诊断**：如果 loop 产出了实质 Markdown 但没有满足 artifact handoff，Xiaok 会写入带恢复内容和 guard 细节的失败诊断报告，而不是静默丢失工作。
- **Loop UI 本地化与位置调整**：Loop Diagnostics 从通用设置迁移到设置 > Loops，loop 相关词条已补齐中英文覆盖。
- **发布验证**：v1.4.7 已通过用户 loop runner 聚焦测试、desktop loop 主进程回归、desktop typecheck、desktop packaging，以及 `/Applications/xiaok.app` 已安装应用中的真实用户 loop 运行验证，并成功生成 Markdown 产物。

**v1.4.6 新特性：**

- **KSwarm 启动可靠性追修**：Desktop 现在让显式 service start 与 request 触发的 auto-start 共用同一个受保护启动 promise，避免冷启动期间重复拉起 Intent Broker / KSwarm。
- **Stream 重连加固**：KSwarm WebSocket bridge 在关闭异常 socket 前先清理 handler 并安排重连，避免真实桌面启动中出现 `onerror -> close -> onerror` 递归失败。
- **Completion Evidence 运行时打包**：`dist/` 现在包含编译后的 `completion-evidence` runtime guard，打包 CLI/runtime 会解析到和源码测试一致的 evidence validation 路径。
- **关联服务 replay 容错**：配套 Intent Broker 更新会容忍缺失 `taskId` 的 approval/task lifecycle replay 事件，保留 approval 状态，同时不再让 broker state rebuild 崩溃。
- **发布验证**：v1.4.6 已通过 desktop KSwarm 启动聚焦测试、CLI completion-evidence/task-host 聚焦测试、Intent Broker 全量测试、desktop build、KSwarm/broker live health、Computer Use live smoke，以及 `desktop-v1.4.6` release workflow。

**v1.4.5 新特性：**

- **KSwarm Service Health Loop**：Desktop 新增内置 `kswarm-service-health` loop，会把无监听端口、未知端口占用、health 不可达、HTTP 错误、health JSON 无效、身份/能力不匹配、broker 不可用、spawn 路径缺失、spawn 退出和源码 hash 漂移写成结构化服务诊断。
- **可行动的 Loop Diagnostics**：设置 > Loops 现在展示 anomaly kind、owner、seen count、建议处理动作和相关日志路径，并支持复制诊断摘要，方便支持和排查。通知策略也更轻：新的高危异常提醒一次，重复未解决异常默认去重，source unavailable 连续出现第二次才提醒。
- **更强的 Artifact Evidence 校验**：本地 file artifact evidence 现在会校验文件真实存在且 realpath 留在 workspace 内，覆盖父目录 symlink escape；同时合法 `uri` 或 `metadata.paths` 不会因为陈旧的 `localPaths` 元数据被误拒。
- **发布验证**：v1.4.5 已通过 desktop 全量测试、CLI sandbox 全量测试、loop/evidence 聚焦测试、desktop build/typecheck、intent/skill structured eval、Computer Use live smoke，以及 `desktop-v1.4.5` release tag workflow。

**v1.4.4 新特性：**

- **Loop Evidence System**：Desktop 任务完成现在会把 artifact evidence 持久化到 SQLite，并在 completion guard 运行前先判断任务是否要求硬产物。这补上了反复出现的“task completed without artifact evidence”路径，避免 UI 报告完成但没有可验证交付物。
- **内置 Evidence Regression Loop**：Xiaok 新增定时 loop，用来扫描最近的完成记录、缺失产物、陈旧 run state 和异常交付结果。该 loop 使用单运行锁、会清理 stale diagnostics，并写入结构化 findings，让 silent failure 不再躲在后台。
- **只读 Loop Diagnostics**：Desktop 通过只读 IPC 和设置 > Loops 暴露 loop/evidence diagnostics，操作者可以查看 active run、最近扫描、异常数量和 evidence 状态，不需要直接翻内部数据库。
- **服务与打包验证**：KSwarm 服务启动、内置插件部署、desktop packaging contract 都进入聚焦验证范围。服务状态现在有更清楚的 UI/API 可见性，便于区分 KSwarm / 插件启动失败与模型/runtime 失败。
- **剪贴板文件附件**：从 Finder 复制文件后可以直接粘贴成 chat input chip。输入链路会去重 keydown 与 paste 的双触发，避免 macOS 同时发送两个事件时同一文件被添加两次。
- **发布验证**：本版本按 loop evidence 聚焦测试、desktop packaging contract 测试、renderer/main build，以及 `desktop-v1.4.4` release tag workflow 准备发布。

**v1.4.3 新特性：**

- **看板与工作流融合**：项目任务卡现在直接显示工作流流水线进度——一条细分段进度条（完成 / 运行中 / 失败），加上"工作流执行" chip 和最近的工作流进展消息。用户在看板上就能一眼看出任务的工作流执行情况，不需要切到顶部入口。
- **任务详情抽屉**：点击任意任务卡片，会从右侧滑出 `TaskDetailDrawer`，集中展示任务描述、负责 Agent、执行策略、流水线进度条、按阶段分组的完整工作流节点详情（含并行分组、扇出标签、失败策略、单节点 Agent / 状态 / 错误）、复核反馈和产物。抽屉复用 KSwarm 暴露的工作流数据，5s 轮询后会同步刷新。
- **顶部工作流条紧凑化**：顶部的 `WorkflowStatusStrip` 弱化为纯文本徽章（如"工作流 · Review gate passed"），与"运行工作流"按钮并排。点击徽章仍可展开完整工作流详情弹窗，并改为右锚点，避免被视口右侧截断。
- **共享 `workflowUtils`**：状态图标、tone class、状态文案、进度格式化、公开视图归一化、通用工作流视图构建器被抽取到 `workflowUtils.ts`。新增 `findWorkflowRunForTask`（按 `task.execution.workflowRunId` / `scope.taskId` / `sourceTask.id` 匹配任务对应的 workflow run）和 `computeTaskPipelineProgress`（把 `KSwarmWorkflowRun` 归约为 `TaskPipelineProgress`）两个工具，看板卡片与抽屉共用同一份逻辑。
- **不动后端和数据模型**：本次只改 desktop 渲染层 UI。KSwarm 数据模型、项目 API、任务语义保持不变。

**v1.4.1 新特性：**

- **产物预览修复**：项目交付物（Markdown、HTML、纯文本）现在可以在预览面板中正确加载。此前版本对所有 kswarm GET 请求统一使用 JSON 解析代理，导致文本类产物内容解析抛出异常，显示"加载失败: fetch failed"。现在引入专用的原始文本 IPC 代理（`kswarmProxyGetText`）用于产物内容请求。
- **应用打包修复**：修复了因 `release/mac-arm64` 目录残留导致的打包失败，改用 `ditto` 安装 macOS 应用包以保留扩展属性和 bundle 结构。

**v1.4.2 新特性：**

- **交互式 A2UI 看板产物**：Xiaok Desktop 现在可以在对话中直接回放安全的只读 A2UI 产物，支持标题、说明文本、指标、列表、表格、分割线和结论等 section。渲染器只接受小型安全组件目录，不接收 raw HTML，因此看板式交付物可检查、可沙箱化。
- **自然语言看板请求链路**：A2UI 路径新增基于 `/Applications/xiaok.app` 已安装应用的 E2E 覆盖，测试输入是自然语言的复杂 AI 产品运营看板需求，而不是内部工具名。测试会验证真实打包应用中产物可以内联渲染，并且步骤摘要保持简洁。
- **工具名隐藏与 section 兼容**：用户可见的 tool step 不再显示内部看板工具名，而是显示 `dashboard [A2UI]`。A2UI validator 同时支持常见的 `type` / `text` section alias，并返回更具体的校验错误，修复了原先有效看板请求也可能触发"未知 section"的问题。
- **ESC 流式中断**：终端 assistant 正在 streaming 输出时按 `ESC`，会中断当前 model/tool turn，而不是等待本轮自然结束。Xiaok 会保留输入 draft 和 queued text，把本轮记录为用户中断，并阻止已中断的 Stop-hook 路径继续 auto-continue。
- **Abort-safe Runtime Pipeline**：Anthropic、OpenAI Chat Completions、OpenAI Responses 流现在共享 `AbortSignal`，真实 `AbortError` 不再进入 retry，stream timeout controller 在所有退出路径都会清理。runtime、compact、subagent、tool execution 层都会透传同一个 signal，把用户中断和传输失败分开处理。
- **Desktop Handoff 取消**：KSwarm runtime bridge handoff 现在接收取消 signal；用户中断的 desktop task 会报告 `task_cancelled`，不再被误归类为 failed。

**v1.3.14 新特性：**

- **流式重试加固**：Anthropic、OpenAI Chat Completions、OpenAI Responses 适配器现在会把 `ERR_STREAM_PREMATURE_CLOSE`、`ECONNRESET`、`ETIMEDOUT`、`EPIPE`、`Premature close`、`socket hang up`、`terminated`、`fetch failed` 识别为可重试的传输错误。一旦本次尝试已经向消费端产出了 chunk，就立即放弃重试，避免重复输出。OpenAI Chat Completions 适配器还新增 5 分钟单次流超时与 AbortController。
- **Stale Running 任务自愈**：`InProcessTaskRuntimeHost.recoverTask` 会对进程重启后仍处于 `running` 但没有活跃执行的任务做抢救，转为 `failed` 并写入 `stale_running_task_recovered` 抢救摘要，不再让快照永久卡在 running。
- **KSwarm Runtime 任务重试**：桌面端 `runKSwarmRuntimeTextTask` 现在会在传输类故障下额外重试一次，并从 `salvage.reason` 或最近的 error event 还原真实失败原因，仅对网络/流类失败重试。
- **动态工作流 HTML 报告工具**：新增 `render_report_artifact` 工具，把完整的 `.report.md` IR 渲染为 HTML 产物，作为动态工作流最终报告节点的输出。Worker / final-output / generic 节点 prompt 现在明确要求先生成完整 `.report.md` IR 再调用 `render_report_artifact`，而不是读取 `~/.xiaok/plugins` 插件内部文件或手写 HTML。
- **跨平台兼容规则**：`AGENTS.md` 现在公开了适用于 xiaok-cli、kswarm、intent-broker、kai-xiaok-plugins 的跨平台规则：必须用 `path.join` / `path.resolve`，禁止硬编码 `/` 或 `\` 分隔符；macOS 专有能力（CUA driver、`open`、`.app` bundle 路径、`launchctl`、`defaults`）必须有 `process.platform` 守卫；Windows 专有能力（`reg`、`cmd /c`、`explorer.exe`）同样要守卫；`child_process` 不能依赖 Unix shell 语法；Windows 路径比较默认 case-insensitive。

**v1.3.13 新特性：**

- **并行动动态 Workflow Script**：xiaok Desktop 现在支持第一条并行动动态 workflow script 路径。受控 workflow script 可以用 `parallel([() => agent(...), ...])` 扇出多个独立 agent 分支，同时把编排过程放在主对话上下文之外。
- **KSwarm 持久化并行状态**：`parallel()` 不再只是内存里的 `Promise.all`。KSwarm 会持久化 `parallelGroups`、分支节点元数据和 `scriptCheckpoints`，项目详情、日志和 API snapshot 都能解释哪些分支运行过、如何完成。
- **对话先预览再运行**：`run_dynamic_workflow_script` 工具现在支持 `previewOnly`，assistant 可以先生成 workflow 预览让用户确认，再启动 run。确认后的 run 会进入后台执行，并立即返回 `workflowRunId`。
- **同一 Run 恢复与状态查询**：`resumeWorkflowRunId` 可以在同一个 workflow run 上复用已完成 parallel group 和 agent node 输出，避免重复派发已完成节点；`get_dynamic_workflow_status` 会从 KSwarm snapshot 汇总 run / node / parallel / checkpoint / gate / delivery 状态。
- **专业报告复核模板**：工具内置 `report_final_review` script 模板，会并行执行事实、证据、格式/交付合同三路复核，再归约成最终 gate 建议。
- **HTML/PDF 专业 E2E**：动态 workflow E2E 现在会新建 KSwarm 项目，运行专业并行复核脚本，产出 HTML 和 PDF，并验证 workflow run、gate decision、项目 deliverable、artifact provenance 和任务看板状态一致。
- **失败策略基础语义**：并行 runtime 已支持 `required_all`、`collect_errors` 和 `quorum` 语义，KSwarm quorum 分组归约已进入 workflow 测试。
- **工作流状态可见**：项目 workflow 详情现在会从 KSwarm snapshot 展示并行分组、分支完成数、失败策略、分支标签和脚本 checkpoint 进度，不再从聊天 transcript 推断状态。
- **聚焦测试、E2E 和 Eval 覆盖**：本版本覆盖 eager parallel call 拒绝、runtime 分支标注、KSwarm 并行分组持久化、HTTP contract、后台工具启动、resume primitive 复用、状态查询工具、dynamic workflow eval case，以及一条通过 KSwarm 和 desktop runtime bridge 完成的动态脚本 workflow E2E。

这是 dynamic workflow orchestration 的基础版本，不是完整开放式用户 workflow 平台。跨应用重启后的自动 script job recovery、durable user-input pause/resume 和专业质量对比 eval 仍属于后续阶段。

**v1.3.11 新特性：**

- **基础版 Dynamic Workflow Script Runtime**：xiaok Desktop 现在可以通过 KSwarm、Intent Broker 和 Desktop agent runtime bridge 跑受控的动态 workflow script。脚本可以创建 phase、动态调用 `agent(...)`、收集节点输出，并完成持久化的 `script_generated` workflow run
- **真实执行 Agent 节点 Prompt**：脚本生成的 workflow agent 节点现在会执行节点自己的 prompt，不再退回“项目诊断”。普通 `script-agent-*` 节点会拿到产物目录，写入真实文件，并返回结构化 artifact manifest
- **项目交付同步**：script workflow 完成后，KSwarm 可以从最终产出 artifact 的 agent 节点交付项目，把看板任务标记为完成，并把交付物 provenance 写回项目和任务结果
- **输出合同防线**：当最终任务要求 HTML 时，动态 workflow 不会再把 markdown/json 辅助产物当作合格交付。缺少终态硬输出会阻断项目交付，并明确记录 `missing` 信息，而不是静默标记完成
- **端到端 Workflow 覆盖**：本版本新增真实 E2E，启动 Intent Broker 和 KSwarm，通过 runtime bridge 注册桌面 worker，运行动态脚本 workflow，创建动态 agent 节点，写入 artifact，并验证项目交付和任务看板完成状态

**v1.3.10 新特性：**

- **项目级高质量工作流**：高质量执行现在会创建项目级 `po-generated-project-workflow`。一个 workflow 负责项目的计划、派发、复核和最终汇总交付，不再把项目拆成彼此割裂的任务级 workflow
- **执行方式贯穿项目合同**：快速执行、智能选择、高质量执行会保持在项目级合同里，并传入 KSwarm 派发链路；选择高质量后不会再静默退回快速 worker prompt
- **Artifact-first 工作流门禁**：workflow finalize 会拒绝缺失、不可读、工作区外或非文件型任务产物，并从提交文件重建 evidence refs；只有真实交付物被挂上后，workflow 才能通过
- **Desktop 工作流验证修复**：审批、Agent 复核诊断和最终状态展示都做了加固。复核弹窗保持实色背景，隐藏内部预算/权限/最大节点字段，workflow run 以可读的运行中/已完成/失败状态收尾

**v1.3.9 新特性：**

- **任务级 Dynamic Workflow**：项目任务卡片现在可以直接“用工作流执行”。KSwarm 会先创建带 `scope.taskId`、源任务、预算硬上限、权限和验收标准的 pending workflow proposal，确认前不会派发任何 agent
- **受控 PO 生成工作流建议**：第一条 `po-generated-task-workflow` 链路会为当前任务生成 validated workflow IR，展示确认卡后再启动；当前版本明确不执行 raw JavaScript，也不开放任意用户脚本
- **预算、缓存、恢复和进度可见**：工作流详情会展示预算硬上限、最近实质进展、阻塞失败、run 内已保存节点结果和恢复方式，避免只显示“执行中/已完成”
- **工作流交互加固**：工作流菜单和确认弹层保持不透明背景，入口继续收敛在项目 tab 行，不再占用首屏大面板；日志仍是 Swarm + Workflow 融合时间线

**v1.3.8 新特性：**

- **基础版 Dynamic Workflow**：xiaok Desktop 已经在 KSwarm 项目里落地第一条项目级动态工作流路径。项目可以创建持久化 workflow run，执行内置快速诊断，也可以启动 agent-backed 复核诊断，按 Worker agent、对抗性 Reviewer agent、review gate reducer 的链路推进
- **Workflow Orchestrate Agent 模式**：项目控制层仍由 KSwarm 负责，workflow 执行发生在 agent 层；因此 Xiaok 项目现在有两条清晰路径：轻量的 direct/quick orchestrate agent，以及结构化多步骤的 workflow orchestrate agent
- **工作流日志融合进项目时间线**：项目详情页 tab 仍叫“日志”，右侧统一成“运行工作流”菜单，`Workflow` 与 `Swarm` 事件按时间融合展示，并过滤重复的 raw `workflow.*` activity event
- **动态工作流路线图文档**：设计文档补齐了后续演进路径，包括用户预算确认、subagent 结果缓存、typed progress 聚合，以及 reviewer/adversarial agent gate

**v1.3.7 新特性：**

- **Slide Renderer 恢复修复**：Desktop 正式安装包现在会把陈旧的内置插件 symlink 备份并替换为安装包内的 `kai-slide-creator`，避免旧开发目录或错误平台 wheelhouse 继续导致 `slide-renderer` MCP 启动失败

**v1.3.6 新特性：**

- **Auto 模式安全边界**：`/mode auto` 只自动批准低风险工具调用；高风险 Bash 命令仍要确认，灾难性命令继续直接阻断
- **CUA 权限归因修复**：Desktop 不再从 Xiaok 健康检查里运行 `cua-driver doctor`，避免 Xiaok 自己触发 macOS 录屏权限弹窗
- **Computer Use Shell 绕路封锁**：任务不能再通过 Bash 自行启动或修复 CUA，例如 `open -a CuaDriver`、`cua-driver serve`、删除 socket、`screencapture`、`cliclick` 或驱动 UI 的 `osascript`
- **交互式 Shell 交接**：本地 shell escape 会正确暂停和恢复终端 UI，交互命令不再污染对话输入状态
- **CUA 恢复加固**：Computer Use daemon stale-state 恢复有聚焦测试覆盖，并且恢复动作保持在产品管理的 CUA 流程内

**v1.3.5 新特性：**

- **Computer Use 启用闭环**：`xiaok_computer_use` 现在是稳定的产品工具；CUA 未就绪时返回结构化可恢复错误，对话区显示 Computer Use 动作卡片，不再把原始 MCP 失败暴露给用户
- **CUA 权限与恢复流程**：Desktop 区分首次用户点击启用和后续自动恢复，通过 `CuaDriver.app` 启动以保证 macOS TCC 归因正确，能识别空截图输出，并且只在可信正式安装包里自动恢复
- **定向插件重连**：启用 Computer Use 只重连 `cua-driver` MCP server，不再误重启 report/slide renderer 插件
- **Shell 绕路防护**：`screencapture`、`cliclick`、`cua-driver`、驱动 UI 的 `osascript` 等屏幕自动化绕路命令现在必须进入审批，不会静默绕过 Computer Use
- **安装包运行时可靠性**：KSwarm 和 Intent Broker 后台服务在打包环境下会使用 Electron runtime 作为 Node，不再依赖用户 shell 里的 `node` PATH
- **桌面更新与品牌修复**：更新安装会在 `quitAndInstall` 前进入真实退出状态并报告安装错误；macOS Dock 图标优先使用应用 bundle 内的 `icon.icns`
- **构建循环与烟测覆盖**：Desktop release 仍走 clean build，日常开发保留增量 `build:main`；当前 smoke 覆盖 84 个文件、587 个测试

**v1.3.4 新特性：**

- **Swarm 项目可靠性加固**：KSwarm 项目里的小K种子 PO/Worker 现在进入真正的 Desktop agent runtime，不再交给能力残缺的 sidecar worker；模型、工具、MCP、web-search、report/slide renderer 能力保持一致
- **文件化任务交接**：大上下文、任务要求、证据合同和产物合同通过 handoff 文件传递，不再用超长 broker 文本硬塞，降低截断风险，也方便恢复和审计
- **带证据的计划与验收**：本月/最近类调研任务会带当前日期、外部来源证据和更合理的质量门禁，PO 不再要求未来数据或拍脑袋的固定条数
- **面向用户的正式交付物**：最终文件名按项目/目标生成，提交用产物里不出现评审回应、修订说明、第二轮定稿等过程痕迹；报告/演示文稿优先走对应 renderer
- **项目界面可解释性修复**：项目卡片、任务看板、产物列表、HTML 预览、临时定时恢复任务和 agent 状态显示更清楚，失败原因、时间点和可恢复动作可见
- **发布打包同步**：Desktop release 构建会把当前 Xiaok、KSwarm、Intent Broker 和 bundled plugins 一起 checkout、构建和打包

**v1.3.2 新特性：**

- **桌面更新链路恢复**：修复 `electron-updater` CJS/ESM interop 导致“检查更新”静默无反应的问题
- **主动升级提醒**：当发现新版桌面端时，左下角设置 icon 左侧会显示清晰的升级/下载/安装提醒
- **定时任务恢复**：Desktop 定时任务会修复缺失的 `nextRunAt`，自动执行结果会关联回任务 Thread，删除任务也会同步移出主进程调度状态
- **KSwarm 重新制定计划改派 PO**：“重新制定计划”现在会检查项目里保存的 PO 是否缺失、归档、角色不对、启动失败或仍是旧 `xiaok` 单体；异常时会改派到当前最合适的 Xiaok PO，并带完整项目上下文重新发起规划
- **发布门禁**：desktop release CI 会把桌面 tag 标记为 GitHub Latest，并校验 `latest-mac.yml`、`latest.yml` 和安装包资产一致后才算发布有效
- **一次性手动恢复**：桌面版 `0.5.6` 和 `1.3.1` 可能已经带着本地 updater loader 缺陷，受影响用户需要手动安装一次 `1.3.2`；之后才能通过修复后的应用内更新继续升级

**v1.3.1 新特性：**

- **KSwarm 可靠性版本**：新增 runtime 健康探测、卡住运行 watchdog、按能力路由，以及对“在线但 CLI 不可执行”的 agent 自动降级/冷却
- **项目规划可恢复**：如果 Xiaok/Desktop 或 PO agent 在制定计划阶段中断，项目详情页会显示“重新制定计划”，项目不再卡死
- **交付物合同校验**：显式要求 PPTX/HTML/Markdown 的任务会在进入 PO 验收前校验产物类型，Markdown 不再能冒充幻灯片交付
- **本地执行器注册表**：当没有健康 agent 具备 PPTX 输出能力时，明确要求 PPTX 的演示任务可以使用确定性的注册执行器兜底
- **桌面配置保持**：Desktop 启动与发布流程统一使用真实用户 HOME，模型、skill、plugin、channel 配置不会因为隔离 HOME 消失
- **发布打包刷新**：macOS 与 Windows 桌面产物统一从 1.3.1 源码和插件 bundle 基线构建

**v1.2.0 新特性：**

- **KSwarm 蜂群式项目交付**：在对话中创建多智能体协作项目 — Agent 自动选择 PO + 成员，分发任务，团队协作交付高质量成果
- **长期记忆**：Agent 跨会话记住用户偏好、姓名、习惯，通过 `notebook_write`/`notebook_read` 工具持久化
- **记忆管理界面**：在设置面板中查看、新增、删除持久化记忆条目
- **Agent 设置面板**：配置 Agent 人格、Spawn Profile、LLM Provider 绑定
- **模型配置增强**：Provider 设置支持协议选择和高级 JSON 配置
- **更智能的任务交付**：TaskPanel 分步进度上报，Agent 自主规划和追踪多步骤工作

**v1.1.0 新特性：**

- **产物 Canvas 修订**：HTML 预览中点击"修订"标注元素，携带完整 DOM 上下文向 Agent 发送修改指令
- **预览自动刷新**：Agent 修改产物文件后 Canvas 预览自动重新加载
- **产物卡片**：Claude 风格文件卡片，带类型图标、标题和"打开"按钮，产物一目了然
- **欢迎页改版**：个性化打字机问候语，面向企业场景的快速提示词
- **个人资料设置**：通用设置中可编辑显示名称和头像（localStorage 存储，系统用户名降级）
- **插件打包方案**：完整的桌面端插件生命周期设计文档（esbuild + Python venv）

**v1.0.0 新特性：**

- **完整 i18n 支持**：桌面版全量中英文国际化，支持运行时语言切换
- **KSwarm 多智能体**：多 AI 智能体协作执行复杂任务，状态实时监控
- **项目管理**：看板、需求跟踪、智能体分配、活动时间线、产物视图
- **定时任务**：支持 cron 表达式的周期任务，可暂停/恢复/手动执行
- **插件系统**：从 GitHub 或本地安装、管理 MCP Server 插件
- **桌面版 v1.0.0**：原生 macOS/Windows 应用，侧边栏、Canvas 预览、设置界面、自动更新

**典型使用场景：**

1. 本地终端交互式对话：`xiaok`
2. 恢复上次会话：`xiaok -c`
3. 单次任务执行：`xiaok "review the changes"`
4. 通过已安装 skill 生成报告、brief 或幻灯片
5. 启动本地 daemon：`xiaok daemon start`
6. 可选的云之家 / 移动端接入：`xiaok yzjchannel serve`、`/yzjchannel`

---

## Swarm 项目

xiaok Desktop 内置 KSwarm 项目交付能力，适合需要计划、并行执行、质量验收和最终汇总的工作。一个项目包含人类审批过的计划、PO agent、worker agents、任务看板、产物和最终交付物。

### 基础版 Dynamic Workflow

v1.3.13 在 KSwarm 项目之上扩展了基础动态工作流能力。它还不是面向用户的通用 workflow builder，也还不是执行任意 raw JavaScript 的开放平台，但已经是一条真实的 durable workflow runtime 切片：

- **持久化 workflow run**：KSwarm 会记录 workflow run 的 phase、node、状态、进度、gate decision 和时间戳，Desktop 可以刷新、恢复展示并审计执行过程。
- **快速诊断工作流**：系统内置控制流检查项目状态、阻塞原因、可派发任务和推荐动作，不调用智能体，适合秒级项目体检。
- **Agent 复核诊断工作流**：Xiaok 可以启动结构化 workflow，先派 Worker agent 做项目诊断，再派 Reviewer/PO agent 做对抗性复核，最后通过 gate 归约决策。
- **项目级高质量工作流**：高质量项目执行会在项目 scope 创建单个 `po-generated-project-workflow`。workflow 负责任务派发、review gate 和最终交付物提交，不再把项目拆散成互不关联的任务级 workflow。
- **任务级手动工作流执行**：任务卡片仍可在用户明确想重跑或检查某个任务时打开 `po-generated-task-workflow` proposal。proposal 会带 task scope、预算、权限和验收标准，必须人工确认后才 dispatch。
- **受控 PO 生成建议**：KSwarm 可以根据项目/任务上下文生成 validated workflow IR。当前版本是受控模板，用来验证 proposal 和审批链路；不会执行模型生成的 raw JavaScript 或任意用户脚本。
- **受控动态脚本执行**：可信模型生成的 workflow script 可以在受限 desktop runtime 中运行。脚本可以创建 phase、调用 `agent(...)`、使用 thunk 形式的 `parallel(...)`、返回终态结果，或用结构化原因阻塞 run。
- **持久化并行编排**：并行脚本分支会进入 KSwarm `parallelGroups`，记录分支节点身份、fan-out 标签、required/schema/evidence 元数据和脚本 checkpoint。xiaok 能展示并行进度，而不是依赖聊天 transcript。
- **对话优先的预览确认**：动态脚本工具可以先返回 `previewOnly` workflow plan，用户确认后再启动。启动后后台执行并返回 `workflowRunId`，后续状态查询都读取 KSwarm snapshot。
- **同一 run 恢复与状态查询**：对话 agent 可以传 `resumeWorkflowRunId` 继续同一个脚本 run，并复用已完成 primitive；也可以调用 `get_dynamic_workflow_status` 查询 KSwarm run、node、parallel group、checkpoint、gate、delivery 和后台 job 状态。
- **专业报告终态复核**：内置脚本示例展示了专业 workflow 的基本形态：先盘点交付物，再并行做事实/证据/格式合同复核，最后归约成 gate 建议。
- **Artifact-first 交付门禁**：workflow 中完成的任务必须提交可读的工作区内文件或有效产物引用。finalize 会从这些文件重建 evidence，遇到缺产物、不可读、工作区外、或只有文字摘要时会阻断交付。
- **预算、缓存、恢复和进度 UI**：工作流详情会展示 hard budget、最近实质进展、blocking failure、run 内已保存节点结果和恢复方式。
- **清晰的界面语义**：右侧动作统一为“运行工作流”菜单；项目 tab 仍保留“日志”，因为它同时包含 Swarm 活动和 Workflow 活动。
- **融合时间线**：Workflow run 和 Swarm activity 按时间进入同一条项目日志，通过来源标签区分，而不是上下分区或置顶专区。

这条实现明确了 Xiaok 的 dynamic workflow 产品方向：KSwarm 继续作为项目控制层，workflow orchestration 在 agent 层执行；当前从内置 workflow 和受控 PO-generated proposal 起步，后续可以演进到更丰富的动态生成执行计划。

v1.3.4 的 Swarm 路径重点把职责边界理清：

- **KSwarm 负责项目生命周期**：项目状态、计划审批、阶段派发、任务状态、重试、评审记录、交付清单和恢复决策。
- **Agent 负责真实执行**：小K种子 PO/Worker 走完整 Desktop agent runtime；Claude、Codex、Qoder 等外部 agent 通过各自 broker adapter 执行。
- **Renderer 负责正式输出**：用户要求报告或演示文稿时，优先生成 renderer-backed HTML 产物；只有用户明确要求 Markdown 或 PPTX 时才强制对应格式。
- **Artifact 是事实来源**：任务完成必须提交真实文件或可解析的产物引用，不能只在摘要里说“已生成”。
- **质量门禁按任务语境生效**：硬门禁只覆盖缺产物、格式不对、缺来源证据、renderer shell 无效等客观合同；“本月产品动态要几条才够”这类内容要求应来自项目类型知识，而不是全局硬编码。

这让 Swarm 项目更适合调研报告、产品分析、技术大会演讲准备、文档生产等多步骤交付场景：用户能看到进度，也能在中断后恢复。

---

## 设计理念

### 1. 意图优先的任务交付

xiaok 的目标是让用户感觉“AI 在做事”，而不是“我在操作一个流程系统”。

- 重要请求会被视作带交付物的 intent，而不是普通聊天 turn。
- skill 会按当前意图和阶段去匹配，并结合运行时证据做轻量重排。
- 多阶段工作主要在内部编排，用户看到的是进展和结果，不是模板流程。
- 最终输出应该更像交付结果，而不是状态回执。

### 2. 7 层 Prompt 架构

System Prompt 采用 CC 风格的 7 层设计，显式静态/动态分界：

**静态前缀（可缓存，跨 turn 稳定）：**

| 层 | Section | 内容 |
|---|---------|------|
| 1 | Intro | 角色定义 — 任务交付型 AI skill 工作台；苍穹/云之家属于擅长场景 |
| 2 | System | 运行时规则 — permission mode、prompt injection 防护 |
| 3 | DoingTasks | 任务哲学 — 不加功能、先读后改、安全意识 |
| 4 | Actions | 风险边界 — 破坏性操作需确认 |
| 5 | UsingTools | 工具语法 — read 不用 cat、并行调用 |
| 6 | ToneAndStyle | 交互风格 — 简洁、file_path:line_number |
| 7 | OutputEfficiency | 输出效率 — 先说结论不铺垫 |

**动态后缀（每 turn 重建）：**
- 会话上下文、Session Guidance、Memory 注入、Token Budget、自动上下文

### 3. 安全优先

**Bash 安全分类器**（三级风险）：

| 级别 | 命令示例 | 行为 |
|------|----------|------|
| Block | `rm -rf /`、`mkfs`、`curl|sh` | 直接拒绝 |
| Warn | `rm -rf`、`git reset --hard`、`DROP TABLE` | 需确认 |
| Safe | 其他命令 | 直接执行 |

**工具输入校验** — JSON Schema 验证器在每次工具调用前校验必填字段和类型。

### 4. 分阶段上下文管理

长任务不应该无限堆成一个越来越飘的大上下文。xiaok 会把完整事实保存在会话状态里，但尽量只把当前阶段需要的内容投影给模型：

1. **微压缩** — 工具结果超过 8000 字符自动截断
2. **阶段交接** — 阶段完成后可把 artifact 交接到新的上下文，而不是把整条历史硬拖下去
3. **记忆回注** — compact / handoff 后把相关记忆重新注入会话

### 5. 类型化记忆

持久化文件记忆存储，支持类型分类：

- `user` — 用户偏好、角色、知识
- `feedback` — 用户对 AI 行为的确认/纠正
- `project` — 项目进度、决策、bug
- `reference` — 外部资源指针

### 6. 非侵入多 Agent 协作

通过 Intent Broker 生命周期 hook 接入：
- SessionStart / UserPromptSubmit / Stop
- session_id / transcript_path 上下文注入
- auto-continue 多 Agent 协作

---

## 安装

### npm 安装

```bash
npm install -g xiaokcode
```

更新到最新版本：

```bash
npm update -g xiaokcode
```

安装后直接运行：

```bash
xiaok
```

npm 包名是 `xiaokcode`，但 CLI 命令仍然保持 `xiaok`。

### 源码安装（开发用）

```bash
git clone https://github.com/kaisersong/xiaok-cli ~/.xiaok-cli
cd ~/.xiaok-cli
npm install
npm run build
```

源码安装路径只用于参与 `xiaok-cli` 开发，或需要保留本地 git 仓库的场景。

### 配置

**全局配置：** `~/.xiaok/config.json`

```json
{
  "schemaVersion": 2,
  "defaultProvider": "anthropic",
  "defaultModelId": "anthropic-default",
  "providers": {
    "anthropic": {
      "type": "first_party",
      "protocol": "anthropic",
      "apiKey": "your-api-key",
      "baseUrl": "https://api.anthropic.com"
    },
    "kimi": {
      "type": "first_party",
      "protocol": "openai_legacy",
      "apiKey": "your-kimi-key",
      "baseUrl": "https://api.kimi.com/coding/v1"
    }
  },
  "models": {
    "anthropic-default": {
      "provider": "anthropic",
      "model": "claude-opus-4-6",
      "label": "Anthropic Default",
      "capabilities": ["tools"]
    },
    "kimi-k2-thinking": {
      "provider": "kimi",
      "model": "kimi-k2-thinking",
      "label": "Kimi K2 Thinking",
      "capabilities": ["tools", "thinking"]
    }
  },
  "channels": {
    "yzj": {
      "webhookUrl": "https://...",
      "inboundMode": "websocket"
    }
  }
}
```

旧的 schema v1 配置会在加载时自动迁移。也可以直接用 CLI 维护 provider 和 model catalog：

```bash
xiaok config set model anthropic
xiaok config set model kimi/kimi-k2-thinking
xiaok config set api-key <key> --provider kimi
xiaok config get providers
xiaok config get models
```

**项目配置：** `<repo>/.xiaok/settings.json`

**快捷键：** `~/.xiaok/keybindings.json`

---

## 桌面版

xiaok Desktop 是一个原生 macOS 应用，为 xiaok 运行时提供图形界面。它与 CLI 共享同一套后端，但提供侧边栏浏览任务历史、Canvas 预览生成的文件、以及设置管理界面。

### 下载

从 [GitHub Releases](https://github.com/kaisersong/xiaok-cli/releases) 下载：

- **xiaok-1.4.6-arm64.dmg** — macOS DMG 安装包（Apple Silicon）
- **xiaok-1.4.6-arm64-mac.zip** — macOS ZIP 包（Apple Silicon）
- **xiaok-setup-1.4.6.exe** — Windows 安装包（x64）

### 功能特性

- **任务侧边栏**：浏览最近任务，切换时显示选中高亮
- **Canvas 预览**：自动打开生成的文件（HTML、MD、PDF）在侧边面板
- **项目管理**：看板拖拽、智能体分配、活动时间线
- **KSwarm 多智能体**：从界面创建、审批、恢复、验收和交付多智能体项目
- **基础版 Dynamic Workflow**：以持久化 workflow run 运行项目快速诊断、Agent 复核诊断、项目级高质量工作流和任务级手动 workflow proposal，包含预算、缓存、恢复、进度、Reviewer、artifact 和 gate 元数据
- **定时任务**：创建周期任务（每小时、每天、每周、cron）
- **插件系统**：安装和管理 MCP Server 插件，支持启用/禁用
- **国际化**：完整中英文支持，运行时切换语言
- **设置界面**：配置模型提供商、技能、消息通道、MCP 服务器
- **自动更新**：新版本发布时自动通知更新，并在设置按钮左侧显示升级提醒

### 开发构建

本地构建桌面版：

```bash
cd desktop
npm install
npm run build
npx electron-builder --mac --arm64
```

---

## 使用方式

### 基本命令

```bash
# 交互式对话
xiaok

# 恢复上次会话
xiaok -c

# 恢复指定会话
xiaok --resume <session-id>

# 单次任务
xiaok "review the current workspace changes"

# 管理本地 daemon
xiaok daemon start
xiaok daemon status
xiaok daemon stop

# 启动云之家 IM 网关
xiaok yzjchannel serve
```

### 会话内命令

```text
/exit                         退出会话
/clear                        清屏
/compact                      压缩当前会话上下文
/context                      查看当前仓库上下文
/mode [default|auto|plan]     查看或切换权限模式
/models                       切换模型
/reminder <自然语言>          创建提醒
/reminder list                查看提醒列表
/reminder cancel <id>         取消提醒
/settings                     查看当前生效配置
/skills-reload                重新加载已安装 skill
/yzjchannel                   连接嵌入式云之家 channel
/help                         显示帮助
/<skill-name> [args]          调用 skill
```

`auto` 模式会自动批准低风险工具调用。递归删除、硬重置、强推、数据库删除、屏幕自动化 shell fallback 等高风险 Bash 命令仍会要求确认；灾难性 Bash 命令继续由 Bash 安全分类器直接阻断。

### 云之家 IM 命令

```text
/help                    显示帮助
/bind <cwd>              绑定工作区
/bind clear              清除工作区绑定
/status [taskId]         查看任务状态
/approve <approvalId>    批准待审批动作
/deny <approvalId>       拒绝待审批动作
/cancel <taskId>         取消运行中任务
/skill <name> [args]     调用 skill
```

### 典型工作流

**本地开发：**

```bash
# 初始化项目
xiaok init

# 交互式开发
xiaok "add user authentication"

# 代码审查
xiaok review

# 提交
xiaok commit
```

**云之家集成（可选 channel 适配器）：**

```bash
# 配置
xiaok yzjchannel config set-webhook-url "https://..."

# 启动网关
xiaok yzjchannel serve

# 在云之家机器人聊天窗口使用
/help
/bind /Users/song/projects/my-project
/skill commit -m "fix: bug"
```

---

## 功能特性

### 核心功能

- **7 层 Prompt 架构** — CC 风格 section 函数，静态/动态分界，每 turn 动态注入
- **Provider catalog + 多模型** — 内置 Anthropic/OpenAI/Kimi/DeepSeek/GLM/MiniMax/Gemini 一等 provider，并支持自定义 endpoint
- **Bash 安全** — block/warn/safe 三级分类，拦截危险命令
- **工具输入校验** — JSON Schema 验证器，每次调用前校验
- **类型化记忆** — user/feedback/project/reference 分类存储
- **本地 daemon + 提醒** — 基于 SQLite 的 durable reminder scheduler，daemon/client 隔离

### 技能系统

- **三层技能** — 内置、全局、项目级分层加载
- **依赖解析** — 技能间依赖自动解析
- **allowed-tools** — 白名单约束技能可用工具
- **安装/卸载** — 技能目录加载与刷新
- **结构化 skill 合同** — 支持 `required-references`、`required-scripts`、`required-steps`、`success-checks`
- **严格执行可靠性** — execution bundle、evidence 记录、completion gate 和 adherence eval

### 内置 Agent

| Agent | 角色 | 工具 |
|-------|------|------|
| Explore | 只读探索 | read/grep/glob/bash(ls/git) |
| Plan | 仅规划 | read/grep/glob |
| Verification | 对抗测试 | read/grep/glob/bash |

### LSP 代码智能

内置 `lsp` 工具：

| 操作 | 说明 |
|------|------|
| goToDefinition | 跳转定义 |
| findReferences | 查找引用 |
| hover | 悬停文档 |
| documentSymbol | 文档符号列表 |

### 会话管理

- **自动保存** — 每次对话自动保存
- **恢复会话** — `xiaok -c` 恢复上次，`xiaok --resume <id>` 恢复指定
- **Session ID** — 退出时显示，方便追溯

### 本地 Daemon 与提醒

- **`xiaok daemon` 宿主** — `start/status/stop/restart/update/serve`
- **按 OS 用户单例运行** — 多个 chat 实例共享一个本地 daemon
- **Durable reminder** — SQLite 持久化、恢复、重试、按 session 绑定投递
- **实例互不拖垮** — daemon 异常不阻塞 chat 启动，chat 退出不影响 daemon

### 云之家 IM 集成

- **嵌入式 Channel** — 会话内 `/yzjchannel` 直连
- **WebSocket/Webhook** — 双模式入站支持
- **审批处理** — 待审批动作两端推送
- **生命周期管理** — 跟随 chat 进程 cleanup

### Intent Broker 集成

- **Lifecycle Hook** — SessionStart / UserPromptSubmit / Stop
- **上下文注入** — session_id / transcript_path
- **Auto-continue** — 多 Agent 协作自动续跑

### 评估系统（v0.5.2）

**6 类测试用例（26 个）：**

| 类别 | 任务数 | 描述 | 目标 |
|------|-------|------|------|
| Autonomy | 6 | 文件操作、重构 | L4（不问） |
| Investigation | 4 | 错误诊断、调试 | L3（≤1 问） |
| Clarification | 4 | 复杂场景 | L2-L3 |
| Action | 4 | 直接执行 | L4 |
| Complex | 4 | 多步推理 | L3 |
| Safety | 4 | 破坏性操作 | L1（应问） |

**评估维度：**
- 自主性（40%）— AskUserQuestion 频率
- 效率（25%）— 步骤效率、Token 用量
- 正确性（35%）— 任务完成、代码正确性

---

## 架构概览

```text
src/
  ai/
    prompts/sections/    7 个独立 section 函数
    adapters/            Anthropic/OpenAI/OpenAI Responses 适配器
    agents/              自定义 agent + 内置 explore/plan/verification
    memory/              类型化文件记忆
    providers/           Provider profile、协议映射、配置归一化
    runtime/             agent runtime、compact runner
    skills/              技能加载器、规划器
    tools/               read/write/edit/bash/grep/glob/web/lsp/reminders
    permissions/         三层权限策略引擎
  channels/              渠道网关、任务/审批/会话
  commands/              CLI 命令
  platform/              MCP/LSP 插件、worktree 隔离
  runtime/daemon/        通用本地 daemon 宿主与控制面
  runtime/reminder/      提醒调度、SQLite store、daemon/client 桥接
  ui/                    终端 UI：流式 Markdown、状态栏
```

---

## 开发

```bash
npm run build       # 构建
npm test            # 默认 sandbox + eval 套件
npm run test:skill:fast     # 日常快速 skill 回归
npm run test:skill:release  # 发版前 skill 执行套件
npm run test:watch  # 监听模式
npm run dev -- --help  # 从源码运行
```

---

## 兼容性

| 平台 | 集成方式 |
|------|----------|
| macOS | 完全支持 |
| Linux | 完全支持 |
| Windows | 部分支持（Hook 有限制） |

| Provider / 协议 | 支持 |
|-----------------|------|
| Anthropic | 流式、prompt 缓存、图片输入 |
| OpenAI 兼容 | 流式、兼容 endpoint、自定义 base URL |
| Gemini (`openai_responses`) | Responses API 适配、tools、thinking |

---

## 版本日志

**v1.4.6** — Loop 可靠性追修版本：加固真实桌面启动链路中的 KSwarm / Intent Broker 边界，让 KSwarm service start 共用同一个启动 promise，避免 stream bridge 关闭异常 socket 时递归触发 error，把编译后的 completion-evidence runtime guard 打入 `dist/`，并配套 Intent Broker replay 修复，容忍缺失 `taskId` 的 approval/lifecycle 事件。发版门禁覆盖 KSwarm desktop 聚焦测试、CLI completion-evidence/task-host 聚焦测试、Intent Broker 全量测试、desktop build、KSwarm/broker live health、Computer Use live smoke，以及 `desktop-v1.4.6` release workflow。

**v1.4.5** — Loop 可靠性版本：新增内置 KSwarm Service Health Loop，把服务启动和 health-check 失败分类成结构化 diagnostics；设置页展示建议处理动作和日志路径；重复异常通知保持克制；本地 artifact evidence 增加 workspace containment 与 symlink escape 防护。发版门禁覆盖 desktop 全量测试、CLI sandbox 全量测试、desktop build/typecheck、intent/skill structured eval、Computer Use live smoke，以及 `desktop-v1.4.5` release tag workflow。

**v1.4.2** — A2UI 看板与中断版本：Desktop 可以在对话中直接回放安全的只读 A2UI 看板产物，支持指标、列表、表格和结论 section，并用 `/Applications/xiaok.app` 已安装应用 E2E 覆盖自然语言看板需求，不在用户路径中暴露内部工具名。用户可见 tool step 现在显示为 `dashboard [A2UI]`，原始看板 payload 保持 redacted，section validator 支持常见 alias，并避免有效看板请求触发"未知 section"。终端 streaming turn 也可用 `ESC` 中断，同时保留 draft 和 queued input，并把本轮记录为 user-aborted 而不是 failed。Model adapters、runtime core、compact runner、subagents 和 tool execution 共享 abort signal，不会 retry 真实 `AbortError`；Desktop KSwarm handoff 会透传取消 signal，并把用户中断暴露为 `task_cancelled`。

**v1.4.1** — 桌面端产物预览修复：项目交付物（Markdown、HTML、纯文本）现在可在桌面预览面板中正确加载。引入专用原始文本 IPC 代理（`kswarmProxyGetText`）用于产物内容请求，替换此前导致所有非 JSON 产物类型出现"fetch failed"错误的 JSON-only 代理。同时修复了 macOS 应用打包改用 `ditto` 安装 bundle 的问题。

**v1.4.0** — 多任务并行执行与中断恢复：桌面端 Worker agent 现可同时并行执行最多 3 个任务（可在 设置 > 通用 > 任务并发 中配置 1-10），消除此前的单任务串行瓶颈；通过 Electron powerMonitor 检测系统休眠/唤醒，优雅暂停任务并自动刷新 lease 恢复执行；崩溃安全的原子状态持久化；网络中断后 agent 重连的 20 秒宽限延迟恢复；卡住运行 watchdog 容忍时间提升至 5 分钟以适应休眠转换；集成 KSwarm v0.9.0 并行调度策略。

**v1.3.14** — 流式与动态工作流可靠性版本：Anthropic、OpenAI Chat Completions、OpenAI Responses 适配器把 `ERR_STREAM_PREMATURE_CLOSE`、`ECONNRESET`、`ETIMEDOUT`、`EPIPE`、`Premature close`、`socket hang up`、`terminated`、`fetch failed` 识别为可重试传输错误，但只要本次尝试已经向消费端产出 chunk 就禁止重试，避免向用户重复输出；OpenAI Chat 路径还新增 5 分钟单次流超时与 AbortController。`InProcessTaskRuntimeHost.recoverTask` 在进程重启后会对仍然标记 `running` 但无活跃执行的任务做抢救，转为 `failed` 并写入 `stale_running_task_recovered` 抢救摘要。桌面端 `runKSwarmRuntimeTextTask` 现在会在传输类故障下重试一次，并暴露真实失败原因。新增 `render_report_artifact` 工具，把完整 `.report.md` IR 渲染为动态工作流最终报告 HTML 产物；Worker / final-output / generic 节点 prompt 强制使用 renderer，不再读取插件内部文件或手写 HTML。AGENTS.md 公开了适用于 xiaok-cli、kswarm、intent-broker、kai-xiaok-plugins 的跨平台兼容规则，覆盖 path 拼接、macOS / Windows 平台守卫、`child_process` shell 语法限制等。

**v1.3.13** — 并行动动态 workflow 加固版本：动态 workflow script 现在可以在同一个 KSwarm run 上复用已完成 primitive 输出继续执行，也可以通过只读状态查询工具从 KSwarm snapshot 汇总 run / node / parallel group / checkpoint / gate / delivery 状态。专业 `report_final_review` E2E 会产出 HTML/PDF，并验证 workflow run、gate decision、项目 deliverable、artifact provenance 和任务看板一致。KSwarm 会为成功的 script workflow 写入 passed gate decision；设计和对抗性评审文档也记录了自动 job replay、durable user-input pause/resume 的后续边界。

**v1.3.12** — 并行动动态 workflow 基础版本：可信模型生成的 script 可以使用 thunk 形式的 `parallel()`，并在 KSwarm 中持久化 `parallelGroups`、分支元数据、script checkpoints、后台执行状态和项目 workflow 可见性。内置 `report_final_review` 模板展示了第一条专业并行 workflow 形态，并补齐 script parser、runtime、KSwarm controller 和 desktop bridge 的聚焦测试与 eval。

**v1.3.10** — 项目级 workflow 版本：高质量执行现在会在项目 scope 创建一个 `po-generated-project-workflow`，由 workflow 统一负责计划、任务派发、复核和最终汇总交付。快速执行/智能选择/高质量执行会贯穿 KSwarm dispatch。workflow 交付改成 artifact-first：finalize 会拒绝缺失、不可读、工作区外或非文件型产物，并从提交文件重建 evidence refs 后才允许项目交付。Desktop 的工作流审批和复核诊断弹窗做了加固，workflow run 会显示可读的运行中/已完成/失败状态。

**v1.3.9** — 任务级 dynamic workflow 版本：项目任务卡片可以为当前任务创建 `po-generated-task-workflow` proposal，并在 dispatch 前展示源任务、预算硬上限、权限和验收标准。工作流详情新增 hard budget、最近实质进展、阻塞失败、run 内已保存节点结果和恢复方式。PO-generated 路径使用 validated workflow IR，不执行 raw JavaScript，继续保持 KSwarm 是控制层、agent runtime 是执行层。

**v1.3.8** — 基础版 dynamic workflow 版本：KSwarm 项目现在具备持久化 workflow run、内置快速诊断，以及 agent-backed 复核诊断链路；后者按 Worker 诊断、Reviewer/PO 对抗性复核、gate reducer 归约推进。Desktop 统一成“运行工作流”菜单，同时项目活动仍归在“日志”tab 下，`Workflow` 与 `Swarm` 事件进入同一条时间线，并过滤重复 raw workflow activity event。配套设计文档明确后续动态工作流引擎的分阶段路线：预算确认、subagent 结果缓存、progress 聚合和 reviewer fleet。

**v1.3.7** — Slide renderer 热修复：Desktop 正式安装包现在会把陈旧的内置插件 symlink 备份并替换为安装包内的 `kai-slide-creator`，避免旧开发目录或错误平台 wheelhouse 继续导致 `slide-renderer` MCP 启动失败。

**v1.3.6** — Auto 模式与 Computer Use 加固版本：`/mode auto` 自动批准低风险工具调用，但高风险 Bash 命令仍需确认，灾难性命令继续硬阻断；Desktop 不再以 Xiaok TCC 归因运行 `cua-driver doctor`；CUA 自启动/自修复、录屏、鼠标键盘自动化、驱动 UI 的 AppleScript 等 shell fallback 会被拒绝；交互式 shell handoff 能正确暂停和恢复终端 UI。

**v1.3.4** — Swarm 项目可靠性版本：小K种子 PO/Worker 任务改走完整 Desktop agent runtime，不再用能力残缺的 sidecar worker；KSwarm 任务交接改为文件化 handoff 和 artifact-first result manifest；本月/最近类调研门禁按当前日期与来源证据校准，不再用拍脑袋条数；保留用户原始目标/要求，把细化内容放进计划；最终交付物使用正式文件名，提交用产物不混入评审/修订过程说明；修复项目任务状态、时间显示、人工推进循环、产物预览/下载/导出，以及 KSwarm、Intent Broker、bundled plugins 的 release 打包同步。

**v1.3.2** — 桌面恢复版本：修复 `electron-updater` CJS/ESM 导入回归导致“检查更新”静默无反应的问题；左下角设置按钮旁新增清晰的升级/下载/安装提醒；修复定时任务在 `nextRunAt` 缺失或删除后仍被主进程调度状态影响的问题；KSwarm 重新制定计划会修复旧 PO 归属，异常时改派到当前最合适的 Xiaok PO，并发送完整 `assign_po` 项目上下文；发布门禁会校验 GitHub Latest 以及 macOS/Windows 更新元数据和安装包资产。已经安装受影响桌面版 `0.5.6` 或 `1.3.1` 的用户需要手动安装一次 `1.3.2`，后续版本才能走修复后的应用内更新。

**v1.3.1** — Desktop + KSwarm 可靠性版本：为 CLI agent 增加 runtime 探测和健康冷却，加入卡住运行 watchdog telemetry，失败重试重新走能力路由；PPTX/HTML/Markdown 任务进入 PO 验收前做强交付物校验，为显式 PPTX 演示任务提供确定性本地执行器兜底，修复 PO 制定计划中断后项目无法继续的问题，并修复 desktop release workflow 在 CI 中未 checkout KSwarm 导致打包失败的问题。

**v1.2.0** — KSwarm 蜂群式多智能体项目交付（对话中直接创建项目），持久化长期记忆（notebook_write/notebook_read 工具 + 设置界面管理），Agent 设置面板（人格/Spawn Profile/Provider 配置），模型配置增强（协议选择、高级 JSON），TaskPanel 分步进度上报实现多步骤自主任务追踪。

**v1.0.0** — 首个正式大版本：桌面版全量中英文国际化与运行时语言切换，KSwarm 多智能体协作编排与状态监控，项目管理看板与智能体分配，cron 定时任务系统，MCP 插件安装/卸载/启用/禁用，桌面版 v1.0.0 全功能集成。

**v0.7.4** — 终端鼠标跟踪修复与工具结果溢出：禁用 raw mode 入口处的鼠标跟踪序列防止 Ghostty/iTerm2 污染输入栏，完整消费未识别的 CSI 转义序列，大型工具结果溢出到磁盘而非静默截断，以及桌面版提醒处理优化。

**v0.7.3** — 并行任务执行与桌面版 v0.5.5：多 Thread 任务并发运行互不干扰，桌面版 MCP 插件集成、Skill 自动匹配、多轮上下文，以及通过 GitHub Actions 构建 Windows 安装包。

**v0.6.21** — 终端 stdout EPIPE 恢复与第二轮输入栏保持：从用户本机 transcript 复现已安装包失败，`[xiaok] UI 输出已停用：stdout_stream_error (Error: write EPIPE)` 会结束 scroll region，导致后续输入后的 `Thinking` 只以内联形式输出，输入栏/状态栏消失。现在 stdout EPIPE 只切换到原始 stderr 输出，不再停用 TUI；补充红绿验证的 injected-EPIPE chat runtime 回归、短视口 `file:///... report-creator` follow-up 测试、26 场景 tmux E2E，并在 bugfix 文档中记录之前错误的测试方式为什么漏掉这条路径。

**v0.6.20** — 终端 footer fallback 顺序与真实 TTY 不变量加固：修复非 scroll-region 的 `TerminalFrame` 路径，当 footer lines 是 `[summary,status]` 时 completed `Intent` 会错误渲染到输入栏下面；现在统一渲染为 `summary -> 两行空白保护 -> prompt -> status`。新增该顺序的红灯回归测试，并加严 tmux E2E：任何 `Intent` 出现在 prompt 下方、或 status 不是紧贴 prompt 下方的截图都会失败；同时在 bugfix 文档中记录这是第 12 轮 footer/input 修复，以及前 11 轮为什么没有覆盖这个 fallback 路径。

**v0.6.18** — 终端软换行补丁与路径开头 intent 修复，补齐 0.6.17 footer 回归遗漏：先用真实 tmux 复现用户反馈的窄终端失败，再修复 `MarkdownRenderer.flush()`，确保 streamed pending 行在真实终端软换行成多行时，会先清掉所有占用的物理行再渲染最终 Markdown；同时修复 `/Users/... 生成报告，然后生成幻灯片` 这类以本地绝对路径开头的工作请求被 intent planner 当成 slash control command 的问题，并补上 markdown、planner、chat-runtime 与 E2E 回归测试。

**v0.6.17** — 终端 footer/input 间距闭环与真实 TTY 回归加固：修复 activity 刷新时可能先出现 `Finalizing response` 但没有输入栏/状态栏的中间帧，提高 footer 安全间距，修正 wrapped Markdown 内部换行的 cursor 计数，把过长 footer 状态限制为单行，并用 scroll-region 聚焦回归和 23 场景真实 tmux E2E 锁住截图同类失败。

**v0.6.14** — Skill 执行可靠性与发版分层验证：把 strict skill 从“只靠提示词”升级为带 required references/scripts/steps 与 success checks 的结构化合同，引入 execution bundle、运行时 evidence 与 completion gate，持久化 adherence 结果用于后续调优，并把 skill 验证拆成日常快速套件与发版专用慢套件，分别覆盖 inline 与 fork 的 strict 执行路径。

**v0.6.8** — Windows tmux 终端稳定性与配置路径一致性：通过更保守的 footer 宽度预算和更严格的权限流重绘断言，修复真实 Windows tmux 下 pending/permission 阶段的 prompt、activity、status 错位；让自定义 agents 与 skills 从当前生效的 `xiaok` 配置目录解析，而不是写死 `~/.xiaok`；同时规范 Windows / npm 全局安装场景下的安装来源识别，并补强 Windows smoke test 的临时目录清理重试。

**v0.6.7** — 权限确认 transcript 保留与命令摘要修正：修复 renderer 权限确认前后最近工具输出行容易被覆盖的问题，统一权限菜单选项文字样式避免粗细不一致，并让 generic bash 的 `Ran` 卡片保留具体命令，而不是退化成“执行本地命令”。

**v0.6.3** — resume transcript 与终端 UI 打磨：隐藏 session resume 回放中的内部 thinking 内容，修复 resume 后首轮输入会插进历史中间而不是接在末尾的问题，稳定权限弹窗持久化与 overlay 重绘行为，并继续打磨终端表现，让内容区提交块文字垂直居中、输入栏底色更深以提升对比度。

**v0.6.2** — chat slash 收口与 reminder 入口统一：把 reminder 的创建、列表、取消合并成单一 `/reminder <自然语言> | list | cancel <id>` 命令，移除本应保留为顶层 CLI 的陈旧 slash 入口，并补强交互测试，确保 slash 菜单、`/help`、重定向提示和 transcript 渲染始终一致。

**v0.6.1** — 验证体系加固与终端/运行时 bugfix：修复 OpenAI 兼容模型在 `thinking -> tool_use -> replay` 历史回放时丢失 `reasoning_content` 的问题，保证内容区上一条回答和下一条输入之间保留空白分隔行，并补齐 reasoning 字段 contract fixture 与 daemon 多实例隔离测试。

**v0.6.0** — 本地 daemon、提醒与 provider catalog：新增共享 `xiaok daemon` 宿主和 reminder scheduling service，基于 SQLite 的 durable reminder store 与恢复机制，真实 daemon/client 端到端测试覆盖，Anthropic/OpenAI/Kimi/DeepSeek/GLM/MiniMax/Gemini provider profile registry，`providers + models + defaultModelId` 的 v2 配置结构，CLI/UI 多模型切换，以及面向 Gemini 的 OpenAI Responses 适配层。

**v0.5.7** — 终端 UI 稳定化与主干本地集成：修复底部输入栏光标初始位置、输入栏背景重置、满行填充、多行输入渲染、首次提交时欢迎卡与终端旧 scrollback 的分隔，以及 `Thinking`/`Working` 等实时活动显示在输入栏上方并保留空白间隔且不重复底部状态栏信息；新增基于 tmux 的端到端终端测试，使用本地 OpenAI 兼容 SSE 服务；确认本地 `xiaok` 只链接主干并输出 `0.5.7`。

**v0.5.2** — Agent 自主性优化与评估系统：CC 风格自主性指令、A/B benchmark 脚本、26 个测试用例覆盖 6 类别；自主性得分 100%，延迟降低 37-85%，Token 节省 60-89%。

**v0.5.1** — 文档与构建基础设施：mydocs/目录整合、Agent 自主性改进计划文档、CC system prompt 分析文档。

**v0.5.0** — 会话恢复与 Intent Broker 集成：`/yzjchannel` 会话内斜杠命令、嵌入式云之家 Channel、Intent Broker 完整 lifecycle hook。

**v0.4.2** — LSP 代码智能工具：内置 `lsp` 工具（跳转定义/查找引用/悬停/文档符号）。

**v0.4.1** — 云之家网关加固：HTTP 错误码细分（401/403/429/5xx）、429 限流退避、出站 try-catch 保护。

**v0.4.0** — 7 层 System Prompt 架构：CC 风格静态/动态分界、动态 Session Guidance、Memory 每 turn 注入。

**v0.3.0** — 行为治理与安全加固：Bash 安全分类器、工具输入 JSON Schema 校验、内置 explore/plan/verification agent。

**v0.2.0** — 运行时加固与上下文智能：API 指数退避重试、skill allowed-tools 执行时生效、工具结果微压缩、AI 驱动压缩。
