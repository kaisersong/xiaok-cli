import type { ChatMessage } from './ChatView';

export function buildProjectCardMessageFromToolResult(response: string): ChatMessage | null {
  const data = parseJsonRecord(response);
  if (data?.type !== 'project_card') return null;
  const projectId = readString(data.projectId);
  const name = readString(data.name);
  if (!projectId || !name) return null;
  return {
    id: `msg-project-${projectId}`,
    role: 'project_card',
    content: '',
    projectData: {
      type: 'project_card',
      projectId,
      name,
      goal: readString(data.goal),
      status: readString(data.status) || 'created',
      createdAt: readNumber(data.createdAt) || Date.now(),
      memberCount: readNumber(data.memberCount) || 0,
      executionMode: readString(data.executionMode) || undefined,
    },
  };
}

export function buildWorkflowMessageFromToolResult(response: string): ChatMessage | null {
  const data = parseJsonRecord(response);
  if (!data?.ok) return null;
  const workflowRunId = readString(data.workflowRunId);
  if (!workflowRunId) return null;
  const workflowId = readString(data.workflowId) || 'dynamic_workflow';
  const status = readString(data.status) || readString(readRecord(data.workflowRun).status) || 'running';
  const projectId = readString(data.projectId);
  return {
    id: `msg-workflow-${workflowRunId}-${status}`,
    role: 'assistant',
    content: formatWorkflowStatusMessage({ workflowId, workflowRunId, projectId, status, data }),
  };
}

function formatWorkflowStatusMessage(input: {
  workflowId: string;
  workflowRunId: string;
  projectId: string;
  status: string;
  data: Record<string, unknown>;
}): string {
  const lines = [];
  if (input.status === 'completed') {
    lines.push('动态工作流已完成。');
  } else if (input.status === 'blocked' || input.status === 'failed') {
    const reason = readString(readRecord(input.data.gateDecision).reason)
      || readString(input.data.error)
      || readString(input.data.message)
      || input.status;
    lines.push(`动态工作流已${input.status === 'blocked' ? '阻塞' : '失败'}：${reason}`);
  } else {
    lines.push('动态工作流已启动，正在后台执行。');
  }
  lines.push(`Workflow：${input.workflowId}`);
  lines.push(`Run ID：${input.workflowRunId}`);
  if (input.projectId) lines.push(`项目 ID：${input.projectId}`);
  return lines.join('\n');
}

function parseJsonRecord(text: string): Record<string, unknown> | null {
  try {
    return readRecord(JSON.parse(text));
  } catch {
    return null;
  }
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readNumber(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}
