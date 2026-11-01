# P3 gated analysis cost owner

周期检查按父设计默认关闭；缺100个真实标签评估或精确 provider tokenizer+强制输出token上限时返回quality_unverified/budget_unavailable，不接原text-only LoopLLMPort，不增加模型调用。此处不声称质量通过，也不自动启用新定时器。

Loop SQLite同owner新增attempt账本与logical clock。reserve同事务单profile rolling24h≤6次/input48000/output6000；attemptId绑定occurrence+inputDigest+provider/tokenizer contract、最坏预算，重试同ID不会重复预留或换内容。sent前CAS reserved→sent，超过10分钟不发送；仅sent可结算。usage未知/取消/崩溃sent保持最坏扣除，不自动重发。logicalNow=max(durable,observed)，回拨/时区不重置。预算审计不含prompt/事件正文。

对抗性自审：agent不能reserve/send/settle（仅固定scheduler/user owner），未知attempt不凭空settle，重复settle冲突不退款。不同attempt并发最终由SQLite串行事务裁决；计量超预留视provider contract breach并保守计入更高actual，后续分析拒绝。preflight无质量/精确计量时不会先预约再调用模型。

通知仍由既有activity owner投递；未有该owner消费的policy gate时P3不开启，不新建notifier。quiet-hours/差集claim/rolling预算的完整投递门禁与真实100样本验收仍须一起闭合后启用，不能靠一份成本账本宣称P3完成。

独立Kimi首次BLOCK指出caller now。已移除public service时间输入，reserve/sent/settle统一在输入spread后写main-owned now；fake远未来时间回归先失败后通过，回拨通过注入main clock验证。原LoopStore raw helper仍只在同main owner内部使用。P3已接入既有调度器的默认关闭接缝，没有active schedule或实际模型调用；budget ledger不能单独算真实周期检查验收。
