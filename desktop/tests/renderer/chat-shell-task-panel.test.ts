import { describe, it, expect } from 'vitest';
import type { DesktopTaskEvent } from '../../shared/task-types';

/**
 * Integration tests for ChatShell + TaskPanel interaction logic.
 * Tests the event-driven state transitions that control TaskPanel visibility
 * and content, simulating the event sequences that ChatShell processes.
 */

// Simulate ChatShell's planSteps state management logic
function simulateChatShellPlanSteps(events: DesktopTaskEvent[]) {
  let planSteps: Array<{ id: string; label: string; status: string }> = [];

  for (const event of events) {
    switch (event.type) {
      case 'task_started':
        planSteps = [];
        break;
      case 'progress_plan_reported': {
        const ev = event as { type: 'progress_plan_reported'; steps: Array<{ id: string; label: string; status: string }> };
        planSteps = ev.steps;
        break;
      }
    }
  }

  return planSteps;
}

// Simulate the showTaskPanel logic
function computeShowTaskPanel(planSteps: Array<unknown>, canvasOpen: boolean): boolean {
  return planSteps.length > 0 && !canvasOpen;
}

// Simulate the report_progress filter for ToolSteps
function shouldFilterFromToolSteps(event: DesktopTaskEvent): boolean {
  if (event.type === 'canvas_tool_call') {
    const ev = event as { type: 'canvas_tool_call'; toolName: string };
    return ev.toolName === 'report_progress';
  }
  return false;
}

describe('ChatShell + TaskPanel integration', () => {
  describe('planSteps state transitions', () => {
    it('starts with empty plan, no TaskPanel visible', () => {
      const planSteps = simulateChatShellPlanSteps([]);
      expect(planSteps).toEqual([]);
      expect(computeShowTaskPanel(planSteps, false)).toBe(false);
    });

    it('shows TaskPanel after progress_plan_reported', () => {
      const events: DesktopTaskEvent[] = [
        { type: 'task_started', taskId: 'task_1' },
        {
          type: 'progress_plan_reported',
          steps: [
            { id: 'step-1', label: '分析需求', status: 'running' },
            { id: 'step-2', label: '生成方案', status: 'planned' },
          ],
        },
      ];
      const planSteps = simulateChatShellPlanSteps(events);
      expect(planSteps).toHaveLength(2);
      expect(computeShowTaskPanel(planSteps, false)).toBe(true);
    });

    it('hides TaskPanel when canvas is open', () => {
      const events: DesktopTaskEvent[] = [
        { type: 'task_started', taskId: 'task_1' },
        {
          type: 'progress_plan_reported',
          steps: [{ id: 'step-1', label: '分析需求', status: 'running' }],
        },
      ];
      const planSteps = simulateChatShellPlanSteps(events);
      expect(computeShowTaskPanel(planSteps, true)).toBe(false);
    });

    it('resets planSteps on new task_started', () => {
      const events: DesktopTaskEvent[] = [
        { type: 'task_started', taskId: 'task_1' },
        {
          type: 'progress_plan_reported',
          steps: [{ id: 'step-1', label: '分析', status: 'completed' }],
        },
        { type: 'task_started', taskId: 'task_2' },
      ];
      const planSteps = simulateChatShellPlanSteps(events);
      expect(planSteps).toEqual([]);
      expect(computeShowTaskPanel(planSteps, false)).toBe(false);
    });

    it('updates planSteps on subsequent progress_plan_reported events', () => {
      const events: DesktopTaskEvent[] = [
        { type: 'task_started', taskId: 'task_1' },
        {
          type: 'progress_plan_reported',
          steps: [
            { id: 'step-1', label: '分析需求', status: 'running' },
            { id: 'step-2', label: '生成方案', status: 'planned' },
          ],
        },
        {
          type: 'progress_plan_reported',
          steps: [
            { id: 'step-1', label: '分析需求', status: 'completed' },
            { id: 'step-2', label: '生成方案', status: 'running' },
            { id: 'step-3', label: '输出文档', status: 'planned' },
          ],
        },
      ];
      const planSteps = simulateChatShellPlanSteps(events);
      expect(planSteps).toHaveLength(3);
      expect(planSteps[0].status).toBe('completed');
      expect(planSteps[1].status).toBe('running');
      expect(planSteps[2].status).toBe('planned');
    });

    it('preserves planSteps across non-task-started events', () => {
      const events: DesktopTaskEvent[] = [
        { type: 'task_started', taskId: 'task_1' },
        {
          type: 'progress_plan_reported',
          steps: [{ id: 'step-1', label: '分析', status: 'running' }],
        },
        { type: 'progress', eventId: 'e1', message: '正在执行', stage: 'running' },
        { type: 'assistant_delta', eventId: 'e2', delta: '内容' },
        { type: 'result', result: { summary: '完成', artifacts: [] } },
      ];
      const planSteps = simulateChatShellPlanSteps(events);
      expect(planSteps).toHaveLength(1);
      expect(planSteps[0].label).toBe('分析');
    });
  });

  describe('report_progress ToolSteps filter', () => {
    it('filters report_progress from ToolSteps display', () => {
      const event: DesktopTaskEvent = {
        type: 'canvas_tool_call',
        toolName: 'report_progress',
        input: { steps: [] },
        toolUseId: 'tu_1',
        eventId: 'ev_1',
      };
      expect(shouldFilterFromToolSteps(event)).toBe(true);
    });

    it('does not filter other tool calls from ToolSteps', () => {
      const event: DesktopTaskEvent = {
        type: 'canvas_tool_call',
        toolName: 'read',
        input: { file_path: '/tmp/test.md' },
        toolUseId: 'tu_2',
        eventId: 'ev_2',
      };
      expect(shouldFilterFromToolSteps(event)).toBe(false);
    });

    it('does not filter non-canvas-tool-call events', () => {
      const event: DesktopTaskEvent = {
        type: 'progress',
        eventId: 'ev_3',
        message: '正在执行',
        stage: 'running',
      };
      expect(shouldFilterFromToolSteps(event)).toBe(false);
    });
  });

  describe('replay (snapshot hydration) with progress_plan_reported', () => {
    it('restores planSteps from replayed snapshot events', () => {
      // Simulates what ChatShell does in replaySnapshot
      const snapshotEvents: DesktopTaskEvent[] = [
        { type: 'task_started', taskId: 'task_1' },
        { type: 'progress', eventId: 'e1', message: '开始', stage: 'running' },
        {
          type: 'progress_plan_reported',
          steps: [
            { id: 'step-1', label: '分析需求', status: 'completed' },
            { id: 'step-2', label: '生成方案', status: 'running' },
          ],
        },
        {
          type: 'canvas_tool_call',
          toolName: 'report_progress',
          input: { steps: [] },
          toolUseId: 'tu_rp',
          eventId: 'ev_rp',
        },
      ];

      // In replay, ChatShell processes progress_plan_reported to restore planSteps
      const planSteps = simulateChatShellPlanSteps(snapshotEvents);
      expect(planSteps).toHaveLength(2);

      // And report_progress canvas_tool_call should be filtered from ToolSteps
      const reportProgressEvent = snapshotEvents[3];
      expect(shouldFilterFromToolSteps(reportProgressEvent)).toBe(true);
    });

    it('replays multiple progress_plan_reported events, last one wins', () => {
      const snapshotEvents: DesktopTaskEvent[] = [
        { type: 'task_started', taskId: 'task_1' },
        {
          type: 'progress_plan_reported',
          steps: [{ id: 'step-1', label: '步骤一', status: 'running' }],
        },
        {
          type: 'progress_plan_reported',
          steps: [
            { id: 'step-1', label: '步骤一', status: 'completed' },
            { id: 'step-2', label: '步骤二', status: 'running' },
          ],
        },
      ];

      const planSteps = simulateChatShellPlanSteps(snapshotEvents);
      expect(planSteps).toHaveLength(2);
      expect(planSteps[0].status).toBe('completed');
      expect(planSteps[1].status).toBe('running');
    });
  });
});
