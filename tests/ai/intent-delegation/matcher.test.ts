import { describe, expect, it } from 'vitest';
import { matchSkillsForTask } from '../../../src/ai/intent-delegation/matcher.js';
import type { TaskSkillHints } from '../../../src/ai/intent-delegation/types.js';

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

  it('returns no skills when nothing matches', () => {
    const matches = matchSkillsForTask('connect to a database', [
      skill('proposal-composer', 'Compose product proposals', {
        taskGoals: ['compose proposals'],
        inputKinds: ['project brief'],
        outputKinds: ['proposal draft'],
        examples: ['write a proposal'],
      }),
    ]);

    expect(matches).toEqual([]);
  });

  it('matches Chinese task phrasing against Chinese hints', () => {
    const matches = matchSkillsForTask('帮我把这几份材料整理成一版方案', [
      skill('proposal-composer', '整理材料并生成方案', {
        taskGoals: ['整理材料并生成方案'],
        inputKinds: ['材料', '需求说明'],
        outputKinds: ['方案', '提案'],
        examples: ['把材料整理成方案'],
      }),
    ]);

    expect(matches).toHaveLength(1);
    expect(matches[0]?.skill.name).toBe('proposal-composer');
    expect(matches[0]?.score).toBeGreaterThan(0);
    expect(matches[0]?.reasons).toContain('task-goals');
  });

  it('matches normal English word-form variants', () => {
    const matches = matchSkillsForTask('workflow planning', [
      skill('summary-helper', 'Summary helper', {
        taskGoals: ['workflow'],
        inputKinds: ['plan'],
        outputKinds: ['planning'],
        examples: ['workflow'],
      }),
    ]);

    expect(matches).toHaveLength(1);
    expect(matches[0]?.skill.name).toBe('summary-helper');
    expect(matches[0]?.score).toBeGreaterThan(0);
  });

  it('does not match unrelated short-prefix words', () => {
    const matches = matchSkillsForTask('workshop planning', [
      skill('workflow-helper', 'Workflow helper', {
        taskGoals: ['workflow'],
        inputKinds: ['workflows'],
        outputKinds: ['workflow plan'],
        examples: ['workflow'],
      }),
    ]);

    expect(matches).toEqual([]);
  });
});
