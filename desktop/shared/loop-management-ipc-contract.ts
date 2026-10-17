import { z } from 'zod';
import { LOOP_RUN_OBSERVATION_SCHEMA } from './loop-current-view-ipc-contract.js';

/** Persisted facts only; these values never authorize execution or scheduling. */
export type LoopLegacyJson = string | number | boolean | null | LoopLegacyJson[] | { [key: string]: LoopLegacyJson };
const legacy: z.ZodType<LoopLegacyJson> = z.lazy(() => z.union([
  z.string(), z.number().finite(), z.boolean(), z.null(), z.array(legacy), z.record(z.string(), legacy),
]));
const text = z.string(), number = z.number().finite();
/** Legacy scheduling inputs are ignored by the producer, including cloneable non-JSON primitives. */
export type IgnoredLoopScheduleData = string | number | boolean | bigint | null | undefined
  | IgnoredLoopScheduleData[] | { [key: string]: IgnoredLoopScheduleData };
const legacyInput: z.ZodType<IgnoredLoopScheduleData> = z.lazy(() => z.union([
  z.string(), z.custom<number>(value => typeof value === 'number'), z.boolean(), z.bigint(), z.null(), z.undefined(),
  z.array(legacyInput), z.record(z.string(), legacyInput),
]));
const createBase = {
  loopId: text, title: text, prompt: text, description: text.optional(),
  scheduleEnabled: legacyInput, scheduleTrigger: legacyInput, autoRunApproved: legacyInput,
};
export const LOOP_CREATE_TEMPLATE_INPUT_SCHEMA = z.discriminatedUnion('kind', [
  z.object({ ...createBase, kind: z.literal('markdown_file'), outputDirectory: text, outputFileName: text }).strict(),
  z.object({ ...createBase, kind: z.literal('task_completion'), outputDirectory: text.optional(), outputFileName: text.optional() }).strict(),
]);
export const LOOP_TEMPLATE_PATCH_SCHEMA = z.object({
  title: text.optional(), description: text.optional(), prompt: text.optional(),
  outputDirectory: text.optional(), outputFileName: text.optional(),
}).strict();
const criterion = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('task_completed'), strength: z.enum(['weak', 'strong']) }).strict(),
  z.object({ kind: z.literal('file_exists'), pathTemplate: text, minBytes: number.optional(), expectedMime: text.optional() }).strict(),
  z.object({ kind: z.literal('command_exit_zero'), commandId: text, args: z.array(text), cwdPolicy: z.enum(['workspace', 'output_dir']) }).strict(),
]);
export const LOOP_TEMPLATE_CONTRACT_SCHEMA = z.object({
  schemaVersion: z.literal('loop_contract_v1'), objective: text,
  triggerPolicy: z.object({ kind: z.literal('manual') }).strict(), successCriteria: z.array(criterion),
  stopPolicy: z.object({ maxConsecutiveFailures: number.optional() }).strict(),
  permissionPolicy: z.object({ mode: z.enum(['read_only', 'workspace_write', 'project_mutation', 'external_side_effect']),
    autoRunApproved: z.boolean(), allowedToolCategories: z.array(text), approvedTargetRefs: z.array(text).optional() }).strict(),
  concurrencyPolicy: z.object({ perLoop: z.enum(['skip_if_running', 'queue_latest', 'cancel_previous', 'parallel']), coalesceMissedRuns: z.boolean() }).strict(),
  legacyPolicy: z.object({ requiresHumanApprovalBeforeBackgroundSuccess: z.boolean().optional(),
    legacyWeakModeAuditRef: text.optional(), grandfatheredOutputTargetRefs: z.array(text).optional() }).strict().optional(),
}).strict();
export const LOOP_DEFINITION_SCHEMA = z.object({
  id: text, title: text, description: text, status: z.enum(['active', 'paused', 'deleted']), origin: z.enum(['built_in', 'user_template']),
  activeRunId: text.optional(), deletedAt: number.optional(), deleteReason: text.optional(), createdAt: number, updatedAt: number,
}).strict();
export const USER_LOOP_TEMPLATE_SCHEMA = z.object({
  loopId: text, kind: z.enum(['markdown_file', 'task_completion']), prompt: text, outputDirectory: text, outputFileName: text,
  scheduleActionId: text.optional(), scheduleEnabled: z.boolean(), scheduleTrigger: z.record(z.string(), legacy).optional(),
  autoRunApproved: z.boolean(), contract: LOOP_TEMPLATE_CONTRACT_SCHEMA, createdAt: number, updatedAt: number,
}).strict();
export const LOOP_CONSTRAINT_SCHEMA = z.object({
  id: text, loopId: text, source: z.enum(['llm_extraction', 'rule_extraction', 'user_manual']), rule: text, sourceRunId: text,
  failureKind: text.nullable(), failureReason: text.nullable(), active: z.boolean(), hitCount: number, consecutiveIneffectiveCount: number,
  createdAt: number, updatedAt: number, lastHitAt: number.nullable(), supersededBy: text.nullable(),
  deactivationReason: z.enum(['user', 'stale', 'ineffective', 'overflow', 'superseded']).nullable(), extractionContext: text.nullable(),
}).strict();
const anomalyBase = { id: text, ownerId: text, status: z.enum(['open', 'resolved', 'ignored']),
  firstSeenAt: number, lastSeenAt: number, lastResolvedAt: number.optional(), seenCount: number, ignoredUntil: number.optional(),
  message: text, evidenceIds: z.array(text), metadata: z.record(z.string(), legacy) };
export const LOOP_ANOMALY_SCHEMA = z.union([
  z.object({ ...anomalyBase, loopId: z.literal('artifact-evidence-regression'),
    ownerKind: z.enum(['task', 'loop_stage', 'loop_run', 'project', 'goal']),
    kind: z.enum(['completed_without_evidence', 'artifact_kind_mismatch', 'legacy_unclassified_completion', 'source_unavailable', 'validation_failed']) }).strict(),
  z.object({ ...anomalyBase, loopId: z.literal('kswarm-service-health'), ownerKind: z.literal('loop_run'),
    kind: z.enum(['service_not_running', 'port_occupied_by_unknown_process', 'health_unreachable', 'health_http_error',
      'health_parse_error', 'health_identity_mismatch', 'health_capability_mismatch', 'broker_unavailable', 'spawn_path_missing',
      'spawn_exit', 'source_hash_warning', 'source_unavailable']) }).strict(),
]);
export const LOOP_MANAGEMENT_RUN_SCHEMA = LOOP_RUN_OBSERVATION_SCHEMA.omit({ businessState: true, completionObservation: true });
export const LOOP_MANAGEMENT_RUN_RESULT_SCHEMA = z.union([
  z.object({ status: z.enum(['publication_pending', 'executing', 'success', 'blocked', 'failed']), run: LOOP_MANAGEMENT_RUN_SCHEMA }).strict(),
  z.object({ status: z.literal('already_running'), activeRunId: text }).strict(),
  z.object({ status: z.literal('already_completed'), completedRunId: text }).strict(),
  z.object({ status: z.literal('skipped'), reason: z.enum(['paused', 'missing_loop', 'deleted_loop']) }).strict(),
]);
export const LOOP_MANAGEMENT_OUTPUT_SCHEMAS = Object.freeze({
  listDefinitions: z.array(LOOP_DEFINITION_SCHEMA), listUserTemplates: z.array(USER_LOOP_TEMPLATE_SCHEMA),
  createUserTemplate: z.object({ template: USER_LOOP_TEMPLATE_SCHEMA,
    ignoredLegacyScheduleFields: z.array(z.enum(['scheduleEnabled', 'scheduleTrigger', 'autoRunApproved'])) }).strict(),
  updateUserTemplate: USER_LOOP_TEMPLATE_SCHEMA.optional(), deleteUserTemplate: z.undefined(),
  listAnomalies: z.array(LOOP_ANOMALY_SCHEMA), runNow: LOOP_MANAGEMENT_RUN_RESULT_SCHEMA,
  listConstraints: z.array(LOOP_CONSTRAINT_SCHEMA), setConstraintActive: LOOP_CONSTRAINT_SCHEMA.optional(),
  confirmConstraint: LOOP_CONSTRAINT_SCHEMA.optional(),
  clearRunHistory: z.object({ ok: z.literal(true), removed: z.number().int().nonnegative() }).strict(),
});
export type LoopManagementMethod = keyof typeof LOOP_MANAGEMENT_OUTPUT_SCHEMAS;
export type LoopCreateTemplateDto = z.infer<typeof LOOP_CREATE_TEMPLATE_INPUT_SCHEMA>;
export type LoopTemplatePatchDto = z.infer<typeof LOOP_TEMPLATE_PATCH_SCHEMA>;
export type LoopDefinitionDto = z.infer<typeof LOOP_DEFINITION_SCHEMA>;
export type UserLoopTemplateDto = z.infer<typeof USER_LOOP_TEMPLATE_SCHEMA>;
export type CreateLoopTemplateResultDto = z.infer<typeof LOOP_MANAGEMENT_OUTPUT_SCHEMAS.createUserTemplate>;
export type LoopConstraintDto = z.infer<typeof LOOP_CONSTRAINT_SCHEMA>;
export type LoopAnomalyDto = z.infer<typeof LOOP_ANOMALY_SCHEMA>;
export type LoopManagementRunResultDto = z.infer<typeof LOOP_MANAGEMENT_RUN_RESULT_SCHEMA>;
