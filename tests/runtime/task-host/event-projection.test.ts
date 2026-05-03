import { describe, expect, it } from 'vitest';
import { projectRuntimeEventsToDesktopEvents } from '../../../src/runtime/task-host/event-projection.js';
import type { RuntimeEvent } from '../../../src/runtime/events.js';

describe('DesktopTaskEvent projection', () => {
  it('projects runtime events into semantic desktop events and drops raw tool noise', () => {
    const trace: RuntimeEvent[] = [
      { type: 'turn_started', sessionId: 'sess_1', turnId: 'turn_1' },
      {
        type: 'intent_created',
        sessionId: 'sess_1',
        turnId: 'turn_1',
        intentId: 'intent_1',
        templateId: 'generate_v1',
        deliverable: 'PPT 初稿',
        riskTier: 'medium',
      },
      {
        type: 'stage_activated',
        sessionId: 'sess_1',
        turnId: 'turn_1',
        intentId: 'intent_1',
        stageId: 'stage_1',
        label: '生成方案大纲',
        order: 1,
        totalStages: 2,
      },
      {
        type: 'step_activated',
        sessionId: 'sess_1',
        turnId: 'turn_1',
        intentId: 'intent_1',
        stepId: 'step_1',
      },
      {
        type: 'tool_started',
        sessionId: 'sess_1',
        turnId: 'turn_1',
        toolName: 'read',
        toolInput: { file_path: '/tmp/private.md' },
      },
      {
        type: 'tool_finished',
        sessionId: 'sess_1',
        turnId: 'turn_1',
        toolName: 'read',
        ok: true,
      },
      {
        type: 'breadcrumb_emitted',
        sessionId: 'sess_1',
        turnId: 'turn_1',
        intentId: 'intent_1',
        stepId: 'step_1',
        status: 'running',
        message: '正在归并客户诉求',
      },
      { type: 'approval_required', sessionId: 'sess_1', turnId: 'turn_1', approvalId: 'approval_1' },
      {
        type: 'artifact_recorded',
        sessionId: 'sess_1',
        turnId: 'turn_1',
        intentId: 'intent_1',
        stageId: 'stage_1',
        artifactId: 'artifact_1',
        label: '方案大纲.md',
        kind: 'markdown',
        path: '/tmp/outline.md',
      },
      {
        type: 'receipt_emitted',
        sessionId: 'sess_1',
        turnId: 'turn_1',
        intentId: 'intent_1',
        stepId: 'step_1',
        note: '已生成方案大纲',
      },
      {
        type: 'salvage_emitted',
        sessionId: 'sess_1',
        turnId: 'turn_1',
        intentId: 'intent_1',
        summary: ['已识别客户诉求', '已生成大纲'],
        reason: 'missing_material',
      },
      { type: 'turn_failed', sessionId: 'sess_1', turnId: 'turn_1', error: new Error('model unavailable') },
    ];

    const events = projectRuntimeEventsToDesktopEvents({
      taskId: 'task_1',
      events: trace,
    });

    expect(events).toEqual([
      { type: 'task_started', taskId: 'task_1' },
      { type: 'progress', eventId: 'turn_1:intent_1:created', message: '已识别任务：PPT 初稿', stage: 'intent' },
      {
        type: 'plan_updated',
        plan: [{ id: 'stage_1', label: '生成方案大纲', status: 'running' }],
      },
      { type: 'progress', eventId: 'turn_1:step_1:activated', message: '正在执行步骤 step_1', stage: 'step' },
      { type: 'progress', eventId: 'turn_1:step_1:breadcrumb', message: '正在归并客户诉求', stage: 'running' },
      {
        type: 'needs_user',
        question: {
          questionId: 'approval_1',
          taskId: 'task_1',
          kind: 'assumption_approval',
          prompt: '需要用户确认后继续。',
          choices: [
            { id: 'approve', label: '继续' },
            { id: 'deny', label: '暂停' },
          ],
        },
      },
      {
        type: 'result',
        result: {
          summary: '已记录产物：方案大纲.md',
          artifacts: [{
            artifactId: 'artifact_1',
            kind: 'text',
            title: '方案大纲.md',
            createdAt: 'turn_1',
            previewAvailable: false,
          }],
        },
      },
      {
        type: 'result',
        result: {
          summary: '已生成方案大纲',
          artifacts: [],
        },
      },
      {
        type: 'salvage',
        salvage: {
          summary: ['已识别客户诉求', '已生成大纲'],
          reason: 'missing_material',
        },
      },
      { type: 'error', message: 'model unavailable' },
    ]);
    expect(JSON.stringify(events)).not.toContain('tool_started');
    expect(JSON.stringify(events)).not.toContain('/tmp/private.md');
  });
});
