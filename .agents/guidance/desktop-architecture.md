# 专项规则

仅在根 AGENTS.md 对应任务触发时读取。本文件中的项目路径以仓库根目录为基准，命令从其注明目录执行；关联项目位于仓库同级。

## Desktop 设计文档

- `docs/design/README.md` 是当前设计文档总入口，已经 desktop-first。
- 仅按本次问题选择相关文档和章节，不将下面清单作为每次编辑前的通读流程：
  - 新增或调整跨层边界、生命周期：`docs/design/2026-05-20-xiaok-desktop-architecture-design.md`
  - 测试覆盖层次不明确：`docs/design/2026-05-20-xiaok-desktop-test-matrix.md`
  - 复杂 desktop 变更需要检查遗漏：`docs/design/2026-05-20-xiaok-desktop-change-checklist.md`
- scheduled task / reminder / timed action 相关改动还要读取：
  - `docs/superpowers/specs/2026-05-20-desktop-recurring-autorun-scheduled-tasks-design.md`
  - `docs/design/2026-05-20-desktop-scheduled-task-daemon-offline-execution.md`
  - `docs/design/2026-05-20-desktop-scheduled-task-daemon-offline-execution-test-plan.md`
- KSwarm / project workflow 相关改动还要读取：
  - `docs/design/2026-05-12-kswarm-xiaok-integration-architecture.md`
  - `docs/design/2026-05-16-kswarm-service-lifecycle-gateway.md`
  - `docs/design/2026-05-16-kswarm-service-lifecycle-gateway-adversarial-review.md`


## Desktop 架构规则

- Electron main process 是本地事实来源，负责 filesystem、SQLite、daemon、scheduler、notification、child process、KSwarm / intent-broker / plugin lifecycle、window lifecycle、packaging runtime path。
- preload 只暴露白名单、语义级 API，不暴露通用 `fs`、`shell`、`sql`、任意命令执行、任意 socket 连接。
- renderer 负责展示、交互、局部 UI state、loading / empty / error / success，不负责 durable state 和后台执行。
- renderer 不能成为 scheduled task、reminder、project、artifact、agent runtime status 的最终事实来源。
- 不要让 main、renderer、daemon 各自轮询同一个业务事实。轮询服务只能有一个 owner，不同业务通过 executor 分流。
- reminder 是到点通知；scheduled task 是自动执行任务。工具说明、system prompt、renderer 文案、store 字段必须保持这条边界。
- scheduler 负责 claim due action、调用 executor、记录结果、计算下一次触发；业务是否补跑 overdue 由 executor 决定。
- 改 IPC / preload contract 时，同步更新 main handler、`preload-api.ts`、`preload.cjs`、renderer API type 和 contract tests。


## 创建与恢复流程的回归底线

- 项目与协作空间的创建协议、授权或架构重构，必须保留既有完整用户链：会话明确请求 → 持久实体及列表 → 约定的自动启动/推进 → 创建卡片 → 点击真实详情 → 历史会话重新打开。用户已授权的创建不能悄悄退化成 proposal-only 或额外手工启动。
- 改结果 DTO 前列出所有消费者：main producer、工具循环、renderer live/replay、任务交付判定、preload/IPC、共享 types。使用生产创建结果穿过消费者测试，不能两边各喂不相容的手造样例后宣称兼容；同时保留旧格式、失败、拒绝和历史数据用例。
- 文件预览必须覆盖真实 main 路径允许集与 transport，直连 HTTP mock 无法证明 main/preload 链路可用。组件、服务、安装包 IPC 和原生窗口验收分层说明，缺失层不能宣称通过。
- 2026-10-07 教训：Room-first 移除会话自动创建；后续修复更换回执但漏了卡片消费者。对应复盘见 docs/bugfix/2026-10-07-chat-created-project-card.md，后续创建入口必须复用语义 owner，不破坏上述链。

## 国际化 (i18n) 强制要求

- renderer 中所有用户可见的字符串（标签、按钮文案、placeholder、toast、confirm、状态文本、错误信息、空状态提示）必须通过 `t.*` locale 引用，禁止硬编码中文或英文。
- 唯一例外：发送给 AI 模型的 system prompt / template prompt 内容、代码注释、技术标识符（URL、命令名、协议名）。
- 新增或修改功能时，同步在三个 locale 文件中添加对应 key：
  - `desktop/renderer/src/locales/index.ts`（类型定义）
  - `desktop/renderer/src/locales/zh.ts`（中文值）
  - `desktop/renderer/src/locales/en.ts`（英文值）
- 纯工具函数（`.ts` 文件，无 React hooks）需要返回用户可见文本时，通过参数接收 locale labels，不要硬编码。
- 带变量的字符串使用函数类型 key：`keyName: (param: type) => string`。
- locale key 命名使用 camelCase，按功能分组到嵌套对象（`desktopSettings.*`、`knowledge.*`、`chatView.*`、`projects.*` 等）。
- 不要使用 `locale === 'zh' ? '中文' : 'English'` 三元表达式，一律走 `t.*` 系统。
- PR review 时检查：新增的 `.tsx` / `.ts` 文件中不应出现 `[\u4e00-\u9fff]` 范围的硬编码字符（AI prompt 除外）。
