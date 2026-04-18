import { describe, expect, it, vi } from 'vitest';
import { createAskUserQuestionTool } from '../../../src/ai/tools/ask-user-question.js';
import { askQuestion } from '../../../src/ui/ask-question.js';

vi.mock('../../../src/ui/ask-question.js', () => ({
  askQuestion: vi.fn(async () => ({ labels: ['Yes'], otherText: '' })),
}));

describe('AskUserQuestion tool', () => {
  it('runs interactive lifecycle callbacks around terminal questions', async () => {
    const events: string[] = [];
    const tool = createAskUserQuestionTool({
      onEnterInteractive: () => events.push('enter'),
      onExitInteractive: () => events.push('exit'),
    });

    await tool.execute({
      questions: [
        {
          question: 'Proceed?',
          options: [{ label: 'Yes' }, { label: 'No' }],
        },
      ],
    });

    expect(askQuestion).toHaveBeenCalledOnce();
    expect(events).toEqual(['enter', 'exit']);
  });
});
