# 观测记忆单命令菜单

用户要求：移除聊天页左上角常驻配置，通过 slash 命令开关并查看状态。

设计：仅在 ChatShell 对话输入中注册 `/observation`，执行后打开输入框上方的观测记忆子菜单并查询状态。子菜单按当前任务状态提供启用、取消启用、停止新采集、撤销披露并停止任务，以及刷新状态。所有操作均通过菜单按钮完成，不再需要输入子命令。默认不渲染、不读状态，子菜单可关闭。原生授权、main 状态事实与现有 IPC 不变。

对抗性自审（Codex）：
- 运行中 Enter 默认 queue 会延迟关闭：本地命令优先走 submit，ChatShell 在 admission/queue 之前消费。
- 把同名 Skill 误送模型：菜单仅在 ChatShell 注册本地命令，同名本地入口优先，其他输入页保持原行为。
- 原生对话框拒绝、失败、held 响应：复用现有 action/scope/read 防护；对话切换重挂组件，旧草稿不得发布。
- 打开菜单和刷新状态不得反向开启；带参数输入同样只打开菜单，不会直接执行开关操作。菜单按钮运行中隐藏启用，已有草稿仅显示取消。
- off 不伪装撤销；保留 recall-only、revoked、closed、语义压缩和未知操作结果。
- 结果必须可关闭，不能迁移成另一个常驻配置条。

回归：默认无展示/无查询；菜单发现；真实 ChatInput 的运行中立即命令与普通队列；原生 prepare 取消/失败/成功；旧任务与卸载 held 回执；stop/revoke 分离；真实 ChatShell→preload→main 一次性授权与线程切换链。构建、typecheck、治理和浏览器验收另记录实际结果。

实际验证（2026-10-28）：
- 新增 observation-slash 三项在旧实现上全部失败；接入后通过。
- 干净 HEAD `02c166e0` 工作副本叠加本次文件：`npm --prefix desktop run test -- --run tests/renderer/observation-slash.test.tsx tests/renderer/observation-controls.test.tsx tests/renderer/observation5-consumer.test.tsx tests/renderer/observation5-chatshell.test.tsx tests/renderer/chat-input-mentions.test.tsx tests/renderer/chat-input-long-draft.test.tsx tests/renderer/chat-input-clipboard.test.tsx`：7 文件 46 项通过。
- 同一副本 `npm --prefix desktop run typecheck`：Electron clean，renderer 0 diagnostics；`npm run governance:check`：lint 与 architecture 均 0 新违规；`npm --prefix desktop run build:renderer` 成功。
- Browser plugin/skill 未提供，使用 Playwright 与现有 Google Chrome。localhost 真实 ChatView/ChatInput/ObservationControls 组件，API 与原生授权在浏览器中使用测试替身；真实 ChatShell/preload/main 一次性授权另由上述集成测试覆盖。
- 1280×820 与 640×760：默认无观测入口/状态、单命令打开菜单、菜单按钮启用/取消/停止采集/撤销/刷新与关闭均通过；运行中 queued 为空；console/page error 0、Vite overlay 0、横向溢出 false。截图、JSON 和原始日志保存于临时目录，未纳入仓库。
- 未更新或验收已安装 App，未发布。

单入口修订验收：`/observation` 只打开子菜单，带旧参数输入也不直接开关。新增菜单按钮链与旧取消回执清理回归；最终 46 项通过。状态来自 main 后清除过期本地回执，防止“已取消启用”与下一任务“已启用”并存。
