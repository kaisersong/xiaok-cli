# Independent code review

Reviewer: glm-5.3-flash; HTTP 200; finish stop.

## 代码评审

### P0 主张：getProviderProfile 按 id 查表会让 custom 升级继承官方元数据

从 control-plane.ts 实际运行时路径证实反驳：

- `findCatalogModel` 调用被 `providerConfig.type === 'first_party'` 精确 gate，custom 直接拿到 `undefined`；
- capabilities 三级回退中，`catalogModel?.capabilities` 之后的 `profile.defaultModel.capabilities` 兜底同样被 `providerConfig.type === 'first_party'` gate，custom 按保守空集 `[]`；
- `catalogRuntimeModel` 的 kimi 特判链只在 `catalogModel` 非空时才有内容，custom 下为 `undefined`；
- 新增负例测试（`preserves saved Vision wire with ... custom provider boundaries`）以 `providerType: 'custom'` + `deepseek` 撞名 id + 官方 baseUrl 换成 `example.com` 断言 `capabilities: []`、`contextLimit: undefined`，并做 config 不可变性检查。

openai.ts 的 `cloneWithModel` 路径同样以 `currentIdentity.providerType === 'first_party'` gate 后才查 profile。静态评审只看了 `getProviderProfile` 单函数签名，没有追到生产调用方，P0 **反驳成立**。

### P1 主张：任意 unknown wire 都继承退役 Vision 元数据

反驳，helper 是精确双条件匹配：

```ts
if (profile.id !== 'deepseek' || wireModel !== 'deepseek-v4-flash-vision-exp') return undefined;
```

- profile 必须是 deepseek，wire 必须逐字等于 `deepseek-v4-flash-vision-exp`；
- `resolveVariant(profile!, 'deepseek-unknown')` 与 `findCatalogModel(profile, 'deepseek-unknown', 'deepseek-unknown')` 两个 unknown-wire 负例断言 `undefined`，测试已覆盖；
- 回退只在 `matches[0] ?? alias`（resolveProviderModelVariant）和 `byWire.length === 0`（findCatalogModel）两个「确实未命中」的分支触发，不会覆盖真实 catalog 条目或双键 exact 命中。

P1 **反驳成立**。

### 设计正确性检查

1. **alias 语义合理**：退役 Vision 模型由 Flash-1017 服务（官方 pricing 脚注），继承 defaultModel（含 `image_in`、1M 上下文）而非虚构条目，且 `modelId`/`model` 钉死为 wire 名——`findCatalogModel(profile, 'deepseek-legacy-vision', wire)` 也能命中，存量非标准 modelId 配置被 alias 兜住。
2. **安全边界没有扩大**：alias 是**收紧**而非放宽——旧 availableModels 条目已从 catalog 移除（不再引导选择），查询兼容收窄到单个精确 wire 名；`official context windows` 快照同步删除 Vision 条目，保持一致性。findCatalogModel 的 byWire 回退是既有设计，本次未改动其匹配范围。
3. **一致性**：`resolveProviderModelVariant`（可抛错）与 `findCatalogModel`（永不抛错）对 alias 的接入方式一致；control-plane 注释明确标注调用方必须自行 gate first_party，且代码确实这么做了。
4. **次要观察**（非阻塞）：`findCatalogModel` / `resolveProviderModelVariant` 是公开导出，alias 本身不带 providerType 检查，依赖调用方 gate。当前所有可见生产调用方（control-plane、cloneWithModel）均已 gate；normalize.ts 的 `getProviderModelVariant` 路径用于官方 provider 配置初始化，custom 撞名配置不走该入口。建议后续在文档/类型上约束，不构成本次阻塞。

### 结论

两项 P0/P1 静态主张均被生产调用方代码证实反驳；新增的 unknown-wire 负例与 custom 生产入口测试覆盖到位，未虚构执行。补丁收敛了 Vision 退役模型暴露面，同时保持存量配置兼容。

**APPROVE**

END_REVIEW
