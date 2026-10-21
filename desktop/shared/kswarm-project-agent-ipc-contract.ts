import { z } from 'zod';

/** Persisted presentation facts, never caller permission or execution authority. */
export type LegacyKSwarmFactData = string | number | boolean | null | undefined
  | LegacyKSwarmFactData[] | { [key: string]: LegacyKSwarmFactData };
const facts: z.ZodType<LegacyKSwarmFactData> = z.lazy(() => z.union([
  z.string(), z.number().finite(), z.boolean(), z.null(), z.undefined(),
  z.array(facts), z.record(z.string(), facts),
]));
const text = z.string(), number = z.number().finite();
const maybeText = text.nullable().optional(), maybeNumber = number.nullable().optional();
const factObject = z.record(z.string(), facts).nullable().optional();
const factArray = z.array(facts).nullable().optional();
const strings = z.array(text).nullable().optional();
const timestamp = z.union([text, number]).nullable().optional();

export const KSWARM_RUNTIME_HEALTH_SCHEMA = z.object({
  state: maybeText, checkedAt: maybeNumber, lastProbeAt: maybeNumber,
  lastProbeOk: z.boolean().nullable().optional(), lastSuccessAt: maybeNumber, lastFailureAt: maybeNumber,
  lastFailureClass: maybeText, lastError: maybeText, consecutiveRuntimeFailures: maybeNumber,
  consecutiveTaskFailures: maybeNumber, cooldownUntil: maybeNumber, childPid: maybeNumber,
  activeRunId: maybeText, activeTaskId: maybeText, startedAt: maybeNumber, lastStdoutAt: maybeNumber,
  lastStderrAt: maybeNumber, lastArtifactAt: maybeNumber, outputCapabilities: strings,
  taskCapabilities: strings, probe: factObject,
}).catchall(facts);
export const KSWARM_AGENT_FACT_SCHEMA = z.object({
  id: text, name: text, description: maybeText, instructions: maybeText, provider: maybeText,
  model: maybeText, customArgs: strings, capabilities: strings, roles: strings,
  maxConcurrentTasks: maybeNumber, fallbackToDesktopModel: z.boolean().nullable().optional(),
  status: maybeText, runtimeId: maybeText, runtimeMode: maybeText,
  runtimeHealth: KSWARM_RUNTIME_HEALTH_SCHEMA.nullable().optional(), createdAt: timestamp,
  archivedAt: timestamp, archivedBy: maybeText, runtimeType: maybeText, runtimeSource: maybeText,
  taskCapabilities: strings, outputCapabilities: strings, desktopModelId: maybeText,
  provisioning: factObject, currentTask: maybeText,
}).catchall(facts);
export const KSWARM_PROJECT_FACT_SCHEMA = z.object({
  id: text, name: text, goal: maybeText, requirements: maybeText, planningGuidance: maybeText,
  qualityRuleSet: factObject, qualityPlanningGuidance: maybeText, agentSelection: factObject,
  preparation: factObject, poAgent: maybeText, members: strings, executionMode: maybeText,
  executionModeUpdatedAt: timestamp, executionModeUpdatedBy: maybeText, requestedStartPolicy: maybeText,
  status: maybeText, createdAt: timestamp, closedAt: timestamp, closedBy: maybeText,
  deliverable: factObject, plan: factObject, planArtifact: maybeText,
  enableSummary: z.boolean().nullable().optional(), summary: maybeText, summaryScore: maybeNumber,
  lifecycleVersion: maybeNumber, projectRevision: maybeNumber, teamPlan: factObject, primaryRoomId: maybeText,
  dependencyPolicies: factObject, gateEvaluations: factObject, canonicalArtifacts: factObject,
  manifestRevision: maybeNumber, requestedOutput: factObject, executionGateSchemaVersion: maybeNumber,
  activityDataEpoch: maybeText, activityEventSeq: maybeNumber, activityEventOutbox: factArray,
  activitySnapshot: factObject, committedActivitySeq: maybeNumber, updatedAt: timestamp,
  requiredProtocol: maybeText, workspaceMapping: factObject, workspaceMappingOperations: factObject,
  workFolder: maybeText, artifactsDir: maybeText, workspaceResultOperations: factObject,
  roomEventSeq: maybeNumber, roomEventOutbox: factArray, roomLink: factObject,
  roomOutboxRetryOperations: factObject, clientRequestKey: maybeText, autoStartTransactions: factArray,
  startPolicyDecision: factObject, closeSummary: maybeText, riskProfile: factObject,
  planRevisionRequired: factObject, deliveredAt: timestamp, artifactEvidenceExtensions: factObject,
}).catchall(facts);
export const KSWARM_PROJECT_MODE_RESULT_SCHEMA = z.object({ ok: z.literal(true), project: KSWARM_PROJECT_FACT_SCHEMA }).strict();
export const KSWARM_PROJECT_DELETE_RESULT_SCHEMA = z.object({ ok: z.literal(true) }).strict();
export const KSWARM_PROBE_FACT_SCHEMA = z.object({
  agentId: text.nullable(), runtimeType: text.nullable(), healthy: z.boolean(),
  callability: z.enum(['available', 'limited', 'unavailable']), durationMs: number,
  runtimePath: maybeText, probe: maybeText, version: maybeText, error: maybeText, message: maybeText,
  runtimeHealth: KSWARM_RUNTIME_HEALTH_SCHEMA.nullable().optional(),
}).catchall(facts);

const projectInput = z.object({
  name: text, goal: text, requirements: text.optional(), planningGuidance: text.optional(), poAgent: text,
  members: z.array(text).optional(), workFolder: text.optional(), enableSummary: z.boolean().optional(),
  agentSelection: z.object({ poAgent: z.object({ agentId: text, source: text }).strict(),
    members: z.array(z.object({ agentId: text, source: text }).strict()) }).strict().optional(),
  executionMode: z.enum(['direct','auto','workflow_preferred']).optional(),
  startPolicy: z.enum(['plan_only','auto_activate_after_plan','activate_and_dispatch_after_plan']).optional(),
  requestedStartPolicy: z.enum(['plan_only','auto_activate_after_plan','activate_and_dispatch_after_plan']).optional(),
  autoStartPlanning: z.boolean().optional(), clientRequestKey: text.optional(),
}).strict();
const agentInput = z.object({
  name: text, description: text.optional(), instructions: text.optional(), roles: z.array(text).optional(),
  capabilities: z.array(text).optional(), taskCapabilities: z.array(text).optional(), runtimeType: text.optional(),
  customArgs: z.array(text).optional(), fallbackToDesktopModel: z.boolean().optional(),
  desktopModelId: text.nullable().optional(), maxConcurrentTasks: number.optional(),
}).strict();
const projectId = z.tuple([z.object({ projectId: text }).strict()]);
const agentId = z.tuple([z.object({ agentId: text }).strict()]);
export const KSWARM_ENTITY_INPUT_SCHEMAS = Object.freeze({
  projectCreate: z.tuple([projectInput]),
  projectMode: z.tuple([z.object({ projectId: text, executionMode: z.enum(['direct', 'auto', 'workflow_preferred']) }).strict()]),
  projectDelete: projectId, agentCreate: z.tuple([agentInput]),
  agentUpdate: z.tuple([z.object({ agentId: text, patch: agentInput.partial() }).strict()]),
  agentArchive: agentId, agentStart: agentId, agentStop: agentId, agentProbe: agentId,
});
export const KSWARM_ENTITY_OUTPUT_SCHEMAS = Object.freeze({
  projectCreate: KSWARM_PROJECT_FACT_SCHEMA, projectMode: KSWARM_PROJECT_MODE_RESULT_SCHEMA,
  projectDelete: KSWARM_PROJECT_DELETE_RESULT_SCHEMA, agentCreate: KSWARM_AGENT_FACT_SCHEMA,
  agentUpdate: KSWARM_AGENT_FACT_SCHEMA, agentArchive: z.boolean(), agentStart: z.boolean(), agentStop: z.boolean(),
  agentProbe: KSWARM_PROBE_FACT_SCHEMA,
});
export type KSwarmProjectFactDto = z.infer<typeof KSWARM_PROJECT_FACT_SCHEMA>;
export type KSwarmAgentFactDto = z.infer<typeof KSWARM_AGENT_FACT_SCHEMA>;
export type KSwarmProbeFactDto = z.infer<typeof KSWARM_PROBE_FACT_SCHEMA>;
export type KSwarmProjectModeResultDto = z.infer<typeof KSWARM_PROJECT_MODE_RESULT_SCHEMA>;
export type KSwarmProjectDeleteResultDto = z.infer<typeof KSWARM_PROJECT_DELETE_RESULT_SCHEMA>;
export type KSwarmProjectCreateDto = z.infer<typeof projectInput>;
export type KSwarmAgentCreateDto = z.infer<typeof agentInput>;
