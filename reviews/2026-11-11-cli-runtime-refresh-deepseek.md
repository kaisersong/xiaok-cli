# 独立模型复审

模型：DeepSeek deepseek-v4-pro。编码模型：Codex GPT-6。

评审实现。

## 结论：未发现本轮引入的阻塞缺陷

先前所报 blocker 不成立。`acceptedIdentity=transportIdentity(fresh)` 在成功解析后执行，成功路径上 `fresh` 未被重读或变更；失败路径不落到该赋值，因此不会接受被篡改的快照。

## 关键点核实

**1. `resolve([])` 顺序确认**

源码中 `resolve` 的第一条语句是 `current()`，在 `paths` 检查之前无条件执行：

```ts
resolve:(path:string[]):unknown=>{
  current();
  if(!paths.some(p=>JSON.stringify(p)===JSON.stringify(path)))return undefined;
  ...
```

`current()` 在 `resolveTransport` 中执行 `fresh.resolve([])` 时检查 `config.json` 与 `.bak` 的 digest，成功后才有后续逻辑。上一个设计审的 B3 判定（解密结果在 `current()` 成功后才 return）与源码一致。

**2. 环境变量跳过存储键解析时的端点校验**

`transportIdentity` 对 `fresh` 计算包含完整 `provider` entry（含 `baseUrl`），`resolveTransport` 在解密前执行 `isDeepStrictEqual(acceptedIdentity, transportIdentity(fresh))`。env 键存在时 `hasEnvironmentKey=true`，存储 API key 不被解密，但 provider 的 `baseUrl` 属于 identity，被捕获并校验。测试 `keeps endpoint checks even when an environment key bypasses stored key resolution` 覆盖了该路径。无缺口。

**3. `acceptedIdentity` 更新时机**

```ts
fresh.resolve([]);
const binding=resolveRuntimeModelBinding(resolved);
acceptedIdentity=transportIdentity(fresh);  // ← 成功路径末尾
return {apiKey:binding.apiKey,headers:binding.headers};
```

`fresh.resolve([])` 内部锁内可能做明文迁移并更新自身 `raw`/digest，随后 `transportIdentity(fresh)` 使用迁移后的 `fresh.raw` 计算。此时 `acceptedIdentity` 基于迁移后状态，下一次 `resolveTransport` 的 `store.readPublic()` 读到迁移后的文件，identity 一致。迁移期间的竞争由 `fresh.resolve` 的 `current()` 和 `lock` 内的 `current()` 拒绝；不存在接受的 snapshot 与实际发送的 transport 不一致。新增测试 `continues through its own legacy plaintext migration on consecutive requests` 覆盖连续两次 resolve。

**4. `selectModel` 保留旧 CAS**

`selectModel` 传 `snapshot.digest`，不更新 `snapshot`。旧 models 覆盖新增数据时，`updateModelSelection` 的 lock 内 digest 检查抛出 `credential_config_changed`，测试 `continues ... expect(()=>runtime.selectModel(...)).toThrow` 覆盖。这是刻意的旧快照边界，不构成本轮阻塞。

**5. `credentialVersion` 无敏感解引用**

```ts
credentialVersion:(path:string[]):string=>{
  const ref=this.refs(raw??{}).find(r=>JSON.stringify(r.path)===JSON.stringify(path));
  return hash(JSON.stringify(ref??{path,value:getAt(raw,path)??null}));
}
```

当 `ref` 存在时只散列 `r.path` 与 `r.ref`（UUID），不触碰后端；当 `ref` 不存在时散列明文。此摘要只是 identity 内容的一部分，identity 中还包含完整 `provider`/`model`；没有解引用所有凭据。lazy/keychain locked 边界保持：`transportIdentity` 不调用 `reveal`，仅对已有 `ref` 结构做哈希。

## 建议（可选，非阻塞）

`transportIdentity` 中 `provider: current.providers[binding.providerId]` 与 `model: current.models[binding.modelId]` 是 `fresh.value` 的规范化对象。若 provider entry 或 model entry 中出现非 JSON-serializable 值（如 `undefined` 属性、函数），`isDeepStrictEqual` 比较正常，但 `hash` 不参与，语义上仍可靠。无进一步行动。

## 验证

- 新增测试覆盖：无关配置/凭据添加后继续、所选 transport 的 revoke/replace/header/model/selection 变化拒绝且无 fetch、env 键时 endpoint 变化拒绝、解析期间版本变更拒绝、连续两次明文迁移 resolve 通过。
- 与设计文档边界一致：备份变化由新 snapshot 自验证；不自动换 endpoint；禁止无界重试由 digest 检查保证。

**最终结论：本轮实现无阻塞缺陷，先前所报 blocker 不成立。**