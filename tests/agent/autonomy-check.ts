/**
 * Agent Autonomy Prompt Check - CLI 闭环验证
 *
 * 运行方式: npx tsx tests/agent/autonomy-check.ts
 *
 * 这个测试验证主动性改进的 prompt 指令是否正确注入。
 */

import { PromptBuilder } from '../../dist/ai/prompts/builder.js';

async function main() {
  console.log('Running Agent Autonomy Prompt Check...\n');

  const promptBuilder = new PromptBuilder();
  const snapshot = await promptBuilder.build({
    cwd: process.cwd(),
    channel: 'chat',
  });

  const promptText = snapshot.rendered;

  console.log('=== Prompt 检查结果 ===\n');

  const checks = [
    // Phase 4 新增（本次修复）
    { name: 'Immediate execution', pattern: 'Immediate execution', phase: 4, critical: true },
    { name: 'just do it', pattern: 'Do not restate what the user said — just do it', phase: 4, critical: true },
    { name: 'Go straight to the point', pattern: 'Go straight to the point', phase: 4, critical: true },
    { name: 'Skip filler preamble', pattern: 'Skip filler words, preamble', phase: 4, critical: true },

    // Phase 3（Action bias）
    { name: 'Action bias', pattern: 'Action bias', phase: 3, critical: true },
    { name: 'Momentum', pattern: 'Momentum', phase: 3, critical: true },

    // Phase 1-2（基础自主性）
    { name: 'Highly capable', pattern: 'You are highly capable', phase: 1, critical: false },
    { name: 'Genuinely stuck', pattern: 'genuinely stuck', phase: 2, critical: false },
    { name: 'Denied tool call handling', pattern: 'If you do not understand why the user has denied a tool call', phase: 2, critical: false },
  ];

  const resultsByPhase: Record<number, { pass: number; fail: number; criticalFail: number }> = {};

  for (const check of checks) {
    const pass = promptText.includes(check.pattern);
    const status = pass ? '✅ PASS' : (check.critical ? '❌ FAIL (CRITICAL)' : '⚠️ FAIL');

    if (!resultsByPhase[check.phase]) {
      resultsByPhase[check.phase] = { pass: 0, fail: 0, criticalFail: 0 };
    }
    if (pass) {
      resultsByPhase[check.phase].pass++;
    } else {
      resultsByPhase[check.phase].fail++;
      if (check.critical) {
        resultsByPhase[check.phase].criticalFail++;
      }
    }

    console.log(`${status} [P${check.phase}]${check.critical ? ' [CRITICAL]' : ''}: ${check.name}`);
  }

  console.log('\n=== 按阶段汇总 ===\n');

  let totalPass = 0;
  let totalFail = 0;
  let totalCriticalFail = 0;

  for (const [phase, result] of Object.entries(resultsByPhase)) {
    const status = result.criticalFail > 0 ? '❌' : (result.fail > 0 ? '⚠️' : '✅');
    console.log(`${status} Phase ${phase}: ${result.pass}/${result.pass + result.fail} 通过 (${result.criticalFail} critical failures)`);
    totalPass += result.pass;
    totalFail += result.fail;
    totalCriticalFail += result.criticalFail;
  }

  console.log(`\n总计: ${totalPass}/${totalPass + totalFail} 通过`);

  if (totalCriticalFail > 0) {
    console.log('\n❌ 关键指令缺失，主动性改进未生效:');
    for (const check of checks) {
      if (!promptText.includes(check.pattern) && check.critical) {
        console.log(`  - [P${check.phase}] ${check.pattern}`);
      }
    }
    console.log('\n建议: 检查 src/ai/prompts/sections/doing-tasks.ts 和 output-efficiency.ts');
    return false;
  }

  if (totalFail > 0) {
    console.log('\n⚠️ 部分非关键指令缺失:');
    for (const check of checks) {
      if (!promptText.includes(check.pattern) && !check.critical) {
        console.log(`  - [P${check.phase}] ${check.pattern}`);
      }
    }
  }

  console.log('\n✅ 所有关键主动性指令已正确注入到 prompt 中');
  console.log('\nPrompt 长度:', promptText.length, 'characters');

  // 显示关键指令片段
  console.log('\n=== 关键指令片段验证 ===\n');

  const snippets = [
    'Immediate execution',
    'Do not restate what the user said — just do it',
    'IMPORTANT: Go straight to the point',
    'Action bias',
    'Momentum',
  ];

  for (const snippet of snippets) {
    const idx = promptText.indexOf(snippet);
    if (idx >= 0) {
      const context = promptText.slice(Math.max(0, idx - 20), Math.min(promptText.length, idx + snippet.length + 50));
      console.log(`找到 "${snippet}":`);
      console.log(`  "...${context.replace(/\n/g, '\\n')}..."`);
    }
  }

  return true;
}

main()
  .then((success) => {
    process.exit(success ? 0 : 1);
  })
  .catch((err) => {
    console.error('测试失败:', err);
    process.exit(1);
  });