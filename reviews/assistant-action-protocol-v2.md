# P1a 晨间 action body v2

复用原 ordinary/protected publication，不新建发布owner。v1 recommendations保持双读；v2加schemaVersion=2，每条保留title/reasonCode/evidenceRefs，并增加action={kind,reason,nextStep,instruction}。action kind固定prepare/follow_up/review；main未来生成业务identity，不接收模型dedupeKey/permissionMode/shell/tool名。

只读协议基础，不代表可以执行。尚无launch service时不展示Start，不把解析成功当用户授权。

编码前对抗性自审：
- v2全建议结构共享一个root validator，单项16KiB，title160/reason600/nextStep400/instruction4000/refs1..20；空白和未知字段拒绝，用户指令不静默截断。
- LLM入口在原本那一次模型调用后按本轮main实际提供的reference允许集校验，伪造/跨上下文引用拒绝；旧v1保持原读行为且不可自动执行。
- 新action正文须进入LoopCandidateBody payload hash；protected parser仍做精确shape校验，不能丢掉action后用旧hash发布。正式生产publisher只重新做结构检查，不把结构检查当来源/启动授权。
- snapshot允许集只来自current.items.reference与publication-context已经过滤过的pendingCandidates/latestEvening，不把任意来源正文或pinnedThreadIds当新授权引用。
- 无新增模型调用、工具或权限；output token上限不扩张。源码/生产入口测试与双模型评审分开记录。

未覆盖：proposal durable处置与dedupe、live source current start guard、launch journal/admission、结果验收。这些不能由v2解析器代替。

## P1a 处置投影

在同一Loop数据库新增proposal投影，来源只接受main reader刚得到的current observation；复制前后同事务再次检查其同步current闭包。每次用户处置都重新读取ordinary/protected源，不把持久projection当授权。main用profile+排序引用组+固定action kind生成业务identity/id，模型不能提供key。源变化令open projection revision++；dismiss默认抑制14天，snooze到期读取时恢复。CAS处理多窗口，service内user-only/default-deny；没有Start/ensureTask/resolve能力，startAvailability固定unavailable。旧recommendations只读，不自动变成可执行proposal。

处置设计自审：拒绝跨profile/未知id/旧revision；撤权或源不current不写；失败事务回滚；模型同义标题不逃避稳定事实去重；dismiss不自动重新打开；不新增poller。当前原生/local admission仍无assistant durable ensure/lookup，投影不得冒充已开始任务。
