# OpenDuet 候选复审状态（2026-11-01）

## 16 时后续独立复核

以下为最新状态，取代下表中两项待复核阻塞；旧票原文保留。编码 Codex GPT-6，独立复核为已配置 Zhipu API 实际返回的 `glm-5.3`，HTTP 200、finish_reason=stop、四组 sourceDrift=[]。

- 内部祖先撤权依赖：APPROVE，未发现 P0/P1。
- 人工风险标签 authority：APPROVE，确认 freeze 在持久化前按 selected sample 过滤 facts，原 Kimi P1 已裁决不适用；不赋予真实人工质量资格。
- CI/SQLite 兼容实现与八处实际生产集成：两组分别 APPROVE，未发现 P0/P1。
- 限域票和 source hash 见 [新票目录](artifacts/openduet-followup-20261101/)。非阻断 P2 保留原票，包括保守 exact SQLite error、已有 copier 文件读取硬化、人工复核重导入体验等；本轮不放宽事务错误识别或安全 gate。

ZCode 预设计票已返回 APPROVE；其余 CLI 包装轮次主动停止、无票。实际最终批准来自上述直接 API 原始响应，不按退出码推断。限域静态批准不代表全仓产品验收。

## 前轮历史状态

作者 Codex GPT-6；独立模型 Kimi CLI 2.2.0 / kimi-code/k3。这里只记实际裁决和范围，不把源码测试、超时或无 verdict 当独立批准。全部小型 manifest/run/verdict 见 artifacts/openduet-recovery-20261101；完整 prompt/bundle/输出留在 ignored .artifacts/openduet-recovery-20261101。

| 范围 | 实际状态 | 当前边界 |
| --- | --- | --- |
| 有效配置/凭据身份及持久撤销 | identity-r2 APPROVE、exit 0、sourceDrift=[] | 包括 settings、纯 reader、质量组合 callback 和 LoopStore 摘录；不是整个 PR 批准 |
| 人工复核 workflow/native 文件读取 | quality-workflow-final APPROVE、exit 0、sourceDrift=[] | 含已修的增长文件读取及真实文件回归源码；只做静态审查 |
| main 日历/记忆组合、真实计费预测 | quality-composition-final APPROVE、exit 0、sourceDrift=[] | 补齐 budget helper 后撤回原 cast/usage P1；保留可信 provider 低报不可本地检测假设 |
| 人工风险标签 authority | quality-authority-final BLOCK | P1 指控依赖“未抽中 facts 被存进 record”，但实际 workflow.freeze 先按 selected sample 过滤 facts。新增生产完整两阶段回归：200 个事实→100 个抽样，未抽中预标风险不持久化，两次人工导入成功；10 项该文件回归全过。作者判不适用，仍待另一模型复核，不自行改写 BLOCK 为批准 |
| 内部祖先依赖 | lineage-final BLOCK 的 P1 已代码修复 | 所有 tracked 祖先都保存关联；可选 external 只分路由，不跳过可见性，旧 refs 保守按外部。先红后绿，保留普通内部 P1 能力；待修复后独立复核 |
| 最后修复复审 | lineage-closure exit 1，无批准 | 原始错误：429 You've reached your 5-hour usage limit。已停止重试，按台账第 48 条请求授权替换评审模型 |

不得照抄风险摘要中的部分建议：给 stored riskReview 直接比较当前 digest 会忽略风险导入后 digest 本就更新；把所有 parent 都当外部会阻断普通内部历史的开始处理；把实际超额 usage 截断到预留值会漏计真实费用。最终裁决应基于完整生产调用链和回归，而不是缺上下文的条件推测。

已批准范围仍有非阻断 P2：配置任何字节改写导致保守撤销、DB 读取诊断、取消导出后阶段保留、原生窗口并发保存旧导出、同 digest 未知失败不重发、短凭据/非标准秘密文本的遮盖边界等。它们没有被标成“零发现”；详细原票保留。空来源可完整枚举但不够资格；风险包导出不等于授权 P3。

此前 calendar scoped manifest 与当前源码一致；provider/resources 的未变部分沿原票，identity/settings 的变化由本次 identity-r2 单独覆盖。packaging/smoke 原票的受审源码 hash 已再次逐文件核对一致。旧 lineage manifest 的两个生产文件曾有漂移，已经明确另审，不沿用旧票冒称新范围已批准。

当前保持草稿，不自行合并或发布；真实人工质量、P1 交办试点、Windows 安装包验收与最终 CI 另列。额度阻塞不等于源码已通过。

历史批准票的 Git 可读副本只规范了末尾空行；完整逐字原件仍在本地 historical-review-materials，未修改原始材料或 source hash。
