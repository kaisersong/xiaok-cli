# D0 本机工程实现补充

用户在了解 D0 的阻塞后要求“那就在本机做么”。本次据此推进本机离线工程实现：
先实现、测试隔离的 D0 底座，保留 v46 的真实研究准入及 P2 公开资格门。
这是对 v46 §11“任何基础设施实现前”的顺序调整，不能记成原前置数据已经通过。
本机历史快照盘点见 `.xiaok/evals/harness2-static/local-existing-evidence.json`；
已有记录缺少 usage，不能作为真实可靠性/质量效果证明。

## 所有权与启动

- Electron root main 独占 owner；专用 dataRoot namespace；正常任务不依赖优化 DB。
- 新增 N-API OS 锁：macOS flock / Windows LockFileEx。锁描述符/句柄在 main 本进程持有，
  不用 PID 文件、租约、子进程持锁或 SQLite 事务代替。锁文件不删除；别名 root 经 realpath 归一。
- 原语/编译资产缺失、身份/DB 损坏都返回 unavailable。仅专用目录写 0600 文件，不递归 chmod。
- owner witness 先独占落盘再创建 DB；原 owner/init operation 完成后标 ready。
  ready 后丢库、丢见证或目录迁移拒绝重建。初始化崩溃只在可证没有活动时续完。
- 启动先读取上次 lifecycle，再写本次 dirty。重启递增 epoch、取消旧授权/准备请求；
  pre_send/unknown 保留风险账，不重派。clean 只在自有 I/O drain 后落盘。

## 唯一账本与内存闸

- 唯一 SQLite worker 使用 DatabaseSync；main 不在 coordinator 中做磁盘 I/O/await。
  worker 仅接受封闭语义命令，绝不接收 SQL/代码；worker 资产同步复制进 main build。
- 配置保持 schema1、off/none、v46 原预算；save 只接 mode/预算 patch，拒 enabled/代际/reflect。
  无变化不增 revision；D0 public enable 始终 unavailable，不创建研究授权。
- 研究授权由 root registry 的冻结 manifest 及 root 持有用户 principal 签发；
  renderer/agent/scheduler 不能提交任意 manifest JSON 或伪 source。
  目前生产 registry 为空；测试使用专用合成 manifest，不证明真实资格。
- 事务先整笔 parent escrow；attempt 仅子划拨，不重复扣日账。UTC 原桶不迁移。
  tokens/requests/combined 同时校验；原正常任务与 guidance 分开；unknown 不释放。
- providerInvocationId 唯一；已知 usage 幂等、冲突拒绝；超预留记真实数并停对应 binding。
  撤销后旧桶 usage 仍可结算。正式机会 spent 随 pre_send 持久化，不能退还/删库重置。
- root 内存 deny 在 close/revoke/下降提交前立即生效。异步预留/marker ACK 回来后再次核对，
  只有同 epoch/fence/grant/body/nonce 才能 compare-and-send；最后同步 callback 才是发送点。
  此 callback 是 P2a transport 的内部挂点，D0 不接真实 provider。
- 关闭/撤销 operation 幂等；先独立 journal，再提交同 operation 的 DB fence/impact。
  1000ms 无 DB ACK 返回 pending（journal 已持久）或 persistence_failed，保持即时 deny。
  no-op false→false 不撤销独立研究；显式 all/research revoke 才撤相应 grant。
- 预算下调按 v46 事件表精确撤授权；只加额/公开 mode/指导子限不撤独立研究。
  所有新机器派发须过 UTC deadline 与 time_guard。回拨阻新授权/派发，旧 usage 可结算。

## 文件归属与本批限制

v46 原文件表补充并细化为：
`harness-optimization-{types,config,budget,store,service,owner-lock,lifecycle,time-guard}.ts`、
`harness-optimization-store-worker.mjs`、`harness-research-controller.ts`；
OS 原语放 `native/harness-optimization-owner-lock`，由 owner-lock 加载；
close journal 属 lifecycle 模块，避免重复事实 owner。

先验证实际 store/service/OS 锁，再接 createDesktopServices 的唯一生命周期。
公共 API 只暴露语义配置/状态及 user-only 操作；接 IPC 时同步 preload/types/contract。
P2a adapter、隔离执行、候选 writer 与 P2b 统计/投影不属于 D0 完成声明。
任何缺失能力保持 unavailable，不把工程单测或合成 manifest 记成用户研究资格。

## 实现前对抗检查与回归顺序

检查双进程同 root/别名、初始见证后崩溃、ready 后丢库、复制 root、
worker fsync 卡住时即时撤销、重复 close 与晚 ACK、预留/marker 两个崩溃点、
跨午夜/回拨/降预算、unknown/迟到/冲突 usage、跨 principal/owner/manifest 重放。
先写失败测试再实现；真实本机 OS 锁与 SQLite 测试必跑，不用内存 fake 冒充。
Windows 原语缺失分支必须拒绝且普通服务可启动；未跑 Windows 正例须明确未验证。

本批涉及配置/授权，按 AGENTS.md 使用 Codex 编码、GLM-5.3 独立评审。
送审只含方案和本任务代码；禁用评审工具/MCP，不读取用户日志、凭据或他人票。
若首次出现配额/容量错误，保留原文并停止该席，不循环重试。

## GLM-5.3 首审裁决与 v2 补充

首轮 stdin 未关闭导致 180s 无输出，已按登记 pid/pgid 回收；修正后独立评审返回 BLOCK。
原始票与进程记录：`.xiaok/evals/harness2-d0/design-review-retry.*`。

1. 锁内顺序固定：先成功获取本进程 OS 锁，才允许读取/创建 witness、DB 或 lifecycle。
   持锁失败实例立即 unavailable，不读取 partial 状态、不续建、不写任何身份事实。
   witness 的 initOperationId 是首次初始化唯一幂等键，贯穿 witness→DB→ready；
   不以 PID/抢锁时间或自造“内核锁序号”作为授权。锁持续覆盖全部初始化和后续生命周期。
2. 保留 v46 的窄恢复，拒绝把所有 partial 都永久禁用的建议。可恢复机器条件为：
   witness schema/ownerId/canonicalRoot/dev+ino 全部匹配，initialized=false，
   initPhase=owner_created，原 initOperationId 有效；DB 不存在，或完整性校验通过且为
   空 schema，或同 owner/initOperationId 的已知 schema 且 grants/runs/attempts/
   daily_budget/formal_trials/outbox 全空、config 仍 revision0/off/none。
   其它任何 partial/活动/未知表/未知版本都 unavailable；ready 后丢库永远不重建。
   完成同 initOperationId 的 schema-ready 事务与 witness ready fsync 后才允许 admission。
   epoch 属 DB，完成初始化后再递增；不是用 dirty 位证明从未发生预算活动。
3. pending 唯一判据：同 operationId 的 journal 独占创建并 fsync 已 ACK，仅 DB 提交未 ACK。
   journal 未 ACK/失败→persistence_failed，保持 deny；DB 以 applied_operations UNIQUE
   幂等提交 fence+撤销+summary。重复调用及重启始终复用 active operationId。
   晚 ACK 只能继续审计/原操作，不能解除 deny 或授予发送。
4. usage 结算不经过时钟/admission/grant 活跃性校验；只核原 owner/已登记 invocation、
   原 UTC 桶和不可变 usage 事实。回拨/午夜/撤销均允许幂等结算并停不可靠 binding；
   结算不签发新票、不创建新 grant 或新桶。
5. Windows 在当前工程版 factory 默认 unavailable，直到真实 Windows OS 锁/崩溃/
   原生模块资格与包内测试通过；没有 renderer/config/manifest 覆盖此 gate 的字段。
   原生 LockFileEx 源码保留以供后续验证，本机不声称通过 Windows 正例。

时间规则为持久 wall UTC 高水位+2s 回拨容差；monotonic 只辅助诊断，正常前跳/休眠不误拒。
公共 IPC 的精确白名单将在接入批次逐项登记，未接入的内部 driver 不暴露为通用 IPC。

GLM-5.3 v2 结论为两项修订后 APPROVE 生效、无需第三轮。两项纳入如下：
窄初始化恢复还要求 applied_operations 为空、无 close/revoke journal、无既有 lifecycle
活动见证；出现任一持久撤销/派发历史都 unavailable。epoch 仅可在可证从未授权/外发的
首次建库从初值开始；正常 ready 库只递增。跨 root 的旧 epoch/fence/grant/body/nonce
即使数值碰巧相同，仍因 ownerId/原 grant/票对象绑定不同拒绝。补复制 root/旧票重放回归。
有效独立票：`.xiaok/evals/harness2-d0/design-v2.stdout.json`，首审及失败记录保留。

## 当前落地范围

本批交付 **D0 核心工程子批**，不宣称 v46 整个 D0/P2 或 49 个验收子项均完成。

| 已实现 | 实际 owner / 入口 |
|---|---|
| 本进程 OS 排他锁、真实路径身份 | `harness-optimization-owner-lock.ts` + N-API `native/harness-optimization-owner-lock/owner_lock.c`；macOS 本机已编译执行；Windows 保持未资格 |
| 初始化见证、ready 后丢库拒绝、dirty/clean、close journal | `harness-optimization-lifecycle.ts`；只在专用 namespace 写文件 |
| 唯一 SQLite、parent escrow、attempt 子划拨、UTC/clock、usage/unknown、正式 spent | `harness-optimization-store-worker.mjs`；预算和时间闸在同一 worker 内实现，没有另建第二个 budget/time store |
| 串行消息桥、异常拒绝、退出 drain | `harness-optimization-store.ts` |
| 主线程同步 deny、一次性票、marker ACK 后重验 deadline/fence、abort、关闭幂等 | `harness-optimization-service.ts` |
| 冻结内部 manifest 结构/owner/profile/workspace/计划上界校验 | `harness-research-controller.ts`；生产 registry 为空，正例仅为隔离合成测试 |
| 默认 off/none、白名单预算草稿、拒绝 reflect/公开 enable | `harness-optimization-config.ts` |
| 同一服务生命周期、主窗口/主 frame/可信 URL + 私有 actor 身份 | `createDesktopServices`、`main.ts`、`harness-optimization-ipc.ts`；agent/scheduler/伪 user 拒绝 |
| 五个公共语义 API | get/save config、set enabled、revoke grants、reset clock；preload TS/CJS、shared types、contract 同步；driver 不暴露 |
| 设置只读 unavailable 状态 | `HarnessOptimizationSettingsStatus.tsx`、ChatSettings 与中英/类型 locale；无开启控件 |
| worker/原生锁复制进本机 main build | `scripts/copy-harness-runtime.mjs`；缺原语资产返回 unavailable |

文件划分以本表为准：budget/time_guard 合并在唯一 SQLite worker；平台 OS 原语合并在
同一 N-API C 文件的条件编译分支。P2a 外部实例签名票不由当前进程内 WeakSet 票替代，
须在 P2a 新接口/传输资格批次实现。

## 最终复核和本机验证

编码方 Codex；独立模型从 Qoder CLI 的 init 元数据核实为 **GLM-5.3**。
核心源码审查与最终 service/bridge/controller/IPC/main/preload 复核均 APPROVE，无必改项。

- 核心包：`1b2384653c4f5ddf5340b5e9914032e78769f99ced7a5c4d2dbee3fed75f473c`。
- 最终增量及接入包：`8822a7a9ed7040188f3898b237f53a6ae9333c0bb4de8e4d297d915f73445c9a`。
- 同目录 `verification-final.json` 核对已评审源码哈希、未变核心文件、实际接入 diff、
  两张票的模型/回显 SHA/exit 0/reaped、复制后的 worker/.node 字节一致。
- 原始票：`code-core-review.stdout.jsonl`、`code-final-review.stdout.jsonl`；
  原始失败与 timeout 不计批准，全部按登记 pid/pgid 回收并留档。
  开发评审调用属于研发投入，不计作产品研究 usage，不宣称整个开发任务零模型调用。

以下原始日志均在本 worktree 的 `.xiaok/evals/harness2-d0/`，没有把用户提示词/凭据写入证据：

| 实际检查 | 结果 / 原始日志 |
|---|---|
| Node v24.16.0：7 个文件 67 项，包括真实 createDesktopServices、SQLite 阻塞、OS 锁、三处 kill 子进程恢复、journal 失败同 op 重试、跨预算域、IPC/renderer | `tests-node24-complete.log`，67 passed |
| Node v22.14.0：同一套件 | `tests-node22-complete.log`，67 passed |
| P0a 固定公式、生产诊断入口、独占输出 | `p0a-tests-final.log`，8 passed；`p0a-final.json` 仅研究准入 not_started，不报告工程进度 |
| Desktop main build | `build-main-final.log`，退出 0，worker/原生锁复制结果已核对 |
| renderer build / 类型检查 | `build-renderer-final.log`、`typecheck-final.log`，退出 0；无新增 baseline |
| governance / 增量 architecture | `governance-complete.log`、`architecture-complete.log`，0 新违规 |
| 实际 crash 子进程 | `crash-process-audit-node-24.16.0.json`、`crash-process-audit-node-22.14.0.json`；各自注册进程均观察到 close，remaining=0 |
| YAML / diff | workflow YAML 解析、`git diff --check` 通过 |

新增回归先暴露并修正了 marker ACK 后遗漏截止时间、研究预算下降未 abort、
guidance 子限下降误挡研究这三处实现问题；预算两项失败原始日志为
`budget-abort-red.log` / `budget-separation-red.log`。这些是 v46 已要求的边界，
执行机制已落实回归及 CI，没有将其记成真实 ROI 或新的产品研究结果。

## 未完成和未验证

真实研究 manifest 登记/资格与研究启动公共流程、外部 worker Ed25519 描述/控制通道、
真实 provider 最后发送边界、report profile/OS 隔离、memory writer/outbox 应用及 P2b
评分/receipt/guidance 均尚未接入；本批内部回调测试不冒充真实 HTTP 边界验证。
公开 enabled=true 仍拒绝，生产没有可用研究 registry，不会通过保存草稿派发实验。

Windows 只保留原语源码且 factory unavailable；未跑 Windows 正例、远端 CI、真实 .app/ASAR
安装包或原生窗口验收，未发布、未安装替换用户入口。用户真实 dataRoot 未创建优化 DB/见证。
本机真实质量/可靠性/成本/冻结窗口门仍待满足，P2a/P2b 不因此获准。
CI 已配置最低 Node 与本批实际 suite，尚不能声称远端 CI 已绿。

改动在 `feat/harness2-opt-in-optimization-20261020` 独立 worktree 提交并通过 PR 送审；
GitHub PR 记录完整 HEAD、提交后的验证和远端 CI 状态。合并由创始人决定。
原 checkout 的既有 WIP 及 sibling 内容未修改；开工 hygiene 的既有失败见 P0a 记录。
