# 主线程接线与验收边界

本轮只改 calendar source/contract，新增 calendar context helper 和对应测试；未改 main、renderer、IPC、locales。既有 transport/native/store 未扩权。真实工作环境仅执行 calendar event list/get；保留 xiaok-assistant，不 logout，不写日程、不邀人。

## 可接线

- source snapshot.observation：identity=provider_record，records 为 hash ID 与本地 observationRevision，window/observedAt 记录基线窗口与时间（失败时保留原值）；added/changed/missingUnconfirmed 是相邻有效观测差异，不是 provider 变更日志。失败保留摘要基线（无正文），下轮比较不丢失；grant 轮换通过原 store 清除旧 generation。
- changed 只能说明已显示事实发生变化，不能自动说“会议取消/循环场次改期”。missingUnconfirmed 不生成取消建议；即使完整枚举也不能如此推断。当地时间仅在有效 IANA timeZone 存在时使用，不以机器时区填充缺值。start/end 是毫秒绝对时间；allDay 未获证明，不从午夜推导。
- readAssistantCalendarMemory：主线程单独提供 memory opt-in，不与日历开关绑定。store 已导出 readAssistantCalendarMemorySettings(db,{ownerId,profileId}) / setAssistantCalendarMemorySettings(db,{ownerId,profileId,enabled,expectedRevision,requestSource})，默认关闭、user-only CAS，需由 LoopStore 加事务包装。传现有 MemoryStore、可信 actor ownerId/profileId/cwd、已选择事件的有界 query；不传 renderer 任意检索范围。isCurrent 闭包必须捕获并复核 owner/profile/calendar grant/memory consent epoch；canUse 必须从既有 owner 证据核实当前访问与用户确认，不能恒 true。现有 MemoryRecord 无 owner/confirmed 字段，无证据就拒绝该记忆。
- helper 复用 listRelevant/getById，返回 kind=data 的最多6条、序列化数组<=8192 UTF-8字节，条目 ID 即引用证据；外层 prompt 的 token 预算仍归原晨报 owner。available/empty/unavailable/disabled 分开，不把 empty/unavailable 解释为“没有承诺”。返回后最终发布前再复验 current；不得从文字执行指令。
- 准备建议以选定事件事实与可用记忆作输入，区分事实与推测；仅参会不能断言用户必须行动。未验证取消/循环身份时不生成相应确认性建议，不接任务自动执行或通知。

source.context() 返回 {lineage:{source:calendar,epoch,revision},isCurrent,read}；read 每次校验绑定的 account/epoch/snapshot 摘要，失效返回 undefined。临时读取正文不能自动保护消费者已复制的持久输出，visibility overlay 就绪前禁止写入原晚报。

## 未完成的父 P2 验收

官方 CLI 0.1.8 无分页参数，真实 count/list 不能证明完整性；无可证 occurrenceId/provider revision/allDay/cancelTime枚举契约。因此不启用 delta，不伪造分页 checkpoint，不推进 lastCompleteWatermark。status 仍 partial 是 provider 能力限度，不以此宣称 P2 完成。重复 ID 冲突拒绝整次观测；同 provider id 的身份稳定只适用于记录定位，不承诺循环实例身份。官方需要补充返回 schema、分页/完整窗口集合、取消 tombstone、循环实例及改期身份保证后，才能继续 E01–E04。真实读取样本不构成准备建议准确率/收益验收。

## 本轮验证

原始合成测试/构建/检查日志已保留在 reviews/artifacts/assistant-calendar-p2/；真实响应未持久化。

- 先红：/tmp/p2-calendar-red.log（身份漂移、重复冲突），/tmp/p2-memory-red.log（helper 未实现），/tmp/p2-baseline-red.log（失败后丢基线）。
- 后绿：/tmp/p2-calendar-green.log，5 文件29项；/tmp/p2-build-main.log，build:main 成功；/tmp/p2-typecheck.log，Electron/renderer baseline clean。
- /tmp/p2-governance.log 与 /tmp/p2-architecture.log，均0新增违规。
- hygiene 开工失败：sibling intent-broker 落后上游1提交且已有 tracked 改动，未动 sibling。
- 未执行安装包、真实写/取消/改期、P2准确率试点、完整仓库测试；未提交代码。没有启动后台服务；Kimi 评审进程结束后残留自有服务进程0。

最终Kimi接缝条件批准见 assistant-calendar-p2-kimi-review.md；事务guard抛错回滚已有生产LoopStore回归证明。新memory设置事务包装、actor/current映射、正式派生遮蔽仍由主线程验收。持久记忆派生还需memory IDs与内容指纹，读时getById重新核实当前scope/owner/确认资格；consent revision不能替代删除/修改检测。请将assistant-calendar-context.test.ts、assistant-calendar-memory-settings.test.ts加入显式CI清单。
