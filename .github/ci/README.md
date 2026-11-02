# Actions 性能与覆盖约定

- PR 按 workflow + PR number 取消旧运行；非 PR 按 run_id 隔离，避免默认分支 pending 被替换。
- `master` push 不做文档快速跳过，原有测试平台和 Node 最低版本保留；tag release 不用于性能试跑。
- 文档 PR 只允许根 README/CHANGELOG 与 docs Markdown 白名单。路径未知、空 diff、重命名涉及源码、取 diff 失败均不能快速放行。三个 required governance 名称稳定，分类失败会让它们明确失败。
- setup-node 缓存 npm 下载，不缓存 node_modules；命中仍执行 npm ci。双 package 的 job 使用两把锁。避免在接近默认缓存额度时引入大型构建输出缓存。
- Terminal 原其它25文件和 Linux真实TTY在 shard1；原交互单文件在每个原OS/Node组合分3片。Registration 原9个阻断 whole 在shard1，原22 runnable + 1自然skip在同一原OS/Node组合分3片。条件skip不是PASS。
- 分片通过 Vitest public collect API读取结构化父名称及mode，拒绝重复/歧义身份；runnable hash排序后轮转均分。原参数、pool/setup/preload、测试和hook timeout保留，不改SOLPI_INTENT_POPULATION。
- 收集与覆盖审计始终阻断；只有原Intent测试失败保留非阻断。正常终止receipt、完整JSON和跨片汇总必须全部存在。pending、异常signal、缺片、错SHA、不同inventory、自然skip变执行都失败。
- Terminal保留原PR merge commit测试；Registration保留原PR head测试。汇总核对各自真正被测试的SHA。

验证命令：

```sh
node --test .github/ci/*.test.mjs
npm run test:governance
npm run governance:check
```

另用官方预编译 actionlint 校验 workflow；不为lint现场go install。完整性能报告、50次基线原始数据及每轮运行记录作为本任务交付，不能用已取消的运行证明变快，也不能把测试阶段收益说成完整CI收益。

与并行PR边界：本次仅同步PR #130的macos-14→15 YAML迁移，不带其harness产品修复；不引入PR #131的pool变更。两PR合入次序需由维护者协调，本任务不代合并。
