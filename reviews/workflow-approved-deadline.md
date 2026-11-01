# 工作流批准墙钟预算与 Desktop 执行时限

## 当前证据

真实文档工作流成功读取三份上游资料后，持续输出在约 600 秒被 runKSwarmRuntimeTextTask 的 KSwarmExecutionClock(10 min) 取消；尚未落盘。权威 KSwarm run 的 approval.status=approved、approval.budget.maxMinutes=15、budgetGate.status=passed、hardLimits.maxMinutes=15、budgets.maxMinutes=15。既有设计 `docs/design/2026-06-09-kswarm-xiaok-dynamic-workflow-pattern-strategy.md` 明确 maxMinutes 是 run 总墙钟上限。

固定 10 分钟在批准上限之前截断合法生成；简单给每个节点 15 分钟又会突破 run 总预算。普通 direct worker 的队列与研究时限不是本次范围。

## 设计

仅对 po-generated-task-workflow / po-generated-project-workflow：

1. Main 已经通过 createNativeWorkflowRestrictionCheckpoint 校验真实 stored run/node 后，通过 kswarm-service 的固定 reader，沿已登记 branded NativeWorkflowReadPort 的 GET `/projects/:id/workflows/:runId` 读取权威 run，JSON body 的完整读取也归 port 的 pending/controller/drain 所有。service 身份在异步前后复核。不使用 handoff.input、注入的 budget 或可替换 request/fetch 作为批准证据；不改 checkpoint 的权限、指纹或 grant。
2. Main 内部纯解析函数检查 run/project/workflow 身份、running、approval approved、budgetGate passed，startedAt 为合法已开始时间；budgets、approval.budget、budgetGate.hardLimits 中 maxMinutes 都必须是合法正数。选最小值，计算不可延长的绝对 deadline=startedAt+minutes*60000，时间溢出/缺失/过期拒绝，不回落到更宽默认值。
3. 通过 Main-only scoped task options 传该 deadline。scoped host 的队列截止、实际开始的 execution clock、runner.deadlineMs 都用同一剩余墙钟时间；保留更早的 caller/runner deadline 和 signal。已有 retry attempt 重新创建 host task 时不能获得新的完整预算；同一 host 持有原 deadline。非这两类 workflow / 普通任务仍保留旧默认行为。
4. 当截止时间到达，停止模型读取和工具执行，并保留 task/workflow 的非成功终态；不发 done，不执行不完整参数，不提升权限，不改用户配置、API schema 或持久化格式。
5. 当前失败 run 保留历史，经现有取消/dispatch 语义入口启动新批准 run；已完成的前置任务和文件不重做。安装须在无活跃执行时进行。

## 对抗检查与验证计划

- forged handoff input 的更大 budget 无效；主读取必须是固定可信服务请求。
- mismatch project/run/workflow、未批准/blocked、非数字/Infinity/负值/溢出/未来 startedAt 均拒绝。
- 15 分钟整个 run：worker 用掉 11 分钟后 reviewer 仅剩 4 分钟；排队也消耗 workflow 声明的墙钟，普通 direct 队列语义不变。
- 比 15 更小的任一批准值必须收紧；原 runner/caller 更早期限及取消不能被延长。
- 实际生产时钟与原 runKSwarmRuntimeTextTask/runner 入口测试在旧代码 RED；仅解析器断言不是完整验证。覆盖 >10 分钟仍活跃、15 分钟确实停、队列过期、不重置 retry、完整工具只执行一次及物理 return/cancel。
- 主函数的固定 branded-port GET、checkpoint 在前、时钟/runner/queue 三个消费点接线另做 contract 补充。源码/构建/安装/真实节点推进分开记录。

待独立异模型设计评审，通过后才写回归及 production 修改。最终完整 HEAD 仍需按仓库规则复验，不把设计批准当作发布批准。

## 独立异模型设计评审

gpt-6-astra（独立于实施 Codex）的只读评审结论：APPROVE，仅批准进入回归→实现，非代码/发布批准。要求：固定预算 GET 在 kswarm-service 内经已登记 branded NativeWorkflowReadPort 发出，异步前后校验同一实例/属性身份；绝对 deadline 保存在 host owner，重试不可重置；TaskRunnerInput.deadlineMs 必须传剩余 duration，原 caller duration 在排队前冻结；截止信号进入 coordinator 排队；获 lease、onStarted/checkpoint await 后均重检；使用 actual issuer/HTTP/真实 Desktop runner 测试而非模拟成功 GET 或仅测解析器。测试时不得快进 fixture 自有真实进程保护定时器。

设计细化再次经 gpt-6-astra APPROVE：预算读取复用既有 NativeWorkflowReadPort 的固定 GET 和 pending/controllers/drain；kswarm-service 内在异步前后校验同一已登记 service entry。新增底层方法仅可读固定编码 project/run 路径，不导出通用 get，不接受 URL/fetch/options。它只返回数据，不授予 approved authority；Main 解析器仍负责身份与批准/预算验证。必须补 headers 已到而 JSON body 未结束时 drain/cancel 的真实生命周期，以及 request 异步替换/closed port 回归。

实际 issuer→HTTP→createDesktopServices().runKSwarmWorkflowNode 的旧实现回归：11 分钟仍活跃场景 RED（10 分钟已取消），15 分钟队列过期场景 RED（仍等待）；15 分钟不能落盘的边界旧实现已能取消。该组只虚拟 Date，真实 HTTP 与 fixture 的 5 秒进程保护定时器不快进。

## 实现复审

gpt-6-astra 初稿 BLOCK 两项已修并补 RED→GREEN：合法 500.5ms caller reserve 及其跨 attempt 的 fractional cap；真实 runner 初始化前冻结绝对期限。随后补充设计获 APPROVE：流非 usage 消费/提交、tool 前后、projection 后 Main 的既有 assertPermissionApproval 链，以及 summary-only finalization 统一校验截止时间。真实 late-setup、prepare 已完成后的 late-write、late-summary 均先 RED 后 GREEN。最终工作树获得 CODE APPROVE（非发布、提交完整 SHA 后仍需确认）；独立模型未自行运行测试，测试证据来自实施者实际执行。

## 已执行验证

- `npm run test -- --run tests/main/workflow-approved-deadline.test.ts tests/main/workflow-deadline-policy.test.ts tests/main/workflow-budget-read-lifecycle.test.ts tests/main/workflow-deadline-late-summary.test.ts tests/main/kswarm-execution-clock.test.ts`（desktop）：5 files / 44 tests passed。包含真实 Main issuer→HTTP→runner 的 7 项验证；模型 provider 流替身，Date 虚拟，HTTP/进程保护 timer 为真。
- 既有 Desktop loop/read recovery、stream lifecycle/owner、held restriction 测试 44 项通过；既有 Native read-port 5 files / 18 tests 在 Node 环境并指定 `XIAOK_WORKFLOW_TEST_REPO_ROOT` 后通过。默认 jsdom 的两项 collection 环境错误保留诊断，未修改 baseline。
- `npm run build:main`、`npm run typecheck`（desktop）通过；`npm run governance:check` 无新增违规。
- 以上为源码验证；本机包、重启与真实项目推进另行记录。

## CI 执行机制

`desktop-startup-room-recovery.yml` 在声明的 Desktop 最低 Node 22.14.0 与 Node 24 的跨平台 job 执行 4 files / 37 项不依赖侧库服务的 deadline/loop 边界；真实 issuer→Main 及 read-port 的 11 files / 66 项在 Node 22.22.0 与 Node 24 单独执行，固定 KSwarm `7d1d16299c39c7f3b8fda86af8531914870b3382`、broker `2dd1f40dc5e0fc5438a2086d13963cc67489db45`。KSwarm 自身 Node floor 为 22.22，未降低检查或伪造版本。

初稿错误地将完整服务 fixture 放在 22.14，独立评审 BLOCK；真实运行复现服务启动失败。拆分后，官方 Node 22.14.0 本地 37/37、Node 22.22.0 本地完整 66/66 通过；云端 CI 另验。
