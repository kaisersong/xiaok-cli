import type { ProjectFullDetail, KSwarmAgent, KSwarmTask, KSwarmActivityEvent } from '../../hooks/useKSwarmClient';

interface ExportLocale {
  projectsStatusDraft: string;
  projectsStatusPlanning: string;
  projectsStatusActive: string;
  projectsStatusReview: string;
  projectsStatusDelivered: string;
  projectsStatusClosed: string;
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
  lines.push(`- **状态**: ${statusLabel}`);
  if (project.createdAt) lines.push(`- **创建时间**: ${formatTime(project.createdAt)}`);
  if (project.updatedAt) lines.push(`- **更新时间**: ${formatTime(project.updatedAt)}`);
  if ((project as any).deliveredAt) lines.push(`- **交付时间**: ${formatTime((project as any).deliveredAt)}`);
  if ((project as any).closedAt) lines.push(`- **关闭时间**: ${formatTime((project as any).closedAt)}`);
  lines.push('');

  // Goal
  if (project.goal) {
    lines.push('## 目标');
    lines.push('');
    lines.push(project.goal);
    lines.push('');
  }

  // Requirements
  if ((project as any).requirements) {
    lines.push('## 需求');
    lines.push('');
    lines.push((project as any).requirements);
    lines.push('');
  }

  // Workspace
  if (workspace?.path) {
    lines.push('## 工作区');
    lines.push('');
    lines.push(`路径: \`${workspace.path}\``);
    if (workspace.artifacts?.length) {
      lines.push(`文件数: ${workspace.artifacts.length}`);
    }
    lines.push('');
  }

  // Plan
  if (plan) {
    lines.push('## 计划');
    lines.push('');
    if (plan.analysis) {
      lines.push('### 分析');
      lines.push('');
      lines.push(plan.analysis);
      lines.push('');
    }
    if (plan.successCriteria?.length) {
      lines.push('### 成功标准');
      lines.push('');
      for (const c of plan.successCriteria) {
        lines.push(`- ${c}`);
      }
      lines.push('');
    }
    if (plan.phases?.length) {
      lines.push('### 阶段');
      lines.push('');
      for (const phase of plan.phases) {
        const phaseProgress = planProgress?.phases?.find(p => String(p.phaseId) === String(phase.id ?? phase.phaseId));
        const progressStr = phaseProgress ? ` (${phaseProgress.done}/${phaseProgress.total})` : '';
        lines.push(`#### ${phase.title ?? `阶段 ${phase.id ?? ''}`}${progressStr}`);
        lines.push('');
        if (phase.items?.length) {
          for (const item of phase.items) {
            const check = item.status === 'completed' ? '[x]' : '[ ]';
            lines.push(`- ${check} **${item.title}** — ${item.brief ?? ''}`);
            if (item.acceptanceCriteria?.length) {
              for (const ac of item.acceptanceCriteria) {
                lines.push(`  - 验收标准: ${ac}`);
              }
            }
          }
          lines.push('');
        }
      }
    }
    if (plan.version) {
      lines.push(`> Plan 版本: v${plan.version}`);
      lines.push('');
    }
  }

  // Tasks
  if (tasks.length > 0) {
    lines.push('## 任务');
    lines.push('');
    for (const task of tasks) {
      lines.push(`### ${task.title}`);
      lines.push('');
      lines.push(`- **状态**: ${taskStatusLabel(task.status)}`);
      lines.push(`- **负责人**: ${agentName(task.assignedAgent, agents)}`);
      if (task.description) lines.push(`- **描述**: ${task.description}`);
      if (task.phase !== undefined) lines.push(`- **阶段**: ${task.phase}`);
      if (task.result) lines.push(`- **结果**: ${task.result}`);
      if (task.artifacts?.length) {
        lines.push('- **产物**:');
        for (const art of task.artifacts) {
          const loc = art.path || art.url || '-';
          lines.push(`  - ${art.name} — \`${loc}\``);
        }
      }
      lines.push('');
    }
  }

  // Agents
  lines.push('## 智能体');
  lines.push('');
  if (project.poAgent) {
    lines.push(`- **PO**: ${agentName(project.poAgent, agents)}`);
  }
  const memberIds = new Set((project as any).members || []);
  const workers = agents.filter(a => memberIds.has(a.id));
  if (workers.length) {
    for (const w of workers) {
      lines.push(`- **Worker**: ${w.name}`);
    }
  }
  lines.push('');

  // Activity log
  if (activities.length > 0) {
    lines.push('## 活动日志');
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
    lines.push('## 产物');
    lines.push('');
    for (const d of deliverables) {
      const loc = d.path || d.url || '-';
      lines.push(`- **${d.title}**${d.format ? ` (${d.format})` : ''} — \`${loc}\``);
    }
    lines.push('');
  }

  // Project deliverable summary
  const deliverable = (project as any).deliverable;
  if (deliverable && typeof deliverable === 'string') {
    lines.push('## 交付说明');
    lines.push('');
    lines.push(deliverable);
    lines.push('');
  }

  // Project summary (PO-generated)
  const summary = (project as any).summary;
  if (summary && typeof summary === 'string') {
    lines.push('## 项目小结');
    lines.push('');
    const score = (project as any).summaryScore;
    if (score != null) {
      lines.push(`**评分**: ${score}/10`);
      lines.push('');
    }
    lines.push(summary);
    lines.push('');
  }

  return lines.join('\n');
}
