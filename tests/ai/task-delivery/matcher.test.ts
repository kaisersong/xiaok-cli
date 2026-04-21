import { describe, it, expect } from 'vitest';
import { matchSkillsForTask } from '../../../src/ai/task-delivery/matcher.js';
import type { TaskSkillHints } from '../../../src/ai/task-delivery/types.js';

function skill(
  name: string,
  description: string,
  taskHints: TaskSkillHints,
): { name: string; description: string; taskHints: TaskSkillHints } {
  return { name, description, taskHints };
}

describe('matchSkillsForTask', () => {
  it('ranks proposal-composition skills ahead of unrelated skills', () => {
    const matches = matchSkillsForTask('write a proposal for a new workflow', [
      skill('calendar-helper', 'Manage schedules', {
        taskGoals: ['schedule meetings'],
        inputKinds: ['calendar events'],
        outputKinds: ['calendar update'],
        examples: ['book a meeting'],
      }),
      skill('proposal-composer', 'Compose product proposals', {
        taskGoals: ['compose proposals', 'draft workflow proposals'],
        inputKinds: ['project brief', 'product idea'],
        outputKinds: ['proposal draft'],
        examples: ['write a proposal for launch'],
      }),
    ]);

    expect(matches[0]?.skill.name).toBe('proposal-composer');
    expect(matches[0]?.reasons).toContain('task-goals');
  });
});
