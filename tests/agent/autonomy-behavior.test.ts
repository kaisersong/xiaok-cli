/**
 * Agent Autonomy Behavior Test - 真实场景闭环验证（单元测试）
 *
 * 这个测试验证 agent 在收到用户授权后的实际行为：
 * - 是否立即调用工具
 * - 是否不会要求用户确认
 * - 是否不会输出"我将执行"等空话
 *
 * 运行方式：npm test -- tests/agent/autonomy-behavior.test.ts
 */

import { describe, it, expect, beforeAll } from 'vitest';
import type { ModelAdapter, StreamChunk, ToolDefinition } from '../../src/types.js';
import { AgentRuntime } from '../../src/ai/runtime/agent-runtime.js';
import { AgentSessionState } from '../../src/ai/runtime/session.js';
import { AgentRunController } from '../../src/ai/runtime/controller.js';

// =============================================================================
// 测试基础设施
// =============================================================================

type BehaviorResult = {
  toolCalls: Array<{ name: string; input: Record<string, unknown> }>;
  textOutputs: string[];
  hasToolCall: boolean;
  hasTextOnly: boolean;
  textContainsConfirmation: boolean;
  textContainsWillDo: boolean;
};

/**
 * 创建 mock adapter，可以控制返回内容
 */
function createMockAdapter(responses: StreamChunk[][]): ModelAdapter {
  let callIndex = 0;
  return {
    getModelName: () => 'mock-test',
    stream: async function* () {
      const response = responses[callIndex++] ?? [{ type: 'text', delta: 'done' }, { type: 'done' }];
      for (const chunk of response) {
        yield chunk;
      }
    },
  };
}

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
    ] as ToolDefinition[],
    executeTool: async (name: string, input: Record<string, unknown>) => {
      recordedToolCalls.push({ name, input });
      if (name === 'Bash') {
        return `Mock executed: ${input.command}`;
      }
      return 'Mock result';
    },
  };
}

/**
 * 运行 agent 并收集行为数据
 */
async function runAgentAndCollectBehavior(
  adapter: ModelAdapter,
  userInput: string,
  systemPrompt: string,
): Promise<BehaviorResult> {
  const toolCalls: Array<{ name: string; input: Record<string, unknown> }> = [];
  const textOutputs: string[] = [];
  let currentText = '';

  const registry = createRecordingRegistry(toolCalls);
  const session = new AgentSessionState();

  const runtime = new AgentRuntime({
    adapter,
    registry: registry as never,
    session,
    controller: new AgentRunController(),
    systemPrompt,
    maxIterations: 3,
  });

  await runtime.run(userInput, (event) => {
    if (event.type === 'assistant_text') {
      currentText += event.delta;
    }
    if (event.type === 'run_completed' || event.type === 'tool_started') {
      if (currentText) {
        textOutputs.push(currentText);
        currentText = '';
      }
    }
  });

  const allText = textOutputs.join(' ');

  return {
    toolCalls,
    textOutputs,
    hasToolCall: toolCalls.length > 0,
    hasTextOnly: toolCalls.length === 0 && textOutputs.length > 0,
    textContainsConfirmation: /请确认|是否需要|要不要|确认一下|我来执行|我帮你|是否继续|是否/i.test(allText),
    textContainsWillDo: /我将|我会|让我来|I will|I'll|Let me/i.test(allText),
  };
}

// =============================================================================
// 测试用例
// =============================================================================

describe('Agent Autonomy Behavior - Mock Model', () => {
  let systemPrompt: string;

  beforeAll(async () => {
    const { PromptBuilder } = await import('../../src/ai/prompts/builder.js');
    const builder = new PromptBuilder();
    const snapshot = await builder.build({ cwd: '/test', channel: 'chat' });
    systemPrompt = snapshot.rendered;
  });

  // -------------------------------------------------------------------------
  // 正确行为验证
  // -------------------------------------------------------------------------

  it('CRITICAL: should recognize correct behavior - direct tool call without text', async () => {
    // 模型正确行为：直接返回 tool_use，不废话
    const adapter = createMockAdapter([
      [
        { type: 'tool_use', id: 'tu_1', name: 'Bash', input: { command: 'brew install duti' } },
        { type: 'done' },
      ],
      [{ type: 'text', delta: '已安装 duti' }, { type: 'done' }],
    ]);

    const result = await runAgentAndCollectBehavior(adapter, '安装 duti', systemPrompt);

    // 验证：应该有 tool call
    expect(result.hasToolCall).toBe(true);
    expect(result.toolCalls[0].name).toBe('Bash');
    expect(result.toolCalls[0].input.command).toBe('brew install duti');

    // 验证：不应该有"我将执行"等空话
    expect(result.textContainsWillDo).toBe(false);
    expect(result.textContainsConfirmation).toBe(false);
  });

  it('APPROVAL CASE: after user approval, should execute immediately', async () => {
    // 场景：用户说"允许"后，模型应该立即执行
    const adapter = createMockAdapter([
      [
        { type: 'tool_use', id: 'tu_1', name: 'Bash', input: { command: 'brew install duti' } },
        { type: 'done' },
      ],
      [{ type: 'text', delta: '完成' }, { type: 'done' }],
    ]);

    const result = await runAgentAndCollectBehavior(adapter, '允许', systemPrompt);

    expect(result.hasToolCall).toBe(true);
    expect(result.toolCalls[0].name).toBe('Bash');
  });

  it('PLAN APPROVAL CASE: after user says "执行" to a plan, should execute immediately', async () => {
    // 场景：agent 提出了一个计划，用户说"执行"后，模型应该立即开始工作
    const adapter = createMockAdapter([
      [
        { type: 'tool_use', id: 'tu_1', name: 'Read', input: { file_path: 'src/main.ts' } },
        { type: 'done' },
      ],
      [
        { type: 'tool_use', id: 'tu_2', name: 'Bash', input: { command: 'npm run build' } },
        { type: 'done' },
      ],
      [{ type: 'text', delta: '已完成实现' }, { type: 'done' }],
    ]);

    const result = await runAgentAndCollectBehavior(adapter, '执行', systemPrompt);

    // 验证：应该有 tool call，而不是输出"已收到"等空话
    expect(result.hasToolCall).toBe(true);
    expect(result.toolCalls.length).toBeGreaterThanOrEqual(1);

    // 验证：不应该有"已收到"或"收到"
    expect(result.textOutputs.join(' ')).not.toContain('收到');
  });

  it('INVESTIGATION CASE: for errors, should investigate before asking', async () => {
    // 场景：错误排查时，模型应该先调查，不是直接问用户
    const adapter = createMockAdapter([
      [
        { type: 'tool_use', id: 'tu_1', name: 'Bash', input: { command: 'cat error.log' } },
        { type: 'done' },
      ],
      [
        { type: 'tool_use', id: 'tu_2', name: 'Read', input: { file_path: 'src/main.ts' } },
        { type: 'done' },
      ],
      [{ type: 'text', delta: '找到问题：...' }, { type: 'done' }],
    ]);

    const result = await runAgentAndCollectBehavior(adapter, '测试失败了，帮我看看', systemPrompt);

    // 应该有多个 tool calls（调查行为）
    expect(result.toolCalls.length).toBeGreaterThanOrEqual(2);

    // 不应该直接问用户
    expect(result.textContainsConfirmation).toBe(false);
  });

  // -------------------------------------------------------------------------
  // 错误行为检测
  // -------------------------------------------------------------------------

  it('FAILURE CASE: should detect text-only response as incorrect behavior', async () => {
    // 模型错误行为：只输出文本，不调用工具
    const adapter = createMockAdapter([
      [
        { type: 'text', delta: '我将执行 brew install duti，请确认。' },
        { type: 'done' },
      ],
    ]);

    const result = await runAgentAndCollectBehavior(adapter, '安装 duti', systemPrompt);

    // 验证：没有 tool call 是错误行为
    expect(result.hasToolCall).toBe(false);
    expect(result.hasTextOnly).toBe(true);

    // 验证：文本中包含"我将"和"请确认"
    expect(result.textContainsWillDo).toBe(true);
    expect(result.textContainsConfirmation).toBe(true);
  });

  it('FAILURE CASE: should detect confirmation request as incorrect behavior', async () => {
    // 模型错误行为：询问确认
    const adapter = createMockAdapter([
      [
        { type: 'text', delta: '需要安装 duti，是否继续？' },
        { type: 'done' },
      ],
    ]);

    const result = await runAgentAndCollectBehavior(adapter, '安装 duti', systemPrompt);

    expect(result.hasToolCall).toBe(false);
    expect(result.textContainsConfirmation).toBe(true);
  });

  it('FAILURE CASE: should detect "I will" pattern as incorrect behavior', async () => {
    // 模型错误行为：说"我将"但不执行
    const adapter = createMockAdapter([
      [
        { type: 'text', delta: '我将为你安装 duti' },
        { type: 'done' },
      ],
    ]);

    const result = await runAgentAndCollectBehavior(adapter, '安装 duti', systemPrompt);

    expect(result.hasToolCall).toBe(false);
    expect(result.textContainsWillDo).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Prompt 指令验证
  // -------------------------------------------------------------------------

  it('PROMPT CHECK: should include CRITICAL execution instruction', async () => {
    expect(systemPrompt).toContain('CRITICAL: EXECUTE IMMEDIATELY');
  });

  it('PROMPT CHECK: should include user authorization instruction', async () => {
    expect(systemPrompt).toContain('User authorization = immediate execution');
  });

  it('PROMPT CHECK: should include plan approval instruction', async () => {
    expect(systemPrompt).toContain('Plan approval = immediate execution');
  });

  it('PROMPT CHECK: should include interactive command boundary', async () => {
    expect(systemPrompt).toContain('genuine interactive input');
  });
});