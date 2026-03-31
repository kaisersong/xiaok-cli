import type { SessionBinding } from './session-binding-store.js';

export interface SessionRuntimeSnapshotBackgroundJob {
  jobId: string;
  status: string;
  detail: string;
}

export interface SessionRuntimeSnapshotApproval {
  approvalId: string;
  summary: string;
}

export interface SessionRuntimeSnapshotInput {
  sessionId: string;
  binding?: SessionBinding | null;
  taskStatus: string;
  backgroundJobs: SessionRuntimeSnapshotBackgroundJob[];
  approvals: SessionRuntimeSnapshotApproval[];
  capabilityHealth: string;
}

export function formatSessionRuntimeSnapshot(input: SessionRuntimeSnapshotInput): string {
  const lines = [`会话 ${input.sessionId}`];

  if (input.binding) {
    lines.push(`工作区：${input.binding.cwd}`);
    if (input.binding.repoRoot) {
      lines.push(`仓库：${input.binding.repoRoot}`);
    }
    if (input.binding.branch) {
      lines.push(`分支：${input.binding.branch}`);
    }
  } else {
    lines.push('工作区：未绑定');
  }

  lines.push('');
  lines.push(normalizeRuntimeStatusText(input.taskStatus));
  lines.push('');

  if (input.backgroundJobs.length === 0) {
    lines.push('后台任务：无');
  } else {
    lines.push('后台任务：');
    for (const job of input.backgroundJobs) {
      lines.push(`${job.jobId} [${job.status}] ${normalizeRuntimeStatusText(job.detail)}`);
    }
  }

  lines.push('');

  if (input.approvals.length === 0) {
    lines.push('待审批：无');
  } else {
    lines.push('待审批：');
    for (const approval of input.approvals) {
      lines.push(`${approval.approvalId} ${approval.summary}`);
    }
  }

  lines.push('');
  lines.push(input.capabilityHealth);

  return lines.join('\n');
}

function normalizeRuntimeStatusText(text: string): string {
  return text
    .replaceAll('task interrupted by process restart', '进程重启后任务已中断，请重新发起')
    .replaceAll('background job interrupted by process restart', '进程重启后后台任务已中断')
    .replaceAll('approval interrupted by process restart', '进程重启后审批流程已中断，请重新发起');
}
