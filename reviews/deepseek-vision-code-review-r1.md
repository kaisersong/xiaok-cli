# DeepSeek Flash static code review

Reviewer: deepseek-flash; HTTP 200; finish stop; not executed tests.

审查结论：**BLOCK（P0）**。

**P0：custom provider 的元数据边界被 `resolveRetiredModelAlias` 绕过**

`resolveRetiredModelAlias` 只检查 `profile.id === 'deepseek'` 与 wireModel，不检查 `providerType`。但 `getProviderProfile` 按 id 查表、不区分 type（调用方注释已明示此风险）。因此一个 first-party 撞名可解析（id 以 deepseek 命名的 custom？实际是 providerId === 'deepseek' 的 custom），其 `findCatalogModel` 在 `providerConfig.type === 'first_party'` 分支才被调用，direct 调用方没问题。**但** `resolveProviderModelVariant` 在 `resolveRuntimeModelBinding` 等路径可能对 non-first-party 也执行；若某调用路径未先做 type 分支且对 custom 调用 `resolveProviderModelVariant`/`findCatalogModel`，则 custom provider 会拿到 `image_in` 与 1M context 的官方元数据，正是 P2 #4 所禁止的泄露。补丁新增测试只覆盖了“保存 Vision wire 的 custom”，但断言的正是 custom 得 `capabilities: []`——该测试通过是因为生产 gate 先过滤了 catalogModel；一旦调用 `resolveProviderModelVariant` 直接（如其它 first-party-only 之外路径）就会破坏边界。建议 `resolveRetiredModelAlias` 增加 `providerType` 参数，或强制仅在 first-party 解析路径调用，并补一条直接调用 `resolveProviderModelVariant` 于 custom provider 的回归。

**P1：`modelId` 与 `model` 混用导致 metadataCache / 匹配歧义**

`resolveRetiredModelAlias` 返回 `modelId: wireModel`，但该 wireModel 在历史配置里可能作为 `modelEntry.modelId` 出现（如 `findCatalogModel(profile, 'deepseek-legacy-vision', wireModel)`），而 `resolveProviderModelVariant` 的分支 `matches.length <= 1` 会在没有任何 catalog 匹配时兜底返回退役别名——这会让任意未命中 model 在 deepseek profile 下被解析为 Vision 变体，而不是“未命中”。`matches[0] ?? resolveRetiredModelAlias(...)` 在 `matches.length === 0` 时也触发，扩大了别名命中面（任何 deepseek 下未知 modelId 都会拿到 image_in）。应仅在 `matches.length === 0 && wireModel === 退役名` 时兜底，且匹配只看 wireModel，不看 modelId；否则 `matches.length<=1 && matches.length===0` 的泛化会污染 metadata 歧义判定。

**P2：测试未覆盖“未命中不应错配”**

新增测试只验证 Vision 名命中，未验证 `resolveVariant(profile, 'some-unknown-model')` 仍为 `undefined`。建议补一条负例，防止上述兜底扩散。

**兼容/命名**：Flash label 改为 `(1017)` 同时出现在 defaultModel 与 availableModels，测试同步，OK；但 `availableModels` 中仍保留 `deepseek-v4-flash`（label `DeepSeek V4 Flash`，无 image_in），与退役 Vision 同 wire 家族，需确认 UI 不会把旧 wire 的 image_in 透传给该展示条目——当前 gate 用 `catalogModel?.capabilities`，退役别名仅在 wireModel 精确匹配时返回，展示层无冲突，可接受。

**未执行声明**：未运行测试，结论基于 diff 静态审查。

END_REVIEW