# CLI / Desktop 模型推理强度选择

## 现状与目标

- CLI `/models` 仅返回模型 ID；`chat.ts` 保存默认模型并重建 adapter。Desktop 聊天区使用 `ChatModelPicker`，仅调用 `saveModelConfig`。
- 配置已有 `runtimeOptions.reasoningEffort`，模型目录先前仅为官方 Kimi K3 与 GLM 5.3 系列声明 `low/high/max`；Desktop 快照已有 `runtimeConstraints`，`updateModelRuntimeOptions` 却只允许 Kimi K3；OpenAI-compatible adapter 只给官方 Kimi K3 发送 `reasoning_effort`。
- 官方模型页确认仓库现有 GPT-5.5 支持 `none/low/medium/high/xhigh`，GPT-5 支持 `minimal/low/medium/high`；两者可用 Chat Completions。来源：https://developers.openai.com/api/docs/models/gpt-5.5 与 https://developers.openai.com/api/docs/models/gpt-5 。
- 目标：两个入口都能选择目录确认支持的强度，持久化到所选模型的 runtime options，并在下一次模型请求中生效。未声明强度约束的模型不显示档位，也不新增强度参数。

## 设计

1. CLI 选择器对配置项及目录项按现有模型目录与端点规则解析约束。`←/→` 仅在有 `reasoningEfforts` 的选中模型上切换档位，Enter 一次确认模型与档位，Esc 取消；默认档位来自已配置值或目录默认值。`chat.ts` 对已有或新模型均保存选中的强度，保留其他 runtime options，重建 adapter。
2. Desktop 聊天模型菜单在支持强度的模型行展示当前档位；选中模型后在菜单中显示可选档位。强度改变通过现有 `updateModelRuntimeOptions` IPC 保存，保留 contextLimit。后端仅允许目录确认支持强度的 first-party 模型及已校验档位，不放开任意 custom endpoint。模型切换与强度保存各自完成后才更新本地快照；失败重载配置。
3. 扩展强度枚举和目录元数据，覆盖现有 GPT-5.5、GPT-5 的官方档位；OpenAI-compatible 请求仅对目录确认的 first-party 模型增加 `reasoning_effort`，保留 Kimi K3 的官方端点 gate。其他模型请求不变。

## 验证

- CLI 真实 TTY 选择器：箭头改变强度、Esc 不变更、无约束模型不显示档位；`chat.ts` 切换后持久化。
- Desktop renderer：聊天区选择模型和强度、重新打开显示保存值；main service：合法 GLM/Kimi 更新及不支持模型拒绝；adapter：实际 request payload 含所选 `reasoning_effort`。
- 对应 focused tests、CLI build、Desktop main/renderer build。

## 对抗性评审

- **端点冒名**：custom provider 即使同名同 wire model 也不能借目录启用强度；使用 `findApplicableCatalogModel` / first-party gate，测试覆盖。
- **错误档位与部分写入**：后端重新解析约束，不信任 renderer；选择模型与强度是两个现有 API 操作，前一步成功后才能提供强度选项，后一步失败时重载事实状态，不显示未保存的值。
- **原参数丢失**：更新强度须保留 contextLimit；CLI 已配置模型也须合并 runtime options，不能只处理首次注册。
- **协议漂移**：只有真正会向服务端传递该字段的目录条目可显示档位；不将 `thinking` capability 当作支持强度的依据。OpenAI 按具体模型的官方档位配置，不能给 GPT-5.5 显示 Kimi 的 `max`，也不能给 GPT-5 显示 GPT-5.5 的 `xhigh`。
- **取消与 TUI 覆盖**：Esc 不返回选择；选择器 overlay 保持原高度/清理路径，左右键只重绘当前 overlay，不擦输入。

评审结论：按以上约束可实现；先以生产入口测试锁定 CLI、Desktop 服务与请求边界，再修改代码。
