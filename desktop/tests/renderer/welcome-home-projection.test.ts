import { describe, expect, it } from 'vitest';

import {
  automationFailureRoute,
  buildAssistantHomeProjection,
  buildWelcomeHomeProjection,
} from '../../renderer/src/components/welcome-home-projection';

describe('welcome home projection', () => {
  it('preserves assistant ranking while projecting at most three suggestions', () => {
    const projection = buildAssistantHomeProjection({
      profile: { status: 'active', eveningTime: '21:30', morningTime: '08:30' },
      suggestions: [
        { id: 'first', title: 'First', summary: 'First summary' },
        { id: 'second', title: 'Second', summary: 'Second summary' },
        { id: 'third', title: 'Third', summary: 'Third summary' },
        { id: 'fourth', title: 'Fourth', summary: 'Fourth summary' },
      ],
      pendingCandidateCount: 4,
    });

    expect(projection.suggestions.map(item => item.id)).toEqual(['first', 'second', 'third']);
    expect(projection.pendingCandidateCount).toBe(4);
  });

  it('uses only active schedules for the running count and deduplicates failures by owner', () => {
    const projection = buildWelcomeHomeProjection([], {
      generatedAt: 10_000,
      sourceVersions: { loopStore: 1, timedActionStore: 1 },
      globalBackgroundAutoRunEnabled: true,
      totals: {
        loops: 2,
        userLoops: 2,
        schedules: 2,
        activeSchedules: 1,
        diagnostics: 3,
        recentFailures: 3,
      },
      recentFailures: [
        { id: 'new', source: 'timed_action_run', ownerId: 'schedule-1', actionId: 'schedule-1', title: 'Price check', status: 'failed', occurredAt: 9_000 },
        { id: 'old', source: 'timed_action_run', ownerId: 'schedule-1', actionId: 'schedule-1', title: 'Price check', status: 'failed', occurredAt: 8_000 },
        { id: 'loop', source: 'loop_run', ownerId: 'weekly-loop', loopId: 'weekly-loop', title: 'Weekly loop', status: 'blocked', occurredAt: 7_000 },
      ],
    });

    expect(projection.counts.activeAutomations).toBe(1);
    expect(projection.attentionItems.map(item => item.id)).toEqual(['new', 'loop']);
  });

  it('uses the production project-list intervention instead of an unavailable tasks array', () => {
    const projection = buildWelcomeHomeProjection([{
      id: 'project-1',
      name: 'Project',
      status: 'active',
      taskCount: 3,
      doneCount: 1,
      stoppedCount: 1,
      projectIntervention: {
        required: true,
        message: 'Blocked task needs a decision',
        primaryAction: { label: 'Continue project' },
      },
    }], null);

    expect(projection.attentionItems[0]).toMatchObject({
      kind: 'project',
      reason: 'Blocked task needs a decision',
      nextStep: 'Continue project',
    });
  });

  it('treats project intervention as the project-list attention authority', () => {
    const projection = buildWelcomeHomeProjection([
      {
        id: 'counts-only-project',
        name: 'Counts-only project',
        status: 'active',
        taskCount: 2,
        doneCount: 0,
        stoppedCount: 1,
      },
      {
        id: 'intervention-project',
        name: 'Intervention project',
        status: 'active',
        projectIntervention: { required: true, message: 'Decision required' },
      },
    ], null);

    expect(projection.attentionItems.map(item => item.id)).toEqual(['intervention-project']);
  });

  it('keeps project interventions ahead of automation failures', () => {
    const projection = buildWelcomeHomeProjection([{
      id: 'project-1',
      name: 'Project',
      status: 'active',
      projectIntervention: { required: true, reason: 'decision_required' },
    }], {
      generatedAt: 10_000,
      sourceVersions: { loopStore: 1, timedActionStore: 1 },
      globalBackgroundAutoRunEnabled: true,
      totals: { loops: 0, userLoops: 0, schedules: 1, activeSchedules: 1, diagnostics: 1, recentFailures: 1 },
      recentFailures: [{ id: 'failure-1', source: 'timed_action_run', ownerId: 'schedule-1', title: 'Schedule', status: 'failed', occurredAt: 9_000 }],
    });

    expect(projection.attentionItems.map(item => item.kind)).toEqual(['project', 'automation']);
  });

  it('builds loop and schedule deep links with safe fallbacks', () => {
    expect(automationFailureRoute({
      id: 'loop-run', source: 'loop_run', ownerId: 'loop-1', loopId: 'loop-1', loopOrigin: 'user_template', title: 'Loop', status: 'failed', occurredAt: 1,
    })).toBe('/automations/loops#loop-loop-1');
    expect(automationFailureRoute({
      id: 'built-in-run', source: 'loop_run', ownerId: 'built-in-loop', loopId: 'built-in-loop', loopOrigin: 'built_in', title: 'Built-in loop', status: 'failed', occurredAt: 1,
    })).toBe('/automations/diagnostics');
    expect(automationFailureRoute({
      id: 'task-run', source: 'timed_action_run', ownerId: 'task-1', actionId: 'task-1', title: 'Task', status: 'failed', occurredAt: 1,
    })).toBe('/automations/schedules#task-task-1');
    expect(automationFailureRoute({
      id: 'inactive-task-run', source: 'timed_action_run', ownerId: 'task-2', actionId: 'task-2', actionAvailableInSchedules: false, title: 'Inactive task', status: 'failed', occurredAt: 1,
    })).toBe('/automations');
    expect(automationFailureRoute({
      id: 'unknown-loop', source: 'loop_run', ownerId: 'loop-2', title: 'Loop', status: 'failed', occurredAt: 1,
    })).toBe('/automations/loops');
  });
});
