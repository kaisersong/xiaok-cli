# Yunzhijia calendar source / read-only

复用 LoopStore 连接，新增 connection/grant epoch 与 frozen generation/event/checkpoint 表。主进程原生文件选择器只选择 yzj-cli 原生二进制；拒绝shim/符号链接并验证固定发布hash。profile固定xiaok-assistant，不接IPC任意profile/命令/URL。固定contact user get的orgId/openId生成hash，读取前后验证账户，token归CLI keychain。

connect/disconnect是user-only本地授权，不操作远端日历也不logout；disconnect递增epoch，旧epoch事件不可读。撤权响应晚到事务尾拒绝；账户切换必须重新连接，不自动合并。

仅保留实际核实字段id/title/startDate/endDate/timeZone；cancelled/allDay/selfResponse/recurrence未知则明确unknown，不抓description/participants。晨报独立只读信息块，未知循环实例不能作为可执行建议的证据，不能生成确定的本人行动/取消结论。无额外模型调用，原晨报输出1200token不变。

窗口[now-24h,now+7d)，每run≤200条/1MiB/30秒。CLI无分页，缺完整性回执存partial不推进completeWatermark；无可用cursor则下轮有界全量重扫，不盲重复请求假装续页。事件+覆盖+checkpoint同事务；仅完整枚举可标out_of_window，缺失绝不推导cancelled。失败保留旧watermark，旧事实标stale。epoch及generation尾检查防止rollback前写入旧授权数据。

对抗性自审：非user不能enable/disable，binary/profile不能由模型提供；错误仅稳定code；无日志正文/凭据；unknown不等于无事件；收集单flight，无新轮询器。来源默认关闭，由明确connect启用。不声称CLI未知语义已验收。

实现限定：真实CLI语义未证明时，晨报仅接入calendar状态/errorCode，不向模型提供日程正文/ID，日程本身仅在可撤权的独立agenda读取展示。这样不产生未实现lineage遮蔽的模型派生正文。后续证明provider contract并接通所有publication派生epoch门禁前不得扩大模型输入。此为保守可用的日历读取，不冒称P2完整验收。
