import type { KSwarmProject, KSwarmProjectExecutionMode, KSwarmWorkflowRun } from '../../hooks/useKSwarmClient';
import type { LocaleStrings } from '../../locales';

export interface InlineProjectLabels {
  workflowRunning: string;
  workflowCompleted: string;
  workflowBlocked: string;
  workflowFailed: string;
  workflowExec: string;
  poDecomposing: string;
}

export function buildInlineProjectLabels(t: LocaleStrings): InlineProjectLabels {
  return {
    workflowRunning: t.projectsInlineWorkflowRunning,
    workflowCompleted: t.projectsInlineWorkflowCompleted,
    workflowBlocked: t.projectsInlineWorkflowBlocked,
    workflowFailed: t.projectsInlineWorkflowFailed,
    workflowExec: t.projectsInlineWorkflowExec,
    poDecomposing: t.projectsInlinePoDecomposing,
  };
}

export function getInlineProjectStatusText(input: {
  status: string;
  executionMode?: KSwarmProjectExecutionMode | 'workflow' | string;
  latestWorkflowRun?: KSwarmProject['latestWorkflowRun'] | KSwarmWorkflowRun | null;
}, labels: InlineProjectLabels): string {
  const executionMode = normalizeInlineExecutionMode(input.executionMode);
  const workflowStatus = input.latestWorkflowRun?.status;
  if (executionMode === 'workflow_preferred') {
    if (workflowStatus === 'running') return labels.workflowRunning;
    if (workflowStatus === 'completed') return labels.workflowCompleted;
    if (workflowStatus === 'blocked') return labels.workflowBlocked;
    if (workflowStatus === 'failed') return labels.workflowFailed;
    return labels.workflowExec;
  }
  return input.status === 'created' ? labels.poDecomposing : input.status;
}

export function normalizeInlineExecutionMode(mode?: KSwarmProjectExecutionMode | 'workflow' | string): KSwarmProjectExecutionMode | undefined {
  if (mode === 'workflow') return 'workflow_preferred';
  if (mode === 'workflow_preferred' || mode === 'auto' || mode === 'direct') return mode;
  return undefined;
}
