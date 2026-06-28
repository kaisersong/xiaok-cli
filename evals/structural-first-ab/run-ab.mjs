#!/usr/bin/env node
/**
 * Phase 0 结构化首读 A/B harness（极简脚本，非框架）。
 *
 * 目的：用真实 headless 运行测量「结构化首读」行为（动作 A + 动作 B）在
 * baseline 与 treatment 两臂下的 token / 回合 / 耗时差异，作为设计文档
 * docs/design/2026-06-24-code-outline-tool-design-v2.md §3.3 决策门的证据。
 *
 * 两臂：
 *   - baseline：XIAOK_NO_STRUCTURAL_FIRST=1（关闭 recipe），仍可用 grep/glob/read/lsp 原样。
 *   - treatment：默认（开启 recipe + lsp documentSymbol 降级）。
 *
 * 用法：
 *   node evals/structural-first-ab/run-ab.mjs [scenarios.json]
 *
 * 前置：需要可用的模型 provider/API key（真实调用会产生费用）。先 `npm run build`。
 *
 * 注意（coverage/precision）：本脚本只自动测 token/回合/耗时。答案正确性
 * （coverage / precision，baseline-relative）需人工抽样核对两臂输出文本，
 * 禁止「快但错」。决策门要求 token 节省 ≥5% 且 coverage 不降。
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, isAbsolute } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');
const cliEntry = resolve(repoRoot, 'dist', 'index.js');

const scenariosPath = process.argv[2]
  ? resolve(process.cwd(), process.argv[2])
  : resolve(here, 'scenarios.json');

const config = JSON.parse(readFileSync(scenariosPath, 'utf-8'));
const repeats = Number(config.repeats ?? 2);

function median(nums) {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function runOnce({ repoAbs, prompt, baseline }) {
  const env = { ...process.env };
  if (baseline) env.XIAOK_NO_STRUCTURAL_FIRST = '1';
  else delete env.XIAOK_NO_STRUCTURAL_FIRST;

  const started = Date.now();
  const res = spawnSync('node', [cliEntry, '--json', '--auto', prompt], {
    cwd: repoAbs,
    env,
    encoding: 'utf-8',
    maxBuffer: 64 * 1024 * 1024,
  });
  const wall = Date.now() - started;

  if (res.status !== 0 || !res.stdout) {
    return { ok: false, error: (res.stderr || '').slice(0, 500), wall };
  }
  // --json 可能在 stdout 里混有少量前置输出，取最后一个 JSON 对象。
  const text = res.stdout.trim();
  const start = text.lastIndexOf('\n{');
  const jsonStr = start >= 0 ? text.slice(start + 1) : text;
  let parsed;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    return { ok: false, error: 'JSON 解析失败', wall };
  }
  const usage = parsed.usage ?? {};
  const totalTokens = (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0)
    + (usage.cacheCreationInputTokens ?? 0) + (usage.cacheReadInputTokens ?? 0);
  return {
    ok: true,
    totalTokens,
    inputTokens: usage.inputTokens ?? 0,
    outputTokens: usage.outputTokens ?? 0,
    numTurns: parsed.num_turns ?? 0,
    toolCalls: Array.isArray(parsed.tool_calls) ? parsed.tool_calls.length : 0,
    durationMs: parsed.duration_ms ?? wall,
    wall,
  };
}

function arm({ repoAbs, prompt, baseline }) {
  const runs = [];
  for (let i = 0; i < repeats; i += 1) {
    const r = runOnce({ repoAbs, prompt, baseline });
    if (r.ok) runs.push(r);
    else process.stderr.write(`  [${baseline ? 'baseline' : 'treatment'}] run ${i + 1} 失败: ${r.error}\n`);
  }
  return {
    tokens: median(runs.map((r) => r.totalTokens)),
    turns: median(runs.map((r) => r.numTurns)),
    toolCalls: median(runs.map((r) => r.toolCalls)),
    durationMs: median(runs.map((r) => r.durationMs)),
    n: runs.length,
  };
}

function pct(base, treat) {
  if (!base) return 'n/a';
  const delta = ((base - treat) / base) * 100;
  return `${delta >= 0 ? '-' : '+'}${Math.abs(delta).toFixed(0)}%`;
}

const rows = [];
for (const sc of config.scenarios) {
  if (sc.skip) {
    process.stderr.write(`跳过 ${sc.id}（skip=true）\n`);
    continue;
  }
  const repoAbs = isAbsolute(sc.repo) ? sc.repo : resolve(repoRoot, sc.repo);
  process.stderr.write(`运行 ${sc.id} (${sc.size}) @ ${repoAbs}\n`);
  const base = arm({ repoAbs, prompt: sc.prompt, baseline: true });
  const treat = arm({ repoAbs, prompt: sc.prompt, baseline: false });
  rows.push({ id: sc.id, size: sc.size, base, treat });
}

// 结果表
console.log('\n=== Structural-first A/B（中位值，baseline → treatment）===');
console.log('scenario | size | tokens(base→treat / Δ) | turns | toolCalls | time(ms)');
for (const r of rows) {
  console.log(
    `${r.id} | ${r.size} | ${r.base.tokens}→${r.treat.tokens} (${pct(r.base.tokens, r.treat.tokens)}) | `
    + `${r.base.turns}→${r.treat.turns} | ${r.base.toolCalls}→${r.treat.toolCalls} | `
    + `${r.base.durationMs}→${r.treat.durationMs}`,
  );
}
console.log('\n决策门（§3.3）：中/大仓 token 节省 ≥5% 且 coverage 不降（coverage 需人工核对两臂答案）。');
console.log('若中/大仓 <5% → 整个方向证伪，归档，不进 Phase 1。');
