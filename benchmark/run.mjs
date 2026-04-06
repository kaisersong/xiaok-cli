#!/usr/bin/env node
/**
 * A/B Benchmark: xiaok vs Claude Code
 *
 * Usage: node benchmark/run.mjs [--runs N] [--tasks task1,task2]
 *
 * Expects env vars: ANTHROPIC_API_KEY (or OPENAI_API_KEY)
 * xiaok must be built (dist/index.js).
 * Claude Code CLI (`claude`) must be on PATH.
 */

import { execSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");

// ── Config ──
const args = process.argv.slice(2);
let RUNS = 3;
let taskFilter = null;

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--runs" && args[i + 1]) RUNS = parseInt(args[++i], 10);
  if (args[i] === "--tasks" && args[i + 1]) taskFilter = args[++i].split(",");
}

// ── Task definitions ──
const TASKS = [
  // 自主性测试：简单任务，不应调用 AskUserQuestion
  {
    id: "aut-rename",
    name: "Autonomy: Rename function",
    category: "autonomy",
    prompt: "In this codebase, find a function named 'test' and rename it to 'testHelper'. Do not ask for confirmation.",
    expectNoAskUser: true,
    toolsExpected: ["grep", "edit"],
  },
  {
    id: "aut-type",
    name: "Autonomy: Add type annotation",
    category: "autonomy",
    prompt: "Find a function without return type annotation and add a suitable type. Do not ask what type to use.",
    expectNoAskUser: true,
    toolsExpected: ["grep", "read", "edit"],
  },
  {
    id: "aut-create",
    name: "Autonomy: Create utility file",
    category: "autonomy",
    prompt: "Create a simple logger utility file at src/utils/logger.ts with a basic log function. Do not ask where to put it.",
    expectNoAskUser: true,
    toolsExpected: ["write"],
  },

  // 调查优先测试：应先调查再询问
  {
    id: "inv-error",
    name: "Investigation: Error analysis",
    category: "investigation",
    prompt: "I'm getting a TypeScript error. Can you help me understand what's wrong?",
    expectNoAskUser: false, // 可能需要询问具体错误
    toolsExpected: ["read", "grep"],
  },
  {
    id: "inv-test-fail",
    name: "Investigation: Test failure",
    category: "investigation",
    prompt: "A test is failing in this project. Investigate and tell me why.",
    expectNoAskUser: false,
    toolsExpected: ["bash", "read", "grep"],
  },

  // 效率测试
  {
    id: "eff-simple-qa",
    name: "Efficiency: Simple Q&A",
    category: "efficiency",
    prompt: "What is the capital of Japan? Reply with just the city name.",
    expectNoAskUser: true,
    toolsExpected: [],
  },
  {
    id: "eff-math",
    name: "Efficiency: Math reasoning",
    category: "efficiency",
    prompt: "What is 17 * 23 + 42? Reply with just the number.",
    expectNoAskUser: true,
    toolsExpected: [],
  },
  {
    id: "eff-read",
    name: "Efficiency: Read file",
    category: "efficiency",
    prompt: "Read package.json and tell me the project name. Reply with just the name.",
    expectNoAskUser: true,
    toolsExpected: ["read"],
  },
  {
    id: "eff-search",
    name: "Efficiency: Search code",
    category: "efficiency",
    prompt: "Find all TypeScript files under src/ that contain 'export'. List just the file paths.",
    expectNoAskUser: true,
    toolsExpected: ["grep", "glob"],
  },
  {
    id: "eff-multi",
    name: "Efficiency: Multi-step",
    category: "efficiency",
    prompt: "Read tsconfig.json and package.json. What TypeScript target does this project use? Reply in one sentence.",
    expectNoAskUser: true,
    toolsExpected: ["read"],
  },

  // 复杂任务测试
  {
    id: "cmp-refactor",
    name: "Complex: Refactor module",
    category: "complex",
    prompt: "Find a TypeScript file with more than 50 lines and suggest 3 improvements. Do not ask for permission to read files.",
    expectNoAskUser: true,
    toolsExpected: ["glob", "read"],
  },
  {
    id: "cmp-feature",
    name: "Complex: Add feature",
    category: "complex",
    prompt: "Add a simple 'debounce' function to the utils. Implement it completely without asking for confirmation.",
    expectNoAskUser: true,
    toolsExpected: ["glob", "write", "edit"],
  },
];

const activeTasks = taskFilter
  ? TASKS.filter((t) => taskFilter.includes(t.id))
  : TASKS;

// ── Runners ──

function parseRun(out, elapsed) {
  try {
    const json = JSON.parse(out.toString().trim());
    return {
      ok: true,
      result: json.result || json.text || "",
      input_tokens: json.usage?.input_tokens ?? 0,
      output_tokens: json.usage?.output_tokens ?? 0,
      cache_creation: json.usage?.cache_creation_input_tokens ?? 0,
      cache_read: json.usage?.cache_read_input_tokens ?? 0,
      num_turns: json.num_turns ?? json.turns ?? 1,
      ask_user_calls: json.ask_user_calls ?? 0,
      tool_calls: json.tool_calls ?? [],
      duration_ms: json.duration_ms ?? Math.round(elapsed),
    };
  } catch {
    return {
      ok: false,
      error: "Failed to parse JSON output",
      result: out.toString().slice(0, 500),
      duration_ms: Math.round(elapsed),
    };
  }
}

function runXiaok(prompt) {
  const start = performance.now();
  try {
    // xiaok chat accepts input as positional argument, --json for JSON output
    const out = execSync(
      `node dist/index.js chat --json --auto "${prompt.replace(/"/g, '\\"')}"`,
      { cwd: projectRoot, timeout: 180_000, env: { ...process.env }, stdio: ["pipe", "pipe", "pipe"] },
    );
    return parseRun(out, performance.now() - start);
  } catch (err) {
    const stderr = err.stderr?.toString() || '';
    const stdout = err.stdout?.toString() || '';
    // Try to parse stdout anyway (might have valid JSON before error)
    if (stdout.includes('{')) {
      try {
        const jsonMatch = stdout.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          return parseRun(Buffer.from(jsonMatch[0]), performance.now() - start);
        }
      } catch {}
    }
    return {
      ok: false,
      error: stderr || err.message,
      result: stdout.slice(0, 500),
      duration_ms: Math.round(performance.now() - start),
    };
  }
}

function runClaude(prompt) {
  const start = performance.now();
  try {
    const out = execSync(
      `claude -p "${prompt.replace(/"/g, '\\"')}" --output-format json`,
      { cwd: projectRoot, timeout: 180_000, env: { ...process.env }, stdio: ["pipe", "pipe", "pipe"] },
    );
    return parseRun(out, performance.now() - start);
  } catch (err) {
    return {
      ok: false,
      error: err.stderr?.toString() || err.message,
      duration_ms: Math.round(performance.now() - start),
    };
  }
}

function shellQuote(s) {
  // Escape double quotes and backslashes for shell
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

// ── Stats ──

function median(arr) {
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function avg(arr) {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function sum(arr) {
  return arr.reduce((a, b) => a + b, 0);
}

// ── Main ──

console.log(`\n╔════════════════════════════════════════════════════╗`);
console.log(`║       A/B Benchmark: xiaok vs Claude Code          ║`);
console.log(`║       Agent Autonomy Evaluation                    ║`);
console.log(`╚════════════════════════════════════════════════════╝\n`);
console.log(`  Runs per task: ${RUNS}`);
console.log(`  Tasks: ${activeTasks.length}`);
console.log(`  CWD: ${projectRoot}\n`);

const results = [];

for (const task of activeTasks) {
  console.log(`── ${task.name} [${task.category}] ──`);
  console.log(`   Prompt: "${task.prompt.slice(0, 60)}${task.prompt.length > 60 ? "..." : ""}"`);

  const xiaokRuns = [];
  const ccRuns = [];

  for (let i = 0; i < RUNS; i++) {
    process.stdout.write(`   Run ${i + 1}/${RUNS}: xiaok...`);
    const xiaokResult = runXiaok(task.prompt);
    process.stdout.write(` ${xiaokResult.duration_ms}ms | CC...`);
    const ccResult = runClaude(task.prompt);
    console.log(` ${ccResult.duration_ms}ms`);

    xiaokRuns.push(xiaokResult);
    ccRuns.push(ccResult);
  }

  const xiaokOk = xiaokRuns.filter((r) => r.ok);
  const ccOk = ccRuns.filter((r) => r.ok);

  const buildStats = (runs) => ({
    success: runs.length,
    total: RUNS,
    duration_median_ms: runs.length ? Math.round(median(runs.map((r) => r.duration_ms))) : null,
    duration_avg_ms: runs.length ? Math.round(avg(runs.map((r) => r.duration_ms))) : null,
    input_tokens_avg: runs.length ? Math.round(avg(runs.map((r) => r.input_tokens))) : null,
    output_tokens_avg: runs.length ? Math.round(avg(runs.map((r) => r.output_tokens))) : null,
    cache_creation_total: runs.length ? sum(runs.map((r) => r.cache_creation)) : 0,
    cache_read_total: runs.length ? sum(runs.map((r) => r.cache_read)) : 0,
    num_turns_avg: runs.length ? +(avg(runs.map((r) => r.num_turns))).toFixed(1) : null,
    ask_user_calls_avg: runs.length ? +(avg(runs.map((r) => r.ask_user_calls ?? 0))).toFixed(1) : 0,
    sample_result: runs[0]?.result?.slice(0, 200) ?? "(failed)",
  });

  results.push({
    task: task.id,
    name: task.name,
    category: task.category,
    expectNoAskUser: task.expectNoAskUser,
    xiaok: buildStats(xiaokOk),
    claude: buildStats(ccOk),
  });

  console.log();
}

// ── Summary table ──
console.log(`\n${"═".repeat(140)}`);
console.log(`  SUMMARY - Agent Autonomy Evaluation`);
console.log(`${"═".repeat(140)}`);

const header = [
  "Task".padEnd(18),
  "│",
  "xiaok ms".padStart(9),
  "in tok".padStart(8),
  "out".padStart(6),
  "turns".padStart(6),
  "ask".padStart(5),
  "│",
  "CC ms".padStart(8),
  "in tok".padStart(8),
  "out".padStart(6),
  "turns".padStart(6),
  "ask".padStart(5),
  "│",
  "Δ ms".padStart(7),
  "Δ in".padStart(7),
  "Autonomy".padStart(9),
].join(" ");

console.log(header);
console.log("─".repeat(140));

for (const r of results) {
  const dMs = (r.xiaok.duration_median_ms ?? 0) - (r.claude.duration_median_ms ?? 0);
  const dIn = (r.xiaok.input_tokens_avg ?? 0) - (r.claude.input_tokens_avg ?? 0);

  // 自主性评分：基于 AskUserQuestion 调用
  const xiaokAsk = r.xiaok.ask_user_calls_avg ?? 0;
  const autonomyScore = r.expectNoAskUser
    ? (xiaokAsk === 0 ? "✅ PASS" : xiaokAsk === 1 ? "⚠️ 1 ask" : `❌ ${xiaokAsk} asks`)
    : (xiaokAsk <= 1 ? "✅ OK" : `⚠️ ${xiaokAsk} asks`);

  const sign = (n) => (n > 0 ? `+${n}` : `${n}`);

  const row = [
    r.task.padEnd(18),
    "│",
    `${r.xiaok.duration_median_ms ?? "—"}`.padStart(9),
    `${r.xiaok.input_tokens_avg ?? "—"}`.padStart(8),
    `${r.xiaok.output_tokens_avg ?? "—"}`.padStart(6),
    `${r.xiaok.num_turns_avg ?? "—"}`.padStart(6),
    `${r.xiaok.ask_user_calls_avg ?? 0}`.padStart(5),
    "│",
    `${r.claude.duration_median_ms ?? "—"}`.padStart(8),
    `${r.claude.input_tokens_avg ?? "—"}`.padStart(8),
    `${r.claude.output_tokens_avg ?? "—"}`.padStart(6),
    `${r.claude.num_turns_avg ?? "—"}`.padStart(6),
    `${r.claude.ask_user_calls_avg ?? 0}`.padStart(5),
    "│",
    sign(dMs).padStart(7),
    sign(dIn).padStart(7),
    autonomyScore.padStart(9),
  ].join(" ");

  console.log(row);
}

// ── Category summary ──
console.log(`\n${"─".repeat(140)}`);
console.log(`  BY CATEGORY:`);

const categories = [...new Set(results.map((r) => r.category))];
for (const cat of categories) {
  const catResults = results.filter((r) => r.category === cat);
  const avgAskUser = avg(catResults.map((r) => r.xiaok.ask_user_calls_avg ?? 0));

  console.log(`  ${cat.padEnd(15)}: avg AskUser calls = ${avgAskUser.toFixed(2)}`);
}

// ── Autonomy score ──
const autonomyTests = results.filter((r) => r.expectNoAskUser);
const autonomyPassed = autonomyTests.filter((r) => (r.xiaok.ask_user_calls_avg ?? 0) === 0).length;
const autonomyScore = autonomyTests.length > 0 ? (autonomyPassed / autonomyTests.length * 100).toFixed(0) : "N/A";

console.log(`\n  AUTONOMY SCORE: ${autonomyScore}% (${autonomyPassed}/${autonomyTests.length} tasks with 0 asks)`);
console.log(`  Target: ≥80%`);

// ── Sample results ──
console.log(`\n  Sample outputs:`);
for (const r of results.slice(0, 5)) {
  console.log(`    ${r.task}:`);
  console.log(`      xiaok: ${r.xiaok.sample_result?.slice(0, 100)}`);
  console.log(`      CC:    ${r.claude.sample_result?.slice(0, 100)}`);
}

// ── JSON dump ──
const benchmarkDir = resolve(projectRoot, "benchmark");
if (!existsSync(benchmarkDir)) mkdirSync(benchmarkDir, { recursive: true });

const jsonPath = resolve(benchmarkDir, "results.json");
writeFileSync(jsonPath, JSON.stringify(results, null, 2));
console.log(`\n  Full results saved to: ${jsonPath}\n`);