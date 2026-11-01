# P2 事实语义与按需记忆接缝（2026-11-01）

## 设计与证据

已读 AGENTS、工程经验台账、父设计 §8/§10/§16，以及现有 source/store/native/transport。无 .codegraph，未建立索引。现有 source 身份含 start，改期造成身份漂移；固定 unknown/partial 不是 P2 完成。

本轮 npm registry 查询 @yunzhijia/cli latest=0.1.8，原生 --version=0.1.8。官方发布包 calendar.md 定义 get/update 的 id 为日程 ID，支持 Unix 毫秒输入；没有返回 schema、循环实例 ID、revision 或分页契约。list/get help 无分页 flag。真实独立 xiaok-assistant profile 仅执行一次 list 和一次 get，输出仅字段类型/数量：18 条，回执 count/list；detail id 与列表一致，含 repeat(int)、cancelTime(int)、timeZone(str)，不含 occurrenceId/revision/allDay。不输出事件 ID、标题、正文、参会人，不保存响应，不执行写命令或 logout。官方包：https://registry.npmjs.org/@yunzhijia/cli/-/cli-0.1.8.tgz 。

实现：将 account+provider id 散列作为 provider_record 身份，明确不是 occurrence 身份；观测 revision 为规范化已显示字段的本地摘要，不能冒充 provider revision。相同 ID 的冲突记录拒绝本次 generation；同记录改期沿用身份。比较上一成功观测得到 added/observed_changed/missing_unconfirmed；缺失永不取消。失败不丢上次事实作为下一次比较基线。完整枚举证据和语义能力分开记录；无完整分页契约不推进 watermark，不构造 delta/checkpoint 假能力。unknown allDay/cancelled 是明确未证能力，P2 provider 验收仍未完成。

长期记忆：新增 main-private helper，独立 enabled opt-in；只用既有 MemoryStore.listRelevant/getById，无写/新检索算法。可信 owner/profile/cwd/current/access-and-confirmed 回调由主线程提供，记录本身没有 owner/confirmed 字段，不能猜测。scope 过滤加当前 getById 重读，去重，最多6条，整个返回记忆数组 UTF-8 <=8KiB；失败 unavailable，成功空 empty，不得解释为无承诺。来源和记忆文字标为 data，无工具执行能力。主线程最终发布前仍需 current guard。

## 实现前对抗自审

1. 开始时间不是身份：移出 key；但云端未保证循环 instance 身份，因此标 provider_record，不生成场次 claim。
2. 消失可能分页/窗口迁出/权限变化：只能 missing_unconfirmed，绝不 cancelled/out_of_window。
3. digest 只描述本地观测，不能比较 provider revision 顺序，不能声称追完历史。
4. 重复 ID 相同内容幂等；冲突内容不允许最后一条静默获胜。
5. 失败和撤权都不可变成 empty/无承诺；撤权晚到 memory 返回整批丢弃。
6. listRelevant 可能返回跨 scope、旧版本、未确认记录，必须 getById 重读并复验 trusted access/confirmed；无 getById 禁用 personalization。
7. 不改 main/renderer/IPC/locales；旧 snapshot 可解析，新元数据 optional，不扩大外部命令白名单。
8. 测试先行，使用真实 LoopStore；最终不同模型 Kimi 评审，不把自审当独立审查。

## 主线程同步后的增补设计/自审

独立记忆设置在现有 calendar store migration 增加独立 owner/profile 表，默认 false，单调 revision，user-only CAS；不复用 calendar enabled。导出窄 read/set 函数，主线程负责 LoopStore transaction wrapper 与 IPC/UI。source.context() 提供 main-private lineage 与 read/isCurrent 闭包，绑定账号/epoch及snapshot摘要；撤权、换账号、新snapshot均失效。闭包只能保护新的读取，不能擦除消费者已复制的正文；因此在晚报持久 owner 的读取/派生 visibility overlay 接好前禁止将正文持久化。对抗检查：记忆开关不能因启用日历自动开启；其他owner/profile不可读；过期revision不能写；source旧context撤权后不可再读。复审明确区分窄接缝批准与主线程集成验收，未接线不声称生产授权完成。
