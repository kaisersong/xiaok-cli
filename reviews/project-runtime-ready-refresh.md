# 项目列表在后台就绪后恢复

真实安装包证据：KSwarm GET /projects 返回 14 项；旧共享 DTO 因 7 项字符串 riskProfile 拒绝整个列表，PR #85 已有兼容修复。纳入 PR #85 后首帧恢复，但 attachConversationActivityOwner 仍等待 multiAgentReady；这段时间 kswarmGetStatus.running=false、proxy GET 返回 null，最初四次快照重试耗尽。useKSwarmClient 仅监听 WebSocket 连通事件，未监听服务真正就绪，ProjectsPage 又把尚未成功读取的 [] 渲染为“还没有项目”。

设计：复用既有 onKSwarmStatus 通知；在经过现有 schema 校验的 running false→true（含首次 true）时重新加载同一快照，重置有限重试。重复 true 不重复刷新，卸载取消订阅。快照请求增加读取代次，旧 held 回执不得覆盖服务就绪后发起的新读取。项目页在 projectsLoaded=false 且无已有项目时显示既有 loading 文案，成功取得空列表后才显示空态。保留已有项目与现有失败保留语义。

对抗性自审：不使用端口健康代替已认证服务就绪，不绕过 owner/授权/恢复准入；不另设轮询或复制 durable state；不让旧请求覆盖新的成功快照；事件异常/重复/卸载不触发刷新；后台项目恢复慢与真正空列表分开呈现。

回归：等待超过全部初始重试后发出服务就绪事件，项目自动恢复；重复就绪无重复调用；卸载清理；held 旧快照不覆盖新数据；未加载与成功空列表各有真实页面测试。安装验收必须看到 14 个项目及真实项目详情，并重新读取全部 14 个协作空间。
