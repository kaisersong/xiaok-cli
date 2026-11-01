# 交办结果不确定的排查

1. 在已交办事项点击“重新检查”，通过getAssistantLaunch({draftId})定位相同operationId、threadId、taskId。无回执不重新confirm或复制成另一交办。
2. 主进程只读查询原TaskHost checkpoint/journal，并校验assistantBinding的operationId/requestDigest/threadId；multi-agent同时由原owner核对root binding、boot、epoch、queued/lease，不能只看文件存在或root ID。
3. 若原owner能确认原任务已执行或终止，服务以原snapshot投影，终态才释放active claim；已有原任务可打开其详情，问题/审批使用原服务。
4. 若只有root binding、缺checkpoint、旧boot preparation或读取不可达，保留outcome_unknown/manual_repair。仅原owner可完成恢复、取消或未执行退役，并提供真实回执，再由service读取该终态释放claim。超时和“我觉得没执行”不构成证明。
5. 禁止人工删SQLite行、重建reservation或强制释放unknown claim。活动同步失败不是重跑依据。标记已查看只记录结果版本，不改变失败/成功。

当前限制：native与protected publication无共同提交fence，直接启动不可用；保留原手工任务草稿路径，明确可能重复。重启前已preparing而未能证明进入running的交办不自动重派。
