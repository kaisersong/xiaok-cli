# Google Calendar 后续来源备选（已退出首期）

用户最初选择 Google Calendar，随后明确改为云之家 CLI，Google 留待后续；尚无 Desktop OAuth 客户端，本文件保留调研记录，不代表继续推进首期Google接入。当前先实现有界、只读 provider adapter；尚不能称账号已连接或 P2 完成。

官方契约（2026-11-01核对）：
- https://developers.google.com/workspace/calendar/api/v3/reference/events/list
- https://developers.google.com/workspace/calendar/api/v3/reference/events/get
- https://developers.google.com/workspace/calendar/api/auth
- https://developers.google.com/identity/protocols/oauth2/native-app

范围：main-private CalendarReadAdapter，精确登记GET events.list/events.get，无任意tool/URL或写API。仅接收main当前grant及vault引用解析，拒绝未consent/epoch/账户/scope不匹配。令牌不进入DTO、日志、cursor或SQLite；禁用redirect以免凭据泄露。list使用冻结的完整窗口、singleEvents=true/showDeleted=true、pageSize<=50，不用syncToken；access denied/429/410与空列表分开。增量语义先按设计全窗口对账，不偷用delta。

规范化：不保留description/attendee身份；保留本人角色/响应。全天日期不转UTC零点；循环originalStartTime作为occurrence来源；取消tombstone可只有id/revision，不因缺失时间被丢弃。sourceLink仅允许Google Calendar官方HTTPS来源。

编码前对抗性自审：
- 撤权在请求/JSON解析期间发生：返回前重新检查grant epoch，丢弃旧结果。
- header不得跟随redirect；HTTP错误原文不可返回到用户或日志。
- 空分页仍有nextPageToken时不能当完成；相同token不得由上层无限循环。
- 401/403不能隐式换账户；429不在adapter内重试；410要求上层换generation，不能清空旧事件。
- getEvent对取消/404分别返回明确状态；404本身不伪造取消。
- 查询窗口与账户隔离由main创建；page token来自provider，长度有界；不作为任意URL。
- 当前尚未发现可复用vault/OAuth owner，禁止把Google refresh token写入现有明文connectors.json；真实连接需先准备OAuth客户端与受保护的credential owner。

未实现：Google Cloud客户端创建、授权登录/安全凭据owner、source settings/撤权传播、durable checkpoint+staging分页事务、现有晨报collector接入与真实provider验收。不得把adapter单测当这些层已通过。
