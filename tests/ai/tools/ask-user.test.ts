import { describe, expect, it, vi } from 'vitest';
import { createAskUserTool } from '../../../src/ai/tools/ask-user.js';

describe('ask_user tool', () => {
  it('delegates the question to the host and returns the answer', async () => {
    const ask = vi.fn(async (question: string) => `answer:${question}`);
    const tool = createAskUserTool({ ask });

    await expect(tool.execute({ question: 'Should I continue?' })).resolves.toBe(
      'answer:Should I continue?',
    );
    expect(ask).toHaveBeenCalledWith('Should I continue?', undefined, undefined);
  });

  it('declares and forwards structured options and multi-select without dropping them', async () => {
    const ask = vi.fn(async () => '手机端 X');
    const tool = createAskUserTool({ ask });
    const options = [
      { label: '桌面端', description: '浏览器或桌面应用' },
      { label: '手机端 X', description: '移动网络' },
    ];

    const schemaProperties = tool.definition.inputSchema.properties as Record<string, unknown>;
    expect(schemaProperties).toHaveProperty('options');
    expect(schemaProperties).toHaveProperty('multiSelect');
    await expect(tool.execute({
      question: '请选择复现场景',
      placeholder: '选择一项',
      options,
      multiSelect: true,
    })).resolves.toBe('手机端 X');
    expect(ask).toHaveBeenCalledWith('请选择复现场景', '选择一项', {
      options,
      multiSelect: true,
    });
  });

  it('rejects empty questions', async () => {
    const tool = createAskUserTool({
      ask: async () => 'unused',
    });

    await expect(tool.execute({ question: '' })).resolves.toContain('Error');
  });
});
