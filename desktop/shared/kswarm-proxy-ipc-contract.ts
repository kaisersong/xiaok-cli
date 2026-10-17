import { z } from 'zod';
import { KSWARM_AGENT_FACT_SCHEMA, KSWARM_PROJECT_FACT_SCHEMA } from './kswarm-project-agent-ipc-contract.js';

/** JSON protocol/display facts; none is an execution permission or a token. */
export type ProxyFactData = string | number | boolean | null | undefined | ProxyFactData[]
  | { [key: string]: ProxyFactData };
export const PROXY_FACT_SCHEMA: z.ZodType<ProxyFactData> = z.lazy(() => z.union([
  z.string(), z.number().finite(), z.boolean(), z.null(), z.undefined(),
  z.array(PROXY_FACT_SCHEMA), z.record(z.string(), PROXY_FACT_SCHEMA),
]));
const facts = PROXY_FACT_SCHEMA, text = z.string(), number = z.number().finite();
const t = text.nullable().optional(), n = number.nullable().optional(), b = z.boolean().nullable().optional();
const strings = z.array(text).nullable().optional(), map = z.record(z.string(), facts).nullable().optional();
const rows = z.array(facts).nullable().optional();
const project = KSWARM_PROJECT_FACT_SCHEMA.partial().extend({
  taskCount: n, doneCount: n, stoppedCount: n, projectLifecycle: map,
  projectIntervention: map, latestWorkflowRun: map,
});
const agent = KSWARM_AGENT_FACT_SCHEMA.partial().extend({ brokerParticipantId: t, brokerOnline: b });
const task = z.object({ id: t, taskId: t, title: t, brief: t, status: t, assignedAgent: t,
  projectId: t, result: map, dependencies: strings }).catchall(facts);
const run = z.object({ id: t, runId: t, workflowId: t, projectId: t, source: t,
  status: t, nodes: rows, phases: rows, permissions: map }).catchall(facts);
const participant = z.object({ participantId: t, kind: t, roles: strings, capabilities: strings,
  alias: t, inboxMode: t, context: map, metadata: map }).catchall(facts);
const runtime = z.object({ type: t, bin: t, name: t, displayName: t, description: t,
  command: t, path: t, version: t, detected: b, supported: b, callability: t, reasonCode: t }).catchall(facts);
const model = z.object({ id: t, label: t, provider: t, default: b, name: t,
  description: t, contextWindow: n, maxOutputTokens: n }).catchall(facts);
const liveness = z.object({ agentId: t, lastSeen: n, online: b, status: t }).catchall(facts);
const definition = z.object({ key: t }).catchall(facts);
const knowledge = z.object({ id: t, packId: t, title: t, content: t, source: t,
  version: n, readOnly: b, rules: strings }).catchall(facts);
const rule = z.object({ id: t, name: t, title: t, description: t, type: t, severity: t,
  defaultSeverity: t, enabled: b, appliesTo: strings, promptExcerpt: map }).catchall(facts);
const overlay = rule.extend({ packId: t, source: t, scope: t, patchId: t, metadata: map, provenance: map });
const conflict = z.object({ id: t, type: t, ruleId: t, sources: strings, resolution: t,
  chosenSeverity: t, needsConfirmation: b }).catchall(facts);
const activity = z.object({ id: t, ts: t, seq: n, type: t, projectId: t, agentId: t,
  taskId: t, status: t }).catchall(facts);
const humanAction = z.object({ id: t, ts: t, seq: n, action: t, projectId: t,
  projectName: t, status: t }).catchall(facts);
const deliverable = z.object({ id: t, deliverableId: t, projectId: t, executionNodeId: t,
  taskId: t, workflowRunId: t, workflowNodeId: t, unboundReason: t, kind: t,
  expectedFormat: t, artifactRef: map, serviceComputedHash: t, clientClaimedHash: t,
  source: t, submittedBy: t, requiresReview: b, submissionIdempotencyKey: t,
  submissionFingerprint: t, status: t, submitted: map, approval: map, createdAt: t,
  updatedAt: t }).catchall(facts);
const reviewGateDecision = z.object({ id: t, gateId: t, projectId: t, finalDeliverableId: t,
  decision: t, status: t, autoCloseAllowed: b, decidedBy: map, evidenceRefs: rows,
  decidedAt: t, projectGateSnapshotRef: map, decidedAtProjectVersion: n,
  decidedAtManifestRevision: n }).catchall(facts);
const pack = z.object({ id: t, version: n, source: t,
  knowledgeDocuments: z.array(knowledge).nullable().optional(), rules: z.array(rule).nullable().optional() }).catchall(facts);
const binding = z.object({ id: t, channelType: t, bindingType: t }).catchall(facts);
const persona = z.object({ id: t, persona_key: t, display_name: t, description: t,
  scope: t, budgets: rows }).catchall(facts);
const identity = z.object({ id: t, channelType: t, channelName: t, boundAt: t }).catchall(facts);
const snapshot = z.object({ projectId: t, phase: t, counts: z.record(z.string(), number).nullable().optional(),
  conditionSummaries: z.array(z.object({ conditionId: t, severity: t, status: t, blocking: b }).catchall(facts)).optional(),
  artifacts: z.array(z.object({ artifactId: t, sha256: t }).catchall(facts)).optional(),
  userActions: z.array(z.object({ action: t, deliverableId: t }).catchall(facts)).optional() }).catchall(facts);
const ack = z.object({ ok: z.boolean().optional(), error: t, code: t, message: t, status: z.union([text, number]).optional(),
  project: project.optional(), task: task.optional(), tasks: z.array(task).optional(), taskIds: strings,
  workflowRun: run.optional(), workflowRuns: z.array(run).optional(), workflowProposal: run.optional(),
  dispatched: strings, workflowDispatched: rows, dispatches: rows, proposal: map, projectId: t,
  artifact: z.object({ filename: t, url: t, path: t, previewable: b, mimeType: t, sha256: t }).catchall(facts).optional(),
}).catchall(facts);
const detail = ack.extend({ projectLifecycle: map, executionGraph: map, activities: z.array(activity).nullable().optional(),
  humanActions: z.array(humanAction).nullable().optional(), workspace: map, plan: map, planProgress: map, dispatchPlan: map,
  projectHealth: map, projectIntervention: map, deliverables: z.array(deliverable).nullable().optional(), reviewGateDecisions: z.array(reviewGateDecision).nullable().optional() });
const nonObject = z.union([text, number, z.boolean(), z.null(), z.undefined()]);

/** The object branch cannot fall back to generic facts, including array elements. */
export function proxyRouteOutputIsValid(pathname: string, value: ProxyFactData, method = 'GET'): boolean {
  if (method === 'GET' && /^\/projects\/[^/]+\/artifacts\//.test(pathname)) return facts.safeParse(value).success;
  let object: z.ZodTypeAny = ack, row: z.ZodTypeAny = task;
  if (pathname === '/projects') { object = ack.extend({ projects: z.array(project).optional() }); row = project; }
  else if (/^\/projects\/[^/]+\/gate-snapshot$/.test(pathname)) { object = ack.extend({ snapshot: snapshot.optional() }); row = snapshot; }
  else if (/^\/projects\/[^/]+$/.test(pathname)) { object = detail; row = project; }
  else if (pathname === '/agents') { object = ack.extend({ agents: z.array(agent).optional() }); row = agent; }
  else if (pathname === '/agents/liveness') { object = ack.extend({ liveness: z.record(z.string(), liveness).optional() }); row = liveness; }
  else if (pathname === '/agents/capability-catalog') { object = ack.extend({ schemaVersion: n, catalogVersion: t, definitions: z.array(definition).optional() }); row = definition; }
  else if (pathname === '/participants') { object = ack.extend({ participants: z.array(participant).optional() }); row = participant; }
  else if (pathname === '/runtimes') { object = ack.extend({ runtimes: z.array(runtime).optional() }); row = runtime; }
  else if (pathname === '/llm/providers') { object = ack.extend({ providers: strings }); row = model; }
  else if (pathname === '/llm/models') { object = ack.extend({ provider: t, models: z.array(z.union([text, model])).optional() }); row = model; }
  else if (pathname.startsWith('/quality/')) { object = ack.extend({ knowledgeDocuments: z.array(knowledge).optional(), builtinPacks: z.array(pack).optional(),
    userOverlays: z.array(overlay).nullable().optional(), workspaceOverlays: z.array(overlay).nullable().optional(), conflicts: z.array(conflict).nullable().optional(), rules: z.array(rule).optional(), patch: map }); row = rule; }
  else if (/^\/channels\/[^/]+\/bindings/.test(pathname)) { object = ack.extend({ bindings: z.array(binding).optional(), id: t, channelType: t, bindingType: t }); row = binding; }
  else if (pathname === '/channel-personas') { object = ack.extend({ personas: z.array(persona).optional() }); row = persona; }
  else if (pathname.startsWith('/channel-identities')) { object = ack.extend({ identities: z.array(identity).optional(), id: t, channelType: t, channelName: t, boundAt: t }); row = identity; }
  else if (pathname === '/channel-bind-codes') { object = ack.extend({ token: t }); row = binding; }
  else if (/^\/channels\/[^/]+\/verify$/.test(pathname)) { object = ack.extend({ verified: b }); row = binding; }
  else if (/\/workflows\//.test(pathname)) row = run;
  const rowValid = (item: ProxyFactData): boolean => Array.isArray(item) ? item.every(rowValid)
    : item !== null && typeof item === 'object' ? row.safeParse(item).success : nonObject.safeParse(item).success;
  if (Array.isArray(value)) return value.every(rowValid);
  return value !== null && typeof value === 'object' ? object.safeParse(value).success : nonObject.safeParse(value).success;
}

export type ProxyWireInput = unknown[];
export const PROXY_HTTP_INPUT_SCHEMA = z.union([z.tuple([text]), z.tuple([text, facts])]);
export const PROXY_PATH_INPUT_SCHEMA = z.tuple([text]);
export const PROXY_EMPTY_INPUT_SCHEMA = z.tuple([]);
export const PROXY_STREAM_RESULT_SCHEMA = z.object({ ok: z.boolean(), code: text.optional() }).strict();
export const PROXY_STATUS_RESULT_SCHEMA = z.object({ status: z.enum(['connected', 'disconnected', 'reconnecting']), code: text.optional() }).strict();
export const PROXY_HEALTH_RESULT_SCHEMA = z.object({ ok: z.boolean() }).strict();
export type ProxyStreamResult = z.infer<typeof PROXY_STREAM_RESULT_SCHEMA>;
export type ProxyStatusResult = z.infer<typeof PROXY_STATUS_RESULT_SCHEMA>;
export type ProxyHealthResult = z.infer<typeof PROXY_HEALTH_RESULT_SCHEMA>;

export type ProxyJsonResult = z.infer<typeof PROXY_FACT_SCHEMA>;
export type ProxyTextResult = string | null;
export type ProxyDeleteResult = boolean;
export type ProxyHttpBody = ProxyFactData;
