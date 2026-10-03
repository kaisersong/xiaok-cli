# xiaok 领域词汇表

本文件统一代码、工具描述、UI 文案和设计文档中的术语。具体权限、生命周期和 wire contract 以对应生产 service/contract 为准；新增术语先更新这里，再在调用处引用。

| 术语 | 含义与事实 owner | Avoid（避免混用） |
|---|---|---|
| reminder（提醒） | 到点通知用户；main 的提醒/通知服务记录状态 | 自动执行工作不是提醒，不能把 scheduled task 称为 reminder |
| scheduled task（定时任务） | 到时间由 scheduler claim、executor 自动执行并记录结果；main/daemon 拥有后台事实 | 不因某次执行完成而自动取消用户的周期定义；不让 renderer 承担调度 |
| intent（意图） | 用户表达的目的或协作意图；intent-broker 提供协作路由与事件事实 | intent 不等于 durable goal，不等于一次模型 tool call |
| goal（目标） | 带完成条件、证据要求及预算的持续目标；runtime goal/host 管理状态 | 一句临时请求、一个 session 或完成一次 turn 不自动等于目标完成 |
| turn（轮次） | 一次用户请求及其模型/工具执行边界；runtime 管理执行状态 | turn 不是一条 message；同一轮可包含多次模型与工具交互 |
| session（会话） | 可保存、恢复的对话历史和关联执行上下文 | 会话恢复不表示旧副作用可盲目重放；一个 session 可以包含多个任务/目标 |
| project（项目） | KSwarm 的任务组织和推进单元；状态由 KSwarm service 管理 | renderer 卡片不是项目权威状态，workspace 路径不等于项目身份 |
| task（任务） | 某一 runtime/service 中可执行、可记录状态的工作单元；名字须带所属域 | Desktop task、KSwarm task、scheduled task 不因同叫 task 而共用生命周期 |
| deliverable（交付物） | 任务要求交付、可审查验收的结果；由任务/项目 contract 描述 | 工具输出或临时文件不自动成为已验收交付物 |
| artifact（产物） | 可定位、带版本/证据或元数据的文件/内容；main artifact 服务或所属 runtime 管理 | trace 留证不等于模型上下文减载；artifact 写成磁盘文件不等于完成交付 |
| workspace（工作区） | 执行与文件操作的上下文；其路径、权限根和身份由 host 确定 | 路径字符串不是权限凭证；不能把路径稳定等同于项目/session 身份稳定 |
| workflow / workflow script（工作流 / 工作流脚本） | 编排多个步骤的结构及脚本执行形式；复用 xiaok/KSwarm workflow-script contract | dynamic-workflow 是现有脚本体系的演化，不能当作不存在的新系统 |
| provider（服务提供方） | 鉴权、endpoint、协议与模型配置的提供方 | provider 不是 model；不同套餐的 key 不保证能访问同一个 base URL |
| model（模型） | provider 提供的具体推理模型及能力 | 显示名称不能作为 API model id 或协议选择依据 |
| Coding Plan（编程套餐） | provider 的套餐/endpoint 配置选项，使用相应鉴权与 base URL | 不把套餐 key 当作普通 API 余额 key，不把套餐名当作模型名 |
| main（主进程） | filesystem、SQLite、服务、窗口、调度和后台执行的本地事实 owner | 不由 renderer 复制同一 durable state 或业务轮询 |
| preload（桥接层） | 白名单语义 API；public contract 连接 main 与 renderer | 不暴露通用 fs/shell/sql/任意 socket 或执行入口 |
| renderer（渲染层） | 展示、交互和局部 UI 状态，通过 preload 查询/请求 main | loading/卡片状态不是后台事实；不能导入 main 私有实现 |
| schema / authorization（结构校验 / 授权） | schema 检查载荷形状；service 按来源、所有权、路径/能力检查授权 | 合法 JSON/schema 不等于有权操作；只给一路加 schema 不代表全部入口被保护 |
| baseline（存量基线） | 本次检查上线前逐条登记的旧违规 | 减少一条旧违规不能抵扣另一条新违规；不自动把新增问题写入基线 |

参考事实入口：`src/runtime/goal/types.ts`、`src/runtime/task-host/types.ts`、`desktop/electron/ipc-runtime.ts`、`desktop/shared/`、`../kswarm`、`../intent-broker`；架构与权限硬规则见 `AGENTS.md`。
