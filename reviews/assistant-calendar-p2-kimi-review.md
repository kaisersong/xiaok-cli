# 独立 Kimi 复审记录

编码：Codex GPT-6；评审：Kimi CLI 2.2.0（独立不同模型）。未把自审当独立批准。

首轮终票 BLOCK，原票见 artifacts/assistant-calendar-p2/kimi-initial-block.txt。

- P1-1 缺少 epoch 轮换证据：已补 assistant-calendar-store.ts 的 expectedEpoch CAS/epoch+1/旧 generation 清除代码、原 LoopStore transaction 包装及 disable→enable换账号回归；已实际通过。
- P1-2 要求实际main独立开关/owner/current接线证据：该共享接线由主线程拥有，本轮新增独立memory设置store和source.context授权闭包。生产集成仍未验收；正文禁止进入持久晚报直到visibility overlay接好。不能把窄接缝的代码评审替代主线程授权验收。
- P2错误分类/并发singleflight/失败隐藏正文为原有source行为，未在本轮改变。失败隐藏正文是fail-closed策略，比较基线单独保留。MemoryStore.getById按既有接口同步，不引入异步能力假设。

第二次复审240秒无终票，进程已结束；无provider错误码，不归因为额度。最后以最终代码做有界复审，退出码0，终票 APPROVE（带条件）；原票见 artifacts/assistant-calendar-p2/kimi-final-conditional-approve.txt。该批准只针对main-private接缝，生产授权接线仍未验收。最终文件摘要见 assistant-calendar-p2-review-manifest.json；最后一次窗口元数据补齐已包含在最终代码复审中。

最终生产文件SHA256与最后一次Kimi送审记录完全一致。最终增加一项实际LoopStore回滚测试后共29项通过；测试名整理及此新增测试在终票后完成，未修改送审production code。

事务条件补证：当前loop-store.ts:257–258的calendar写入口均包transaction；:2536的transaction使用BEGIN IMMEDIATE，catch执行ROLLBACK。新增“rolls generation insertion back when the final authorization guard fails”直接调用生产LoopStore，第二次guard失败后读回与原snapshot完全相同。新memory设置仍需主线程增加相同事务包装，不自行宣称已接通。
