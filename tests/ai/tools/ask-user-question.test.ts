import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAskUserQuestionTool } from '../../../src/ai/tools/ask-user-question.js';
import { ToolRegistry } from '../../../src/ai/tools/index.js';
import { AgentSessionState } from '../../../src/ai/runtime/session.js';
import { askQuestion } from '../../../src/ui/ask-question.js';

vi.mock('../../../src/ui/ask-question.js', () => ({
  askQuestion: vi.fn(async () => ({ labels: ['Yes'], otherText: '' })),
}));

describe('AskUserQuestion tool', () => {
  beforeEach(() => vi.clearAllMocks());

  it('allows meaningful pre-execution choices without asking for every ordinary delegation', () => {
    const tool = createAskUserQuestionTool();
    expect(tool.executionPolicy?.waitsForUser).toBe(true);
    expect(tool.definition.description).toContain('material scope or cost tradeoff');
    expect(tool.definition.description).toContain('Do not ask for routine delegation');
    expect(tool.definition.description).not.toContain('Only use it when you are genuinely stuck');
  });

  it('returns no answer without entering the UI when the CLI is non-interactive', async () => {
    const enter = vi.fn();
    const tool = createAskUserQuestionTool({ interactive: false, onEnterInteractive: enter });
    expect(tool.definition.description).toContain('Unavailable in this non-interactive CLI');
    const result = await tool.execute({ questions: [{ question: 'Parallel or solo?', options: [{ label: 'Parallel' }, { label: 'Solo' }] }] });
    expect(result).toContain('no answer was provided');
    expect(enter).not.toHaveBeenCalled();
    expect(askQuestion).not.toHaveBeenCalled();
  });

  it('waits beyond the registry idle timeout for a real user answer', async () => {
    vi.useFakeTimers();
    let answer!: (value: Awaited<ReturnType<typeof askQuestion>>) => void;
    vi.mocked(askQuestion).mockImplementationOnce(() => new Promise(resolve => { answer = resolve; }));
    const registry = new ToolRegistry({ autoMode: true, toolIdleTimeoutMs: 100 }, [createAskUserQuestionTool()]);
    const states: string[] = [];
    try {
      const pending = registry.executeTool('AskUserQuestion', {
        questions: [{ question: 'Proceed?', options: [{ label: 'Yes' }, { label: 'No' }] }],
      }, { taskId: 'test', session: new AgentSessionState().exportSnapshot(), messages: [], systemPrompt: '', toolDefinitions: [], onExecutionHealth: state => states.push(state) });
      await vi.advanceTimersByTimeAsync(1000);
      expect(states).toContain('waiting');
      expect(states).not.toContain('cleanup_pending');
      answer({ selected: [0], labels: ['Yes'] });
      expect(await pending).toContain('Yes');
    } finally { registry.dispose(); vi.useRealTimers(); }
  });

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
