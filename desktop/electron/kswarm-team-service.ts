import type { KSwarmService } from './kswarm-service.js';

export interface ProjectCapabilityNeed {
  needKey: string;
  requiredCapabilities: string[];
  responsibilities: string[];
  requiresIndependentReviewer: boolean;
}

export interface KSwarmCapabilityCatalog {
  schemaVersion: 1;
  catalogVersion: string;
  definitions: Array<{ key: string; [key: string]: unknown }>;
}

export interface ProjectCapabilityNeedsProposalPort {
  propose(input: {
    project: Record<string, unknown>;
    agents: Array<Record<string, unknown>>;
    catalog: KSwarmCapabilityCatalog;
    tools: readonly [];
  }): Promise<{ needs: ProjectCapabilityNeed[] }>;
}

export interface KSwarmTeamService {
  planProjectTeam(input: { projectId: string }): Promise<unknown>;
  reconcileProjectTeam(input: {
    projectId: string;
    planDigest: string;
    expectedProjectRevision: number;
    clientRequestKey: string;
  }): Promise<unknown>;
  recoverProjectTeamOperation(input: {
    projectId: string;
    operationId: string;
  }): Promise<unknown>;
  getLatestProjectTeamOperation(input: { projectId: string }): Promise<unknown>;
}

type TeamServiceGateway = Pick<KSwarmService, 'request' | 'getDesktopMutationToken'>;

export function createKSwarmTeamService(options: {
  kswarmService: TeamServiceGateway;
  needsProposal: ProjectCapabilityNeedsProposalPort;
}): KSwarmTeamService {
  const { kswarmService, needsProposal } = options;

  async function requestJson(path: string, init?: RequestInit): Promise<unknown> {
    const response = await kswarmService.request(path, init);
    const text = await response.text();
    const data = text ? parseJson(text) : null;
    if (!response.ok) {
      const errorCode = isRecord(data) && typeof data.error === 'string'
        ? data.error
        : `http_${response.status}`;
      throw new Error(errorCode);
    }
    return data;
  }

  async function requestMutation(path: string, body: Record<string, unknown>): Promise<unknown> {
    return requestJson(path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-kswarm-mutation-token': kswarmService.getDesktopMutationToken(),
      },
      body: JSON.stringify(body),
    });
  }

  async function planProjectTeam(input: { projectId: string }): Promise<unknown> {
    const projectId = encodePathSegment(input.projectId);
    const [catalogData, projectData, agentsData] = await Promise.all([
      requestJson('/agents/capability-catalog', { method: 'GET' }),
      requestJson(`/projects/${projectId}`, { method: 'GET' }),
      requestJson('/agents', { method: 'GET' }),
    ]);
    const catalog = readCatalog(catalogData);
    const project = readProject(projectData);
    const agents = readAgents(agentsData);
    const proposal = await needsProposal.propose({ project, agents, catalog, tools: [] });
    const needs = validateCapabilityNeeds(proposal?.needs, catalog);
    const expectedProjectRevision = Number(project.projectRevision);
    if (!Number.isSafeInteger(expectedProjectRevision) || expectedProjectRevision < 0) {
      throw new Error('invalid_project_revision');
    }

    return requestMutation(`/projects/${projectId}/team/plan`, {
      requestSource: 'user',
      expectedProjectRevision,
      catalogVersion: catalog.catalogVersion,
      needs,
    });
  }

  async function reconcileProjectTeam(input: {
    projectId: string;
    planDigest: string;
    expectedProjectRevision: number;
    clientRequestKey: string;
  }): Promise<unknown> {
    if (!input.planDigest.trim() || !input.clientRequestKey.trim()) {
      throw new Error('invalid_reconcile_request');
    }
    if (!Number.isSafeInteger(input.expectedProjectRevision) || input.expectedProjectRevision < 0) {
      throw new Error('invalid_project_revision');
    }
    return requestMutation(`/projects/${encodePathSegment(input.projectId)}/team/reconcile`, {
      requestSource: 'user',
      planDigest: input.planDigest,
      expectedProjectRevision: input.expectedProjectRevision,
      clientRequestKey: input.clientRequestKey,
    });
  }

  async function recoverProjectTeamOperation(input: {
    projectId: string;
    operationId: string;
  }): Promise<unknown> {
    const projectId = encodePathSegment(input.projectId);
    const operationId = encodePathSegment(input.operationId);
    const snapshot = await requestJson(
      `/projects/${projectId}/team/operations/${operationId}`,
      { method: 'GET' },
    );
    const operation = isRecord(snapshot) && isRecord(snapshot.operation)
      ? snapshot.operation
      : null;
    if (!operation) throw new Error('invalid_team_operation');
    if (operation.status === 'applied') return snapshot;

    const planDigest = typeof operation.planDigest === 'string' ? operation.planDigest : '';
    const clientRequestKey = typeof operation.clientRequestKey === 'string' ? operation.clientRequestKey : '';
    const expectedProjectRevision = Number(operation.expectedProjectRevision);
    if (!planDigest || !clientRequestKey || !Number.isSafeInteger(expectedProjectRevision)) {
      throw new Error('invalid_team_operation');
    }
    return reconcileProjectTeam({
      projectId: input.projectId,
      planDigest,
      expectedProjectRevision,
      clientRequestKey,
    });
  }

  async function getLatestProjectTeamOperation(input: { projectId: string }): Promise<unknown> {
    return requestJson(
      `/projects/${encodePathSegment(input.projectId)}/team/operations/latest`,
      { method: 'GET' },
    );
  }

  return { planProjectTeam, reconcileProjectTeam, recoverProjectTeamOperation, getLatestProjectTeamOperation };
}

function validateCapabilityNeeds(
  value: unknown,
  catalog: KSwarmCapabilityCatalog,
): ProjectCapabilityNeed[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 6) {
    throw new Error('invalid_capability_needs');
  }
  const knownCapabilities = new Set(catalog.definitions.map((definition) => definition.key));
  const needKeys = new Set<string>();

  return value.map((candidate) => {
    if (!isRecord(candidate)) throw new Error('invalid_capability_needs');
    const needKey = typeof candidate.needKey === 'string' ? candidate.needKey.trim() : '';
    const requiredCapabilities = readStringArray(candidate.requiredCapabilities);
    const responsibilities = readStringArray(candidate.responsibilities);
    if (!needKey || needKeys.has(needKey) || requiredCapabilities.length === 0) {
      throw new Error('invalid_capability_needs');
    }
    if (requiredCapabilities.some((capability) => !knownCapabilities.has(capability))) {
      throw new Error('invalid_capability_needs');
    }
    needKeys.add(needKey);
    return {
      needKey,
      requiredCapabilities,
      responsibilities,
      requiresIndependentReviewer: candidate.requiresIndependentReviewer === true,
    };
  });
}

function readCatalog(value: unknown): KSwarmCapabilityCatalog {
  const candidate = isRecord(value) && isRecord(value.catalog) ? value.catalog : value;
  if (!isRecord(candidate)
    || candidate.schemaVersion !== 1
    || typeof candidate.catalogVersion !== 'string'
    || !Array.isArray(candidate.definitions)) {
    throw new Error('invalid_capability_catalog');
  }
  const definitions = candidate.definitions.filter(isRecord).map((definition) => ({
    ...definition,
    key: typeof definition.key === 'string' ? definition.key : '',
  }));
  if (definitions.some((definition) => !definition.key)) throw new Error('invalid_capability_catalog');
  return {
    schemaVersion: 1,
    catalogVersion: candidate.catalogVersion,
    definitions,
  };
}

function readProject(value: unknown): Record<string, unknown> {
  const project = isRecord(value) && isRecord(value.project) ? value.project : value;
  if (!isRecord(project) || typeof project.id !== 'string') throw new Error('invalid_project_snapshot');
  return project;
}

function readAgents(value: unknown): Array<Record<string, unknown>> {
  if (!isRecord(value) || !Array.isArray(value.agents)) throw new Error('invalid_agent_snapshot');
  return value.agents.filter(isRecord);
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) throw new Error('invalid_capability_needs');
  const strings = value.map((item) => typeof item === 'string' ? item.trim() : '');
  if (strings.some((item) => !item) || new Set(strings).size !== strings.length) {
    throw new Error('invalid_capability_needs');
  }
  return strings;
}

function encodePathSegment(value: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error('invalid_path_segment');
  return encodeURIComponent(normalized);
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('invalid_kswarm_json');
  }
}

function isRecord(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
