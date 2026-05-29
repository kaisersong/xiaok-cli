export interface KSwarmAgentLike {
  id: string;
  name?: string;
  runtimeType?: string;
  roles?: string[];
  archivedAt?: number | null;
  status?: string;
}

export interface KSwarmCreateAgentInput {
  id: string;
  name: string;
  description: string;
  instructions: string;
  runtimeType: 'xiaok';
  roles: string[];
  capabilities: string[];
}

export interface SeedAgentReconciliationPlan {
  create: KSwarmCreateAgentInput[];
  archive: string[];
}

const SHARED_CAPABILITIES = ['coding', 'testing', 'design', 'planning'];

export const XIAOK_PO_SEED_ID = 'xiaok-po';
export const XIAOK_WORKER_SEED_ID = 'xiaok-worker';
const XIAOK_LEGACY_SEED_ID = 'xiaok';

export function createXiaokPoSeed(): KSwarmCreateAgentInput {
  return {
    id: XIAOK_PO_SEED_ID,
    name: 'PO-Agent',
    description: 'xiaok 项目负责人种子智能体',
    instructions: '你是 xiaok 项目负责人（PO）种子智能体，负责规划、拆解、派发、审核和交付把关。',
    runtimeType: 'xiaok',
    roles: ['project_owner'],
    capabilities: SHARED_CAPABILITIES,
  };
}

export function createXiaokWorkerSeed(): KSwarmCreateAgentInput {
  return {
    id: XIAOK_WORKER_SEED_ID,
    name: 'Worker-Agent',
    description: 'xiaok 执行者种子智能体',
    instructions: '你是 xiaok 执行者种子智能体，负责执行已分配任务并提交结果。',
    runtimeType: 'xiaok',
    roles: ['worker'],
    capabilities: SHARED_CAPABILITIES,
  };
}

function isArchived(agent: KSwarmAgentLike): boolean {
  return agent.archivedAt != null;
}

function hasRole(agent: KSwarmAgentLike, role: string): boolean {
  return agent.roles?.includes(role) ?? false;
}

function isDedicatedPoSeed(agent: KSwarmAgentLike): boolean {
  return !isArchived(agent) && agent.id === XIAOK_PO_SEED_ID;
}

function isDedicatedWorkerSeed(agent: KSwarmAgentLike): boolean {
  return !isArchived(agent) && agent.id === XIAOK_WORKER_SEED_ID;
}

function isLegacyFullRoleXiaokSeed(agent: KSwarmAgentLike): boolean {
  return (
    !isArchived(agent) &&
    agent.id === XIAOK_LEGACY_SEED_ID &&
    agent.runtimeType === 'xiaok' &&
    hasRole(agent, 'project_owner') &&
    hasRole(agent, 'worker')
  );
}

export function buildSeedAgentReconciliationPlan(agents: KSwarmAgentLike[]): SeedAgentReconciliationPlan {
  const hasPoSeed = agents.some(isDedicatedPoSeed);
  const hasWorkerSeed = agents.some(isDedicatedWorkerSeed);
  const legacy = agents.find(isLegacyFullRoleXiaokSeed);

  const create: KSwarmCreateAgentInput[] = [];
  if (!hasPoSeed) create.push(createXiaokPoSeed());
  if (!hasWorkerSeed) create.push(createXiaokWorkerSeed());

  const archive = legacy && create.length > 0 ? [legacy.id] : [];
  return { create, archive };
}

export function getPreferredPoAgentId(agents: KSwarmAgentLike[]): string | null {
  const active = agents.filter((agent) => !isArchived(agent));
  return (
    active.find((agent) => agent.id === XIAOK_PO_SEED_ID)?.id ??
    active.find((agent) => agent.id === XIAOK_LEGACY_SEED_ID)?.id ??
    active.find((agent) => agent.id === 'cli-xiaok')?.id ??
    active.find((agent) => hasRole(agent, 'project_owner'))?.id ??
    active[0]?.id ??
    null
  );
}

export function getPreferredWorkerSeedId(agents: KSwarmAgentLike[], poAgentId?: string | null): string | null {
  const worker = agents.find((agent) => !isArchived(agent) && agent.id === XIAOK_WORKER_SEED_ID);
  if (!worker || worker.id === poAgentId) return null;
  return worker.id;
}
