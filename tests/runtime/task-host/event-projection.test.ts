import { describe, expect, it } from 'vitest';
import { projectRuntimeEventsToDesktopEvents, projectRuntimeEventToDesktopEvent } from '../../../src/runtime/task-host/event-projection.js';
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
      { type: 'progress', eventId: expect.stringContaining('turn_1:tool:read:'), message: '🔧 read', stage: 'tool' },
      { type: 'progress', eventId: expect.stringContaining('turn_1:tool-done:read:'), message: '✓ read 完成', stage: 'completed' },
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

  // ===== Canvas event projection tests =====

  it('projects pre_tool_use to both progress and canvas_tool_call', () => {
    const runtimeEvent: RuntimeEvent = {
      type: 'pre_tool_use',
      sessionId: 'sess_1',
      turnId: 'turn_1',
      toolName: 'Write',
      toolInput: { path: '/test.html', content: '<html>test</html>' },
      toolUseId: 'tu_1',
    };
    const desktopEvent = projectRuntimeEventToDesktopEvent({ taskId: 'task_1', event: runtimeEvent });
    expect(desktopEvent).not.toBeNull();
    expect(desktopEvent!.type).toBe('progress');
    expect((desktopEvent! as any).message).toContain('Write');
  });

  it('projects post_tool_use to both progress and canvas_tool_result', () => {
    const runtimeEvent: RuntimeEvent = {
      type: 'post_tool_use',
      sessionId: 'sess_1',
      turnId: 'turn_1',
      toolName: 'Write',
      toolInput: { path: '/test.html' },
      toolResponse: { path: '/test.html', bytesWritten: 100 },
      toolUseId: 'tu_1',
    };
    const desktopEvent = projectRuntimeEventToDesktopEvent({ taskId: 'task_1', event: runtimeEvent });
    expect(desktopEvent).not.toBeNull();
    expect(desktopEvent!.type).toBe('progress');
    expect((desktopEvent! as any).message).toContain('Write');
    expect((desktopEvent! as any).stage).toBe('completed');
  });

  it('projects post_tool_use_failure to progress with error message', () => {
    const runtimeEvent: RuntimeEvent = {
      type: 'post_tool_use_failure',
      sessionId: 'sess_1',
      turnId: 'turn_1',
      toolName: 'Bash',
      toolInput: { command: 'rm -rf /' },
      toolUseId: 'tu_2',
      error: 'Permission denied',
    };
    const desktopEvent = projectRuntimeEventToDesktopEvent({ taskId: 'task_1', event: runtimeEvent });
    expect(desktopEvent).not.toBeNull();
    expect(desktopEvent!.type).toBe('progress');
    expect((desktopEvent! as any).stage).toBe('failed');
  });

  it('projects file_changed events correctly', () => {
    const runtimeEvent: RuntimeEvent = {
      type: 'file_changed',
      sessionId: 'sess_1',
      filePath: '/test.html',
      event: 'add',
    };
    const desktopEvent = projectRuntimeEventToDesktopEvent({ taskId: 'task_1', event: runtimeEvent });
    expect(desktopEvent).toBeNull(); // file_changed is not projected to DesktopTaskEvent directly
  });

  it('projects canvas events via projectRuntimeEventsToDesktopEvents', () => {
    const trace: RuntimeEvent[] = [
      { type: 'turn_started', sessionId: 's1', turnId: 't1' },
      {
        type: 'pre_tool_use',
        sessionId: 's1',
        turnId: 't1',
        toolName: 'Write',
        toolInput: { path: '/index.html', content: '<html>' },
        toolUseId: 'tu_1',
      },
      {
        type: 'post_tool_use',
        sessionId: 's1',
        turnId: 't1',
        toolName: 'Write',
        toolInput: { path: '/index.html' },
        toolResponse: { path: '/index.html', bytesWritten: 100 },
        toolUseId: 'tu_1',
      },
      {
        type: 'file_changed',
        sessionId: 's1',
        filePath: '/index.html',
        event: 'add',
      },
    ];
    const events = projectRuntimeEventsToDesktopEvents({ taskId: 'task_1', events: trace });

    // Verify existing progress events are still emitted
    expect(events.some(e => e.type === 'task_started')).toBe(true);
    expect(events.some(e => e.type === 'progress' && (e as any).message.includes('Write'))).toBe(true);

    // Verify canvas events are emitted alongside progress events
    expect(events.some(e => e.type === 'canvas_tool_call')).toBe(true);
    expect(events.some(e => e.type === 'canvas_tool_result')).toBe(true);
    expect(events.some(e => e.type === 'canvas_file_changed')).toBe(true);

    // Verify canvas_tool_call structure
    const toolCall = events.find(e => e.type === 'canvas_tool_call')!;
    expect(toolCall).toMatchObject({
      type: 'canvas_tool_call',
      toolName: 'Write',
      toolUseId: 'tu_1',
    });

    // Verify canvas_tool_result structure
    const toolResult = events.find(e => e.type === 'canvas_tool_result')!;
    expect(toolResult).toMatchObject({
      type: 'canvas_tool_result',
      toolName: 'Write',
      toolUseId: 'tu_1',
      ok: true,
    });

    // Verify canvas_file_changed structure
    const fileChanged = events.find(e => e.type === 'canvas_file_changed')!;
    expect(fileChanged).toMatchObject({
      type: 'canvas_file_changed',
      filePath: '/index.html',
      change: 'add',
    });
  });

  it('truncates toolResponse to 10KB in canvas_tool_result', () => {
    const largeResponse = 'x'.repeat(20000);
    const trace: RuntimeEvent[] = [
      {
        type: 'post_tool_use',
        sessionId: 's1',
        turnId: 't1',
        toolName: 'Write',
        toolInput: {},
        toolResponse: largeResponse,
        toolUseId: 'tu_1',
      },
    ];
    const events = projectRuntimeEventsToDesktopEvents({ taskId: 'task_1', events: trace });
    const toolResult = events.find(e => e.type === 'canvas_tool_result')!;
    expect((toolResult as any).response.length).toBeLessThanOrEqual(10000);
  });

  it('handles post_tool_use_failure with error in canvas_tool_result', () => {
    const trace: RuntimeEvent[] = [
      {
        type: 'post_tool_use_failure',
        sessionId: 's1',
        turnId: 't1',
        toolName: 'Bash',
        toolInput: { command: 'invalid' },
        toolUseId: 'tu_2',
        error: 'Command not found: invalid',
      },
    ];
    const events = projectRuntimeEventsToDesktopEvents({ taskId: 'task_1', events: trace });
    const toolResult = events.find(e => e.type === 'canvas_tool_result')!;
    expect(toolResult).toMatchObject({
      type: 'canvas_tool_result',
      toolName: 'Bash',
      ok: false,
    });
  });
});
