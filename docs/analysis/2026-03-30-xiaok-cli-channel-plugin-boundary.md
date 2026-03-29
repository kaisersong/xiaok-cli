# xiaok-cli Channel Plugin Boundary

## 结论

`plugin` 应该位于 `channel/mobile ops` 能力栈的最外层，只负责安装、注册、配置和分发，不应该反向承载 runtime 基础设施。

## Plugin 负责

- 安装和启停具体 channel adapter
- 分发 channel 相关配置，例如 token、webhook secret、bot id
- 注册 channel-specific hooks 或扩展行为
- 在未来 marketplace 中暴露可插拔入口

## Plugin 不负责

- 基础 runtime hooks / event bus
- `session-store`
- `approval-store`
- runtime notification 总线
- agent 生命周期事件发射

## 为什么这样分层

- `hooks/events` 会被 channel、日志、审计、通知、web UI 共同复用，属于 runtime 基础层
- `session` 和 `approval` 是跨 channel 的共享状态，不应该散落到每个 plugin
- 如果让 plugin 反向定义基础 runtime 能力，后续新增 Slack/Telegram/Discord 之外的入口时会重复实现
- plugin 只做边界扩展，能保证首版 channel 能力先稳定，再逐步开放扩展面

## 当前建议

先固化：

- `src/runtime/*`
- `src/channels/session-store.ts`
- `src/channels/approval-store.ts`
- `src/channels/notifier.ts`
- `src/channels/webhook.ts`
- `src/channels/{slack,telegram,discord}.ts`

之后再考虑把 adapter 的注册与配置读取包装为 plugin。
