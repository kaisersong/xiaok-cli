# 预提交检查

首次 checkout 后启用：

```sh
git config --local core.hooksPath .githooks
```

`pre-commit` 先运行 `scripts/check-staged-file-tokens.mjs`，再运行原有的外部文档检查。大小检查只读取本次新增、修改、重命名或类型变化的**暂存文件完整内容**，不读取工作区版本，也不检查未暂存、未跟踪、未变化或已删除的文件。

每个手写文件最多 5,000 tokens，以 UTF-8 字节数 / 4 估算，即最多 **20,000 字节**。恰好 20,000 字节允许提交，20,001 字节即超限。错误会列出文件、字节数、估算 tokens，并说明如何按职责拆分、更新引用、运行测试和重新暂存。

自动跳过锁文件、二进制文件、符号链接、子模块，以及 `dist/`、`.generated/`、`node_modules/` 中的文件、常见生成文件后缀（如 `.generated.ts`、`.pb.go`）、暂存 `.gitattributes` 的 `linguist-generated` 标记、文件头注释中的标准生成声明（如 `// @generated`、`Code generated … DO NOT EDIT`）和已知生成的治理 baseline、build-info、CUA runtime。路径规则集中在检查器的 `isGeneratedPath`，不会按提交者身份判断，也不会将所有名为 `generated/` 的目录自动豁免。

`scripts/file-token-allowlist.json` 按精确路径列出此规则引入时已经超过上限的历史文本文件。这些文件暂时允许继续修改；拆分到限制内后可从白名单移除。白名单也从暂存区读取，未暂存的白名单修改不会影响检查。新增手写文件应拆分，白名单不会自动扩展；重命名后的新路径也会检查。

手动检查与回归测试：

```sh
node scripts/check-staged-file-tokens.mjs
node --test tests/governance/file-token-limit.test.mjs
```
