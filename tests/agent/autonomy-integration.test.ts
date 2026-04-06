/**
 * Agent Autonomy Integration Test - 闭环验证
 *
 * 这个测试验证主动性改进的 prompt 指令是否正确注入。
 * 核心验证点：
 * 1. "Immediate execution" - 直接任务请求立即执行
 * 2. "just do it" - 不要重复用户请求
 * 3. "Go straight to the point" - 直接行动
 * 4. "Never output text without tool" - 禁止空输出
 */

import { describe, it, expect } from 'vitest';
import { PromptBuilder } from '../../dist/ai/prompts/builder.js';

// =============================================================================
// 测试用例
// =============================================================================

describe('Agent Autonomy Prompt 检查', () => {
  let promptText: string;

  beforeAll(async () => {
    const promptBuilder = new PromptBuilder();
    const snapshot = await promptBuilder.build({
      cwd: '/test/workspace',
      channel: 'chat',
    });
    promptText = snapshot.rendered;
  });

  // ---------------------------------------------------------------------------
  // Phase 4 新增指令检查
  // ---------------------------------------------------------------------------

  it('should include "Immediate execution" instruction', () => {
    expect(promptText).toContain('Immediate execution');
  });

  it('should include "just do it" instruction', () => {
    expect(promptText).toContain('Do not restate what the user said — just do it');
  });

  it('should include "Go straight to the point"', () => {
    expect(promptText).toContain('Go straight to the point');
  });

  it('should include "Skip filler words, preamble"', () => {
    expect(promptText).toContain('Skip filler words, preamble');
  });

  // ---------------------------------------------------------------------------
  // Phase 3 指令检查（不应丢失）
  // ---------------------------------------------------------------------------

  it('should include Action bias instruction', () => {
    expect(promptText).toContain('Action bias');
  });

  it('should include Momentum instruction', () => {
    expect(promptText).toContain('Momentum');
  });

  it('should include agreed action immediate execution', () => {
    expect(promptText).toContain('When the user agrees to a proposed action');
  });

  // ---------------------------------------------------------------------------
  // Phase 1-2 指令检查（不应丢失）
  // ---------------------------------------------------------------------------

  it('should include "highly capable" statement', () => {
    expect(promptText).toContain('You are highly capable');
  });

  it('should include "genuinely stuck" escalation guidance', () => {
    expect(promptText).toContain('genuinely stuck');
  });

  it('should include AskUserQuestion denial handling', () => {
    expect(promptText).toContain('If you do not understand why the user has denied a tool call');
  });
});

// =============================================================================
// 命令行运行脚本
// =============================================================================

async function runCliTest() {
  console.log('Running Agent Autonomy Prompt Check...\n');

  const promptBuilder = new PromptBuilder();
  const snapshot = await promptBuilder.build({
    cwd: process.cwd(),
    channel: 'chat',
  });

  const promptText = snapshot.rendered;

  console.log('=== Prompt 检查结果 ===\n');

  const checks = [
    // Phase 4 新增
    { name: 'Immediate execution', pattern: 'Immediate execution', phase: 4 },
    { name: 'just do it', pattern: 'Do not restate what the user said — just do it', phase: 4 },
    { name: 'Go straight to the point', pattern: 'Go straight to the point', phase: 4 },
    { name: 'Skip filler', pattern: 'Skip filler words, preamble', phase: 4 },

    // Phase 3
    { name: 'Action bias', pattern: 'Action bias', phase: 3 },
    { name: 'Momentum', pattern: 'Momentum', phase: 3 },

    // Phase 1-2
    { name: 'Highly capable', pattern: 'You are highly capable', phase: 1 },
    { name: 'Genuinely stuck', pattern: 'genuinely stuck', phase: 2 },
    { name: 'Denied tool call handling', pattern: 'If you do not understand why the user has denied a tool call', phase: 2 },
  ];

  const resultsByPhase: Record<number, { pass: number; fail: number }> = {};

  for (const check of checks) {
    const pass = promptText.includes(check.pattern);
    const status = pass ? '✅ PASS' : '❌ FAIL';

    if (!resultsByPhase[check.phase]) {
      resultsByPhase[check.phase] = { pass: 0, fail: 0 };
    }
    if (pass) {
      resultsByPhase[check.phase].pass++;
    } else {
      resultsByPhase[check.phase].fail++;
    }

    console.log(`${status} [P${check.phase}]: ${check.name}`);
  }

  console.log('\n=== 按阶段汇总 ===\n');

  let totalPass = 0;
  let totalFail = 0;

  for (const [phase, result] of Object.entries(resultsByPhase)) {
    console.log(`Phase ${phase}: ${result.pass}/${result.pass + result.fail} 通过`);
    totalPass += result.pass;
    totalFail += result.fail;
  }

  console.log(`\n总计: ${totalPass}/${totalPass + totalFail} 通过`);

  if (totalFail > 0) {
    console.log('\n❌ 缺少的关键指令:');
    for (const check of checks) {
      if (!promptText.includes(check.pattern)) {
        console.log(`  - [P${check.phase}] ${check.pattern}`);
      }
    }
    return false;
  }

  console.log('\n✅ 所有主动性指令已正确注入到 prompt 中');
  return true;
}

// 当直接运行此文件时，执行 CLI 测试
if (import.meta.url === `file://${process.argv[1]}`) {
  runCliTest()
    .then((success) => {
      process.exit(success ? 0 : 1);
    })
    .catch((err) => {
      console.error('测试失败:', err);
      process.exit(1);
    });
}