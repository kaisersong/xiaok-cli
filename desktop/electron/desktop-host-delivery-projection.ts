import type { HostDeliveryRecord, HostDeliveryReport, HostDeliverySource } from '../../src/runtime/task-host/delivery-types.js';
import { encodeMultiAgentRow } from './desktop-multi-agent-store.js';

const STAGES = ['flush', 'snapshot', 'verify', 'settle', 'cleanup'];
const FAILURE_CODES = ['delivery_timeout', 'snapshot_read_failed', 'snapshot_write_failed', 'verifier_start_failed',
  'verifier_crashed', 'verifier_protocol_error', 'verifier_internal_error', 'verifier_capacity', 'validation_limit',
  'deliverables_incomplete', 'artifact_evidence_failed', 'app_shutdown', 'recovery_unconfirmed', 'settlement_unconfirmed'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function requireFact(condition: unknown): asserts condition {
  if (!condition) throw new Error('invalid_host_delivery_report');
}
function object(value: unknown, required: string[], optional: string[] = []): Record<string, unknown> {
  requireFact(value && typeof value === 'object' && !Array.isArray(value));
  requireFact(Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
  const row = value as Record<string, unknown>;
  requireFact(required.every(key => Object.hasOwn(row, key)) && Object.keys(row).every(key => required.includes(key) || optional.includes(key)));
  return row;
}
function oneOf(value: unknown, values: string[]): void { requireFact(typeof value === 'string' && values.includes(value)); }
function timestamp(value: unknown): void { requireFact(typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value >= 0); }

/** Validate before encoding, then capture an immutable-by-caller bounded report
 * before the service's first await. No free-form metadata or error detail. */
export function captureHostDeliveryReport(input: unknown): HostDeliveryReport {
  const report = object(input, ['source', 'delivery']);
  const source = object(report.source, ['sourceTaskId', 'groupId', 'rootTurnId', 'rootEpoch', 'preparationId', 'bootId']);
  requireFact(typeof source.sourceTaskId === 'string' && source.sourceTaskId.length > 0 && source.sourceTaskId.length <= 128
    && Buffer.byteLength(source.sourceTaskId) <= 128);
  for (const key of ['groupId', 'rootTurnId', 'preparationId', 'bootId']) requireFact(typeof source[key] === 'string' && UUID.test(source[key]));
  requireFact(Number.isSafeInteger(source.rootEpoch) && Number(source.rootEpoch) > 0);
  const record = object(report.delivery, ['version', 'revision', 'status', 'stage', 'verification', 'hostSettlement',
    'readerCleanup', 'storeCleanup', 'startedAt', 'deadlineAt'], ['decisionAt', 'finishedAt', 'hostTerminalStatus', 'guardFailure']);
  requireFact(record.version === 1 && Number.isSafeInteger(record.revision) && Number(record.revision) > 0);
  oneOf(record.status, ['checking', 'passed', 'failed', 'unknown']); oneOf(record.stage, STAGES);
  oneOf(record.verification, ['pending', 'passed', 'failed']); oneOf(record.hostSettlement, ['pending', 'committed', 'unknown']);
  oneOf(record.readerCleanup, ['none', 'pending', 'settled']); oneOf(record.storeCleanup, ['none', 'pending', 'settled']);
  timestamp(record.startedAt); timestamp(record.deadlineAt);
  requireFact(Number(record.deadlineAt) >= Number(record.startedAt));
  for (const key of ['decisionAt', 'finishedAt']) if (record[key] !== undefined) timestamp(record[key]);
  if (record.hostTerminalStatus !== undefined) oneOf(record.hostTerminalStatus, ['completed', 'failed']);
  if (record.guardFailure !== undefined) {
    const failure = object(record.guardFailure, ['code', 'stage', 'needsExplicitFollowup']);
    oneOf(failure.code, FAILURE_CODES); oneOf(failure.stage, STAGES); requireFact(failure.needsExplicitFollowup === true);
  }
  requireFact(record.hostSettlement === 'committed' ? record.hostTerminalStatus !== undefined : record.hostTerminalStatus === undefined);
  if (record.finishedAt !== undefined) requireFact(record.hostSettlement === 'committed');
  if (record.status === 'checking') requireFact(record.hostSettlement === 'pending');
  if (record.status === 'unknown' && record.hostSettlement === 'committed') {
    requireFact(record.hostTerminalStatus === 'failed' && record.finishedAt !== undefined
      && (record.stage === 'settle' || record.stage === 'cleanup'));
    const failure = record.guardFailure as Record<string, unknown> | undefined;
    requireFact(failure?.code === 'recovery_unconfirmed' && failure.stage === 'settle');
  }
  if (record.status === 'passed' || record.status === 'failed') {
    requireFact(record.hostSettlement === 'committed' && record.finishedAt !== undefined);
    requireFact(record.verification === record.status && record.hostTerminalStatus === (record.status === 'passed' ? 'completed' : 'failed'));
    requireFact(record.stage === 'settle' || record.stage === 'cleanup');
  }
  // The trusted host wins its decision against a monotonic deadline. These
  // persisted wall-clock fields are display facts, not a second verifier.
  if (record.verification === 'passed') requireFact(record.decisionAt !== undefined);
  requireFact(Buffer.byteLength(encodeMultiAgentRow(record)) <= 2048);
  const encoded = encodeMultiAgentRow(report); requireFact(Buffer.byteLength(encoded) <= 3072);
  return JSON.parse(encoded) as HostDeliveryReport;
}

/** Reconcile two persisted sources without relaxing their monotonic history. */
export function reconcileHostDeliveryRecords(source: HostDeliverySource, host?: HostDeliveryRecord, journal?: HostDeliveryRecord): HostDeliveryRecord | undefined {
  const a = host && captureHostDeliveryReport({ source, delivery: host }).delivery;
  const b = journal && captureHostDeliveryReport({ source, delivery: journal }).delivery;
  // SQLite is an observer of host commit, never its predecessor. This also
  // rejects the same corruption without a recovery-specific failure reason.
  if (b?.hostSettlement === 'committed') requireFact(a?.hostSettlement === 'committed');
  if (!a || !b) return a ?? b;
  if (a.revision === b.revision) { requireFact(encodeMultiAgentRow(a) === encodeMultiAgentRow(b)); return a; }
  const [early, late] = a.revision < b.revision ? [a, b] : [b, a];
  requireFact(early.startedAt === late.startedAt && early.deadlineAt === late.deadlineAt);
  // A host candidate may already be in its journal while its still-waiting
  // writer reports unknown to SQLite. Unknown is uncertainty, not a reversal
  // of that committed truth. The startup owner separately prefers host terminal.
  const waitingWriter = early === a && late === b && early.hostSettlement === 'committed'
    && late.status === 'unknown' && late.hostSettlement === 'unknown';
  const recovery = late === a && early.hostSettlement !== 'committed' && late.status === 'unknown'
    && late.hostSettlement === 'committed' && late.hostTerminalStatus === 'failed'
    && late.guardFailure?.code === 'recovery_unconfirmed';
  if (waitingWriter) {
    // This exception is directional: only the host can prove its candidate
    // committed before the later SQLite observer knew its writer had settled.
    requireFact(late.verification === early.verification);
    if (early.decisionAt !== undefined) requireFact(late.decisionAt === early.decisionAt);
    if (early.guardFailure) requireFact(encodeMultiAgentRow(early.guardFailure) === encodeMultiAgentRow(late.guardFailure));
  } else {
    // The recovery terminal may replace the uncommitted failure reason, but
    // cannot drop a frozen timestamp or revive an unknown/failed decision.
    assertHostDeliveryAdvance(recovery ? { ...early, guardFailure: undefined } : early, late);
  }
  return late;
}

/** Projection follows the host's decision; it must never compute a second one. */
export function assertHostDeliveryAdvance(previous: HostDeliveryRecord | undefined, next: HostDeliveryRecord): void {
  if (!previous) {
    requireFact(next.revision === 1 && next.status === 'checking' && next.verification === 'pending'
      && next.hostSettlement === 'pending' && next.decisionAt === undefined && next.finishedAt === undefined
      && next.stage === 'flush' && next.readerCleanup === 'none' && next.storeCleanup === 'none' && !next.guardFailure);
    return;
  }
  requireFact(previous.version === 1 && next.version === 1 && next.revision > previous.revision);
  requireFact(next.startedAt === previous.startedAt && next.deadlineAt === previous.deadlineAt);
  if (previous.decisionAt !== undefined) requireFact(next.decisionAt === previous.decisionAt);
  if (previous.finishedAt !== undefined) requireFact(next.finishedAt === previous.finishedAt);
  if (previous.verification !== 'pending') requireFact(next.verification === previous.verification);
  if (previous.hostSettlement === 'committed') requireFact(next.hostSettlement === 'committed' && next.hostTerminalStatus === previous.hostTerminalStatus);
  if (previous.status === 'passed' || previous.status === 'failed') requireFact(next.status === previous.status);
  if (previous.status === 'unknown') {
    requireFact(next.status !== 'checking');
    if (next.verification === 'passed') requireFact(previous.verification === 'passed');
  }
  for (const key of ['readerCleanup', 'storeCleanup'] as const) {
    if (previous[key] === 'settled') requireFact(next[key] === 'settled');
    if (previous[key] === 'pending') requireFact(next[key] !== 'none');
  }
  if (previous.guardFailure) requireFact(encodeMultiAgentRow(previous.guardFailure) === encodeMultiAgentRow(next.guardFailure));
}
