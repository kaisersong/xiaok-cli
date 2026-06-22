import type { ProjectFullDetail, KSwarmAgent, KSwarmTask, KSwarmActivityEvent } from '../../hooks/useKSwarmClient';

interface ExportLocale {
  projectsStatusDraft: string;
  projectsStatusPlanning: string;
  projectsStatusActive: string;
  projectsStatusReview: string;
  projectsStatusDelivered: string;
  projectsStatusClosed: string;
  projectsExportStatus: string;
  projectsExportCreatedAt: string;
  projectsExportUpdatedAt: string;
  projectsExportDeliveredAt: string;
  projectsExportClosedAt: string;
  projectsExportGoal: string;
  projectsExportRequirements: string;
  projectsExportWorkspace: string;
  projectsExportWorkspacePath: string;
  projectsExportWorkspaceFiles: (count: number) => string;
  projectsExportPlan: string;
  projectsExportAnalysis: string;
  projectsExportSuccessCriteria: string;
  projectsExportPhases: string;
  projectsExportPhaseLabel: (id: string) => string;
  projectsExportAcceptanceCriteria: string;
  projectsExportPlanVersion: (version: number) => string;
  projectsExportTasks: string;
  projectsExportTaskStatus: string;
  projectsExportTaskAssignee: string;
  projectsExportTaskDescription: string;
  projectsExportTaskPhase: string;
  projectsExportTaskResult: string;
  projectsExportTaskArtifacts: string;
  projectsExportAgents: string;
  projectsExportActivityLog: string;
  projectsExportDeliverables: string;
  projectsExportDeliveryNote: string;
  projectsExportProjectSummary: string;
  projectsExportScore: string;
}

const STATUS_MAP: Record<string, keyof ExportLocale> = {
  draft: 'projectsStatusDraft',
  planning: 'projectsStatusPlanning',
  created: 'projectsStatusPlanning',
  active: 'projectsStatusActive',
  review: 'projectsStatusReview',
  delivered: 'projectsStatusDelivered',
  closed: 'projectsStatusClosed',
};

function formatTime(ts?: string | number): string {
  if (!ts) return '-';
  const d = typeof ts === 'number' ? new Date(ts) : new Date(ts);
  return isNaN(d.getTime()) ? String(ts) : d.toLocaleString();
}

function taskStatusLabel(status: string): string {
  const map: Record<string, string> = {
    pending: 'Pending', dispatched: 'Dispatched', in_progress: 'In Progress',
    review: 'Review', done: 'Done', failed: 'Failed', cancelled: 'Cancelled',
  };
  return map[status] ?? status;
}

function agentName(agentId: string | undefined, agents: KSwarmAgent[]): string {
  if (!agentId) return '-';
  const a = agents.find(ag => ag.id === agentId);
  return a?.name ?? agentId;
}

export function exportProjectMarkdown(
  detail: ProjectFullDetail,
  agents: KSwarmAgent[],
  t: ExportLocale,
): string {
  const { project, tasks, activities, workspace, plan, planProgress } = detail;
  const lines: string[] = [];

  const statusKey = STATUS_MAP[project.status];
  const statusLabel = statusKey ? t[statusKey] : project.status;

  // Title & meta
  lines.push(`# ${project.name}`);
  lines.push('');
  lines.push(`- **${t.projectsExportStatus}**: ${statusLabel}`);
  if (project.createdAt) lines.push(`- **${t.projectsExportCreatedAt}**: ${formatTime(project.createdAt)}`);
  if (project.updatedAt) lines.push(`- **${t.projectsExportUpdatedAt}**: ${formatTime(project.updatedAt)}`);
  if (project.deliveredAt) lines.push(`- **${t.projectsExportDeliveredAt}**: ${formatTime(project.deliveredAt)}`);
  if (project.closedAt) lines.push(`- **${t.projectsExportClosedAt}**: ${formatTime(project.closedAt)}`);
  lines.push('');

  // Goal
  if (project.goal) {
    lines.push(`## ${t.projectsExportGoal}`);
    lines.push('');
    lines.push(project.goal);
    lines.push('');
  }

  // Requirements
  if (project.requirements) {
    lines.push(`## ${t.projectsExportRequirements}`);
    lines.push('');
    lines.push(project.requirements);
    lines.push('');
  }

  // Workspace
  if (workspace?.path) {
    lines.push(`## ${t.projectsExportWorkspace}`);
    lines.push('');
    lines.push(`${t.projectsExportWorkspacePath}: \`${workspace.path}\``);
    if (workspace.artifacts?.length) {
      lines.push(t.projectsExportWorkspaceFiles(workspace.artifacts.length));
    }
    lines.push('');
  }

  // Plan
  if (plan) {
    lines.push(`## ${t.projectsExportPlan}`);
    lines.push('');
    if (plan.analysis) {
      lines.push(`### ${t.projectsExportAnalysis}`);
      lines.push('');
      lines.push(plan.analysis);
      lines.push('');
    }
    if (plan.successCriteria?.length) {
      lines.push(`### ${t.projectsExportSuccessCriteria}`);
      lines.push('');
      for (const c of plan.successCriteria) {
        lines.push(`- ${c}`);
      }
      lines.push('');
    }
    if (plan.phases?.length) {
      lines.push(`### ${t.projectsExportPhases}`);
      lines.push('');
      for (const phase of plan.phases) {
        const phaseProgress = planProgress?.phases?.find(p => String(p.phaseId) === String(phase.id ?? phase.phaseId));
        const progressStr = phaseProgress ? ` (${phaseProgress.done}/${phaseProgress.total})` : '';
        lines.push(`#### ${phase.title ?? t.projectsExportPhaseLabel(String(phase.id ?? ''))}${progressStr}`);
        lines.push('');
        if (phase.items?.length) {
          for (const item of phase.items) {
            const check = item.status === 'completed' ? '[x]' : '[ ]';
            lines.push(`- ${check} **${item.title}** — ${item.brief ?? ''}`);
            if (item.acceptanceCriteria?.length) {
              for (const ac of item.acceptanceCriteria) {
                lines.push(`  - ${t.projectsExportAcceptanceCriteria}: ${ac}`);
              }
            }
          }
          lines.push('');
        }
      }
    }
    if (plan.version) {
      lines.push(`> ${t.projectsExportPlanVersion(plan.version)}`);
      lines.push('');
    }
  }

  // Tasks
  if (tasks.length > 0) {
    lines.push(`## ${t.projectsExportTasks}`);
    lines.push('');
    for (const task of tasks) {
      lines.push(`### ${task.title}`);
      lines.push('');
      lines.push(`- **${t.projectsExportTaskStatus}**: ${taskStatusLabel(task.status)}`);
      lines.push(`- **${t.projectsExportTaskAssignee}**: ${agentName(task.assignedAgent, agents)}`);
      if (task.description) lines.push(`- **${t.projectsExportTaskDescription}**: ${task.description}`);
      if (task.phase !== undefined) lines.push(`- **${t.projectsExportTaskPhase}**: ${task.phase}`);
      if (task.result) lines.push(`- **${t.projectsExportTaskResult}**: ${task.result}`);
      if (task.artifacts?.length) {
        lines.push(`- **${t.projectsExportTaskArtifacts}**:`);
        for (const art of task.artifacts) {
          const loc = art.path || art.url || '-';
          lines.push(`  - ${art.name} — \`${loc}\``);
        }
      }
      lines.push('');
    }
  }

  // Agents
  lines.push(`## ${t.projectsExportAgents}`);
  lines.push('');
  if (project.poAgent) {
    lines.push(`- **PO**: ${agentName(project.poAgent, agents)}`);
  }
  const memberIds = new Set(project.members || []);
  const workers = agents.filter(a => memberIds.has(a.id));
  if (workers.length) {
    for (const w of workers) {
      lines.push(`- **Worker**: ${w.name}`);
    }
  }
  lines.push('');

  // Activity log
  if (activities.length > 0) {
    lines.push(`## ${t.projectsExportActivityLog}`);
    lines.push('');
    for (const evt of activities) {
      const time = formatTime(evt.ts);
      const who = evt.agent ? agentName(evt.agent, agents) : (evt.by ?? '');
      const task = evt.taskTitle ? ` — ${evt.taskTitle}` : '';
      lines.push(`- \`${time}\` **${evt.type}** ${who}${task}`);
    }
    lines.push('');
  }

  // Deliverables
  const deliverables = project.deliverables;
  if (deliverables?.length) {
    lines.push(`## ${t.projectsExportDeliverables}`);
    lines.push('');
    for (const d of deliverables) {
      const loc = d.path || d.url || '-';
      lines.push(`- **${d.title}**${d.format ? ` (${d.format})` : ''} — \`${loc}\``);
    }
    lines.push('');
  }

  // Project deliverable summary
  const deliverable = project.deliverable;
  if (deliverable && typeof deliverable === 'string') {
    lines.push(`## ${t.projectsExportDeliveryNote}`);
    lines.push('');
    lines.push(deliverable);
    lines.push('');
  }

  // Project summary (PO-generated)
  const summary = project.summary;
  if (summary && typeof summary === 'string') {
    lines.push(`## ${t.projectsExportProjectSummary}`);
    lines.push('');
    const score = project.summaryScore;
    if (score != null) {
      lines.push(`**${t.projectsExportScore}**: ${score}/10`);
      lines.push('');
    }
    lines.push(summary);
    lines.push('');
  }

  return lines.join('\n');
}
