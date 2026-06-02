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
  if (agentId && !list.includes(agentId)) {
    list.push(agentId);
  }
}

function readAgentId(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

export function extractCreatedAgentId(response: unknown): string {
  if (!response || typeof response !== 'object' || Array.isArray(response)) return '';
  const record = response as Record<string, unknown>;
  const topLevelId = readAgentId(record.id);
  if (topLevelId) return topLevelId;
  const agent = record.agent;
  if (!agent || typeof agent !== 'object' || Array.isArray(agent)) return '';
  return readAgentId((agent as Record<string, unknown>).id);
}

export function sanitizeCreateProjectMembers(members: unknown[], poAgent?: string): string[] {
  const po = readAgentId(poAgent);
  const resolved: string[] = [];
  for (const member of Array.isArray(members) ? members : []) {
    const agentId = readAgentId(member);
    if (!agentId || agentId === po) continue;
    uniquePush(resolved, agentId);
  }
  return resolved;
}

export function resolveCreateProjectMembers(
  input: ResolveCreateProjectMembersInput,
): ResolveCreateProjectMembersResult {
  const { agents, poAgent, memberNames, memberCount } = input;
  const workers = agents.filter((agent) => agent.id !== poAgent);
  const resolved: string[] = [];

  if (memberNames.length === 0) {
    const defaultWorkerId = getPreferredWorkerSeedId(agents, poAgent);
    if (defaultWorkerId) {
      uniquePush(resolved, defaultWorkerId);
    } else if (memberCount <= 0) {
      for (const agent of workers.filter((item) => item.status !== 'offline')) {
        uniquePush(resolved, agent.id);
      }
    } else {
      const remainingOnline = workers.filter((agent) => agent.status !== 'offline' && !resolved.includes(agent.id));
      const remainingOffline = workers.filter((agent) => agent.status === 'offline' && !resolved.includes(agent.id));
      const ordered = [...remainingOnline, ...remainingOffline];
      for (const agent of ordered.slice(0, memberCount)) {
        uniquePush(resolved, agent.id);
      }
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
