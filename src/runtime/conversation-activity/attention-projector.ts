import { createHash } from 'node:crypto';
import { z } from 'zod/v3';
import { ATTENTION_REASONS, attentionFactSchema, mapAttentionFact, type AttentionReason, type AttentionSeverity } from './attention-catalog.js';
import type { WorkProjection, WorkWatch } from './types.js';

const key = z.string().min(1).max(256), revision = z.number().int().nonnegative().safe();
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const severityRank = { blocking: 0, warning: 1, info: 2 } as const;
const questionSchema = z.object({ questionRef: key, ownerKind: z.enum(['mcp', 'task_host', 'room']),
  answerApiRef: z.enum(['mcpAnswer', 'answerQuestion', 'answerRoomQuestion']), sourceRevision: revision, permissionRef: key,
}).strict().superRefine((value, context) => {
  const expected = { mcp: 'mcpAnswer', task_host: 'answerQuestion', room: 'answerRoomQuestion' };
  if (value.answerApiRef !== expected[value.ownerKind]) context.addIssue({ code: z.ZodIssueCode.custom, message: 'attention_question_owner_conflict' });
});
const deliveryStage = z.enum(['none', 'ready_for_acceptance', 'ready_to_deliver', 'draft_ready']);
const freshness = z.enum(['fresh', 'reconnecting', 'stale', 'unavailable']);
const inputSchema = z.object({ schemaVersion: z.literal(1), scope: z.object({ profileId: key, workspaceId: key, tenantId: key.optional() }).strict(),
  anchor: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('binding'), bindingId: key }).strict(),
    z.object({ kind: z.literal('thread'), threadKey: z.object({ sourceBindingId: key, tenantId: key, workspaceId: key,
      provider: z.literal('github'), repositoryId: key, kind: z.literal('issue'), threadId: key }).strict() }).strict(),
    // Existing activity bindings have no DSH bindingId. Preserve their real
    // native identity; do not collapse unrelated work onto its conversation.
    z.object({ kind: z.literal('activity'), source: z.enum(['kswarm', 'task_host', 'agent_group', 'mcp']), logicalSourceId: key, sourceDataEpoch: key, workId: key, runId: z.string().max(256) }).strict(),
  ]), workRef: key, factRevision: revision, projectionVersion: revision,
  executionState: z.enum(['accepted', 'queued', 'running', 'blocked', 'input_required', 'waiting_event', 'completed', 'failed', 'cancelled']),
  watchStopped: z.boolean(), freshness, deliveryStage,
  sourceFacts: z.array(attentionFactSchema).max(512), questions: z.array(questionSchema).max(128),
}).strict().superRefine((value, context) => {
  if (value.anchor.kind !== 'activity' && !value.scope.tenantId || value.anchor.kind === 'thread'
    && (value.anchor.threadKey.tenantId !== value.scope.tenantId || value.anchor.threadKey.workspaceId !== value.scope.workspaceId)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'attention_anchor_scope_conflict' });
  }
});

const reasonSchema = z.object({ code: z.enum(ATTENTION_REASONS), severity: z.enum(['blocking', 'warning', 'info']),
  sources: z.array(z.object({ factId: key, revision }).strict()).max(512),
}).strict();
export const workAttentionSchema = z.object({ schemaVersion: z.literal(1), anchorFactId: key, workRef: key,
  factRevision: revision, projectionVersion: revision, sourceSetDigest: z.string().regex(/^[a-f0-9]{64}$/),
  sourceFacts: z.array(attentionFactSchema).max(512), reasons: z.array(reasonSchema).max(18),
  primaryReason: z.enum(ATTENTION_REASONS).nullable(), severity: z.enum(['blocking', 'warning', 'info']),
  categoryRank: z.number().int().min(0).max(6), waitingOn: z.enum(['user', 'system', 'resource', 'event', 'none']),
  deliveryStage, questions: z.array(questionSchema).max(128), recommendedAction: z.enum(['answer', 'inspect', 'review', 'reconcile', 'none']),
  evidenceRefs: z.array(key).max(4096), freshness, protocolUnavailable: z.boolean(), automaticActionsAllowed: z.literal(false),
}).strict();
export type WorkAttention = z.infer<typeof workAttentionSchema>;
type ReasonGroup = { code: AttentionReason; severity: AttentionSeverity; sources: Array<{ factId: string; revision: number }> };

function unique<T>(rows: T[], identity: (row: T) => string): T[] {
  const values = new Map<string, T>();
  for (const row of rows) {
    const id = identity(row), previous = values.get(id);
    if (previous && JSON.stringify(previous) !== JSON.stringify(row)) throw new Error('attention_fact_conflict');
    values.set(id, row);
  }
  return [...values].sort(([a], [b]) => compare(a, b)).map(([, value]) => value);
}

/** A deterministic read projection over authenticated owner facts. This has
 * no IO, callbacks, permission changes, worker dispatch or business mutation. */
export function projectWorkAttention(raw: unknown): WorkAttention {
  const input = inputSchema.parse(raw);
  const facts = unique(input.sourceFacts, fact => JSON.stringify([fact.profile, fact.factId, fact.revision, fact.reasonCode]))
    .sort((a, b) => compare(a.reasonCode, b.reasonCode) || compare(a.factId, b.factId) || a.revision - b.revision || compare(a.profile, b.profile));
  const questions = unique(input.questions, question => JSON.stringify([question.ownerKind, question.questionRef]));
  const groups = new Map<AttentionReason, ReasonGroup>();
  let protocolUnavailable = false, inputRequired = input.executionState === 'input_required';
  const ordinaryReady=input.anchor.kind==='activity'&&input.anchor.source==='kswarm'&&!input.watchStopped
    &&input.freshness==='fresh'&&input.deliveryStage==='ready_for_acceptance'
    &&facts.some(fact=>fact.profile==='activity'&&fact.reasonCode==='ordinary_ready')&&!facts.some(fact=>fact.profile==='dsh');
  for (const fact of facts) {
    const mapped = mapAttentionFact(fact); protocolUnavailable ||= mapped.protocolUnavailable;
    if (!mapped.reason) { inputRequired = true; continue; }
    // The original queued fact stays in the digest. Only its derived normal
    // waiting explanation is redundant with the qualified B acceptance stage.
    if(ordinaryReady&&fact.profile==='activity'&&fact.reasonCode==='queued')continue;
    let group = groups.get(mapped.reason);
    if (!group) { group = { code: mapped.reason, severity: mapped.severity, sources: [] }; groups.set(mapped.reason, group); }
    group.sources.push({ factId: fact.factId, revision: fact.revision });
  }
  const reasons = [...groups.values()].map(group => ({ ...group, sources: unique(group.sources, source => JSON.stringify([source.factId, source.revision])) }))
    .sort((a, b) => severityRank[a.severity] - severityRank[b.severity] || compare(a.code, b.code));
  const primary = reasons[0], ready = input.deliveryStage !== 'none';
  const userReason = reasons.some(reason => !['owner_create_pending', 'draft_ready'].includes(reason.code)
    && !(ready && reason.code === 'review_required'));
  const categoryRank = questions.length || inputRequired ? 0
    : reasons.some(reason => reason.severity === 'blocking') ? 1
    : input.watchStopped && !facts.length ? 6
    : protocolUnavailable || input.freshness !== 'fresh' || userReason || ['blocked', 'failed'].includes(input.executionState) ? 2
    : ready || reasons.some(reason => reason.code === 'draft_ready') ? 3
    : input.watchStopped || ['completed', 'cancelled'].includes(input.executionState) ? 6
    : input.executionState === 'waiting_event' ? 5 : 4;
  const reconciliation = facts.some(fact => ['accepted_pending_owner_fence', 'SEAL_CLEARANCE_PENDING', 'launch_unknown', 'receipt_unknown',
    'PUBLICATION_RECONCILIATION_PENDING', 'delivery_unknown', 'budget_reconciliation_pending',
    'revocation_pending', 'stop_unconfirmed', 'mode_change_pending', 'input_invalidation_pending', 'egress_policy_changed'].includes(fact.reasonCode));
  const waitingOn = questions.length || inputRequired ? 'user' : reconciliation ? 'system'
    : input.freshness !== 'fresh' && !input.watchStopped ? 'system'
    : categoryRank <= 3 ? 'user' : categoryRank === 5 ? 'event' : categoryRank === 6 ? 'none'
    : input.executionState === 'queued' || reasons.some(reason => reason.code === 'owner_create_pending') ? 'resource' : 'system';
  const recommendedAction = questions.length || inputRequired ? 'answer'
    : reconciliation ? 'reconcile'
    : categoryRank === 3 ? 'review' : categoryRank <= 2 ? 'inspect' : 'none';
  return workAttentionSchema.parse({ schemaVersion: 1,
    anchorFactId: 'attention:' + hash(['attention-anchor-v1', input.scope.profileId, input.scope.tenantId ?? null, input.scope.workspaceId, input.anchor, 'review']),
    workRef: input.workRef, factRevision: input.factRevision, projectionVersion: input.projectionVersion,
    sourceSetDigest: hash([facts, questions, input.executionState, input.watchStopped, input.freshness, input.deliveryStage]),
    sourceFacts: facts, reasons, primaryReason: primary?.code ?? null, severity: primary?.severity ?? (inputRequired || questions.length ? 'blocking' : 'info'),
    categoryRank, waitingOn, deliveryStage: input.deliveryStage, questions, recommendedAction,
    evidenceRefs: [...new Set(facts.flatMap(fact => fact.evidenceRefs))].sort(compare), freshness: input.freshness,
    protocolUnavailable, automaticActionsAllowed: false,
  });
}

/** Compatibility adapter for existing ordinary activity only. Model summaries
 * and arbitrary source errorCode are deliberately not parsed as control facts. */
export function projectActivityAttention(watch: WorkWatch, projection: WorkProjection): WorkAttention {
  const active = watch.status !== 'stopped';
  const code = !active ? undefined : projection.freshness !== 'fresh' ? 'source_unavailable'
    : projection.executionState === 'input_required' ? 'input_required'
    : ['blocked', 'failed'].includes(projection.executionState) || projection.businessOutcome === 'error' ? 'ordinary_work_blocked'
    : ['accepted', 'queued'].includes(projection.executionState) ? 'queued' : undefined;
  return projectWorkAttention({ schemaVersion: 1, scope: { profileId: watch.origin.profileId, workspaceId: watch.origin.workspaceId },
    anchor: { kind: 'activity', source: watch.source, logicalSourceId: watch.logicalSourceId, sourceDataEpoch: watch.sourceDataEpoch, workId: watch.workId, runId: watch.runId ?? '' },
    workRef: watch.workId, factRevision: projection.revision, projectionVersion: projection.revision,
    executionState: active ? projection.executionState : 'cancelled', watchStopped: !active, freshness: projection.freshness,
    deliveryStage: 'none', sourceFacts: code ? [{ profile: 'activity', schemaVersion: 1,
      factId: 'activity:' + hash([watch.source, watch.logicalSourceId, watch.sourceDataEpoch, watch.workId, watch.runId ?? '']),
      revision: projection.revision, reasonCode: code, evidenceRefs: [] }] : [], questions: [],
  });
}

/** A local watch remains readable after source permission is lost. Its fixed
 * warning contains no source facts, evidence, questions or suggested action. */
export function projectUnavailableActivityAttention(watch: WorkWatch, localRevision: number): WorkAttention {
  const result = projectWorkAttention({ schemaVersion: 1, scope: { profileId: watch.origin.profileId, workspaceId: watch.origin.workspaceId },
    anchor: { kind: 'activity', source: watch.source, logicalSourceId: watch.logicalSourceId, sourceDataEpoch: watch.sourceDataEpoch, workId: watch.workId, runId: watch.runId ?? '' },
    workRef: watch.workId, factRevision: localRevision, projectionVersion: localRevision, executionState: 'accepted',
    watchStopped: watch.status === 'stopped', freshness: 'unavailable', deliveryStage: 'none', sourceFacts: [], questions: [],
  });
  return { ...result, waitingOn: 'none', recommendedAction: 'none' };
}
