import type { KSwarmProject, KSwarmProjectExecutionMode, KSwarmWorkflowRun } from '../../hooks/useKSwarmClient';

export function getInlineProjectStatusText(input: {
  status: string;
  executionMode?: KSwarmProjectExecutionMode | 'workflow' | string;
  latestWorkflowRun?: KSwarmProject['latestWorkflowRun'] | KSwarmWorkflowRun | null;
}): string {
  const executionMode = normalizeInlineExecutionMode(input.executionMode);
  const workflowStatus = input.latestWorkflowRun?.status;
  if (executionMode === 'workflow_preferred') {
    if (workflowStatus === 'running') return 'Workflow 运行中';
    if (workflowStatus === 'completed') return 'Workflow 已完成';
    if (workflowStatus === 'blocked') return 'Workflow 阻塞';
    if (workflowStatus === 'failed') return 'Workflow 失败';
    return '工作流执行';
  }
  return input.status === 'created' ? 'PO 正在分解...' : input.status;
}

export function normalizeInlineExecutionMode(mode?: KSwarmProjectExecutionMode | 'workflow' | string): KSwarmProjectExecutionMode | undefined {
  if (mode === 'workflow') return 'workflow_preferred';
  if (mode === 'workflow_preferred' || mode === 'auto' || mode === 'direct') return mode;
  return undefined;
}
