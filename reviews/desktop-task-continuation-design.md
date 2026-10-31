# Desktop 新任务失败修复设计（2026-10-30）

## 已核实现场与范围

安装包与真实 checkpoint+journal 均证明两条独立路径：

1. create_project 成功且 planningStart.sent=true，最后报告的项目执行步骤仍 running；explicit host delivery 调用 isDeliveryPlanComplete，返回 false，以 deliverables_incomplete / needs_explicit_followup 终结前台任务。后台实际继续执行并提交研究产物。源码已有 project_card 完成证据，但计划检查未识别后台交接。
2. 继续任务和一个 Worker 均在严格 Kimi 响应中触发 KIMI_REASONING_ADMISSION_REQUIRED。正常两轮接口探测 HTTP200 且有 reasoning_content，不证明历史失败原因。官方 K3 README 要求保留完整 reasoning_content；不能将错误方言或正文中的思考当作有效签名思考。

仅修源码与验证产物，不修改现场 task/journal、不重放已完成工具、不改密钥/权限。此前 DeepSeek 列表改动留在原 worktree。本工作区从 origin/master 9804fd21 隔离。

## A. 已确认的项目后台交接

- 共享 deliverable gate 的 CPU 判定识别显式创建项目请求（首个请求子句，不把查询、否定、工具名文字当作授权），以及最后一次 create_project 工具结果。
- 结果必须为真实 projected canvas_tool_result、ok=true，经现有 compactProjectCreationResponse 严格校验的 project_card，且 planningStart.sent=true。失败、proposal-only、未启动、错误字段、ID 不一致、仅 assistant 声称启动均不豁免。
- 此回执只证明本轮创建与交接完成；不改写进度计划，不把后台项目、产物或 PO 审核标成完成。当前会话要求同步交付/不要后台或另有本轮独立交付要求时不豁免。
- 普通 gate 与显式 delivery Worker 复用同一生产判定；现有 Worker DTO 已包含 prompt 与 create_project 结果，无新增 IPC/schema。
- 其余 artifact evidence、安全关闭、post-seal writer 规则保持；成功交接也不得重新进入模型补产物或再创建项目。

## B. 严格 Kimi 无有效思考字段响应

- 保留字段准入：只有官方 reasoning_content 的字符串（包括空串）算有效；其它 reasoning 字段、raw think、普通正文都不能替代。
- 在 officialReasoningSeen 前，严格 Kimi 的 content 使用有界缓冲，不向调用方发布；官方字段迟到时按原顺序正常解析，正常 generic 模型不变。
- 终止边界缺字段时丢弃该次缓冲正文及工具调用，产生固定 code 的结构化协议错误。诊断只含固定词汇、布尔和有限枚举，不记录正文、私有思考、headers、key、原始 error/cause。
- 在 adapter 既有请求/授权 retry owner 内额外允许一次此类重试；复用同一个 messages/tools/systemPrompt，继续 verifyConsumedProviderConversationAuthorizationForRetry，取消与 deadline 保持有效。失败尝试 provider usage 如可用仍计入。
- 两次均失败就终止，结构化错误 retryable=false，防止 outer 30 分钟恢复再次无限重试；normalizeRuntimeError 将其归 model_failed，而不是 tool_failed。其它永久4xx、quota、取消、tool schema/authorization错误不借此路径重试。
- 工具在准入和终止边界均通过后才发布，失败尝试不允许执行任何工具；先前已完成的工具不重放。

## 对抗性审查与验收

由不同于编码者 Codex 的 GLM 模型审查此设计后，先测试再 production。

- Gate：真实入口普通与 explicit Worker；成功启动/计划未完→交接完成，未启动/失败/混合本轮要求/伪造文字→仍未完成；原计划与项目状态不变。
- Kimi：首坏次好（正文和工具均不泄漏）、字段迟到、显式空字段、重复异常最多两次、取消、usage、授权不变、generic parity、错误脱敏及最终分类。
- 真实 SDK/HTTP seam 覆盖 SSE 字段缺失→有效响应，并验证 transport close；本地 production Desktop host 与 post-seal delivery 回归。
- 按项目规则执行相关 root/Desktop tests、build:main、typecheck、governance、architecture changed。安装验证不得在活动任务未稳态时直接替换运行应用；先完成 unsigned 候选与隔离现场回放。

## 共同台账约束

测试调用真实生产入口；每个统计对应日志；成功探测不追认历史失败原因；不把空/失败/额度评审当通过；只清理自建 PID；源码、安装包、真实 UI、CI、发布分别报告。完整台账为 docs/quality/lessons-ledger.md，本任务已读。
