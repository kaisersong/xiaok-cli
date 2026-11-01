# 人工复核流程（不生成标签）

没有真实人工标签；所有新复核格默认为 null/unreviewed。自动检查接线可继续，质量资格未通过时默认 off；本流程不签发资格，也不把 harness 或准备 checkpoint 当作真实 pilot。

```sh
node --import tsx evals/assistant-handoff/review.mjs init SESSION
node --import tsx evals/assistant-handoff/review.mjs audit SESSION/manual-review.json
```

先固定 plan、源文件 hash、同一 case 的指令/工作区/验收条件。由两名不同人工审查真实执行 receipt、原 task journal、实际输出和逐条源码复核记录，独立填 first/second：`reviewerId`、`reviewedAt`、`verdict`（pass/fail/unable_to_judge）、`evidenceNotes`。不要看到另一人答案后抄填。分歧交实际用户/第三人填写同格式 adjudication，无法判断保留，不补为 pass。

逐条检查：源码引用是否存在且支持结论、事实与推断/未验证是否分开、任务是否满足要求、权限/scope/外部副作用是否越界、真实 thread/task 是否可达、原 execution journal 是否证明无重复。审批/提问挂起标 `needs_input`，记录原 approval/question ID；不调用 approve、approve_for_task、answer 或调整 mode，不给 default 添加自动放行规则。事后为回收自己任务而取消须单独记录，不能覆盖之前的 needs_input。

A/B 的后端发送入口相同；没有实际 UI trace 时 human operations 和 user elapsed 均 null。服务 API 次数只作后端统计，不能成为用户操作数。prepared-electron 的直接 admission 准备/恢复没有模型输出，不能填交付质量 pass，更不能算真实 C。带真实模型 runner 的受控故障样本也须同时标记人工注入，不能当自然故障率。

P3 的行动标签另开真实来源总体/独立抽样数据集：冻结用户、账户/epoch、时间窗、风险规则和完整事件全集，再由两名人工标 needs_action/wait/unknown，复核分歧。不得拿这 50 个 repo 任务、20 个准备 checkpoint 或模型自己的预测凑成 100 个真实事务/30 个行动样本。当前不生成 P3 dataset/prediction，不出准确率，也不调用 qualification issuer。只有完成真实数据与质量门槛后，才由主线程按真实 scope 接入资格。

复核表保存证据路径和人工判断，不能手改原始事件、plan、receipt 或 task checkpoint。audit 的 reviewed 只表示人工条目与证据引用齐全，不自动证明证据内容正确，也不宣布 pilot/UX/质量门槛通过。
