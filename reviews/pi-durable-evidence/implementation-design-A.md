独立席 A：**APPROVE**

审定对象：`reviews/pi-durable-optimization-implementation.md`，SHA256 `3d883cdd658bfbfdadac4bea28dc4e0d80e253ae121d8a38ff7f9fc74f3a33f8`。本轮已重新完整阅读该版本，按当前新哈希独立表决。起读的 `cfb387eb…` 在审查过程中发生漂移，已向主笔报告；没有对旧哈希出具或复用裁决。

基线与已读证据：

- 实际 `git rev-parse HEAD` 为 `dc221f9bac84d939b8fb543d4795396693fdc9b8`。没有 `.codegraph/`，本席使用只读搜索和源码阅读。
- 已读真实 `CompactRunner`、legacy `compactConversation`、五个 provider conversation wrapper 与其 strict Kimi 授权签发/保留/重试核验、`executePortableCompaction`、CompactRunner 既有测试。
- 已读 Claude adapter 的 SDK stream、终态、usage、超时和 retry；OpenAI legacy 的 SDK retry 配置、外层 retry/usage 包装、内部 finish_reason/EOF/strict Kimi 特殊处理；Responses adapter 的 HTTP/JSON、status、usage 和 retry；System One 的完整 JSON 消费链。
- 仅作静态实施设计评审，没有运行 provider、模型或产品测试，没有改产品代码，没有读别席票。真实受控失败回归仍须按补充方案先运行，不能把本票当已完成 P0 的实测证据。

P0/P1/P2 阻断问题：**无**。

主要判断：

1. 父 v3 的准入边界得到保留。预算契约不完整登记 qualification_unknown，既无模型名猜测补洞，也没有引入新容量门。缓存缺代表性 trace/独立 holdout 维持 unknown，不以 50 个文件和磁盘字节推断 heap 收益。U/C 未合并能力保持待集成，未伪造当前 master 的通过项。
2. 压缩失败误报成功有可操作的真实代码轨迹。CompactRunner 只拼接 text；Claude 的默认 max_tokens 截断仍会走 message_stop/done，只有显式 maxOutputTokens 触发原拒绝；OpenAI legacy 的默认 length 可走 done；Responses 默认 incomplete 可解析正文后发 done。补充先用真实 adapter+CompactRunner 固定响应复现，再修改，符合父方案另一项“实际失败误报成功”准入，且不需要声称已证明请求超容量。
3. requireCompleteResponse 是内部消费契约，限于两条摘要入口。它不序列化到请求体、不改正常任务参数/终止语义、不充当新授权；五 wrapper 现有 options 透传及 strict 分支的对象展开均能保留它，同时保留原 providerConversationAuthorization。方案未授权对缺少凭据的 strict adapter 开旁路。
4. 完整流 collector 的完成条件和 adapter 终态条件分工合理：collector 验证非空/无工具/done 及迟到输出，adapter 验证 provider 真正完成；仅 collector 看到 done 不能替代后者。Claude stop_reason、legacy finish_reason 和 Responses status 都有明确允许条件，默认截断不再因未设置输出长度而被豁免。CLI 失败继续落入既有 portable fallback，不能安装半截模型文本。
5. drain 与 usage 边界得到明确约束。OpenAI generic 现有 finish_reason 后 return 会漏掉 trailer，补充明确严格摘要路径读到 iterator 结束；strict Kimi 现有缓冲 usage/授权重试边界需保留。Responses 失败状态须先观察真实 payload usage，再抛失败；缺失不制造已结算事实。补充只要求原消费链观察 usage，没有声称补出当前基线不存在的 ledger。
6. 新冻结文本区分了 legacy Desktop 的完整空白 no-op 与不完整失败。后者及已有 chunks 后的原迟到错误/取消不能进入 historySnip；只有无任何 chunk 的原网络等请求错误保留既有 fallback。该 export 在 master 没有运行调用点，方案据此限定验收声明，没有把孤立 export 测试当普通 Desktop 实际任务验收。
7. 现有显式 maxOutputTokens 行为保留、正常对话不改、原错误身份和取消优先、无自动重派及 options 不变等均进入必要回归。源码/完整 HEAD 独立核验及安装包边界仍在，当前批准不替代这些实测。

非阻断的落地检查提醒：

- OpenAI strict Kimi 当前有 `attemptState && emittedDone` 后忽略非 usage chunk 的分支。新摘要路径不能因此隐藏 provider stop 后的正文/工具或后续失败终态；用真实 adapter SDK 夹具验证，不能只测 collector 的人工 chunk。
- Desktop 的完整性错误应有内部可判定标记；无 chunk 的 unknown/缺 terminal 也不能被当作“原网络错误”触发 snip。取消不论发生在首个 chunk 前后都应按既定“取消优先”原样拒绝。
- Responses 当前在收到 headers 后清 timeout、再读 JSON body；这并不证明 body drain 已有完整时间界。若本批保持此现状，报告应保留这一限制；不要从“沿用现有 timeout”推导已验收 body 永不挂住。
- usage-only trailer、首个 stop 后第二终态、迟到原异常、strict Kimi EOF/tool 特例都应纳入受控实际 adapter 轨迹；终态失败自身不可被 retry classifier 当成网络抖动而重派。

最终针对 SHA `3d883cdd658bfbfdadac4bea28dc4e0d80e253ae121d8a38ff7f9fc74f3a33f8`：**APPROVE**。

本票批准该实施补充所述的先复现、再最小修复流程；不是产品实现验收、完整请求预算修复或缓存收益证明。
