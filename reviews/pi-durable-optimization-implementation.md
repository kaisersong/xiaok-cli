# pi durable v3 实施补充：完成边界与 P0 裁决

基线：`dc221f9bac84d939b8fb543d4795396693fdc9b8`，独立 worktree。
父方案：mydocs `2026-10-21-pi-durable-optimization-design.md` v3，
SHA256 `3176c2ca07bf9cab94416b3d4b3cc91e476cae85692b3ac95417e28841d9d6f9`。
本补充仍须独立对抗审查；不沿用父方案为具体实现提前批准。

## P0 基线差异与准入

本批只基于已合并 master，不拼接 U/C 未合并实现。master 没有 U 的 capacity profile/
observation request projection，也没有 C 的 canonical input queue；这些父验收保持待集成，
不能记成通过。原有 provider authorization、Kimi strict 与任务物理取消/回执要求保留。

预算普查：CLI chat/subagent、CLI CompactRunner、Desktop 普通/Goal/定时任务与 side call
经过五个 provider conversation wrapper；实际 transport 在 Claude、OpenAI legacy、Responses、
System One adapter。master 中 window 来源包括默认/名称推断、catalog 与用户 runtimeOptions；
没有完整 serialized request token 上界/多模态/默认输出资格契约，不能由“请求很长”证明超限。
因此父方案完整请求预算拒绝本批为 qualification_unknown，未批准新增通用容量闸。

已定位可证伪的另一个 P1 准入：CompactRunner 将 stream 的 text 直接返回，无需 done/非空/
无工具；Claude 默认 max_tokens 被截断时只有显式 maxOutputTokens 才拒绝，OpenAI legacy 的
length 和 Responses 的 incomplete 也只有显式 output limit 才拒绝。摘要通常不设置该值，
故实际 adapter 的失败可被当作成功摘要。这不是容量推断，也不需要付费请求。
先用真实 CompactRunner+实际 adapter 的受控 SDK/HTTP 响应复现，再做最小修复。

缓存资格：只读本机实际 `.xiaok/desktop/tasks/snapshots`，当前 50 文件、10,936,366 字节。
数字须由本批 inventory 输出核对，不作内存收益。缺少实际历史浏览/多窗口/订阅访问轨迹，
无法按父方案冻结代表性 workload 与独立 holdout；P2 为 unknown，本批不改缓存/Host pin 协议，
不以合成热冷序列代替真实收益门、不运行一小时无资格 benchmark。
kai-mbp 初次检查可连，后续 SSH 超时；不据此假定远端不存在材料，不重复长轮询。

## 本次产品变更：明确要求完整的压缩响应

1. 新增内部 StreamOptions `requireCompleteResponse?: boolean`；只在两条摘要消费入口置 true：
   CLI CompactRunner 与 legacy Desktop compactConversation。不是公开配置、IPC 或权限凭据。
   正常对话/工具流维持现有终止行为和请求参数；此字段不序列化到 provider body。
2. 纯 collector 消费完整流，要求至少一个 done、非空正文、无 tool_use、done 后无正文/工具；
   唯独 legacy Desktop 明确允许完整空白响应保持原 no-op，不能安装 boundary。
   仅 usage 可在 done 后排干。迟到错误保留原对象；signal 取消优先，不能安装摘要。
   不因已读到 done 而提前 return，从而吞掉后续 usage/错误。
3. 实际 adapter 对 requireCompleteResponse 明确验证 provider 终态：
   Claude 需要 message_stop 且 stop_reason 为 end_turn/stop_sequence；OpenAI legacy 需要 stop，
   length/content_filter/tool_calls 或 EOF 无 terminal 不批准；Responses 需要 status=completed。
   System One 是非流 JSON，完整读取/解析后结束，collector 仍校验非空/无工具。
   原显式 maxOutputTokens 的 memory_output_incomplete 行为保留，不影响已有用户。
4. 尽量先排干已有 usage 再报告失败：OpenAI 的严格摘要路径读至原 SDK iterator 结束，
   trailer usage 保留，沿用现有 timeout/abort；Responses 失败状态也保留 payload usage；
   Claude 收齐 stop 后再验证，usage 照常经过流。缺失 usage 不编造为零或已结算。
5. CLI 失败继续走原 executePortableCompaction 的确定性 fallback，并报告 compact_failed；
   不把局部模型正文作为摘要安装。保留原成功 fallback 和真实无替换/无收益行为。
6. Desktop legacy export 在 collector 不完整时拒绝 Promise，不插入 compact boundary、
   不删除原历史；已有 chunks 后的迟到原错误/取消也原样拒绝，不走 snip。
   只有未收到任何 chunk 的原网络等请求异常保留既有 historySnip fallback；完整空白仍 no-op。
   该 export 在 master 中
   只有 import、没有运行调用点，不能据其测试宣称普通 Desktop 产品流程已经验收。
7. StreamOptions 现有“按同一对象透传”的测试需按这个明确接口变化扩展：验证原字段不丢、
   原对象不变、requireCompleteResponse 为 true；不删旧异常/脱敏/真实 fallback 断言。

## 所有权与兄弟入口

collector 无 durable state、无后台任务，不增加预算或调度 owner；不触碰 store schema。
所有支持相同 adapter 的五个 provider wrapper 都传递 StreamOptions，避免 SDK 路径绕过请求契约。
工具/普通文本/记忆提炼不会自动被标成压缩；其原有规则不放松。
late usage 只被原消费链观察，不声称新增了父 U 分支的 provider ledger 或恢复/重放能力。

## 必要回归

- 真实三 adapter+CompactRunner：完整成功、默认输出长度截断、拒绝/过滤、EOF/未知终态；
  传输调用次数、无自动重派、原 option 字段不丢且未修改。
- collector：缺 done、空白、thinking-only、工具、done 后文本、迟到 usage、迟到原错误、
  abort（包括已读 done 之后）均按真实生产入口断言。
- CLI AgentRuntime：真实截断模型摘要不能安装；既有 deterministic fallback 正常且事件诚实。
- Desktop legacy：不完整时拒绝且 messages 原字节不变；原网络 fallback、空白无修改及成功保持。
- P3 仅做真实 store 故障审计：损坏/拒绝的读取不能被报告为可信空状态；若发现缺口，
  另写最小修订并复审，不预先批准 SessionFailed 全局封闭服务。
- Node 22.14/24 的 focused suite、root/desktop 类型与构建、治理增量；按 PID 清理自己的进程。

## 完成边界

本批实施完成声明仅覆盖 P0 普查/裁决、压缩完整性子批及实际运行的回归。
完整 wire 预算门、缓存回收、P3 新故障协议均不得冒称完成；真实 provider、Windows 安装包/
ASAR/本机日用入口不由单测替代。必要更改先复审本补充，最终源码和完整 HEAD 再独立核验。
