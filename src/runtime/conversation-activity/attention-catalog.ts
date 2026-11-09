import { createHash } from 'node:crypto';
import { z } from 'zod/v3';

// Presentation only. A code is never a control, permission or execution grant.
export const ATTENTION_REASONS = [
  'authorization_required', 'input_conflict', 'budget_exhausted', 'delivery_unknown',
  'draft_ready', 'source_unavailable', 'revocation_pending', 'stop_unconfirmed',
  'mode_change_pending', 'input_invalidation_pending', 'work_deadline_exceeded',
  'egress_policy_changed', 'observation_window_closed', 'review_required',
  'artifact_stale', 'budget_reconciliation_pending', 'authority_suspect', 'owner_create_pending',
] as const;
export type AttentionReason = typeof ATTENTION_REASONS[number];
export type AttentionSeverity = 'info' | 'warning' | 'blocking';
const blocking = new Set<AttentionReason>(['authorization_required', 'authority_suspect', 'delivery_unknown',
  'budget_exhausted', 'revocation_pending', 'stop_unconfirmed', 'mode_change_pending',
  'input_invalidation_pending', 'egress_policy_changed']);
export const ATTENTION_SEVERITY = Object.freeze(Object.fromEntries(ATTENTION_REASONS.map(reason =>
  [reason, reason === 'draft_ready' ? 'info' : blocking.has(reason) ? 'blocking' : 'warning'])) as Record<AttentionReason, AttentionSeverity>);

const groups: ReadonlyArray<readonly [AttentionReason, readonly string[]]> = [
  ['authority_suspect', ['SEAL_CLEARANCE_DENIED', 'SCOPE_VIOLATION', 'AUTHORITY_SUSPECT']],
  ['artifact_stale', ['STALE_INPUT', 'artifact_superseded', 'revision_conflict', 'REVISION_CONTENT_CONFLICT']],
  ['egress_policy_changed', ['EGRESS_POLICY_CHANGED']],
  ['revocation_pending', ['VISIBILITY_NARROWING']],
  ['budget_exhausted', ['BUDGET_EXHAUSTED']],
  ['input_conflict', ['INPUT_CONFLICT']],
  ['work_deadline_exceeded', ['WORK_DEADLINE_EXCEEDED', 'MANDATE_DEADLINE_EXCEEDED']],
  ['observation_window_closed', ['OBSERVATION_WINDOW_CLOSED']],
  ['owner_create_pending', ['capacity_pending', 'resource_wait', 'queued', 'runtime_unavailable', 'plan_input_waiting_consumption']],
  ['review_required', [
    'SEAL_CLEARANCE_PENDING', 'launch_unknown', 'receipt_unknown', 'rebind_prepared', 'released_pending_rebind',
    'LOCAL_INPUT_NOT_IN_MANDATE', 'DIRECT_MANAGED_MUTATION_FORBIDDEN', 'PROTOCOL_BINDING_UNVERIFIED',
    'NO_DISPATCH_ROUTE', 'FOLLOWUP_CLIENT_UPGRADE_REQUIRED', 'PROJECT_TERMINAL_REQUIRES_REOPEN',
    'PLAN_INPUT_WINDOW_CLOSED', 'ARTIFACT_HEAD_UNVERIFIED', 'REVISION_BASE_NOT_READY',
    'TRANSFER_TARGET_REJECTED', 'FOLLOWUP_ACTION_AMBIGUOUS', 'PUBLICATION_RECONCILIATION_PENDING',
    'DISPATCH_POLICY_INVALID', 'SNAPSHOT_POLICY_CHANGED_REVIEW_REQUIRED', 'REVISION_ORDER_UNPROVEN',
    'EGRESS_CLASS_DENIED', 'SNAPSHOT_INCOMPLETE', 'SNAPSHOT_NOT_ACTIONABLE', 'PROJECT_EXECUTION_POLICY_DENIED',
    'ASSESSMENT_EXPIRED_REVIEW_REQUIRED', 'PROVENANCE_CHANGED_REVIEW_REQUIRED', 'MANDATE_BINDING_MISMATCH',
    'COMPLETION_REACHED', 'WORK_GENERATION_CLOSED', 'WORK_OFF', 'BACKLOG_BEFORE_MODE_EPOCH',
    'BASELINE_UNCONFIRMED', 'WINDOW_STALE', 'DEADLINE_EXTENSION_REJECTED', 'INCOMPATIBLE_STORE_READER',
    'CANDIDATE_WORKSPACE_UNAVAILABLE', 'INPUT_CONTRACT_DENIED', 'PLAN_INPUT_CONSUMER_UNAVAILABLE',
    'TARGET_OWNERSHIP_UNVERIFIED', 'TARGET_OWNED_BY_OTHER_ARTIFACT', 'TARGET_EFFECT_DIVERGED',
    'SCOPE_QUERY_DENIED', 'ordinary_ready', 'ready_to_deliver', 'ordinary_work_blocked',
  ]],
];
const entries: Array<readonly [string, AttentionReason]> = ATTENTION_REASONS.map(reason => [reason, reason]);
for (const [reason, codes] of groups) for (const code of codes) entries.push([code, reason]);
const catalog = new Map<string, AttentionReason>();
for (const [code, reason] of entries) {
  if (catalog.has(code)) throw new Error('attention_catalog_duplicate');
  catalog.set(code, reason);
}
export const ATTENTION_CODE_CATALOG = Object.freeze(Object.fromEntries([...catalog].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)));
export const ATTENTION_CATALOG_DIGEST = createHash('sha256').update(JSON.stringify({ schemaVersion: 1,
  reasons: ATTENTION_SEVERITY, codes: ATTENTION_CODE_CATALOG, control: 'kind-axis-v1', ordinaryInputRequired: 'questions-only' })).digest('hex');

const key = z.string().min(1).max(256);
export const attentionFactSchema = z.object({
  profile: z.enum(['dsh', 'ordinary', 'activity']), schemaVersion: z.number().int().positive().safe(),
  factId: key, revision: z.number().int().nonnegative().safe(), reasonCode: key,
  evidenceRefs: z.array(key).max(64),
  controlKind: z.enum(['revoke', 'actor_provenance', 'policy_change', 'mandate_revision', 'stop', 'mode_change', 'input_invalidation', 'egress_policy_change']).optional(),
  axis: z.enum(['authorization', 'mode', 'egress']).optional(), narrowing: z.boolean().optional(),
}).strict().superRefine((value, context) => {
  if (value.reasonCode === 'accepted_pending_owner_fence' && value.schemaVersion === 1 && value.profile === 'dsh') {
    if (!value.controlKind || value.controlKind === 'mandate_revision' && value.narrowing === undefined
      || value.controlKind === 'mandate_revision' && value.narrowing && !value.axis) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'attention_control_identity_required' });
    }
    const expectedAxis = value.controlKind === 'mode_change' ? 'mode'
      : value.controlKind === 'egress_policy_change' ? 'egress'
      : ['revoke', 'actor_provenance', 'policy_change'].includes(value.controlKind ?? '') ? 'authorization' : undefined;
    if (value.controlKind !== 'mandate_revision' && value.axis !== undefined && value.axis !== expectedAxis) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'attention_control_axis_conflict' });
    }
  }
});
export type AttentionSourceFact = z.infer<typeof attentionFactSchema>;
export interface MappedAttentionFact { reason: AttentionReason | null; severity: AttentionSeverity; protocolUnavailable: boolean }

/** Only call on facts obtained from their authenticated owner. In particular,
 * never pass model text/errorCode here as a DSH control fact. */
export function mapAttentionFact(input: unknown): MappedAttentionFact {
  const fact = attentionFactSchema.parse(input);
  if (fact.schemaVersion !== 1) return { reason: 'review_required', severity: 'warning', protocolUnavailable: true };
  if (fact.reasonCode === 'input_required' && fact.profile !== 'dsh') return { reason: null, severity: 'blocking', protocolUnavailable: false };
  let reason: AttentionReason | undefined;
  if (fact.reasonCode === 'accepted_pending_owner_fence' && fact.profile === 'dsh') {
    const kind = fact.controlKind;
    reason = kind === 'mandate_revision' && !fact.narrowing ? 'review_required'
      : kind === 'mode_change' || fact.axis === 'mode' ? 'mode_change_pending'
      : kind === 'stop' ? 'stop_unconfirmed'
      : kind === 'input_invalidation' ? 'input_invalidation_pending'
      : kind === 'egress_policy_change' || fact.axis === 'egress' ? 'egress_policy_changed' : 'revocation_pending';
  } else reason = catalog.get(fact.reasonCode);
  // Ordinary adapters emit the closed normal-state codes below; a plugin's
  // arbitrary error string cannot impersonate the DSH safety/control plane.
  if (fact.profile === 'activity' && reason && (blocking.has(reason) || reason === 'draft_ready')) reason = undefined;
  return reason ? { reason, severity: ATTENTION_SEVERITY[reason], protocolUnavailable: false }
    : { reason: 'review_required', severity: 'warning', protocolUnavailable: true };
}
