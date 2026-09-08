import type { DesktopTaskEvent, TaskSnapshot } from './types.js';

/** Internal host-owned delivery facts, independent of Electron and execution status. */
export type DeliveryStage = 'flush' | 'snapshot' | 'verify' | 'settle' | 'cleanup';
export interface GuardFailure {
  code: 'delivery_timeout' | 'snapshot_read_failed' | 'snapshot_write_failed'
    | 'verifier_start_failed' | 'verifier_crashed' | 'verifier_protocol_error'
    | 'verifier_internal_error' | 'verifier_capacity' | 'validation_limit' | 'deliverables_incomplete'
    | 'artifact_evidence_failed' | 'app_shutdown' | 'recovery_unconfirmed' | 'settlement_unconfirmed';
  stage: DeliveryStage;
  needsExplicitFollowup: true;
}
export interface HostDeliverySource {
  sourceTaskId: string;
  groupId: string;
  rootTurnId: string;
  rootEpoch: number;
  preparationId: string;
  bootId: string;
}
export interface HostDeliveryRecord {
  version: 1;
  revision: number;
  status: 'checking' | 'passed' | 'failed' | 'unknown';
  stage: DeliveryStage;
  verification: 'pending' | 'passed' | 'failed';
  hostSettlement: 'pending' | 'committed' | 'unknown';
  readerCleanup: 'none' | 'pending' | 'settled';
  storeCleanup: 'none' | 'pending' | 'settled';
  startedAt: number;
  deadlineAt: number;
  decisionAt?: number;
  finishedAt?: number;
  hostTerminalStatus?: 'completed' | 'failed';
  guardFailure?: GuardFailure;
}
export interface HostDeliveryReport { source: HostDeliverySource; delivery: HostDeliveryRecord }

/** Main-only identity handle. The service's WeakMap, not ownerId, grants access. */
export interface HostDeliveryRecoveryAuthority { readonly ownerId: string }

/** The service validates the complete payload against its current recovery phase. */
export interface HostDeliveryRecoveryInvocation {
  authority: HostDeliveryRecoveryAuthority;
  taskId: string;
  snapshot: TaskSnapshot;
  /** Required and exact-bound in host phase; forbidden in consumers phase. */
  delivery?: HostDeliveryRecord;
  eventIndex?: number;
  event?: DesktopTaskEvent;
}

/** Compatible with PersistedTaskEvent; the consumer must narrow task_terminal
 * at its runtime boundary before using this as a recovered terminal receipt. */
export interface HostDeliveryRecoveryReceipt extends HostDeliveryRecoveryInvocation {
  eventIndex: number;
  event: DesktopTaskEvent;
}
