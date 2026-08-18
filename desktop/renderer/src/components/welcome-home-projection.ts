import type { AutomationOverviewSnapshotView, AutomationRecentFailureItemView } from '../api/types';
import type { KSwarmProject } from '../hooks/useKSwarmClient';
import type { AssistantHomeSnapshot } from './assistant/view-types';

const ACTIVE_PROJECT_STATUSES = new Set<KSwarmProject['status']>(['planning', 'created', 'active', 'review']);
const COMPLETED_PROJECT_STATUSES = new Set<KSwarmProject['status']>(['delivered', 'closed']);

export type WelcomeAttentionItem =
  | { kind: 'project'; id: string; title: string; reason?: string; nextStep?: string }
  | { kind: 'automation'; id: string; title: string; reason?: string; failure: AutomationRecentFailureItemView };

export interface WelcomeHomeProjection {
  counts: {
    activeProjects: number;
    attention: number;
    activeAutomations: number;
    completedProjects: number;
  };
  attentionItems: WelcomeAttentionItem[];
}

export function buildAssistantHomeProjection(snapshot: AssistantHomeSnapshot): AssistantHomeSnapshot {
  return {
    ...snapshot,
    suggestions: snapshot.suggestions.slice(0, 3),
  };
}

export function buildWelcomeHomeProjection(
  projects: KSwarmProject[],
  automation: AutomationOverviewSnapshotView | null,
): WelcomeHomeProjection {
  const activeProjects = projects.filter(project => ACTIVE_PROJECT_STATUSES.has(project.status));
  const failuresByOwner = new Map<string, AutomationRecentFailureItemView>();
  for (const failure of [...(automation?.recentFailures ?? [])].sort((left, right) => right.occurredAt - left.occurredAt)) {
    const ownerKey = `${failure.source}:${failure.ownerId}`;
    if (!failuresByOwner.has(ownerKey)) failuresByOwner.set(ownerKey, failure);
  }
  const projectAttention: WelcomeAttentionItem[] = activeProjects
    .filter(project => project.projectIntervention?.required)
    .map(project => ({
      kind: 'project',
      id: project.id,
      title: project.name,
      reason: project.projectIntervention?.message || project.projectIntervention?.reason,
      nextStep: project.projectIntervention?.primaryAction?.label,
    }));
  const automationAttention: WelcomeAttentionItem[] = [...failuresByOwner.values()].map(failure => ({
    kind: 'automation',
    id: failure.id,
    title: failure.title,
    reason: failure.message,
    failure,
  }));

  return {
    counts: {
      activeProjects: activeProjects.length,
      attention: projectAttention.length + automationAttention.length,
      activeAutomations: automation?.totals.activeSchedules ?? 0,
      completedProjects: projects.filter(project => COMPLETED_PROJECT_STATUSES.has(project.status)).length,
    },
    attentionItems: [...projectAttention, ...automationAttention],
  };
}

export function automationFailureRoute(failure: AutomationRecentFailureItemView): string {
  if (failure.source === 'loop_run') {
    if (failure.loopOrigin === 'built_in') return '/automations/diagnostics';
    return failure.loopId ? `/automations/loops#loop-${failure.loopId}` : '/automations/loops';
  }
  if (failure.actionAvailableInSchedules === false) return '/automations';
  return failure.actionId ? `/automations/schedules#task-${failure.actionId}` : '/automations/schedules';
}
