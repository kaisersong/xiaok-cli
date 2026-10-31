# PO submission 验收范围来自当前源任务

真实故障：任务 A 明确要求 Markdown/报告 IR，后继 B 负责 HTML 渲染；A 的 workflow 已通过，PO 再审只得到 taskId/result，没有源任务 brief/acceptanceCriteria/requiredOutputs，因项目最终 HTML 要求把 A 退回，B 又依赖 A，形成错误返工。

Main 的 executeKSwarmReviewSubmission 已读取当前 project detail 用作受限文件引用；将 prompt 构建移到这次固定项目读取之后。新增纯 scope/prompt builder，只从该 detail 中取与 payload projectId/taskId 精确相同的 canonical 源任务，检查 project/run collection 及 task.projectId、唯一 taskId、submitted 状态，不以 payload.sourceTask、模型输出或其他任务替代。缺失/不一致拒绝验收。

prompt 明示 sourceTask 的 title/brief/acceptanceCriteria/requiredOutputs 是当前验收范围；项目目标、plan 与后续任务仅为背景。Markdown/IR 当前步骤不能因为后继 HTML 尚未生成而失败；当前任务若明确要求 HTML，则仍需真实 HTML 及原门槛。保留任务结果、文件证据与真实 passed/failed 决策，不预设通过，不变更任务验收标准、文件读取 allowlist、权限、API 或持久化 schema。其他任务只提供有界标题/依赖作为背景，不复制其原文。

测试：实际 Main runKSwarmReviewSubmission→当前 project GET→模型 runner 捕获 prompt→原 review POST，断言只有当前源任务作为范围、原提交文件只读授权保持。builder 缺 project/task、alias、跨项目、重复、不再 submitted、伪造 payload.sourceTask 拒绝或无效；两种正例分别是 Markdown 任务且后继 HTML、当前 HTML 任务仍要求 HTML。使用现有实际 Hub/runtime bridge e2e 作补充，不能用模型替身 passed 冒充真实 PO 已验收。现有测试夹具补齐其本应真实的 submitted 当前任务 DTO。

先异模型设计评审，再 RED→production→GREEN。安装必须在当前返工 worker 停止且无活跃任务后进行；已完成 Markdown 保留，通过正常 repair_file 路径重投真实 PO，后继渲染仍待执行。

## 已执行验证

- gpt-6-astra DESIGN APPROVE 后写实际 Main→Hub HTTP 回归，旧实现两例均 RED（没有当前源任务范围）；实现后 Markdown/IR 与 HTML 两例通过，保留 reviewer 的 false 决策和原 POST。新增 pure scope 10 项、受限读路径 2 项通过。
- 联同 selected-model 21 项，focused 4 files / 35 tests 通过；旧 PO 队列/控制 lane/排队超时/实际取消 4 项通过（其余 187 项本次未选）；只读 sibling 与 stream/lifecycle 4 files / 30 项通过。
- 官方 Node 22.14 最低版本 7 files / 70 项通过；官方 Node 22.22 真实 issuer/读端口/范围/模型分支 15 files / 101 项通过。adapter/authorization/read recovery 4 files / 219 项通过。
- Main build、typecheck、governance 通过，无新增 baseline 违规。已将范围与模型分支回归接入 CI；云端新 HEAD 另验。
- gpt-6-astra 对当前 scope 增量 CODE APPROVE，未执行测试；实际项目的重新复审与 HTML 尚待安装验收。仅补上下文，不宣称解决既有提交版本竞态，不把测试模型替身当真实 PO。
