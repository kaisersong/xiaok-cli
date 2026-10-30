## 具体风险与最小修正

1. **Kimi 缓冲正文的“未发布”语义不完整**：设计只限制 content 不向调用方发布，但未说明 adapter 是否仍会把 delta 写入日志、trace、usage 回调或 UI 流。最小修正：在 officialReasoningSeen 前完全抑制 content/tool_call 的所有下游 sink，仅保留有界内存；测试断言日志与事件流均无正文。

2. **两次重试共用 messages/tools 但未定义缓冲状态复位**：首坏次好场景里，若首试的 content 缓冲或部分解析状态未清空，第二次会把旧增量拼入。最小修正：每次 attempt 建立独立解析上下文，重试前显式丢弃首试缓冲、工具调用与临时 flag；验收增加“首试含畸形工具调用、次试正常”用例。

3. **“首个请求子句”授权判定脆弱**：CPU 启发式识别显式建项目请求，若 prompt 含“不要创建项目，除非…”“查询创建项目接口”等，子句切分仍可能误授权。最小修正：把判定改为保守 allowlist——仅当整句为命令式创建且无否定/条件/疑问词时授权，其余一律不豁免；增加否定、条件、工具名引用、混合本轮交付的对抗用例。

4. **project_card 与 planningStart 的绑定缺少一致性断言**：设计校验 ID 一致与 sent=true，但未说明两者是否来自同一本轮、同一 request id，以及 journal 中旧 project_card 是否可能被复用。最小修正：要求 create_project 结果与 planningStart 事件带同一本轮 correlation id，并只接受本轮新增回执；验收加“历史 project_card 重放不豁免”。

5. **adapter 层“额外一次”重试与 outer 恢复的边界**：retryable=false 已挡住 outer 30 分钟，但需明确该错误是否仍进入 normalizeRuntimeError 的通用重试分类之前，避免被其他包装层再判可重试。最小修正：在产生该结构化错误处打固定 terminal 标记，normalizeRuntimeError 与 outer 恢复均显式短路；测试覆盖包装层不重试。

6. **usage 计入但失败尝试工具未执行**：需确认 provider usage 在缓冲丢弃后仍与正确 attempt 关联，避免两次尝试 usage 混算或漏算。最小修正：按 attempt 记录 usage 并聚合，字段脱敏；验收断言两次失败时 usage 计数与 attempt 数一致。

7. **验收缺口：post-seal writer 与交接豁免的交互**：设计称成功交接不得再进入模型补产物，但未给“交接完成后 post-seal writer 仍触发”的反例测试。最小修正：加测试证明交接豁免后 post-seal 写入路径不再被调用，且原计划/项目状态不变。

8. **安装验证措辞仍可能被误执行**：设计要求“活动任务未稳态时不得直接替换运行应用”，但缺少可判定的稳态检查项。最小修正：明确稳态判据（无 running 任务、无 journal writer、无 pending delivery），并在候选安装脚本中硬编码该 gate。

APPROVE

END_REVIEW