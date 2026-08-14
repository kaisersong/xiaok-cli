import type { LoopLLMPort } from './loop-llm-port.js';
import type { KSwarmService } from './kswarm-service.js';
import type {
  KSwarmTeamService,
  ProjectCapabilityNeedsProposalPort,
} from './kswarm-team-service.js';

type Gateway = Pick<KSwarmService, 'request' | 'getDesktopMutationToken'>;

export interface KSwarmSemanticService {
  planProjectTeam(input: { projectId: string }): Promise<unknown>;
  applyProjectTeamPlan(input: { projectId: string; planId: string; projectRevision: number }): Promise<unknown>;
  getProjectTeamOperation(input: { projectId: string }): Promise<unknown>;
  createKSwarmProject(input: Record<string, unknown>): Promise<unknown>;
  updateKSwarmProjectExecutionMode(input: { projectId: string; executionMode: 'direct' | 'auto' | 'workflow_preferred' }): Promise<unknown>;
  deleteKSwarmProject(input: { projectId: string }): Promise<unknown>;
  createKSwarmAgent(input: Record<string, unknown>): Promise<unknown>;
  updateKSwarmAgent(input: { id: string; changes: Record<string, unknown> }): Promise<unknown>;
  archiveKSwarmAgent(input: { id: string }): Promise<boolean>;
  startKSwarmAgent(input: { id: string }): Promise<boolean>;
  stopKSwarmAgent(input: { id: string }): Promise<boolean>;
  probeKSwarmAgent(input: { id: string }): Promise<unknown>;
}

export function createProjectCapabilityNeedsProposalPort(
  llmPort: Pick<LoopLLMPort, 'complete'>,
): ProjectCapabilityNeedsProposalPort {
  return {
    async propose(input) {
      const response = await llmPort.complete({
        model: 'fast',
        systemPrompt: 'Analyze the project and return JSON only: {"needs":[{"needKey":"...","requiredCapabilities":["..."],"responsibilities":["..."],"requiresIndependentReviewer":false}]}. Use only capability keys from the provided catalog. Do not call tools.',
        userMessage: JSON.stringify({ project: input.project, agents: input.agents, catalog: input.catalog }),
        maxTokens: 1200,
        temperature: 0,
      });
      try {
        const parsed = JSON.parse(response.text) as unknown;
        if (!isRecord(parsed) || !Array.isArray(parsed.needs)) throw new Error();
        return parsed as Awaited<ReturnType<ProjectCapabilityNeedsProposalPort['propose']>>;
      } catch {
        throw new Error('invalid_capability_proposal');
      }
    },
  };
}

export function createKSwarmSemanticService(options: {
  kswarmService: Gateway;
  teamService: KSwarmTeamService;
}): KSwarmSemanticService {
  const { kswarmService, teamService } = options;

  const request = async (path: string, method: string, body?: unknown): Promise<unknown> => {
    const response = await kswarmService.request(path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'x-kswarm-mutation-token': kswarmService.getDesktopMutationToken(),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    const data = text ? JSON.parse(text) as unknown : null;
    if (!response.ok) throw new Error(readError(data, response.status));
    return data;
  };

  return {
    async planProjectTeam(input) {
      const result = await teamService.planProjectTeam(input);
      const plan = readEnvelopeRecord(result, 'plan');
      return mapTeamPlan(plan);
    },
    async applyProjectTeamPlan(input) {
      const result = await teamService.reconcileProjectTeam({
        projectId: input.projectId,
        planDigest: input.planId,
        expectedProjectRevision: input.projectRevision,
        clientRequestKey: `desktop-team:${input.projectId}:${input.planId}`,
      });
      return mapTeamOperation(readEnvelopeRecord(result, 'operation'));
    },
    async getProjectTeamOperation(input) {
      const latest = await teamService.getLatestProjectTeamOperation(input);
      const operation = isRecord(latest) && isRecord(latest.operation) ? latest.operation : null;
      if (!operation) return null;
      const recovered = await teamService.recoverProjectTeamOperation({
        projectId: input.projectId,
        operationId: String(operation.id),
      });
      return mapTeamOperation(readEnvelopeRecord(recovered, 'operation'));
    },
    async createKSwarmProject(input) {
      const payload = pickProjectPayload(input);
      return unwrapRecord(await request('/projects', 'POST', payload), 'project');
    },
    async updateKSwarmProjectExecutionMode(input) {
      return request(`/projects/${encodeSegment(input.projectId)}/execution-mode`, 'PATCH', {
        executionMode: input.executionMode,
        updatedBy: 'human',
      });
    },
    async deleteKSwarmProject(input) {
      return request(`/projects/${encodeSegment(input.projectId)}`, 'DELETE');
    },
    async createKSwarmAgent(input) {
      assertAgentPayload(input);
      const payload = {
        ...pickAgentPayload(input),
        runtimeType: 'xiaok',
        runtimeSource: 'desktop-agent-runtime',
        roles: readStringArray(input.roles, ['worker']),
        capabilities: readStringArray(input.capabilities),
        taskCapabilities: readStringArray(input.taskCapabilities),
      };
      return unwrapRecord(await request('/agents', 'POST', payload), 'agent');
    },
    async updateKSwarmAgent(input) {
      assertAgentPayload(input.changes);
      return unwrapRecord(await request(`/agents/${encodeSegment(input.id)}`, 'PUT', pickAgentPayload(input.changes)), 'agent');
    },
    async archiveKSwarmAgent(input) {
      await request(`/agents/${encodeSegment(input.id)}`, 'DELETE');
      return true;
    },
    async startKSwarmAgent(input) {
      await request(`/agents/${encodeSegment(input.id)}/start`, 'POST', {});
      return true;
    },
    async stopKSwarmAgent(input) {
      await request(`/agents/${encodeSegment(input.id)}/stop`, 'POST', {});
      return true;
    },
    async probeKSwarmAgent(input) {
      return request(`/agents/${encodeSegment(input.id)}/probe`, 'GET');
    },
  };
}

function mapTeamPlan(plan: Record<string, unknown>): Record<string, unknown> {
  const roles = Array.isArray(plan.roles) ? plan.roles.filter(isRecord) : [];
  return {
    planId: String(plan.planDigest ?? ''),
    projectId: String(plan.projectId ?? ''),
    projectRevision: Number(plan.projectRevision),
    outcome: plan.outcome,
    summary: roles.length === 0 ? 'No team changes are needed.' : `${roles.length} team role(s) analyzed.`,
    items: roles.map(role => ({
      desiredAgentId: String(role.preferredExistingAgentId ?? `${plan.planDigest}:${role.roleKey}`),
      action: role.decision === 'reuse' ? 'reuse' : 'create',
      role: String(role.roleKey ?? ''),
      capabilityLabels: readStringArray(role.requiredCapabilities),
      reasonCode: String(role.reasonCode ?? 'policy_decision'),
    })),
  };
}

function mapTeamOperation(operation: Record<string, unknown>): Record<string, unknown> {
  const status = operation.status === 'applied'
    ? 'completed'
    : operation.status === 'failed'
      ? 'failed'
      : operation.status === 'applying'
        ? 'running'
        : 'pending';
  return {
    operationId: String(operation.id ?? ''),
    status,
    ...(operation.errorCode ? { message: String(operation.errorCode) } : {}),
  };
}

function pickProjectPayload(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(['name', 'goal', 'requirements', 'planningGuidance', 'poAgent', 'members', 'workFolder', 'enableSummary', 'agentSelection', 'executionMode', 'startPolicy', 'requestedStartPolicy', 'autoStartPlanning', 'clientRequestKey']
    .flatMap(key => input[key] === undefined ? [] : [[key, input[key]]]));
}

function pickAgentPayload(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(['name', 'description', 'instructions', 'roles', 'capabilities', 'taskCapabilities', 'customArgs']
    .flatMap(key => input[key] === undefined ? [] : [[key, input[key]]]));
}

function assertAgentPayload(input: Record<string, unknown>): void {
  const forbidden = ['apiKey', 'baseUrl', 'provider', 'model', 'customEnv', 'runtimePath', 'execution', 'credential', 'secret'];
  if (forbidden.some(key => key in input)) throw new Error('agent_payload_forbidden');
}

function readStringArray(value: unknown, fallback: string[] = []): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : fallback;
}

function readEnvelopeRecord(value: unknown, key: string): Record<string, unknown> {
  if (!isRecord(value) || !isRecord(value[key])) throw new Error(`invalid_${key}`);
  return value[key];
}

function unwrapRecord(value: unknown, key: string): Record<string, unknown> {
  return readEnvelopeRecord(value, key);
}

function readError(value: unknown, status: number): string {
  return isRecord(value) && typeof value.error === 'string' ? value.error : `http_${status}`;
}

function encodeSegment(value: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error('invalid_path_segment');
  return encodeURIComponent(normalized);
}

function isRecord(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
