# Resume 含图历史到文本模型

## 证据与设计

用户恢复到 GLM-5.3 文本模型时，历史包含图片。OpenAIAdapter 已有准确的
supportsImageInput，但序列化用户消息时无条件输出 image_url，服务端返回
400 messages.content.type 仅允许 text。审批钩子修复不涉及此路径。

在 adapter 的实际请求边界按已解析能力投影：支持图片时保持 image_url；
不支持时使用明确的文本占位，说明当前模型不能读取该图、原图仍保存在历史中。
不改持久化会话、不删除图片、不改用户选定模型，也不修改能力注册表。
工具调用与 tool_result 配对保持；纯图片消息保留非空占位。

## 对抗性评审

- 请求能力取运行时完整解析结果，尊重明确 overrides，不能仅靠模型名称猜测。
- 视觉模型（含 GLM Flash 的 image_in）保持原图，恢复后再次切到视觉模型仍可见原图。
- 输入 messages 及图片 base64 必须逐字保持；不把 base64、路径、用户历史写入日志或公开 fixture。
- 文字和 orphan 工具结果保留；paired tool result 仍以 role:tool 发送，图片占位单独留在 user。
- 修复在通用 OpenAI-compatible adapter 边界，覆盖普通 chat、恢复和其它共用入口；
  不改变 Kimi 的 authorization/digest 和重试语义。
- 用真实本地 HTTP 接收最终 SDK 请求，禁止测试自己重写转换器。
- 实际安装定点更新一个 adapter 模块；保留既有源码 WIP，远端提交从最新 master 隔离构建。

## 验证

先用真实 SDK + 本地 HTTP 写红测试，再实现。覆盖文本/纯图片/混合工具回执、
未知模型、显式能力覆盖、文本与视觉之间切换和输入不变。运行现有 OpenAI adapter、
能力、provider 投影、审批回归；实际 CLI 恢复含图历史，纯文本服务端严格拒绝图片类型。

## 实测结果

- 真实 GLM-5.3 最小请求：纯文本 HTTP 200；附合成图片 HTTP 400/code 1210，匹配 content.type 错误。
- 新增 SDK/HTTP 回归在旧实现 6 失败、4 通过；修复后全部通过。
- 两项修复相关 10 个测试文件共 393 项通过，release 构建与治理检查通过。
- 独立真实 TTY 在构建入口与已安装 CLI 入口分别恢复真实会话副本：
  1,622 条原消息、8 条压缩记录、8 张原图保持，两个纯文本请求成功，下一轮与正常退出成功。
  原始用户会话文件逐字未改，测试进程残留 0。
- 合成含图会话 TTY 与审批超时 TTY 均通过；CI 增加对应真实 TTY 与 SDK 测试。
- 已安装 adapter 直连真实 GLM-5.3 的合成含图请求通过，最终 wire 类型仅 text。
  此探针限制输出为 8 tokens 并关闭 thinking，只验证请求兼容性，不代表发布业务验收。
