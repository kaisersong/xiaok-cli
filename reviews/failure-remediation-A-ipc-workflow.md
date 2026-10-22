# A：Goal IPC 与 Workflow review 夹具修复方案（2026-10-22）

范围仅 desktop/tests/main/goal-attachment-ipc-contract.bdd.test.ts、desktop/tests/main/workflow-review-mode.test.ts 及新独占测试 helper；不改 production、root src/tests、断言时限、默认拒绝或现有原用例人口。B 已确认两文件无其他写者；不改 B 的 normal-case 或 C 的 owned-workflow-network-fixture。

## 已核实现状与根因

Goal 的旧 setup 在实际 registerDesktopIpc 上不传 options.multiAgentAuthorize，并以 {} 事件调用。现 ipc.ts:1155–1157 在语义 parser 前要求真实 sender；24 个 parser/正常传输测试首先遭 goal_task_mutation_sender_forbidden，2 个事件传输 case 不受影响。Main 的 broad authorizeDesktopInvoke 还限定存活 Main/Recorder、相同 mainFrame 和 trusted renderer URL；fine multiAgentAuthorize 只允许当前 Main。不能用 () => true 或手工 actor 取代这些生产判断。

Workflow 的旧 setup 给 createDesktopServices 手写 KSwarmService。kswarm-service.ts:710–722 的 WeakMap/instanceClosers 与原 request 函数身份检查会在 provider 前拒绝为 kswarm_workflow_read_instance_unknown。createKSwarmService:1756–1757 才会注册原实例并创建其真实 read port；原 runKSwarmWorkflowNode 会获取该 port 并反复读取持久 workflow facts。不能替换 request、复制实例、直接创建或伪造 port/checkpoint。

## 方案

1. Goal 独占 helper 读取 actual Main 全字节，先与已独立审定的 remediation-20261022-main-reviewed.txt 及 literal SHA f25ac6d5034918fef0d3207780429bd7773adc1b7e932b0dc3707e4d8c1d5d40 对照；仅从同次 actual read AST 精确选择 authorizeDesktopInvoke 与 registerDesktopIpc options.multiAgentAuthorize，转译执行原表达式。真实 ShutdownAwareIpcMain + DesktopShutdownGate 包装 fixture leaf handle，再由实际 registerDesktopIpc 注册，typed/package preload 仍调用原 IPC 解析器。合法 Main sender/mainFrame/trusted renderer URL 作为普通 Electron 叶子。
2. 保留原 Goal 26 case；新增 typed/package × create/replace/resume 的未授权矩阵：非 owned sender、复制 frame、坏 URL、destroyed、旧 Main、缺 finer；含恶意 payload getter，验证 sender 拒绝在 getter/service 前，计数均 0。Recorder broad 可过但 finer 必须拒绝。fixture 不发造假的 actor/grant。
3. Workflow 使用真实 createKSwarmService 工厂实例，保持原 request 属性身份；仅以封闭的 fetch/file 叶子模拟固定 GET /health、/agents（空公开列表）、/projects/project、/projects/project/workflows/workflow-run。限定原 loopback 两端口/GET，拒绝所有未知请求、POST、真实 spawn/kill。合法 stored script_generated facts 与 SHA、node role、handoff/participant/root 精确绑定；真实工厂的 read-port/checkpoint/parser/tool registry/实际 OpenAIAdapter stream mock链不变。此为旧 review/write/edit 行为的源回归夹具，不声称 Hub issuer、实际 HTTP 或 native qualification；真实 issuer/network 另由现有 workflow-stored-restrictions-effects 等覆盖。
4. 保留原 Workflow 3 case，新增 fake/copy/replaced-request/closed 真工厂实例拒绝矩阵（provider 调用 0），以及 stored node kind 或 handoff 不匹配时真实入口拒绝（provider 0），避免正常路径修复掩盖默认拒绝。
5. 清理严格先 Desktop task-source/multi-agent drain，再 sealAndDrainKSwarmServiceInstance 原实例；最后恢复 transport/env、移除本测试 temp。聚合 cleanup 错误，不把正文失败吃掉。

## 验证与顺序

原红证使用 B-remaining-main-v1.log/json（以实际文件名核对）；先经 root/B 对抗审定本方案，再最小 fixture 修复。新增真实入口 negative 应在放宽授权/伪造实例的错误实现上可失败；原 29 case 全部保留。新增轻量 target 单 worker，等 B 当前 9-file run 结束后错峰启动，CLI full 始终后台监测。所有原始日志和 owned PID/PGID/reaped 记录放 ignored remediationdir；不触碰共享 4400。

## 授权恢复后发现的第二道 Goal 夹具问题

A-goal-source-fixture-green-v1 真实原32人口出现12失败/20通过；12个合法sender正常返回测试才进入输出投影，旧 goal 仅含 state.goalId/revision，缺 GOAL_PROJECTION_OUTPUT 原有完整公开字段。最小补充采用已有 goal-get-fixture.projection() 的完整公开 DTO，并以实际 GOAL_TASK_MUTATION_OUTPUT.safeParse 明确验证固定fixture；仍精确结果相等，绝不放宽生产strict schema。其余20个parser/发送者/事件测试已通过，该新红完整保留。

首次联合 A-ipc-workflow-green-v2：Goal 32/32；Workflow 原3模型场景因 /agents 503 正确失败，新增6拒绝全部通过。该503原先仅适合 custom runner 的 task-source 人口；本套件必须真实经过 agent model 选择，故普通transport叶子恢复原公开空agents列表（合法200），不改实际request/adapter/port/checkpoint/资格。全部原始失败保留。
