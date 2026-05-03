import { describe, expect, it } from 'vitest';
import { NeedsUserQuestionCorrelator } from '../../../src/runtime/task-host/question-correlator.js';
import type { NeedsUserQuestion } from '../../../src/runtime/task-host/types.js';

describe('NeedsUserQuestionCorrelator', () => {
  it('accepts the current question answer and rejects stale or wrong-task answers', () => {
    const correlator = new NeedsUserQuestionCorrelator();
    const first = createQuestion('task_1', 'q_1');
    const second = createQuestion('task_1', 'q_2');
    correlator.publish(first);
    correlator.publish(second);

    expect(correlator.answer('task_1', { questionId: 'q_1', type: 'choice', choiceId: 'approve' })).toEqual({
      status: 'stale',
      question: first,
    });
    expect(correlator.answer('task_2', { questionId: 'q_2', type: 'choice', choiceId: 'approve' })).toEqual({
      status: 'not_found',
    });
    expect(correlator.answer('task_1', { questionId: 'q_2', type: 'choice', choiceId: 'approve' })).toEqual({
      status: 'accepted',
      question: second,
      answer: { questionId: 'q_2', type: 'choice', choiceId: 'approve' },
    });
    expect(correlator.getCurrent('task_1')).toBeUndefined();
  });

  it('accepts role update answers for the matching material question', () => {
    const correlator = new NeedsUserQuestionCorrelator();
    const question: NeedsUserQuestion = {
      questionId: 'q_role',
      taskId: 'task_1',
      kind: 'material_role_correction',
      prompt: '请确认材料角色',
    };
    correlator.publish(question);

    expect(correlator.answer('task_1', {
      questionId: 'q_role',
      type: 'role_update',
      materialId: 'mat_1',
      role: 'template_material',
    })).toEqual({
      status: 'accepted',
      question,
      answer: {
        questionId: 'q_role',
        type: 'role_update',
        materialId: 'mat_1',
        role: 'template_material',
      },
    });
  });
});

function createQuestion(taskId: string, questionId: string): NeedsUserQuestion {
  return {
    taskId,
    questionId,
    kind: 'assumption_approval',
    prompt: '继续吗？',
    choices: [
      { id: 'approve', label: '继续' },
      { id: 'deny', label: '暂停' },
    ],
  };
}
