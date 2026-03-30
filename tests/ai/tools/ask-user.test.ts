import { describe, expect, it, vi } from 'vitest';
import { createAskUserTool } from '../../../src/ai/tools/ask-user.js';

describe('ask_user tool', () => {
  it('delegates the question to the host and returns the answer', async () => {
    const ask = vi.fn(async (question: string) => `answer:${question}`);
    const tool = createAskUserTool({ ask });

    await expect(tool.execute({ question: 'Should I continue?' })).resolves.toBe(
      'answer:Should I continue?',
    );
    expect(ask).toHaveBeenCalledWith('Should I continue?', undefined);
  });

  it('rejects empty questions', async () => {
    const tool = createAskUserTool({
      ask: async () => 'unused',
    });

    await expect(tool.execute({ question: '' })).resolves.toContain('Error');
  });
});
