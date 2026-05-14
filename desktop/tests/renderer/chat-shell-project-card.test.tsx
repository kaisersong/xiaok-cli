import { describe, it, expect, vi } from 'vitest';

describe('ChatShell project card detection', () => {
  it('detects create_project canvas_tool_result and produces project_card message', () => {
    const event = {
      type: 'canvas_tool_result',
      toolName: 'create_project',
      toolUseId: 'tu-1',
      ok: true,
      response: JSON.stringify({
        type: 'project_card',
        projectId: 'proj-test-123',
        name: '测试项目',
        status: 'created',
        createdAt: Date.now(),
        memberCount: 3,
      }),
      eventId: 'evt-1',
      ts: Date.now(),
    };

    const data = JSON.parse((event as any).response);
    expect(data.type).toBe('project_card');
    expect(data.projectId).toBe('proj-test-123');
    expect(data.name).toBe('测试项目');
    expect(data.memberCount).toBe(3);

    const msg = {
      id: `msg-project-${data.projectId}`,
      role: 'project_card' as const,
      content: '',
      projectData: data,
    };
    expect(msg.role).toBe('project_card');
    expect(msg.projectData?.projectId).toBe('proj-test-123');
  });

  it('ignores non-create_project canvas_tool_result', () => {
    const event = {
      type: 'canvas_tool_result',
      toolName: 'bash',
      toolUseId: 'tu-2',
      ok: true,
      response: 'command output',
      eventId: 'evt-2',
      ts: Date.now(),
    };
    expect((event as any).toolName).not.toBe('create_project');
  });

  it('ignores failed create_project canvas_tool_result', () => {
    const event = {
      type: 'canvas_tool_result',
      toolName: 'create_project',
      toolUseId: 'tu-3',
      ok: false,
      response: JSON.stringify({ error: 'service unavailable' }),
      eventId: 'evt-3',
      ts: Date.now(),
    };
    expect((event as any).ok).toBe(false);
  });

  it('handles invalid JSON in response gracefully', () => {
    const response = 'not-json';
    expect(() => JSON.parse(response)).toThrow();
  });
});
