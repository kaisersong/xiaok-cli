# Desktop 工具执行策略透传修复

## 故障与根因

草稿工具声明 `executionPolicy.waitsForUser=true`，创建草稿后等待 UI 决定。
`DesktopToolCatalogBridge.sync` 发布描述符只传 definition/permission/scope，
`DesktopCapabilityCatalog.refresh` 再构造 Tool 时也没有执行策略。
结果 scoped registry 的生产 watchdog 把用户等待当普通执行，默认 30 分钟后取消。
现场草稿仍为 draft，不能将超时解释为已经发送，也不能自动重放发送。

## 范围与实现

- DesktopCapabilityEntry 增加可选 `Tool['executionPolicy']`，只接受 main 工具注册来源。
- bridge 透传该字段；catalog.publish 对策略做独立只读快照，只取 waitsForUser/idleTimeoutMs。
- scoped Tool 从 descriptor 继承冻结策略。别名、root/child/fork 与同槽位新版本走同一路径。
- 未声明策略时保持 undefined，不能默认将所有工具变成等待用户。
- 不修改授权、持久化、环境变量、IPC 或外部发送逻辑。

## 对抗性评审（实现前，Codex 自审）

1. 只修草稿工具会漏 mail_send/ask_user 等兄弟入口：修公共 catalog 透传，
   不按工具名特判，不增加任何权限。
2. 不能共享可变 policy：publish 拷贝并冻结；修改源对象不得改变已发布策略。
3. 等待豁免只适用于 idle watchdog：原有取消、authority deadline、撤销仍必须生效。
4. 不能吞掉普通超时或自定义 timeout：使用真实 registry 执行测试，断言普通超时仍拒绝。
5. 用户只要求草稿时工具仍等待发送决定属于既有行为；本次只修误超时，不把审批自动化。

## 回归门槛

先在未修复生产代码上跑新增测试确认红，再实现：
- bridge → scoped registry → executeTool：等待超过 idle 阈值后仍 pending，收到决定正常结束。
- 等待途中用户取消能终止工具；普通工具仍抛 TOOL_IDLE_TIMEOUT。
- 自定义 idleTimeoutMs 与 waitsForUser 的 false/缺省保留；别名同策略。
- 发布后修改原策略不影响 descriptor/scoped 工具，描述符策略冻结。
- 原有 catalog 授权、撤销、scope 与 opaque invocation 回归通过。
- Desktop main build、governance、architecture changed 均记录结果；不更新 baseline。

未在新安装包原生界面复验前，不声称用户机器已经修复。独立 PR 基于主干，
现场助理功能来自尚未合并的功能分支，集成时还需验证组合版本。

## 独立设计评审响应（GLM-5.3）

GLM-5.3 首轮给出有条件 PASS，要求落实四项：

- 来源拒绝：publish 既有 assertSource 仅允许 scheduler；新增 agent/user 发布策略拒绝测试。
  bridge 在 main 内只读取实际注册 Tool 的属性；工具参数不参与策略构造。
- deadline 归属：catalog 在调用前检查 authority.deadlineAt；在途取消由 authority.signal 驱动。
  真正 lease timer 位于 DesktopMultiAgentService.installLease/expireLease，既有 A33 回归验证真实到期。
  本次覆盖等待期间父取消/scope disposal，以及过期后拒绝新调用；不把 catalog 描述为新增 timer owner。
- 组合语义：waitsForUser=true 暂停 idle watchdog（包括自定义 idleTimeoutMs），仍服从外层 signal。
  新增等待测试同时设置 idleTimeoutMs=10，并等待 1000ms 验证。
- IPC：DesktopCapabilityEntry 和 catalog 都定义在 desktop/electron/desktop-multi-agent-capabilities.ts；
  无 preload/renderer/shared 引用，entry 包含函数 bindInvocation，本轮没有可序列化 IPC 变更。

新增用例纳入 desktop-cross-platform.yml 的 Windows/macOS 真实 CI 命令。

## 最终验证与独立评审

- 编码：Codex；独立评审：通过 Qoder CLI 显式选择 GLM-5.3，最终结论
  「PASS（实现层面通过；合并前需补齐 PR 自己承诺的证据）」。评审只读，不宣称代替质量实跑。
- 先红：原生产代码上新增 7 用例中 5 失败、2 通过，失败包括等待误超时、自定义阈值丢失、策略快照缺失。
- 后绿：`npm run test --prefix desktop -- --run tests/main/desktop-tool-execution-policy.test.ts tests/main/desktop-multi-agent-catalog-bridge.bdd.test.ts tests/main/desktop-multi-agent-capabilities.bdd.test.ts`：29 通过。
- `cd desktop && npm run test -- --run tests/main/desktop-multi-agent-service.bdd.test.ts -t A33`：10 通过、104 非 A33 用例跳过，原有 lease 取消覆盖通过。
- `cd desktop && npm run build:main`：退出码 0。
- `npm run governance:check`：lint / architecture 均 0 新违规；
  `npm run architecture:check -- --changed`：0 新违规。
- 原始日志保留在本任务 `.artifacts/tool-wait-policy/`，不提交机器路径或私人运行记录。
- 独立评审要求 PR 补上述红/绿/构建/治理记录；CI/Windows 实跑及最终 HEAD 质量验收仍待执行。
  新安装包原生界面未跑，未发布、未更新本机。
