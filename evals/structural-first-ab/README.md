# Structural-first reading A/B harness (Phase 0)

验证「结构化首读」行为（动作 A: prompt recipe；动作 B: lsp documentSymbol 无 server 降级）
能否带来 ≥5% token 节省，作为设计文档
`docs/design/2026-06-24-code-outline-tool-design-v2.md` §3.3 决策门的证据。

## 运行

```bash
npm run build
node evals/structural-first-ab/run-ab.mjs            # 用默认 scenarios.json
node evals/structural-first-ab/run-ab.mjs my.json    # 自定义场景
```

前置：需要可用模型 provider/API key（真实调用产生费用）。

## 两臂

- baseline：`XIAOK_NO_STRUCTURAL_FIRST=1`，关闭结构化首读 recipe（仍可用 grep/glob/read/lsp 原样）。
- treatment：默认，开启 recipe + lsp documentSymbol 正则降级。

harness 自动设置该环境变量，无需手动切换。

## 指标与决策门

- 自动测量（从 `--json` 输出解析）：token 总量、回合数、tool 调用数、耗时，按中位聚合。
- **人工核对**：答案 coverage / precision（baseline-relative）。决策门要求 token 节省 ≥5% **且 coverage 不降**——禁止「快但错」。
- 门结果：
  - 中/大仓 ≥5% 且 coverage 不降 → Phase 0 即收益主体，默认不进 Phase 1。
  - 仍有明显残余缺口且潜在收益 ≥5% → 立项 Phase 1（AST 工具）。
  - 中/大仓 <5% → 方向证伪，归档。

## 场景

编辑 `scenarios.json`。`external-large-PLACEHOLDER` 需替换为真实 >3000 文件仓库的绝对路径并把 `skip` 改为 `false`（建议 clone 一个 OSS 大仓），以检验文章「小仓负优化、大仓正收益」是否在 xiaok 真实规模成立。

## 注意

- 该 harness 是脚本而非框架（保持极简，避免「为测 5% 造一个比 recipe 还贵的测量工程」）。
- 动作 B（lsp 降级）仅 CLI 生效；动作 A（recipe）CLI + desktop 两端生效。harness 走 CLI，可同时观测两者。
