import { getPreferredWorkerSeedId, type KSwarmAgentLike } from '../shared/kswarm-seed-contract.js';

export interface CreateProjectAgentLike extends KSwarmAgentLike {
  status?: string;
}

export interface ResolveCreateProjectMembersInput {
  agents: CreateProjectAgentLike[];
  poAgent: string;
  memberNames: string[];
  memberCount: number;
}

export interface ResolveCreateProjectMembersResult {
  members: string[];
  totalAgentCount: number;
}

function uniquePush(list: string[], agentId: string): void {
  if (!list.includes(agentId)) {
    list.push(agentId);
  }
}

export function resolveCreateProjectMembers(
  input: ResolveCreateProjectMembersInput,
): ResolveCreateProjectMembersResult {
  const { agents, poAgent, memberNames, memberCount } = input;
  const workers = agents.filter((agent) => agent.id !== poAgent);
  const resolved: string[] = [];

  if (memberNames.length === 0 && memberCount <= 0) {
    const defaultWorkerId = getPreferredWorkerSeedId(agents, poAgent);
    if (defaultWorkerId) {
      uniquePush(resolved, defaultWorkerId);
    }
    return {
      members: resolved,
      totalAgentCount: 1 + resolved.length,
    };
  }

  for (const name of memberNames) {
    const match = workers.find((agent) => agent.name === name || agent.id === name);
    if (match) {
      uniquePush(resolved, match.id);
    }
  }

  if (memberCount > 0) {
    const remainingOnline = workers.filter((agent) => agent.status !== 'offline' && !resolved.includes(agent.id));
    const remainingOffline = workers.filter((agent) => agent.status === 'offline' && !resolved.includes(agent.id));
    const ordered = [...remainingOnline, ...remainingOffline];
    const needed = Math.max(0, memberCount - resolved.length);
    for (const agent of ordered.slice(0, needed)) {
      uniquePush(resolved, agent.id);
    }
  }

  return {
    members: resolved,
    totalAgentCount: 1 + resolved.length,
  };
}
