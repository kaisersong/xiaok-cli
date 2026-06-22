import { describe, it, expect } from 'vitest';
import {
  buildProjectCardMessageFromToolResult,
  buildWorkflowMessageFromToolResult,
} from '../../renderer/src/components/chatToolResultMessages';
import type { WorkflowLabels } from '../../renderer/src/components/chatToolResultMessages';
import { getInlineProjectStatusText, buildInlineProjectLabels } from '../../renderer/src/components/projects/project-inline-utils';
import { zh } from '../../renderer/src/locales/zh';

const inlineLabels = buildInlineProjectLabels(zh);

const workflowLabels: WorkflowLabels = {
  chatWorkflowCompleted: zh.chatWorkflowCompleted,
  chatWorkflowBlockedOrFailed: zh.chatWorkflowBlockedOrFailed,
  chatWorkflowStarted: zh.chatWorkflowStarted,
  chatWorkflowProjectId: zh.chatWorkflowProjectId,
};

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
        executionMode: 'workflow_preferred',
      }),
      eventId: 'evt-1',
      ts: Date.now(),
    };

    const msg = buildProjectCardMessageFromToolResult((event as any).response);
    expect(msg).not.toBeNull();
    expect(msg!.projectData).toBeTruthy();
    expect(msg!.role).toBe('project_card');
    expect(msg!.projectData?.projectId).toBe('proj-test-123');
    expect(msg!.projectData?.name).toBe('测试项目');
    expect(msg!.projectData?.memberCount).toBe(3);
    expect(msg!.projectData?.executionMode).toBe('workflow_preferred');
  });

  it('shows workflow execution state on project cards instead of direct planning copy', () => {
    expect(getInlineProjectStatusText({
      status: 'created',
      executionMode: 'workflow_preferred',
      latestWorkflowRun: { id: 'wf-1', status: 'running' } as any,
    }, inlineLabels)).toBe('Workflow 运行中');

    expect(getInlineProjectStatusText({
      status: 'created',
      executionMode: 'workflow',
      latestWorkflowRun: null,
    }, inlineLabels)).toBe('工作流执行');
  });

  it('detects run_dynamic_workflow_script result and produces visible workflow feedback', () => {
    const msg = buildWorkflowMessageFromToolResult(JSON.stringify({
      ok: true,
      projectId: 'proj-test-123',
      workflowRunId: 'wf-proj-test-123-analysis-1',
      workflowId: 'analysis_workflow',
      status: 'running',
      backgroundJob: { status: 'running' },
    }), workflowLabels);

    expect(msg?.role).toBe('assistant');
    expect(msg?.content).toContain('动态工作流已启动');
    expect(msg?.content).toContain('wf-proj-test-123-analysis-1');
    expect(msg?.content).toContain('proj-test-123');
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
