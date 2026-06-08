import { describe, expect, it } from 'vitest';
import { projectRuntimeEventToDesktopEvent, projectRuntimeEventsToDesktopEvents } from '../../../src/runtime/task-host/event-projection.js';

const DASHBOARD_TOOL_NAME = ['render', 'ui'].join('_');

describe('A2UI desktop event projection', () => {
  it('redacts dashboard tool input in canvas tool call events while preserving a useful summary', () => {
    const events = projectRuntimeEventsToDesktopEvents({
      taskId: 'task_1',
      events: [{
        type: 'pre_tool_use',
        sessionId: 'session_1',
        turnId: 'turn_1',
        toolName: DASHBOARD_TOOL_NAME,
        toolUseId: 'tool_1',
        toolInput: {
          title: 'Sensitive report',
          sections: [{ kind: 'text', content: 'SECRET_CUSTOMER_TOKEN' }],
          data: { token: 'SECRET_DATA_TOKEN' },
        },
      }],
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'canvas_tool_call',
      toolName: DASHBOARD_TOOL_NAME,
      displayInputSummary: expect.stringContaining('[A2UI] Sensitive report'),
      input: {
        title: 'Sensitive report',
        sectionCount: 1,
        redacted: true,
      },
    });
    expect(JSON.stringify(events[0])).not.toContain('SECRET_CUSTOMER_TOKEN');
    expect(JSON.stringify(events[0])).not.toContain('SECRET_DATA_TOKEN');
  });

  it('maps dashboard tool output to an A2UI artifact_recorded event with mime metadata', () => {
    const event = projectRuntimeEventToDesktopEvent({
      taskId: 'task_1',
      event: {
        type: 'post_tool_use',
        sessionId: 'session_1',
        turnId: 'turn_1',
        toolName: DASHBOARD_TOOL_NAME,
        toolUseId: 'tool_1',
        toolInput: {},
        toolResponse: JSON.stringify({
          ok: true,
          artifactPath: '/tmp/sales.a2ui.json',
          mimeType: 'application/vnd.xiaok.a2ui+json',
          title: 'Sales dashboard',
        }),
      },
    });

    expect(event).toMatchObject({
      type: 'artifact_recorded',
      artifactId: 'artifact_tool_1',
      kind: 'a2ui',
      label: 'Sales dashboard',
      filePath: '/tmp/sales.a2ui.json',
      mimeType: 'application/vnd.xiaok.a2ui+json',
    });
  });
});
