# 云之家开放平台 API 概览

## 认证方式
云之家 Open API 使用 OAuth 2.0 授权码模式。请求需在 Header 中携带：
`Authorization: Bearer <access_token>`

## 主要 API 模块

### 消息 API
- POST /v1/message/send — 发送文本/卡片消息给指定用户或群组
- 参数：toUser（用户 ID）、toGroup（群组 ID）、content（消息内容）

### 组织架构 API
- GET /v1/org/users — 获取企业用户列表
- GET /v1/org/departments — 获取部门列表
- GET /v1/org/user/{userId} — 获取指定用户信息

### 应用管理 API
- GET /v1/apps — 获取企业已安装的应用列表
- POST /v1/apps/{appId}/message — 通过应用发送消息

### Webhook 事件
云之家支持通过 Webhook 接收企业事件（消息、审批、考勤等）。
配置 Webhook URL 后，云之家将以 POST 请求推送事件到指定地址。

### 工作流 API
- POST /v1/workflow/trigger — 触发指定工作流
- GET /v1/workflow/{instanceId}/status — 查询工作流实例状态

## SDK 支持
官方提供 Java、Python、Node.js、PHP SDK。
Node.js SDK：`npm install @yunzhijia/sdk`

## 错误码
- 401：token 过期或无效，请重新获取
- 403：无权限
- 429：请求频率超限，建议指数退避重试
