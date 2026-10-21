# #73 主干集成验证补充

前置已满足：PR73 merged，master=3b4061489a612337fdb2fc1eb92e96c1d4fbe9a1；PR74旧head=292936ce80da8b5acb7b8dbb254e91dd788beb3c。
保持原摘要完成边界，合入已批准master，不改权限/披露/capacity/semantic预算协议。
唯一冲突 CompactRunner：同时保留 master prepareRequest 的 defensive clone/实际规划接口，run 消费该准备结果；保留 PR74 requireCompleteResponse/collector，不恢复宽松text收集。其余实际adapter自动合并应保留披露context、signal与语义单次调用限制。
测试先保留并加强 prepareRequest→run 相同body、input不变、旧summary完整性所有负例；核新semantic caller真实请求body等价，预算/披露字段不因内部flag丢失。
执行 Node24 root全量source、Desktop全量main/renderer、CLI/desktop完整构建/typecheck/governance；最低Node22跑实际相关原套件+新semantic/disclosure/capacity回归，GitHub三OS矩阵核新完整HEAD。
测试读取隔离profile，依赖复制到本worktree后才运行会修补类型的脚本，不修改共享node_modules。自己runner PID/PGID逐个记录、回收，不模糊清理。
发现失败须区分本集成回归与相同master可复现问题，不能改断言/扩时/更新baseline来抹平；补证据并在PR说明未覆盖项。只更新PR74，不自动合并PR。

兼容修订：完整空白摘要由collector拒绝，但semantic reservation须维持master settled（不是摘要安装成功），否则compound-deletion-census会新增永久删除阻断。仅对内部CompactionResponseError.reason=empty，在非取消catch中settle settled后继续失败；其他不完整/迟到异常unknown、不退款/不重发/不commit，结算写失败保持传播。保留master empty settled断言，补原生产semantic链与删除census回归。A/B/C重新核兄弟入口后均同意此窄修订。
