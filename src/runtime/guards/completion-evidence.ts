export type CompletionKind =
  | 'answer'
  | 'file_artifact'
  | 'command_action'
  | 'project_update'
  | 'log_diagnostic'
  | 'blocked';

export interface CompletionExpectation {
  ownerKind: 'task' | 'loop_stage' | 'loop_run' | 'project';
  ownerId: string;
  expectedKinds: CompletionKind[];
  source: 'task_spec' | 'tool_schema' | 'scheduler_executor_contract' | 'loop_stage_contract' | 'kswarm_deliverable_type' | 'legacy_classifier';
  confidence: 'explicit' | 'inferred' | 'legacy';
}

export interface CompletionEvidenceRecord {
  ownerKind: CompletionExpectation['ownerKind'];
  ownerId: string;
  kind: CompletionKind;
  summary: string;
  uri?: string;
  metadata?: Record<string, unknown>;
}

export type EvidenceValidationFailure =
  | 'evidence_missing'
  | 'evidence_kind_mismatch'
  | 'validation_failed';

export interface EvidenceValidationResult {
  ok: boolean;
  failureKind?: EvidenceValidationFailure;
  message?: string;
}

export function mergeCompletionExpectations(expectations: CompletionExpectation[]): CompletionExpectation | undefined {
  if (expectations.length === 0) {
    return undefined;
  }

  const highestPriority = Math.max(...expectations.map(expectation => confidencePriority(expectation.confidence)));
  const selected = expectations.filter(expectation => confidencePriority(expectation.confidence) === highestPriority);
  const [first, ...rest] = selected;
  if (!first) {
    return undefined;
  }

  const expectedKinds = uniqueKinds(first.expectedKinds)
    .filter(kind => rest.every(expectation => expectation.expectedKinds.includes(kind)));

  return {
    ...first,
    expectedKinds,
  };
}

export function validateCompletionEvidence(input: {
  ownerKind: CompletionExpectation['ownerKind'];
  ownerId: string;
  targetStatus: string;
  expectation?: CompletionExpectation;
  evidence?: CompletionEvidenceRecord[];
}): EvidenceValidationResult {
  if (isBlockedStatus(input.targetStatus)) {
    return validateBlockedEvidence(input);
  }
  if (!isCompletedStatus(input.targetStatus)) {
    return { ok: true };
  }

  const expectation = input.expectation;
  if (!expectation) {
    return fail('evidence_missing', 'Completed status requires an explicit or inferred completion expectation.');
  }
  if (expectation.ownerKind !== input.ownerKind || expectation.ownerId !== input.ownerId) {
    return fail('validation_failed', 'Completion expectation owner does not match the target owner.');
  }
  if (expectation.confidence === 'legacy') {
    return fail('validation_failed', 'Legacy completion expectations cannot authorize completed status.');
  }

  const expectedKinds = uniqueKinds(expectation.expectedKinds);
  if (expectedKinds.length === 0) {
    return fail('validation_failed', 'Completion expectation has no expected evidence kind.');
  }
  if (expectedKinds.includes('blocked')) {
    return fail('validation_failed', 'Blocked evidence cannot authorize completed status.');
  }

  const ownerEvidence = matchingOwnerEvidence(input);
  if (ownerEvidence.length === 0) {
    return fail('evidence_missing', 'Completion evidence is missing for the target owner.');
  }
  if (ownerEvidence.some(record => record.kind !== 'blocked' && !hasText(record.summary))) {
    return fail('validation_failed', 'Completion evidence requires a non-empty summary.');
  }

  const expectedEvidence = ownerEvidence.filter(record => expectedKinds.includes(record.kind));
  if (expectedEvidence.length === 0) {
    return fail('evidence_kind_mismatch', 'Completion evidence kind does not match the expected completion kind.');
  }
  if (expectedEvidence.some(record => record.kind === 'blocked')) {
    return fail('evidence_kind_mismatch', 'Blocked evidence cannot authorize completed status.');
  }

  let lastFailure: EvidenceValidationResult | undefined;
  for (const record of expectedEvidence) {
    const result = validateEvidenceRecord(record);
    if (result.ok) {
      return { ok: true };
    }
    lastFailure = result;
  }

  return lastFailure ?? fail('validation_failed', 'Completion evidence failed validation.');
}

function validateBlockedEvidence(input: {
  ownerKind: CompletionExpectation['ownerKind'];
  ownerId: string;
  evidence?: CompletionEvidenceRecord[];
}): EvidenceValidationResult {
  const ownerEvidence = matchingOwnerEvidence(input);
  if (ownerEvidence.length === 0) {
    return fail('evidence_missing', 'Blocked status requires blocked evidence for the target owner.');
  }
  if (!ownerEvidence.some(record => record.kind === 'blocked')) {
    return fail('evidence_kind_mismatch', 'Blocked status requires blocked evidence.');
  }
  return { ok: true };
}

function validateEvidenceRecord(record: CompletionEvidenceRecord): EvidenceValidationResult {
  if (!hasText(record.summary)) {
    return fail('validation_failed', 'Completion evidence requires a non-empty summary.');
  }

  switch (record.kind) {
    case 'answer':
      if (!hasText(record.metadata?.responseId) && !hasText(record.metadata?.responseSnapshotHash)) {
        return fail('validation_failed', 'Answer evidence requires a response id or response snapshot hash.');
      }
      return { ok: true };
    case 'file_artifact':
      if (hasText(record.uri) || isNonEmptyStringArray(record.metadata?.paths)) {
        return { ok: true };
      }
      return fail('validation_failed', 'File artifact evidence requires a URI or paths metadata.');
    case 'command_action':
      if (isNonEmptyCommandArray(record.metadata?.commands)) {
        return { ok: true };
      }
      return fail('validation_failed', 'Command action evidence requires commands metadata.');
    case 'project_update':
      if (!hasText(record.metadata?.projectId)) {
        return fail('validation_failed', 'Project update evidence requires a project id.');
      }
      if (
        isNonEmptyStringArray(record.metadata?.changedTasks)
        || isNonEmptyStringArray(record.metadata?.changedDeliverables)
        || isNoOpSummary(record.summary)
      ) {
        return { ok: true };
      }
      return fail('validation_failed', 'Project update evidence requires changed tasks or deliverables.');
    case 'log_diagnostic':
      if (isNonEmptyStringArray(record.metadata?.logPaths) || isNonEmptyStringArray(record.metadata?.findings)) {
        return { ok: true };
      }
      return fail('validation_failed', 'Log diagnostic evidence requires logs or findings metadata.');
    case 'blocked':
      return { ok: true };
  }
}

function matchingOwnerEvidence(input: {
  ownerKind: CompletionExpectation['ownerKind'];
  ownerId: string;
  evidence?: CompletionEvidenceRecord[];
}): CompletionEvidenceRecord[] {
  return (input.evidence ?? []).filter(record => record.ownerKind === input.ownerKind && record.ownerId === input.ownerId);
}

function uniqueKinds(kinds: CompletionKind[]): CompletionKind[] {
  return kinds.filter((kind, index) => kinds.indexOf(kind) === index);
}

function confidencePriority(confidence: CompletionExpectation['confidence']): number {
  switch (confidence) {
    case 'explicit':
      return 3;
    case 'inferred':
      return 2;
    case 'legacy':
      return 1;
  }
}

function isCompletedStatus(status: string): boolean {
  return status === 'success' || status === 'completed' || status === 'done' || status === 'submitted';
}

function isBlockedStatus(status: string): boolean {
  return status === 'blocked';
}

function hasText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isNonEmptyStringArray(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0 && value.every(item => hasText(item));
}

function isNonEmptyCommandArray(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0 && value.every(isValidCommandRecord);
}

function isValidCommandRecord(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }
  if (!hasText(value.command) || !hasText(value.summary)) {
    return false;
  }
  if (!Object.prototype.hasOwnProperty.call(value, 'exitCode')) {
    return false;
  }
  return typeof value.exitCode === 'number' || value.exitCode === null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNoOpSummary(summary: string): boolean {
  return /\bno-?op\b|无变化/iu.test(summary);
}

function fail(failureKind: EvidenceValidationFailure, message: string): EvidenceValidationResult {
  return { ok: false, failureKind, message };
}
