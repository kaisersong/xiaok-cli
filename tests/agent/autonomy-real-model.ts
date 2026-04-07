#!/usr/bin/env node
/**
 * Agent Autonomy Behavior Test - 真实场景闭环验证（真实模型）
 *
 * 这个测试使用真实 Claude 模型验证 agent 自主性行为：
 * - 是否立即调用工具
 * - 是否不会要求用户确认
 * - 是否不会输出"我将执行"等空话
 *
 * 运行方式：npx tsx tests/agent/autonomy-real-model.ts
 */

import type { ModelAdapter, StreamChunk, ToolDefinition } from '../../src/types.js';
import { AgentRuntime } from '../../src/ai/runtime/agent-runtime.js';
import { AgentSessionState } from '../../src/ai/runtime/session.js';
import { AgentRunController } from '../../src/ai/runtime/controller.js';
import { ClaudeAdapter } from '../../src/ai/adapters/claude.js';
import { PromptBuilder } from '../../dist/ai/prompts/builder.js';
import { writeFileSync, existsSync, unlinkSync } from 'fs';

// =============================================================================
// 测试基础设施
// =============================================================================

type BehaviorResult = {
  toolCalls: Array<{ name: string; input: Record<string, unknown> }>;
  textOutput: string;
  hasToolCall: boolean;
  hasConfirmation: boolean;
  hasWillDo: boolean;
};

/**
 * 创建 mock registry，记录 tool calls
 */
function createRecordingRegistry(recordedToolCalls: Array<{ name: string; input: Record<string, unknown> }>) {
  return {
    getToolDefinitions: () => [
      {
        name: 'Bash',
        description: 'Execute shell command',
        inputSchema: {
          type: 'object',
          properties: {
            command: { type: 'string' },
            description: { type: 'string' },
          },
          required: ['command'],
        },
      },
      {
        name: 'Read',
        description: 'Read file',
        inputSchema: {
          type: 'object',
          properties: {
            file_path: { type: 'string' },
          },
          required: ['file_path'],
        },
      },
      {
        name: 'Write',
        description: 'Write file',
        inputSchema: {
          type: 'object',
          properties: {
            file_path: { type: 'string' },
            content: { type: 'string' },
          },
          required: ['file_path', 'content'],
        },
      },
      {
        name: 'Glob',
        description: 'Find files',
        inputSchema: {
          type: 'object',
          properties: {
            pattern: { type: 'string' },
          },
          required: ['pattern'],
        },
      },
    ] as ToolDefinition[],
    executeTool: async (name: string, input: Record<string, unknown>) => {
      recordedToolCalls.push({ name, input });

      if (name === 'Bash') {
        // 模拟安全命令的执行
        const cmd = input.command as string;
        if (cmd.includes('ls') || cmd.includes('find')) {
          return 'file1.ts\nfile2.ts';
        }
        return `Mock executed: ${cmd}`;
      }

      if (name === 'Write') {
        return 'File written successfully';
      }

      if (name === 'Read') {
        return 'Mock file content';
      }

      if (name === 'Glob') {
        return 'file1.ts\nfile2.ts';
      }

      return 'Mock result';
    },
  };
}

/**
 * 运行真实模型并收集行为数据
 */
async function runRealModelAndCollectBehavior(
  adapter: ModelAdapter,
  userInput: string,
  systemPrompt: string,
): Promise<BehaviorResult> {
  const toolCalls: Array<{ name: string; input: Record<string, unknown> }> = [];
  let textOutput = '';

  const registry = createRecordingRegistry(toolCalls);
  const session = new AgentSessionState();

  const runtime = new AgentRuntime({
    adapter,
    registry: registry as never,
    session,
    controller: new AgentRunController(),
    systemPrompt,
    maxIterations: 5,
  });

  await runtime.run(userInput, (event) => {
    if (event.type === 'assistant_text') {
      textOutput += event.delta;
    }
  });

  return {
    toolCalls,
    textOutput,
    hasToolCall: toolCalls.length > 0,
    hasConfirmation: /请确认|是否需要|要不要|确认一下|我来执行|我帮你/i.test(textOutput),
    hasWillDo: /我将|我会|让我来|I will|I'll|Let me/i.test(textOutput),
  };
}

// =============================================================================
// 测试用例
// =============================================================================

interface TestCase {
  name: string;
  input: string;
  expectToolCall: boolean;
  expectNoConfirmation: boolean;
  expectNoWillDo: boolean;
  cleanup?: () => void;
}

const TEST_CASES: TestCase[] = [
  {
    name: '简单任务直接执行 - 创建文件',
    input: '在当前目录创建一个 test-autonomy.txt 文件，内容是 "autonomy test"',
    expectToolCall: true,
    expectNoConfirmation: true,
    expectNoWillDo: true,
    cleanup: () => {
      if (existsSync('test-autonomy.txt')) {
        unlinkSync('test-autonomy.txt');
      }
    },
  },
  {
    name: '简单任务直接执行 - 列出文件',
    input: '列出当前目录的 .ts 文件',
    expectToolCall: true,
    expectNoConfirmation: true,
    expectNoWillDo: true,
  },
  {
    name: '安装依赖任务',
    input: '安装 lodash 包',
    expectToolCall: true,
    expectNoConfirmation: true,
    expectNoWillDo: true,
    // 注意：这个测试不会真的安装，因为 registry 是 mock 的
  },
];

// =============================================================================
// 主测试函数
// =============================================================================

async function main() {
  console.log('=== Agent Autonomy Behavior 真实模型测试 ===\n');
  console.log('测试目标：验证 agent 在收到任务后是否立即执行，不询问确认\n');

  // 检查环境
  const apiKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
  if (!apiKey) {
    console.log('❌ 需要设置 ANTHROPIC_API_KEY 或 CLAUDE_API_KEY 环境变量');
    process.exit(1);
  }

  // 构建 prompt
  console.log('构建系统 prompt...');
  const builder = new PromptBuilder();
  const snapshot = await builder.build({ cwd: process.cwd(), channel: 'chat' });
  const systemPrompt = snapshot.rendered;

  // 验证 prompt 包含关键指令
  console.log('\n=== Prompt 关键指令检查 ===');
  const promptChecks = [
    { pattern: 'CRITICAL: EXECUTE IMMEDIATELY', name: '立即执行指令' },
    { pattern: 'User authorization = immediate execution', name: '用户授权执行指令' },
    { pattern: 'genuine interactive input', name: '交互式命令边界' },
  ];

  for (const check of promptChecks) {
    const found = systemPrompt.includes(check.pattern);
    console.log(`${found ? '✅' : '❌'} ${check.name}`);
    if (!found) {
      console.log(`   缺失: "${check.pattern}"`);
    }
  }

  // 创建真实 adapter
  const adapter = new ClaudeAdapter(apiKey, 'claude-sonnet-4-6');

  // 运行测试
  console.log('\n=== 真实模型行为测试 ===\n');

  const results: Array<{ name: string; pass: boolean; details: string[] }> = [];

  for (const tc of TEST_CASES) {
    console.log(`\n测试: ${tc.name}`);
    console.log(`输入: "${tc.input}"`);

    try {
      const result = await runRealModelAndCollectBehavior(adapter, tc.input, systemPrompt);

      const details: string[] = [];
      let pass = true;

      // 检查 tool call
      if (tc.expectToolCall && !result.hasToolCall) {
        pass = false;
        details.push('❌ 期望有 tool call，但实际没有');
      } else if (result.hasToolCall) {
        details.push(`✅ 有 tool call (${result.toolCalls.map(t => t.name).join(', ')})`);
      }

      // 检查确认请求
      if (tc.expectNoConfirmation && result.hasConfirmation) {
        pass = false;
        details.push('❌ 输出包含确认请求（不应该）');
      }

      // 检查"我将"等空话
      if (tc.expectNoWillDo && result.hasWillDo) {
        pass = false;
        details.push('❌ 输出包含"我将"等空话（不应该）');
      }

      if (pass) {
        details.push('✅ 通过');
      }

      results.push({ name: tc.name, pass, details });

      console.log(`结果: ${pass ? '✅ PASS' : '❌ FAIL'}`);
      details.forEach(d => console.log(`  ${d}`));
      console.log(`文本输出: "${result.textOutput.slice(0, 100)}..."`);

      // 清理
      if (tc.cleanup) {
        tc.cleanup();
      }
    } catch (error) {
      results.push({
        name: tc.name,
        pass: false,
        details: [`执行错误: ${error}`],
      });
      console.log(`❌ 执行错误: ${error}`);
    }
  }

  // 汇总
  console.log('\n=== 测试结果汇总 ===\n');
  const passCount = results.filter(r => r.pass).length;
  const totalCount = results.length;
  console.log(`通过: ${passCount}/${totalCount}`);

  for (const r of results) {
    console.log(`${r.pass ? '✅' : '❌'} ${r.name}`);
    r.details.forEach(d => console.log(`   ${d}`));
  }

  // 返回退出码
  process.exit(passCount === totalCount ? 0 : 1);
}

main().catch(err => {
  console.error('测试失败:', err);
  process.exit(1);
});