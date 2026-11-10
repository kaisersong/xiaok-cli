# 预提交检查

当前 `pre-commit` 保留仓库的生产检查顺序：先运行 `scripts/check-external-docs.mjs`，再运行 `scripts/check-file-token-budget.mjs`。后者检查暂存文件完整内容，以 UTF-8 字节数 / 4 估算令牌，每个手写文件上限 20,000 字节；当前规则使用 `.token-budget-ignore`，不会读取历史工具的 JSON allowlist。

首次 checkout 后按项目要求启用本地 hook：

```sh
git config --local core.hooksPath .githooks
```

历史分支的独立工具 `scripts/check-staged-file-tokens.mjs` 及其回归保留，供明确比较旧规则时运行。该工具使用暂存的 `scripts/file-token-allowlist.json`，识别生成声明与 `linguist-generated` 属性，规则与当前生产 hook 不完全相同。运行旧工具通过不能替代当前 hook；更改其 allowlist 也不会改变当前 hook 的门槛。

```sh
node scripts/check-file-token-budget.mjs
node scripts/check-staged-file-tokens.mjs
node --test tests/governance/file-token-limit.test.mjs
```

遇到大文件先按职责拆分、更新引用、运行相关测试并精确暂存；不通过旧规则或工作区未暂存的变更绕过当前检查。
