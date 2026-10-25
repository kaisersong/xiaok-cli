import { z } from 'zod';
export const TASK7_METHODS = ['createTask', 'createTaskWithFiles', 'cancelTask', 'recoverTask', 'answerQuestion', 'getActiveTask', 'subscribeTask'] as const;
export type Task7Method = typeof TASK7_METHODS[number];
const id = z.string().min(1), text = z.string(), time = z.number().finite();
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const role = z.enum(['customer_material', 'product_material', 'template_material', 'unknown']);
const parseStatus = z.enum(['pending', 'parsed', 'unsupported', 'failed']);
const status = z.enum(['understanding', 'running', 'waiting_user', 'completed', 'failed', 'cancelled']);
const terminal = z.enum(['completed', 'failed', 'cancelled']);
const step = z.object({ id, label: text, status: z.enum(['planned', 'running', 'completed', 'blocked', 'failed']) }).strict();
export const TASK7_UNDERSTANDING = z.object({ goal: text, deliverable: text, taskType: z.enum(['sales_deck', 'unknown']), audience: text,
  inputs: z.array(z.object({ materialId: id, name: text, role, parseStatus, parseSummary: text.optional() }).strict()),
  missingInfo: z.array(text), assumptions: z.array(text), riskLevel: z.enum(['low', 'medium', 'high']),
  suggestedPlan: z.array(step), nextAction: text }).strict();
const question = z.object({ questionId: id, taskId: id, kind: z.enum(['confirm_understanding', 'missing_material', 'material_role_correction', 'assumption_approval', 'freeform']),
  prompt: text, choices: z.array(z.object({ id, label: text }).strict()).optional(), expectedAttachments: z.array(role).optional(), staleAfterEventId: id.optional() }).strict();
const artifact = z.object({ artifactId: id, sourceTaskId: id.optional(), kind: z.enum(['pptx', 'pdf', 'docx', 'xlsx', 'html', 'image', 'text', 'a2ui', 'other']),
  title: text, createdAt: text, previewAvailable: z.boolean(), filePath: text.optional(), mimeType: text.optional(), sizeBytes: count.optional(), sourceMaterialIds: z.array(id).optional(), creator: text.optional() }).strict();
const result = z.object({ summary: text, artifacts: z.array(artifact), structuredOutput: z.record(z.string(), z.unknown()).optional(), assumptions: z.array(text).optional(), nextSteps: z.array(text).optional(), degraded: z.boolean().optional() }).strict();
const salvage = z.object({ summary: z.array(text), reason: text.optional() }).strict();
const event = <T extends string, S extends z.ZodRawShape>(type: T, shape: S) => z.object({ type: z.literal(type), ...shape }).strict();
export const TASK7_EVENT = z.discriminatedUnion('type', [
  event('execution_health', { state: z.enum(['running', 'waiting', 'recovering', 'cleanup_pending']) }),
  event('task_started', { taskId: id }), event('task_execution_started', { taskId: id }), event('task_terminal', { status: terminal }),
  event('understanding_updated', { understanding: TASK7_UNDERSTANDING }), event('plan_updated', { plan: z.array(step) }),
  event('progress', { message: text, stage: text.optional(), eventId: id }), event('assistant_delta', { delta: text, eventId: id }),
  event('needs_user', { question }), event('question_resolved', { questionId: id }),
  event('task_cancelled', { taskId: id, reason: text, partialText: text.optional() }), event('result', { result }),
  event('artifact_recorded', { artifactId: id, kind: text, label: text, filePath: text, previewAvailable: z.boolean(), turnId: id, creator: text.optional(), mimeType: text.optional() }),
  event('salvage', { salvage }), event('error', { message: text, retryable: z.boolean().optional() }),
  event('canvas_tool_call', { toolName: text, input: z.unknown(), toolUseId: id, eventId: id, ts: time.optional(), displayInputSummary: text.optional() }),
  event('canvas_tool_result', { toolName: text, toolUseId: id, ok: z.boolean(), response: text, eventId: id, ts: time.optional() }),
  event('canvas_file_changed', { filePath: text, change: z.enum(['add', 'change', 'unlink']), eventId: id }),
  event('progress_plan_reported', { steps: z.array(step) }), event('usage_recorded', { inputTokens: count, outputTokens: count }),
  event('goal_tool_fact', { invocationId: id, toolName: text, factKind: z.enum(['command_result', 'file_mutation']), exitCode: z.number().int().nullable().optional(), normalizedFilePaths: z.array(text).optional() }),
  event('goal_tool_finished', { invocationId: id, toolName: text, ok: z.boolean() }),
]);
const contextId = text.refine(value => !!value.trim() && value.length <= 200);
// Unknown data properties remain compatible until the production sanitizer rebuilds its allowlist.
const threadId = text.refine(value => !!value.trim() && value.trim().length <= 200);
const context = z.object({ threadId: threadId.optional(), taskIds: z.array(contextId).optional() }).passthrough();
const materialInput = z.object({ materialId: text.refine(value => !!value.trim()), role: role.optional() }).passthrough();
export const TASK7_ANSWER = z.discriminatedUnion('type', [
  z.object({ questionId: id, type: z.literal('choice'), choiceId: id }).strict(),
  z.object({ questionId: id, type: z.literal('text'), text }).strict(),
  z.object({ questionId: id, type: z.literal('materials'), materialIds: z.array(id) }).strict(),
  z.object({ questionId: id, type: z.literal('role_update'), materialId: id, role }).strict(),
]);
export const TASK7_INPUTS = {
  createTask: z.tuple([z.object({ prompt: text, materials: z.array(materialInput), context: context.optional() }).passthrough()]),
  createTaskWithFiles: z.tuple([z.object({ prompt: text, filePaths: z.array(text), context: context.optional() }).passthrough()]),
  cancelTask: z.tuple([z.object({ taskId: id }).strict()]),
  recoverTask: z.tuple([z.object({ taskId: id, legacyPrompt: text.optional() }).strict()]),
  answerQuestion: z.tuple([z.object({ taskId: id, answer: TASK7_ANSWER }).strict()]),
  getActiveTask: z.tuple([]),
  subscribeTask: z.tuple([z.object({ taskId: id, sinceIndex: count.optional(), subscriptionId: id.max(256).optional() }).strict()]),
} as const;
const preparation = z.object({ groupId: id, rootEpoch: count, rootTurnId: id, preparationId: id, bootId: id }).strict();
const stage = z.enum(['flush', 'snapshot', 'verify', 'settle', 'cleanup']);
const cleanup = z.enum(['none', 'pending', 'settled']);
const delivery = z.object({ version: z.literal(1), revision: count, status: z.enum(['checking', 'passed', 'failed', 'unknown']), stage,
  verification: z.enum(['pending', 'passed', 'failed']), hostSettlement: z.enum(['pending', 'committed', 'unknown']), readerCleanup: cleanup, storeCleanup: cleanup,
  startedAt: time, deadlineAt: time, decisionAt: time.optional(), finishedAt: time.optional(), hostTerminalStatus: z.enum(['completed', 'failed']).optional(),
  guardFailure: z.object({ code: z.enum(['delivery_timeout', 'snapshot_read_failed', 'snapshot_write_failed', 'verifier_start_failed', 'verifier_crashed', 'verifier_protocol_error', 'verifier_internal_error', 'verifier_capacity', 'validation_limit', 'deliverables_incomplete', 'artifact_evidence_failed', 'app_shutdown', 'recovery_unconfirmed', 'settlement_unconfirmed']), stage, needsExplicitFollowup: z.literal(true) }).strict().optional() }).strict();
const generationTarget = z.object({ workspaceId: id, nodeId: id, placeholderId: id.optional(), sourceArtifactVersionId: id.optional(), generationRequestId: id, leaseId: id,
  expectedStructureRevision: count, requestedKind: z.enum(['image', 'html', 'markdown', 'slides']), width: time.optional(), height: time.optional(), referenceVersionIds: z.array(id) }).strict();
const scope = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('artifact_workspace_generation'), generationRequestId: id, leaseId: id, target: generationTarget.optional() }).strict(),
  z.object({ kind: z.literal('goal_turn'), origin: z.enum(['user', 'continuation']), goalId: id, epoch: count, goalTurnId: id, threadId: id }).strict(),
]);
const closure = z.object({ version: z.literal(1), requiresReauthorization: z.literal(true), observations: z.array(z.object({ authorityId: id, profileId: id, sourceSessionId: id, ownerAgentId: id, scopeId: id, permissionGeneration: count, observationId: id, contentHash: id, revision: count, policyId: id, policyRevision: count }).strict()) }).strict();
// Observation DTO only. These data fields never mint or substitute for a private main authority.
const completion = z.discriminatedUnion('kind', [z.object({ kind: z.literal('unavailable') }).strict(),
  z.object({ kind: z.literal('protected'), state: z.object({ owner: z.object({ profileId: id, ownerKind: id, ownerId: id }).strict(), migrationEpoch: count, businessRevision: count,
    obligationSetRevision: count, obligationSetHash: id, obligationCount: count, currentVerification: z.enum(['valid', 'needs_revalidation', 'unavailable']) }).strict() }).strict()]);
export const TASK7_SNAPSHOT = z.object({ taskId: id, sessionId: id, status, prompt: text,
  materials: z.array(z.object({ materialId: id, originalName: text, role, parseStatus, parseSummary: text.optional() }).strict()),
  events: z.array(TASK7_EVENT), understanding: TASK7_UNDERSTANDING.optional(), result: result.optional(), salvage: salvage.optional(),
  context: z.object({ threadId: id.optional(), taskIds: z.array(id), loadedTaskIds: z.array(id), skipped: z.array(z.object({ taskId: id, reason: z.enum(['missing', 'invalid', 'non_terminal', 'self', 'too_old']) }).strict()) }).strict().optional(),
  executionScope: scope.optional(), multiAgentPreparation: preparation.optional(), hostDelivery: delivery.optional(),
  usage: z.object({ inputTokens: count, outputTokens: count, known: z.boolean() }).strict().optional(),
  executionProtected: z.literal(true).optional(), protectedObservationClosure: closure.optional(), currentCompletion: completion.optional(), createdAt: time, updatedAt: time }).strict();
const created = z.object({ taskId: id, understanding: TASK7_UNDERSTANDING.optional() }).strict();
export const TASK7_OUTPUTS = {
  createTask: created, createTaskWithFiles: created, cancelTask: z.undefined(), answerQuestion: z.undefined(),
  recoverTask: z.object({ snapshot: TASK7_SNAPSHOT, recoveredFromTaskId: id.optional() }).strict(),
  getActiveTask: z.object({ taskId: id }).strict().nullable(), subscribeTask: z.undefined(),
} as const;
export const TASK7_RISKS = {
  createTask: ['internal-mutation'], createTaskWithFiles: ['internal-mutation', 'fs-read', 'fs-write'], cancelTask: ['internal-mutation'],
  recoverTask: ['fs-read'], answerQuestion: ['internal-mutation'], getActiveTask: ['fs-read'], subscribeTask: ['long-subscription'],
} as const;
