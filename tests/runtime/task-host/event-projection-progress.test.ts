import { describe, it, expect } from 'vitest';
import { projectRuntimeEventToDesktopEvent } from '../../../src/runtime/task-host/event-projection.js';
import type { RuntimeEvent } from '../../../src/runtime/events.js';

describe('event-projection: progress_plan_reported', () => {
  it('projects progress_plan_reported runtime event to desktop event', () => {
    const runtimeEvent: RuntimeEvent = {
      type: 'progress_plan_reported',
      sessionId: 'sess_1',
      steps: [
        { id: 'step-1', label: '分析需求', status: 'running' },
        { id: 'step-2', label: '生成方案', status: 'planned' },
      ],
    };

    const result = projectRuntimeEventToDesktopEvent({
      taskId: 'task_1',
      event: runtimeEvent,
    });

    expect(result).toEqual({
      type: 'progress_plan_reported',
      steps: [
        { id: 'step-1', label: '分析需求', status: 'running' },
        { id: 'step-2', label: '生成方案', status: 'planned' },
      ],
    });
  });

  it('preserves all valid status values through projection', () => {
    const statuses = ['planned', 'running', 'completed', 'blocked', 'failed'];
    const steps = statuses.map((status, i) => ({ id: `step-${i}`, label: `Step ${i}`, status }));

    const runtimeEvent: RuntimeEvent = {
      type: 'progress_plan_reported',
      sessionId: 'sess_1',
      steps,
    };

    const result = projectRuntimeEventToDesktopEvent({
      taskId: 'task_1',
      event: runtimeEvent,
    });

    expect(result).not.toBeNull();
    if (result && result.type === 'progress_plan_reported') {
      expect(result.steps).toHaveLength(5);
      for (let i = 0; i < statuses.length; i++) {
        expect(result.steps[i].status).toBe(statuses[i]);
      }
    }
  });

  it('does not interfere with other event type projections', () => {
    const turnStarted: RuntimeEvent = {
      type: 'turn_started',
      sessionId: 'sess_1',
      turnId: 'turn_1',
    };

    const result = projectRuntimeEventToDesktopEvent({
      taskId: 'task_1',
      event: turnStarted,
    });

    expect(result).toEqual({ type: 'task_started', taskId: 'task_1' });
  });
});
